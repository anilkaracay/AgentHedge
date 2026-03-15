# AgentHedge — Autonomous Multi-Agent CeDeFi Arbitrage Swarm

## What This Project Is

AgentHedge is a **4-agent arbitrage swarm** built natively on **X Layer** (OKX's L2, Chain ID 196). Four specialized AI agents — Scout, Analyst, Executor, Treasury — collaborate through a sequential pipeline, discovering CEX/DEX price discrepancies, validating profitability, executing on-chain trades, and managing risk/profit distribution. Every inter-agent interaction is an **x402 micropayment** on X Layer with zero gas fees.

**This is a hackathon submission for the X Layer Onchain OS AI Hackathon (Phase 1: March 12–26, 2026).**

## Critical Context

- **Chain**: X Layer Mainnet (Chain ID: 196, RPC: `https://rpc.xlayer.tech`)
- **APIs**: OKX OnchainOS REST API v6 (Trade, Market, Wallet, x402 Payments)
- **Payments**: x402 protocol — HTTP 402 based micropayments in USDC on X Layer, zero gas
- **Language**: TypeScript, Node.js 20+
- **Smart Contracts**: Solidity 0.8.24, Hardhat
- **Dashboard**: React 18 + TailwindCSS + Recharts + Socket.io

## Documentation

Read these docs BEFORE writing any code. They contain exact API endpoints, parameter names, auth headers, code patterns, and architectural decisions:

1. `docs/ARCHITECTURE.md` — System architecture, agent pipeline, data flow
2. `docs/ONCHAIN_OS_API.md` — **CRITICAL**: Exact OnchainOS API endpoints, parameters, auth, and response schemas
3. `docs/X402_INTEGRATION.md` — x402 server/client implementation patterns
4. `docs/SMART_CONTRACT.md` — AgentRegistry Solidity contract specification
5. `docs/AGENTS.md` — Detailed spec for each of the 4 agents
6. `docs/DASHBOARD.md` — Dashboard components and WebSocket events
7. `docs/DEPLOYMENT.md` — X Layer deployment, environment setup, testing

## Project Structure

```
agenthedge/
├── packages/
│   ├── contracts/                  # Solidity smart contracts
│   │   ├── contracts/
│   │   │   └── AgentRegistry.sol
│   │   ├── test/
│   │   │   └── AgentRegistry.test.ts
│   │   ├── scripts/
│   │   │   └── deploy.ts
│   │   └── hardhat.config.ts
│   ├── shared/                     # Shared utilities (ALL agents import from here)
│   │   ├── src/
│   │   │   ├── AgentBase.ts        # Abstract base class for all agents
│   │   │   ├── onchainOS.ts        # OnchainOS API client with HMAC auth
│   │   │   ├── x402Client.ts       # x402 payment client (consuming services)
│   │   │   ├── x402Server.ts       # x402 payment middleware (exposing services)
│   │   │   ├── registry.ts         # AgentRegistry contract client
│   │   │   ├── config.ts           # Environment config loader
│   │   │   ├── logger.ts           # Structured logging
│   │   │   ├── eventBus.ts         # Event emitter for dashboard WebSocket
│   │   │   └── types.ts            # ALL shared TypeScript interfaces
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── agents/
│   │   ├── scout/                  # Agent 1: Opportunity Detection
│   │   │   ├── src/
│   │   │   │   ├── index.ts        # Entry point
│   │   │   │   ├── priceScanner.ts # Market API polling + spread detection
│   │   │   │   └── server.ts       # Express + x402 middleware
│   │   │   └── package.json
│   │   ├── analyst/                # Agent 2: Profitability Validation
│   │   │   ├── src/
│   │   │   │   ├── index.ts
│   │   │   │   ├── profitAnalyzer.ts # Slippage, impact, net profit calc
│   │   │   │   └── server.ts
│   │   │   └── package.json
│   │   ├── executor/               # Agent 3: Trade Execution
│   │   │   ├── src/
│   │   │   │   ├── index.ts
│   │   │   │   ├── tradeExecutor.ts # Trade API quote/approve/swap pipeline
│   │   │   │   └── server.ts
│   │   │   └── package.json
│   │   └── treasury/               # Agent 4: Capital & Risk Management
│   │       ├── src/
│   │       │   ├── index.ts
│   │       │   ├── riskManager.ts   # Risk limits, circuit breaker
│   │       │   ├── profitDistributor.ts # x402 profit distribution
│   │       │   └── server.ts
│   │       └── package.json
│   ├── orchestrator/               # Pipeline coordinator
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── pipeline.ts         # Main Scout→Analyst→Executor→Treasury loop
│   │   │   └── scheduler.ts        # Interval management
│   │   └── package.json
│   └── dashboard/                  # React dashboard
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── AgentNetwork.tsx
│       │   │   ├── PaymentStream.tsx
│       │   │   ├── TradeHistory.tsx
│       │   │   └── RiskDashboard.tsx
│       │   └── hooks/
│       │       └── useSocket.ts
│       ├── package.json
│       └── tsconfig.json
├── .env.example
├── docker-compose.yml
├── package.json                    # npm workspaces root
├── tsconfig.base.json
└── README.md
```

## Development Order (STRICT)

Follow this exact order. Do NOT skip steps or build ahead.

### Phase 1: Foundation (Days 1–3)
1. Initialize monorepo with npm workspaces
2. Build `packages/shared` — types, config, logger, onchainOS client, x402 utilities
3. Build `packages/contracts` — AgentRegistry.sol, tests, deploy script
4. Deploy AgentRegistry to X Layer testnet
5. Verify deployment on X Layer explorer

### Phase 2: Scout + Analyst (Days 4–5)
6. Build Scout agent — Market API integration, opportunity detection, x402 server
7. Build Analyst agent — signal consumption (x402 client), profitability analysis, x402 server
8. Test Scout→Analyst x402 payment flow end-to-end on X Layer testnet

### Phase 3: Executor + Treasury (Days 6–8)
9. Build Executor agent — Trade API integration (quote/approve/swap), x402 client
10. Build Treasury agent — Wallet API integration, risk management, profit distribution
11. Test full 4-agent pipeline end-to-end

### Phase 4: Dashboard + Integration (Days 9–10)
12. Build orchestrator pipeline loop
13. Build React dashboard with WebSocket
14. End-to-end integration testing on X Layer mainnet

### Phase 5: Submission (Day 11)
15. Deploy to X Layer mainnet, collect tx hashes
16. Record demo video, write README
17. Create X account, reply to hackathon thread, submit Google Form

## Key Rules

- **ALWAYS read the relevant doc in `docs/` before implementing a component.**
- **NEVER hardcode API endpoints** — use the OnchainOS client in `shared/onchainOS.ts`.
- **NEVER skip x402 integration** — every agent-to-agent call MUST go through x402.
- **ALL TypeScript interfaces live in `shared/types.ts`** — agents import from there.
- **Use ethers.js v6** (not v5). Import syntax differs: `import { ethers } from 'ethers'`.
- **OnchainOS API is v6**: base URL is `https://web3.okx.com/api/v6/...` with `chainIndex` parameter (not `chainId` which was v5).
- **X Layer Chain Index is `196`** for mainnet, `195` for testnet.
- **USDC has 6 decimals** — 1 USDC = `1000000` in raw units. Never use 18 decimals for USDC.
- **All x402 amounts are in token base units** — 0.02 USDC = `"20000"`.
