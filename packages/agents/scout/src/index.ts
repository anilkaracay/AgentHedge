import {
  AgentBase,
  config,
  logInfo,
  logError,
  eventBus,
} from '@agenthedge/shared';
import type { AgentConfig, OpportunitySignal } from '@agenthedge/shared';
import { scanForOpportunity } from './priceScanner.js';
import { createScoutServer } from './server.js';

class ScoutAgent extends AgentBase {
  private latestSignal: OpportunitySignal | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const agentConfig: AgentConfig = {
      agentId: 'scout',
      role: 'scout',
      privateKey: config.SCOUT_PK,
      port: config.SCOUT_PORT,
      endpoint: `http://localhost:${config.SCOUT_PORT}`,
      pricePerRequest: 0.02,
    };
    super(agentConfig);
  }

  async run(): Promise<void> {
    // Register on-chain
    try {
      await this.registerSelf();
    } catch (err) {
      logError('scout', 'On-chain registration failed, continuing anyway', err);
    }

    // Set up x402-protected server
    const scoutApp = createScoutServer(
      () => this.latestSignal,
      this.wallet.address
    );

    // Mount scout routes onto the base app
    this.app.use(scoutApp);

    // Start server
    this.start(config.SCOUT_PORT);

    // Start polling loop
    logInfo('scout', `Starting price scanner, interval ${config.SCOUT_POLL_INTERVAL}ms`);
    this.pollTimer = setInterval(async () => {
      const signal = await scanForOpportunity();
      if (signal) {
        this.latestSignal = signal;
        eventBus.emitDashboardEvent({
          type: 'signal_detected',
          data: signal,
          timestamp: signal.timestamp,
        });
      }
    }, config.SCOUT_POLL_INTERVAL);

    // Run once immediately
    const signal = await scanForOpportunity();
    if (signal) {
      this.latestSignal = signal;
      eventBus.emitDashboardEvent({
        type: 'signal_detected',
        data: signal,
        timestamp: signal.timestamp,
      });
    }
  }
}

const scout = new ScoutAgent();
scout.run().catch((err) => {
  logError('scout', 'Fatal error', err);
  process.exit(1);
});
