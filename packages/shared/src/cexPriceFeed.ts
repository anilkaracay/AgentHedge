import { logInfo, logError } from './logger.js';
import { getPrice } from './onchainOS.js';
import type { TokenConfig, PricePoint } from './types.js';

/**
 * OKX CEX public spot API — no API key required.
 * GET https://www.okx.com/api/v5/market/ticker?instId=OKB-USDC
 */
async function getOKXSpotPrice(cexSymbol: string): Promise<number> {
  // Map cexSymbol to OKX instId
  // Heuristic: try the exact pair first, then common variants
  const base = cexSymbol.replace('USDC', '').replace('USDT', '');
  const candidates = base
    ? [`${base}-USDT`, `${base}-USDC`]
    : ['USDT-USDC']; // For stablecoins like USDTUSDC
  for (const instId of candidates) {
    try {
      const res = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`);
      const data = await res.json() as { data?: { last: string }[] };
      if (data.data?.[0]?.last) return parseFloat(data.data[0].last);
    } catch { /* try next */ }
  }
  throw new Error(`OKX: no data for ${cexSymbol} (tried ${candidates.join(', ')})`);
}

/**
 * Binance public spot API — no API key required.
 * GET https://api.binance.com/api/v3/ticker/price?symbol=OKBUSDC
 */
async function getBinanceSpotPrice(cexSymbol: string): Promise<number> {
  const base = cexSymbol.replace('USDC', '').replace('USDT', '');
  const pairs = base
    ? [`${base}USDT`, `${base}USDC`]
    : ['USDCUSDT']; // For stablecoin pair
  for (const pair of pairs) {
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
      const data = await res.json() as { price?: string };
      if (data.price) return parseFloat(data.price);
    } catch { /* try next */ }
  }
  throw new Error(`Binance: no data for ${base}`);
}

/**
 * Fallback: derive "CEX reference" price from Ethereum mainnet DEX via OnchainOS.
 * Ethereum DEX prices closely track CEX due to heavy arbitrage activity.
 */
async function getEthereumDEXPrice(token: TokenConfig): Promise<number> {
  // For OKB, quote native ETH as proxy isn't useful. Use USDT→USDC as stablecoin ref.
  // For tokens that exist on Ethereum, we can quote directly.
  if (token.symbol === 'OKB') {
    // OKB doesn't have deep Ethereum DEX liquidity, use OKX API only
    throw new Error('OKB not available on Ethereum DEX');
  }
  if (token.symbol === 'USDT') {
    // Quote 1 USDT → USDC on Ethereum
    const result = await getPrice('1', '0xdac17f958d2ee523a2206206994597c13d831ec7', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '1000000');
    return result.price;
  }
  // Generic: quote token → USDC on Ethereum
  const result = await getPrice('1', token.xlayerAddress, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', token.quoteAmount);
  return result.price;
}

/**
 * Get the best available CEX price for a token.
 * Priority: OKX spot → Binance spot → Ethereum DEX (as CEX proxy)
 */
export async function getCEXPrice(token: TokenConfig): Promise<PricePoint> {
  // Try OKX first (uses -USDT pairs, price is effectively USD since USDT ~ $1)
  try {
    const price = await getOKXSpotPrice(token.cexSymbol);
    if (price > 0) {
      logInfo('cex-feed', `OKX spot ${token.symbol}: $${price.toFixed(4)}`);
      return { source: 'okx-cex', price, timestamp: new Date().toISOString() };
    }
  } catch (err) {
    logError('cex-feed', `OKX failed for ${token.symbol}`, err);
  }

  // Try Binance (uses USDT pairs)
  try {
    const price = await getBinanceSpotPrice(token.cexSymbol);
    if (price > 0) {
      logInfo('cex-feed', `Binance spot ${token.symbol}: $${price.toFixed(4)}`);
      return { source: 'binance-cex', price, timestamp: new Date().toISOString() };
    }
  } catch (err) {
    logError('cex-feed', `Binance failed for ${token.symbol}`, err);
  }

  // Fallback: Ethereum DEX as CEX proxy
  try {
    const price = await getEthereumDEXPrice(token);
    if (price > 0) {
      logInfo('cex-feed', `Ethereum DEX proxy ${token.symbol}: $${price.toFixed(4)}`);
      return { source: 'ethereum-dex', price, timestamp: new Date().toISOString() };
    }
  } catch (err) {
    logError('cex-feed', `Ethereum DEX fallback failed for ${token.symbol}`, err);
  }

  throw new Error(`No CEX price available for ${token.symbol}`);
}
