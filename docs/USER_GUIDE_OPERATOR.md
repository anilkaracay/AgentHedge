# Operator Guide: Self-Hosted AgentHedge Arbitrage

This guide covers everything needed to deploy and operate AgentHedge as a self-hosted CeDeFi arbitrage system on X Layer.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setup Steps](#setup-steps)
3. [Configuration Reference](#configuration-reference)
4. [Profitability Requirements](#profitability-requirements)
5. [Risk Management](#risk-management)
6. [Monitoring and Operations](#monitoring-and-operations)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, ensure you have the following:

### Software

| Requirement | Minimum Version | Notes |
|---|---|---|
| Node.js | 20.0+ | LTS recommended; verify with `node --version` |
| npm | 10.0+ | Ships with Node.js 20; verify with `npm --version` |
| Git | 2.30+ | For cloning the repository |
| Docker (optional) | 24.0+ | Only required if using the Docker Compose deployment |

### Accounts and API Access

| Account | Purpose | Where to Register |
|---|---|---|
| OKX Developer Account | OnchainOS API access (market data, trade execution, swap routing) | https://web3.okx.com/build/dev-portal |
| OKX Trading Account (optional) | CEX leg of arbitrage when `CEX_TRADING_ENABLED=true` | https://www.okx.com |

From the OKX Developer Portal, you will need:
- API Key
- Secret Key
- Passphrase
- Project ID

### Capital Requirements

| Item | Minimum | Recommended | Notes |
|---|---|---|---|
| Trading capital (USDC) | $1,000 | $5,000+ | Must be on X Layer mainnet |
| Agent wallet funding (USDC) | $2 per agent ($10 total) | $10 per agent ($50 total) | Covers x402 inter-agent payments |
| Deployer wallet (OKB) | 0.01 OKB | 0.05 OKB | Gas for AgentRegistry contract deployment |

All USDC must be bridged to X Layer (Chain ID 196) before starting. Use the OKX bridge to transfer USDC from Ethereum or other supported chains.

---

## Setup Steps

### Step 1: Clone the Repository

```bash
git clone https://github.com/your-org/agenthedge.git
cd agenthedge
npm install
```

This installs all dependencies across the monorepo workspaces, including shared utilities, agent packages, the orchestrator, and the dashboard.

### Step 2: Generate Agent Wallets

Each of the four agents and the contract deployer requires its own Ethereum-compatible wallet. Generate five wallets:

```bash
npx ts-node -e "
const { ethers } = require('ethers');
for (const role of ['SCOUT', 'ANALYST', 'EXECUTOR', 'TREASURY', 'DEPLOYER']) {
  const wallet = ethers.Wallet.createRandom();
  console.log(role + '_PK=' + wallet.privateKey);
  console.log(role + '_ADDRESS=' + wallet.address);
  console.log('');
}
"
```

Save the output securely. You will need both the private keys (for `.env`) and the addresses (for funding).

### Step 3: Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in all required values:

1. Paste the five private keys from Step 2 into `SCOUT_PK`, `ANALYST_PK`, `EXECUTOR_PK`, `TREASURY_PK`, and `DEPLOYER_PK`.
2. Enter your OKX Developer Portal credentials: `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, `OKX_PROJECT_ID`.
3. Set the USDC contract address on X Layer for `USDC_ADDRESS`. Verify the address on the X Layer block explorer before using it.
4. Adjust strategy parameters as needed (see [Configuration Reference](#configuration-reference)).

### Step 4: Fund Wallets

Transfer funds to each wallet address generated in Step 2:

1. Bridge USDC to X Layer mainnet via the OKX bridge.
2. Send the bulk of your trading capital to the Treasury wallet address.
3. Send 2-10 USDC to each of the Scout, Analyst, and Executor wallet addresses (for x402 payments).
4. Send 0.01-0.05 OKB to the Deployer wallet address (for contract deployment gas).

Verify all balances on the X Layer explorer before proceeding.

### Step 5: Deploy the AgentRegistry Contract

```bash
# Build contracts
cd packages/contracts
npx hardhat compile

# Deploy to testnet first for validation
npx hardhat run scripts/deploy.ts --network xlayer_testnet

# Once validated, deploy to mainnet
npx hardhat run scripts/deploy.ts --network xlayer
```

Copy the deployed contract address and set it as `REGISTRY_ADDRESS` in your `.env` file.

Optionally verify the contract on the X Layer explorer:

```bash
npx hardhat verify --network xlayer <REGISTRY_ADDRESS>
```

### Step 6: Start the System

**Option A: Direct (recommended for development)**

Open three terminal windows:

```bash
# Terminal 1: Start all four agents
npm run start:agents

# Terminal 2: Start the orchestrator pipeline
npm run start:orchestrator

# Terminal 3: Start the dashboard
npm run start:dashboard
```

**Option B: Docker Compose (recommended for production)**

```bash
docker-compose up -d
```

### Step 7: Verify Operation

1. Open the dashboard at `http://localhost:3000`.
2. Confirm all four agents show as "registered" in the Agent Network panel.
3. Watch for the first opportunity signal in the Payment Stream panel.
4. Monitor the Trade History panel for executed trades.

---

## Configuration Reference

All parameters are set in the `.env` file. The system reads them at startup; a restart is required after changes.

### Strategy Parameters

| Variable | Type | Default | Description |
|---|---|---|---|
| `SPREAD_THRESHOLD` | float | `0.003` | Minimum spread (as a decimal) between CEX and DEX prices to generate an opportunity signal. 0.003 = 0.3%. Lowering this increases signal frequency but may produce unprofitable trades after costs. |
| `MAX_TRADE_SIZE_USDC` | integer | `500` | Maximum USDC value for a single trade. Acts as a hard cap regardless of Treasury approval. Should not exceed 20% of total capital. |
| `DAILY_LOSS_LIMIT_PCT` | float | `0.05` | Maximum allowable daily portfolio loss as a decimal fraction. 0.05 = 5%. When breached, the Treasury activates the circuit breaker and halts all trading until midnight UTC. |
| `SCOUT_POLL_INTERVAL` | integer (ms) | `5000` | Milliseconds between Scout price scans. Lower values catch more opportunities but increase API usage. Minimum recommended: 2000. |
| `PORTFOLIO_POLL_INTERVAL` | integer (ms) | `30000` | Milliseconds between Treasury portfolio balance checks. Used for P&L tracking and circuit breaker evaluation. |

### Operational Modes

| Variable | Type | Default | Description |
|---|---|---|---|
| `CEX_TRADING_ENABLED` | boolean | `false` | When `true`, the Executor places real orders on OKX CEX for the centralized leg of arbitrage. Requires `OKX_TRADE_API_KEY`, `OKX_TRADE_SECRET_KEY`, and `OKX_TRADE_PASSPHRASE` to be set. When `false`, only the DEX leg on X Layer is executed. |
| `DEMO_MODE` | boolean | `false` | When `true`, all trades are simulated. No real transactions are broadcast, no funds are moved, and no x402 payments are settled. Useful for validating configuration and observing pipeline behavior before committing capital. The dashboard still displays simulated data. |

### Network and Port Configuration

| Variable | Type | Default | Description |
|---|---|---|---|
| `XLAYER_RPC` | string | `https://rpc.xlayer.tech` | X Layer mainnet RPC endpoint. |
| `XLAYER_CHAIN_ID` | integer | `196` | X Layer mainnet chain ID. Do not change unless targeting testnet (195). |
| `SCOUT_PORT` | integer | `3001` | HTTP port for the Scout agent. |
| `ANALYST_PORT` | integer | `3002` | HTTP port for the Analyst agent. |
| `EXECUTOR_PORT` | integer | `3003` | HTTP port for the Executor agent. |
| `TREASURY_PORT` | integer | `3004` | HTTP port for the Treasury agent. |
| `ORCHESTRATOR_WS_PORT` | integer | `3005` | WebSocket port for the orchestrator (dashboard connection). |
| `DASHBOARD_PORT` | integer | `3000` | HTTP port for the React dashboard. |

---

## Profitability Requirements

Not every detected spread is profitable after accounting for costs. Understanding the cost structure is essential to configuring thresholds correctly.

### Cost Breakdown Per Trade

| Cost Component | Typical Value | Notes |
|---|---|---|
| x402 agent fees | 0.05 USDC fixed | Scout (0.02) + Analyst (0.03), paid every cycle regardless of trade |
| DEX swap slippage | 0.1-0.5% | Depends on pool liquidity and trade size |
| DEX price impact | 0.05-0.3% | Larger trades move the pool price further |
| X Layer gas | ~0 USDC | Near-zero gas fees on X Layer L2 |
| CEX trading fee (if enabled) | 0.1% | Standard OKX spot taker fee |
| Bridge/transfer fee (cross-venue) | 0-0.5 USDC | Zero for OKX-to-XLayer (native integration); variable for other venues |

### Minimum Spread Thresholds

**OKX-to-X-Layer arbitrage (zero transfer cost):**
- Minimum viable spread: **0.4%** (accounts for slippage + agent fees)
- Recommended threshold: **0.5%** for consistent profitability
- At $500 trade size: 0.4% spread = $2.00 gross, minus ~$0.55 costs = ~$1.45 net profit

**Other CEX-to-X-Layer arbitrage (with transfer costs):**
- Minimum viable spread: **0.7%** (additional bridge/withdrawal fees)
- Recommended threshold: **0.8%** or higher
- At $500 trade size: 0.7% spread = $3.50 gross, minus ~$1.55 costs = ~$1.95 net profit

### Capital and Amortization

Larger capital allocations improve profitability because the fixed cost component (0.05 USDC in agent fees) becomes proportionally smaller:

| Trade Size | Fixed Cost Share | Minimum Spread for Profit |
|---|---|---|
| $100 | 0.05% of trade | ~0.6% |
| $500 | 0.01% of trade | ~0.4% |
| $1,000 | 0.005% of trade | ~0.35% |
| $5,000 | 0.001% of trade | ~0.3% |

This is why the recommended minimum starting capital is $1,000 USDC. With less capital, the fixed per-cycle costs erode margins significantly.

### Recommendations

- Start with `SPREAD_THRESHOLD=0.005` (0.5%) and `MAX_TRADE_SIZE_USDC=500` until you have observed several profitable cycles.
- Monitor the dashboard for the ratio of EXECUTE vs SKIP recommendations from the Analyst. If nearly all signals are SKIP, your spread threshold may be too low (the Analyst correctly rejects them after cost analysis).
- Gradually lower `SPREAD_THRESHOLD` once you have confidence in liquidity conditions and slippage estimates.

---

## Risk Management

AgentHedge has built-in risk controls enforced by the Treasury agent. These protections are always active and cannot be bypassed by other agents.

### Per-Trade Limits

The Treasury enforces a maximum single trade size of **20% of total portfolio value**. This is checked on every trade via the internal `POST /api/risk-check` endpoint before the Executor proceeds.

For example, with $5,000 in total capital, no single trade will exceed $1,000 regardless of the `MAX_TRADE_SIZE_USDC` setting. The effective limit is the lesser of:
- `MAX_TRADE_SIZE_USDC` (configurable, default $500)
- 20% of current portfolio value (enforced by Treasury)

### Daily Loss Circuit Breaker

The Treasury monitors cumulative daily profit and loss. If cumulative daily losses exceed **5% of portfolio value** (configurable via `DAILY_LOSS_LIMIT_PCT`), the circuit breaker activates:

1. All subsequent risk check requests are denied with reason "Circuit breaker active."
2. A `risk_alert` event is emitted to the dashboard.
3. No trades are executed for the remainder of the day.
4. The circuit breaker resets automatically at midnight UTC.

With $5,000 capital and the default 5% limit, the circuit breaker activates after $250 in cumulative daily losses.

### Signal Staleness Rejection

The Analyst rejects any opportunity signal older than 30 seconds. In fast-moving markets, stale price data leads to failed trades and losses. This timeout is intentionally aggressive.

### Executor Safety Checks

Before broadcasting any swap transaction, the Executor validates:
- The quote price matches the Analyst's projection within acceptable tolerance.
- The `toTokenAmount` from the aggregator quote meets or exceeds the `suggestedMinOutput` from the recommendation.
- The trade has received Treasury risk approval.

If any check fails, the trade is skipped and the failure is logged.

### Profit Distribution

After each successful trade, profits are distributed automatically:
- **85%** returned to the capital pool (compounds trading capital)
- **10%** to the Executor agent wallet (execution incentive)
- **5%** retained by Treasury (management fee)

### Operational Risk Practices

- **Never share private keys.** The `.env` file should have restrictive file permissions (`chmod 600 .env`).
- **Start with DEMO_MODE=true** to validate the pipeline before using real capital.
- **Use testnet first.** Deploy to X Layer testnet (Chain ID 195) and run several complete cycles before moving to mainnet.
- **Monitor the dashboard actively** during the first 24 hours of mainnet operation.
- **Keep agent wallets funded.** If an agent wallet runs out of USDC for x402 payments, the pipeline stalls. The dashboard will display payment failure events.

---

## Monitoring and Operations

### Dashboard

The React dashboard at `http://localhost:3000` provides real-time visibility into:

- **Agent Network**: Registration status of all four agents, connection health.
- **Payment Stream**: Live feed of x402 micropayments between agents.
- **Trade History**: Every executed, skipped, and failed trade with transaction hashes.
- **Risk Dashboard**: Portfolio value, daily P&L, circuit breaker status.

### Logs

Each agent produces structured JSON logs to stdout. In Docker Compose, view logs with:

```bash
# All agents
docker-compose logs -f

# Specific agent
docker-compose logs -f scout
docker-compose logs -f treasury
```

When running directly, logs appear in the terminal where each agent was started.

### Health Checks

Each agent exposes an unauthenticated `GET /health` endpoint that returns agent status without requiring x402 payment. Use these for external monitoring:

```
http://localhost:3001/health  # Scout
http://localhost:3002/health  # Analyst
http://localhost:3003/health  # Executor
http://localhost:3004/health  # Treasury
```

### Restarting

If an individual agent crashes or hangs:
- The orchestrator detects the unresponsive agent and skips cycles until it recovers.
- Restart the failed agent independently. It will re-register on the AgentRegistry.
- Other agents continue operating normally; the pipeline resumes on the next cycle.

---

## Troubleshooting

### No Opportunity Signals Detected

- Verify `SPREAD_THRESHOLD` is not set too high. Start with `0.003` (0.3%) to confirm signals are generated, then raise it.
- Check Scout logs for API errors. A 401 response indicates incorrect OKX API credentials.
- Confirm the tracked token pairs have active liquidity on X Layer DEXes.

### Analyst Always Returns SKIP

- The detected spread may be insufficient to cover costs. Check the Analyst logs for `estimatedProfit` values.
- Reduce `MAX_TRADE_SIZE_USDC` to lower slippage estimates, or increase capital to improve the cost ratio.
- Verify that current market conditions actually contain exploitable spreads.

### x402 Payment Failures

- Confirm each agent wallet has sufficient USDC balance on X Layer.
- Verify `USDC_ADDRESS` in `.env` is the correct contract address for USDC on X Layer mainnet.
- Check that the x402 network identifier is `eip155:196`.

### Transaction Reverts on X Layer

- Increase slippage tolerance if the market is volatile.
- Ensure token approval was completed before the swap. Check Executor logs for the approval step.
- Verify the gas limit from the swap API response is sufficient.

### Circuit Breaker Activated Unexpectedly

- Review Trade History for the trades that caused cumulative losses.
- Consider increasing `SPREAD_THRESHOLD` to filter out marginal opportunities.
- The circuit breaker resets at midnight UTC. You can also restart the Treasury agent to reset it manually (use with caution).

### OnchainOS API Rate Limiting

- Increase `SCOUT_POLL_INTERVAL` to reduce request frequency. 10000 (10 seconds) is a conservative setting.
- The `onchainOS.ts` client implements exponential backoff automatically. Check logs for "rate limited" messages.
