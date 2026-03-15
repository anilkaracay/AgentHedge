import CryptoJS from 'crypto-js';
import { config } from './config.js';
import { logInfo, logError } from './logger.js';

const BASE_URL = 'https://web3.okx.com';
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Auth Headers ──

export function getOKXHeaders(
  timestamp: string,
  method: string,
  requestPath: string,
  queryOrBody: string = ''
): Record<string, string> {
  const stringToSign = timestamp + method + requestPath + queryOrBody;
  const sign = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(stringToSign, config.OKX_SECRET_KEY)
  );
  return {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY': config.OKX_API_KEY,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': config.OKX_PASSPHRASE,
    'OK-ACCESS-PROJECT': config.OKX_PROJECT_ID,
  };
}

// ── Generic GET with retry ──

export async function onchainOSGet<T = unknown>(
  path: string,
  params: Record<string, string>
): Promise<{ code: string; data: T }> {
  const queryString = Object.keys(params).length > 0 ? '?' + new URLSearchParams(params).toString() : '';
  const url = `${BASE_URL}${path}${queryString}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const timestamp = new Date().toISOString();
    const headers = getOKXHeaders(timestamp, 'GET', path, queryString);
    logInfo('onchainOS', `GET ${path}`, { params, attempt });

    try {
      const response = await fetch(url, { method: 'GET', headers });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_RETRIES) { await sleep(RETRY_BASE_MS * Math.pow(2, attempt)); continue; }
      }
      if (!response.ok) throw new Error(`OnchainOS GET error: ${response.status}`);
      const data = await response.json();
      if (data.code === '50011' && attempt < MAX_RETRIES) { await sleep(RETRY_BASE_MS * Math.pow(2, attempt)); continue; }
      if (data.code !== '0' && data.code !== 0) throw new Error(`OnchainOS error ${data.code}: ${data.msg}`);
      return data;
    } catch (err) {
      if (attempt < MAX_RETRIES) { await sleep(RETRY_BASE_MS * Math.pow(2, attempt)); continue; }
      throw err;
    }
  }
  throw new Error(`OnchainOS GET: max retries for ${path}`);
}

// ── Generic POST with retry ──

export async function onchainOSPost<T = unknown>(
  path: string,
  body: unknown
): Promise<{ code: string; data: T }> {
  const bodyStr = JSON.stringify(body);
  const url = `${BASE_URL}${path}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const timestamp = new Date().toISOString();
    const headers = getOKXHeaders(timestamp, 'POST', path, bodyStr);
    logInfo('onchainOS', `POST ${path}`, { attempt });

    try {
      const response = await fetch(url, { method: 'POST', headers, body: bodyStr });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_RETRIES) { await sleep(RETRY_BASE_MS * Math.pow(2, attempt)); continue; }
      }
      if (!response.ok) throw new Error(`OnchainOS POST error: ${response.status}`);
      const data = await response.json();
      if (data.code === '50011' && attempt < MAX_RETRIES) { await sleep(RETRY_BASE_MS * Math.pow(2, attempt)); continue; }
      if (data.code !== '0' && data.code !== 0) throw new Error(`OnchainOS error ${data.code}: ${data.msg}`);
      return data;
    } catch (err) {
      if (attempt < MAX_RETRIES) { await sleep(RETRY_BASE_MS * Math.pow(2, attempt)); continue; }
      throw err;
    }
  }
  throw new Error(`OnchainOS POST: max retries for ${path}`);
}

// ════════════════════════════════════════════════════════════
// MODULE 1: DEX SWAP (aggregator)
// ════════════════════════════════════════════════════════════

export interface SwapQuoteParams {
  chainIndex: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  slippagePercent?: string;
}

export interface QuoteTokenInfo {
  tokenContractAddress: string;
  tokenSymbol: string;
  decimal: string;
}

export interface SwapQuoteResponse {
  fromTokenAmount: string;
  toTokenAmount: string;
  estimateGasFee: string;
  priceImpactPercentage: string;
  fromToken?: QuoteTokenInfo;
  toToken?: QuoteTokenInfo;
  dexRouterList: { dexProtocol: { dexName: string; percent: string } }[];
}

export interface ApproveParams {
  chainIndex: string;
  tokenContractAddress: string;
  approveAmount: string;
}

export interface ApproveResponse { to: string; data: string; gasLimit: string; }

export interface SwapParams extends SwapQuoteParams { userWalletAddress: string; }

export interface SwapResponse {
  tx: { to: string; data: string; value: string; gas: string; };
}

export async function getSwapQuote(params: SwapQuoteParams): Promise<SwapQuoteResponse> {
  const query: Record<string, string> = {
    chainIndex: params.chainIndex, fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress, amount: params.amount,
  };
  if (params.slippagePercent) query.slippagePercent = params.slippagePercent;
  const result = await onchainOSGet<SwapQuoteResponse[]>('/api/v6/dex/aggregator/quote', query);
  return result.data[0];
}

export async function getSwapApproval(params: ApproveParams): Promise<ApproveResponse> {
  const result = await onchainOSGet<ApproveResponse[]>('/api/v6/dex/aggregator/approve', {
    chainIndex: params.chainIndex, tokenContractAddress: params.tokenContractAddress, approveAmount: params.approveAmount,
  });
  return result.data[0];
}

export async function getSwapCalldata(params: SwapParams): Promise<SwapResponse> {
  const query: Record<string, string> = {
    chainIndex: params.chainIndex, fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress, amount: params.amount, userWalletAddress: params.userWalletAddress,
  };
  if (params.slippagePercent) query.slippagePercent = params.slippagePercent;
  const result = await onchainOSGet<SwapResponse[]>('/api/v6/dex/aggregator/swap', query);
  return result.data[0];
}

// ════════════════════════════════════════════════════════════
// MODULE 2: MARKET API
// ════════════════════════════════════════════════════════════

export interface IndexPriceResponse {
  chainIndex: string;
  tokenContractAddress: string;
  price: string;
  time: string;
}

export interface CandleData {
  ts: string;    // timestamp ms
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface TradeData {
  chainIndex: string;
  dexName: string;
  changedTokenInfo: { amount: string; tokenAddress: string; tokenSymbol: string }[];
}

/** POST /api/v6/dex/index/current-price — aggregated index price */
export async function getIndexPrice(chainIndex: string, tokenAddress: string): Promise<{ price: number; source: string }> {
  const result = await onchainOSPost<IndexPriceResponse[]>(
    '/api/v6/dex/index/current-price',
    [{ chainIndex, tokenContractAddress: tokenAddress.toLowerCase() }]
  );
  const item = result.data[0];
  return { price: parseFloat(item?.price ?? '0'), source: 'onchain-index' };
}

/** GET /api/v6/dex/market/candles — OHLCV candlestick data */
export async function getCandles(chainIndex: string, tokenAddress: string, bar: string = '1H', limit: number = 10): Promise<CandleData[]> {
  const result = await onchainOSGet<string[][]>(
    '/api/v6/dex/market/candles',
    { chainIndex, tokenContractAddress: tokenAddress.toLowerCase(), bar, limit: String(limit) }
  );
  return result.data.map(c => ({ ts: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
}

/** GET /api/v6/dex/market/trades — recent DEX trades */
export async function getRecentTrades(chainIndex: string, tokenAddress: string, limit: number = 10): Promise<TradeData[]> {
  const result = await onchainOSGet<TradeData[]>(
    '/api/v6/dex/market/trades',
    { chainIndex, tokenContractAddress: tokenAddress.toLowerCase(), limit: String(limit) }
  );
  return result.data;
}

// ════════════════════════════════════════════════════════════
// MODULE 3: BALANCE API
// ════════════════════════════════════════════════════════════

export interface BalanceTokenAsset {
  chainIndex: string;
  symbol: string;
  balance: string;
  tokenPrice: string;
  tokenContractAddress: string;
  isRiskToken: boolean;
}

/** GET /api/v6/dex/balance/total-value-by-address */
export async function getTotalValue(chainIndex: string, address: string): Promise<{ totalValue: number }> {
  const result = await onchainOSGet<{ totalValue: string }[]>(
    '/api/v6/dex/balance/total-value-by-address',
    { address, chains: chainIndex }
  );
  return { totalValue: parseFloat(result.data[0]?.totalValue ?? '0') };
}

/** GET /api/v6/dex/balance/all-token-balances-by-address */
export async function getTokenBalances(chainIndex: string, address: string): Promise<BalanceTokenAsset[]> {
  const result = await onchainOSGet<{ tokenAssets: BalanceTokenAsset[] }[]>(
    '/api/v6/dex/balance/all-token-balances-by-address',
    { address, chains: chainIndex }
  );
  return result.data[0]?.tokenAssets ?? [];
}

// ════════════════════════════════════════════════════════════
// MODULE 4: GATEWAY API
// ════════════════════════════════════════════════════════════

export interface GasPriceResponse {
  normal: string;
  min: string;
  max: string;
  supportEip1559: boolean;
}

/** GET /api/v6/dex/pre-transaction/gas-price */
export async function getGasPrice(chainIndex: string): Promise<GasPriceResponse> {
  const result = await onchainOSGet<GasPriceResponse[]>(
    '/api/v6/dex/pre-transaction/gas-price',
    { chainIndex }
  );
  return result.data[0];
}

// ════════════════════════════════════════════════════════════
// MODULE 5: PORTFOLIO API
// ════════════════════════════════════════════════════════════

export interface PortfolioOverviewResponse {
  realizedPnlUsd: string;
  buyTxCount: string;
  sellTxCount: string;
  winRate?: string;
}

/** GET /api/v6/dex/market/portfolio/overview */
export async function getPortfolioOverview(chainIndex: string, address: string): Promise<PortfolioOverviewResponse> {
  const result = await onchainOSGet<PortfolioOverviewResponse>(
    '/api/v6/dex/market/portfolio/overview',
    { walletAddress: address, chainIndex, timeFrame: '3' }
  );
  return result.data;
}

// ════════════════════════════════════════════════════════════
// LEGACY COMPAT: getPrice via aggregator/quote
// ════════════════════════════════════════════════════════════

export interface PriceResult {
  price: number;
  chainIndex: string;
  fromToken: string;
  toToken: string;
  priceImpact: number;
  gasFee: string;
}

export async function getPrice(
  chainIndex: string, fromToken: string, toToken: string,
  amount: string = '1000000000000000'
): Promise<PriceResult> {
  const quote = await getSwapQuote({ chainIndex, fromTokenAddress: fromToken, toTokenAddress: toToken, amount, slippagePercent: '0.5' });
  const fromDec = parseInt(quote.fromToken?.decimal ?? '18');
  const toDec = parseInt(quote.toToken?.decimal ?? '6');
  const fromAmt = parseFloat(quote.fromTokenAmount) / Math.pow(10, fromDec);
  const toAmt = parseFloat(quote.toTokenAmount) / Math.pow(10, toDec);
  return { price: fromAmt > 0 ? toAmt / fromAmt : 0, chainIndex, fromToken, toToken, priceImpact: parseFloat(quote.priceImpactPercentage || '0'), gasFee: quote.estimateGasFee };
}

export async function getMultiChainPrices(fromToken: string, toTokenByChain: Record<string, string>, amount?: string): Promise<PriceResult[]> {
  const results: PriceResult[] = [];
  for (const [chain, toToken] of Object.entries(toTokenByChain)) {
    try { results.push(await getPrice(chain, fromToken, toToken, amount)); } catch { /* skip */ }
  }
  return results;
}
