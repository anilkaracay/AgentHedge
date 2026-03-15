import CryptoJS from 'crypto-js';
import { config } from './config.js';
import { logInfo, logError } from './logger.js';

const BASE_URL = 'https://web3.okx.com';
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1000;

// ── Auth Headers ──

export function getOKXHeaders(
  timestamp: string,
  method: string,
  requestPath: string,
  queryString: string = ''
): Record<string, string> {
  const stringToSign = timestamp + method + requestPath + queryString;
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
  const queryString = '?' + new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}${queryString}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const timestamp = new Date().toISOString();
    const headers = getOKXHeaders(timestamp, 'GET', path, queryString);

    logInfo('onchainOS', `GET ${path}`, { params, attempt });

    let response: Response;
    try {
      response = await fetch(url, { method: 'GET', headers });
    } catch (err) {
      logError('onchainOS', `Network error on ${path}`, err);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }

    if (response.status === 429 || response.status >= 500) {
      logError('onchainOS', `Retryable status ${response.status} on ${path}`);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OnchainOS API error: ${response.status} ${body}`);
    }

    const data = await response.json();
    if (data.code !== '0') {
      throw new Error(`OnchainOS API error code ${data.code}: ${data.msg}`);
    }

    return data;
  }

  throw new Error(`OnchainOS API: max retries exceeded for ${path}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Parameter & Response Types ──

export interface PriceInfoResponse {
  lastPrice: string;
  price24hAgo: string;
  priceChange24h: string;
  volume24h: string;
  high24h: string;
  low24h: string;
  change5m: string;
  change1h: string;
  change4h: string;
}

export interface CandleData {
  ts: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface SwapQuoteParams {
  chainIndex: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  slippagePercent?: string;
}

export interface SwapQuoteResponse {
  fromTokenAmount: string;
  toTokenAmount: string;
  estimateGasFee: string;
  priceImpactPercentage: string;
  dexRouterList: { dexProtocol: { dexName: string; percent: string } }[];
}

export interface ApproveParams {
  chainIndex: string;
  tokenContractAddress: string;
  approveAmount: string;
}

export interface ApproveResponse {
  to: string;
  data: string;
  gasLimit: string;
}

export interface SwapParams extends SwapQuoteParams {
  userWalletAddress: string;
}

export interface SwapResponse {
  tx: {
    to: string;
    data: string;
    value: string;
    gas: string;
  };
}

export interface TokenBalance {
  token: string;
  balance: string;
  tokenPrice: string;
}

export interface TotalValueResponse {
  totalValue: string;
}

// ── Market API Helpers ──

export async function getTokenPrice(
  chainIndex: string,
  tokenAddress: string
): Promise<PriceInfoResponse> {
  const result = await onchainOSGet<PriceInfoResponse[]>(
    '/api/v6/dex/market/price-info',
    { chainIndex, tokenAddress }
  );
  return result.data[0];
}

export async function getRecentTrades(
  chainIndex: string,
  tokenAddress: string,
  limit?: number
): Promise<unknown[]> {
  const params: Record<string, string> = { chainIndex, tokenAddress };
  if (limit !== undefined) params.limit = String(limit);
  const result = await onchainOSGet<unknown[]>(
    '/api/v6/dex/market/trades',
    params
  );
  return result.data;
}

export async function getCandles(
  chainIndex: string,
  tokenAddress: string,
  bar: string
): Promise<CandleData[]> {
  const result = await onchainOSGet<CandleData[]>(
    '/api/v6/dex/market/candles',
    { chainIndex, tokenAddress, bar }
  );
  return result.data;
}

// ── Trade API Helpers ──

export async function getSwapQuote(
  params: SwapQuoteParams
): Promise<SwapQuoteResponse> {
  const query: Record<string, string> = {
    chainIndex: params.chainIndex,
    fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress,
    amount: params.amount,
  };
  if (params.slippagePercent) query.slippagePercent = params.slippagePercent;

  const result = await onchainOSGet<SwapQuoteResponse[]>(
    '/api/v6/dex/aggregator/quote',
    query
  );
  return result.data[0];
}

export async function getSwapApproval(
  params: ApproveParams
): Promise<ApproveResponse> {
  const result = await onchainOSGet<ApproveResponse[]>(
    '/api/v6/dex/aggregator/approve',
    {
      chainIndex: params.chainIndex,
      tokenContractAddress: params.tokenContractAddress,
      approveAmount: params.approveAmount,
    }
  );
  return result.data[0];
}

export async function getSwapCalldata(
  params: SwapParams
): Promise<SwapResponse> {
  const query: Record<string, string> = {
    chainIndex: params.chainIndex,
    fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress,
    amount: params.amount,
    userWalletAddress: params.userWalletAddress,
  };
  if (params.slippagePercent) query.slippagePercent = params.slippagePercent;

  const result = await onchainOSGet<SwapResponse[]>(
    '/api/v6/dex/aggregator/swap',
    query
  );
  return result.data[0];
}

// ── Wallet API Helpers ──

export async function getTokenBalances(
  chainIndex: string,
  address: string
): Promise<TokenBalance[]> {
  const result = await onchainOSGet<TokenBalance[]>(
    '/api/v6/wallet/asset/token-balances',
    { chainIndex, address }
  );
  return result.data;
}

export async function getTotalValue(
  chainIndex: string,
  address: string
): Promise<TotalValueResponse> {
  const result = await onchainOSGet<TotalValueResponse[]>(
    '/api/v6/wallet/asset/total-value',
    { chainIndex, address }
  );
  return result.data[0];
}
