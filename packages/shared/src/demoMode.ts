import { logInfo } from './logger.js';
import type { MultiVenueScan } from './types.js';

// ── Demo Portfolio ──

export interface VenueBalance {
  venue: string;
  okbBalance: number;
  usdtBalance: number;
  totalUSD: number;
}

export interface DemoPortfolio {
  venues: VenueBalance[];
  totalCapital: number;
  totalOKB: number;
  totalUSDT: number;
  sessionPnL: number;
  tradeCount: number;
  profitableCount: number;
}

const INITIAL_PER_VENUE = { okb: 520, usdt: 50000 };
let demoPortfolio: DemoPortfolio | null = null;

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

export function getDemoPortfolio(): DemoPortfolio {
  if (!demoPortfolio) {
    const venues: VenueBalance[] = [
      'xlayer-dex', 'okx', 'binance', 'gateio', 'mexc', 'bybit', 'kucoin', 'htx',
    ].map(v => ({
      venue: v,
      okbBalance: INITIAL_PER_VENUE.okb,
      usdtBalance: INITIAL_PER_VENUE.usdt,
      totalUSD: INITIAL_PER_VENUE.okb * 96 + INITIAL_PER_VENUE.usdt,
    }));
    demoPortfolio = {
      venues,
      totalCapital: venues.reduce((s, v) => s + v.totalUSD, 0),
      totalOKB: venues.reduce((s, v) => s + v.okbBalance, 0),
      totalUSDT: venues.reduce((s, v) => s + v.usdtBalance, 0),
      sessionPnL: 0, tradeCount: 0, profitableCount: 0,
    };
  }
  return demoPortfolio;
}

export function updateDemoBalance(buyVenue: string, sellVenue: string, okbAmount: number, usdtAmount: number, netProfit: number): void {
  const p = getDemoPortfolio();
  const buy = p.venues.find(v => v.venue === buyVenue);
  const sell = p.venues.find(v => v.venue === sellVenue);
  if (buy) { buy.usdtBalance -= usdtAmount; buy.okbBalance += okbAmount; }
  if (sell) { sell.okbBalance -= okbAmount; sell.usdtBalance += usdtAmount + netProfit; }
  p.sessionPnL += netProfit;
  p.tradeCount++;
  if (netProfit > 0) p.profitableCount++;
  p.totalOKB = p.venues.reduce((s, v) => s + v.okbBalance, 0);
  p.totalUSDT = p.venues.reduce((s, v) => s + v.usdtBalance, 0);
  p.totalCapital = p.venues.reduce((s, v) => s + v.okbBalance * 96 + v.usdtBalance, 0);
}

// ── Market Microstructure Simulation ──
// Simulates realistic venue latency and noise that creates arbitrage opportunities.
// Based on real market dynamics: fast venues reflect price moves first, slow venues lag.

interface VenueLatencyProfile {
  venue: string;
  latencyMs: number;
  noisePercent: number;
}

const VENUE_PROFILES: VenueLatencyProfile[] = [
  { venue: 'okx',        latencyMs: 100,  noisePercent: 0.03 },
  { venue: 'binance',    latencyMs: 150,  noisePercent: 0.03 },
  { venue: 'bybit',      latencyMs: 200,  noisePercent: 0.05 },
  { venue: 'gateio',     latencyMs: 500,  noisePercent: 0.08 },
  { venue: 'kucoin',     latencyMs: 500,  noisePercent: 0.08 },
  { venue: 'mexc',       latencyMs: 800,  noisePercent: 0.10 },
  { venue: 'htx',        latencyMs: 1000, noisePercent: 0.12 },
  { venue: 'xlayer-dex', latencyMs: 3000, noisePercent: 0.15 },
];

/**
 * Apply realistic market microstructure to venue prices.
 * Simulates: base price movement + venue-specific latency + random noise.
 * This is how real arbitrage opportunities form — venue latency differences.
 */
export function applyMarketMicrostructure(scan: MultiVenueScan): MultiVenueScan {
  if (!isDemoMode()) return scan;

  // Base market movement: random walk ±0.4% (normal crypto market activity)
  const baseMovement = (Math.random() - 0.5) * 0.008;

  const adjustedVenues = scan.venues.map(venue => {
    const profile = VENUE_PROFILES.find(p => p.venue === venue.venue);
    if (!profile) return venue;

    // Latency factor: fast venues reflect more of the movement
    const latencyFactor = 1 - (profile.latencyMs / 5000);
    const reflected = baseMovement * latencyFactor;

    // Venue-specific noise (market maker spread, random fills)
    const noise = (Math.random() - 0.5) * 2 * (profile.noisePercent / 100);

    return { ...venue, price: venue.price * (1 + reflected + noise) };
  });

  adjustedVenues.sort((a, b) => a.price - b.price);
  const cheapest = adjustedVenues[0];
  const mostExpensive = adjustedVenues[adjustedVenues.length - 1];
  const spreadAbsolute = mostExpensive.price - cheapest.price;
  const spreadPercent = parseFloat(((spreadAbsolute / mostExpensive.price) * 100).toFixed(4));

  const baseDir = baseMovement >= 0 ? '+' : '';
  logInfo('scout', `[MICROSTRUCTURE] base ${baseDir}${(baseMovement * 100).toFixed(2)}% | spread ${scan.spreadPercent.toFixed(2)}% -> ${spreadPercent.toFixed(2)}% | ${cheapest.venue} $${cheapest.price.toFixed(2)} -> ${mostExpensive.venue} $${mostExpensive.price.toFixed(2)}`);

  return {
    ...scan,
    venues: adjustedVenues,
    cheapest,
    mostExpensive,
    spreadAbsolute: parseFloat(spreadAbsolute.toFixed(4)),
    spreadPercent,
  };
}

// Legacy compat — old function name redirects to new
export function maybeInjectVolatilitySpike(scan: MultiVenueScan): MultiVenueScan {
  return applyMarketMicrostructure(scan);
}
