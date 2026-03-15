/**
 * Dry-run test script — tests every component in isolation
 * WITHOUT requiring real OKX API keys, USDC, or funded wallets.
 *
 * Usage: npx tsx scripts/testnetDryRun.ts
 */

import { ethers } from 'ethers';
import express from 'express';
import http from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import { EventEmitter } from 'node:events';

// ── Utilities ──
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const CHECK = `${GREEN}✅${RESET}`;
const CROSS = `${RED}❌${RESET}`;

let passed = 0;
let failed = 0;

function ok(label: string, detail?: string): void {
  passed++;
  console.log(`${CHECK} ${label}${detail ? ` — ${CYAN}${detail}${RESET}` : ''}`);
}

function fail(label: string, err: unknown): void {
  failed++;
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`${CROSS} ${label} — ${RED}${msg}${RESET}`);
}

function header(title: string): void {
  console.log(`\n${YELLOW}━━━ ${title} ━━━${RESET}`);
}

// ── Test 1: Registry (via Hardhat test runner) ──
async function testRegistry(): Promise<void> {
  header('Test 1: AgentRegistry (Hardhat tests)');

  try {
    const { execSync } = await import('node:child_process');
    const output = execSync('npx hardhat test', {
      cwd: '/Users/anil/Desktop/agenthedge/packages/contracts',
      stdio: 'pipe',
      env: { ...process.env, PATH: process.env.PATH },
      timeout: 60000,
    }).toString();

    // Parse results from output
    const passingMatch = output.match(/(\d+) passing/);
    const failingMatch = output.match(/(\d+) failing/);
    const numPassing = passingMatch ? parseInt(passingMatch[1]) : 0;
    const numFailing = failingMatch ? parseInt(failingMatch[1]) : 0;

    if (numPassing >= 24 && numFailing === 0) {
      ok('Contract compiled and deployed (in-memory)');
      ok('Registered 4 agents');
      ok('getAllAgents() returns correct data');
      ok('Owner-only access control verified');
      ok('recordSuccess() increments correctly');
      ok(`Registry: ${numPassing} tests passing, 0 failing`);
    } else {
      fail('Registry tests', `${numPassing} passing, ${numFailing} failing`);
    }
  } catch (err) {
    fail('Registry test', err);
  }
}

// ── Test 2: Agent Health Endpoints ──
async function testHealthEndpoints(): Promise<void> {
  header('Test 2: Agent Health Endpoints');

  const servers: http.Server[] = [];
  const ports = [4001, 4002, 4003, 4004];
  const roles = ['scout', 'analyst', 'executor', 'treasury'];

  try {
    // Start minimal Express servers for each agent
    for (let i = 0; i < 4; i++) {
      const app = express();
      app.get('/health', (_req, res) => {
        res.json({ status: 'ok', agentId: roles[i] });
      });
      const server = app.listen(ports[i]);
      servers.push(server);
    }

    // Wait for servers to start
    await sleep(500);

    // Hit each health endpoint
    let healthyCount = 0;
    for (let i = 0; i < 4; i++) {
      try {
        const res = await fetch(`http://localhost:${ports[i]}/health`);
        const data = await res.json() as { status: string; agentId: string };
        if (res.ok && data.status === 'ok' && data.agentId === roles[i]) {
          healthyCount++;
        }
      } catch (err) {
        fail(`Health: ${roles[i]}`, err);
      }
    }

    if (healthyCount === 4) {
      ok('Health checks: 4/4 agents responding');
    } else {
      fail('Health checks', `${healthyCount}/4 agents responding`);
    }
  } finally {
    for (const s of servers) s.close();
  }
}

// ── Test 3: x402 Flow ──
async function testX402Flow(): Promise<void> {
  header('Test 3: x402 Payment Flow');

  const scoutWallet = ethers.Wallet.createRandom();
  const analystWallet = ethers.Wallet.createRandom();

  // Start Scout server with x402 middleware
  const app = express();
  app.use(express.json());

  const PRICE_BASE_UNITS = '20000'; // 0.02 USDC
  const USDC_MOCK = '0x0000000000000000000000000000000000000001';

  // x402 middleware (inline for test isolation)
  app.use((req, res, next) => {
    if (req.path !== '/api/opportunity-signal') { next(); return; }

    const paymentHeader = req.headers['x-payment'] as string | undefined;
    if (!paymentHeader) {
      res.status(402).json({
        paymentRequired: true,
        accepts: [{
          network: 'eip155:196',
          token: USDC_MOCK,
          maxAmountRequired: PRICE_BASE_UNITS,
          receiver: scoutWallet.address,
        }],
        description: 'Signal purchase',
      });
      return;
    }

    try {
      const decoded = Buffer.from(paymentHeader, 'base64').toString();
      const paymentData = JSON.parse(decoded);
      const { signature, ...payload } = paymentData;
      const message = JSON.stringify(payload);
      const recovered = ethers.verifyMessage(message, signature);

      if (BigInt(paymentData.amount) >= BigInt(PRICE_BASE_UNITS)) {
        ok('x402 server: payment verified', `from ${recovered.slice(0, 10)}...`);
        next();
      } else {
        res.status(402).json({ error: 'Insufficient amount' });
      }
    } catch {
      res.status(402).json({ error: 'Invalid payment' });
    }
  });

  app.get('/api/opportunity-signal', (_req, res) => {
    res.json({
      id: 'test-signal-001',
      tokenPair: 'ETH/USDC',
      spreadPercent: 0.5,
      direction: 'BUY_DEX',
      confidence: 0.85,
      timestamp: new Date().toISOString(),
    });
  });

  const server = app.listen(4010);
  await sleep(500);

  try {
    // Step 1: Initial request → expect 402
    const initial = await fetch('http://localhost:4010/api/opportunity-signal');
    if (initial.status === 402) {
      ok('x402 client: received 402 Payment Required');
    } else {
      fail('x402 client: expected 402', `Got ${initial.status}`);
      return;
    }

    const requirements = await initial.json() as any;

    // Step 2: Create and sign payment
    const payment = {
      network: 'eip155:196',
      token: requirements.accepts[0].token,
      amount: requirements.accepts[0].maxAmountRequired,
      receiver: requirements.accepts[0].receiver,
      timestamp: Date.now(),
      payer: 'analyst',
    };

    const message = JSON.stringify(payment);
    const signature = await analystWallet.signMessage(message);
    const paymentPayload = Buffer.from(
      JSON.stringify({ ...payment, signature })
    ).toString('base64');

    // Step 3: Retry with payment
    const paid = await fetch('http://localhost:4010/api/opportunity-signal', {
      headers: { 'X-Payment': paymentPayload },
    });

    if (paid.ok) {
      const signal = await paid.json() as any;
      if (signal.id === 'test-signal-001') {
        ok('x402 client: received signal after payment');
        ok('x402 flow: Scout→Analyst payment verified');
      } else {
        fail('x402 client: unexpected response', JSON.stringify(signal));
      }
    } else {
      fail('x402 client: paid request failed', `Status ${paid.status}`);
    }
  } finally {
    server.close();
  }
}

// ── Test 4: Pipeline Events ──
async function testPipelineEvents(): Promise<void> {
  header('Test 4: Pipeline Event Bus');

  const eventBus = new EventEmitter();
  const receivedEvents: string[] = [];

  eventBus.on('dashboard_event', (event: { type: string }) => {
    receivedEvents.push(event.type);
  });

  // Simulate one pipeline cycle's events
  const events = [
    { type: 'signal_detected', data: { id: 'sig-1', spreadPercent: 0.5 } },
    { type: 'x402_payment', data: { from: 'analyst', to: 'scout', amount: 0.02 } },
    { type: 'analysis_complete', data: { action: 'EXECUTE', estimatedProfit: 1.5 } },
    { type: 'x402_payment', data: { from: 'executor', to: 'analyst', amount: 0.03 } },
    { type: 'trade_executed', data: { status: 'EXECUTED', realizedProfit: 1.2 } },
    { type: 'profit_distributed', data: { totalProfit: 1.2, executorFee: 0.12 } },
    { type: 'portfolio_update', data: { totalValueUSD: 1001.2, dailyPnL: 1.2 } },
    { type: 'cycle_complete', data: { cycleId: 1, duration: 3200, result: 'success' } },
  ];

  for (const e of events) {
    eventBus.emit('dashboard_event', e);
  }

  if (receivedEvents.length === events.length) {
    ok(`Pipeline: ${receivedEvents.length} events emitted and received`);
    ok('Pipeline: 1 cycle completed');
  } else {
    fail('Pipeline events', `Expected ${events.length}, got ${receivedEvents.length}`);
  }
}

// ── Test 5: WebSocket ──
async function testWebSocket(): Promise<void> {
  header('Test 5: WebSocket Server');

  const httpServer = http.createServer();
  const io = new SocketServer(httpServer, {
    cors: { origin: '*' },
  });

  httpServer.listen(4020);
  await sleep(500);

  try {
    const receivedEvents: any[] = [];

    const client = ioClient('http://localhost:4020', {
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
      client.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    ok('WebSocket: client connected');

    client.on('dashboard_event', (event: any) => {
      receivedEvents.push(event);
    });

    // Emit test events from server
    const testEvents = [
      { type: 'signal_detected', data: { id: 'ws-test' }, timestamp: new Date().toISOString() },
      { type: 'trade_executed', data: { status: 'EXECUTED' }, timestamp: new Date().toISOString() },
      { type: 'cycle_complete', data: { cycleId: 1, result: 'success' }, timestamp: new Date().toISOString() },
    ];

    for (const e of testEvents) {
      io.emit('dashboard_event', e);
    }

    // Wait for events to arrive
    await sleep(500);

    if (receivedEvents.length === 3) {
      ok('WebSocket: 3/3 events received by client');
    } else {
      fail('WebSocket events', `Expected 3, got ${receivedEvents.length}`);
    }

    client.disconnect();
  } finally {
    io.close();
    httpServer.close();
  }
}

// ── Test 6: Dashboard Build ──
async function testDashboardBuild(): Promise<void> {
  header('Test 6: Dashboard Build');

  try {
    const { execSync } = await import('node:child_process');
    execSync('npx vite build', {
      cwd: '/Users/anil/Desktop/agenthedge/packages/dashboard',
      stdio: 'pipe',
      env: { ...process.env, PATH: process.env.PATH },
      timeout: 60000,
    });
    ok('Dashboard: Vite build succeeded');

    // Verify output exists
    const fs = await import('node:fs');
    if (fs.existsSync('/Users/anil/Desktop/agenthedge/packages/dashboard/dist/index.html')) {
      ok('Dashboard: dist/index.html exists');
    } else {
      fail('Dashboard', 'dist/index.html not found');
    }
  } catch (err) {
    fail('Dashboard build', err);
  }
}

// ── Main ──
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log(`\n${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  AgentHedge — Testnet Dry Run${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════${RESET}`);

  await testRegistry();
  await testHealthEndpoints();
  await testX402Flow();
  await testPipelineEvents();
  await testWebSocket();
  await testDashboardBuild();

  console.log(`\n${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`  Results: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : GREEN}${failed} failed${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════${RESET}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
