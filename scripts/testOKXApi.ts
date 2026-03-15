/**
 * Tests OnchainOS API connectivity and discovers token addresses.
 * Usage: npx tsx scripts/testOKXApi.ts
 */
import CryptoJS from 'crypto-js';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const BASE_URL = 'https://web3.okx.com';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function getHeaders(method: string, requestPath: string, queryString: string = '') {
  const timestamp = new Date().toISOString();
  const stringToSign = timestamp + method + requestPath + queryString;
  const sign = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(stringToSign, process.env.OKX_SECRET_KEY!)
  );
  return {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY': process.env.OKX_API_KEY!,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': process.env.OKX_PASSPHRASE!,
    'OK-ACCESS-PROJECT': process.env.OKX_PROJECT_ID!,
  };
}

async function apiGet(path: string, params: Record<string, string>) {
  const qs = '?' + new URLSearchParams(params).toString();
  const headers = getHeaders('GET', path, qs);
  const res = await fetch(`${BASE_URL}${path}${qs}`, { method: 'GET', headers });
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  console.log(`\n${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  OnchainOS API Test${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════${RESET}\n`);

  // ── Test 1: Token list on X Layer mainnet (196) ──
  console.log(`${YELLOW}━━━ Token List — X Layer Mainnet (196) ━━━${RESET}\n`);
  try {
    const { status, body } = await apiGet('/api/v6/dex/market/token-list', { chainIndex: '196' });
    if (body.code === '0' && Array.isArray(body.data)) {
      console.log(`  ${GREEN}✅ API auth works!${RESET} Status: ${status}, Code: ${body.code}`);
      console.log(`  Total tokens: ${body.data.length}\n`);

      // Find USDC, USDT, WETH
      const targets = ['usdc', 'usdt', 'weth', 'okb'];
      for (const target of targets) {
        const token = body.data.find((t: any) =>
          t.tokenSymbol?.toLowerCase() === target
        );
        if (token) {
          console.log(`  ${CYAN}${token.tokenSymbol}${RESET}`);
          console.log(`    Address:  ${token.tokenContractAddress}`);
          console.log(`    Decimals: ${token.decimals}`);
          console.log(`    Name:     ${token.tokenName ?? ''}`);
          console.log('');
        }
      }
    } else {
      console.log(`  ${RED}❌ API error: code=${body.code}, msg=${body.msg}${RESET}`);
    }
  } catch (err) {
    console.log(`  ${RED}❌ Request failed: ${(err as Error).message}${RESET}`);
  }

  // ── Test 2: Token list on X Layer testnet (195) ──
  console.log(`${YELLOW}━━━ Token List — X Layer Testnet (195) ━━━${RESET}\n`);
  try {
    const { status, body } = await apiGet('/api/v6/dex/market/token-list', { chainIndex: '195' });
    if (body.code === '0' && Array.isArray(body.data)) {
      console.log(`  ${GREEN}✅ Testnet API works!${RESET} Status: ${status}`);
      console.log(`  Total tokens: ${body.data.length}\n`);

      const targets = ['usdc', 'usdt', 'weth', 'okb', 'eth'];
      for (const target of targets) {
        const token = body.data.find((t: any) =>
          t.tokenSymbol?.toLowerCase() === target
        );
        if (token) {
          console.log(`  ${CYAN}${token.tokenSymbol}${RESET}`);
          console.log(`    Address:  ${token.tokenContractAddress}`);
          console.log(`    Decimals: ${token.decimals}`);
          console.log('');
        }
      }

      // Show first 10 tokens if we don't find USDC/USDT
      if (!body.data.find((t: any) => ['usdc', 'usdt'].includes(t.tokenSymbol?.toLowerCase()))) {
        console.log(`  ${YELLOW}No USDC/USDT found. First 10 tokens:${RESET}`);
        for (const t of body.data.slice(0, 10)) {
          console.log(`    ${t.tokenSymbol ?? 'unknown'}: ${t.tokenContractAddress}`);
        }
        console.log('');
      }
    } else {
      console.log(`  ${RED}❌ Testnet error: code=${body.code}, msg=${body.msg}${RESET}`);
      console.log(`  ${YELLOW}(Testnet may not have token-list support)${RESET}\n`);
    }
  } catch (err) {
    console.log(`  ${RED}❌ Request failed: ${(err as Error).message}${RESET}`);
  }

  // ── Test 3: Price info for native ETH on mainnet ──
  console.log(`${YELLOW}━━━ Price Info — ETH on X Layer (196) ━━━${RESET}\n`);
  try {
    const { body } = await apiGet('/api/v6/dex/market/price-info', {
      chainIndex: '196',
      tokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    });
    if (body.code === '0' && body.data?.[0]) {
      const d = body.data[0];
      console.log(`  ${GREEN}✅ Price API works!${RESET}`);
      console.log(`  Last Price:    $${d.lastPrice}`);
      console.log(`  24h Change:    ${d.priceChange24h}%`);
      console.log(`  24h Volume:    $${d.volume24h}`);
      console.log(`  5m Change:     ${d.change5m}%\n`);
    } else {
      console.log(`  ${RED}❌ Price error: code=${body.code}, msg=${body.msg}${RESET}\n`);
    }
  } catch (err) {
    console.log(`  ${RED}❌ Request failed: ${(err as Error).message}${RESET}`);
  }

  // ── Test 4: Price info for ETH on Ethereum mainnet (CEX reference) ──
  console.log(`${YELLOW}━━━ Price Info — ETH on Ethereum (1) ━━━${RESET}\n`);
  try {
    const { body } = await apiGet('/api/v6/dex/market/price-info', {
      chainIndex: '1',
      tokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    });
    if (body.code === '0' && body.data?.[0]) {
      const d = body.data[0];
      console.log(`  ${GREEN}✅ CEX Reference works!${RESET}`);
      console.log(`  Last Price:    $${d.lastPrice}`);
      console.log(`  24h Change:    ${d.priceChange24h}%`);
      console.log(`  24h Volume:    $${d.volume24h}\n`);
    } else {
      console.log(`  ${RED}❌ Price error: code=${body.code}, msg=${body.msg}${RESET}\n`);
    }
  } catch (err) {
    console.log(`  ${RED}❌ Request failed: ${(err as Error).message}${RESET}`);
  }

  console.log(`${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  Done. Update .env with discovered addresses.${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════${RESET}\n`);
}

main().catch(console.error);
