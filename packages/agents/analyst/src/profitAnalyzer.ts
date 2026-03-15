import { v4 as uuidv4 } from 'uuid';
import {
  scanAllVenues,
  estimateTradeCosts,
  calculateMinProfitableSize,
  formatProfitReport,
  TRACKED_TOKENS,
  config,
  logInfo,
  logError,
} from '@agenthedge/shared';
import type { ArbitrageOpportunity, ExecutionRecommendation } from '@agenthedge/shared';

export async function analyzeSignal(
  signal: ArbitrageOpportunity
): Promise<ExecutionRecommendation> {
  if (Date.now() > new Date(signal.expiresAt).getTime()) {
    return buildSkip(signal, 'Signal expired');
  }

  const tokenCfg = TRACKED_TOKENS.find(t => t.symbol === signal.token);
  if (!tokenCfg) return buildSkip(signal, `Unknown token ${signal.token}`);

  // Re-scan for fresh prices
  let freshOpp = signal;
  try {
    const scan = await scanAllVenues(tokenCfg);
    freshOpp = { ...signal, buyVenue: scan.cheapest, sellVenue: scan.mostExpensive, allVenues: scan.venues, spreadPercent: scan.spreadPercent, spreadAbsolute: scan.spreadAbsolute };
  } catch {
    logInfo('analyst', 'Re-scan failed, using original signal');
  }

  // Calculate minimum profitable trade size
  const sizing = calculateMinProfitableSize(freshOpp);
  logInfo('analyst', `Trade sizing: min $${sizing.minSizeUSD} | optimal $${sizing.optimalSizeUSD} | profit @ optimal $${sizing.profitAtOptimal.toFixed(3)}`);

  // Use optimal trade size (capped by config)
  const tradeSize = Math.min(sizing.optimalSizeUSD, config.MAX_TRADE_SIZE_USDC);

  // Estimate costs with correct transfer fees
  const costs = estimateTradeCosts(freshOpp, tradeSize);
  const report = formatProfitReport(costs, freshOpp.buyVenue.venue, freshOpp.sellVenue.venue, signal.token);
  logInfo('analyst', `\n${report}`);

  // Three-way decision: EXECUTE / MONITOR / SKIP
  const hasSpread = freshOpp.spreadPercent > 0.05;
  const action: 'EXECUTE' | 'MONITOR' | 'SKIP' = costs.profitable
    ? 'EXECUTE'
    : hasSpread
      ? 'MONITOR'
      : 'SKIP';

  const costCoverage = costs.grossProfit > 0 ? (costs.grossProfit / costs.totalCosts * 100).toFixed(0) : '0';
  const reason = action === 'EXECUTE'
    ? `${freshOpp.buyVenue.venue} $${freshOpp.buyVenue.price.toFixed(2)} -> ${freshOpp.sellVenue.venue} $${freshOpp.sellVenue.price.toFixed(2)} | net $${costs.netProfit.toFixed(3)} (${costs.netProfitPercent.toFixed(2)}%) | transfer: ${costs.transferNote}`
    : action === 'MONITOR'
      ? `Spread ${freshOpp.spreadPercent.toFixed(2)}% covers ${costCoverage}% of costs. Profitable at ~${(costs.totalCosts / (tradeSize || 500) * 100).toFixed(2)}% spread. Min trade: $${sizing.minSizeUSD === Infinity ? 'N/A (fees > spread)' : sizing.minSizeUSD.toFixed(0)}`
      : `No meaningful spread (${freshOpp.spreadPercent.toFixed(4)}%)`;

  return {
    id: uuidv4(),
    signalId: signal.id,
    action,
    confidence: signal.confidence,
    estimatedProfit: costs.netProfit,
    estimatedSlippage: costs.buySlippage + costs.sellSlippage,
    estimatedPriceImpact: costs.buyExchangeFee + costs.sellExchangeFee,
    suggestedAmount: tokenCfg.quoteAmount,
    suggestedMinOutput: '0',
    reason,
    timestamp: new Date().toISOString(),
  };
}

function buildSkip(signal: ArbitrageOpportunity, reason: string): ExecutionRecommendation {
  return {
    id: uuidv4(), signalId: signal.id, action: 'SKIP', confidence: 0,
    estimatedProfit: 0, estimatedSlippage: 0, estimatedPriceImpact: 0,
    suggestedAmount: '0', suggestedMinOutput: '0', reason,
    timestamp: new Date().toISOString(),
  };
}
