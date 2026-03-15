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
  data: unknown;
  timestamp: string;
}

export interface X402PaymentEvent {
  from: string;     // agent ID
  to: string;       // agent ID
  amount: number;   // USDC human units
  txHash?: string;
  purpose: string;  // "signal_purchase" | "analysis_purchase" | "executor_fee" | "treasury_fee"
}
