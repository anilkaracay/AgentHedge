import { v4 as uuidv4 } from 'uuid';
import {
  scanAllVenues,
  TRACKED_TOKENS,
  config,
  logInfo,
  logError,
} from '@agenthedge/shared';
import type { ArbitrageOpportunity, ExecutionRecommendation } from '@agenthedge/shared';

const MIN_NET_PROFIT_USDC = 0.10;
const AGENT_FEES_USDC = 0.05;

export async function analyzeSignal(
  signal: ArbitrageOpportunity
): Promise<ExecutionRecommendation> {
  if (Date.now() > new Date(signal.expiresAt).getTime()) {
    logInfo('analyst', `Signal ${signal.id} expired`);
    return buildSkip(signal, 'Signal expired');
  }

  // Re-scan all venues for fresh prices
  const tokenCfg = TRACKED_TOKENS.find(t => t.symbol === signal.token);
  if (!tokenCfg) return buildSkip(signal, `Unknown token ${signal.token}`);

  let freshScan;
  try {
    freshScan = await scanAllVenues(tokenCfg);
  } catch (err) {
    logError('analyst', 'Re-scan failed', err);
    return buildSkip(signal, 'Price re-validation failed');
  }

  const freshSpread = freshScan.spreadPercent;

  // Check if spread narrowed significantly
  if (freshSpread < signal.spreadPercent * 0.3) {
    return buildSkip(signal, `Spread narrowed from ${signal.spreadPercent.toFixed(2)}% to ${freshSpread.toFixed(2)}%`);
  }

  const tradeAmountUSDC = config.MAX_TRADE_SIZE_USDC;
  const grossProfit = (freshSpread / 100) * tradeAmountUSDC;

  // Costs depend on which venues are involved
  const buyIsDEX = freshScan.cheapest.venueType === 'dex';
  const sellIsDEX = freshScan.mostExpensive.venueType === 'dex';
  const dexSlippage = 0.1; // ~0.1% on X Layer DEX
  const dexCost = (buyIsDEX || sellIsDEX) ? (dexSlippage / 100) * tradeAmountUSDC : 0;
  const netProfit = grossProfit - dexCost - AGENT_FEES_USDC;

  // Determine execution note
  let execNote: string;
  if (buyIsDEX && !sellIsDEX) {
    execNote = `Buy on X Layer DEX @ $${freshScan.cheapest.price.toFixed(2)}, sell on ${freshScan.mostExpensive.venue} CEX @ $${freshScan.mostExpensive.price.toFixed(2)}`;
  } else if (!buyIsDEX && sellIsDEX) {
    execNote = `Buy on ${freshScan.cheapest.venue} CEX @ $${freshScan.cheapest.price.toFixed(2)}, sell on X Layer DEX @ $${freshScan.mostExpensive.price.toFixed(2)}`;
  } else {
    execNote = `CEX-CEX: Buy @ ${freshScan.cheapest.venue} $${freshScan.cheapest.price.toFixed(2)}, Sell @ ${freshScan.mostExpensive.venue} $${freshScan.mostExpensive.price.toFixed(2)}`;
  }

  const action = netProfit > MIN_NET_PROFIT_USDC ? 'EXECUTE' as const : 'SKIP' as const;

  logInfo('analyst', `${signal.token}: spread ${freshSpread.toFixed(2)}% | gross $${grossProfit.toFixed(2)} | net $${netProfit.toFixed(2)} | ${action} | ${execNote}`);

  return {
    id: uuidv4(),
    signalId: signal.id,
    action,
    confidence: signal.confidence,
    estimatedProfit: parseFloat(netProfit.toFixed(4)),
    estimatedSlippage: dexSlippage,
    estimatedPriceImpact: dexSlippage,
    suggestedAmount: tokenCfg.quoteAmount,
    suggestedMinOutput: '0',
    reason: `${execNote}. Net $${netProfit.toFixed(2)} (${freshScan.venues.length} venues, ${freshScan.scanDuration}ms scan)`,
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
