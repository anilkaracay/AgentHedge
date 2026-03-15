# API Consumer Guide: AgentHedge x402 Endpoints

This guide is for developers who want to consume AgentHedge's market intelligence endpoints as a service. You do not need to run the full arbitrage pipeline. Instead, you pay per request using the x402 micropayment protocol and receive structured data in return.

---

## Table of Contents

1. [Overview](#overview)
2. [Available Endpoints](#available-endpoints)
3. [How to Connect](#how-to-connect)
4. [Pricing](#pricing)
5. [Response Schemas](#response-schemas)
6. [Use Cases](#use-cases)
7. [Error Handling](#error-handling)

---

## Overview

AgentHedge agents expose their analytical outputs as x402-protected HTTP endpoints. The x402 protocol (HTTP 402 Payment Required) enables micropayments in USDC on X Layer with zero gas fees. Any client with an X Layer wallet and USDC balance can consume these endpoints without registration, API keys, or subscriptions.

The payment flow works as follows:
1. You send a standard HTTP request to the endpoint.
2. The server responds with `402 Payment Required`, including payment details.
3. You sign a USDC payment on X Layer and resend the request with a payment header.
4. The server verifies payment and returns the data.

Libraries like `@x402/fetch` automate steps 2-4 into a single call.

---

## Available Endpoints

### Scout: Opportunity Signal

```
GET /api/opportunity-signal
Host: <scout-host>:3001
Price: 0.02 USDC per request
```

Returns the latest CeDeFi arbitrage opportunity detected across multiple venues. The Scout agent continuously scans CEX and DEX prices on X Layer, comparing them to identify actionable spread discrepancies.

**What you receive:**
- Token pair and direction (buy DEX / sell DEX)
- CEX and DEX prices with exact spread percentage
- 24-hour volume data for liquidity assessment
- Confidence score (0 to 1) based on signal quality
- Signal expiration timestamp (valid for 30 seconds from detection)

**When no opportunity exists**, the endpoint returns HTTP 204 (No Content) with no body. You are still charged the 0.02 USDC fee, as the scan was performed.

---

### Analyst: Execution Recommendation

```
GET /api/execution-recommendation
Host: <analyst-host>:3002
Price: 0.03 USDC per request
```

Returns a validated profitability assessment for the latest opportunity signal. The Analyst purchases the Scout's signal internally (you do not need to call the Scout first), applies cost analysis including slippage, price impact, gas, and agent fees, and produces an actionable recommendation.

**What you receive:**
- Action verdict: `EXECUTE`, `MONITOR`, or `SKIP`
- Estimated net profit in USDC after all costs
- Estimated slippage and price impact percentages
- Suggested trade amount and minimum acceptable output
- Human-readable explanation of the recommendation rationale

**When no recommendation is available** (e.g., no recent signal from Scout), the endpoint returns HTTP 204 (No Content).

---

## How to Connect

### Option 1: Using @x402/fetch (Recommended)

The `@x402/fetch` library handles the full x402 payment negotiation automatically.

```typescript
import { x402Fetch } from '@x402/fetch';
import { ethers } from 'ethers';

// Your wallet with USDC on X Layer
const provider = new ethers.JsonRpcProvider('https://rpc.xlayer.tech');
const wallet = new ethers.Wallet(process.env.MY_PRIVATE_KEY!, provider);

// Fetch opportunity signal (payment handled automatically)
async function getSignal() {
  const response = await x402Fetch(
    'http://scout-host:3001/api/opportunity-signal',
    { method: 'GET' },
    {
      wallet,
      network: 'eip155:196',
    }
  );

  if (response.status === 204) {
    console.log('No opportunity available right now.');
    return null;
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return await response.json();
}

// Fetch execution recommendation
async function getRecommendation() {
  const response = await x402Fetch(
    'http://analyst-host:3002/api/execution-recommendation',
    { method: 'GET' },
    {
      wallet,
      network: 'eip155:196',
    }
  );

  if (response.status === 204) {
    return null;
  }

  return await response.json();
}
```

Install the dependency:

```bash
npm install @x402/fetch ethers
```

### Option 2: Manual x402 Flow

If the `@x402/fetch` library is unavailable or you want full control, implement the three-step flow yourself.

```typescript
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://rpc.xlayer.tech');
const wallet = new ethers.Wallet(process.env.MY_PRIVATE_KEY!, provider);

async function x402Request(url: string): Promise<any> {
  // Step 1: Initial request -- server responds with 402
  const initial = await fetch(url);

  if (initial.status === 204) {
    return null; // No data available
  }

  if (initial.status !== 402) {
    return await initial.json(); // Unexpected; handle as needed
  }

  // Step 2: Parse payment requirements from 402 response
  const requirements = await initial.json();
  const accept = requirements.accepts[0];

  const payment = {
    network: 'eip155:196',
    token: accept.token,
    amount: accept.maxAmountRequired,
    receiver: accept.receiver,
    timestamp: Date.now(),
  };

  // Sign the payment payload
  const message = JSON.stringify(payment);
  const signature = await wallet.signMessage(message);
  const paymentPayload = Buffer.from(
    JSON.stringify({ ...payment, signature })
  ).toString('base64');

  // Step 3: Retry with payment header
  const paid = await fetch(url, {
    headers: { 'X-Payment': paymentPayload },
  });

  if (paid.status === 204) {
    return null;
  }

  return await paid.json();
}

// Usage
const signal = await x402Request('http://scout-host:3001/api/opportunity-signal');
const recommendation = await x402Request('http://analyst-host:3002/api/execution-recommendation');
```

### Option 3: curl (Testing and Debugging)

For manual testing, you can inspect the 402 response to understand payment requirements:

```bash
# Step 1: See what the server requires
curl -v http://scout-host:3001/api/opportunity-signal
```

Response (HTTP 402):

```json
{
  "paymentRequired": true,
  "accepts": [
    {
      "network": "eip155:196",
      "token": "0x...USDC_ADDRESS",
      "maxAmountRequired": "20000",
      "receiver": "0x...SCOUT_WALLET"
    }
  ],
  "description": "Payment required: 20000 base units of USDC"
}
```

Note that `maxAmountRequired` is in USDC base units (6 decimals). The value `20000` equals 0.02 USDC.

To complete the request, construct the payment payload as shown in Option 2, base64-encode it, and pass it as the `X-Payment` header:

```bash
curl -H "X-Payment: <base64-encoded-payment>" \
  http://scout-host:3001/api/opportunity-signal
```

In practice, programmatic access via Option 1 or 2 is strongly recommended over manual curl usage.

---

## Pricing

| Endpoint | Price Per Request | USDC Base Units | Charged On |
|---|---|---|---|
| `GET /api/opportunity-signal` | 0.02 USDC | 20000 | Every request, including 204 responses |
| `GET /api/execution-recommendation` | 0.03 USDC | 30000 | Every request, including 204 responses |

### Cost Examples

| Usage Pattern | Requests/Hour | Hourly Cost | Daily Cost (24h) |
|---|---|---|---|
| Periodic check (every 5 min, both endpoints) | 24 | $1.20 | $28.80 |
| Active monitoring (every 1 min, both endpoints) | 120 | $6.00 | $144.00 |
| Scout only, every 30 seconds | 120 | $2.40 | $57.60 |
| On-demand (a few checks per day) | ~10 | $0.50 | $0.50 |

All payments are settled in USDC on X Layer (Chain ID 196) with zero gas fees via the x402 protocol. Your wallet must hold USDC on X Layer to make requests.

---

## Response Schemas

### OpportunitySignal (from Scout)

```typescript
{
  id: string;                    // UUID, unique per signal
  tokenPair: string;             // e.g., "ETH/USDC"
  fromToken: string;             // Contract address of the source token
  toToken: string;               // Contract address of the destination token
  cexPrice: number;              // CEX reference price in USDC
  dexPrice: number;              // DEX price on X Layer in USDC
  spreadPercent: number;         // Spread as a percentage, e.g., 0.45 means 0.45%
  direction: "BUY_DEX" | "SELL_DEX"; // Which side of the DEX to take
  volume24h: number;             // 24-hour trading volume in USDC
  confidence: number;            // 0 to 1, higher is more reliable
  timestamp: string;             // ISO 8601 detection time
  expiresAt: string;             // ISO 8601, signal valid until this time (30s window)
}
```

**Example response:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "tokenPair": "ETH/USDC",
  "fromToken": "0x5A77f1443D16ee5200f3f0CE0A78A84340B41Ab5",
  "toToken": "0x74b7F16ab3e7CF1Ce0a2d65bF13c42C09b575C93",
  "cexPrice": 3450.25,
  "dexPrice": 3465.10,
  "spreadPercent": 0.43,
  "direction": "SELL_DEX",
  "volume24h": 2850000,
  "confidence": 0.82,
  "timestamp": "2026-03-15T14:30:00.000Z",
  "expiresAt": "2026-03-15T14:30:30.000Z"
}
```

### ExecutionRecommendation (from Analyst)

```typescript
{
  id: string;                    // UUID
  signalId: string;              // References the OpportunitySignal.id that was analyzed
  action: "EXECUTE" | "SKIP";   // Whether the opportunity is profitable after costs
  confidence: number;            // 0 to 1
  estimatedProfit: number;       // Net profit in USDC after all costs
  estimatedSlippage: number;     // Expected slippage as a percentage
  estimatedPriceImpact: number;  // Expected price impact as a percentage
  suggestedAmount: string;       // Recommended trade amount in token base units
  suggestedMinOutput: string;    // Minimum acceptable output in token base units
  reason: string;                // Human-readable explanation
  timestamp: string;             // ISO 8601
}
```

**Example response (EXECUTE):**

```json
{
  "id": "f9e8d7c6-b5a4-3210-fedc-ba0987654321",
  "signalId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "action": "EXECUTE",
  "confidence": 0.85,
  "estimatedProfit": 1.72,
  "estimatedSlippage": 0.15,
  "estimatedPriceImpact": 0.08,
  "suggestedAmount": "145000000",
  "suggestedMinOutput": "42100000000000000",
  "reason": "Spread of 0.43% on ETH/USDC exceeds cost basis of 0.28%. Liquidity sufficient for $145 trade. Net profit estimated at $1.72 after slippage, impact, and agent fees.",
  "timestamp": "2026-03-15T14:30:02.000Z"
}
```

**Example response (SKIP):**

```json
{
  "id": "11223344-5566-7788-99aa-bbccddeeff00",
  "signalId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "action": "SKIP",
  "confidence": 0.60,
  "estimatedProfit": -0.35,
  "estimatedSlippage": 0.30,
  "estimatedPriceImpact": 0.22,
  "suggestedAmount": "0",
  "suggestedMinOutput": "0",
  "reason": "Spread of 0.43% is consumed by estimated slippage (0.30%) and price impact (0.22%). Net result would be a loss of $0.35.",
  "timestamp": "2026-03-15T14:30:02.000Z"
}
```

---

## Use Cases

### Trading Bot Oracle

Integrate AgentHedge signals as a price oracle for your own trading bot. Poll the Scout endpoint to detect cross-venue price discrepancies, then execute trades through your own infrastructure.

```typescript
// Poll every 30 seconds, act on signals with confidence > 0.8
setInterval(async () => {
  const signal = await getSignal();
  if (signal && signal.confidence > 0.8 && signal.spreadPercent > 0.5) {
    await myTradingBot.evaluateAndExecute(signal);
  }
}, 30_000);
```

### Risk Monitoring

Use the Analyst endpoint to monitor whether current market conditions contain exploitable inefficiencies. A sustained pattern of SKIP recommendations with negative estimated profit may indicate tightening spreads or deteriorating liquidity.

```typescript
// Hourly risk report
const recommendation = await getRecommendation();
if (recommendation) {
  riskDashboard.update({
    marketEfficiency: recommendation.action === 'SKIP' ? 'efficient' : 'inefficient',
    estimatedSlippage: recommendation.estimatedSlippage,
    estimatedImpact: recommendation.estimatedPriceImpact,
  });
}
```

### Market Research and Analysis

Collect signal and recommendation data over time to analyze:
- Which token pairs on X Layer have the most persistent spreads.
- How slippage estimates compare to realized slippage in your own trades.
- Time-of-day patterns in CEX/DEX price divergence.

### Alert System

Trigger notifications when high-confidence opportunities appear:

```typescript
const signal = await getSignal();
if (signal && signal.spreadPercent > 1.0 && signal.confidence > 0.9) {
  await sendAlert({
    channel: 'telegram',
    message: `High-spread opportunity: ${signal.tokenPair} at ${signal.spreadPercent}% spread`,
  });
}
```

### Multi-Agent Composition

If you are building your own agent system, you can consume AgentHedge endpoints as upstream data sources. Your agents pay for signals via x402 just like AgentHedge's own agents do. This is the native composability model of the x402 protocol.

---

## Error Handling

### HTTP Status Codes

| Status | Meaning | Action |
|---|---|---|
| 200 | Success, data returned | Parse JSON response body |
| 204 | No data available (no current signal or recommendation) | Retry later; you are still charged |
| 402 | Payment required (first request or invalid payment) | Sign and attach payment; `@x402/fetch` handles this automatically |
| 500 | Server error | Retry with exponential backoff; check agent health endpoint |

### Common Issues

**"Payment required" loop (repeated 402 responses):**
- Your wallet may not have sufficient USDC on X Layer.
- The USDC contract address in the payment may not match the server's expected token.
- Your payment signature may be malformed. Verify you are signing with an X Layer (Chain ID 196) wallet.

**Empty responses (204) on every request:**
- The Scout may not be detecting any spreads above its threshold. This is normal during periods of price equilibrium.
- The agent may be in `DEMO_MODE` or may not be running. Check the agent's `/health` endpoint.

**Stale data:**
- The `expiresAt` field on opportunity signals indicates when the data becomes unreliable. Do not act on expired signals.
- If you consistently receive signals close to expiration, your polling interval may be too slow or network latency too high.

### Rate Limits

There are no artificial rate limits on x402 endpoints. The per-request payment cost serves as a natural rate limiter. However, excessively rapid polling (more than once per second) may be deprioritized by the server under load.

### Wallet Requirements

- Wallet must hold USDC on X Layer mainnet (Chain ID 196).
- Minimum recommended balance: 1 USDC for testing, 10 USDC for sustained usage.
- USDC on X Layer uses 6 decimal places. 1 USDC = 1,000,000 base units.
- Bridge USDC to X Layer via the OKX bridge before making requests.
