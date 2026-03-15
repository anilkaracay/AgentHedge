import { logInfo, logError } from './logger.js';
import { getSwapQuote } from './onchainOS.js';
import { USDC_XLAYER } from './tokenRegistry.js';
import type { TokenConfig, VenuePrice, MultiVenueScan } from './types.js';

// ── Venue Configurations (all public, no auth required) ──

interface VenueConfig {
  name: string;
  getUrl: (symbol: string) => string;
  parsePrice: (data: any) => number;
}

const VENUE_CONFIGS: VenueConfig[] = [
  {
    name: 'okx',
    getUrl: (s) => `https://www.okx.com/api/v5/market/ticker?instId=${s}-USDT`,
    parsePrice: (d) => parseFloat(d.data?.[0]?.last ?? '0'),
  },
  {
    name: 'binance',
    getUrl: (s) => `https://api.binance.com/api/v3/ticker/price?symbol=${s}USDT`,
    parsePrice: (d) => parseFloat(d.price ?? '0'),
  },
  {
    name: 'gateio',
    getUrl: (s) => `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${s}_USDT`,
    parsePrice: (d) => parseFloat(d[0]?.last ?? '0'),
  },
  {
    name: 'bybit',
    getUrl: (s) => `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${s}USDT`,
    parsePrice: (d) => parseFloat(d.result?.list?.[0]?.lastPrice ?? '0'),
  },
  {
    name: 'kucoin',
    getUrl: (s) => `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${s}-USDT`,
    parsePrice: (d) => parseFloat(d.data?.price ?? '0'),
  },
  {
    name: 'mexc',
    getUrl: (s) => `https://api.mexc.com/api/v3/ticker/price?symbol=${s}USDT`,
    parsePrice: (d) => parseFloat(d.price ?? '0'),
  },
  {
    name: 'htx',
    getUrl: (s) => `https://api.huobi.pro/market/detail/merged?symbol=${s.toLowerCase()}usdt`,
    parsePrice: (d) => parseFloat(d.tick?.close ?? '0'),
  },
];

async function fetchVenuePrice(venue: VenueConfig, symbol: string): Promise<VenuePrice> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(venue.getUrl(symbol), { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    const price = venue.parsePrice(data);
    if (!price || isNaN(price) || price <= 0) throw new Error('Invalid price');
    return {
      venue: venue.name, venueType: 'cex', price, symbol,
      timestamp: new Date().toISOString(), latency: Date.now() - start, available: true,
    };
  } catch {
    return {
      venue: venue.name, venueType: 'cex', price: 0, symbol,
      timestamp: new Date().toISOString(), latency: Date.now() - start, available: false,
    };
  }
}

async function fetchDEXPrice(token: TokenConfig): Promise<VenuePrice> {
  const start = Date.now();
  try {
    const quote = await getSwapQuote({
      chainIndex: '196',
      fromTokenAddress: token.xlayerAddress,
      toTokenAddress: USDC_XLAYER,
      amount: token.quoteAmount,
      slippagePercent: '0.5',
    });
    const fromDec = parseInt(quote.fromToken?.decimal ?? String(token.decimals));
    const toDec = parseInt(quote.toToken?.decimal ?? '6');
    const price = (parseFloat(quote.toTokenAmount) / Math.pow(10, toDec)) /
                  (parseFloat(quote.fromTokenAmount) / Math.pow(10, fromDec));
    if (!price || price <= 0) throw new Error('Invalid DEX price');
    return {
      venue: 'xlayer-dex', venueType: 'dex', price, symbol: token.symbol,
      timestamp: new Date().toISOString(), latency: Date.now() - start, available: true,
    };
  } catch {
    return {
      venue: 'xlayer-dex', venueType: 'dex', price: 0, symbol: token.symbol,
      timestamp: new Date().toISOString(), latency: Date.now() - start, available: false,
    };
  }
}

/**
 * Scan ALL venues simultaneously for a token.
 * Returns sorted price landscape with cheapest and most expensive.
 */
export async function scanAllVenues(token: TokenConfig): Promise<MultiVenueScan> {
  const startTime = Date.now();

  // Fire ALL requests simultaneously
  const allPromises = [
    ...VENUE_CONFIGS.map(v => fetchVenuePrice(v, token.symbol)),
    fetchDEXPrice(token),
  ];

  const results = await Promise.allSettled(allPromises);

  const allVenues = results
    .filter((r): r is PromiseFulfilledResult<VenuePrice> => r.status === 'fulfilled')
    .map(r => r.value);

  const available = allVenues.filter(v => v.available && v.price > 0);
  available.sort((a, b) => a.price - b.price);

  // Log scan results
  const responded = available.length;
  const total = allVenues.length;
  logInfo('scanner', `${token.symbol}: ${responded}/${total} venues responded in ${Date.now() - startTime}ms`);

  for (const v of available) {
    const tag = v === available[0] ? ' << CHEAPEST' : v === available[available.length - 1] ? ' << MOST EXPENSIVE' : '';
    logInfo('scanner', `  ${v.venue.padEnd(12)} ${v.venueType.padEnd(4)} $${v.price.toFixed(4)} (${v.latency}ms)${tag}`);
  }

  if (available.length < 2) {
    throw new Error(`${token.symbol}: only ${available.length} venue(s) available, need at least 2`);
  }

  const cheapest = available[0];
  const mostExpensive = available[available.length - 1];
  const spreadAbsolute = mostExpensive.price - cheapest.price;
  const spreadPercent = (spreadAbsolute / mostExpensive.price) * 100;

  logInfo('scanner', `  Spread: $${spreadAbsolute.toFixed(4)} (${spreadPercent.toFixed(4)}%) — BUY @ ${cheapest.venue}, SELL @ ${mostExpensive.venue}`);

  return {
    token: token.symbol,
    venues: available,
    cheapest,
    mostExpensive,
    spreadPercent: parseFloat(spreadPercent.toFixed(4)),
    spreadAbsolute: parseFloat(spreadAbsolute.toFixed(6)),
    scanDuration: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
}

// Legacy compat: getCEXPrice returns the OKX price (or first available)
export async function getCEXPrice(token: TokenConfig): Promise<{ source: string; price: number; timestamp: string }> {
  for (const venue of VENUE_CONFIGS) {
    const result = await fetchVenuePrice(venue, token.symbol);
    if (result.available) {
      return { source: `${result.venue}-cex`, price: result.price, timestamp: result.timestamp };
    }
  }
  throw new Error(`No CEX price for ${token.symbol}`);
}
