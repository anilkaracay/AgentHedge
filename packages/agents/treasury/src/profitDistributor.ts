import { v4 as uuidv4 } from 'uuid';
import { logInfo, logPayment, eventBus } from '@agenthedge/shared';
import type { TradeResult, ProfitDistribution } from '@agenthedge/shared';

export async function distributeProfit(
  result: TradeResult,
  executorAddress: string
): Promise<ProfitDistribution | null> {
  if (result.status !== 'EXECUTED' || !result.realizedProfit || result.realizedProfit <= 0) {
    logInfo('treasury', 'No positive profit to distribute');
    return null;
  }

  const totalProfit = result.realizedProfit;
  const executorFee = parseFloat((totalProfit * 0.10).toFixed(6));
  const treasuryFee = parseFloat((totalProfit * 0.05).toFixed(6));
  const poolReturn = parseFloat((totalProfit * 0.85).toFixed(6));

  logInfo('treasury', 'Distributing profit', {
    totalProfit,
    executorFee,
    treasuryFee,
    poolReturn,
    executorAddress,
  });

  // Log payments (in production, these would be actual x402 transfers)
  logPayment('treasury', 'executor', executorFee, 'executor_fee');
  logPayment('treasury', 'treasury', treasuryFee, 'treasury_fee');
  logPayment('treasury', 'pool', poolReturn, 'pool_return');

  const distribution: ProfitDistribution = {
    tradeId: result.id,
    totalProfit,
    executorFee,
    treasuryFee,
    poolReturn,
    txHashes: result.txHash ? [result.txHash] : [],
    timestamp: new Date().toISOString(),
  };

  eventBus.emitDashboardEvent({
    type: 'profit_distributed',
    data: distribution,
    timestamp: distribution.timestamp,
  });

  return distribution;
}
