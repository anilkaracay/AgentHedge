import { executeX402Payment, resetNonces } from './x402Real.js';
import type { X402PaymentResult } from './x402Real.js';
import { logInfo, logError } from './logger.js';
import { eventBus } from './eventBus.js';

export interface AgentKeys {
  scout: string;
  analyst: string;
  executor: string;
  treasury: string;
}

export interface AgentAddresses {
  scout: string;
  analyst: string;
  executor: string;
  treasury: string;
}

export interface PaymentFlowResult {
  phase1: X402PaymentResult[];
  phase2: X402PaymentResult[];
  totalTxCount: number;
  totalUSDCMoved: number;
  allTxHashes: string[];
}

function emitPayment(
  fromAgent: string,
  toAgent: string,
  amount: number,
  purpose: string,
  result: X402PaymentResult,
) {
  eventBus.emitDashboardEvent({
    type: 'x402_payment',
    data: {
      from: fromAgent.toLowerCase(),
      to: toAgent.toLowerCase(),
      amount,
      purpose,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      onChain: result.success,
    },
    timestamp: new Date().toISOString(),
  });
}

// ── Full EXECUTE cycle: 5 payments ──

export async function executeFullPaymentCycle(
  keys: AgentKeys,
  addresses: AgentAddresses,
  executorFeeUSD: number,
): Promise<PaymentFlowResult> {
  resetNonces();

  const result: PaymentFlowResult = {
    phase1: [], phase2: [],
    totalTxCount: 0, totalUSDCMoved: 0, allTxHashes: [],
  };

  const cappedFee = Math.min(executorFeeUSD, 0.10);

  logInfo('x402', `── EXECUTE payment cycle (fee: ${cappedFee.toFixed(4)} USDC) ──`);

  // ═══ PHASE 1: Service Payments ═══

  // 1. ANALYST → SCOUT: signal_purchase
  const p1 = await executeX402Payment(keys.analyst, addresses.scout, 0.02, 'signal_purchase');
  result.phase1.push(p1);
  emitPayment('analyst', 'scout', 0.02, 'signal_purchase', p1);

  // 2. EXECUTOR → ANALYST: analysis_purchase
  const p2 = await executeX402Payment(keys.executor, addresses.analyst, 0.03, 'analysis_purchase');
  result.phase1.push(p2);
  emitPayment('executor', 'analyst', 0.03, 'analysis_purchase', p2);

  // 3. TREASURY → EXECUTOR: executor_fee
  const p3 = await executeX402Payment(keys.treasury, addresses.executor, cappedFee, 'executor_fee');
  result.phase1.push(p3);
  emitPayment('treasury', 'executor', cappedFee, 'executor_fee', p3);

  // ═══ PHASE 2: Profit Redistribution ═══

  // 4. SCOUT → TREASURY: profit_return
  const p4 = await executeX402Payment(keys.scout, addresses.treasury, 0.02, 'profit_return');
  result.phase2.push(p4);
  emitPayment('scout', 'treasury', 0.02, 'profit_return', p4);

  // 5. EXECUTOR → TREASURY: profit_return (net earnings)
  const executorReturn = Math.max(0, parseFloat((cappedFee - 0.03).toFixed(6)));
  if (executorReturn > 0.001) {
    const p5 = await executeX402Payment(keys.executor, addresses.treasury, executorReturn, 'profit_return');
    result.phase2.push(p5);
    emitPayment('executor', 'treasury', executorReturn, 'profit_return', p5);
  }

  // Collect
  const all = [...result.phase1, ...result.phase2];
  result.totalTxCount = all.filter(r => r.success).length;
  result.totalUSDCMoved = all.filter(r => r.success).reduce((s, r) => s + r.amount, 0);
  result.allTxHashes = all.filter(r => r.txHash).map(r => r.txHash!);

  logInfo('x402', `── Cycle done: ${result.totalTxCount} txs, ${result.totalUSDCMoved.toFixed(4)} USDC moved ──`);
  return result;
}

// ── Lightweight MONITOR cycle: 2 payments ──

export async function executeMonitorPaymentCycle(
  keys: AgentKeys,
  addresses: AgentAddresses,
): Promise<PaymentFlowResult> {
  resetNonces();

  const result: PaymentFlowResult = {
    phase1: [], phase2: [],
    totalTxCount: 0, totalUSDCMoved: 0, allTxHashes: [],
  };

  logInfo('x402', '── MONITOR payment cycle (signal only) ──');

  // ANALYST → SCOUT: signal_purchase
  const p1 = await executeX402Payment(keys.analyst, addresses.scout, 0.02, 'signal_purchase');
  result.phase1.push(p1);
  emitPayment('analyst', 'scout', 0.02, 'signal_purchase', p1);

  // SCOUT → TREASURY: profit_return
  const p2 = await executeX402Payment(keys.scout, addresses.treasury, 0.02, 'profit_return');
  result.phase2.push(p2);
  emitPayment('scout', 'treasury', 0.02, 'profit_return', p2);

  const all = [...result.phase1, ...result.phase2];
  result.totalTxCount = all.filter(r => r.success).length;
  result.totalUSDCMoved = all.filter(r => r.success).reduce((s, r) => s + r.amount, 0);
  result.allTxHashes = all.filter(r => r.txHash).map(r => r.txHash!);

  logInfo('x402', `── Monitor done: ${result.totalTxCount} txs ──`);
  return result;
}
