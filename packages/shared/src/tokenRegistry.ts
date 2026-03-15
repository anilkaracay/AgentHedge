import type { TokenConfig } from './types.js';

export const USDC_XLAYER = '0x74b7f16337b8972027f6196a17a631ac6de26d22';

export const TRACKED_TOKENS: TokenConfig[] = [
  {
    symbol: 'OKB',
    xlayerAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native token
    cexSymbol: 'OKBUSDC',
    decimals: 18,
    quoteAmount: '1000000000000000000', // 1 OKB
  },
  {
    symbol: 'USDT',
    xlayerAddress: '0x1e4a5963abfd975d8c9021ce480b42188849d41d',
    cexSymbol: 'USDTUSDC',
    decimals: 6,
    quoteAmount: '1000000', // 1 USDT
  },
];
