/**
 * OKX Agentic Wallet Provider
 *
 * Agentic Wallet provides TEE-secured key management for AI agents.
 * Private keys are generated and stored in a Trusted Execution Environment —
 * no one can access them, not even OKX.
 *
 * This provider wraps the Agentic Wallet API for use in AgentHedge's
 * programmatic pipeline. When WALLET_PROVIDER=agentic, agents use
 * TEE-secured signing instead of raw private keys in .env.
 *
 * Features:
 * - Zero gas on X Layer (sponsored by OKX)
 * - TEE-secured private key storage
 * - Up to 50 sub-wallets per agent
 * - Built-in risk detection and anomaly monitoring
 *
 * Prerequisites:
 * - OKX Agentic Wallet account (email login)
 * - API token from Agentic Wallet session
 *
 * @see https://web3.okx.com/onchainos/dev-docs/wallet/agentic-wallet
 */

import type { WalletProvider } from './index.js';

export interface AgenticWalletConfig {
  apiToken: string;        // Session token from Agentic Wallet login
  agentId: string;         // Agent identifier
  chainIndex: string;      // Default: '196' for X Layer
}

/**
 * Agentic Wallet implementation.
 * Uses OKX TEE-secured infrastructure for key management.
 *
 * NOTE: The API endpoints below are estimated based on documentation patterns.
 * The actual integration will be finalized when the full Agentic Wallet
 * programmatic SDK is released. For now, the onchainos CLI (`onchainos wallet`)
 * is the primary interface — this class provides the architectural bridge
 * for future programmatic access.
 */
export class AgenticWalletProvider implements WalletProvider {
  private config: AgenticWalletConfig;
  private address: string | null = null;

  constructor(config: AgenticWalletConfig) {
    this.config = config;
  }

  async getAddress(): Promise<string> {
    if (this.address) return this.address;

    // Use Agentic Wallet API to get the wallet address
    // The actual signing happens inside TEE — private key never leaves
    const response = await fetch('https://www.okx.com/api/v5/wallet/agentic/address', {
      headers: {
        'Authorization': `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Agentic Wallet address fetch failed: ${response.status}`);
    }

    const data = await response.json() as { data?: { address?: string } };
    this.address = data.data?.address || '';
    return this.address;
  }

  async signTransaction(tx: unknown): Promise<string> {
    // TEE-secured signing — private key never exposed
    const response = await fetch('https://www.okx.com/api/v5/wallet/agentic/sign', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chainIndex: this.config.chainIndex,
        transaction: tx,
      }),
    });

    const data = await response.json() as { data?: { signedTx?: string } };
    return data.data?.signedTx || '';
  }

  async sendTransaction(tx: unknown): Promise<{ hash: string }> {
    const response = await fetch('https://www.okx.com/api/v5/wallet/agentic/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chainIndex: this.config.chainIndex,
        transaction: tx,
      }),
    });

    const data = await response.json() as { data?: { txHash?: string } };
    return { hash: data.data?.txHash || '' };
  }

  async getBalance(tokenAddress?: string): Promise<string> {
    // Uses OnchainOS Balance API under the hood
    const params = new URLSearchParams({
      chainIndex: this.config.chainIndex,
      address: await this.getAddress(),
    });

    if (tokenAddress) {
      params.append('tokenContractAddress', tokenAddress);
    }

    const response = await fetch(
      `https://www.okx.com/api/v6/dex/balance/all-token-balances-by-address?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
        },
      }
    );

    const data = await response.json() as { data?: Array<{ balance?: string }> };
    return data.data?.[0]?.balance || '0';
  }
}
