import { v4 as uuidv4 } from 'uuid';
import {
  scanAllVenues,
  estimateTradeCosts,
  formatProfitReport,
  getCostBreakdown,
  TRACKED_TOKENS,
  config,
  logInfo,
  logError,
} from '@agenthedge/shared';
import type { ArbitrageOpportunity, ExecutionRecommendation } from '@agenthedge/shared';

const MIN_NET_PROFIT_USDC = 0.01; // Low for demo — real would be higher

export async function analyzeSignal(
  signal: ArbitrageOpportunity
): Promise<ExecutionRecommendation> {
  if (Date.now() > new Date(signal.expiresAt).getTime()) {
    return buildSkip(signal, 'Signal expired');
  }

  const tokenCfg = TRACKED_TOKENS.find(t => t.symbol === signal.token);
  if (!tokenCfg) return buildSkip(signal, `Unknown token ${signal.token}`);

  // Re-scan for fresh prices
  let freshSignal = signal;
  try {
    const scan = await scanAllVenues(tokenCfg);
    freshSignal = { ...signal, buyVenue: scan.cheapest, sellVenue: scan.mostExpensive, allVenues: scan.venues, spreadPercent: scan.spreadPercent, spreadAbsolute: scan.spreadAbsolute };
  } catch {
    logInfo('analyst', 'Re-scan failed, using original signal');
  }

  // Estimate costs with full breakdown
  const costs = estimateTradeCosts(freshSignal, config.MAX_TRADE_SIZE_USDC);
  const breakdown = getCostBreakdown(costs);
  const report = formatProfitReport(costs, freshSignal.buyVenue.venue, freshSignal.sellVenue.venue, signal.token);

  logInfo('analyst', `\n${report}`);

  const action = costs.netProfit > MIN_NET_PROFIT_USDC ? 'EXECUTE' as const : 'SKIP' as const;

  const reason = `${freshSignal.buyVenue.venue} $${freshSignal.buyVenue.price.toFixed(2)} -> ${freshSignal.sellVenue.venue} $${freshSignal.sellVenue.price.toFixed(2)} | gross $${costs.grossProfit.toFixed(3)} | costs $${costs.totalCosts.toFixed(3)} | net $${costs.netProfit.toFixed(3)} (${costs.netProfitPercent.toFixed(2)}%)`;

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
