import type { ArbitrageOpportunity } from './types.js';

const DEMO = process.env.DEMO_MODE === 'true';

// ── Fee Structure ──

export const FEE_STRUCTURE = {
  dexSwapFee: 0.003,           // 0.3% AMM fee
  xlayerGas: 0.0,

  takerFees: {
    okx: 0.001, binance: 0.001, gateio: 0.002,
    bybit: 0.001, kucoin: 0.001, mexc: 0.0005, htx: 0.002,
    'xlayer-dex': 0.003,
  } as Record<string, number>,

  // Transfer fees: context-dependent on venue pair
  // OKX <-> X Layer is FREE (same ecosystem, internal transfer)
  transfers: {
    'okx<>xlayer-dex': 0.0,       // FREE — X Layer is OKX's native L2
    'xlayer-dex<>okx': 0.0,       // FREE — internal transfer
    'binance<>xlayer-dex': 1.0,
    'gateio<>xlayer-dex': 0.8,
    'bybit<>xlayer-dex': 1.0,
    'kucoin<>xlayer-dex': 1.0,
    'mexc<>xlayer-dex': 0.5,
    'htx<>xlayer-dex': 1.0,
    _default: 1.0,
  } as Record<string, number>,

  scoutFee: 0.02,
  analystFee: 0.03,
};

function getVenueFee(venue: string): number {
  return FEE_STRUCTURE.takerFees[venue] ?? 0.002;
}

function getTransferFee(fromVenue: string, toVenue: string): number {
  if (fromVenue === toVenue) return 0;
  const key1 = `${fromVenue}<>${toVenue}`;
  const key2 = `${toVenue}<>${fromVenue}`;
  const fee = FEE_STRUCTURE.transfers[key1] ?? FEE_STRUCTURE.transfers[key2] ?? FEE_STRUCTURE.transfers._default;
  return DEMO ? fee * 0.5 : fee;
}

// ── Types ──

export interface TradeCosts {
  buyPrice: number;
  buyAmount: number;
  buyTotal: number;
  buySlippage: number;
  buyGas: number;
  buyExchangeFee: number;

  sellPrice: number;
  sellAmount: number;
  sellTotal: number;
  sellSlippage: number;
  sellGas: number;
  sellExchangeFee: number;

  scoutFee: number;
  analystFee: number;
  totalAgentFees: number;

  transferFee: number;
  transferNote: string;

  grossProfit: number;
  totalCosts: number;
  netProfit: number;
  netProfitPercent: number;
  profitable: boolean;
}

export interface CostBreakdown {
  category: string;
  item: string;
  amount: number;
  percent: number;
}

export interface TradeSize {
  minSize: number;
  minSizeUSD: number;
  optimalSize: number;
  optimalSizeUSD: number;
  profitAtOptimal: number;
}

// ── Estimation ──

export function estimateTradeCosts(
  opportunity: ArbitrageOpportunity,
  tradeSizeUSDC: number
): TradeCosts {
  const buyV = opportunity.buyVenue;
  const sellV = opportunity.sellVenue;
  const buyPrice = buyV.price;
  const sellPrice = sellV.price;
  const buyAmount = tradeSizeUSDC / buyPrice;

  const buyFeeRate = getVenueFee(buyV.venue);
  const sellFeeRate = getVenueFee(sellV.venue);

  const buyTotal = buyAmount * buyPrice;
  const buyExchangeFee = buyTotal * buyFeeRate;
  const buySlippage = buyV.venueType === 'dex' ? buyTotal * 0.001 : 0;
  const buyGas = buyV.venueType === 'dex' ? FEE_STRUCTURE.xlayerGas : 0;

  const sellAmount = buyAmount;
  const sellTotal = sellAmount * sellPrice;
  const sellExchangeFee = sellTotal * sellFeeRate;
  const sellSlippage = sellV.venueType === 'dex' ? sellTotal * 0.001 : 0;
  const sellGas = sellV.venueType === 'dex' ? FEE_STRUCTURE.xlayerGas : 0;

  // Context-dependent transfer fee
  const transferFee = getTransferFee(buyV.venue, sellV.venue);
  const isOKXXLayer = transferFee === 0 && buyV.venue !== sellV.venue;
  const transferNote = buyV.venue === sellV.venue
    ? 'same venue'
    : isOKXXLayer
      ? 'OKX <> X Layer: $0 (internal transfer)'
      : `${buyV.venue} <> ${sellV.venue}: $${transferFee.toFixed(2)}`;

  const scoutFee = FEE_STRUCTURE.scoutFee;
  const analystFee = FEE_STRUCTURE.analystFee;
  const totalAgentFees = scoutFee + analystFee;

  const grossProfit = sellTotal - buyTotal;
  const totalCosts = buyExchangeFee + buySlippage + buyGas +
                     sellExchangeFee + sellSlippage + sellGas +
                     totalAgentFees + transferFee;
  const netProfit = grossProfit - totalCosts;
  const netProfitPercent = buyTotal > 0 ? (netProfit / buyTotal) * 100 : 0;
  const minThreshold = DEMO ? 0.01 : 0.50;

  return {
    buyPrice, buyAmount, buyTotal, buySlippage, buyGas, buyExchangeFee,
    sellPrice, sellAmount, sellTotal, sellSlippage, sellGas, sellExchangeFee,
    scoutFee, analystFee, totalAgentFees,
    transferFee, transferNote,
    grossProfit: parseFloat(grossProfit.toFixed(6)),
    totalCosts: parseFloat(totalCosts.toFixed(6)),
    netProfit: parseFloat(netProfit.toFixed(6)),
    netProfitPercent: parseFloat(netProfitPercent.toFixed(4)),
    profitable: netProfit > minThreshold,
  };
}

// ── Trade Size Optimization ──

export function calculateMinProfitableSize(opportunity: ArbitrageOpportunity): TradeSize {
  const buyV = opportunity.buyVenue;
  const sellV = opportunity.sellVenue;
  const spreadPct = opportunity.spreadPercent / 100;

  // Fixed costs (don't scale with trade size)
  const transferFee = getTransferFee(buyV.venue, sellV.venue);
  const agentFees = FEE_STRUCTURE.scoutFee + FEE_STRUCTURE.analystFee;
  const fixedCosts = transferFee + agentFees;

  // Variable cost rate (scales with trade size)
  const buyFeeRate = getVenueFee(buyV.venue);
  const sellFeeRate = getVenueFee(sellV.venue);
  const dexSlipRate = 0.001; // 0.1%
  const buyVarRate = buyFeeRate + (buyV.venueType === 'dex' ? dexSlipRate : 0);
  const sellVarRate = sellFeeRate + (sellV.venueType === 'dex' ? dexSlipRate : 0);
  const totalVarRate = buyVarRate + sellVarRate;

  // Net variable rate = spread - variable costs
  const netVarRate = spreadPct - totalVarRate;

  if (netVarRate <= 0) {
    // Variable costs exceed spread — never profitable
    return { minSize: Infinity, minSizeUSD: Infinity, optimalSize: 0, optimalSizeUSD: 0, profitAtOptimal: -fixedCosts };
  }

  // Break-even: netVarRate * minSizeUSD = fixedCosts
  const minSizeUSD = fixedCosts / netVarRate;
  const minSize = minSizeUSD / buyV.price;

  // Optimal: larger trades have more price impact. Cap at 10x minimum or $5000.
  const optimalSizeUSD = Math.min(minSizeUSD * 3, 5000);
  const optimalSize = optimalSizeUSD / buyV.price;
  const profitAtOptimal = (netVarRate * optimalSizeUSD) - fixedCosts;

  return {
    minSize: parseFloat(minSize.toFixed(4)),
    minSizeUSD: parseFloat(minSizeUSD.toFixed(2)),
    optimalSize: parseFloat(optimalSize.toFixed(4)),
    optimalSizeUSD: parseFloat(optimalSizeUSD.toFixed(2)),
    profitAtOptimal: parseFloat(profitAtOptimal.toFixed(4)),
  };
}

// ── Cost Breakdown ──

export function getCostBreakdown(costs: TradeCosts): CostBreakdown[] {
  const gross = Math.abs(costs.grossProfit) || 1;
  const items: CostBreakdown[] = [];
  const add = (cat: string, item: string, amt: number) => {
    if (amt > 0.0001) items.push({ category: cat, item, amount: parseFloat(amt.toFixed(6)), percent: parseFloat(((amt / gross) * 100).toFixed(2)) });
  };

  add('Buy Side', 'Exchange fee', costs.buyExchangeFee);
  add('Buy Side', 'Slippage', costs.buySlippage);
  add('Sell Side', 'Exchange fee', costs.sellExchangeFee);
  add('Sell Side', 'Slippage', costs.sellSlippage);
  add('Agent Fees', 'Scout (x402)', costs.scoutFee);
  add('Agent Fees', 'Analyst (x402)', costs.analystFee);
  add('Transfer', costs.transferNote, costs.transferFee);

  return items;
}

// ── Formatted Report ──

export function formatProfitReport(costs: TradeCosts, buyVenue: string, sellVenue: string, token: string): string {
  const lines: string[] = [];
  const w = 62;
  const r = (s: string, n: number) => s.padStart(n);

  if (DEMO) lines.push('[DEMO MODE] Using reduced thresholds for demonstration');

  lines.push(`BUY  ${costs.buyAmount.toFixed(4)} ${token} @ $${costs.buyPrice.toFixed(2)} on ${buyVenue}${r('-$' + costs.buyTotal.toFixed(2), w - 30 - buyVenue.length - token.length)}`);
  if (costs.buyExchangeFee > 0) lines.push(`  Exchange fee (${(getVenueFee(buyVenue) * 100).toFixed(1)}%)${r('-$' + costs.buyExchangeFee.toFixed(3), w - 30)}`);

  lines.push('');
  lines.push(`SELL ${costs.sellAmount.toFixed(4)} ${token} @ $${costs.sellPrice.toFixed(2)} on ${sellVenue}${r('+$' + costs.sellTotal.toFixed(2), w - 30 - sellVenue.length - token.length)}`);
  if (costs.sellExchangeFee > 0) lines.push(`  Exchange fee (${(getVenueFee(sellVenue) * 100).toFixed(1)}%)${r('-$' + costs.sellExchangeFee.toFixed(3), w - 30)}`);
  if (costs.sellSlippage > 0) lines.push(`  Slippage${r('-$' + costs.sellSlippage.toFixed(3), w - 14)}`);

  lines.push('');
  lines.push(`Agent fees (Scout + Analyst)${r('-$' + costs.totalAgentFees.toFixed(3), w - 31)}`);
  lines.push(`Transfer: ${costs.transferNote}${costs.transferFee > 0 ? r('-$' + costs.transferFee.toFixed(3), w - 14 - costs.transferNote.length) : ''}`);

  lines.push('');
  lines.push('-'.repeat(w));
  lines.push(`Gross profit${r((costs.grossProfit >= 0 ? '+' : '') + '$' + costs.grossProfit.toFixed(3), w - 16)}`);
  lines.push(`Total costs${r('-$' + costs.totalCosts.toFixed(3), w - 15)}`);
  lines.push('-'.repeat(w));
  const sign = costs.netProfit >= 0 ? '+' : '';
  lines.push(`NET PROFIT${r(sign + '$' + costs.netProfit.toFixed(3), w - 14)}`);
  lines.push(`NET PROFIT %${r(sign + costs.netProfitPercent.toFixed(2) + '%', w - 16)}`);
  lines.push(`VERDICT${r(costs.profitable ? 'PROFITABLE' : 'NOT PROFITABLE', w - 11)}`);

  return lines.join('\n');
}
