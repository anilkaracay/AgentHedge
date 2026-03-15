# Architecture

## System Overview

AgentHedge is a 4-stage sequential pipeline where each stage is an independent Node.js process (agent) communicating via x402-protected HTTP endpoints.

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

## Data Flow Per Cycle

1. **Scout** polls Market Price API every 5s, compares CEX vs DEX prices
2. If spread > threshold → Scout stores `OpportunitySignal` at its x402 endpoint
3. **Analyst** calls Scout's endpoint (pays 0.02 USDC via x402), receives signal
4. Analyst runs profitability analysis → produces `ExecutionRecommendation`
5. If recommendation = EXECUTE → stores at its x402 endpoint
6. **Executor** calls Analyst's endpoint (pays 0.03 USDC via x402), receives recommendation
7. Executor checks with Treasury for risk approval
8. Executor calls Trade API: quote → approve (if needed) → swap → broadcast
9. Executor reports `TradeResult` to Treasury
10. **Treasury** distributes profit via x402: 10% to Executor, 5% to itself, rest to pool
11. All events emitted via WebSocket to Dashboard

## Agent Independence

Each agent:
- Has its own wallet (separate private key)
- Runs its own Express HTTP server on a dedicated port
- Exposes x402-protected endpoints (server) AND makes x402 requests (client)
- Registers itself on the AgentRegistry smart contract at startup
- Can be replaced independently (e.g., swap Scout for a better one)

## Shared Package

All agents import from `@agenthedge/shared`:
- `AgentBase` — abstract class with register/discover/callAgent/onchainOS methods
- `onchainOS.ts` — authenticated API client for all OnchainOS endpoints
- `x402Client.ts` — wrapper around `@x402/fetch` for making paid requests
- `x402Server.ts` — wrapper around `@x402/express` for protecting endpoints
- `registry.ts` — ethers.js contract instance for AgentRegistry
- `config.ts` — loads and validates all environment variables
- `types.ts` — ALL TypeScript interfaces (OpportunitySignal, ExecutionRecommendation, TradeResult, etc.)
- `logger.ts` — structured JSON logging with agent context
- `eventBus.ts` — EventEmitter for dashboard WebSocket integration

## Orchestrator

The orchestrator (`packages/orchestrator`) does NOT contain agent logic. It:
1. Starts all 4 agents (or connects to already-running agents)
2. Runs the main pipeline loop at configurable intervals
3. Manages the WebSocket server for the dashboard
4. Handles graceful shutdown

## Communication Patterns

- **Agent → Agent**: Always via x402 HTTP (never direct function calls)
- **Agent → OnchainOS API**: Via shared `onchainOS.ts` client (HMAC-SHA256 auth)
- **Agent → Smart Contract**: Via shared `registry.ts` (ethers.js v6)
- **Agent → Dashboard**: Via shared `eventBus.ts` → WebSocket (Socket.io)
- **Agent → X Layer**: Via ethers.js provider (`https://rpc.xlayer.tech`)

## Error Handling Strategy

- **Scout fails to get price**: Log warning, skip cycle, retry next interval
- **Analyst gets stale signal (>30s old)**: Reject signal, skip cycle
- **Executor quote doesn't match projection**: Skip trade, log reason
- **Executor swap fails**: Record failure in registry, notify Treasury
- **Treasury daily loss limit hit**: Emit circuit breaker event, halt all trading
- **x402 payment fails**: Retry 2x with exponential backoff, then skip cycle
- **OnchainOS API rate limit**: Respect headers, implement backoff in `onchainOS.ts`
