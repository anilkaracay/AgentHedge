import { logInfo, logError } from './logger.js';
import { getPrice } from './onchainOS.js';
import type { TokenConfig, PricePoint } from './types.js';

// ── Exchange APIs (all public, no auth required) ──

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getOKXPrice(base: string): Promise<number> {
  for (const quote of ['USDT', 'USDC']) {
    try {
      const data = await fetchJSON(`https://www.okx.com/api/v5/market/ticker?instId=${base}-${quote}`);
      if (data.data?.[0]?.last) return parseFloat(data.data[0].last);
    } catch { /* next */ }
  }
  return 0;
}

async function getBinancePrice(base: string): Promise<number> {
  for (const quote of ['USDT', 'USDC']) {
    try {
      const data = await fetchJSON(`https://api.binance.com/api/v3/ticker/price?symbol=${base}${quote}`);
      if (data.price) return parseFloat(data.price);
    } catch { /* next */ }
  }
  return 0;
}

async function getGateIOPrice(base: string): Promise<number> {
  for (const quote of ['USDT', 'USDC']) {
    try {
      const data = await fetchJSON(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${base}_${quote}`);
      if (Array.isArray(data) && data[0]?.last) return parseFloat(data[0].last);
    } catch { /* next */ }
  }
  return 0;
}

/** Fallback: Ethereum mainnet DEX price as CEX proxy */
async function getEthereumDEXPrice(token: TokenConfig): Promise<number> {
  if (token.symbol === 'USDT') {
    const result = await getPrice('1', '0xdac17f958d2ee523a2206206994597c13d831ec7', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '1000000');
    return result.price;
  }
  return 0;
}

/**
 * Get the best available CEX price from multiple exchanges.
 * Priority: OKX -> Binance -> Gate.io -> Ethereum DEX fallback
 */
export async function getCEXPrice(token: TokenConfig): Promise<PricePoint> {
  const base = token.symbol;

  // Special handling for USDT — it's a stablecoin, check USDC/USDT pair
  const lookupBase = base === 'USDT' ? 'USDC' : base;

  const exchanges: { name: string; fn: () => Promise<number> }[] = [
    { name: 'okx-cex', fn: () => getOKXPrice(lookupBase) },
    { name: 'binance-cex', fn: () => getBinancePrice(lookupBase) },
    { name: 'gateio-cex', fn: () => getGateIOPrice(lookupBase) },
  ];

  for (const ex of exchanges) {
    try {
      let price = await ex.fn();
      if (price > 0) {
        // For USDT: we looked up USDC/USDT, so invert to get USDT/USDC price
        if (base === 'USDT') price = 1 / price;
        logInfo('cex-feed', `${ex.name} ${token.symbol}: $${price.toFixed(4)}`);
        return { source: ex.name, price, timestamp: new Date().toISOString() };
      }
    } catch (err) {
      logError('cex-feed', `${ex.name} failed for ${token.symbol}`, err);
    }
  }

  // Fallback: Ethereum DEX
  try {
    const price = await getEthereumDEXPrice(token);
    if (price > 0) {
      logInfo('cex-feed', `ethereum-dex ${token.symbol}: $${price.toFixed(4)}`);
      return { source: 'ethereum-dex', price, timestamp: new Date().toISOString() };
    }
  } catch (err) {
    logError('cex-feed', `Ethereum DEX fallback failed for ${token.symbol}`, err);
  }

  throw new Error(`No CEX price available for ${token.symbol}`);
}
