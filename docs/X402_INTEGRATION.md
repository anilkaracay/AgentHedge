# x402 Payment Integration Guide

## Overview

x402 is the HTTP-native payment protocol used for ALL inter-agent payments in AgentHedge. Every agent is both a **server** (exposes x402-protected endpoints) and a **client** (makes x402-paid requests to other agents).

## Dependencies

```bash
npm install @x402/express @x402/fetch @x402/core
```

**NOTE**: If `@x402/express` or `@x402/fetch` are not available on npm (they may be very new), fall back to implementing the x402 flow manually. See "Manual x402 Implementation" section below.

## Server Side — Protecting Endpoints

Each agent that sells a service uses `@x402/express` middleware:

```typescript
// shared/x402Server.ts
import { paymentMiddleware } from '@x402/express';
import { config } from './config';

export function createX402Middleware(routes: Record<string, {
  description: string;
  priceUSDC: number; // in human units, e.g., 0.02
}>) {
  const routeConfig: Record<string, any> = {};

  for (const [route, { description, priceUSDC }] of Object.entries(routes)) {
    const amountBaseUnits = Math.round(priceUSDC * 1_000_000).toString();
    routeConfig[route] = {
      accepts: [{
        network: 'eip155:196',
        token: config.USDC_ADDRESS,
        maxAmountRequired: amountBaseUnits,
      }],
      description,
    };
  }

  return paymentMiddleware(routeConfig);
}
```

**Usage in Scout**:
```typescript
// agents/scout/server.ts
import express from 'express';
import { createX402Middleware } from '@agenthedge/shared';

const app = express();

app.use(createX402Middleware({
  'GET /api/opportunity-signal': {
    description: 'Latest CeDeFi arbitrage opportunity signal',
    priceUSDC: 0.02,
  },
}));

app.get('/api/opportunity-signal', async (req, res) => {
  // Payment already verified by middleware
  const signal = getLatestSignal();
  if (!signal) return res.status(204).json({ message: 'No opportunity' });
  res.json(signal);
});
```

## Client Side — Making Paid Requests

Each agent that consumes a service uses `@x402/fetch`:

```typescript
// shared/x402Client.ts
import { x402Fetch } from '@x402/fetch';
import { ethers } from 'ethers';

export async function callAgentEndpoint<T>(
  wallet: ethers.Wallet,
  url: string,
  method: string = 'GET'
): Promise<T> {
  const response = await x402Fetch(
    url,
    { method },
    {
      wallet,
      network: 'eip155:196',
    }
  );

  if (!response.ok) {
    throw new Error(`x402 request failed: ${response.status}`);
  }

  return await response.json();
}
```

**Usage in Analyst**:
```typescript
// agents/analyst/index.ts
const signal = await callAgentEndpoint<OpportunitySignal>(
  analystWallet,
  `http://localhost:3001/api/opportunity-signal`
);
```

## Manual x402 Implementation (Fallback)

If the @x402 npm packages are unavailable or don't work, implement the x402 flow manually:

### Server (Manual)

```typescript
// Manual x402 server middleware
import { ethers } from 'ethers';

export function manualX402Middleware(config: {
  route: string;
  price: string; // base units
  token: string; // USDC address
}) {
  return (req: any, res: any, next: any) => {
    const paymentHeader = req.headers['x-payment'] || req.headers['payment'];

    if (!paymentHeader) {
      // No payment — respond with 402
      res.status(402).json({
        paymentRequired: true,
        accepts: [{
          network: 'eip155:196',
          token: config.token,
          maxAmountRequired: config.price,
          receiver: process.env.AGENT_WALLET_ADDRESS,
        }],
        description: `Payment required: ${config.price} base units of USDC`,
      });
      return;
    }

    // Payment header present — verify it
    // In production, forward to OKX x402 facilitator for verification
    // For hackathon MVP, verify the signed payment payload locally
    try {
      const paymentData = JSON.parse(
        Buffer.from(paymentHeader, 'base64').toString()
      );
      // Verify signature, amount, token, network
      // If valid, proceed
      next();
    } catch (err) {
      res.status(402).json({ error: 'Invalid payment' });
    }
  };
}
```

### Client (Manual)

```typescript
// Manual x402 client
export async function manualX402Request<T>(
  wallet: ethers.Wallet,
  url: string
): Promise<T> {
  // Step 1: Initial request (will get 402)
  const initial = await fetch(url);

  if (initial.status === 402) {
    const requirements = await initial.json();

    // Step 2: Create and sign payment
    const payment = {
      network: 'eip155:196',
      token: requirements.accepts[0].token,
      amount: requirements.accepts[0].maxAmountRequired,
      receiver: requirements.accepts[0].receiver,
      timestamp: Date.now(),
    };

    const message = JSON.stringify(payment);
    const signature = await wallet.signMessage(message);
    const paymentPayload = Buffer.from(
      JSON.stringify({ ...payment, signature })
    ).toString('base64');

    // Step 3: Retry with payment
    const paid = await fetch(url, {
      headers: { 'X-Payment': paymentPayload },
    });

    return await paid.json();
  }

  return await initial.json();
}
```

## x402 Payment Configuration Per Agent

| Agent | Sells | Price | Buys From | Pays |
|---|---|---|---|---|
| Scout | `GET /api/opportunity-signal` | 0.02 USDC | — | — |
| Analyst | `GET /api/execution-recommendation` | 0.03 USDC | Scout | 0.02 USDC |
| Executor | `GET /api/trade-result` | — (internal) | Analyst | 0.03 USDC |
| Treasury | — | — | — | Executor (10% profit), Self (5%) |

## Testing x402 Payments

For local development/testing:
1. Use X Layer testnet (Chain ID 195)
2. Fund agent wallets with testnet USDC from a faucet
3. Each agent needs only ~1-5 USDC for testing
4. Verify payments appear on X Layer testnet explorer

For mainnet submission:
1. Bridge small amount of USDC to X Layer mainnet
2. Distribute across 4 agent wallets (1-2 USDC each)
3. Run a few cycles, collect tx hashes for submission
