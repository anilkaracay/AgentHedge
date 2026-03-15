import { v4 as uuidv4 } from 'uuid';
import {
  getPrice,
  config,
  logInfo,
  logError,
} from '@agenthedge/shared';
import type { OpportunitySignal } from '@agenthedge/shared';

const NATIVE_TOKEN = config.NATIVE_TOKEN_ADDRESS;

// USDC addresses per chain
const USDC_XLAYER = config.USDC_ADDRESS;
const USDC_ETHEREUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const XLAYER_CHAIN = config.XLAYER_CHAIN_INDEX;
const ETH_MAINNET_CHAIN = config.ETH_MAINNET_CHAIN_INDEX;

export async function scanForOpportunity(): Promise<OpportunitySignal | null> {
  try {
    // Get price via aggregator/quote on both chains
    // Quote: native token → USDC gives us the token price in USD
    const [xlayerPrice, ethPrice] = await Promise.all([
      getPrice(XLAYER_CHAIN, NATIVE_TOKEN, USDC_XLAYER),
      getPrice(ETH_MAINNET_CHAIN, NATIVE_TOKEN, USDC_ETHEREUM),
    ]);

    const dexPrice = xlayerPrice.price;
    const cexPrice = ethPrice.price;

    if (cexPrice === 0) {
      logError('scout', 'CEX reference price is zero, skipping');
      return null;
    }

    const spreadPercent = Math.abs(dexPrice - cexPrice) / cexPrice;
    const direction: OpportunitySignal['direction'] =
      dexPrice < cexPrice ? 'BUY_DEX' : 'SELL_DEX';

    logInfo('scout', `X Layer: $${dexPrice.toFixed(2)} | Ethereum: $${cexPrice.toFixed(2)} | Spread: ${(spreadPercent * 100).toFixed(4)}%`, {
      dexPrice,
      cexPrice,
      direction,
    });

    if (spreadPercent <= config.SPREAD_THRESHOLD) {
      return null;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30_000);

    const signal: OpportunitySignal = {
      id: uuidv4(),
      tokenPair: 'ETH/USDC',
      fromToken: NATIVE_TOKEN,
      toToken: USDC_XLAYER,
      cexPrice,
      dexPrice,
      spreadPercent: parseFloat((spreadPercent * 100).toFixed(4)),
      direction,
      volume24h: 0, // not available from aggregator API
      confidence: Math.min(1, spreadPercent / 0.01),
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
