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

    // Rate limit (50011) comes as 200 with error code in body
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

    // Handle rate limit in response body
    if (data.code === '50011' && attempt < MAX_RETRIES) {
      logError('onchainOS', 'Rate limited, backing off');
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
      continue;
    }

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

// ── Types ──

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

export interface PriceResult {
  price: number;       // price of fromToken in toToken units (human-readable)
  chainIndex: string;
  fromToken: string;
  toToken: string;
  priceImpact: number; // percentage
  gasFee: string;
}

// ── Trade API Helpers (WORKING) ──

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

// ── Price Oracle via Aggregator Quote ──

/**
 * Get the price of a token by quoting a small swap.
 * Returns price in toToken units (e.g., ETH price in USDC).
 */
export async function getPrice(
  chainIndex: string,
  fromToken: string,
  toToken: string,
  amount: string = '1000000000000000' // 0.001 ETH default (small to minimize impact)
): Promise<PriceResult> {
  const quote = await getSwapQuote({
    chainIndex,
    fromTokenAddress: fromToken,
    toTokenAddress: toToken,
    amount,
    slippagePercent: '0.5',
  });

  const fromDecimals = parseInt(quote.fromToken?.decimal ?? '18');
  const toDecimals = parseInt(quote.toToken?.decimal ?? '6');

  const fromAmount = parseFloat(quote.fromTokenAmount) / Math.pow(10, fromDecimals);
  const toAmount = parseFloat(quote.toTokenAmount) / Math.pow(10, toDecimals);
  const price = fromAmount > 0 ? toAmount / fromAmount : 0;

  return {
    price,
    chainIndex,
    fromToken,
    toToken,
    priceImpact: parseFloat(quote.priceImpactPercentage || '0'),
    gasFee: quote.estimateGasFee,
  };
}

/**
 * Get price of the same token pair across multiple chains.
 * Used by Scout to compare X Layer vs Ethereum prices.
 */
export async function getMultiChainPrices(
  fromToken: string,
  toTokenByChain: Record<string, string>,
  amount?: string
): Promise<PriceResult[]> {
  const results: PriceResult[] = [];
  for (const [chainIndex, toToken] of Object.entries(toTokenByChain)) {
    try {
      const result = await getPrice(chainIndex, fromToken, toToken, amount);
      results.push(result);
    } catch (err) {
      logError('onchainOS', `Failed to get price on chain ${chainIndex}`, err);
    }
  }
  return results;
}
