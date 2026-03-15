import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import {
  getSwapQuote,
  getSwapApproval,
  getSwapCalldata,
  logInfo,
  logError,
} from '@agenthedge/shared';
import type { ExecutionRecommendation, TradeResult } from '@agenthedge/shared';

const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const XLAYER_CHAIN = '196';
const DEFAULT_SLIPPAGE = '0.5';

export async function executeTrade(
  rec: ExecutionRecommendation,
  wallet: ethers.Wallet,
  fromToken: string,
  toToken: string
): Promise<TradeResult> {
  const tradeId = uuidv4();
  const timestamp = new Date().toISOString();

  try {
    // Step 1: Get swap quote
    logInfo('executor', `Getting quote for ${rec.suggestedAmount} of ${fromToken}`);
    const quote = await getSwapQuote({
      chainIndex: XLAYER_CHAIN,
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      amount: rec.suggestedAmount,
      slippagePercent: DEFAULT_SLIPPAGE,
    });

    // Step 2: Validate output meets minimum
    const quotedOutput = BigInt(quote.toTokenAmount);
    const minOutput = BigInt(rec.suggestedMinOutput);
    if (quotedOutput < minOutput) {
      logInfo('executor', `Quote output ${quote.toTokenAmount} < min ${rec.suggestedMinOutput}, skipping`);
      return {
        id: tradeId,
        recommendationId: rec.id,
        status: 'SKIPPED',
        fromToken,
        toToken,
        amountIn: rec.suggestedAmount,
        error: `Quoted output ${quote.toTokenAmount} below minimum ${rec.suggestedMinOutput}`,
        timestamp,
      };
    }

    // Step 3: Approve token spending if not native token
    if (fromToken !== NATIVE_TOKEN) {
      logInfo('executor', 'Requesting token approval');
      const approval = await getSwapApproval({
        chainIndex: XLAYER_CHAIN,
        tokenContractAddress: fromToken,
        approveAmount: rec.suggestedAmount,
      });

      const approveTx = await wallet.sendTransaction({
        to: approval.to,
        data: approval.data,
        gasLimit: BigInt(approval.gasLimit),
      });
      const approveReceipt = await approveTx.wait();
      logInfo('executor', `Approval tx confirmed: ${approveReceipt?.hash}`);
    }

    // Step 4: Get swap calldata
    logInfo('executor', 'Getting swap calldata');
    const swapData = await getSwapCalldata({
      chainIndex: XLAYER_CHAIN,
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      amount: rec.suggestedAmount,
      slippagePercent: DEFAULT_SLIPPAGE,
      userWalletAddress: wallet.address,
    });

    // Step 5: Send swap transaction
    logInfo('executor', 'Sending swap transaction');
    const tx = await wallet.sendTransaction({
      to: swapData.tx.to,
      data: swapData.tx.data,
      value: swapData.tx.value || '0',
      gasLimit: BigInt(swapData.tx.gas),
    });

    // Step 6: Wait for confirmation
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error('Transaction receipt is null');
    }

    logInfo('executor', `Swap confirmed in block ${receipt.blockNumber}, tx ${receipt.hash}`);

    // Step 7: Calculate realized P&L
    const amountInUSDC = fromToken === NATIVE_TOKEN
      ? parseFloat(rec.suggestedAmount) / 1e18 * rec.estimatedProfit / (rec.estimatedProfit || 1)
      : parseFloat(rec.suggestedAmount) / 1e6;
    const amountOutUSDC = parseFloat(quote.toTokenAmount) / 1e6;
    const gasCostETH = parseFloat(ethers.formatEther(receipt.gasUsed * receipt.gasPrice));
    const realizedProfit = amountOutUSDC - amountInUSDC - gasCostETH;

    return {
      id: tradeId,
      recommendationId: rec.id,
      status: 'EXECUTED',
      txHash: receipt.hash,
      fromToken,
      toToken,
      amountIn: rec.suggestedAmount,
      amountOut: quote.toTokenAmount,
      realizedProfit: parseFloat(realizedProfit.toFixed(4)),
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber,
      timestamp,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError('executor', 'Trade execution failed', err);

    return {
      id: tradeId,
      recommendationId: rec.id,
      status: 'FAILED',
      fromToken,
      toToken,
      amountIn: rec.suggestedAmount,
      error: errorMsg,
      timestamp,
    };
  }
}
