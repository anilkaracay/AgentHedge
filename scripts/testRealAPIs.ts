/**
 * Test REAL OnchainOS endpoints found in onchainos-skills source code.
 * Key discovery: Market price is POST (not GET), Wallet uses /dex/balance/ path.
 */
import CryptoJS from 'crypto-js';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', D = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
const BASE = 'https://web3.okx.com';
const TREASURY = '0x89583a5f27585309639d7Ed4ce30814d581F68Ed';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'; // lowercase per docs

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function headers(method: string, path: string, body: string = '') {
  const ts = new Date().toISOString();
  const sign = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(ts + method + path + body, process.env.OKX_SECRET_KEY!)
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

async function testGET(label: string, apiPath: string, params: [string, string][]) {
  const qs = params.length > 0 ? '?' + new URLSearchParams(params).toString() : '';
  const h = headers('GET', apiPath, qs);
  try {
    const res = await fetch(`${BASE}${apiPath}${qs}`, { headers: h });
    const data = await res.json() as any;
    const ok = data.code === '0' || data.code === 0;
    const icon = ok ? `${G}OK${X}` : `${R}${data.code}${X}`;
    console.log(`  ${icon.padEnd(16)} GET  ${label}`);
    if (ok) console.log(`    ${D}${JSON.stringify(data).slice(0, 250)}${X}`);
    else console.log(`    ${D}${data.msg || JSON.stringify(data).slice(0, 150)}${X}`);
    return ok;
  } catch (err) {
    console.log(`  ${R}ERR${X}  GET  ${label} — ${(err as Error).message.slice(0, 40)}`);
    return false;
  }
}

async function testPOST(label: string, apiPath: string, body: any) {
  const bodyStr = JSON.stringify(body);
  const h = headers('POST', apiPath, bodyStr);
  try {
    const res = await fetch(`${BASE}${apiPath}`, { method: 'POST', headers: h, body: bodyStr });
    const data = await res.json() as any;
    const ok = data.code === '0' || data.code === 0;
    const icon = ok ? `${G}OK${X}` : `${R}${data.code}${X}`;
    console.log(`  ${icon.padEnd(16)} POST ${label}`);
    if (ok) console.log(`    ${D}${JSON.stringify(data).slice(0, 300)}${X}`);
    else console.log(`    ${D}${data.msg || JSON.stringify(data).slice(0, 150)}${X}`);
    return ok;
  } catch (err) {
    console.log(`  ${R}ERR${X}  POST ${label} — ${(err as Error).message.slice(0, 40)}`);
    return false;
  }
}

async function main() {
  console.log(`\n${C}${B}${'='.repeat(70)}${X}`);
  console.log(`${C}${B}  OnchainOS Real API Endpoint Test${X}`);
  console.log(`${C}${B}  (endpoints from onchainos-skills Rust source)${X}`);
  console.log(`${C}${B}${'='.repeat(70)}${X}\n`);

  const working: string[] = [];

  // ── MARKET API ──
  console.log(`${Y}--- Market API ---${X}\n`);

  // POST /api/v6/dex/market/price — body is JSON array
  if (await testPOST('Market Price (OKB on XLayer)', '/api/v6/dex/market/price',
    [{ chainIndex: '196', tokenAddress: NATIVE }]
  )) working.push('POST /api/v6/dex/market/price');
  await sleep(1500);

  // POST /api/v6/dex/market/price-info — body is JSON array
  if (await testPOST('Market Price-Info (OKB on XLayer)', '/api/v6/dex/market/price-info',
    [{ chainIndex: '196', tokenAddress: NATIVE }]
  )) working.push('POST /api/v6/dex/market/price-info');
  await sleep(1500);

  // GET /api/v6/dex/market/candles
  if (await testGET('Market Candles (OKB 1H)', '/api/v6/dex/market/candles',
    [['chainIndex', '196'], ['tokenAddress', NATIVE], ['bar', '1H'], ['limit', '3']]
  )) working.push('GET /api/v6/dex/market/candles');
  await sleep(1500);

  // POST /api/v6/dex/index/current-price
  if (await testPOST('Index Price (OKB)', '/api/v6/dex/index/current-price',
    [{ chainIndex: '196', tokenAddress: NATIVE }]
  )) working.push('POST /api/v6/dex/index/current-price');
  await sleep(1500);

  // GET /api/v6/dex/market/trades
  if (await testGET('Market Trades (OKB)', '/api/v6/dex/market/trades',
    [['chainIndex', '196'], ['tokenAddress', NATIVE], ['limit', '3']]
  )) working.push('GET /api/v6/dex/market/trades');
  await sleep(1500);

  // ── WALLET / BALANCE API ──
  console.log(`\n${Y}--- Wallet/Balance API ---${X}\n`);

  // GET /api/v6/dex/balance/supported/chain
  if (await testGET('Balance Supported Chains', '/api/v6/dex/balance/supported/chain', []))
    working.push('GET /api/v6/dex/balance/supported/chain');
  await sleep(1500);

  // GET /api/v6/dex/balance/total-value-by-address
  if (await testGET('Total Value By Address', '/api/v6/dex/balance/total-value-by-address',
    [['address', TREASURY], ['chainIndex', '196']]
  )) working.push('GET /api/v6/dex/balance/total-value-by-address');
  await sleep(1500);

  // GET /api/v6/dex/balance/all-token-balances-by-address
  if (await testGET('All Token Balances', '/api/v6/dex/balance/all-token-balances-by-address',
    [['address', TREASURY], ['chainIndex', '196']]
  )) working.push('GET /api/v6/dex/balance/all-token-balances-by-address');
  await sleep(1500);

  // POST /api/v6/dex/balance/token-balances-by-address
  if (await testPOST('Token Balances (specific)', '/api/v6/dex/balance/token-balances-by-address',
    [{ chainIndex: '196', address: TREASURY, tokenAddresses: [NATIVE] }]
  )) working.push('POST /api/v6/dex/balance/token-balances-by-address');
  await sleep(1500);

  // ── TOKEN API ──
  console.log(`\n${Y}--- Token API ---${X}\n`);

  // GET /api/v6/dex/market/token/search
  if (await testGET('Token Search (OKB)', '/api/v6/dex/market/token/search',
    [['chainIndex', '196'], ['keyword', 'OKB']]
  )) working.push('GET /api/v6/dex/market/token/search');
  await sleep(1500);

  // POST /api/v6/dex/market/token/basic-info
  if (await testPOST('Token Basic Info', '/api/v6/dex/market/token/basic-info',
    [{ chainIndex: '196', tokenAddress: NATIVE }]
  )) working.push('POST /api/v6/dex/market/token/basic-info');
  await sleep(1500);

  // GET /api/v6/dex/market/token/hot-token
  if (await testGET('Hot Tokens (XLayer)', '/api/v6/dex/market/token/hot-token',
    [['chainIndex', '196'], ['sortBy', '1'], ['limit', '5']]
  )) working.push('GET /api/v6/dex/market/token/hot-token');
  await sleep(1500);

  // ── GATEWAY API ──
  console.log(`\n${Y}--- Gateway API ---${X}\n`);

  // GET /api/v6/dex/pre-transaction/supported/chain
  if (await testGET('Gateway Supported Chains', '/api/v6/dex/pre-transaction/supported/chain', []))
    working.push('GET /api/v6/dex/pre-transaction/supported/chain');
  await sleep(1500);

  // GET /api/v6/dex/pre-transaction/gas-price
  if (await testGET('Gas Price (XLayer)', '/api/v6/dex/pre-transaction/gas-price',
    [['chainIndex', '196']]
  )) working.push('GET /api/v6/dex/pre-transaction/gas-price');
  await sleep(1500);

  // ── PORTFOLIO PNL ──
  console.log(`\n${Y}--- Portfolio PnL API ---${X}\n`);

  if (await testGET('Portfolio Supported Chains', '/api/v6/dex/market/portfolio/supported/chain', []))
    working.push('GET /api/v6/dex/market/portfolio/supported/chain');
  await sleep(1500);

  if (await testGET('Portfolio Overview', '/api/v6/dex/market/portfolio/overview',
    [['address', TREASURY], ['chainIndex', '196'], ['timeFrame', '3']]
  )) working.push('GET /api/v6/dex/market/portfolio/overview');
  await sleep(1500);

  // ── SUMMARY ──
  console.log(`\n${C}${B}${'='.repeat(70)}${X}`);
  console.log(`${C}${B}  Results${X}`);
  console.log(`${C}${B}${'='.repeat(70)}${X}\n`);

  if (working.length > 0) {
    console.log(`  ${G}${B}WORKING ENDPOINTS (${working.length}):${X}\n`);
    for (const ep of working) {
      console.log(`    ${G}${ep}${X}`);
    }
  }

  console.log(`\n  ${Y}Integration priority:${X}`);
  if (working.includes('POST /api/v6/dex/market/price')) console.log(`    1. Market Price → Scout (replace aggregator/quote workaround)`);
  if (working.includes('GET /api/v6/dex/market/candles')) console.log(`    2. Candles → Analyst (trend analysis)`);
  if (working.some(e => e.includes('balance'))) console.log(`    3. Balance API → Treasury (replace ethers.js RPC)`);
  if (working.some(e => e.includes('gas-price'))) console.log(`    4. Gas Price → Executor (accurate gas estimation)`);
  if (working.some(e => e.includes('token/search'))) console.log(`    5. Token Search → Scout (auto-discover tokens)`);
  if (working.some(e => e.includes('portfolio'))) console.log(`    6. Portfolio PnL → Treasury (wallet analytics)`);
  console.log('');
}

main().catch(console.error);
