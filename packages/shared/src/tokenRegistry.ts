import type { TokenConfig } from './types.js';

export const USDC_XLAYER = '0x74b7f16337b8972027f6196a17a631ac6de26d22';

export const TRACKED_TOKENS: TokenConfig[] = [
  {
    symbol: 'OKB',
    xlayerAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native token on X Layer
    decimals: 18,
    quoteAmount: '1000000000000000000', // 1 OKB
  },
  {
    symbol: 'USDT',
    xlayerAddress: '0x1e4a5963abfd975d8c9021ce480b42188849d41d',
    decimals: 6,
    quoteAmount: '1000000', // 1 USDT
  },
];

// Tokens tested but NO liquidity on X Layer DEX (March 2026):
// WETH (0x5A77f1443D16ee5761d310e38b7308eBF9338FeC) — Insufficient liquidity
// WBTC — Insufficient liquidity
// DAI — Insufficient liquidity
// BNB — Insufficient liquidity
// LINK — Insufficient liquidity
