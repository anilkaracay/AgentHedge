import { v4 as uuidv4 } from 'uuid';
import {
  getPrice,
  getCEXPrice,
  TRACKED_TOKENS,
  USDC_XLAYER,
  config,
  logInfo,
  logError,
} from '@agenthedge/shared';
import type { ArbitrageOpportunity, TokenConfig } from '@agenthedge/shared';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Scan a single token for CeDeFi arbitrage opportunity.
 * Compares X Layer DEX price (OnchainOS aggregator/quote) vs CEX spot price (OKX/Binance).
 */
async function scanToken(token: TokenConfig): Promise<ArbitrageOpportunity | null> {
  try {
    // Get DEX price from X Layer via OnchainOS aggregator/quote
    const dexResult = await getPrice('196', token.xlayerAddress, USDC_XLAYER, token.quoteAmount);
    const dexPrice = dexResult.price;

    await sleep(1000); // Rate limit spacing

    // Get CEX spot price (OKX -> Binance -> Ethereum DEX fallback)
    const cexPoint = await getCEXPrice(token);
    const cexPrice = cexPoint.price;

    if (cexPrice === 0 || dexPrice === 0) return null;

    const spreadPercent = Math.abs(cexPrice - dexPrice) / cexPrice * 100;
    const spreadAbsolute = Math.abs(cexPrice - dexPrice);
    const direction = dexPrice < cexPrice ? 'BUY_DEX_SELL_CEX' as const : 'BUY_CEX_SELL_DEX' as const;

    logInfo('scout', `${token.symbol}/USDC | DEX: $${dexPrice.toFixed(4)} | CEX(${cexPoint.source}): $${cexPrice.toFixed(4)} | Spread: ${spreadPercent.toFixed(4)}% | ${direction}`);

    if (spreadPercent <= config.SPREAD_THRESHOLD * 100) {
      return null;
    }

    const now = new Date();
    return {
      id: uuidv4(),
      token: token.symbol,
      tokenAddress: token.xlayerAddress,
      dexPrice: { source: 'xlayer-dex', price: dexPrice, timestamp: now.toISOString() },
      cexPrice: cexPoint,
      spreadPercent: parseFloat(spreadPercent.toFixed(4)),
      spreadAbsolute: parseFloat(spreadAbsolute.toFixed(6)),
      direction,
      confidence: Math.min(1, spreadPercent / 1.0),
      timestamp: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    };
  } catch (err) {
    logError('scout', `Scan failed for ${token.symbol}`, err);
    return null;
  }
}

/**
 * Scan all tracked tokens and return the best arbitrage opportunity.
 */
export async function scanForOpportunity(): Promise<ArbitrageOpportunity | null> {
  const results: ArbitrageOpportunity[] = [];

  for (const token of TRACKED_TOKENS) {
    const opp = await scanToken(token);
    if (opp) results.push(opp);
    await sleep(1500); // Rate limit between tokens
  }

  if (results.length === 0) {
    logInfo('scout', 'No arbitrage opportunities found across tracked tokens');
    return null;
  }

  // Return the opportunity with highest spread
  results.sort((a, b) => b.spreadPercent - a.spreadPercent);
  const best = results[0];
  logInfo('scout', `Best opportunity: ${best.token} spread ${best.spreadPercent}% (${best.direction})`);
  return best;
}
