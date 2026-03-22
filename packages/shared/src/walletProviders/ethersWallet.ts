/**
 * Standard Ethers.js Wallet Provider
 * Uses raw private keys from .env for signing.
 * This is the default provider for development and testing.
 */
import { ethers } from 'ethers';
import type { WalletProvider } from './index.js';

export class EthersWalletProvider implements WalletProvider {
  private wallet: ethers.Wallet;

  constructor(privateKey: string, rpcUrl: string) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, provider);
  }

  async getAddress(): Promise<string> {
    return this.wallet.address;
  }

  async signTransaction(tx: ethers.TransactionRequest): Promise<string> {
    return this.wallet.signTransaction(tx);
  }

  async sendTransaction(tx: ethers.TransactionRequest): Promise<{ hash: string }> {
    const response = await this.wallet.sendTransaction(tx);
    return { hash: response.hash };
  }

  async getBalance(tokenAddress?: string): Promise<string> {
    if (!tokenAddress) {
      const balance = await this.wallet.provider!.getBalance(this.wallet.address);
      return balance.toString();
    }
    // ERC20 balance
    const erc20 = new ethers.Contract(
      tokenAddress,
      ['function balanceOf(address) view returns (uint256)'],
      this.wallet.provider
    );
    const balance: bigint = await erc20.balanceOf(this.wallet.address);
    return balance.toString();
  }
}
