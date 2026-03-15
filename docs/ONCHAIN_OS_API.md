# OnchainOS API Reference

## API Availability — 5 Modules, 10+ Endpoints (Verified March 2026)

AgentHedge integrates 5 OnchainOS API modules across all 4 agents.

### Module 1: DEX Swap

| Endpoint | Method | Agent | Purpose |
|---|---|---|---|
| `/api/v6/dex/aggregator/quote` | GET | Scout, Analyst | Swap routing and price quotes |
| `/api/v6/dex/aggregator/approve` | GET | Executor | Token approval calldata |
| `/api/v6/dex/aggregator/swap` | GET | Executor | Swap transaction calldata |

### Module 2: Market

| Endpoint | Method | Agent | Purpose |
|---|---|---|---|
| `/api/v6/dex/index/current-price` | POST | Scout | Aggregated index prices |
| `/api/v6/dex/market/candles` | GET | Analyst | OHLCV candlestick data |
| `/api/v6/dex/market/trades` | GET | Scout | Recent DEX trade history |

### Module 3: Balance

| Endpoint | Method | Agent | Purpose |
|---|---|---|---|
| `/api/v6/dex/balance/total-value-by-address` | GET | Treasury | Portfolio USD value |
| `/api/v6/dex/balance/all-token-balances-by-address` | GET | Treasury | Token balances with metadata |

### Module 4: Gateway

| Endpoint | Method | Agent | Purpose |
|---|---|---|---|
| `/api/v6/dex/pre-transaction/gas-price` | GET | Executor | Gas price estimation |

### Module 5: Portfolio

| Endpoint | Method | Agent | Purpose |
|---|---|---|---|
| `/api/v6/dex/market/portfolio/overview` | GET | Treasury | Wallet PnL analytics |

**Note on parameter naming**: Market API uses POST for price endpoints (not GET). Balance API is under `/dex/balance/` (not `/wallet/`). The `chains` parameter is used instead of `chainIndex` for balance queries. Token addresses must be lowercase.

## Base URL

```
https://web3.okx.com/api/v6/
```

**IMPORTANT**: OnchainOS API v6 uses `chainIndex` (not `chainId` which was v5). X Layer mainnet = `196`, testnet = `195`.

## Authentication

ALL OnchainOS API requests require HMAC-SHA256 signed headers. Implement this ONCE in `shared/onchainOS.ts`.

### Header Generation

```typescript
import CryptoJS from 'crypto-js';

export function getOKXHeaders(
  timestamp: string,
  method: string,
  requestPath: string,
  queryString: string = ''
): Record<string, string> {
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
```

### Making a Request

```typescript
export async function onchainOSGet(
  path: string,
  params: Record<string, string>
): Promise<any> {
  const timestamp = new Date().toISOString();
  const queryString = '?' + new URLSearchParams(params).toString();
  const headers = getOKXHeaders(timestamp, 'GET', path, queryString);

  const response = await fetch(
    `https://web3.okx.com${path}${queryString}`,
    { method: 'GET', headers }
  );

  if (!response.ok) {
    throw new Error(`OnchainOS API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  if (data.code !== '0') {
    throw new Error(`OnchainOS API error code ${data.code}: ${data.msg}`);
  }

  return data;
}
```

## Credentials

Get these from the OKX Developer Portal (https://web3.okx.com/build/dev-portal):
- `OKX_API_KEY` — API key
- `OKX_SECRET_KEY` — Secret key for HMAC signing
- `OKX_PASSPHRASE` — Account passphrase
- `OKX_PROJECT_ID` — Project ID

---

## Market API

### GET /api/v6/dex/market/price-info

**Used by**: Scout (price scanning), Analyst (price validation), Treasury (portfolio valuation)

**Purpose**: Get real-time token price with change and volume data.

```
GET https://web3.okx.com/api/v6/dex/market/price-info
  ?chainIndex=196
  &tokenAddress=0x...
```

**Parameters**:
| Param | Type | Required | Description |
|---|---|---|---|
| chainIndex | string | Yes | `196` for X Layer mainnet |
| tokenAddress | string | Yes | Token contract address on X Layer |

**Response** (key fields):
```json
{
  "code": "0",
  "data": [{
    "lastPrice": "2450.53",
    "price24hAgo": "2410.00",
    "priceChange24h": "1.68",
    "volume24h": "1234567.89",
    "high24h": "2465.00",
    "low24h": "2400.00",
    "change5m": "0.12",
    "change1h": "0.45",
    "change4h": "0.89"
  }]
}
```

### GET /api/v6/dex/market/trades

**Used by**: Scout (volume analysis, whale detection)

```
GET https://web3.okx.com/api/v6/dex/market/trades
  ?chainIndex=196
  &tokenAddress=0x...
  &limit=50
```

**Parameters**:
| Param | Type | Required | Description |
|---|---|---|---|
| chainIndex | string | Yes | `196` |
| tokenAddress | string | Yes | Token contract address |
| limit | string | No | Number of trades to return (max 100) |

### GET /api/v6/dex/market/candles

**Used by**: Analyst (spread trend analysis)

```
GET https://web3.okx.com/api/v6/dex/market/candles
  ?chainIndex=196
  &tokenAddress=0x...
  &bar=5m
```

**Parameters**:
| Param | Type | Required | Description |
|---|---|---|---|
| chainIndex | string | Yes | `196` |
| tokenAddress | string | Yes | Token contract address |
| bar | string | Yes | Candle period: `1m`, `5m`, `15m`, `1h`, `4h`, `1d` |

**Response** (OHLCV):
```json
{
  "data": [{
    "ts": "1710500000000",
    "open": "2445.00",
    "high": "2460.00",
    "low": "2440.00",
    "close": "2450.00",
    "volume": "12345.67"
  }]
}
```

### GET /api/v6/dex/market/token-list

**Used by**: Scout (token discovery)

```
GET https://web3.okx.com/api/v6/dex/market/token-list
  ?chainIndex=196
```

---

## Trade API (DEX Aggregator)

### GET /api/v6/dex/aggregator/quote

**Used by**: Executor (get optimal swap route)

**IMPORTANT**: This does NOT execute a trade. It returns the best route and expected output.

```
GET https://web3.okx.com/api/v6/dex/aggregator/quote
  ?chainIndex=196
  &fromTokenAddress=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
  &toTokenAddress=0x...USDC...
  &amount=1000000000000000000
  &slippagePercent=0.5
```

**Parameters**:
| Param | Type | Required | Description |
|---|---|---|---|
| chainIndex | string | Yes | `196` for X Layer |
| fromTokenAddress | string | Yes | Source token. Use `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` for native token |
| toTokenAddress | string | Yes | Destination token address |
| amount | string | Yes | Amount in smallest unit (wei for ETH, base units for tokens) |
| slippagePercent | string | No | Slippage tolerance in percent, e.g., `"0.5"` for 0.5% |

**Response** (key fields):
```json
{
  "code": "0",
  "data": [{
    "fromTokenAmount": "1000000000000000000",
    "toTokenAmount": "2450530000",
    "estimateGasFee": "135000",
    "priceImpactPercentage": "0.04",
    "dexRouterList": [{
      "dexProtocol": { "dexName": "Uniswap V4", "percent": "100" }
    }]
  }]
}
```

### GET /api/v6/dex/aggregator/approve

**Used by**: Executor (approve token spending if needed)

```
GET https://web3.okx.com/api/v6/dex/aggregator/approve
  ?chainIndex=196
  &tokenContractAddress=0x...
  &approveAmount=1000000000000000000
```

**Response**:
```json
{
  "data": [{
    "to": "0x...router...",
    "data": "0x...calldata...",
    "gasLimit": "50000"
  }]
}
```

### GET /api/v6/dex/aggregator/swap

**Used by**: Executor (get signed swap calldata)

**IMPORTANT**: Same parameters as /quote PLUS `userWalletAddress`.

```
GET https://web3.okx.com/api/v6/dex/aggregator/swap
  ?chainIndex=196
  &fromTokenAddress=0x...
  &toTokenAddress=0x...
  &amount=1000000000000000000
  &slippagePercent=0.5
  &userWalletAddress=0x...executor_wallet...
```

**Additional Parameter**:
| Param | Type | Required | Description |
|---|---|---|---|
| userWalletAddress | string | Yes | The wallet address that will execute and sign the transaction |

**Response**:
```json
{
  "data": [{
    "tx": {
      "to": "0x...router...",
      "data": "0x...calldata...",
      "value": "1000000000000000000",
      "gas": "250000"
    }
  }]
}
```

**Execution with ethers.js v6**:
```typescript
const swapData = response.data[0].tx;
const tx = await wallet.sendTransaction({
  to: swapData.to,
  data: swapData.data,
  value: swapData.value || '0',
  gasLimit: swapData.gas,
});
const receipt = await tx.wait();
```

---

## Wallet API

### GET /api/v6/wallet/asset/token-balances

**Used by**: Treasury (portfolio monitoring)

```
GET https://web3.okx.com/api/v6/wallet/asset/token-balances
  ?chainIndex=196
  &address=0x...treasury_wallet...
```

### GET /api/v6/wallet/asset/total-value

**Used by**: Treasury (portfolio USD value)

```
GET https://web3.okx.com/api/v6/wallet/asset/total-value
  ?chainIndex=196
  &address=0x...treasury_wallet...
```

### GET /api/v6/wallet/transaction/get-transactions

**Used by**: Treasury (P&L calculation)

```
GET https://web3.okx.com/api/v6/wallet/transaction/get-transactions
  ?chainIndex=196
  &address=0x...
  &limit=50
```

---

## x402 Payments API

### OKX x402 Facilitator

OKX operates the x402 facilitator for X Layer. When using `@x402/express` and `@x402/fetch`, the facilitator URL is configured automatically for X Layer.

**Key facts**:
- Network identifier: `eip155:196` (X Layer mainnet)
- Supported tokens: USDC, USDT on X Layer
- Gas: ZERO for stablecoin transfers (OKX relayer sponsors gas)
- Settlement: Instant, on-chain, final
- KYT: Built-in Know Your Transaction screening

### Payment Details in x402 Middleware

When configuring x402 middleware for an agent endpoint:
```typescript
{
  network: 'eip155:196',           // X Layer mainnet
  token: USDC_XLAYER_ADDRESS,      // USDC contract on X Layer
  maxAmountRequired: '20000',      // 0.02 USDC in base units (6 decimals)
}
```

**CRITICAL**: USDC has 6 decimals. `1 USDC = 1_000_000`. So:
- 0.01 USDC = `"10000"`
- 0.02 USDC = `"20000"`
- 0.03 USDC = `"30000"`
- 0.05 USDC = `"50000"`
- 0.10 USDC = `"100000"`
- 1.00 USDC = `"1000000"`

---

## Rate Limits

OnchainOS API has tiered rate limits. Free tier allows approximately:
- Market API: 10 requests/second
- Trade API: 5 requests/second
- Wallet API: 5 requests/second

Implement rate limiting in `onchainOS.ts` with a simple token bucket or delay between calls. If you hit 429, back off exponentially.

## Error Codes

All OnchainOS responses include a `code` field:
- `"0"` = success
- Non-zero = error. The `msg` field contains the error description.

Always check `data.code !== '0'` and throw descriptive errors.
