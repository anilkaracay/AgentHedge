# AgentHedge

Autonomous multi-agent CeDeFi arbitrage system with x402 inter-agent micropayments, built natively on X Layer.

![X Layer Mainnet](https://img.shields.io/badge/X_Layer-Mainnet-00c853?style=flat-square)
![OnchainOS](https://img.shields.io/badge/OnchainOS-API_v6-1976d2?style=flat-square)
![x402 Protocol](https://img.shields.io/badge/x402-Protocol-1565c0?style=flat-square)
![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178c6?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-757575?style=flat-square)

**[Contract Explorer](https://www.okx.com/web3/explorer/xlayer/address/0xB8406ad5A79721d8D411837b68dfc5E4FF1A41e4)** · **[Demo Video](https://youtu.be/OrgI-qv6trQ)**

---

## Overview

AgentHedge is a four-agent arbitrage pipeline deployed on X Layer (Chain ID 196). Each agent has a single responsibility -- Scout detects CeDeFi price discrepancies across DEX and CEX venues, Analyst validates profitability, Executor settles trades, and Treasury manages risk and capital allocation. Agents communicate exclusively through x402 micropayments: every inter-agent service call is an HTTP 402 payment negotiation settled in USDC on X Layer.

Current arbitrage infrastructure is typically monolithic -- a single process handles price discovery, analysis, execution, and risk in one opaque loop. AgentHedge decomposes this into four independently replaceable, economically incentivized services. Any agent can be swapped without affecting the rest of the pipeline. Scout can be replaced with a better price oracle. Analyst can adopt a new model. The x402 payment protocol ensures that each agent is compensated for the value it provides, creating a self-sustaining service marketplace.

The system is fully autonomous (zero human intervention per arbitrage cycle), x402-native (every inter-agent call carries a signed USDC payment), and OnchainOS-integrated (all trade routing, approvals, and execution go through the OKX OnchainOS DEX Aggregator API). AgentHedge is live on X Layer mainnet with 34+ verified transactions (including real USDC x402 payments and on-chain cycle attestations), 4 registered agents, and a real-time monitoring dashboard.

---

## Table of Contents

- [Architecture](#architecture)
- [Agents](#agents)
- [x402 Payment Model](#x402-payment-model)
- [OnchainOS Integration](#onchainos-integration)
- [Smart Contract](#smart-contract)
- [Mainnet Deployment](#mainnet-deployment)
- [Dashboard](#dashboard)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Hackathon Criteria](#hackathon-criteria)
- [Business Model](#business-model)
- [Team](#team)
- [License](#license)

---

## Architecture

### System Diagram

```
┌──────────────┐   x402: 0.02 USDC   ┌──────────────┐   x402: 0.03 USDC   ┌──────────────┐   profit share   ┌──────────────┐
│    SCOUT     │ ──────────────────→  │   ANALYST    │ ──────────────────→  │   EXECUTOR   │ ──────────────→  │   TREASURY   │
│   :3001      │                      │   :3002      │                      │   :3003      │                  │   :3004      │
│              │                      │              │                      │              │                  │              │
│  Price       │                      │  Profitability│                     │  Trade       │                  │  Capital &   │
│  Discovery   │                      │  Analysis     │                     │  Execution   │                  │  Risk Mgmt   │
└──────┬───────┘                      └──────┬───────┘                      └──────┬───────┘                  └──────┬───────┘
       │                                     │                                     │                                │
       │ Market API + CEX APIs               │ aggregator/quote                    │ aggregator/quote               │ Balance API
       │ (X Layer DEX + OKX/MEXC/Gate)      │ (price validation)                  │ aggregator/approve             │ Portfolio API
       │                                     │                                     │ aggregator/swap                │
       └─────────────────────────────────────┴─────────────────────────────────────┴────────────────────────────────┘
                                                    OnchainOS API v6
                                              https://web3.okx.com/api/v6/
```

### Data Flow Per Cycle

1. Scout scans 4+ venues simultaneously: X Layer DEX (via OnchainOS `aggregator/quote` and `index/current-price`) and CEX spot prices (OKX, Gate.io, MEXC public APIs via `Promise.allSettled`). If the spread between cheapest and most expensive venue exceeds the threshold, an `ArbitrageOpportunity` is stored at the Scout's x402 endpoint.
2. Analyst purchases the signal (pays 0.02 USDC via x402), validates freshness (<30s), re-quotes for current price, and calculates net profit after slippage, price impact, gas, and agent fees. Produces an `ExecutionRecommendation`.
3. Executor purchases the recommendation (pays 0.03 USDC via x402), requests risk approval from Treasury, then executes the full `quote -> approve -> swap` pipeline via OnchainOS Trade API.
4. Treasury receives the trade result, distributes profit (10% to Executor, 5% management fee, 85% to capital pool), monitors portfolio via direct chain queries, and enforces circuit breaker logic.
5. All events are forwarded to the dashboard via WebSocket in real time.

### Architectural Layers

| Layer | Component | Description |
|-------|-----------|-------------|
| On-Chain | AgentRegistry (Solidity) | Agent registration, discovery, and performance tracking on X Layer |
| Payment | x402 Protocol | HTTP 402 payment negotiation with USDC micropayments between agents |
| Runtime | Agent Processes (Node.js) | 4 independent Express servers, each with its own wallet and x402 middleware |
| Monitoring | Dashboard (React) | Real-time WebSocket visualization of payments, trades, and portfolio state |

---

## Agents

### Overview

| Agent | Role | OnchainOS Endpoints | x402 Price | Port | Source |
|-------|------|-------------------|-----------|------|--------|
| Scout | Opportunity detection | Market API + `aggregator/quote` + CEX APIs | 0.02 USDC (sells signals) | Configurable | `packages/orchestrator/src/agents.ts` |
| Analyst | Profitability validation | `aggregator/quote` (price validation) | 0.03 USDC (sells recommendations) | Configurable | `packages/orchestrator/src/agents.ts` |
| Executor | Trade execution | `aggregator/quote`, `/approve`, `/swap` | -- (earns 10% profit) | Configurable | `packages/orchestrator/src/agents.ts` |
| Treasury | Capital and risk management | Balance API, Portfolio API | -- (funds operations) | Configurable | `packages/orchestrator/src/agents.ts` |

All agents extend `AgentBase` (`packages/shared/src/AgentBase.ts`), which provides wallet initialization, on-chain registration, agent discovery via the registry, x402 client/server capabilities, and OnchainOS API access.

### Scout -- Opportunity Detection

Scout's role is multi-venue price discovery. Every cycle, it scans 4+ venues simultaneously via `Promise.allSettled`:

- **X Layer DEX**: OnchainOS `index/current-price` (POST) and `aggregator/quote` for real DEX pricing
- **OKX**: `/api/v5/market/ticker?instId=OKB-USDT` public API
- **Gate.io**: `/api/v4/spot/tickers?currency_pair=OKB_USDT` public API
- **MEXC**: `/api/v3/ticker/price?symbol=OKBUSDT` public API

All venues are queried in parallel with a 3-second timeout. The spread is calculated between the cheapest and most expensive responding venue. If the spread exceeds the profitability threshold (accounting for fees), Scout creates an `ArbitrageOpportunity` containing all venue prices, spread percentage, and a confidence score. The signal expires after 30 seconds.

Scout exposes `GET /api/opportunity-signal` behind x402 middleware. Any agent requesting this endpoint must include a signed USDC payment of 0.02 USDC in the `X-Payment` header. Without payment, Scout returns HTTP 402 with payment requirements.

### Analyst -- Profitability Validation

Analyst purchases Scout's signal via x402 (paying 0.02 USDC), then determines whether the opportunity is actually profitable after accounting for all costs.

The validation process:
1. Check signal freshness -- reject if older than 30 seconds
2. Re-quote via `aggregator/quote` to get the current price and `priceImpactPercentage` directly from the DEX aggregator
3. Calculate net profit: `(spread * tradeAmount) - priceImpact - gasCost - agentFees`
4. Agent fees are fixed at 0.05 USDC per cycle (0.02 to Scout + 0.03 to Analyst)
5. If net profit exceeds $0.50 and confidence exceeds 0.7, the recommendation is `EXECUTE`; otherwise `SKIP`

The `ExecutionRecommendation` includes a `suggestedAmount` in token base units and a `suggestedMinOutput` for slippage protection. Analyst exposes this at `GET /api/execution-recommendation` behind x402 middleware (0.03 USDC).

### Executor -- Trade Execution

Executor purchases the Analyst's recommendation via x402 (paying 0.03 USDC), then executes the trade through the full OnchainOS DEX Aggregator pipeline:

1. Request risk approval from Treasury (`POST /api/risk-check`, internal HTTP, no x402)
2. Call `GET /api/v6/dex/aggregator/quote` to get the optimal swap route
3. Validate that `toTokenAmount >= suggestedMinOutput` from the recommendation
4. If the source token is not native: call `GET /api/v6/dex/aggregator/approve` and broadcast the approval transaction via `wallet.sendTransaction()`
5. Call `GET /api/v6/dex/aggregator/swap` with `userWalletAddress` to get signed calldata
6. Broadcast the swap transaction, wait for confirmation via `tx.wait()`
7. Calculate realized P&L and create a `TradeResult`
8. Record success or failure on the AgentRegistry contract
9. Report the result to Treasury via `POST /api/trade-result`

### Treasury -- Capital and Risk Management

Treasury monitors the collective portfolio and enforces risk constraints. It uses the OnchainOS Balance API (`total-value-by-address`, `all-token-balances-by-address`) and Portfolio API (`portfolio/overview`) for real-time portfolio tracking and PnL analytics.

Risk controls:
- **Daily loss limit**: If cumulative daily P&L drops below -5% of starting portfolio value, the circuit breaker activates and all `POST /api/risk-check` requests return `{ approved: false }`
- **Single trade cap**: No single trade may exceed 20% of total portfolio value
- **Circuit breaker**: Once activated, halts all trading and emits a `risk_alert` event to the dashboard

Profit distribution follows a fixed split: 10% to Executor (execution fee), 5% to Treasury (management fee), 85% returned to the capital pool.

---

## x402 Payment Model

### Payment Flow Per Cycle

**Service Payments (Phase 1):**

| Step | From | To | Amount | Purpose |
|------|------|----|--------|---------|
| 1 | Analyst | Scout | 0.02 USDC | Purchase `OpportunitySignal` |
| 2 | Executor | Analyst | 0.03 USDC | Purchase `ExecutionRecommendation` |
| 3 | Treasury | Executor | up to 0.10 USDC | Execution fee |

**Profit Redistribution (Phase 2):**

| Step | From | To | Amount | Purpose |
|------|------|----|--------|---------|
| 4 | Scout | Treasury | 0.02 USDC | Profit return |
| 5 | Executor | Treasury | 0.07 USDC | Profit return |

Net cost per cycle: ~0.01 USDC. The closed-loop design makes the system economically self-sustaining.

### Protocol Mechanics

Every x402 interaction follows the same negotiation:

1. Client sends an HTTP request without payment
2. Server responds with `HTTP 402 Payment Required` and a JSON body specifying the accepted payment network (`eip155:196`), token (USDC), amount, and receiver address
3. Client constructs a payment object, signs it with its ethers.js wallet (`wallet.signMessage()`), base64-encodes the payload, and retries the request with the `X-Payment` header
4. Server decodes the header, verifies the signature via `ethers.verifyMessage()`, validates the amount and freshness (60-second expiry), and proceeds to serve the response

### Design Rationale

x402 is not an add-on to AgentHedge; it is the core coordination mechanism. Without x402, agents have no way to charge for their services, no permissionless service discovery, and no autonomous payment settlement. Traditional inter-service communication (REST, gRPC, message queues) does not carry economic incentives -- a Scout has no reason to produce high-quality signals if it is not compensated per request.

The x402 model also enables agent replaceability. If a better Scout agent appears, it can register on the AgentRegistry with the same endpoint pattern and a lower price. The Analyst will naturally route to the cheaper, higher-quality service. This creates a competitive marketplace for each pipeline stage without requiring any centralized orchestration of agent selection.

---

## OnchainOS Integration

### 5 Modules, 10+ Endpoints

| Module | Endpoint | Method | Agent | Purpose |
|--------|----------|--------|-------|---------|
| DEX Swap | `/api/v6/dex/aggregator/quote` | GET | Scout, Analyst | Swap routing and price quotes |
| DEX Swap | `/api/v6/dex/aggregator/approve` | GET | Executor | Token approval calldata |
| DEX Swap | `/api/v6/dex/aggregator/swap` | GET | Executor | Swap transaction calldata |
| Market | `/api/v6/dex/index/current-price` | POST | Scout | Aggregated index prices |
| Market | `/api/v6/dex/market/candles` | GET | Analyst | OHLCV candlestick data |
| Market | `/api/v6/dex/market/trades` | GET | Scout | Recent DEX trade history |
| Balance | `/api/v6/dex/balance/total-value-by-address` | GET | Treasury | Portfolio USD value |
| Balance | `/api/v6/dex/balance/all-token-balances-by-address` | GET | Treasury | Token balances with metadata |
| Gateway | `/api/v6/dex/pre-transaction/gas-price` | GET | Executor | Gas price estimation |
| Portfolio | `/api/v6/dex/market/portfolio/overview` | GET | Treasury | Wallet PnL analytics |

### Authentication

All requests are authenticated with HMAC-SHA256 signed headers per the OKX Developer Portal specification. The signing string is `timestamp + method + requestPath + queryOrBody`, hashed with the project's secret key. POST endpoints sign the JSON body instead of query string. Implementation: `packages/shared/src/onchainOS.ts`.

---

## Smart Contract

### AgentRegistry

On-chain registry and attestation layer. Agents register metadata (role, endpoint, pricing), track performance, and submit verifiable cycle attestations. Every arbitrage cycle records real market data on-chain -- price snapshots, spread calculations, venue counts, and agent decisions -- creating an immutable audit trail.

```
Contract:  0xB8406ad5A79721d8D411837b68dfc5E4FF1A41e4
Network:   X Layer Mainnet (Chain ID: 196)
Compiler:  Solidity 0.8.24, optimizer enabled (200 runs)
Framework: Hardhat + OpenZeppelin Ownable
Tests:     33 passing
```

**Agent Registry**: `register()`, `getAgent()`, `getAllAgents()`, `getAgentCount()`, `updateEndpoint()`, `updatePrice()`, `recordSuccess()`, `recordFailure()`, `deactivate()`

**Cycle Attestation**: `attestCycle()`, `getAttestation()`, `getLatestAttestations()`, `attestationCount()`

Each attestation records: best bid/ask prices (18 decimals), spread in basis points, venue count, buy/sell venue hashes, decision (EXECUTE/MONITOR/SKIP), estimated profit in cents, and the attesting agent's address. All EXECUTE cycles and every 5th MONITOR cycle are attested on-chain.

Source: `packages/contracts/contracts/AgentRegistry.sol`

### On-Chain Verification

Every arbitrage cycle is attested on X Layer. Each attestation records:
- Real-time prices from all scanned venues
- Calculated spread in basis points
- Agent decision (EXECUTE / MONITOR / SKIP)
- Estimated profit/loss

This creates an immutable, verifiable audit trail. Anyone can read the attestations from the AgentRegistry contract and independently verify the system's behavior.

```
Contract: 0xB8406ad5A79721d8D411837b68dfc5E4FF1A41e4
Explorer: https://www.okx.com/explorer/xlayer/address/0xB8406ad5A79721d8D411837b68dfc5E4FF1A41e4
```

---

## Mainnet Deployment

### Addresses

| Component | Address | Explorer |
|-----------|---------|----------|
| AgentRegistry (v2 + Attestations) | `0xB8406ad5A79721d8D411837b68dfc5E4FF1A41e4` | [Contract](https://www.okx.com/web3/explorer/xlayer/address/0xB8406ad5A79721d8D411837b68dfc5E4FF1A41e4) |
| Scout Wallet | `0xddEecB2b67564541D5E765c4351C579F5F73a41e` | [Transactions](https://www.okx.com/web3/explorer/xlayer/address/0xddEecB2b67564541D5E765c4351C579F5F73a41e) |
| Analyst Wallet | `0x103b2E12CDB4AaE9700b67f77c72394E26402d09` | [Transactions](https://www.okx.com/web3/explorer/xlayer/address/0x103b2E12CDB4AaE9700b67f77c72394E26402d09) |
| Executor Wallet | `0xd934004742213b3263A9A66c6d9390215B7f95e6` | [Transactions](https://www.okx.com/web3/explorer/xlayer/address/0xd934004742213b3263A9A66c6d9390215B7f95e6) |
| Treasury Wallet | `0x89583a5f27585309639d7Ed4ce30814d581F68Ed` | [Transactions](https://www.okx.com/web3/explorer/xlayer/address/0x89583a5f27585309639d7Ed4ce30814d581F68Ed) |
| Deployer Wallet | `0x4aF5d30b53B20d68A90D3FCb5780D9d661493326` | [Transactions](https://www.okx.com/web3/explorer/xlayer/address/0x4aF5d30b53B20d68A90D3FCb5780D9d661493326) |
| USDC (X Layer) | `0x74b7f16337b8972027f6196a17a631ac6de26d22` | [Token](https://www.okx.com/web3/explorer/xlayer/address/0x74b7f16337b8972027f6196a17a631ac6de26d22) |

### Transaction Log

All transactions verified on X Layer mainnet:

| # | Operation | Tx Hash | Explorer |
|---|-----------|---------|----------|
| 1 | Fund Scout (0.003 OKB) | `0x8640e3f2...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x8640e3f255cd24fb9295eea825fc95c7aa02094558f94cb7017f29b788a4f0c5) |
| 2 | Fund Analyst (0.003 OKB) | `0x4410a6cc...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x4410a6cc952203144f0b331d223c200d8408553b7387bd5539a4bfba75e3abec) |
| 3 | Fund Executor (0.003 OKB) | `0x64c1bcbe...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x64c1bcbea7d9fd9292b4b8a84f88fc2f25d39b563e24228173018e4db4cd830e) |
| 4 | Fund Treasury (0.003 OKB) | `0xb3ef5acb...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0xb3ef5acb45f1f8c883566fd978cd8b59871d149e69ad42cf3f81f1b1b5b5655a) |
| 5 | Transfer 0.1 USDC to Scout | `0x12d67909...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x12d67909a985beda537b0af0534215e8bd756eb9ffbccb225dd34156911a1d1d) |
| 6 | Transfer 0.5 USDC to Analyst | `0xaf3873a9...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0xaf3873a99f248d097c1ed7f221356904b24ab60ddd706d439d62d36741b78aa9) |
| 7 | Transfer 0.5 USDC to Executor | `0x3b22ec64...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x3b22ec6454262f03a1a37742aac82e2b92e7e5bb6c4c77a3c6d971007b17fcb9) |
| 8 | Register Scout on AgentRegistry | `0x6a87c5ca...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x6a87c5caa75cece7b030e382420dbd2861ba4835c8c47735f74822a7a95c74dd) |
| 9 | Register Analyst on AgentRegistry | `0x4c32f645...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x4c32f645b9dcc7fd0c23a48a14cfcd7d43075abe54a4c90762f003d81b83d0c8) |
| 10 | Register Executor on AgentRegistry | `0x2230a8db...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x2230a8dbf35e0a8a30967b404f42bc533be1a0a1193a6c2e4c69dbd0e0f93ab7) |
| 11 | Register Treasury on AgentRegistry | `0xb1730237...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0xb1730237bbbd34f7f265cb5d477f75b990164d39263902b7695323251917a38f) |
| 12 | Cycle 1: Executor recordSuccess | `0x4ea5fd0e...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x4ea5fd0ee46bd884ea06cf839cc5cab12aa400e88513e667faa9dcf0cfa2d69a) |
| 13 | Cycle 2: Executor recordSuccess | `0x3875480e...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x3875480e9d6f48a1f4657ae3cfc15bb5d51515b02c828c36be56a8cf980fc7a1) |
| 14 | Deploy AgentRegistry v2 (+ attestations) | `--` | [Contract](https://www.okx.com/explorer/xlayer/address/0xB8406ad5A79721d8D411837b68dfc5E4FF1A41e4) |
| 15 | Register Scout (v2) | `0x6c61d698...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x6c61d69826fce25ea9948563b1cf43acfb0de3ed4d868907606052f533fe61f4) |
| 16 | Register Analyst (v2) | `0xf8db1873...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0xf8db1873a1402695c23512042ab426f81750970761dc5d2056ca2310faeb2046) |
| 17 | Register Executor (v2) | `0x607d6e13...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x607d6e133771fb130303cbfe11364718577e6b21411297ee562fd12e0d1a881c) |
| 18 | Register Treasury (v2) | `0xae95379b...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0xae95379b20a2e72cecc22a0e939a753375a0630e1db6612d64ae1863b9090872) |

#### Real x402 USDC Payments (Closed-Loop Agent Economy)

Every inter-agent payment is a real ERC-20 USDC transfer on X Layer mainnet forming a closed economic loop:

- **Service payments**: ANALYST → SCOUT (0.02 USDC signal purchase), EXECUTOR → ANALYST (0.03 USDC analysis purchase), TREASURY → EXECUTOR (up to 0.10 USDC executor fee)
- **Profit redistribution**: SCOUT → TREASURY (0.02 USDC return), EXECUTOR → TREASURY (0.07 USDC return)
- **Net cost per cycle: ~0.01 USDC** — the system is economically self-sustaining

10 verified USDC transfers across 5 cycles. All transfers visible on the agent wallet explorer pages:

| Payment | Amount | Verify |
|---------|--------|--------|
| ANALYST → SCOUT (signal_purchase) × 5 cycles | 0.02 USDC each | [Analyst Wallet](https://www.okx.com/web3/explorer/xlayer/address/0x103b2E12CDB4AaE9700b67f77c72394E26402d09) |
| SCOUT → TREASURY (profit_return) × 5 cycles | 0.02 USDC each | [Scout Wallet](https://www.okx.com/web3/explorer/xlayer/address/0xddEecB2b67564541D5E765c4351C579F5F73a41e) |

#### On-Chain Cycle Attestations

Every arbitrage cycle is attested on-chain via `AgentRegistry.attestCycle()`. Each attestation records real-time prices, spread (bps), venue count, decision (EXECUTE/MONITOR), and estimated profit — creating an immutable, verifiable audit trail.

| # | Cycle | Decision | Spread | Tx Hash | Explorer |
|---|-------|----------|--------|---------|----------|
| 29 | #1 | EXECUTE | 10 bps | `0x9db6b257...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x9db6b257cf180ab6f77bf540497a86c7e65102ba932f022cbee79788c1675e9e) |
| 30 | #1 | EXECUTE | 8 bps | `0x19f633b5...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x19f633b5a01c4c2f93f88361a6938ad7127b23cb664e19a44f61e5456b09e355) |
| 31 | #2 | EXECUTE | 8 bps | `0xc01be87a...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0xc01be87aaf6300984b682db0833c6ef3a537c5bda77944401202c5d8699e66d5) |
| 32 | #3 | EXECUTE | 4 bps | `0xec3080e8...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0xec3080e80db76b45e84cbe68ec350a67d43ff4f12600037d3e59a91a679fe1bc) |
| 33 | #4 | EXECUTE | 4 bps | `0xd046454a...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0xd046454a33606173d1b4f55c78ac9c9cdcbbec5c32b2216a226c885ae4f88b0e) |
| 34 | #5 | MONITOR | 10 bps | `0x273827d7...` | [View](https://www.okx.com/web3/explorer/xlayer/tx/0x273827d7774e6071403e08386ba51be4aa83014182d601b54308e9ba361db851) |

---

## Dashboard

Real-time monitoring interface. Dark theme, JetBrains Mono for data, Instrument Serif for headers, Inter for body text.

| Component | Description |
|-----------|-------------|
| Pipeline Visualization | Animated progress dots — active agent pulses yellow, completed green, pending gray |
| Trade History | Expandable rows — click to see full breakdown: buy/sell cards, fee analysis, all venue prices as bar chart |
| Agent Status Cards | Dynamic status per agent (SCANNING / ANALYZING / EXECUTING / DISTRIBUTING) with colored left borders |
| x402 Payment Stream | Real-time feed with ON-CHAIN badges and explorer links for verified payments |
| Portfolio Panel | Total value, session P&L with sparkline chart, token allocation bars |
| Risk Panel | Circuit breaker status, daily loss progress bar with 5% limit |
| On-Chain Attestations | List of cycle attestations with tx hashes and X Layer explorer links |
| Demo Mode Toggle | Switch between simulated $800K portfolio (real prices) and live wallet balances |

Features: WebSocket real-time updates, F5 persistence (full history replayed on reconnect), responsive layout (desktop/tablet/mobile).

## Demo Mode

AgentHedge includes a production-realistic demo mode (`DEMO_MODE=true`) that simulates an $800K portfolio distributed across venues while using 100% real market data.

**What's real in demo mode:**
- All prices from OnchainOS and CEX APIs (live market data, verified against exchanges)
- Liquidity analysis (real DEX quotes + real CEX order books)
- Cost calculations (real exchange fees, gas estimates)
- x402 payments (real USDC transfers when `X402_REAL_PAYMENTS=true`)
- On-chain attestations (real transactions recording cycle data)

**What's simulated:**
- Portfolio balances ($100K per venue)
- Trade execution (order placement is simulated, not real swaps)
- Market microstructure (venue latency profiles create natural spread variation)

## Telegram Bot

Real-time alerts and remote control via Telegram (`TELEGRAM_ENABLED=true`).

**Alerts:** Trade executed (venue pair, size, P&L), spread threshold crossed, on-chain attestation confirmed, system start/stop.

**Commands:** `/status` — agent statuses and portfolio | `/trades` — last 5 trades | `/pnl` — session summary | `/pause` / `/resume` — remote pipeline control | `/help` — command reference.

Setup: Create a bot via @BotFather, configure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`. See `docs/TELEGRAM_SETUP.md`.

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- OKX Developer Portal API keys ([https://web3.okx.com/build/dev-portal](https://web3.okx.com/build/dev-portal))

### Installation

```bash
git clone https://github.com/anilkaracay/AgentHedge.git
cd AgentHedge
npm install
cp .env.example .env
```

### Configuration

Edit `.env` with:

```env
# Generate 5 wallets: npx tsx scripts/generateWallets.ts
SCOUT_PK=0x...
ANALYST_PK=0x...
EXECUTOR_PK=0x...
TREASURY_PK=0x...
DEPLOYER_PK=0x...

# From OKX Developer Portal
OKX_API_KEY=...
OKX_SECRET_KEY=...
OKX_PASSPHRASE=...
OKX_PROJECT_ID=...
```

### Deploy Contract

```bash
# Testnet
npm run deploy:contract

# Mainnet
npm run deploy:mainnet
```

Update `REGISTRY_ADDRESS` in `.env` with the deployed contract address.

### Start System

```bash
# All components (agents + orchestrator + dashboard)
npm run dev:all

# Or individually
npm run dev:agents        # Scout, Analyst, Executor, Treasury
npm run dev:orchestrator  # Pipeline coordinator + WebSocket
npm run dev:dashboard     # React dashboard (port configured in .env)
```

### Run Tests

```bash
npm test                              # 33 smart contract tests
npx tsx scripts/testnetDryRun.ts      # 17-point system dry run
npx tsx scripts/testRefactored.ts     # 12-point live API test
```

---

## Project Structure

```
agenthedge/
├── packages/
│   ├── shared/                         # Shared library (all agents import from here)
│   │   └── src/
│   │       ├── AgentBase.ts            # Abstract base class for all agents
│   │       ├── onchainOS.ts            # OnchainOS API client (HMAC auth, retry, price oracle)
│   │       ├── x402Client.ts           # x402 payment client (402 negotiation + signing)
│   │       ├── x402Server.ts           # x402 payment middleware (verification)
│   │       ├── registry.ts             # AgentRegistry contract client (ethers.js v6)
│   │       ├── config.ts              # Environment configuration with validation
│   │       ├── logger.ts              # Structured JSON logging
│   │       ├── eventBus.ts            # Singleton event emitter for dashboard
│   │       └── types.ts              # All shared TypeScript interfaces
│   ├── contracts/                      # Solidity smart contracts
│   │   ├── contracts/
│   │   │   └── AgentRegistry.sol       # On-chain agent registry
│   │   ├── test/
│   │   │   └── AgentRegistry.test.ts   # 33 Hardhat tests
│   │   ├── scripts/
│   │   │   └── deploy.ts              # Deployment script
│   │   └── hardhat.config.ts          # X Layer mainnet + testnet networks
│   ├── agents/
│   │   ├── scout/src/                  # Price scanner + x402 signal server
│   │   ├── analyst/src/                # Profit analyzer + x402 recommendation server
│   │   ├── executor/src/               # Trade pipeline (quote/approve/swap)
│   │   └── treasury/src/              # Risk manager + profit distributor
│   ├── orchestrator/src/               # Pipeline loop + WebSocket server
│   └── dashboard/src/                  # React + TailwindCSS + Recharts + Socket.io
├── scripts/
│   ├── generateWallets.ts             # Generate agent wallets
│   ├── mainnetSetup.ts                # Fund, register, and run demo cycles
│   ├── testnetDryRun.ts               # Offline system test (17 checks)
│   ├── testRefactored.ts             # Live API integration test (12 checks)
│   ├── testnetLive.ts                 # Testnet on-chain test
│   ├── testOKXApi.ts                  # OnchainOS API connectivity test
│   └── mainnet-tx-hashes.json         # Mainnet transaction hashes
├── docs/                               # Architecture and API documentation
├── .env.example                        # Environment template
├── tsconfig.base.json                  # Shared TypeScript configuration
└── package.json                        # npm workspaces root
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Smart Contracts | Solidity 0.8.24, OpenZeppelin 5.x |
| Contract Tooling | Hardhat, @nomicfoundation/hardhat-toolbox |
| Blockchain | X Layer Mainnet (Chain ID 196) |
| Runtime | Node.js 20, TypeScript 5.4 |
| Blockchain Client | ethers.js v6 |
| API Integration | OKX OnchainOS API v6 (HMAC-SHA256 auth) |
| Payment Protocol | x402 (HTTP 402, USDC on X Layer) |
| Agent Servers | Express.js |
| Real-time | Socket.io (WebSocket) |
| Dashboard | React 18, TailwindCSS v4, Recharts |
| Build | Vite 8, npm workspaces |
| Testing | Hardhat + Mocha/Chai (contracts), custom scripts (integration) |

---

## Hackathon Criteria

### Judging Alignment

| Criterion | Evidence |
|-----------|----------|
| OnchainOS Integration | 5 modules (Swap, Market, Balance, Gateway, Portfolio), 10+ endpoints across all 4 agents; HMAC-SHA256 auth |
| x402 Payments | Real USDC ERC-20 transfers on X Layer mainnet — closed-loop economy with profit redistribution. 10+ verified payment transactions |
| On-Chain Activity | 34+ mainnet transactions: contract deployment, agent registration, real x402 USDC payments, cycle attestations. All verifiable on X Layer explorer |
| Technical Depth | 4-agent pipeline; 33 smart contract tests; dual-sided liquidity analysis; multi-tier fee modeling; real-time dashboard; Telegram bot; responsive design |

### Special Prize Qualification

| Prize | Qualification |
|-------|--------------|
| Most Innovative | Decomposed arbitrage into a 4-agent service marketplace where each stage is independently replaceable and economically incentivized via x402 |
| Best in Agentic Payments | x402 is not an add-on -- it is the core coordination mechanism; agents cannot communicate without paying; payment model creates a self-sustaining agent economy |
| Highest Real-World Adoption | Production-ready pipeline with configurable thresholds, circuit breaker, profit distribution; tested with live mainnet prices verified against exchanges |
| X Layer Ecosystem Integration | Native on X Layer mainnet (Chain ID 196); uses OnchainOS DEX Aggregator for all trade routing; contract deployed and verified on X Layer |
| Community Favorite | Open-source MIT license; comprehensive documentation; real-time dashboard with animated payment visualization |

---

## Business Model

| Revenue Stream | Mechanism | Scale |
|---------------|-----------|-------|
| Protocol Fee | Configurable percentage on each profitable arbitrage cycle | Per-trade; grows with volume |
| Premium Registry | Verified agent listings with SLA guarantees and priority routing | Per-agent subscription |
| Data Licensing | Historical signal, spread, and execution data from the pipeline | Per-query or subscription |
| Enterprise API | White-label agent deployment for institutional trading desks | Per-deployment licensing |

The flywheel effect: more agents registered on the registry increases signal quality and competition, which attracts more capital to Treasury, which increases trade volume, which generates more fees to sustain agent incentives.

---

## Roadmap

### Phase 1: Arbitrage Engine (Current -- Hackathon)

✅ 4-agent sequential pipeline: Scout → Analyst → Executor → Treasury
✅ Full OnchainOS integration -- 5 modules (Swap, Market, Balance, Gateway, Portfolio), 10+ endpoints
✅ Real x402 USDC micropayments between agents -- 10 verified mainnet ERC-20 transfers
✅ On-chain cycle attestations -- verifiable market data recorded per cycle (6 mainnet transactions)
✅ CeDeFi arbitrage across X Layer DEX and multiple CEX venues (OKX, MEXC, Gate.io)
✅ Closed-loop agent economy -- Treasury funds operations, agents earn per service, profits return to Treasury
✅ Dual-sided liquidity analysis -- OnchainOS DEX quote + CEX order book depth simulation
✅ Real-time multi-venue price feeds -- verified against live exchange prices
✅ Multi-tier fee modeling with venue-specific cost structures
✅ AgentRegistry smart contract deployed on X Layer mainnet with cycle attestation support
✅ Telegram bot for real-time trade alerts and operator controls (/status, /pnl, /pause, /resume)
✅ Real-time monitoring dashboard with WebSocket event streaming
✅ 34+ verified mainnet transactions -- contract deployment, agent registration, x402 payments, and attestations

### Phase 2: Multi-Asset Expansion (Q2 2026)

- **Multi-token scanning**: OKB, USDT, WETH, WBTC -- any token with X Layer DEX liquidity
- **Stablecoin depeg arbitrage**: USDT/USDC spread monitoring across venues -- profit from temporary depegs
- **Dynamic token discovery**: Auto-detect new tokens with sufficient DEX liquidity via OnchainOS token API
- **Concurrent pipelines**: Run multiple token pipelines in parallel (OKB + USDT + WETH simultaneously)
- **Expanded CEX coverage**: Add Binance full integration, Bybit, Crypto.com, Bitget
- **Historical performance tracking**: On-chain attestation analytics -- win rate, avg spread, cumulative P&L over time

### Phase 3: Multi-Chain Arbitrage (Q3 2026)

- **Cross-chain DEX scanning**: X Layer + Ethereum + Arbitrum + Base -- same token, different chain DEX prices
- **OnchainOS multi-chain**: Leverage OnchainOS aggregator/quote on chainIndex 1 (ETH), 42161 (Arbitrum), 8453 (Base)
- **Bridge-aware cost calculator**: Factor in bridge fees, time, and slippage for cross-chain routes
- **Chain-specific Executor agents**: Dedicated Executor per chain with optimized gas strategies
- **MEV protection**: Private transaction submission on chains with MEV risk
- **Cross-chain attestations**: Unified audit trail across multiple chains

### Phase 4: Managed Vault Protocol (Q4 2026)

- **AgentHedge Vault**: ERC-4626 vault contract on X Layer
  - Users deposit USDC → vault funds the agent swarm → arbitrage profits return to vault → users earn yield
  - No lock-up period -- withdraw anytime
  - Transparent: every trade attested on-chain, every P&L verifiable
- **Automated capital allocation**: Treasury dynamically distributes vault capital across venues based on liquidity depth
- **Risk tiers**:
  - Conservative: stablecoin arbitrage only, lower APY, near-zero risk
  - Balanced: OKB + stablecoin arbitrage, medium APY
  - Aggressive: all tokens including volatile pairs, highest APY
- **Performance fees**: 15% of profits (industry standard) -- protocol revenue
- **On-chain reporting**: Monthly vault performance attestations, fully auditable

### Phase 5: Agent-as-a-Service / Intelligence Marketplace (2027)

- **x402 Price Oracle API**: External projects pay per query for multi-venue price data
  - `GET /api/price/OKB` → returns multi-venue price comparison → costs 0.01 USDC via x402
  - Any DeFi protocol can consume Scout's intelligence without running their own infrastructure
- **Pluggable agent architecture**: Third-party developers create custom Scout or Analyst agents
  - Register on AgentRegistry → compete for routing based on signal quality and price
  - Better signals → more x402 purchases → market-driven agent evolution
- **Agent reputation system**: On-chain track record of each agent's prediction accuracy
  - Agents with higher accuracy attract more x402 payments
  - Natural selection -- bad agents earn nothing, good agents thrive
- **White-label swarm**: Other protocols deploy their own AgentHedge instance
  - DeFi protocols embed arbitrage as a service
  - Institutional desks license the swarm for their own strategies

### Phase 6: Autonomous Agent Economy (2027+)

- **Self-improving agents**: Agents use historical attestation data to optimize strategies
- **Cross-protocol arbitrage**: Lending rate arbitrage (Aave vs Compound), yield arbitrage, liquidation opportunities
- **DAO governance**: Token holders vote on vault parameters, fee structures, and new agent proposals
- **Fully autonomous treasury**: No human intervention -- Treasury agent manages all capital allocation, risk, and rebalancing based on market conditions

---

## Team

Built by Cayvox Labs for the X Layer Onchain OS AI Hackathon.

| Member | Role |
|--------|------|
| Anıl Karaçay | Founder & Lead Developer — Architecture, smart contracts, agent pipeline, OnchainOS integration |
| Sude Ceren Şahin | Lead Engineer — Agent implementation, testing, protocol research |
| Yusuf Şimşek | Growth — Community, social media, partnerships, hackathon submissions |

---

## Links

- **GitHub:** [github.com/anilkaracay/AgentHedge](https://github.com/anilkaracay/AgentHedge)
- **Contract:** [X Layer Explorer](https://www.okx.com/web3/explorer/xlayer/address/0xB8406ad5A79721d8D411837b68dfc5E4FF1A41e4)
- **Demo Video:** [YouTube](https://youtu.be/OrgI-qv6trQ)

---

## License

MIT

---

## Acknowledgments

- OKX and the X Layer team for OnchainOS infrastructure and the x402 payment protocol
- Built for the X Layer Onchain OS AI Hackathon, March 2026
