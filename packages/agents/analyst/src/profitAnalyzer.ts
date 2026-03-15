import { v4 as uuidv4 } from 'uuid';
import {
  getSwapQuote,
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

  // Re-validate price via a fresh aggregator quote
  let currentDexPrice: number;
  let priceImpactPct: number;
  let gasFee: string;
  try {
    const quote = await getSwapQuote({
      chainIndex: config.XLAYER_CHAIN_INDEX,
      fromTokenAddress: signal.fromToken,
      toTokenAddress: signal.toToken,
      amount: '1000000000000000', // 0.001 ETH
      slippagePercent: '0.5',
    });

    const fromDec = parseInt(quote.fromToken?.decimal ?? '18');
    const toDec = parseInt(quote.toToken?.decimal ?? '6');
    const fromAmt = parseFloat(quote.fromTokenAmount) / Math.pow(10, fromDec);
    const toAmt = parseFloat(quote.toTokenAmount) / Math.pow(10, toDec);
    currentDexPrice = fromAmt > 0 ? toAmt / fromAmt : 0;
    priceImpactPct = parseFloat(quote.priceImpactPercentage || '0');
    gasFee = quote.estimateGasFee;
  } catch (err) {
    logError('analyst', 'Failed to re-validate price via quote', err);
    return buildSkip(signal, 'Price re-validation failed');
  }

  // Check if price has drifted significantly (>50% of original spread)
  const priceDrift = Math.abs(currentDexPrice - signal.dexPrice) / signal.dexPrice;
  if (priceDrift > signal.spreadPercent / 100 * 0.5) {
    logInfo('analyst', `Price drifted ${(priceDrift * 100).toFixed(2)}%, skipping`);
    return buildSkip(signal, `Price drifted ${(priceDrift * 100).toFixed(2)}% since signal`);
  }

  // Calculate trade size
  const tradeAmountUSDC = config.MAX_TRADE_SIZE_USDC;

  // Use priceImpact directly from the quote (real on-chain data)
  const slippagePct = Math.max(priceImpactPct, 0.1); // at least 0.1% for safety

  // Net profit calculation
  const grossProfit = (signal.spreadPercent / 100) * tradeAmountUSDC;
  const slippageCost = (slippagePct / 100) * tradeAmountUSDC;
  const gasCostUSD = parseFloat(gasFee) * 0.000001; // rough gas→USD (near zero on X Layer)
  const netProfit = grossProfit - slippageCost - gasCostUSD - AGENT_FEES_USDC;

  logInfo('analyst', 'Profitability analysis', {
    grossProfit: grossProfit.toFixed(4),
    slippageCost: slippageCost.toFixed(4),
    gasCostUSD: gasCostUSD.toFixed(4),
    agentFees: AGENT_FEES_USDC,
    netProfit: netProfit.toFixed(4),
    priceImpact: priceImpactPct,
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
