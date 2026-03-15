/**
 * End-to-end test of refactored system with real OnchainOS API data.
 * Only uses quote endpoints — NO real swaps executed.
 *
 * Usage: npx tsx scripts/testRefactored.ts
 */
import { ethers } from 'ethers';
import express from 'express';
import http from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import { EventEmitter } from 'node:events';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Direct imports from built shared package
import {
  getPrice,
  getSwapQuote,
  config,
  logInfo,
  eventBus,
  createX402Middleware,
  callPaidEndpoint,
} from '@agenthedge/shared';
import type {
  DashboardEvent,
  X402PaymentEvent,
  OpportunitySignal,
  X402RouteConfig,
} from '@agenthedge/shared';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const CHECK = `${GREEN}✅${RESET}`;
const CROSS = `${RED}❌${RESET}`;

let passed = 0;
let failed = 0;

function ok(label: string, detail?: string) {
  passed++;
  console.log(`  ${CHECK} ${label}${detail ? ` — ${DIM}${detail}${RESET}` : ''}`);
}
function fail(label: string, err: unknown) {
  failed++;
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ${CROSS} ${label} — ${RED}${msg}${RESET}`);
}
function header(title: string) {
  console.log(`\n${YELLOW}━━━ ${title} ━━━${RESET}\n`);
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const NATIVE = config.NATIVE_TOKEN_ADDRESS;
const USDC_XLAYER = config.USDC_ADDRESS;
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

// ── Test 1: Price Oracle ──
async function testPriceOracle() {
  header('Test 1: Price Oracle via aggregator/quote');

  try {
    console.log(`  Quoting 1 native token → USDC on X Layer (196)...`);
    const xlayer = await getPrice('196', NATIVE, USDC_XLAYER, '1000000000000000000');
    ok(`X Layer native → USDC`, `$${xlayer.price.toFixed(2)} (impact: ${xlayer.priceImpact}%, gas: ${xlayer.gasFee})`);

    await sleep(2000); // rate limit spacing

    console.log(`  Quoting 1 native token → USDC on Ethereum (1)...`);
    const eth = await getPrice('1', NATIVE, USDC_ETH, '1000000000000000000');
    ok(`Ethereum native → USDC`, `$${eth.price.toFixed(2)} (impact: ${eth.priceImpact}%, gas: ${eth.gasFee})`);

    // Calculate cross-chain spread
    const spread = Math.abs(xlayer.price - eth.price) / eth.price * 100;
    console.log(`\n  ${CYAN}Cross-chain spread: ${spread.toFixed(4)}%${RESET}`);
    console.log(`  ${DIM}(X Layer OKB ≈ $${xlayer.price.toFixed(2)}, Ethereum ETH ≈ $${eth.price.toFixed(2)})${RESET}`);
    console.log(`  ${DIM}Note: Different native tokens — OKB vs ETH. Real arb would compare same token across chains.${RESET}`);
    ok('Price oracle works with real API data');
  } catch (err) {
    fail('Price oracle', err);
  }
}

// ── Test 2: Swap Quote Details ──
async function testSwapQuote() {
  header('Test 2: Detailed Swap Quote');

  await sleep(2000);

  try {
    const quote = await getSwapQuote({
      chainIndex: '196',
      fromTokenAddress: NATIVE,
      toTokenAddress: USDC_XLAYER,
      amount: '10000000000000000', // 0.01 native token
      slippagePercent: '0.5',
    });

    console.log(`  From: ${quote.fromToken?.tokenSymbol ?? 'native'} (${quote.fromToken?.decimal ?? '18'} dec)`);
    console.log(`  To:   ${quote.toToken?.tokenSymbol ?? 'USDC'} (${quote.toToken?.decimal ?? '6'} dec)`);
    console.log(`  Input:  ${quote.fromTokenAmount}`);
    console.log(`  Output: ${quote.toTokenAmount}`);
    console.log(`  Gas:    ${quote.estimateGasFee}`);
    console.log(`  Impact: ${quote.priceImpactPercentage ?? 'N/A'}%`);
    if (quote.dexRouterList?.[0]) {
      console.log(`  DEX:    ${quote.dexRouterList[0].dexProtocol.dexName} (${quote.dexRouterList[0].dexProtocol.percent}%)`);
    }
    ok('Swap quote returned full data');
  } catch (err) {
    fail('Swap quote', err);
  }
}

// ── Test 3: Agent Servers + x402 Flow ──
async function testAgentServers() {
  header('Test 3: Agent Servers + x402 Payment Flow');

  const servers: http.Server[] = [];
  const scoutWallet = ethers.Wallet.createRandom();
  const analystWallet = ethers.Wallet.createRandom();

  // Mock signal for Scout to serve
  const mockSignal: OpportunitySignal = {
    id: 'test-signal-live',
    tokenPair: 'OKB/USDC',
    fromToken: NATIVE,
    toToken: USDC_XLAYER,
    cexPrice: 96.5,
    dexPrice: 97.0,
    spreadPercent: 0.52,
    direction: 'SELL_DEX',
    volume24h: 0,
    confidence: 0.85,
    timestamp: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30000).toISOString(),
  };

  try {
    // Start Scout server with inline x402 middleware (to ensure route matching)
    const scoutApp = express();
    scoutApp.use(express.json());

    scoutApp.get('/api/opportunity-signal', (req, res, next) => {
      const paymentHeader = req.headers['x-payment'] as string | undefined;
      if (!paymentHeader) {
        res.status(402).json({
          paymentRequired: true,
          accepts: [{
            network: 'eip155:196',
            token: USDC_XLAYER,
            maxAmountRequired: '20000',
            receiver: scoutWallet.address,
          }],
          description: 'Arbitrage signal',
        });
        return;
      }
      try {
        const decoded = Buffer.from(paymentHeader, 'base64').toString();
        const data = JSON.parse(decoded);
        const { signature, ...payload } = data;
        ethers.verifyMessage(JSON.stringify(payload), signature);
        next();
      } catch {
        res.status(402).json({ error: 'Invalid payment' });
      }
    }, (_req, res) => res.json(mockSignal));

    scoutApp.get('/health', (_req, res) => res.json({ status: 'ok', agentId: 'scout' }));
    servers.push(scoutApp.listen(4101));

    // Start Analyst server
    const analystApp = express();
    analystApp.use(express.json());
    analystApp.get('/health', (_req, res) => res.json({ status: 'ok', agentId: 'analyst' }));
    servers.push(analystApp.listen(4102));

    // Start Executor server
    const executorApp = express();
    executorApp.use(express.json());
    executorApp.get('/health', (_req, res) => res.json({ status: 'ok', agentId: 'executor' }));
    servers.push(executorApp.listen(4103));

    // Start Treasury server
    const treasuryApp = express();
    treasuryApp.use(express.json());
    treasuryApp.get('/health', (_req, res) => res.json({ status: 'ok', agentId: 'treasury' }));
    treasuryApp.post('/api/risk-check', (_req, res) => res.json({ approved: true, maxTradeSize: '1000000' }));
    treasuryApp.get('/api/portfolio', (_req, res) => res.json({ totalValueUSD: 100, dailyPnL: 0, dailyPnLPercent: 0, tokenBalances: [], circuitBreakerActive: false }));
    servers.push(treasuryApp.listen(4104));

    await sleep(500);

    // Health checks
    let healthyCount = 0;
    for (const [port, role] of [[4101, 'scout'], [4102, 'analyst'], [4103, 'executor'], [4104, 'treasury']] as const) {
      try {
        const res = await fetch(`http://localhost:${port}/health`);
        const data = await res.json() as { status: string };
        if (data.status === 'ok') healthyCount++;
      } catch { /* skip */ }
    }
    if (healthyCount === 4) {
      ok('All 4 agent servers responding on /health');
    } else {
      fail('Health checks', `${healthyCount}/4 responding`);
    }

    // x402 payment flow: Analyst purchases Scout's signal
    console.log(`\n  Testing x402 payment: Analyst → Scout...`);

    // Step 1: Hit Scout endpoint without payment → expect 402
    const initialRes = await fetch('http://localhost:4101/api/opportunity-signal');
    if (initialRes.status === 402) {
      ok('Scout returns 402 Payment Required');
    } else {
      fail('Expected 402', `Got ${initialRes.status}`);
    }

    // Step 2: Pay via x402 client
    const collectedEvents: DashboardEvent[] = [];
    eventBus.on('dashboard_event', (e: DashboardEvent) => collectedEvents.push(e));

    const signal = await callPaidEndpoint<OpportunitySignal>(
      analystWallet,
      'http://localhost:4101/api/opportunity-signal',
      'GET',
      'analyst',
      'scout'
    );

    if (signal && signal.id === 'test-signal-live') {
      ok('x402 payment succeeded, signal received');
    } else {
      fail('x402 payment', 'Unexpected response');
    }

    // Check x402 events
    const paymentEvents = collectedEvents.filter(e => e.type === 'x402_payment');
    if (paymentEvents.length >= 1) {
      const pe = paymentEvents[0].data as X402PaymentEvent;
      ok(`x402 event emitted`, `${pe.from} → ${pe.to}: ${pe.amount} USDC`);
    } else {
      fail('x402 event', 'No payment events captured');
    }

  } finally {
    for (const s of servers) s.close();
  }
}

// ── Test 4: Pipeline Cycle Simulation ──
async function testPipelineCycle() {
  header('Test 4: Pipeline Cycle Simulation');

  const events: DashboardEvent[] = [];
  const listener = (e: DashboardEvent) => events.push(e);
  eventBus.on('dashboard_event', listener);

  try {
    // Simulate full cycle events as the orchestrator would produce
    const cycleEvents: DashboardEvent[] = [
      {
        type: 'signal_detected',
        data: { id: 'sig-live', tokenPair: 'OKB/USDC', spreadPercent: 0.52, direction: 'SELL_DEX' },
        timestamp: new Date().toISOString(),
      },
      {
        type: 'x402_payment',
        data: { from: 'analyst', to: 'scout', amount: 0.02, purpose: 'signal_purchase' },
        timestamp: new Date().toISOString(),
      },
      {
        type: 'analysis_complete',
        data: { action: 'EXECUTE', estimatedProfit: 1.23, confidence: 0.85 },
        timestamp: new Date().toISOString(),
      },
      {
        type: 'x402_payment',
        data: { from: 'executor', to: 'analyst', amount: 0.03, purpose: 'analysis_purchase' },
        timestamp: new Date().toISOString(),
      },
      {
        type: 'trade_executed',
        data: { status: 'EXECUTED', realizedProfit: 0.98, txHash: '0xabc123' },
        timestamp: new Date().toISOString(),
      },
      {
        type: 'profit_distributed',
        data: { totalProfit: 0.98, executorFee: 0.098, treasuryFee: 0.049, poolReturn: 0.833 },
        timestamp: new Date().toISOString(),
      },
      {
        type: 'portfolio_update',
        data: { totalValueUSD: 100.98, dailyPnL: 0.98, dailyPnLPercent: 0.98, circuitBreakerActive: false },
        timestamp: new Date().toISOString(),
      },
      {
        type: 'cycle_complete',
        data: { cycleId: 1, duration: 4200, result: 'success' },
        timestamp: new Date().toISOString(),
      },
    ];

    for (const e of cycleEvents) {
      eventBus.emitDashboardEvent(e);
    }

    if (events.length === cycleEvents.length) {
      ok(`${events.length} pipeline events emitted and received`);

      // Print event summary
      const counts: Record<string, number> = {};
      for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
      for (const [type, count] of Object.entries(counts)) {
        console.log(`    ${DIM}${type}: ${count}${RESET}`);
      }
    } else {
      fail('Pipeline events', `Expected ${cycleEvents.length}, got ${events.length}`);
    }
  } finally {
    eventBus.removeListener('dashboard_event', listener);
  }
}

// ── Test 5: WebSocket ──
async function testWebSocket() {
  header('Test 5: WebSocket Dashboard Integration');

  const httpServer = http.createServer();
  const io = new SocketServer(httpServer, { cors: { origin: '*' } });
  httpServer.listen(4200);
  await sleep(500);

  const received: DashboardEvent[] = [];

  try {
    // Forward events to WebSocket
    const wsForwarder = (e: DashboardEvent) => io.emit('dashboard_event', e);
    eventBus.on('dashboard_event', wsForwarder);

    // Connect client
    const client = ioClient('http://localhost:4200', { transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WS timeout')), 5000);
      client.on('connect', () => { clearTimeout(t); resolve(); });
    });
    ok('WebSocket client connected');

    client.on('dashboard_event', (e: DashboardEvent) => received.push(e));

    // Emit test events
    for (const type of ['signal_detected', 'x402_payment', 'trade_executed'] as const) {
      eventBus.emitDashboardEvent({
        type,
        data: { test: true },
        timestamp: new Date().toISOString(),
      });
    }

    await sleep(500);

    if (received.length === 3) {
      ok('WebSocket: 3/3 events forwarded to dashboard client');
    } else {
      fail('WebSocket', `Expected 3, got ${received.length}`);
    }

    client.disconnect();
    eventBus.removeListener('dashboard_event', wsForwarder);
  } finally {
    io.close();
    httpServer.close();
  }
}

// ── Test 6: On-chain Registry Read ──
async function testRegistryRead() {
  header('Test 6: On-chain Registry Read (X Layer Testnet)');

  try {
    const provider = new ethers.JsonRpcProvider(config.XLAYER_RPC);
    const ABI = [
      'function getAgentCount() view returns (uint256)',
      'function getAllAgents() view returns (tuple(address wallet, string agentId, string role, string endpoint, uint256 pricePerReq, address payToken, uint256 successCount, uint256 failCount, uint256 registeredAt, bool active)[])',
    ];
    const registry = new ethers.Contract(config.REGISTRY_ADDRESS, ABI, provider);

    const count = await registry.getAgentCount();
    ok(`Registry has ${count} agents on testnet`);

    if (count > 0n) {
      const agents = await registry.getAllAgents();
      for (const a of agents) {
        console.log(`    ${CYAN}${a.agentId}${RESET}: ${a.role} (success: ${a.successCount}, active: ${a.active})`);
      }
    }
  } catch (err) {
    fail('Registry read', err);
  }
}

// ── Main ──
async function main() {
  console.log(`\n${CYAN}═══════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  AgentHedge — Refactored System Test (Real API Data)${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════════════${RESET}`);

  await testPriceOracle();
  await testSwapQuote();
  await testAgentServers();
  await testPipelineCycle();
  await testWebSocket();
  await testRegistryRead();

  console.log(`\n${CYAN}═══════════════════════════════════════════════════════${RESET}`);
  console.log(`  Results: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : GREEN}${failed} failed${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════════════${RESET}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
