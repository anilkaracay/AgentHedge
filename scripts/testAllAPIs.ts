/**
 * Comprehensive OnchainOS API endpoint discovery.
 * Tests every possible path/param combination to find what works.
 * Usage: npx tsx scripts/testAllAPIs.ts
 */
import CryptoJS from 'crypto-js';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', D = '\x1b[2m', X = '\x1b[0m';
const BASE = 'https://web3.okx.com';
const TREASURY = '0x89583a5f27585309639d7Ed4ce30814d581F68Ed';
const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function getHeaders(method: string, requestPath: string, queryString: string = '') {
  const ts = new Date().toISOString();
  const sign = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(ts + method + requestPath + queryString, process.env.OKX_SECRET_KEY!)
  );
  return {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY': process.env.OKX_API_KEY!,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': ts,
    'OK-ACCESS-PASSPHRASE': process.env.OKX_PASSPHRASE!,
    'OK-ACCESS-PROJECT': process.env.OKX_PROJECT_ID!,
  };
}

interface TestResult {
  endpoint: string;
  params: string;
  method: string;
  status: number;
  code: string;
  msg: string;
  hasData: boolean;
  preview: string;
}

const results: TestResult[] = [];

async function tryEndpoint(ep: string, params: Record<string, string>, method: string = 'GET'): Promise<void> {
  const qs = Object.keys(params).length > 0 ? '?' + new URLSearchParams(params).toString() : '';
  const headers = getHeaders(method, ep, qs);
  const url = `${BASE}${ep}${qs}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { method, headers, signal: ctrl.signal });
    clearTimeout(t);

    let body: any;
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }

    const code = body.code ?? body.error_code ?? '';
    const msg = body.msg ?? body.error_message ?? '';
    const hasData = code === '0' || (body.data && (Array.isArray(body.data) ? body.data.length > 0 : Object.keys(body.data).length > 0));
    const preview = JSON.stringify(body).slice(0, 300);

    const icon = hasData && code === '0' ? G + 'OK' + X : code === '0' ? Y + 'EMPTY' + X : R + code + X;
    console.log(`  ${icon.padEnd(18)} ${res.status} ${ep}${D}${qs.slice(0, 60)}${X}`);
    if (hasData && code === '0') console.log(`    ${D}${preview.slice(0, 200)}${X}`);

    results.push({ endpoint: ep, params: qs, method, status: res.status, code, msg, hasData: hasData && code === '0', preview });
  } catch (err) {
    const msg = (err as Error).message.slice(0, 40);
    console.log(`  ${R}ERR${X}  ${ep}${D}${qs.slice(0, 40)} — ${msg}${X}`);
    results.push({ endpoint: ep, params: qs, method, status: 0, code: 'ERR', msg, hasData: false, preview: '' });
  }
}

async function tryPublic(url: string, desc: string): Promise<void> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    const body = await res.json() as any;
    const code = body.code ?? '';
    const hasData = code === '0' && body.data;
    const icon = hasData ? G + 'OK' + X : R + (code || res.status) + X;
    const preview = JSON.stringify(body).slice(0, 200);
    console.log(`  ${icon.padEnd(18)} ${desc}`);
    if (hasData) console.log(`    ${D}${preview}${X}`);
    results.push({ endpoint: url, params: '', method: 'GET', status: res.status, code, msg: '', hasData: !!hasData, preview });
  } catch (err) {
    console.log(`  ${R}ERR${X}  ${desc} — ${(err as Error).message.slice(0, 40)}`);
  }
}

async function main() {
  console.log(`\n${C}${'='.repeat(70)}${X}`);
  console.log(`${C}  OnchainOS API Endpoint Discovery${X}`);
  console.log(`${C}${'='.repeat(70)}${X}\n`);

  // ── Step 1: Market API ──
  console.log(`${Y}--- Step 1: Market API Variations ---${X}\n`);

  const marketPaths = [
    '/api/v6/dex/market/price-info',
    '/api/v6/market/price-info',
    '/api/v6/dex/market/token-price',
    '/api/v5/dex/market/price-info',
    '/api/v5/market/price-info',
    '/api/v6/market/token/price-info',
    '/api/v6/market/index/tickers',
    '/api/v6/dex/market/tickers',
  ];

  const marketParams = [
    { chainIndex: '196', tokenAddress: NATIVE },
    { chainId: '196', tokenContractAddress: NATIVE },
    { chainIndex: '196' },
  ];

  for (const ep of marketPaths) {
    for (const params of marketParams) {
      await tryEndpoint(ep, params);
      await sleep(800);
    }
  }

  // ── Step 2: Wallet API ──
  console.log(`\n${Y}--- Step 2: Wallet API Variations ---${X}\n`);

  const walletPaths = [
    '/api/v6/wallet/asset/token-balances',
    '/api/v6/wallet/asset/total-value',
    '/api/v5/wallet/asset/token-balances',
    '/api/v5/wallet/asset/total-value',
    '/api/v6/wallet/balance',
    '/api/v5/wallet/balance',
    '/api/v6/dex/wallet/token-balances',
    '/api/v5/dex/balance/token-balances',
  ];

  const walletParams = [
    { chainIndex: '196', address: TREASURY },
    { chainId: '196', address: TREASURY },
    { address: TREASURY },
  ];

  for (const ep of walletPaths) {
    for (const params of walletParams) {
      await tryEndpoint(ep, params);
      await sleep(800);
    }
  }

  // ── Step 3: OKX Public Endpoints ──
  console.log(`\n${Y}--- Step 3: OKX Public Endpoints (no auth) ---${X}\n`);

  const publicEndpoints = [
    { url: 'https://www.okx.com/api/v5/market/ticker?instId=OKB-USDT', desc: 'OKX spot ticker OKB-USDT' },
    { url: 'https://www.okx.com/api/v5/market/candles?instId=OKB-USDT&bar=5m&limit=3', desc: 'OKX candles OKB-USDT 5m' },
    { url: 'https://www.okx.com/api/v5/market/trades?instId=OKB-USDT&limit=3', desc: 'OKX recent trades OKB-USDT' },
    { url: 'https://www.okx.com/api/v5/market/books?instId=OKB-USDT&sz=3', desc: 'OKX order book OKB-USDT' },
    { url: 'https://www.okx.com/api/v5/market/index-tickers?instId=OKB-USDT', desc: 'OKX index price OKB-USDT' },
  ];

  for (const { url, desc } of publicEndpoints) {
    await tryPublic(url, desc);
    await sleep(500);
  }

  // ── Step 4: OnchainOS Market API with POST ──
  console.log(`\n${Y}--- Step 4: Market API with POST method ---${X}\n`);

  for (const ep of ['/api/v6/dex/market/price-info', '/api/v5/dex/market/price-info']) {
    for (const params of [{ chainIndex: '196', tokenAddress: NATIVE }]) {
      const body = JSON.stringify(params);
      const ts = new Date().toISOString();
      const sign = CryptoJS.enc.Base64.stringify(
        CryptoJS.HmacSHA256(ts + 'POST' + ep + body, process.env.OKX_SECRET_KEY!)
      );
      try {
        const res = await fetch(`${BASE}${ep}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'OK-ACCESS-KEY': process.env.OKX_API_KEY!,
            'OK-ACCESS-SIGN': sign,
            'OK-ACCESS-TIMESTAMP': ts,
            'OK-ACCESS-PASSPHRASE': process.env.OKX_PASSPHRASE!,
            'OK-ACCESS-PROJECT': process.env.OKX_PROJECT_ID!,
          },
          body,
        });
        const data = await res.json() as any;
        const code = data.code ?? '';
        const icon = code === '0' ? G + 'OK' + X : R + code + X;
        console.log(`  ${icon.padEnd(18)} POST ${ep}`);
        if (code === '0') console.log(`    ${D}${JSON.stringify(data).slice(0, 200)}${X}`);
      } catch (err) {
        console.log(`  ${R}ERR${X}  POST ${ep}`);
      }
      await sleep(800);
    }
  }

  // ── Step 5: OnchainOS docs pages ──
  console.log(`\n${Y}--- Step 5: OnchainOS Documentation ---${X}\n`);

  for (const url of [
    'https://web3.okx.com/api/v6/dex/aggregator/supported/chain',
  ]) {
    const qs = '';
    const headers = getHeaders('GET', '/api/v6/dex/aggregator/supported/chain', qs);
    try {
      const res = await fetch(url, { headers });
      const data = await res.json() as any;
      if (data.code === '0' && Array.isArray(data.data)) {
        const xlayer = data.data.find((c: any) => c.chainIndex === '196' || c.chainName?.toLowerCase().includes('xlayer'));
        console.log(`  ${G}Supported chains: ${data.data.length}${X}`);
        if (xlayer) console.log(`  ${G}X Layer found: ${JSON.stringify(xlayer).slice(0, 200)}${X}`);
        else console.log(`  ${Y}X Layer not in list. First 3: ${data.data.slice(0, 3).map((c: any) => c.chainName || c.chainIndex).join(', ')}${X}`);
      } else {
        console.log(`  ${R}${data.code}: ${data.msg}${X}`);
      }
    } catch (err) {
      console.log(`  ${R}Failed: ${(err as Error).message.slice(0, 40)}${X}`);
    }
  }

  // ── Summary ──
  console.log(`\n${C}${'='.repeat(70)}${X}`);
  console.log(`${C}  Summary${X}`);
  console.log(`${C}${'='.repeat(70)}${X}\n`);

  const working = results.filter(r => r.hasData);
  const failed = results.filter(r => !r.hasData);

  if (working.length > 0) {
    console.log(`  ${G}WORKING ENDPOINTS (${working.length}):${X}\n`);
    for (const r of working) {
      console.log(`    ${r.method} ${r.endpoint}${r.params.slice(0, 50)}`);
      console.log(`      ${D}${r.preview.slice(0, 150)}${X}\n`);
    }
  } else {
    console.log(`  ${R}No new working endpoints found.${X}\n`);
  }

  console.log(`  Total tested: ${results.length}`);
  console.log(`  Working: ${G}${working.length}${X}`);
  console.log(`  Failed: ${R}${failed.length}${X}\n`);

  console.log(`  ${Y}RECOMMENDATION:${X}`);
  if (working.some(r => r.endpoint.includes('market'))) {
    console.log(`  Market API endpoints found. Integrate into Scout/Analyst.`);
  } else {
    console.log(`  No Market API endpoints available. Continue using aggregator/quote as price oracle.`);
  }
  if (working.some(r => r.endpoint.includes('wallet'))) {
    console.log(`  Wallet API endpoints found. Integrate into Treasury.`);
  } else {
    console.log(`  No Wallet API endpoints available. Continue using ethers.js RPC for balances.`);
  }
  console.log('');
}

main().catch(console.error);
