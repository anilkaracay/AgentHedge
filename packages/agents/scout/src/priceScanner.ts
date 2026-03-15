import { v4 as uuidv4 } from 'uuid';
import {
  getTokenPrice,
  getRecentTrades,
  config,
  logInfo,
  logError,
} from '@agenthedge/shared';
import type { OpportunitySignal } from '@agenthedge/shared';

// Native ETH address placeholder used by OnchainOS
const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// X Layer = 196, Ethereum mainnet = 1 (CEX reference)
const XLAYER_CHAIN = '196';
const ETH_MAINNET_CHAIN = '1';

export async function scanForOpportunity(): Promise<OpportunitySignal | null> {
  try {
    // Fetch DEX price on X Layer and CEX reference from Ethereum mainnet
    const [dexData, cexData] = await Promise.all([
      getTokenPrice(XLAYER_CHAIN, NATIVE_TOKEN),
      getTokenPrice(ETH_MAINNET_CHAIN, NATIVE_TOKEN),
    ]);

    const dexPrice = parseFloat(dexData.lastPrice);
    const cexPrice = parseFloat(cexData.lastPrice);

    if (cexPrice === 0) {
      logError('scout', 'CEX reference price is zero, skipping');
      return null;
    }

    const spreadPercent = Math.abs(dexPrice - cexPrice) / cexPrice;
    const direction: OpportunitySignal['direction'] =
      dexPrice < cexPrice ? 'BUY_DEX' : 'SELL_DEX';

    logInfo('scout', `Spread: ${(spreadPercent * 100).toFixed(4)}%`, {
      dexPrice,
      cexPrice,
      direction,
    });

    if (spreadPercent <= config.SPREAD_THRESHOLD) {
      return null;
    }

    // Fetch 24h volume for confidence weighting
    const volume24h = parseFloat(dexData.volume24h || '0');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30_000);

    const signal: OpportunitySignal = {
      id: uuidv4(),
      tokenPair: 'ETH/USDC',
      fromToken: NATIVE_TOKEN,
      toToken: config.USDC_ADDRESS,
      cexPrice,
      dexPrice,
      spreadPercent: parseFloat((spreadPercent * 100).toFixed(4)),
      direction,
      volume24h,
      confidence: Math.min(1, spreadPercent / 0.01), // higher spread → higher confidence
      timestamp: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    logInfo('scout', `Opportunity detected: ${signal.tokenPair} spread ${signal.spreadPercent}%`);
    return signal;
  } catch (err) {
    logError('scout', 'Price scan failed', err);
    return null;
  }
}
