import { v4 as uuidv4 } from 'uuid';
import {
  scanAllVenues,
  TRACKED_TOKENS,
  config,
  logInfo,
  logError,
} from '@agenthedge/shared';
import type { ArbitrageOpportunity } from '@agenthedge/shared';

/**
 * Scan ALL venues simultaneously for each tracked token.
 * Returns the opportunity with the highest cross-venue spread.
 */
export async function scanForOpportunity(): Promise<ArbitrageOpportunity | null> {
  const opportunities: ArbitrageOpportunity[] = [];

  // Scan each token (sequentially to avoid API rate limits across tokens)
  for (const token of TRACKED_TOKENS) {
    try {
      const scan = await scanAllVenues(token);

      if (scan.spreadPercent <= config.SPREAD_THRESHOLD * 100) {
        logInfo('scout', `${token.symbol}: spread ${scan.spreadPercent}% below threshold ${config.SPREAD_THRESHOLD * 100}%`);
        continue;
      }

      const now = new Date();
      opportunities.push({
        id: uuidv4(),
        token: token.symbol,
        tokenAddress: token.xlayerAddress,
        buyVenue: scan.cheapest,
        sellVenue: scan.mostExpensive,
        allVenues: scan.venues,
        spreadPercent: scan.spreadPercent,
        spreadAbsolute: scan.spreadAbsolute,
        venuesScanned: TRACKED_TOKENS.length * 8, // 7 CEX + 1 DEX
        venuesResponded: scan.venues.length,
        scanDuration: scan.scanDuration,
        confidence: Math.min(1, scan.spreadPercent / 1.0),
        timestamp: now.toISOString(),
        expiresAt: new Date(now.getTime() + 30_000).toISOString(),
      });
    } catch (err) {
      logError('scout', `Scan failed for ${token.symbol}`, err);
    }
  }

  if (opportunities.length === 0) {
    logInfo('scout', 'No arbitrage opportunities above threshold');
    return null;
  }

  // Return the opportunity with highest spread
  opportunities.sort((a, b) => b.spreadPercent - a.spreadPercent);
  const best = opportunities[0];
  logInfo('scout', `Best: ${best.token} ${best.spreadPercent}% — BUY @ ${best.buyVenue.venue} ($${best.buyVenue.price.toFixed(4)}), SELL @ ${best.sellVenue.venue} ($${best.sellVenue.price.toFixed(4)})`);
  return best;
}
