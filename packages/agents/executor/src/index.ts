import {
  AgentBase,
  config,
  logInfo,
  logError,
  eventBus,
} from '@agenthedge/shared';
import type {
  AgentConfig,
  ExecutionRecommendation,
  TradeResult,
  RiskApproval,
} from '@agenthedge/shared';
import { executeTrade } from './tradeExecutor.js';
import { createExecutorServer } from './server.js';

const NATIVE_TOKEN = config.NATIVE_TOKEN_ADDRESS;

class ExecutorAgent extends AgentBase {
  private latestResult: TradeResult | null = null;

  constructor() {
    const agentConfig: AgentConfig = {
      agentId: 'executor',
      role: 'executor',
      privateKey: config.EXECUTOR_PK,
      port: config.EXECUTOR_PORT,
      endpoint: `http://localhost:${config.EXECUTOR_PORT}`,
      pricePerRequest: 0,
    };
    super(agentConfig);
  }

  async run(): Promise<void> {
    // Register on-chain
    try {
      await this.registerSelf();
    } catch (err) {
      logError('executor', 'On-chain registration failed, continuing anyway', err);
    }

    // Set up server (internal, no x402)
    const executorApp = createExecutorServer(() => this.latestResult);
    this.app.use(executorApp);

    // Start server
    this.start(config.EXECUTOR_PORT);
  }

  async executeFromRecommendation(): Promise<TradeResult | null> {
    try {
      // Step 1: Get recommendation from Analyst via x402
      const rec = await this.callAgent<ExecutionRecommendation>(
        'analyst',
        '/api/execution-recommendation'
      );

      if (!rec || !rec.id) {
        logInfo('executor', 'No recommendation available from Analyst');
        return null;
      }

      if (rec.action !== 'EXECUTE') {
        logInfo('executor', `Analyst says SKIP: ${rec.reason}`);
        return null;
      }

      logInfo('executor', `Recommendation ${rec.id}: EXECUTE, profit $${rec.estimatedProfit}`);

      // Step 2: Check with Treasury for risk approval (direct HTTP, no x402)
      const treasuryUrl = `http://localhost:${config.TREASURY_PORT}/api/risk-check`;
      const riskRes = await fetch(treasuryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: rec.suggestedAmount }),
      });

      if (!riskRes.ok) {
        logError('executor', `Treasury risk check failed: ${riskRes.status}`);
        return null;
      }

      const riskApproval = await riskRes.json() as RiskApproval;
      if (!riskApproval.approved) {
        logInfo('executor', `Treasury denied: ${riskApproval.reason}`);
        return null;
      }

      // Step 3: Execute trade
      const result = await executeTrade(
        rec,
        this.wallet,
        NATIVE_TOKEN,
        config.USDC_ADDRESS
      );

      this.latestResult = result;

      // Step 4: Record on-chain
      try {
        if (result.status === 'EXECUTED') {
          await this.registry.recordSuccess(this.agentId);
        } else {
          await this.registry.recordFailure(this.agentId);
        }
      } catch (err) {
        logError('executor', 'Failed to record result on-chain', err);
      }

      // Step 5: Emit dashboard event
      eventBus.emitDashboardEvent({
        type: 'trade_executed',
        data: result,
        timestamp: result.timestamp,
      });

      // Step 6: Report result to Treasury
      try {
        await fetch(`http://localhost:${config.TREASURY_PORT}/api/trade-result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(result),
        });
      } catch (err) {
        logError('executor', 'Failed to report result to Treasury', err);
      }

      return result;
    } catch (err) {
      logError('executor', 'Execute from recommendation failed', err);
      return null;
    }
  }
}

const executor = new ExecutorAgent();
export { executor };

executor.run().catch((err) => {
  logError('executor', 'Fatal error', err);
  process.exit(1);
});
