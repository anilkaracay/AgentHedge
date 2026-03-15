import { ethers } from 'ethers';
import { logInfo, logError, logPayment } from './logger.js';
import { eventBus } from './eventBus.js';
import type { X402PaymentEvent } from './types.js';

const NETWORK = 'eip155:196';

interface PaymentRequirements {
  paymentRequired: boolean;
  accepts: {
    network: string;
    token: string;
    maxAmountRequired: string;
    receiver: string;
  }[];
  description: string;
}

export async function callPaidEndpoint<T>(
  wallet: ethers.Wallet,
  url: string,
  method: string = 'GET',
  callerAgentId: string = 'unknown',
  targetAgentId: string = 'unknown'
): Promise<T> {
  // Step 1: Initial request — expect 402
  const initial = await fetch(url, { method });

  // If not 402, return response directly (endpoint may not require payment)
  if (initial.status !== 402) {
    if (!initial.ok) {
      throw new Error(`x402 request failed: ${initial.status} ${await initial.text()}`);
    }
    return await initial.json() as T;
  }

  // Step 2: Parse payment requirements from 402 response
  const requirements = await initial.json() as PaymentRequirements;

  if (!requirements.accepts || requirements.accepts.length === 0) {
    throw new Error('x402: 402 response missing payment requirements');
  }

  const accept = requirements.accepts[0];

  // Step 3: Create and sign payment payload
  const payment = {
    network: NETWORK,
    token: accept.token,
    amount: accept.maxAmountRequired,
    receiver: accept.receiver,
    timestamp: Date.now(),
    payer: callerAgentId,
  };

  const message = JSON.stringify(payment);
  const signature = await wallet.signMessage(message);

  const paymentPayload = Buffer.from(
    JSON.stringify({ ...payment, signature })
  ).toString('base64');

  logInfo('x402-client', `Sending payment to ${url}`, {
    amount: accept.maxAmountRequired,
    receiver: accept.receiver,
  });

  // Step 4: Retry with payment header
  const paid = await fetch(url, {
    method,
    headers: { 'X-Payment': paymentPayload },
  });

  if (!paid.ok) {
    const errorBody = await paid.text();
    logError('x402-client', `Paid request failed: ${paid.status}`, errorBody);
    throw new Error(`x402 paid request failed: ${paid.status} ${errorBody}`);
  }

  // Step 5: Log and emit payment event
  const amountUSDC = Number(accept.maxAmountRequired) / 1_000_000;
  logPayment(callerAgentId, targetAgentId, amountUSDC, requirements.description);

  const paymentEvent: X402PaymentEvent = {
    from: callerAgentId,
    to: targetAgentId,
    amount: amountUSDC,
    purpose: requirements.description,
  };
  eventBus.emitDashboardEvent({
    type: 'x402_payment',
    data: paymentEvent,
    timestamp: new Date().toISOString(),
  });

  return await paid.json() as T;
}
