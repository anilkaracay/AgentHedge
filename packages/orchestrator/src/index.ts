import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { config, logInfo, logError, eventBus, scanAllVenues, getGasPrice, TRACKED_TOKENS, isDemoMode, AgentHedgeTelegramBot, getDemoPortfolio } from '@agenthedge/shared';
import type { DashboardEvent, SystemStateAccessor } from '@agenthedge/shared';
import { runArbitrageCycle } from './pipeline.js';
import { startAllAgents, getDemoHistory, getAttestationHistory } from './agents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CYCLE_INTERVAL_MS = config.SCOUT_POLL_INTERVAL * 3; // ~15s between cycles

// ── Express + HTTP Server ──
const app = express();
app.use(cors());
app.use(express.json());

// Serve dashboard at /dashboard (must be before landing catch-all)
const dashboardPath = path.resolve(__dirname, '../../dashboard/dist');
app.use('/dashboard', express.static(dashboardPath));
app.get('/dashboard/*', (_req, res) => {
  res.sendFile(path.join(dashboardPath, 'index.html'));
});

// Serve landing page at root
const landingPath = path.resolve(__dirname, '../../landing');
app.use(express.static(landingPath));

const httpServer = createServer(app);

// ── WebSocket Server ──
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  logInfo('orchestrator', `Dashboard connected: ${socket.id}`);

  // Send full session history on connect (survives F5)
  const history = getDemoHistory();
  const now = new Date().toISOString();

  // Agent registrations
  for (const agent of ['scout', 'analyst', 'executor', 'treasury']) {
    socket.emit('dashboard_event', { type: 'agent_registered', data: { agentId: agent, role: agent }, timestamp: now });
  }

  // Replay all trades
  for (const trade of history.trades) {
    socket.emit('dashboard_event', { type: 'trade_executed', data: trade, timestamp: trade.timestamp });
  }

  // Replay all payments
  for (const payment of history.payments) {
    socket.emit('dashboard_event', { type: 'x402_payment', data: payment, timestamp: payment.timestamp });
  }

  // Replay all attestations
  for (const att of history.attestations) {
    socket.emit('dashboard_event', { type: 'chain_attestation', data: att, timestamp: att.timestamp });
  }

  // Send current portfolio
  if (liveState.treasury.portfolio > 0) {
    socket.emit('dashboard_event', {
      type: 'portfolio_update',
      data: { totalValueUSD: liveState.treasury.portfolio, tokenBalances: [], dailyPnL: liveState.treasury.dailyPnl, dailyPnLPercent: 0, circuitBreakerActive: false },
      timestamp: now,
    });
  }

  logInfo('orchestrator', `Synced ${history.trades.length} trades + ${history.payments.length} payments + ${history.attestations.length} attestations to dashboard`);

  socket.on('disconnect', () => {
    logInfo('orchestrator', `Dashboard disconnected: ${socket.id}`);
  });
});

// Forward all eventBus events to connected dashboards
eventBus.on('dashboard_event', (event: DashboardEvent) => {
  io.emit('dashboard_event', event);
});

// ── Live state for API ──
interface LiveState {
  scout: { xlayerPrice: number; ethPrice: number; spread: number; lastUpdate: string };
  analyst: { confidence: number; netProfit: number; action: string; lastUpdate: string };
  executor: { route: string; slippage: number; gasCost: string; lastUpdate: string };
  treasury: { portfolio: number; dailyPnl: number; circuitBreaker: string; lastUpdate: string };
  meta: { cyclesCompleted: number; totalTx: number; agentsRegistered: number };
}

const liveState: LiveState = {
  scout: { xlayerPrice: 0, ethPrice: 0, spread: 0, lastUpdate: '' },
  analyst: { confidence: 0, netProfit: 0, action: 'IDLE', lastUpdate: '' },
  executor: { route: '--', slippage: 0, gasCost: '$0.00', lastUpdate: '' },
  treasury: { portfolio: 0, dailyPnl: 0, circuitBreaker: 'OK', lastUpdate: '' },
  meta: { cyclesCompleted: 0, totalTx: 13, agentsRegistered: 4 },
};

// ── Pause/Resume ──
let pipelinePaused = false;
const startTimestamp = Date.now();

// ── Telegram Bot ──
const telegramBot = new AgentHedgeTelegramBot({
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || '',
  enabled: process.env.TELEGRAM_ENABLED === 'true',
  throttleMonitor: parseInt(process.env.TELEGRAM_THROTTLE_MONITOR || '10', 10),
  spreadThreshold: parseFloat(process.env.ALERT_SPREAD_THRESHOLD || '0.4'),
});

const systemState: SystemStateAccessor = {
  getRecentTrades: (n) => getDemoHistory().trades.slice(-n),
  getPortfolio: () => ({
    totalValueUSD: liveState.treasury.portfolio,
    dailyPnL: liveState.treasury.dailyPnl,
  }),
  getCycleCount: () => liveState.meta.cyclesCompleted,
  getUptime: () => Date.now() - startTimestamp,
  getAttestationCount: () => getAttestationHistory().length,
  isPaused: () => pipelinePaused,
  pause: () => { pipelinePaused = true; logInfo('orchestrator', 'Pipeline PAUSED via Telegram'); },
  resume: () => { pipelinePaused = false; logInfo('orchestrator', 'Pipeline RESUMED via Telegram'); },
  getDemoMode: () => isDemoMode(),
};
telegramBot.setStateAccessor(systemState);

// ── Telegram event subscriptions ──
eventBus.on('dashboard_event', (event: DashboardEvent) => {
  switch (event.type) {
    case 'trade_executed':
      telegramBot.sendTradeAlert(event.data);
      break;
    case 'chain_attestation':
      telegramBot.sendAttestationAlert(event.data);
      break;
    case 'signal_detected': {
      const d = event.data as any;
      if (d.spreadPercent > parseFloat(process.env.ALERT_SPREAD_THRESHOLD || '0.4')) {
        telegramBot.sendSpreadAlert(d);
      }
      break;
    }
    case 'analysis_complete': {
      const d = event.data as any;
      if (d.action === 'MONITOR') {
        telegramBot.sendMonitorUpdate({
          spreadPercent: d.estimatedSlippage || 0,
          buyVenue: d.reason?.split(' ')[0] || '?',
          sellVenue: '?',
          buyPrice: 0,
          sellPrice: 0,
        });
      }
      break;
    }
  }
});

// Update state from events
eventBus.on('dashboard_event', (event: DashboardEvent) => {
  const now = new Date().toISOString();
  switch (event.type) {
    case 'signal_detected': {
      const d = event.data as any;
      liveState.scout = {
        xlayerPrice: d.dexPrice ?? liveState.scout.xlayerPrice,
        ethPrice: d.cexPrice ?? liveState.scout.ethPrice,
        spread: d.spreadPercent ?? liveState.scout.spread,
        lastUpdate: now,
      };
      break;
    }
    case 'analysis_complete': {
      const d = event.data as any;
      liveState.analyst = {
        confidence: d.confidence ?? 0,
        netProfit: d.estimatedProfit ?? 0,
        action: d.action ?? 'SKIP',
        lastUpdate: now,
      };
      break;
    }
    case 'trade_executed': {
      const d = event.data as any;
      liveState.executor.lastUpdate = now;
      liveState.meta.totalTx++;
      break;
    }
    case 'portfolio_update': {
      const d = event.data as any;
      liveState.treasury = {
        portfolio: d.totalValueUSD ?? 0,
        dailyPnl: d.dailyPnL ?? 0,
        circuitBreaker: d.circuitBreakerActive ? 'ACTIVE' : 'OK',
        lastUpdate: now,
      };
      break;
    }
    case 'cycle_complete': {
      liveState.meta.cyclesCompleted++;
      break;
    }
  }
});

// ── REST API: Live Prices ──
let priceCache: { data: any; timestamp: number } | null = null;
const PRICE_CACHE_TTL = 15_000; // 15s cache to avoid rate limits

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

app.get('/api/live-prices', async (_req, res) => {
  try {
    // Return cached if fresh
    if (priceCache && Date.now() - priceCache.timestamp < PRICE_CACHE_TTL) {
      res.json(priceCache.data);
      return;
    }

    // Multi-venue simultaneous scan
    const scans = [];
    for (const token of TRACKED_TOKENS) {
      try {
        const scan = await scanAllVenues(token);
        scans.push(scan);
      } catch { /* skip */ }
    }

    // Best opportunity across all tokens
    scans.sort((a, b) => b.spreadPercent - a.spreadPercent);
    const best = scans[0];

    const response = {
      scans: scans.map(s => ({
        token: s.token,
        venues: s.venues.map(v => ({ venue: v.venue, type: v.venueType, price: v.price, latency: v.latency })),
        cheapest: { venue: s.cheapest.venue, price: s.cheapest.price },
        mostExpensive: { venue: s.mostExpensive.venue, price: s.mostExpensive.price },
        spread: s.spreadPercent,
        scanDuration: s.scanDuration,
      })),
      scout: {
        bestToken: best?.token ?? '--',
        buyVenue: best?.cheapest.venue ?? '--',
        buyPrice: best?.cheapest.price ?? 0,
        sellVenue: best?.mostExpensive.venue ?? '--',
        sellPrice: best?.mostExpensive.price ?? 0,
        spread: best?.spreadPercent ?? 0,
        venuesResponded: best?.venues.length ?? 0,
        scanDuration: best?.scanDuration ?? 0,
        lastUpdate: new Date().toISOString(),
      },
      analyst: {
        confidence: liveState.analyst.confidence || 0,
        netProfit: liveState.analyst.netProfit || 0,
        action: liveState.analyst.action || 'IDLE',
        lastUpdate: liveState.analyst.lastUpdate || new Date().toISOString(),
      },
      executor: {
        route: best?.venues.find(v => v.venueType === 'dex')?.venue ?? '--',
        slippage: 0.1,
        gasCost: '$0.00',
        lastUpdate: new Date().toISOString(),
      },
      treasury: {
        portfolio: liveState.treasury.portfolio || 0,
        dailyPnl: liveState.treasury.dailyPnl || 0,
        circuitBreaker: liveState.treasury.circuitBreaker || 'OK',
        lastUpdate: liveState.treasury.lastUpdate || new Date().toISOString(),
      },
      meta: {
        cyclesCompleted: liveState.meta.cyclesCompleted,
        totalTx: liveState.meta.totalTx,
        agentsRegistered: liveState.meta.agentsRegistered,
        timestamp: new Date().toISOString(),
      },
    };

    priceCache = { data: response, timestamp: Date.now() };
    res.json(response);
  } catch (err) {
    logError('orchestrator', 'Live prices API error', err);
    // Return last known state on error
    res.json({
      scout: liveState.scout,
      analyst: liveState.analyst,
      executor: liveState.executor,
      treasury: liveState.treasury,
      meta: { ...liveState.meta, timestamp: new Date().toISOString() },
      error: 'Using cached data',
    });
  }
});

app.get('/api/attestations', (_req, res) => {
  res.json({ attestations: getAttestationHistory(), count: getAttestationHistory().length });
});

app.get('/api/pipeline-status', (_req, res) => {
  res.json({ paused: pipelinePaused });
});

app.post('/api/pipeline-status', (req, res) => {
  const { paused } = req.body as { paused: boolean };
  pipelinePaused = paused;
  logInfo('orchestrator', `Pipeline ${paused ? 'PAUSED' : 'RESUMED'} via API`);
  res.json({ paused: pipelinePaused });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', component: 'orchestrator', uptime: process.uptime() });
});

// ── Demo Mode Toggle ──
app.get('/api/demo-mode', (_req, res) => {
  res.json({ demoMode: process.env.DEMO_MODE === 'true' });
});

app.post('/api/demo-mode', async (req, res) => {
  const { demoMode } = req.body as { demoMode: boolean };
  process.env.DEMO_MODE = demoMode ? 'true' : 'false';
  logInfo('orchestrator', `Demo mode ${demoMode ? 'ENABLED' : 'DISABLED'}`);

  // Immediately refresh portfolio with new mode so dashboard updates
  try {
    if (!demoMode) {
      // Real mode: fetch from OnchainOS Balance API
      const { getTotalValue, getTokenBalances } = await import('@agenthedge/shared');
      const ethers = await import('ethers');
      const wallet = new ethers.Wallet(config.SCOUT_PK); // any wallet to get treasury address
      const treasuryWallet = new ethers.Wallet(process.env.TREASURY_PK ?? '');
      const totalResult = await getTotalValue('196', treasuryWallet.address);
      const balances = await getTokenBalances('196', treasuryWallet.address);
      const portfolioData = {
        totalValueUSD: parseFloat(totalResult.totalValue.toFixed(4)),
        tokenBalances: balances.map((b: any) => ({ token: b.symbol, balance: b.balance, valueUSD: parseFloat(b.balance) * parseFloat(b.tokenPrice) })),
        dailyPnL: 0, dailyPnLPercent: 0, circuitBreakerActive: false,
      };
      eventBus.emitDashboardEvent({ type: 'portfolio_update', data: portfolioData, timestamp: new Date().toISOString() });
    } else {
      // Demo mode: emit demo portfolio
      const { getDemoPortfolio } = await import('@agenthedge/shared');
      const dp = getDemoPortfolio();
      const portfolioData = {
        totalValueUSD: dp.totalCapital,
        tokenBalances: [
          { token: 'OKB', balance: dp.totalOKB.toFixed(2), valueUSD: dp.totalOKB * 96 },
          { token: 'USDT', balance: dp.totalUSDT.toFixed(2), valueUSD: dp.totalUSDT },
        ],
        dailyPnL: dp.sessionPnL, dailyPnLPercent: 0, circuitBreakerActive: false,
      };
      eventBus.emitDashboardEvent({ type: 'portfolio_update', data: portfolioData, timestamp: new Date().toISOString() });
    }
  } catch (err) {
    logError('orchestrator', 'Failed to refresh portfolio after mode switch', err);
  }

  res.json({ demoMode: process.env.DEMO_MODE === 'true' });
});

// ── Pipeline Loop ──
let pipelineTimer: ReturnType<typeof setInterval> | null = null;
let pipelineRunning = false;

async function startPipeline(): Promise<void> {
  logInfo('orchestrator', `Starting pipeline loop, interval ${CYCLE_INTERVAL_MS}ms`);

  setTimeout(() => { void runArbitrageCycle(); }, 5000);

  pipelineTimer = setInterval(async () => {
    if (pipelinePaused) {
      logInfo('orchestrator', 'Pipeline paused, skipping cycle');
      return;
    }
    if (pipelineRunning) {
      logInfo('orchestrator', 'Previous cycle still running, skipping');
      return;
    }
    pipelineRunning = true;
    try {
      await runArbitrageCycle();
    } finally {
      pipelineRunning = false;
    }
  }, CYCLE_INTERVAL_MS);
}

// ── Graceful Shutdown ──
function shutdown(): void {
  logInfo('orchestrator', 'Shutting down...');
  telegramBot.sendShutdownMessage();
  telegramBot.stop();
  if (pipelineTimer) { clearInterval(pipelineTimer); pipelineTimer = null; }
  io.close();
  httpServer.close(() => {
    logInfo('orchestrator', 'Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Start ──
httpServer.listen(config.ORCHESTRATOR_WS_PORT, async () => {
  logInfo('orchestrator', `Orchestrator listening on port ${config.ORCHESTRATOR_WS_PORT} (HTTP + WebSocket + Landing Page)`);

  // Start all 4 agents in-process
  try {
    await startAllAgents();
  } catch (err) {
    logError('orchestrator', 'Failed to start agents', err);
  }

  // Send Telegram startup message
  const mode = isDemoMode() ? 'DEMO ($800K simulated)' : 'LIVE';
  const feeTier = process.env.FEE_TIER || 'professional';
  telegramBot.sendStartupMessage(mode, feeTier);

  // Start pipeline loop
  startPipeline().catch((err) => {
    logError('orchestrator', 'Failed to start pipeline', err);
  });
});
