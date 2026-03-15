/**
 * Development entry point — starts all 4 agents in-process,
 * then runs the orchestrator pipeline with WebSocket server.
 * Usage: npx tsx packages/orchestrator/src/devStart.ts
 */
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { config, logInfo, logError, eventBus } from '@agenthedge/shared';
import type { DashboardEvent } from '@agenthedge/shared';
import { runArbitrageCycle } from './pipeline.js';

// ── WebSocket Server ──
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  logInfo('devStart', `Dashboard connected: ${socket.id}`);
});

// ── Track all events + forward to WebSocket ──
const allEvents: DashboardEvent[] = [];
eventBus.on('dashboard_event', (event: DashboardEvent) => {
  allEvents.push(event);
  logInfo('devStart', `[EVENT] ${event.type}`, event.data);
  io.emit('dashboard_event', event);
});

// ── Main ──
async function main(): Promise<void> {
  logInfo('devStart', '═══════════════════════════════════════');
  logInfo('devStart', '  AgentHedge — Development Mode');
  logInfo('devStart', '═══════════════════════════════════════');

  // Start WebSocket server
  httpServer.listen(config.ORCHESTRATOR_WS_PORT, () => {
    logInfo('devStart', `WebSocket server on port ${config.ORCHESTRATOR_WS_PORT}`);
  });

  // Wait briefly for agents to initialize (in production they run separately)
  logInfo('devStart', 'Agents would start on their own ports in production.');
  logInfo('devStart', 'In dev mode, the orchestrator calls agent endpoints directly.');
  logInfo('devStart', '');

  // Run test cycles
  const NUM_CYCLES = 3;
  logInfo('devStart', `Running ${NUM_CYCLES} test cycles...`);
  logInfo('devStart', '');

  for (let i = 1; i <= NUM_CYCLES; i++) {
    logInfo('devStart', `━━━ Test Cycle ${i}/${NUM_CYCLES} ━━━`);
    try {
      await runArbitrageCycle();
    } catch (err) {
      logError('devStart', `Cycle ${i} error`, err);
    }

    // Wait between cycles
    if (i < NUM_CYCLES) {
      logInfo('devStart', 'Waiting 5s before next cycle...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  // Summary
  logInfo('devStart', '');
  logInfo('devStart', '═══════════════════════════════════════');
  logInfo('devStart', `  Completed ${NUM_CYCLES} cycles`);
  logInfo('devStart', `  Total events emitted: ${allEvents.length}`);
  logInfo('devStart', '  Event breakdown:');

  const counts: Record<string, number> = {};
  for (const e of allEvents) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
  }
  for (const [type, count] of Object.entries(counts)) {
    logInfo('devStart', `    ${type}: ${count}`);
  }
  logInfo('devStart', '═══════════════════════════════════════');

  // Keep alive for dashboard connections
  logInfo('devStart', 'WebSocket server running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  logError('devStart', 'Fatal error', err);
  process.exit(1);
});
