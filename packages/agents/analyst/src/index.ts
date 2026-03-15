import {
  AgentBase,
  config,
  logInfo,
  logError,
  eventBus,
} from '@agenthedge/shared';
import type { AgentConfig, OpportunitySignal, ExecutionRecommendation } from '@agenthedge/shared';
import { analyzeSignal } from './profitAnalyzer.js';
import { createAnalystServer } from './server.js';

class AnalystAgent extends AgentBase {
  private latestRecommendation: ExecutionRecommendation | null = null;

  constructor() {
    const agentConfig: AgentConfig = {
      agentId: 'analyst',
      role: 'analyst',
      privateKey: config.ANALYST_PK,
      port: config.ANALYST_PORT,
      endpoint: `http://localhost:${config.ANALYST_PORT}`,
      pricePerRequest: 0.03,
    };
    super(agentConfig);
  }

  async run(): Promise<void> {
    // Register on-chain
    try {
      await this.registerSelf();
    } catch (err) {
      logError('analyst', 'On-chain registration failed, continuing anyway', err);
    }

    // Set up x402-protected server
    const analystApp = createAnalystServer(
      () => this.latestRecommendation,
      this.wallet.address
    );
    this.app.use(analystApp);

    // Start server
    this.start(config.ANALYST_PORT);

    // Start analysis loop
    logInfo('analyst', `Starting analysis loop, interval ${config.SCOUT_POLL_INTERVAL * 2}ms`);
    setInterval(() => { void this.analysisCycle(); }, config.SCOUT_POLL_INTERVAL * 2);

    // Run once immediately
    await this.analysisCycle();
  }

  private async analysisCycle(): Promise<void> {
    try {
      // Purchase signal from Scout via x402
      const signal = await this.callAgent<OpportunitySignal>(
        'scout',
        '/api/opportunity-signal'
      );

      if (!signal || !signal.id) {
        logInfo('analyst', 'No signal available from Scout');
        return;
      }

      logInfo('analyst', `Received signal ${signal.id}, analyzing...`);

      // Analyze profitability
      const recommendation = await analyzeSignal(signal);
      this.latestRecommendation = recommendation;

      logInfo('analyst', `Analysis complete: ${recommendation.action}`, {
        signalId: recommendation.signalId,
        netProfit: recommendation.estimatedProfit,
        reason: recommendation.reason,
      });

      eventBus.emitDashboardEvent({
        type: 'analysis_complete',
        data: recommendation,
        timestamp: recommendation.timestamp,
      });
    } catch (err) {
      logError('analyst', 'Analysis cycle failed', err);
    }
  }
}

const analyst = new AnalystAgent();
analyst.run().catch((err) => {
  logError('analyst', 'Fatal error', err);
  process.exit(1);
});
