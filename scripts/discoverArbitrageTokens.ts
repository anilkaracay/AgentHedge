/**
 * Comprehensive token discovery: find all arbitrageable tokens on X Layer.
 * Usage: npx tsx scripts/discoverArbitrageTokens.ts
 */
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { getSwapQuote } from '@agenthedge/shared';

const USDC = '0x74b7f16337b8972027f6196a17a631ac6de26d22';
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', D = '\x1b[2m', X = '\x1b[0m';
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const CANDIDATES = [
  { symbol: 'OKB', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18, amount: '1000000000000000000' },
  { symbol: 'USDT', address: '0x1e4a5963abfd975d8c9021ce480b42188849d41d', decimals: 6, amount: '1000000' },
  { symbol: 'WETH', address: '0x5A77f1443D16ee5761d310e38b7308eBF9338FeC', decimals: 18, amount: '1000000000000000000' },
  { symbol: 'WETH-2', address: '0x4200000000000000000000000000000000000006', decimals: 18, amount: '1000000000000000000' },
  { symbol: 'WBTC-1', address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095', decimals: 8, amount: '100000000' },
  { symbol: 'WBTC-2', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, amount: '100000000' },
  { symbol: 'WBTC-3', address: '0xea034fb02eB1808C2cc3adbC15f447B93CbE08e1', decimals: 8, amount: '100000000' },
  { symbol: 'DAI-1', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, amount: '1000000000000000000' },
  { symbol: 'DAI-2', address: '0xC5015b9d9161Dca7e18e32f6f25C4aD850731Fd4', decimals: 18, amount: '1000000000000000000' },
  { symbol: 'LINK', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18, amount: '1000000000000000000' },
  { symbol: 'UNI', address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18, amount: '1000000000000000000' },
  { symbol: 'BNB', address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', decimals: 18, amount: '1000000000000000000' },
  { symbol: 'AAVE', address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', decimals: 18, amount: '1000000000000000000' },
  { symbol: 'MATIC', address: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', decimals: 18, amount: '1000000000000000000' },
  { symbol: 'OKT', address: '0x01e3D401FD0b285338e5F1133C39dC8c29b4e204', decimals: 18, amount: '1000000000000000000' },
];

interface DEXResult { symbol: string; address: string; decimals: number; price: number; route: string; found: boolean; error?: string }
interface CEXResult { venue: string; price: number; available: boolean }
interface TokenResult { dex: DEXResult; cex: Record<string, CEXResult>; bestSpread: number; bestSpreadVenue: string; arbitrageable: boolean }

async function tryDEXQuote(c: typeof CANDIDATES[0]): Promise<DEXResult> {
  try {
    const q = await getSwapQuote({ chainIndex: '196', fromTokenAddress: c.address, toTokenAddress: USDC, amount: c.amount, slippagePercent: '1' });
    const fromDec = parseInt(q.fromToken?.decimal ?? String(c.decimals));
    const toDec = parseInt(q.toToken?.decimal ?? '6');
    const price = (parseFloat(q.toTokenAmount) / Math.pow(10, toDec)) / (parseFloat(q.fromTokenAmount) / Math.pow(10, fromDec));
    const route = q.dexRouterList?.[0]?.dexProtocol.dexName ?? 'unknown';
    return { symbol: c.symbol, address: c.address, decimals: c.decimals, price, route, found: true };
  } catch (err) {
    const msg = (err as Error).message;
    const short = msg.includes('82000') ? 'No liquidity' : msg.includes('429') ? 'Rate limited' : msg.slice(0, 60);
    return { symbol: c.symbol, address: c.address, decimals: c.decimals, price: 0, route: '', found: false, error: short };
  }
}

async function tryCEX(symbol: string): Promise<Record<string, CEXResult>> {
  const base = symbol.replace(/-\d+$/, '');
  const results: Record<string, CEXResult> = {};

  const venues: { name: string; url: string; parse: (d: any) => number }[] = [
    { name: 'okx', url: `https://www.okx.com/api/v5/market/ticker?instId=${base}-USDT`, parse: d => parseFloat(d.data?.[0]?.last ?? '0') },
    { name: 'binance', url: `https://api.binance.com/api/v3/ticker/price?symbol=${base}USDT`, parse: d => parseFloat(d.price ?? '0') },
    { name: 'gateio', url: `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${base}_USDT`, parse: d => parseFloat(d[0]?.last ?? '0') },
  ];

  const promises = venues.map(async v => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(v.url, { signal: ctrl.signal });
      clearTimeout(t);
      const data = await res.json();
      const price = v.parse(data);
      results[v.name] = { venue: v.name, price, available: price > 0 };
    } catch {
      results[v.name] = { venue: v.name, price: 0, available: false };
    }
  });

  await Promise.allSettled(promises);
  return results;
}

async function main() {
  console.log(`\n${C}════════════════════════════════════════════════════════${X}`);
  console.log(`${C}  X Layer Arbitrage Token Discovery${X}`);
  console.log(`${C}════════════════════════════════════════════════════════${X}\n`);

  // ── Step 1: DEX Quotes ──
  console.log(`${Y}--- Step 1: X Layer DEX Token Discovery (${CANDIDATES.length} candidates) ---${X}\n`);
  const dexResults: DEXResult[] = [];

  for (const c of CANDIDATES) {
    const r = await tryDEXQuote(c);
    dexResults.push(r);
    if (r.found) {
      console.log(`  ${G}${r.symbol.padEnd(10)}${X} $${r.price.toFixed(4).padEnd(14)} ${r.route.padEnd(16)} ${r.address.slice(0, 10)}...`);
    } else {
      console.log(`  ${R}${r.symbol.padEnd(10)}${X} ${D}${r.error}${X}`);
    }
    await sleep(2500);
  }

  const found = dexResults.filter(r => r.found);
  console.log(`\n  Found: ${G}${found.length}${X}/${CANDIDATES.length} tokens with DEX liquidity\n`);

  // ── Step 2: Reverse Discovery ──
  console.log(`${Y}--- Step 2: Reverse Discovery (100 USDC -> token) ---${X}\n`);
  const reverseTargets = dexResults.filter(r => !r.found).slice(0, 5);
  for (const t of reverseTargets) {
    try {
      const q = await getSwapQuote({ chainIndex: '196', fromTokenAddress: USDC, toTokenAddress: t.address, amount: '100000000', slippagePercent: '1' });
      const received = parseFloat(q.toTokenAmount) / Math.pow(10, t.decimals);
      console.log(`  ${G}100 USDC -> ${received.toFixed(6)} ${t.symbol}${X} via ${q.dexRouterList?.[0]?.dexProtocol.dexName ?? 'unknown'}`);
      // Update as found
      const idx = dexResults.indexOf(t);
      if (idx >= 0) {
        dexResults[idx].found = true;
        dexResults[idx].price = 100 / received;
        dexResults[idx].route = q.dexRouterList?.[0]?.dexProtocol.dexName ?? 'unknown';
        found.push(dexResults[idx]);
      }
    } catch {
      console.log(`  ${D}${t.symbol}: no reverse liquidity${X}`);
    }
    await sleep(2500);
  }

  // ── Step 3: CEX Availability ──
  console.log(`\n${Y}--- Step 3: CEX Price Availability ---${X}\n`);
  const tokenResults: TokenResult[] = [];

  for (const d of found) {
    const cex = await tryCEX(d.symbol);
    await sleep(500);

    // Calculate spreads
    let bestSpread = 0;
    let bestSpreadVenue = '';
    for (const [venue, c] of Object.entries(cex)) {
      if (c.available && c.price > 0 && d.price > 0) {
        const spread = Math.abs(c.price - d.price) / c.price * 100;
        if (spread > bestSpread) { bestSpread = spread; bestSpreadVenue = venue; }
      }
    }

    const arbitrageable = bestSpread > 0;
    tokenResults.push({ dex: d, cex, bestSpread, bestSpreadVenue, arbitrageable });

    const okxStr = cex.okx?.available ? `$${cex.okx.price.toFixed(4)}` : '--';
    const binStr = cex.binance?.available ? `$${cex.binance.price.toFixed(4)}` : '--';
    const gateStr = cex.gateio?.available ? `$${cex.gateio.price.toFixed(4)}` : '--';
    const arbIcon = arbitrageable ? `${G}YES${X}` : `${R}NO${X}`;
    const spreadStr = bestSpread > 0 ? `${bestSpread.toFixed(4)}% (${bestSpreadVenue})` : '--';

    console.log(`  ${d.symbol.padEnd(10)} DEX $${d.price.toFixed(4).padEnd(12)} OKX: ${okxStr.padEnd(12)} Binance: ${binStr.padEnd(12)} Gate: ${gateStr.padEnd(12)} Arb: ${arbIcon}  Spread: ${spreadStr}`);
  }

  // ── Step 4: Summary ──
  const arbTokens = tokenResults.filter(t => t.arbitrageable).sort((a, b) => b.bestSpread - a.bestSpread);

  console.log(`\n${C}════════════════════════════════════════════════════════${X}`);
  console.log(`${C}  Discovery Results${X}`);
  console.log(`${C}════════════════════════════════════════════════════════${X}\n`);
  console.log(`  Total candidates tested:    ${CANDIDATES.length}`);
  console.log(`  Tokens with DEX liquidity:  ${found.length}`);
  console.log(`  Arbitrageable (DEX + CEX):  ${arbTokens.length}`);

  if (arbTokens.length > 0) {
    console.log(`\n  ${C}Recommended token list:${X}\n`);
    console.log(`  ${'PRI'.padEnd(4)} ${'TOKEN'.padEnd(8)} ${'DEX PRICE'.padEnd(14)} ${'BEST CEX'.padEnd(14)} ${'SPREAD'.padEnd(10)} ${'ROUTE'.padEnd(16)} REASON`);
    console.log(`  ${'-'.repeat(90)}`);
    arbTokens.forEach((t, i) => {
      const cexPrice = Object.values(t.cex).find(c => c.venue === t.bestSpreadVenue)?.price ?? 0;
      const isOKX = t.bestSpreadVenue === 'okx';
      const reason = t.dex.symbol === 'OKB' ? 'Native token, $0 OKX transfer' :
                     t.dex.symbol === 'USDT' ? 'Stablecoin depeg detection' :
                     isOKX ? 'OKX listed, $0 X Layer transfer' : 'Multi-CEX listed';
      console.log(`  ${String(i + 1).padEnd(4)} ${t.dex.symbol.padEnd(8)} $${t.dex.price.toFixed(4).padEnd(13)} $${cexPrice.toFixed(4).padEnd(13)} ${t.bestSpread.toFixed(4).padEnd(9)}% ${t.dex.route.padEnd(16)} ${reason}`);
    });
  }

  // Save results
  const output = {
    timestamp: new Date().toISOString(),
    totalCandidates: CANDIDATES.length,
    dexLiquidity: found.length,
    arbitrageable: arbTokens.length,
    tokens: tokenResults.map(t => ({
      symbol: t.dex.symbol,
      address: t.dex.address,
      decimals: t.dex.decimals,
      dexPrice: t.dex.price,
      dexRoute: t.dex.route,
      cexPrices: Object.fromEntries(Object.entries(t.cex).filter(([, v]) => v.available).map(([k, v]) => [k, v.price])),
      bestSpread: t.bestSpread,
      bestSpreadVenue: t.bestSpreadVenue,
      arbitrageable: t.arbitrageable,
    })),
    recommended: arbTokens.map(t => ({ symbol: t.dex.symbol, address: t.dex.address, decimals: t.dex.decimals, quoteAmount: CANDIDATES.find(c => c.symbol === t.dex.symbol)?.amount ?? '' })),
  };

  const outPath = path.resolve(__dirname, 'token-discovery-results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n  Results saved to ${outPath}\n`);
}

main().catch(console.error);
