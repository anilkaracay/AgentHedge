import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { config, logInfo, logError, eventBus, scanAllVenues, getGasPrice, TRACKED_TOKENS } from '@agenthedge/shared';
import type { DashboardEvent } from '@agenthedge/shared';
import { runArbitrageCycle } from './pipeline.js';
import { startAllAgents } from './agents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CYCLE_INTERVAL_MS = config.SCOUT_POLL_INTERVAL * 3; // ~15s between cycles

// ── Express + HTTP Server ──
const app = express();
app.use(cors());
app.use(express.json());

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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', component: 'orchestrator', uptime: process.uptime() });
});

// ── Demo Mode Toggle ──
app.get('/api/demo-mode', (_req, res) => {
  res.json({ demoMode: process.env.DEMO_MODE === 'true' });
});

app.post('/api/demo-mode', (req, res) => {
  const { demoMode } = req.body as { demoMode: boolean };
  process.env.DEMO_MODE = demoMode ? 'true' : 'false';
  logInfo('orchestrator', `Demo mode ${demoMode ? 'ENABLED' : 'DISABLED'}`);
  res.json({ demoMode: process.env.DEMO_MODE === 'true' });
});

// ── Pipeline Loop ──
let pipelineTimer: ReturnType<typeof setInterval> | null = null;
let pipelineRunning = false;

async function startPipeline(): Promise<void> {
  logInfo('orchestrator', `Starting pipeline loop, interval ${CYCLE_INTERVAL_MS}ms`);

  setTimeout(() => { void runArbitrageCycle(); }, 5000);

  pipelineTimer = setInterval(async () => {
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

  // Start pipeline loop
  startPipeline().catch((err) => {
    logError('orchestrator', 'Failed to start pipeline', err);
  });
});
