import { logInfo } from './logger.js';
import type { ArbitrageOpportunity, VenuePrice } from './types.js';

// ── Fee Structure ──

export const FEE_STRUCTURE = {
  // DEX fees
  xlayerDexSwapFee: 0.003,       // 0.3%
  xlayerGas: 0.0,

  // CEX taker fees
  okxTakerFee: 0.001,            // 0.1%
  binanceTakerFee: 0.001,
  gateioTakerFee: 0.002,         // 0.2%
  bybitTakerFee: 0.001,
  kucoinTakerFee: 0.001,
  mexcTakerFee: 0.0005,          // 0.05%
  htxTakerFee: 0.002,

  // Transfer fees
  okbWithdrawalFee: 0.1,         // ~0.1 OKB
  usdtWithdrawalFee: 1.0,
  bridgeFee: 0.5,

  // Agent fees
  scoutFee: 0.02,
  analystFee: 0.03,
};

function getVenueFee(venue: string): number {
  const fees: Record<string, number> = {
    'okx': FEE_STRUCTURE.okxTakerFee,
    'binance': FEE_STRUCTURE.binanceTakerFee,
    'gateio': FEE_STRUCTURE.gateioTakerFee,
    'bybit': FEE_STRUCTURE.bybitTakerFee,
    'kucoin': FEE_STRUCTURE.kucoinTakerFee,
    'mexc': FEE_STRUCTURE.mexcTakerFee,
    'htx': FEE_STRUCTURE.htxTakerFee,
    'xlayer-dex': FEE_STRUCTURE.xlayerDexSwapFee,
  };
  return fees[venue] ?? 0.002;
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

  bridgeFee: number;
  withdrawalFee: number;

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

// ── Estimation (pre-trade) ──

export function estimateTradeCosts(
  opportunity: ArbitrageOpportunity,
  tradeSizeUSDC: number
): TradeCosts {
  const buyVenue = opportunity.buyVenue;
  const sellVenue = opportunity.sellVenue;

  const buyPrice = buyVenue.price;
  const sellPrice = sellVenue.price;
  const buyAmount = tradeSizeUSDC / buyPrice;

  const buyFeeRate = getVenueFee(buyVenue.venue);
  const sellFeeRate = getVenueFee(sellVenue.venue);

  const buyTotal = buyAmount * buyPrice;
  const buyExchangeFee = buyTotal * buyFeeRate;
  const buySlippage = buyVenue.venueType === 'dex' ? buyTotal * 0.001 : 0; // 0.1% DEX slippage
  const buyGas = buyVenue.venueType === 'dex' ? FEE_STRUCTURE.xlayerGas : 0;

  const sellAmount = buyAmount;
  const sellTotal = sellAmount * sellPrice;
  const sellExchangeFee = sellTotal * sellFeeRate;
  const sellSlippage = sellVenue.venueType === 'dex' ? sellTotal * 0.001 : 0;
  const sellGas = sellVenue.venueType === 'dex' ? FEE_STRUCTURE.xlayerGas : 0;

  // Cross-venue transfer costs
  const needsTransfer = buyVenue.venue !== sellVenue.venue;
  const bridgeFee = needsTransfer ? FEE_STRUCTURE.bridgeFee : 0;
  const withdrawalFee = needsTransfer && buyVenue.venueType === 'cex' ? FEE_STRUCTURE.okbWithdrawalFee * buyPrice : 0;

  const scoutFee = FEE_STRUCTURE.scoutFee;
  const analystFee = FEE_STRUCTURE.analystFee;
  const totalAgentFees = scoutFee + analystFee;

  const grossProfit = sellTotal - buyTotal;
  const totalCosts = buyExchangeFee + buySlippage + buyGas +
                     sellExchangeFee + sellSlippage + sellGas +
                     totalAgentFees + bridgeFee + withdrawalFee;
  const netProfit = grossProfit - totalCosts;
  const netProfitPercent = buyTotal > 0 ? (netProfit / buyTotal) * 100 : 0;

  return {
    buyPrice, buyAmount, buyTotal,
    buySlippage, buyGas, buyExchangeFee,
    sellPrice, sellAmount, sellTotal,
    sellSlippage, sellGas, sellExchangeFee,
    scoutFee, analystFee, totalAgentFees,
    bridgeFee, withdrawalFee,
    grossProfit: parseFloat(grossProfit.toFixed(6)),
    totalCosts: parseFloat(totalCosts.toFixed(6)),
    netProfit: parseFloat(netProfit.toFixed(6)),
    netProfitPercent: parseFloat(netProfitPercent.toFixed(4)),
    profitable: netProfit > 0,
  };
}

// ── Cost Breakdown ──

export function getCostBreakdown(costs: TradeCosts): CostBreakdown[] {
  const gross = Math.abs(costs.grossProfit) || 1;
  const items: CostBreakdown[] = [];
  const add = (cat: string, item: string, amt: number) => {
    if (amt > 0) items.push({ category: cat, item, amount: parseFloat(amt.toFixed(6)), percent: parseFloat(((amt / gross) * 100).toFixed(2)) });
  };

  add('Buy Side', 'Exchange fee', costs.buyExchangeFee);
  add('Buy Side', 'Slippage', costs.buySlippage);
  add('Buy Side', 'Gas', costs.buyGas);
  add('Sell Side', 'Exchange fee', costs.sellExchangeFee);
  add('Sell Side', 'Slippage', costs.sellSlippage);
  add('Sell Side', 'Gas', costs.sellGas);
  add('Agent Fees', 'Scout (x402)', costs.scoutFee);
  add('Agent Fees', 'Analyst (x402)', costs.analystFee);
  add('Transfer', 'Bridge fee', costs.bridgeFee);
  add('Transfer', 'Withdrawal fee', costs.withdrawalFee);

  return items;
}

// ── Formatted Report ──

export function formatProfitReport(costs: TradeCosts, buyVenue: string, sellVenue: string, token: string): string {
  const lines: string[] = [];
  const w = 62;
  const pad = (s: string, n: number) => s.padEnd(n);
  const right = (s: string, n: number) => s.padStart(n);

  lines.push(`BUY  ${costs.buyAmount.toFixed(4)} ${token} @ $${costs.buyPrice.toFixed(2)} on ${buyVenue}${right('-$' + costs.buyTotal.toFixed(2), w - 30 - buyVenue.length - token.length)}`);
  if (costs.buyExchangeFee > 0) lines.push(`  Exchange fee (${(getVenueFee(buyVenue) * 100).toFixed(1)}%)${right('-$' + costs.buyExchangeFee.toFixed(3), w - 30)}`);
  if (costs.withdrawalFee > 0) lines.push(`  Withdrawal fee${right('-$' + costs.withdrawalFee.toFixed(3), w - 20)}`);

  lines.push('');
  lines.push(`SELL ${costs.sellAmount.toFixed(4)} ${token} @ $${costs.sellPrice.toFixed(2)} on ${sellVenue}${right('+$' + costs.sellTotal.toFixed(2), w - 30 - sellVenue.length - token.length)}`);
  if (costs.sellExchangeFee > 0) lines.push(`  Swap/exchange fee (${(getVenueFee(sellVenue) * 100).toFixed(1)}%)${right('-$' + costs.sellExchangeFee.toFixed(3), w - 34)}`);
  if (costs.sellSlippage > 0) lines.push(`  Slippage${right('-$' + costs.sellSlippage.toFixed(3), w - 14)}`);

  lines.push('');
  lines.push(`Agent fees (Scout + Analyst)${right('-$' + costs.totalAgentFees.toFixed(3), w - 31)}`);
  if (costs.bridgeFee > 0) lines.push(`Bridge fee${right('-$' + costs.bridgeFee.toFixed(3), w - 14)}`);

  lines.push('');
  lines.push('-'.repeat(w));
  lines.push(`Gross profit${right((costs.grossProfit >= 0 ? '+' : '') + '$' + costs.grossProfit.toFixed(3), w - 16)}`);
  lines.push(`Total costs${right('-$' + costs.totalCosts.toFixed(3), w - 15)}`);
  lines.push('-'.repeat(w));
  const sign = costs.netProfit >= 0 ? '+' : '';
  lines.push(`NET PROFIT${right(sign + '$' + costs.netProfit.toFixed(3), w - 14)}`);
  lines.push(`NET PROFIT %${right(sign + costs.netProfitPercent.toFixed(2) + '%', w - 16)}`);
  lines.push(`VERDICT${right(costs.profitable ? 'PROFITABLE' : 'NOT PROFITABLE', w - 11)}`);

  return lines.join('\n');
}
