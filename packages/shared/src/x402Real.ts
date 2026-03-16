import { ethers } from 'ethers';
import { config } from './config.js';
import { logInfo, logError } from './logger.js';

const USDC_ADDRESS = '0x74b7f16337b8972027f6196a17a631ac6de26d22';
const USDC_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const EXPLORER_BASE = 'https://www.okx.com/explorer/xlayer/tx/';

export interface X402PaymentResult {
  success: boolean;
  txHash: string | null;
  from: string;
  to: string;
  amount: number;
  gasUsed: string;
  explorerUrl: string | null;
  error?: string;
}

// ── Nonce Manager ──
// Prevents nonce conflicts when multiple sequential payments happen in one cycle

class NonceManager {
  private nonces = new Map<string, number>();
  private provider: ethers.JsonRpcProvider;

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
  }

  async getNextNonce(address: string): Promise<number> {
    if (!this.nonces.has(address)) {
      const nonce = await this.provider.getTransactionCount(address, 'pending');
      this.nonces.set(address, nonce);
    }
    const nonce = this.nonces.get(address)!;
    this.nonces.set(address, nonce + 1);
    return nonce;
  }

  resetAll() {
    this.nonces.clear();
  }
}

const provider = new ethers.JsonRpcProvider(config.XLAYER_RPC);
const nonceManager = new NonceManager(provider);

export async function executeX402Payment(
  fromPrivateKey: string,
  toAddress: string,
  amountUSDC: number,
  memo: string,
): Promise<X402PaymentResult> {
  const wallet = new ethers.Wallet(fromPrivateKey, provider);

  try {
    const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, wallet);
    const decimals = await usdc.decimals();
    const amountRaw = ethers.parseUnits(amountUSDC.toFixed(6), decimals);

    // Balance check
    const balance = await usdc.balanceOf(wallet.address);
    if (balance < amountRaw) {
      const have = ethers.formatUnits(balance, decimals);
      return {
        success: false, txHash: null, from: wallet.address, to: toAddress,
        amount: amountUSDC, gasUsed: '0', explorerUrl: null,
        error: `Insufficient USDC: have ${have}, need ${amountUSDC}`,
      };
    }

    const nonce = await nonceManager.getNextNonce(wallet.address);

    const tx = await usdc.transfer(toAddress, amountRaw, {
      gasLimit: 100000,
      nonce,
    });

    const receipt = await tx.wait();
    const explorerUrl = `${EXPLORER_BASE}${tx.hash}`;

    logInfo('x402', `✓ ${memo}: ${amountUSDC} USDC  ${wallet.address.slice(0, 8)}→${toAddress.slice(0, 8)}  tx:${tx.hash.slice(0, 10)}`);

    return {
      success: true, txHash: tx.hash, from: wallet.address, to: toAddress,
      amount: amountUSDC, gasUsed: receipt.gasUsed.toString(), explorerUrl,
    };
  } catch (error: any) {
    nonceManager.resetAll();
    logError('x402', `✗ ${memo} failed: ${error.message}`);
    return {
      success: false, txHash: null, from: wallet.address, to: toAddress,
      amount: amountUSDC, gasUsed: '0', explorerUrl: null,
      error: error.message,
    };
  }
}

export function resetNonces() {
  nonceManager.resetAll();
}

// ── Balance Check ──

export async function getAgentUSDCBalance(address: string): Promise<number> {
  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
  const decimals = await usdc.decimals();
  const balance = await usdc.balanceOf(address);
  return parseFloat(ethers.formatUnits(balance, decimals));
}

export async function logAllAgentBalances(addresses: Record<string, string>): Promise<number> {
  let total = 0;
  for (const [name, addr] of Object.entries(addresses)) {
    const bal = await getAgentUSDCBalance(addr);
    total += bal;
    logInfo('x402', `${name.toUpperCase()} balance: ${bal.toFixed(4)} USDC`);
  }
  const estCycles = Math.floor(total / 0.01);
  logInfo('x402', `Total: ${total.toFixed(4)} USDC — ~${estCycles} cycles remaining`);
  return total;
}
