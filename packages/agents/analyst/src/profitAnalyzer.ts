import { v4 as uuidv4 } from 'uuid';
import {
  getPrice,
  getCEXPrice,
  getSwapQuote,
  USDC_XLAYER,
  TRACKED_TOKENS,
  config,
  logInfo,
  logError,
} from '@agenthedge/shared';
import type { ArbitrageOpportunity, ExecutionRecommendation } from '@agenthedge/shared';

const MIN_NET_PROFIT_USDC = 0.10; // Low threshold for demo
const AGENT_FEES_USDC = 0.05;     // scout 0.02 + analyst 0.03

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function analyzeSignal(
  signal: ArbitrageOpportunity
): Promise<ExecutionRecommendation> {
  const now = Date.now();
  const expiresAt = new Date(signal.expiresAt).getTime();

  if (now > expiresAt) {
    logInfo('analyst', `Signal ${signal.id} expired`);
    return buildSkip(signal, 'Signal expired');
  }

  // Re-validate DEX price with fresh quote
  let currentDexPrice: number;
  let priceImpact = 0.1;
  let gasFee = '0';
  try {
    const tokenCfg = TRACKED_TOKENS.find(t => t.symbol === signal.token);
    if (!tokenCfg) return buildSkip(signal, `Unknown token ${signal.token}`);

    const quote = await getSwapQuote({
      chainIndex: '196',
      fromTokenAddress: signal.tokenAddress,
      toTokenAddress: USDC_XLAYER,
      amount: tokenCfg.quoteAmount,
      slippagePercent: '0.5',
    });
    const fromDec = parseInt(quote.fromToken?.decimal ?? String(tokenCfg.decimals));
    const toDec = parseInt(quote.toToken?.decimal ?? '6');
    currentDexPrice = (parseFloat(quote.toTokenAmount) / Math.pow(10, toDec)) /
                      (parseFloat(quote.fromTokenAmount) / Math.pow(10, fromDec));
    priceImpact = parseFloat(quote.priceImpactPercentage || '0.1');
    gasFee = quote.estimateGasFee;
  } catch (err) {
    logError('analyst', 'DEX re-validation failed', err);
    return buildSkip(signal, 'DEX price re-validation failed');
  }

  await sleep(1000);

  // Re-validate CEX price
  let currentCexPrice: number;
  try {
    const tokenCfg = TRACKED_TOKENS.find(t => t.symbol === signal.token);
    if (!tokenCfg) return buildSkip(signal, `Unknown token ${signal.token}`);
    const cexPoint = await getCEXPrice(tokenCfg);
    currentCexPrice = cexPoint.price;
  } catch (err) {
    logError('analyst', 'CEX re-validation failed', err);
    // Use original CEX price as fallback
    currentCexPrice = signal.cexPrice.price;
  }

  // Recalculate spread with fresh prices
  const freshSpread = Math.abs(currentCexPrice - currentDexPrice) / currentCexPrice * 100;

  // Check if spread has narrowed significantly
  if (freshSpread < signal.spreadPercent * 0.5) {
    logInfo('analyst', `Spread narrowed from ${signal.spreadPercent}% to ${freshSpread.toFixed(2)}%`);
    return buildSkip(signal, `Spread narrowed to ${freshSpread.toFixed(2)}%`);
  }

  const tradeAmountUSDC = config.MAX_TRADE_SIZE_USDC;
  const grossProfit = (freshSpread / 100) * tradeAmountUSDC;
  const slippageCost = (Math.max(priceImpact, 0.1) / 100) * tradeAmountUSDC;
  const netProfit = grossProfit - slippageCost - AGENT_FEES_USDC;

  logInfo('analyst', `${signal.token} analysis | spread: ${freshSpread.toFixed(2)}% | gross: $${grossProfit.toFixed(2)} | slip: $${slippageCost.toFixed(2)} | net: $${netProfit.toFixed(2)}`);

  const action = netProfit > MIN_NET_PROFIT_USDC && signal.confidence > 0.01
    ? 'EXECUTE' as const
    : 'SKIP' as const;

  const tokenCfg = TRACKED_TOKENS.find(t => t.symbol === signal.token);
  const suggestedAmount = tokenCfg?.quoteAmount ?? '1000000000000000000';

  const reason = action === 'EXECUTE'
    ? `CeDeFi arb: ${signal.token} spread ${freshSpread.toFixed(2)}%, net profit $${netProfit.toFixed(2)} (${signal.direction}). Theoretical — production requires CEX API for sell side.`
    : `Net profit $${netProfit.toFixed(2)} below threshold $${MIN_NET_PROFIT_USDC}`;

  return {
    id: uuidv4(),
    signalId: signal.id,
    action,
    confidence: signal.confidence,
    estimatedProfit: parseFloat(netProfit.toFixed(4)),
    estimatedSlippage: parseFloat(priceImpact.toFixed(4)),
    estimatedPriceImpact: priceImpact,
    suggestedAmount,
    suggestedMinOutput: '0',
    reason,
    timestamp: new Date().toISOString(),
  };
}

function buildSkip(signal: ArbitrageOpportunity, reason: string): ExecutionRecommendation {
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
