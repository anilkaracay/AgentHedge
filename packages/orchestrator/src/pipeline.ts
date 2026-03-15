import { logInfo, logError, eventBus, config } from '@agenthedge/shared';
import type { OpportunitySignal, ExecutionRecommendation, TradeResult } from '@agenthedge/shared';

const SCOUT_URL = `http://localhost:${config.SCOUT_PORT}`;
const ANALYST_URL = `http://localhost:${config.ANALYST_PORT}`;
const EXECUTOR_URL = `http://localhost:${config.EXECUTOR_PORT}`;
const TREASURY_URL = `http://localhost:${config.TREASURY_PORT}`;

let cycleCount = 0;

export async function runArbitrageCycle(): Promise<void> {
  cycleCount++;
  const cycleId = cycleCount;
  const startTime = Date.now();

  logInfo('orchestrator', `── Cycle #${cycleId} starting ──`);

  try {
    // Step 1: Check Scout for latest signal
    logInfo('orchestrator', 'Step 1: Checking Scout for opportunity signal');
    const scoutRes = await fetch(`${SCOUT_URL}/api/opportunity-signal`);

    if (scoutRes.status === 204 || scoutRes.status === 402) {
      logInfo('orchestrator', 'No opportunity signal available, skipping cycle');
      emitCycleComplete(cycleId, startTime, 'no_signal');
      return;
    }

    if (!scoutRes.ok) {
      logError('orchestrator', `Scout returned ${scoutRes.status}`);
      emitCycleComplete(cycleId, startTime, 'scout_error');
      return;
    }

    const signal = await scoutRes.json() as OpportunitySignal;
    logInfo('orchestrator', `Signal: ${signal.token}/USDC spread ${signal.spreadPercent}%`);

    // Step 2: Trigger Analyst analysis
    // Analyst will internally purchase the signal from Scout via x402
    logInfo('orchestrator', 'Step 2: Triggering Analyst analysis');
    const analystRes = await fetch(`${ANALYST_URL}/api/execution-recommendation`);

    if (analystRes.status === 204 || analystRes.status === 402) {
      logInfo('orchestrator', 'No recommendation available, skipping cycle');
      emitCycleComplete(cycleId, startTime, 'no_recommendation');
      return;
    }

    if (!analystRes.ok) {
      logError('orchestrator', `Analyst returned ${analystRes.status}`);
      emitCycleComplete(cycleId, startTime, 'analyst_error');
      return;
    }

    const recommendation = await analystRes.json() as ExecutionRecommendation;
    logInfo('orchestrator', `Recommendation: ${recommendation.action}, profit $${recommendation.estimatedProfit}`);

    if (recommendation.action === 'MONITOR') {
      logInfo('orchestrator', `Analyst says MONITOR: ${recommendation.reason}`);
      emitCycleComplete(cycleId, startTime, 'monitor');
      return;
    }

    if (recommendation.action === 'SKIP') {
      logInfo('orchestrator', `Analyst says SKIP: ${recommendation.reason}`);
      emitCycleComplete(cycleId, startTime, 'skip');
      return;
    }

    // Step 3: Trigger Executor
    // Executor will internally purchase recommendation from Analyst via x402,
    // check Treasury risk, and execute the trade
    logInfo('orchestrator', 'Step 3: Triggering Executor');
    const executorRes = await fetch(`${EXECUTOR_URL}/api/trade-result`);

    if (executorRes.status === 204) {
      logInfo('orchestrator', 'Executor has no trade result yet');
      emitCycleComplete(cycleId, startTime, 'no_trade');
      return;
    }

    if (!executorRes.ok) {
      logError('orchestrator', `Executor returned ${executorRes.status}`);
      emitCycleComplete(cycleId, startTime, 'executor_error');
      return;
    }

    const tradeResult = await executorRes.json() as TradeResult;
    logInfo('orchestrator', `Trade: ${tradeResult.status}`, {
      txHash: tradeResult.txHash,
      profit: tradeResult.realizedProfit,
    });

    // Step 4: Get portfolio update from Treasury
    logInfo('orchestrator', 'Step 4: Fetching portfolio update');
    try {
      const portfolioRes = await fetch(`${TREASURY_URL}/api/portfolio`);
      if (portfolioRes.ok) {
        const portfolio = await portfolioRes.json();
        logInfo('orchestrator', 'Portfolio updated', {
          totalValueUSD: portfolio.totalValueUSD,
          dailyPnL: portfolio.dailyPnL,
        });
      }
    } catch (err) {
      logError('orchestrator', 'Failed to fetch portfolio', err);
    }

    const result = tradeResult.status === 'EXECUTED' ? 'success' : tradeResult.status.toLowerCase();
    emitCycleComplete(cycleId, startTime, result);
  } catch (err) {
    logError('orchestrator', `Cycle #${cycleId} failed`, err);
    emitCycleComplete(cycleId, startTime, 'error');
  }
}

function emitCycleComplete(cycleId: number, startTime: number, result: string): void {
  const duration = Date.now() - startTime;
  logInfo('orchestrator', `── Cycle #${cycleId} complete: ${result} (${duration}ms) ──`);

  eventBus.emitDashboardEvent({
    type: 'cycle_complete',
    data: { cycleId, duration, result },
    timestamp: new Date().toISOString(),
  });
}
