import { config, logInfo } from '@agenthedge/shared';
import type { RiskApproval, PortfolioSnapshot } from '@agenthedge/shared';

const MAX_SINGLE_TRADE_PCT = 0.20;

export function checkRiskLimits(
  tradeAmount: string,
  portfolio: PortfolioSnapshot
): RiskApproval {
  // Check circuit breaker
  if (portfolio.circuitBreakerActive) {
    logInfo('treasury', 'Risk check denied: circuit breaker active');
    return { approved: false, maxTradeSize: '0', reason: 'Circuit breaker active' };
  }

  // Check daily loss limit
  if (portfolio.dailyPnLPercent < -config.DAILY_LOSS_LIMIT_PCT * 100) {
    logInfo('treasury', `Risk check denied: daily loss ${portfolio.dailyPnLPercent}% exceeds limit`);
    return {
      approved: false,
      maxTradeSize: '0',
      reason: `Daily loss ${portfolio.dailyPnLPercent.toFixed(2)}% exceeds ${config.DAILY_LOSS_LIMIT_PCT * 100}% limit`,
    };
  }

  // Check single trade size
  const maxTradeSizeUSDC = portfolio.totalValueUSD * MAX_SINGLE_TRADE_PCT;
  const maxTradeSizeBaseUnits = BigInt(Math.round(maxTradeSizeUSDC * 1e6)).toString();

  // For native token amounts (wei), convert to rough USD value for comparison
  const tradeAmountNum = parseFloat(tradeAmount);
  if (tradeAmountNum > maxTradeSizeUSDC * 1e12) {
    // Very rough heuristic: if amount in wei is disproportionately large
    logInfo('treasury', 'Risk check denied: trade size exceeds portfolio limit');
    return {
      approved: false,
      maxTradeSize: maxTradeSizeBaseUnits,
      reason: `Trade size exceeds ${(MAX_SINGLE_TRADE_PCT * 100).toFixed(0)}% of portfolio ($${maxTradeSizeUSDC.toFixed(2)})`,
    };
  }

  logInfo('treasury', 'Risk check approved', {
    maxTradeSize: maxTradeSizeBaseUnits,
    portfolioValue: portfolio.totalValueUSD,
  });

  return {
    approved: true,
    maxTradeSize: maxTradeSizeBaseUnits,
  };
}
