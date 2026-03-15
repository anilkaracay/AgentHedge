import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { config, logInfo, logError, eventBus } from '@agenthedge/shared';
import type { DashboardEvent } from '@agenthedge/shared';
import { runArbitrageCycle } from './pipeline.js';

const CYCLE_INTERVAL_MS = config.SCOUT_POLL_INTERVAL * 3; // ~15s between cycles

// ── WebSocket Server ──
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: `http://localhost:${config.DASHBOARD_PORT}` },
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

// ── Pipeline Loop ──
let pipelineTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function startPipeline(): Promise<void> {
  logInfo('orchestrator', `Starting pipeline loop, interval ${CYCLE_INTERVAL_MS}ms`);

  // Run first cycle after a short delay to let agents start
  setTimeout(() => { void runArbitrageCycle(); }, 5000);

  pipelineTimer = setInterval(async () => {
    if (running) {
      logInfo('orchestrator', 'Previous cycle still running, skipping');
      return;
    }
    running = true;
    try {
      await runArbitrageCycle();
    } finally {
      running = false;
    }
  }, CYCLE_INTERVAL_MS);
}

// ── Graceful Shutdown ──
function shutdown(): void {
  logInfo('orchestrator', 'Shutting down...');

  if (pipelineTimer) {
    clearInterval(pipelineTimer);
    pipelineTimer = null;
  }

  io.close();
  httpServer.close(() => {
    logInfo('orchestrator', 'Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Start ──
httpServer.listen(config.ORCHESTRATOR_WS_PORT, () => {
  logInfo('orchestrator', `WebSocket server listening on port ${config.ORCHESTRATOR_WS_PORT}`);
  startPipeline().catch((err) => {
    logError('orchestrator', 'Failed to start pipeline', err);
    process.exit(1);
  });
});
