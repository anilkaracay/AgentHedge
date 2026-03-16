import type { ArbitrageOpportunity } from './types.js';

const DEMO = process.env.DEMO_MODE === 'true';

// ── Fee Tiers ──

export type FeeTier = 'retail' | 'professional' | 'vip';

const FEE_TIERS = {
  retail: {
    cex: { okx: 0.001, binance: 0.001, gateio: 0.002, bybit: 0.001, kucoin: 0.001, mexc: 0.0005, htx: 0.002 } as Record<string, number>,
    dex: 0.003,     // 0.3% standard AMM
    label: 'Retail (taker 0.1% + DEX 0.3%)',
  },
  professional: {
    cex: { okx: 0.0002, binance: 0.0002, gateio: 0.0005, bybit: 0.0002, kucoin: 0.0003, mexc: 0.0001, htx: 0.0005 } as Record<string, number>,
    dex: 0.0005,    // 0.05% Uniswap V3 low-fee pool tier on X Layer
    label: 'Professional (maker 0.02% + DEX 0.05%)',
  },
  vip: {
    cex: { okx: 0.0001, binance: 0.0001, gateio: 0.0002, bybit: 0.0001, kucoin: 0.0001, mexc: 0.00005, htx: 0.0002 } as Record<string, number>,
    dex: 0.0005,    // 0.05% low-fee Uniswap V4 pool
    label: 'VIP (maker 0.01% + DEX 0.05%)',
  },
};

function getFeeTier(): FeeTier {
  const tier = process.env.FEE_TIER as FeeTier;
  if (tier && FEE_TIERS[tier]) return tier;
  return DEMO ? 'professional' : 'retail';
}

export function getFeeTierInfo() {
  const tier = getFeeTier();
  return { tier, ...FEE_TIERS[tier] };
}

// ── Fee Structure (legacy compat) ──

export const FEE_STRUCTURE = {
  get takerFees(): Record<string, number> {
    const tier = getFeeTier();
    const fees = { ...FEE_TIERS[tier].cex };
    fees['xlayer-dex'] = FEE_TIERS[tier].dex;
    return fees;
  },

  xlayerGas: 0.0,

  transfers: {
    'okx<>xlayer-dex': 0.0,
    'xlayer-dex<>okx': 0.0,
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
  return DEMO ? 0 : fee;
}

// ── Types ──

export interface TradeCosts {
  buyPrice: number; buyAmount: number; buyTotal: number;
  buySlippage: number; buyGas: number; buyExchangeFee: number;
  sellPrice: number; sellAmount: number; sellTotal: number;
  sellSlippage: number; sellGas: number; sellExchangeFee: number;
  scoutFee: number; analystFee: number; totalAgentFees: number;
  transferFee: number; transferNote: string;
  grossProfit: number; totalCosts: number;
  netProfit: number; netProfitPercent: number; profitable: boolean;
  feeTier: string;
}

export interface CostBreakdown { category: string; item: string; amount: number; percent: number; }
export interface TradeSize { minSize: number; minSizeUSD: number; optimalSize: number; optimalSizeUSD: number; profitAtOptimal: number; }

// ── Estimation ──

export function estimateTradeCosts(opportunity: ArbitrageOpportunity, tradeSizeUSDC: number): TradeCosts {
  const buyV = opportunity.buyVenue;
  const sellV = opportunity.sellVenue;
  const buyPrice = buyV.price;
  const sellPrice = sellV.price;
  const buyAmount = tradeSizeUSDC / buyPrice;
  const tierInfo = getFeeTierInfo();

  const buyFeeRate = getVenueFee(buyV.venue);
  const sellFeeRate = getVenueFee(sellV.venue);

  const buyTotal = buyAmount * buyPrice;
  const buyExchangeFee = buyTotal * buyFeeRate;
  const buySlippage = buyV.venueType === 'dex' ? buyTotal * 0.001 : 0;
  const buyGas = 0;

  const sellAmount = buyAmount;
  const sellTotal = sellAmount * sellPrice;
  const sellExchangeFee = sellTotal * sellFeeRate;
  const sellSlippage = sellV.venueType === 'dex' ? sellTotal * 0.001 : 0;
  const sellGas = 0;

  const transferFee = getTransferFee(buyV.venue, sellV.venue);
  const transferNote = DEMO
    ? 'Capital pre-positioned (no transfer needed)'
    : buyV.venue === sellV.venue ? 'same venue'
    : transferFee === 0 ? 'OKX <> X Layer: $0 (internal transfer)'
    : `${buyV.venue} <> ${sellV.venue}: $${transferFee.toFixed(2)}`;

  const totalAgentFees = FEE_STRUCTURE.scoutFee + FEE_STRUCTURE.analystFee;
  const grossProfit = sellTotal - buyTotal;
  const totalCosts = buyExchangeFee + buySlippage + buyGas + sellExchangeFee + sellSlippage + sellGas + totalAgentFees + transferFee;
  const netProfit = grossProfit - totalCosts;
  const netProfitPercent = buyTotal > 0 ? (netProfit / buyTotal) * 100 : 0;
  const minThreshold = DEMO ? 0.01 : 0.50;

  return {
    buyPrice, buyAmount, buyTotal, buySlippage, buyGas, buyExchangeFee,
    sellPrice, sellAmount, sellTotal, sellSlippage, sellGas, sellExchangeFee,
    scoutFee: FEE_STRUCTURE.scoutFee, analystFee: FEE_STRUCTURE.analystFee, totalAgentFees,
    transferFee, transferNote,
    grossProfit: parseFloat(grossProfit.toFixed(6)),
    totalCosts: parseFloat(totalCosts.toFixed(6)),
    netProfit: parseFloat(netProfit.toFixed(6)),
    netProfitPercent: parseFloat(netProfitPercent.toFixed(4)),
    profitable: netProfit > minThreshold,
    feeTier: tierInfo.label,
  };
}

// ── Trade Size Optimization ──

export function calculateMinProfitableSize(opportunity: ArbitrageOpportunity): TradeSize {
  const buyV = opportunity.buyVenue;
  const sellV = opportunity.sellVenue;
  const spreadPct = opportunity.spreadPercent / 100;

  const transferFee = getTransferFee(buyV.venue, sellV.venue);
  const agentFees = FEE_STRUCTURE.scoutFee + FEE_STRUCTURE.analystFee;
  const fixedCosts = transferFee + agentFees;

  const buyFeeRate = getVenueFee(buyV.venue);
  const sellFeeRate = getVenueFee(sellV.venue);
  const dexSlipRate = 0.001;
  const buyVarRate = buyFeeRate + (buyV.venueType === 'dex' ? dexSlipRate : 0);
  const sellVarRate = sellFeeRate + (sellV.venueType === 'dex' ? dexSlipRate : 0);
  const netVarRate = spreadPct - buyVarRate - sellVarRate;

  if (netVarRate <= 0) {
    return { minSize: Infinity, minSizeUSD: Infinity, optimalSize: 0, optimalSizeUSD: 0, profitAtOptimal: -fixedCosts };
  }

  const minSizeUSD = fixedCosts / netVarRate;
  const optimalSizeUSD = Math.min(minSizeUSD * 3, 50000);

  return {
    minSize: parseFloat((minSizeUSD / buyV.price).toFixed(4)),
    minSizeUSD: parseFloat(minSizeUSD.toFixed(2)),
    optimalSize: parseFloat((optimalSizeUSD / buyV.price).toFixed(4)),
    optimalSizeUSD: parseFloat(optimalSizeUSD.toFixed(2)),
    profitAtOptimal: parseFloat(((netVarRate * optimalSizeUSD) - fixedCosts).toFixed(4)),
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

  if (DEMO) lines.push(`[DEMO MODE] Fee tier: ${costs.feeTier}`);

  const buyFeeLabel = costs.buyExchangeFee > 0 ? `${(getVenueFee(buyVenue) * 100).toFixed(2)}%` : '0%';
  const sellFeeLabel = costs.sellExchangeFee > 0 ? `${(getVenueFee(sellVenue) * 100).toFixed(2)}%` : '0%';

  lines.push(`BUY  ${costs.buyAmount.toFixed(4)} ${token} @ $${costs.buyPrice.toFixed(2)} on ${buyVenue}${r('-$' + costs.buyTotal.toFixed(2), w - 30 - buyVenue.length - token.length)}`);
  if (costs.buyExchangeFee > 0) lines.push(`  Fee (${buyFeeLabel})${r('-$' + costs.buyExchangeFee.toFixed(3), w - 14 - buyFeeLabel.length)}`);

  lines.push('');
  lines.push(`SELL ${costs.sellAmount.toFixed(4)} ${token} @ $${costs.sellPrice.toFixed(2)} on ${sellVenue}${r('+$' + costs.sellTotal.toFixed(2), w - 30 - sellVenue.length - token.length)}`);
  if (costs.sellExchangeFee > 0) lines.push(`  Fee (${sellFeeLabel})${r('-$' + costs.sellExchangeFee.toFixed(3), w - 14 - sellFeeLabel.length)}`);
  if (costs.sellSlippage > 0) lines.push(`  Slippage${r('-$' + costs.sellSlippage.toFixed(3), w - 14)}`);

  lines.push('');
  lines.push(`Agent fees (x402)${r('-$' + costs.totalAgentFees.toFixed(3), w - 21)}`);
  lines.push(`Transfer: ${costs.transferNote}`);

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
