import CryptoJS from 'crypto-js';
import { logInfo, logError } from './logger.js';

// ── OKX Trading API (authenticated) ──

export interface CEXOrderParams {
  instId: string;        // "OKB-USDT"
  side: 'buy' | 'sell';
  size: string;          // quantity
  ordType: 'market' | 'limit';
  price?: string;
}

export interface CEXOrderResult {
  orderId: string;
  status: 'filled' | 'partially_filled' | 'failed';
  fillPrice: number;
  fillSize: string;
  fee: number;
  timestamp: string;
}

function getOKXTradingHeaders(
  timestamp: string,
  method: string,
  requestPath: string,
  body: string = ''
): Record<string, string> {
  const apiKey = process.env.OKX_TRADE_API_KEY;
  const secret = process.env.OKX_TRADE_SECRET_KEY;
  const passphrase = process.env.OKX_TRADE_PASSPHRASE;

  if (!apiKey || !secret || !passphrase) {
    throw new Error('OKX trading API credentials not configured');
  }

  const stringToSign = timestamp + method + requestPath + body;
  const sign = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(stringToSign, secret)
  );

  return {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY': apiKey,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': passphrase,
  };
}

export async function placeCEXOrder(params: CEXOrderParams): Promise<CEXOrderResult> {
  const enabled = process.env.CEX_TRADING_ENABLED === 'true';
  const timestamp = new Date().toISOString();

  const body = JSON.stringify({
    instId: params.instId,
    tdMode: 'cash',
    side: params.side,
    ordType: params.ordType,
    sz: params.size,
    ...(params.price ? { px: params.price } : {}),
  });

  if (!enabled) {
    // Simulated order
    logInfo('cex-trade', `[SIMULATED] ${params.side} ${params.size} ${params.instId} @ market`);
    return {
      orderId: `sim-${Date.now()}`,
      status: 'filled',
      fillPrice: 0, // caller should use quote price
      fillSize: params.size,
      fee: 0,
      timestamp,
    };
  }

  // Real order
  const path = '/api/v5/trade/order';
  const headers = getOKXTradingHeaders(timestamp, 'POST', path, body);

  const res = await fetch(`https://www.okx.com${path}`, {
    method: 'POST',
    headers,
    body,
  });

  const data = await res.json() as any;
  if (data.code !== '0') {
    logError('cex-trade', `Order failed: ${data.msg}`);
    return { orderId: '', status: 'failed', fillPrice: 0, fillSize: '0', fee: 0, timestamp };
  }

  const orderId = data.data?.[0]?.ordId ?? '';
  logInfo('cex-trade', `Order placed: ${orderId}`);

  // Poll for fill (simplified — production would use WebSocket)
  await new Promise(r => setTimeout(r, 2000));
  return getCEXOrderStatus(orderId, params.instId);
}

export async function getCEXOrderStatus(orderId: string, instId: string): Promise<CEXOrderResult> {
  const timestamp = new Date().toISOString();
  const path = `/api/v5/trade/order?ordId=${orderId}&instId=${instId}`;
  const headers = getOKXTradingHeaders(timestamp, 'GET', path);

  try {
    const res = await fetch(`https://www.okx.com${path}`, { headers });
    const data = await res.json() as any;
    const order = data.data?.[0];

    return {
      orderId,
      status: order?.state === 'filled' ? 'filled' : order?.state === 'partially_filled' ? 'partially_filled' : 'failed',
      fillPrice: parseFloat(order?.avgPx ?? '0'),
      fillSize: order?.fillSz ?? '0',
      fee: Math.abs(parseFloat(order?.fee ?? '0')),
      timestamp: new Date().toISOString(),
    };
  } catch {
    return { orderId, status: 'failed', fillPrice: 0, fillSize: '0', fee: 0, timestamp };
  }
}

export async function getCEXBalance(currency: string): Promise<number> {
  const timestamp = new Date().toISOString();
  const path = `/api/v5/account/balance?ccy=${currency}`;
  const headers = getOKXTradingHeaders(timestamp, 'GET', path);

  try {
    const res = await fetch(`https://www.okx.com${path}`, { headers });
    const data = await res.json() as any;
    const detail = data.data?.[0]?.details?.find((d: any) => d.ccy === currency);
    return parseFloat(detail?.availBal ?? '0');
  } catch {
    return 0;
  }
}
