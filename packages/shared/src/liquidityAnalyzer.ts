import { getSwapQuote } from './onchainOS.js';
import { USDC_XLAYER } from './tokenRegistry.js';
import { logInfo } from './logger.js';
import type { ArbitrageOpportunity } from './types.js';
import { FEE_STRUCTURE } from './profitCalculator.js';

export interface LiquidityProbe {
  sizeUSD: number;
  sizeToken: number;
  priceImpact: number;
  netProfit: number;
  profitable: boolean;
}

export interface OptimalTradeSize {
  sizeUSD: number;
  sizeToken: number;
  impact: number;
  expectedNetProfit: number;
  profitPerDollar: number;
  reason: string;
  probes: LiquidityProbe[];
}

const PROBE_SIZES = [1000, 2500, 5000, 10000, 15000, 25000, 50000];

/**
 * Probe DEX liquidity at increasing sizes to find the optimal trade amount.
 * Uses REAL OnchainOS aggregator/quote calls — only execution is simulated.
 */
export async function findOptimalTradeSize(
  opportunity: ArbitrageOpportunity,
  maxCapitalPerVenue: number = 50000
): Promise<OptimalTradeSize> {
  const dexVenue = [opportunity.buyVenue, opportunity.sellVenue].find(v => v.venueType === 'dex');
  if (!dexVenue) {
    // Both CEX — use max capital
    const size = Math.min(maxCapitalPerVenue, 25000);
    return { sizeUSD: size, sizeToken: size / opportunity.buyVenue.price, impact: 0, expectedNetProfit: 0, profitPerDollar: 0, reason: 'CEX-CEX pair, no DEX impact', probes: [] };
  }

  const tokenAddress = opportunity.tokenAddress;
  const probes: LiquidityProbe[] = [];
  let bestSize = PROBE_SIZES[0];
  let bestProfit = -Infinity;

  for (const sizeUSD of PROBE_SIZES) {
    if (sizeUSD > maxCapitalPerVenue) break;

    const sizeToken = sizeUSD / opportunity.buyVenue.price;
    const tokenAmountRaw = BigInt(Math.floor(sizeToken * 1e18)).toString();

    let priceImpact = 0;
    try {
      const quote = await getSwapQuote({
        chainIndex: '196',
        fromTokenAddress: tokenAddress,
        toTokenAddress: USDC_XLAYER,
        amount: tokenAmountRaw,
        slippagePercent: '1',
      });
      priceImpact = parseFloat(quote.priceImpactPercentage || '0');
    } catch {
      // Too large for liquidity — stop probing
      break;
    }

    // Calculate net profit at this size
    const spreadAfterImpact = opportunity.spreadPercent - priceImpact;
    const grossProfit = (spreadAfterImpact / 100) * sizeUSD;
    const buyFeeRate = FEE_STRUCTURE.takerFees[opportunity.buyVenue.venue] ?? 0.002;
    const sellFeeRate = FEE_STRUCTURE.takerFees[opportunity.sellVenue.venue] ?? 0.002;
    const fees = sizeUSD * buyFeeRate + sizeUSD * sellFeeRate + 0.05;
    const netProfit = grossProfit - fees;
    const profitable = netProfit > 0;

    probes.push({ sizeUSD, sizeToken, priceImpact, netProfit: parseFloat(netProfit.toFixed(2)), profitable });

    if (netProfit > bestProfit) {
      bestProfit = netProfit;
      bestSize = sizeUSD;
    }
  }

  // Log probe results
  for (const p of probes) {
    const icon = p.profitable ? '\u2713' : '\u2717';
    logInfo('liquidity', `  $${String(p.sizeUSD).padEnd(7)} impact ${p.priceImpact.toFixed(2).padEnd(6)}%  profit $${p.netProfit.toFixed(2).padStart(8)}  ${icon}${p.sizeUSD === bestSize ? '  << OPTIMAL' : ''}`);
  }

  const bestProbe = probes.find(p => p.sizeUSD === bestSize);
  const impact = bestProbe?.priceImpact ?? 0;

  // Add some variance (+-15%) so trades aren't identical
  const variance = 0.85 + Math.random() * 0.30;
  const finalSize = Math.round(bestSize * variance / 100) * 100; // round to nearest $100
  const finalToken = finalSize / opportunity.buyVenue.price;

  return {
    sizeUSD: finalSize,
    sizeToken: parseFloat(finalToken.toFixed(4)),
    impact,
    expectedNetProfit: bestProfit * (finalSize / bestSize),
    profitPerDollar: bestProfit / bestSize,
    reason: impact > 0.3
      ? `DEX liquidity limits to $${finalSize.toLocaleString()} (${impact.toFixed(2)}% impact)`
      : `Optimal $${finalSize.toLocaleString()} (${impact.toFixed(2)}% impact)`,
    probes,
  };
}
