import { AgenticWalletProvider } from './agenticWallet.js';
import type { AgenticWalletConfig } from './agenticWallet.js';
import { EthersWalletProvider } from './ethersWallet.js';

export type WalletProviderType = 'ethers' | 'agentic';

export interface WalletProvider {
  getAddress(): Promise<string>;
  signTransaction(tx: unknown): Promise<string>;
  sendTransaction(tx: unknown): Promise<{ hash: string }>;
  getBalance(tokenAddress?: string): Promise<string>;
}

export function createWalletProvider(
  type: WalletProviderType,
  config: {
    privateKey?: string;
    rpcUrl?: string;
    agenticToken?: string;
    agentId?: string;
    chainIndex?: string;
  }
): WalletProvider {
  switch (type) {
    case 'agentic':
      if (!config.agenticToken) {
        throw new Error('AGENTIC_WALLET_TOKEN required for agentic wallet provider');
      }
      return new AgenticWalletProvider({
        apiToken: config.agenticToken,
        agentId: config.agentId || 'default',
        chainIndex: config.chainIndex || '196',
      });

    case 'ethers':
    default:
      if (!config.privateKey || !config.rpcUrl) {
        throw new Error('Private key and RPC URL required for ethers wallet provider');
      }
      return new EthersWalletProvider(config.privateKey, config.rpcUrl);
  }
}

export { AgenticWalletProvider, EthersWalletProvider };
export type { AgenticWalletConfig };
