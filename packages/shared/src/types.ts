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
  decimals: number;
  quoteAmount: string;
}

// ── Multi-Venue Price Discovery ──
export interface VenuePrice {
  venue: string;           // "okx" | "binance" | "gateio" | "bybit" | "kucoin" | "mexc" | "htx" | "xlayer-dex"
  venueType: 'cex' | 'dex';
  price: number;
  symbol: string;
  timestamp: string;
  latency: number;
  available: boolean;
}

export interface MultiVenueScan {
  token: string;
  venues: VenuePrice[];
  cheapest: VenuePrice;
  mostExpensive: VenuePrice;
  spreadPercent: number;
  spreadAbsolute: number;
  scanDuration: number;
  timestamp: string;
}

// ── Scout Output: Multi-Venue Arbitrage ──
export interface ArbitrageOpportunity {
  id: string;
  token: string;
  tokenAddress: string;
  buyVenue: VenuePrice;
  sellVenue: VenuePrice;
  allVenues: VenuePrice[];
  spreadPercent: number;
  spreadAbsolute: number;
  venuesScanned: number;
  venuesResponded: number;
  scanDuration: number;
  confidence: number;
  timestamp: string;
  expiresAt: string;
}

// Backward compat alias
export type OpportunitySignal = ArbitrageOpportunity;

// Legacy compat
export interface PricePoint {
  source: string;
  price: number;
  timestamp: string;
}

// ── Analyst Output ──
export interface ExecutionRecommendation {
  id: string;
  signalId: string;
  action: 'EXECUTE' | 'MONITOR' | 'SKIP';
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
