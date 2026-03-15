/**
 * Token discovery: find all tradeable tokens on X Layer with CEX price availability.
 * Usage: npx tsx scripts/discoverTokens.ts
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { getSwapQuote } from '@agenthedge/shared';

const USDC = '0x74b7f16337b8972027f6196a17a631ac6de26d22';
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', D = '\x1b[2m', X = '\x1b[0m';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const CANDIDATES = [
  { symbol: 'OKB', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18 },
  { symbol: 'USDT', address: '0x1e4a5963abfd975d8c9021ce480b42188849d41d', decimals: 6 },
  { symbol: 'WETH', address: '0x5A77f1443D16ee5761d310e38b7308eBF9338FeC', decimals: 18 },
  { symbol: 'WBTC-1', address: '0xea034fb02eB1808C2cc3adbC15f447B93CbE08e1', decimals: 8 },
  { symbol: 'WBTC-2', address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095', decimals: 8 },
  { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
  { symbol: 'BNB', address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', decimals: 18 },
  { symbol: 'LINK', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18 },
];

interface Result {
  symbol: string;
  address: string;
  dexPrice: number;
  dexRoute: string;
  okxPrice: number;
  binancePrice: number;
  arbitrageable: boolean;
  spread: number;
}

async function tryDEXQuote(symbol: string, address: string, decimals: number): Promise<{ price: number; route: string } | null> {
  try {
    const amount = BigInt(Math.pow(10, decimals)).toString();
    const q = await getSwapQuote({
      chainIndex: '196', fromTokenAddress: address, toTokenAddress: USDC, amount, slippagePercent: '0.5',
    });
    const price = parseFloat(q.toTokenAmount) / 1e6;
    const route = q.dexRouterList?.[0]?.dexProtocol.dexName ?? 'unknown';
    return { price, route };
  } catch (err) {
    console.log(`  ${R}${symbol}: DEX quote failed — ${(err as Error).message.slice(0, 80)}${X}`);
    return null;
  }
}

async function tryOKX(symbol: string): Promise<number> {
  const base = symbol.replace(/-\d+$/, ''); // strip -1, -2 suffixes
  for (const instId of [`${base}-USDT`, `${base}-USDC`]) {
    try {
      const res = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`);
      const data = await res.json() as any;
      if (data.data?.[0]?.last) return parseFloat(data.data[0].last);
    } catch { /* next */ }
  }
  return 0;
}

async function tryBinance(symbol: string): Promise<number> {
  const base = symbol.replace(/-\d+$/, '');
  for (const pair of [`${base}USDT`, `${base}USDC`]) {
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
      const data = await res.json() as any;
      if (data.price) return parseFloat(data.price);
    } catch { /* next */ }
  }
  return 0;
}

async function main() {
  console.log(`\n${C}========================================${X}`);
  console.log(`${C}  X Layer Token Discovery${X}`);
  console.log(`${C}========================================${X}\n`);

  // ── Step 1: DEX Quotes ──
  console.log(`${Y}--- Step 1: X Layer DEX Quotes ---${X}\n`);
  const dexResults: { symbol: string; address: string; decimals: number; price: number; route: string }[] = [];

  for (const c of CANDIDATES) {
    const r = await tryDEXQuote(c.symbol, c.address, c.decimals);
    if (r && r.price > 0) {
      dexResults.push({ ...c, price: r.price, route: r.route });
      console.log(`  ${G}${c.symbol}: $${r.price.toFixed(4)} via ${r.route}${X}`);
    }
    await sleep(2500);
  }

  console.log(`\n  Found ${dexResults.length}/${CANDIDATES.length} tokens with DEX liquidity\n`);

  // ── Step 2: CEX Prices ──
  console.log(`${Y}--- Step 2: CEX Price Availability ---${X}\n`);
  const results: Result[] = [];

  for (const d of dexResults) {
    const okx = await tryOKX(d.symbol);
    await sleep(500);
    const binance = await tryBinance(d.symbol);
    await sleep(500);

    const cexPrice = okx || binance;
    const arbitrageable = cexPrice > 0;
    const spread = cexPrice > 0 ? Math.abs(cexPrice - d.price) / cexPrice * 100 : 0;

    results.push({
      symbol: d.symbol, address: d.address,
      dexPrice: d.price, dexRoute: d.route,
      okxPrice: okx, binancePrice: binance,
      arbitrageable, spread,
    });

    const okxStr = okx > 0 ? `$${okx.toFixed(4)}` : '--';
    const binStr = binance > 0 ? `$${binance.toFixed(4)}` : '--';
    const arbStr = arbitrageable ? `${G}YES${X}` : `${R}NO${X}`;
    const spreadStr = spread > 0 ? `${spread.toFixed(4)}%` : '--';
    console.log(`  ${d.symbol.padEnd(8)} DEX: $${d.price.toFixed(4).padEnd(12)} OKX: ${okxStr.padEnd(12)} Binance: ${binStr.padEnd(12)} Arb: ${arbStr}  Spread: ${spreadStr}`);
  }

  // ── Step 3: Reverse Discovery (USDC → token) ──
  console.log(`\n${Y}--- Step 3: Reverse Discovery (100 USDC → token) ---${X}\n`);
  const reverseTargets = ['OKB', 'WETH', 'USDT'];
  for (const sym of reverseTargets) {
    const found = dexResults.find(d => d.symbol === sym);
    if (!found) {
      // Try as reverse quote
      const candidate = CANDIDATES.find(c => c.symbol === sym);
      if (!candidate) continue;
      try {
        const q = await getSwapQuote({
          chainIndex: '196', fromTokenAddress: USDC, toTokenAddress: candidate.address,
          amount: '100000000', // 100 USDC
          slippagePercent: '0.5',
        });
        const received = parseFloat(q.toTokenAmount) / Math.pow(10, candidate.decimals);
        console.log(`  100 USDC → ${received.toFixed(6)} ${sym} via ${q.dexRouterList?.[0]?.dexProtocol.dexName ?? 'unknown'}`);
      } catch (err) {
        console.log(`  ${R}100 USDC → ${sym}: failed${X}`);
      }
    } else {
      console.log(`  ${sym}: already discovered via forward quote`);
    }
    await sleep(2500);
  }

  // ── Summary ──
  const arbTokens = results.filter(r => r.arbitrageable);
  arbTokens.sort((a, b) => b.spread - a.spread);

  console.log(`\n${C}========================================${X}`);
  console.log(`${C}  Discovery Results${X}`);
  console.log(`${C}========================================${X}\n`);
  console.log(`  Tokens with X Layer DEX liquidity: ${dexResults.length}`);
  console.log(`  Tokens arbitrageable (DEX + CEX):  ${arbTokens.length}`);
  if (arbTokens.length > 0) {
    console.log(`  Best spread: ${arbTokens[0].symbol} at ${arbTokens[0].spread.toFixed(4)}%`);
  }

  console.log(`\n  ${C}Arbitrageable Tokens:${X}`);
  for (const t of arbTokens) {
    console.log(`    ${t.symbol.padEnd(8)} DEX: $${t.dexPrice.toFixed(4).padEnd(12)} CEX: $${(t.okxPrice || t.binancePrice).toFixed(4).padEnd(12)} Spread: ${t.spread.toFixed(4)}%  Route: ${t.dexRoute}`);
  }

  // Output for tokenRegistry update
  console.log(`\n  ${Y}Recommended TRACKED_TOKENS:${X}`);
  for (const t of arbTokens) {
    const cexSym = `${t.symbol.replace(/-\d+$/, '')}USDC`;
    console.log(`    { symbol: '${t.symbol.replace(/-\d+$/, '')}', xlayerAddress: '${t.address}', cexSymbol: '${cexSym}', decimals: ${CANDIDATES.find(c => c.symbol === t.symbol)?.decimals ?? 18}, quoteAmount: '${BigInt(Math.pow(10, CANDIDATES.find(c => c.symbol === t.symbol)?.decimals ?? 18)).toString()}' },`);
  }

  console.log('');
}

main().catch(console.error);
