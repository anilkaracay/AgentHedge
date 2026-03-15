// ── Agent Config ──
export interface AgentConfig {
  agentId: string;
  role: 'scout' | 'analyst' | 'executor' | 'treasury';
  privateKey: string;
  port: number;
  endpoint: string;
  pricePerRequest: number;
}

// ── Token Registry ──
export interface TokenConfig {
  symbol: string;
  xlayerAddress: string;
  cexSymbol: string;           // "ETHUSDC" for Binance, mapped to "ETH-USDC" for OKX
  decimals: number;
  quoteAmount: string;         // base units for 1 token
}

export interface PricePoint {
  source: string;              // "xlayer-dex" | "okx-cex" | "binance-cex" | "ethereum-dex"
  price: number;
  timestamp: string;
}

// ── Scout Output: CeDeFi Arbitrage ──
export interface ArbitrageOpportunity {
  id: string;
  token: string;               // symbol, e.g., "ETH"
  tokenAddress: string;        // X Layer contract address
  dexPrice: PricePoint;
  cexPrice: PricePoint;
  spreadPercent: number;       // |cex - dex| / cex * 100
  spreadAbsolute: number;      // absolute USDC difference
  direction: 'BUY_DEX_SELL_CEX' | 'BUY_CEX_SELL_DEX';
  confidence: number;
  timestamp: string;
  expiresAt: string;
}

// Keep OpportunitySignal as alias for backward compat in x402 endpoints
export type OpportunitySignal = ArbitrageOpportunity;

// ── Analyst Output ──
export interface ExecutionRecommendation {
  id: string;
  signalId: string;
  action: 'EXECUTE' | 'SKIP';
  confidence: number;
  estimatedProfit: number;
  estimatedSlippage: number;
  estimatedPriceImpact: number;
  suggestedAmount: string;
  suggestedMinOutput: string;
  reason: string;
  timestamp: string;
}

// ── Executor Output ──
export interface TradeResult {
  id: string;
  recommendationId: string;
  status: 'EXECUTED' | 'FAILED' | 'SKIPPED';
  txHash?: string;
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut?: string;
  realizedProfit?: number;
  gasUsed?: string;
  blockNumber?: number;
  error?: string;
  timestamp: string;
}

// ── Treasury Types ──
export interface RiskApproval {
  approved: boolean;
  maxTradeSize: string;
  reason?: string;
}

export interface ProfitDistribution {
  tradeId: string;
  totalProfit: number;
  executorFee: number;
  treasuryFee: number;
  poolReturn: number;
  txHashes: string[];
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
  from: string;
  to: string;
  amount: number;
  txHash?: string;
  purpose: string;
}
