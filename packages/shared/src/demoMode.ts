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
const SPIKE_PROB = parseFloat(process.env.DEMO_SPIKE_PROBABILITY ?? '0.12');

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
  // Recalc totals
  p.totalOKB = p.venues.reduce((s, v) => s + v.okbBalance, 0);
  p.totalUSDT = p.venues.reduce((s, v) => s + v.usdtBalance, 0);
  p.totalCapital = p.venues.reduce((s, v) => s + v.okbBalance * 96 + v.usdtBalance, 0);
}

export function maybeInjectVolatilitySpike(scan: MultiVenueScan): MultiVenueScan {
  if (!isDemoMode()) return scan;
  if (Math.random() >= SPIKE_PROB) return scan;

  const spikePercent = 0.003 + Math.random() * 0.004; // 0.3-0.7%
  const spikeAmount = spikePercent * scan.cheapest.price;

  const spiked: MultiVenueScan = {
    ...scan,
    cheapest: { ...scan.cheapest, price: scan.cheapest.price - spikeAmount },
    venues: scan.venues.map(v =>
      v.venue === scan.cheapest.venue ? { ...v, price: v.price - spikeAmount } : v
    ),
  };
  spiked.venues.sort((a, b) => a.price - b.price);
  spiked.cheapest = spiked.venues[0];
  spiked.mostExpensive = spiked.venues[spiked.venues.length - 1];
  spiked.spreadAbsolute = spiked.mostExpensive.price - spiked.cheapest.price;
  spiked.spreadPercent = parseFloat(((spiked.spreadAbsolute / spiked.mostExpensive.price) * 100).toFixed(4));

  logInfo('scout', `[DEMO] Volatility spike: spread widened to ${spiked.spreadPercent.toFixed(2)}%`);
  return spiked;
}
