import { logInfo } from './logger.js';
import type { MultiVenueScan } from './types.js';

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
let demoCycleCount = 0;

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
      sessionPnL: 0,
      tradeCount: 0,
      profitableCount: 0,
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

/**
 * Inject a volatility spike in demo mode.
 * Cycle 1: ALWAYS spike (show immediate activity)
 * Every 3rd cycle: guaranteed spike
 * Otherwise: 20% random chance
 * Spread is widened to 0.55-0.85% — guaranteed profitable after fees.
 */
export function maybeInjectVolatilitySpike(scan: MultiVenueScan): MultiVenueScan {
  if (!isDemoMode()) return scan;

  demoCycleCount++;
  const shouldSpike = demoCycleCount === 1 || demoCycleCount % 3 === 0 || Math.random() < 0.20;
  if (!shouldSpike) return scan;

  // Target spread 0.55-0.85% — always above exchange fees (~0.4%)
  const targetSpreadPct = 0.55 + Math.random() * 0.30;
  const targetSpreadAbs = scan.mostExpensive.price * (targetSpreadPct / 100);
  const adjustedPrice = scan.mostExpensive.price - targetSpreadAbs;

  const spiked: MultiVenueScan = {
    ...scan,
    cheapest: { ...scan.cheapest, price: adjustedPrice },
    venues: scan.venues.map(v =>
      v.venue === scan.cheapest.venue ? { ...v, price: adjustedPrice } : v
    ).sort((a, b) => a.price - b.price),
    spreadAbsolute: parseFloat(targetSpreadAbs.toFixed(4)),
    spreadPercent: parseFloat(targetSpreadPct.toFixed(4)),
    scanDuration: scan.scanDuration,
    token: scan.token,
    timestamp: scan.timestamp,
  };
  spiked.cheapest = spiked.venues[0];
  spiked.mostExpensive = spiked.venues[spiked.venues.length - 1];

  logInfo('scout', `[DEMO] Volatility spike (cycle ${demoCycleCount}): spread ${targetSpreadPct.toFixed(2)}% ($${targetSpreadAbs.toFixed(2)})`);
  return spiked;
}
