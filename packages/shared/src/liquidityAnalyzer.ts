import { getSwapQuote } from './onchainOS.js';
import { USDC_XLAYER } from './tokenRegistry.js';
import { logInfo } from './logger.js';
import { FEE_STRUCTURE } from './profitCalculator.js';
import type { ArbitrageOpportunity } from './types.js';

// ── Types ──

export interface OrderBookLevel {
  price: number;
  size: number;
  sizeUSD: number;
  cumulative: number;
}

export interface OrderBookAnalysis {
  venue: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bidDepthUSD: number;
  askDepthUSD: number;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
}

export interface TradeSimulation {
  venue: string;
  side: 'buy' | 'sell';
  requestedSizeUSD: number;
  fillableSizeUSD: number;
  averageFillPrice: number;
  worstFillPrice: number;
  priceImpact: number;
  levelsConsumed: number;
  fullyFillable: boolean;
}

export interface LiquidityProbe {
  sizeUSD: number;
  sizeToken: number;
  dexImpact: number;
  cexImpact: number;
  totalImpact: number;
  netProfit: number;
  profitable: boolean;
  cexLevels: number;
}

export interface OptimalTradeSize {
  sizeUSD: number;
  sizeToken: number;
  impact: number;
  dexImpact: number;
  cexImpact: number;
  cexLevels: number;
  cexDepthUSD: number;
  expectedNetProfit: number;
  profitPerDollar: number;
  reason: string;
  probes: LiquidityProbe[];
}

// ── CEX Order Book Fetchers ──

function parseOrderBook(venue: string, bidsRaw: [string, string][], asksRaw: [string, string][]): OrderBookAnalysis {
  let cumBid = 0;
  const bids = bidsRaw.map(([p, s]) => {
    const price = parseFloat(p);
    const size = parseFloat(s);
    cumBid += price * size;
    return { price, size, sizeUSD: price * size, cumulative: cumBid };
  });

  let cumAsk = 0;
  const asks = asksRaw.map(([p, s]) => {
    const price = parseFloat(p);
    const size = parseFloat(s);
    cumAsk += price * size;
    return { price, size, sizeUSD: price * size, cumulative: cumAsk };
  });

  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;

  return { venue, bids, asks, bidDepthUSD: cumBid, askDepthUSD: cumAsk, bestBid, bestAsk, midPrice: (bestBid + bestAsk) / 2 };
}

async function fetchJSON(url: string, timeout = 3000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const res = await fetch(url, { signal: ctrl.signal });
  clearTimeout(t);
  return res.json();
}

export async function getOrderBook(venue: string, token: string): Promise<OrderBookAnalysis | null> {
  try {
    switch (venue) {
      case 'okx': {
        const data = await fetchJSON(`https://www.okx.com/api/v5/market/books?instId=${token}-USDT&sz=20`);
        return parseOrderBook('okx', data.data[0].bids, data.data[0].asks);
      }
      case 'gateio': {
        const data = await fetchJSON(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${token}_USDT&limit=20`);
        return parseOrderBook('gateio', data.bids, data.asks);
      }
      case 'mexc': {
        const data = await fetchJSON(`https://api.mexc.com/api/v3/depth?symbol=${token}USDT&limit=20`);
        return parseOrderBook('mexc', data.bids, data.asks);
      }
      default: return null;
    }
  } catch {
    return null;
  }
}

// ── Simulate Market Order Against Order Book ──

export function simulateMarketOrder(ob: OrderBookAnalysis, side: 'buy' | 'sell', sizeUSD: number): TradeSimulation {
  const levels = side === 'buy' ? ob.asks : ob.bids;
  let remainingUSD = sizeUSD;
  let totalTokens = 0;
  let levelsConsumed = 0;
  let worstPrice = 0;

  for (const level of levels) {
    if (remainingUSD <= 0) break;
    const consumed = Math.min(remainingUSD, level.sizeUSD);
    totalTokens += consumed / level.price;
    remainingUSD -= consumed;
    worstPrice = level.price;
    levelsConsumed++;
  }

  const filledUSD = sizeUSD - Math.max(0, remainingUSD);
  const avgPrice = totalTokens > 0 ? filledUSD / totalTokens : 0;
  const impact = ob.midPrice > 0 ? Math.abs(avgPrice - ob.midPrice) / ob.midPrice * 100 : 0;

  return {
    venue: ob.venue, side, requestedSizeUSD: sizeUSD, fillableSizeUSD: filledUSD,
    averageFillPrice: avgPrice, worstFillPrice: worstPrice,
    priceImpact: parseFloat(impact.toFixed(4)), levelsConsumed,
    fullyFillable: remainingUSD <= 0,
  };
}

// ── Optimal Trade Size with Both Sides ──

const PROBE_SIZES = [1000, 2500, 5000, 10000, 15000, 25000, 50000];

export async function findOptimalTradeSize(
  opportunity: ArbitrageOpportunity,
  maxCapitalPerVenue: number = 50000
): Promise<OptimalTradeSize> {
  // Determine which side is CEX and which is DEX
  const cexVenue = [opportunity.buyVenue, opportunity.sellVenue].find(v => v.venueType === 'cex');
  const dexVenue = [opportunity.buyVenue, opportunity.sellVenue].find(v => v.venueType === 'dex');
  const cexSide: 'buy' | 'sell' = opportunity.buyVenue.venueType === 'cex' ? 'buy' : 'sell';

  // Fetch BOTH sides simultaneously
  const [cexBook, dexProbes] = await Promise.all([
    cexVenue ? getOrderBook(cexVenue.venue, opportunity.token) : null,
    probeDEXAtSizes(opportunity.tokenAddress, PROBE_SIZES),
  ]);

  // Log CEX order book
  if (cexBook) {
    logInfo('liquidity', `CEX (${cexBook.venue}): bid $${cexBook.bidDepthUSD.toFixed(0)} depth (${cexBook.bids.length} lvls) | ask $${cexBook.askDepthUSD.toFixed(0)} depth | spread ${((cexBook.bestAsk - cexBook.bestBid) / cexBook.midPrice * 10000).toFixed(1)} bps`);
  } else {
    logInfo('liquidity', `CEX order book unavailable — sizing by DEX only`);
  }

  const probes: LiquidityProbe[] = [];
  let bestSize = PROBE_SIZES[0];
  let bestProfit = -Infinity;

  for (let idx = 0; idx < PROBE_SIZES.length; idx++) {
    const sizeUSD = PROBE_SIZES[idx];
    if (sizeUSD > maxCapitalPerVenue) break;

    const sizeToken = sizeUSD / opportunity.buyVenue.price;
    const dexImpact = dexProbes[idx] ?? 0;

    let cexImpact = 0;
    let cexLevels = 0;
    let cexFillable = true;
    if (cexBook) {
      const sim = simulateMarketOrder(cexBook, cexSide, sizeUSD);
      cexImpact = sim.priceImpact;
      cexLevels = sim.levelsConsumed;
      cexFillable = sim.fullyFillable;
    }

    if (!cexFillable) {
      logInfo('liquidity', `  $${String(sizeUSD).padEnd(7)} CEX can't fill — order book exhausted at ${cexLevels} levels`);
      break;
    }

    const totalImpact = dexImpact + cexImpact;
    const effectiveSpread = opportunity.spreadPercent - totalImpact;
    const grossProfit = (effectiveSpread / 100) * sizeUSD;
    const buyFee = sizeUSD * (FEE_STRUCTURE.takerFees[opportunity.buyVenue.venue] ?? 0.002);
    const sellFee = sizeUSD * (FEE_STRUCTURE.takerFees[opportunity.sellVenue.venue] ?? 0.002);
    const netProfit = grossProfit - buyFee - sellFee - 0.05;
    const profitable = netProfit > 0;

    probes.push({ sizeUSD, sizeToken, dexImpact, cexImpact, totalImpact, netProfit: parseFloat(netProfit.toFixed(2)), profitable, cexLevels });

    const icon = profitable ? '\u2713' : '\u2717';
    logInfo('liquidity', `  $${String(sizeUSD).padEnd(7)} DEX ${dexImpact.toFixed(2)}% + CEX ${cexImpact.toFixed(2)}% = ${totalImpact.toFixed(2)}%  net $${netProfit.toFixed(2).padStart(8)}  ${icon}${netProfit > bestProfit && profitable ? '  << BEST' : ''}`);

    if (netProfit > bestProfit) {
      bestProfit = netProfit;
      bestSize = sizeUSD;
    }
  }

  const bestProbe = probes.find(p => p.sizeUSD === bestSize);

  // Add variance (+-15%)
  const variance = 0.85 + Math.random() * 0.30;
  const finalSize = Math.round(bestSize * variance / 100) * 100;
  const finalToken = finalSize / opportunity.buyVenue.price;

  return {
    sizeUSD: finalSize,
    sizeToken: parseFloat(finalToken.toFixed(4)),
    impact: bestProbe?.totalImpact ?? 0,
    dexImpact: bestProbe?.dexImpact ?? 0,
    cexImpact: bestProbe?.cexImpact ?? 0,
    cexLevels: bestProbe?.cexLevels ?? 0,
    cexDepthUSD: cexBook ? (cexSide === 'buy' ? cexBook.askDepthUSD : cexBook.bidDepthUSD) : 0,
    expectedNetProfit: bestProfit * (finalSize / bestSize),
    profitPerDollar: bestSize > 0 ? bestProfit / bestSize : 0,
    reason: cexBook
      ? `$${finalSize.toLocaleString()} — DEX ${(bestProbe?.dexImpact ?? 0).toFixed(2)}% + CEX ${(bestProbe?.cexImpact ?? 0).toFixed(2)}% (${bestProbe?.cexLevels ?? 0} levels, $${(cexSide === 'buy' ? cexBook.askDepthUSD : cexBook.bidDepthUSD).toFixed(0)} depth)`
      : `$${finalSize.toLocaleString()} — DEX only (CEX book unavailable)`,
    probes,
  };
}

// ── DEX Liquidity Probing ──

async function probeDEXAtSizes(tokenAddress: string, sizes: number[]): Promise<number[]> {
  const impacts: number[] = [];
  for (const sizeUSD of sizes) {
    const sizeToken = sizeUSD / 96; // rough OKB price
    const raw = BigInt(Math.floor(sizeToken * 1e18)).toString();
    try {
      const quote = await getSwapQuote({
        chainIndex: '196',
        fromTokenAddress: tokenAddress,
        toTokenAddress: USDC_XLAYER,
        amount: raw,
        slippagePercent: '1',
      });
      impacts.push(parseFloat(quote.priceImpactPercentage || '0'));
    } catch {
      impacts.push(0);
      break;
    }
  }
  // Pad remaining with last known value
  while (impacts.length < sizes.length) impacts.push(impacts[impacts.length - 1] ?? 0);
  return impacts;
}
