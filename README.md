# AgentHedge

**Autonomous Multi-Agent CeDeFi Arbitrage Swarm on X Layer**

Four AI agents collaborate through a sequential pipeline to discover CEX/DEX price discrepancies, validate profitability, execute on-chain trades, and manage risk — all connected via x402 micropayments with zero gas fees on X Layer.

> Built for the **X Layer Onchain OS AI Hackathon** (Phase 1: March 12–26, 2026)

## Architecture

```
┌─────────┐  x402   ┌──────────┐  x402   ┌──────────┐  x402   ┌──────────┐
│  SCOUT  │ ──────→ │ ANALYST  │ ──────→ │ EXECUTOR │ ──────→ │ TREASURY │
│ :3001   │ 0.02$   │ :3002    │ 0.03$   │ :3003    │ profit  │ :3004    │
└────┬────┘         └────┬─────┘         └────┬─────┘         └────┬─────┘
     │                   │                    │                    │
     │ Market API        │ Market API         │ Trade API          │ Wallet API
     │ (prices,trades)   │ (candles)          │ (quote,swap)       │ (balance,history)
     └───────────────────┴────────────────────┴────────────────────┘
                              OnchainOS API v6
                          https://web3.okx.com/api/v6/
```

## How It Works

### 1. Scout Agent (Port 3001)
Continuously scans for price discrepancies between X Layer DEX (chainIndex=196) and Ethereum mainnet (chainIndex=1) as CEX reference. When spread exceeds 0.3%, generates an `OpportunitySignal` available via x402-protected endpoint.

### 2. Analyst Agent (Port 3002)
Purchases Scout's signal via x402 (pays 0.02 USDC), validates freshness, re-checks current price, and calculates net profitability after slippage, price impact, and agent fees. Produces an `ExecutionRecommendation` — EXECUTE or SKIP.

### 3. Executor Agent (Port 3003)
Purchases Analyst's recommendation via x402 (pays 0.03 USDC), requests Treasury risk approval, then executes the full trade pipeline: quote → approve → swap → confirm via OnchainOS Trade API. Records success/failure on the AgentRegistry smart contract.

### 4. Treasury Agent (Port 3004)
Manages capital and risk. Enforces daily loss limits (5%), single trade caps (20% of portfolio), and circuit breaker logic. Distributes profit: 10% to Executor, 5% management fee, 85% back to pool. Monitors portfolio via Wallet API every 30s.

### Orchestrator (Port 3005)
Coordinates the pipeline loop, manages WebSocket server for the real-time dashboard, and handles graceful shutdown.

### Dashboard (Port 3000)
React SPA with live WebSocket visualization: agent network graph with animated x402 payment edges, scrolling payment stream, trade history table, and risk dashboard with P&L chart and circuit breaker status.

## OnchainOS APIs Used

- [x] **Market API** — `GET /api/v6/dex/market/price-info` — Real-time token prices
- [x] **Market API** — `GET /api/v6/dex/market/trades` — Recent trades and volume
- [x] **Market API** — `GET /api/v6/dex/market/candles` — OHLCV candle data
- [x] **Trade API** — `GET /api/v6/dex/aggregator/quote` — Optimal swap routes
- [x] **Trade API** — `GET /api/v6/dex/aggregator/approve` — Token approvals
- [x] **Trade API** — `GET /api/v6/dex/aggregator/swap` — Swap calldata
- [x] **Wallet API** — `GET /api/v6/wallet/asset/token-balances` — Token balances
- [x] **Wallet API** — `GET /api/v6/wallet/asset/total-value` — Portfolio valuation

All API calls use HMAC-SHA256 authentication via a shared `onchainOS.ts` client with automatic retry and exponential backoff.

## x402 Integration

Every agent-to-agent interaction is an **x402 micropayment** on X Layer:

| From | To | Amount | Purpose |
|---|---|---|---|
| Analyst | Scout | 0.02 USDC | Signal purchase |
| Executor | Analyst | 0.03 USDC | Recommendation purchase |
| Treasury | Executor | 10% profit | Execution fee |

- **Network**: `eip155:196` (X Layer mainnet)
- **Token**: USDC (6 decimals)
- **Gas**: Zero (OKX relayer sponsored)
- **Settlement**: Instant, on-chain, final

## Smart Contract

**AgentRegistry** — Lightweight on-chain registry where agents register metadata, track performance, and enable discovery.

- Deployed on X Layer (Chain ID: 196)
- Solidity 0.8.24 with OpenZeppelin Ownable
- 24 passing tests

## Tech Stack

- **Runtime**: Node.js 20+, TypeScript
- **Blockchain**: X Layer (Chain ID 196), ethers.js v6
- **Contracts**: Solidity 0.8.24, Hardhat
- **APIs**: OKX OnchainOS REST API v6
- **Payments**: x402 protocol
- **Dashboard**: React 18, TailwindCSS, Recharts, Socket.io
- **Monorepo**: npm workspaces

## Setup

### Prerequisites

- Node.js 20+
- npm 10+

### 1. Clone & Install

```bash
git clone https://github.com/anilkaracay/AgentHedge.git
cd AgentHedge
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Fill in:
- `SCOUT_PK`, `ANALYST_PK`, `EXECUTOR_PK`, `TREASURY_PK`, `DEPLOYER_PK` — Generate 5 wallets
- `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, `OKX_PROJECT_ID` — From [OKX Developer Portal](https://web3.okx.com/build/dev-portal)
- `USDC_ADDRESS` — USDC contract address on X Layer

### 3. Deploy Smart Contract

```bash
# Testnet
npm run deploy:contract

# Mainnet
npm run deploy:mainnet
```

Copy the deployed address to `REGISTRY_ADDRESS` in `.env`.

### 4. Build & Start

```bash
# Build all packages
npm run build

# Start everything (agents + orchestrator + dashboard)
npm run dev:all
```

Or start individually:

```bash
npm run dev:agents        # All 4 agents
npm run dev:orchestrator  # Pipeline orchestrator
npm run dev:dashboard     # React dashboard at http://localhost:3000
```

### 5. Run Tests

```bash
npm test  # 24 smart contract tests
```

## Project Structure

```
agenthedge/
├── packages/
│   ├── shared/              # Shared utilities (types, config, API client, x402, logger)
│   ├── contracts/            # AgentRegistry Solidity contract + Hardhat
│   ├── agents/
│   │   ├── scout/            # Agent 1: Price scanning
│   │   ├── analyst/          # Agent 2: Profitability analysis
│   │   ├── executor/         # Agent 3: Trade execution
│   │   └── treasury/         # Agent 4: Risk & capital management
│   ├── orchestrator/         # Pipeline coordinator + WebSocket
│   └── dashboard/            # React real-time dashboard
├── docs/                     # Architecture & API documentation
├── .env.example              # Environment template
└── README.md
```

## Demo

[Demo Video](https://youtu.be/PLACEHOLDER)

## X Layer Mainnet Transactions

| Description | Tx Hash |
|---|---|
| AgentRegistry Deployment | `0x...` |
| Agent Registration | `0x...` |
| x402 Payment | `0x...` |
| DEX Swap Execution | `0x...` |

## License

MIT
