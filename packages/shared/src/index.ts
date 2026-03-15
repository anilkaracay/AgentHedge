export * from './types.js';
export { config } from './config.js';
export { logInfo, logError, logPayment } from './logger.js';
export { eventBus } from './eventBus.js';
export {
  // Module 1: DEX Swap
  getOKXHeaders, onchainOSGet, onchainOSPost,
  getSwapQuote, getSwapApproval, getSwapCalldata,
  // Module 2: Market
  getIndexPrice, getCandles, getRecentTrades,
  // Module 3: Balance
  getTotalValue, getTokenBalances,
  // Module 4: Gateway
  getGasPrice,
  // Module 5: Portfolio
  getPortfolioOverview,
  // Legacy compat
  getPrice, getMultiChainPrices,
} from './onchainOS.js';
export type {
  SwapQuoteParams, SwapQuoteResponse, QuoteTokenInfo,
  ApproveParams, ApproveResponse, SwapParams, SwapResponse,
  IndexPriceResponse, CandleData, TradeData,
  BalanceTokenAsset, GasPriceResponse, PortfolioOverviewResponse,
  PriceResult,
} from './onchainOS.js';
export { scanAllVenues, getCEXPrice } from './cexPriceFeed.js';
export { TRACKED_TOKENS, USDC_XLAYER } from './tokenRegistry.js';
export { createX402Middleware } from './x402Server.js';
export type { X402RouteConfig } from './x402Server.js';
export { callPaidEndpoint } from './x402Client.js';
export {
  getRegistryContract, registerAgent, getAgent, getAllAgents,
} from './registry.js';
export type { OnChainAgent } from './registry.js';
export { AgentBase } from './AgentBase.js';
export { estimateTradeCosts, calculateMinProfitableSize, getCostBreakdown, formatProfitReport, FEE_STRUCTURE } from './profitCalculator.js';
export type { TradeCosts, CostBreakdown, TradeSize } from './profitCalculator.js';
export { placeCEXOrder, getCEXBalance, getCEXOrderStatus } from './cexTrading.js';
export type { CEXOrderParams, CEXOrderResult } from './cexTrading.js';
export { isDemoMode, getDemoPortfolio, updateDemoBalance, maybeInjectVolatilitySpike } from './demoMode.js';
export type { VenueBalance, DemoPortfolio } from './demoMode.js';
