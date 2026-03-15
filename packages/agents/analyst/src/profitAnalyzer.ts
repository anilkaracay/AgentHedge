import { v4 as uuidv4 } from 'uuid';
import {
  getTokenPrice,
  config,
  logInfo,
  logError,
} from '@agenthedge/shared';
import type { OpportunitySignal, ExecutionRecommendation } from '@agenthedge/shared';

const MIN_CONFIDENCE = 0.7;
const MIN_NET_PROFIT_USDC = 0.50;
const AGENT_FEES_USDC = 0.05; // scout 0.02 + analyst 0.03

export async function analyzeSignal(
  signal: OpportunitySignal
): Promise<ExecutionRecommendation> {
  const now = Date.now();
  const expiresAt = new Date(signal.expiresAt).getTime();

  // Check signal freshness
  if (now > expiresAt) {
    logInfo('analyst', `Signal ${signal.id} expired, skipping`);
    return buildSkip(signal, 'Signal expired');
  }

  // Re-validate current price
  let currentDexPrice: number;
  try {
    const priceData = await getTokenPrice('196', signal.fromToken);
    currentDexPrice = parseFloat(priceData.lastPrice);
  } catch (err) {
    logError('analyst', 'Failed to re-validate price', err);
    return buildSkip(signal, 'Price re-validation failed');
  }

  // Check if price has drifted significantly (>50% of original spread)
  const priceDrift = Math.abs(currentDexPrice - signal.dexPrice) / signal.dexPrice;
  if (priceDrift > signal.spreadPercent / 100 * 0.5) {
    logInfo('analyst', `Price drifted ${(priceDrift * 100).toFixed(2)}%, skipping`);
    return buildSkip(signal, `Price drifted ${(priceDrift * 100).toFixed(2)}% since signal`);
  }

  // Calculate trade size — use MAX_TRADE_SIZE_USDC from config
  const tradeAmountUSDC = config.MAX_TRADE_SIZE_USDC;

  // Estimated slippage: tradeAmount / volume24h * 100, capped at 2%
  const slippagePct = signal.volume24h > 0
    ? Math.min(2, (tradeAmountUSDC / signal.volume24h) * 100)
    : 2;

  // Estimated price impact: simplified model
  const priceImpactPct = signal.spreadPercent * 0.3;

  // Net profit calculation
  const grossProfit = (signal.spreadPercent / 100) * tradeAmountUSDC;
  const slippageCost = (slippagePct / 100) * tradeAmountUSDC;
  const priceImpactCost = (priceImpactPct / 100) * tradeAmountUSDC;
  const netProfit = grossProfit - slippageCost - priceImpactCost - AGENT_FEES_USDC;

  logInfo('analyst', 'Profitability analysis', {
    grossProfit: grossProfit.toFixed(4),
    slippageCost: slippageCost.toFixed(4),
    priceImpactCost: priceImpactCost.toFixed(4),
    agentFees: AGENT_FEES_USDC,
    netProfit: netProfit.toFixed(4),
    confidence: signal.confidence,
  });

  const action = netProfit > MIN_NET_PROFIT_USDC && signal.confidence > MIN_CONFIDENCE
    ? 'EXECUTE' as const
    : 'SKIP' as const;

  // Suggested amount in token base units (wei for ETH)
  const ethPrice = signal.dexPrice > 0 ? signal.dexPrice : 1;
  const tradeAmountETH = tradeAmountUSDC / ethPrice;
  const suggestedAmount = BigInt(Math.round(tradeAmountETH * 1e18)).toString();

  // Min output with slippage tolerance
  const expectedOutput = BigInt(Math.round(tradeAmountUSDC * 1e6)); // USDC 6 decimals
  const minOutput = expectedOutput - (expectedOutput * BigInt(Math.round(slippagePct * 100)) / 10000n);

  const reason = action === 'EXECUTE'
    ? `Net profit $${netProfit.toFixed(2)} exceeds minimum, confidence ${signal.confidence.toFixed(2)}`
    : `Net profit $${netProfit.toFixed(2)} below minimum $${MIN_NET_PROFIT_USDC} or confidence ${signal.confidence.toFixed(2)} < ${MIN_CONFIDENCE}`;

  return {
    id: uuidv4(),
    signalId: signal.id,
    action,
    confidence: signal.confidence,
    estimatedProfit: parseFloat(netProfit.toFixed(4)),
    estimatedSlippage: parseFloat(slippagePct.toFixed(4)),
    estimatedPriceImpact: parseFloat(priceImpactPct.toFixed(4)),
    suggestedAmount,
    suggestedMinOutput: minOutput.toString(),
    reason,
    timestamp: new Date().toISOString(),
  };
}

function buildSkip(signal: OpportunitySignal, reason: string): ExecutionRecommendation {
  return {
    id: uuidv4(),
    signalId: signal.id,
    action: 'SKIP',
    confidence: 0,
    estimatedProfit: 0,
    estimatedSlippage: 0,
    estimatedPriceImpact: 0,
    suggestedAmount: '0',
    suggestedMinOutput: '0',
    reason,
    timestamp: new Date().toISOString(),
  };
}
