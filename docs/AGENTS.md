# Agent Specifications

## Shared Types (packages/shared/src/types.ts)

Define ALL these interfaces in a single file. Every agent imports from here.

```typescript
// ── Agent Config ──
export interface AgentConfig {
  agentId: string;
  role: 'scout' | 'analyst' | 'executor' | 'treasury';
  privateKey: string;
  port: number;
  endpoint: string; // "http://host:port"
  pricePerRequest: number; // in USDC human units (e.g., 0.02)
}

// ── Scout Output ──
export interface OpportunitySignal {
  id: string;                    // uuid
  tokenPair: string;             // "ETH/USDC"
  fromToken: string;             // contract address
  toToken: string;               // contract address
  cexPrice: number;              // CEX reference price
  dexPrice: number;              // DEX price on X Layer
  spreadPercent: number;         // e.g., 0.45 means 0.45%
  direction: 'BUY_DEX' | 'SELL_DEX';
  volume24h: number;
  confidence: number;            // 0-1
  timestamp: string;             // ISO 8601
  expiresAt: string;             // ISO 8601 (timestamp + 30s)
}

// ── Analyst Output ──
export interface ExecutionRecommendation {
  id: string;                    // uuid
  signalId: string;              // references OpportunitySignal.id
  action: 'EXECUTE' | 'SKIP';
  confidence: number;            // 0-1
  estimatedProfit: number;       // in USDC after all costs
  estimatedSlippage: number;     // percent
  estimatedPriceImpact: number;  // percent
  suggestedAmount: string;       // trade amount in token base units
  suggestedMinOutput: string;    // minimum acceptable output
  reason: string;                // human-readable explanation
  timestamp: string;
}

// ── Executor Output ──
export interface TradeResult {
  id: string;
  recommendationId: string;
  status: 'EXECUTED' | 'FAILED' | 'SKIPPED';
  txHash?: string;               // X Layer transaction hash
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut?: string;
  realizedProfit?: number;       // in USDC
  gasUsed?: string;
  blockNumber?: number;
  error?: string;
  timestamp: string;
}

// ── Treasury Types ──
export interface RiskApproval {
  approved: boolean;
  maxTradeSize: string;          // in token base units
  reason?: string;
}

export interface ProfitDistribution {
  tradeId: string;
  totalProfit: number;
  executorFee: number;           // 10% of profit
  treasuryFee: number;           // 5% of profit
  poolReturn: number;            // remaining 85%
  txHashes: string[];            // x402 payment tx hashes
  timestamp: string;
}

export interface PortfolioSnapshot {
  totalValueUSD: number;
  tokenBalances: { token: string; balance: string; valueUSD: number }[];
  dailyPnL: number;
  dailyPnLPercent: number;
  circuitBreakerActive: boolean;
}

// ── Dashboard Events ──
export interface DashboardEvent {
  type: 'agent_registered' | 'signal_detected' | 'analysis_complete'
    | 'trade_executed' | 'profit_distributed' | 'risk_alert'
    | 'x402_payment' | 'cycle_complete' | 'portfolio_update';
  data: any;
  timestamp: string;
}

export interface X402PaymentEvent {
  from: string;     // agent ID
  to: string;       // agent ID
  amount: number;   // USDC human units
  txHash?: string;
  purpose: string;  // "signal_purchase" | "analysis_purchase" | "executor_fee" | "treasury_fee"
}
```

---

## Agent 1: Scout

**File**: `packages/agents/scout/src/`

### Purpose
Continuously scan for CEX/DEX price discrepancies on X Layer.

### OnchainOS APIs Used
- `GET /api/v6/dex/market/price-info` — real-time DEX prices
- `GET /api/v6/dex/market/trades` — volume and liquidity data
- `GET /api/v6/dex/market/token-list` — discover tokens on X Layer

### Logic

1. **On startup**: Register on AgentRegistry contract, start Express server with x402 middleware
2. **Every 5 seconds** (configurable):
   - Call Market Price API for tracked tokens (ETH, WBTC, OKB on X Layer)
   - Get CEX reference prices (also from Market API index/spot prices, or use a separate CEX price source)
   - Calculate spread: `|dexPrice - cexPrice| / cexPrice * 100`
   - If spread > `SPREAD_THRESHOLD` (default 0.3%): create `OpportunitySignal`
   - Store latest signal in memory (overwrite previous)
3. **Endpoint `GET /api/opportunity-signal`** (x402 protected, 0.02 USDC):
   - Returns latest `OpportunitySignal` or 204 if none

### CEX Price Source Strategy

For the hackathon, simplest approach:
- Use OnchainOS Market API with a **different chain** (e.g., Ethereum mainnet, chainIndex=1) as the "CEX reference"
- Compare X Layer DEX price (chainIndex=196) vs Ethereum DEX price (chainIndex=1)
- Price difference between chains = arbitrage opportunity

This is technically **cross-chain DEX arbitrage** which is a valid form of CeDeFi arbitrage.

### Configuration
```
SCOUT_PORT=3001
SCOUT_POLL_INTERVAL=5000
SPREAD_THRESHOLD=0.003  # 0.3%
TRACKED_TOKENS=ETH,WBTC,OKB
```

---

## Agent 2: Analyst

**File**: `packages/agents/analyst/src/`

### Purpose
Purchase Scout's signals and determine if they're actually profitable after costs.

### OnchainOS APIs Used
- `GET /api/v6/dex/market/price-info` — real-time price validation
- `GET /api/v6/dex/market/candles` — short-term trend (is spread widening or narrowing?)

### Logic

1. **On startup**: Register on AgentRegistry, start Express server
2. **When triggered by orchestrator** (or on interval):
   - Call Scout's `/api/opportunity-signal` via x402 (pays 0.02 USDC)
   - If signal is stale (>30s old): SKIP
   - Validate current price hasn't changed significantly (re-check Market API)
   - Calculate:
     - `estimatedSlippage` based on trade size vs 24h volume
     - `estimatedPriceImpact` based on order book depth
     - `gasCost` (near-zero on X Layer but include for completeness)
     - `agentFees` = 0.02 (Scout) + 0.03 (Analyst) = 0.05 USDC
     - `netProfit` = (spread × tradeSize) - slippage - gas - agentFees - priceImpact
   - If `netProfit > 0` AND `confidence > 0.7`: action = EXECUTE
   - Else: action = SKIP
   - Store `ExecutionRecommendation` in memory
3. **Endpoint `GET /api/execution-recommendation`** (x402 protected, 0.03 USDC):
   - Returns latest `ExecutionRecommendation` or 204

### Configuration
```
ANALYST_PORT=3002
MIN_CONFIDENCE=0.7
MIN_NET_PROFIT_USDC=0.50
SIGNAL_MAX_AGE_MS=30000
```

---

## Agent 3: Executor

**File**: `packages/agents/executor/src/`

### Purpose
Execute the actual trade on X Layer via OnchainOS Trade API.

### OnchainOS APIs Used
- `GET /api/v6/dex/aggregator/quote` — get optimal swap route
- `GET /api/v6/dex/aggregator/approve` — token approval if needed
- `GET /api/v6/dex/aggregator/swap` — get swap calldata
- Wallet: `sendTransaction` via ethers.js to X Layer RPC

### Logic

1. **On startup**: Register on AgentRegistry, start Express server
2. **When triggered by orchestrator**:
   - Call Analyst's `/api/execution-recommendation` via x402 (pays 0.03 USDC)
   - If action ≠ EXECUTE: skip
   - Request risk approval from Treasury (direct HTTP, no x402 needed for internal risk checks)
   - If not approved: skip
   - **Trade Pipeline**:
     a. Call `/aggregator/quote` with fromToken, toToken, amount, slippage=0.5%
     b. Validate: `toTokenAmount >= suggestedMinOutput` from recommendation
     c. If needs approval: call `/aggregator/approve`, sign and send approval tx
     d. Call `/aggregator/swap` with same params + `userWalletAddress`
     e. Sign and broadcast swap tx via ethers.js
     f. Wait for confirmation (`tx.wait()`)
     g. Calculate realized P&L
   - Create `TradeResult` and send to Treasury
   - Record success/failure on AgentRegistry contract
   - Emit events to dashboard

### Configuration
```
EXECUTOR_PORT=3003
DEFAULT_SLIPPAGE=0.5
MAX_RETRIES=2
```

---

## Agent 4: Treasury

**File**: `packages/agents/treasury/src/`

### Purpose
Manage capital, enforce risk limits, distribute profits.

### OnchainOS APIs Used
- `GET /api/v6/wallet/asset/token-balances` — portfolio balances
- `GET /api/v6/wallet/asset/total-value` — USD valuation
- `GET /api/v6/dex/market/price-info` — for accurate token pricing

### Logic

1. **On startup**: Register on AgentRegistry, start Express server, load portfolio state
2. **Risk approval** (`POST /api/risk-check`, internal, no x402):
   - Check daily loss limit (default 5%)
   - Check max single trade size (default 20% of portfolio)
   - Check circuit breaker status
   - Return `RiskApproval`
3. **Profit distribution** (called by orchestrator after successful trade):
   - Calculate total profit from `TradeResult`
   - Distribute via x402:
     - 10% to Executor wallet
     - 5% retained as management fee
     - 85% returned to capital pool
   - Record `ProfitDistribution`
4. **Portfolio monitoring** (every 30s):
   - Call Wallet API for balances
   - Calculate total USD value
   - Calculate daily P&L
   - If daily loss > 5%: activate circuit breaker, emit alert
   - Emit `PortfolioSnapshot` to dashboard
5. **Endpoint `GET /api/portfolio`** (no x402, internal):
   - Returns current `PortfolioSnapshot`

### Circuit Breaker
When activated:
- All `POST /api/risk-check` calls return `{ approved: false, reason: 'Circuit breaker active' }`
- Emits `risk_alert` event to dashboard
- Resets at midnight UTC (or manually)

### Configuration
```
TREASURY_PORT=3004
DAILY_LOSS_LIMIT_PCT=0.05
MAX_SINGLE_TRADE_PCT=0.20
PORTFOLIO_POLL_INTERVAL=30000
```
