import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

function optionalNumEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  return value ? Number(value) : defaultValue;
}

export const config = {
  // ── X Layer Network ──
  XLAYER_RPC: optionalEnv('XLAYER_RPC', 'https://rpc.xlayer.tech'),
  XLAYER_TESTNET_RPC: optionalEnv('XLAYER_TESTNET_RPC', 'https://testrpc.xlayer.tech'),
  XLAYER_CHAIN_ID: optionalNumEnv('XLAYER_CHAIN_ID', 196),

  // ── Agent Wallets ──
  SCOUT_PK: requireEnv('SCOUT_PK'),
  ANALYST_PK: requireEnv('ANALYST_PK'),
  EXECUTOR_PK: requireEnv('EXECUTOR_PK'),
  TREASURY_PK: requireEnv('TREASURY_PK'),
  DEPLOYER_PK: requireEnv('DEPLOYER_PK'),

  // ── OnchainOS API ──
  OKX_API_KEY: requireEnv('OKX_API_KEY'),
  OKX_SECRET_KEY: requireEnv('OKX_SECRET_KEY'),
  OKX_PASSPHRASE: requireEnv('OKX_PASSPHRASE'),
  OKX_PROJECT_ID: requireEnv('OKX_PROJECT_ID'),

  // ── Smart Contract ──
  REGISTRY_ADDRESS: requireEnv('REGISTRY_ADDRESS'),

  // ── Tokens on X Layer ──
  USDC_ADDRESS: optionalEnv('USDC_ADDRESS', ''),
  USDT_ADDRESS: optionalEnv('USDT_ADDRESS', ''),

  // ── Agent Ports ──
  SCOUT_PORT: optionalNumEnv('SCOUT_PORT', 3001),
  ANALYST_PORT: optionalNumEnv('ANALYST_PORT', 3002),
  EXECUTOR_PORT: optionalNumEnv('EXECUTOR_PORT', 3003),
  TREASURY_PORT: optionalNumEnv('TREASURY_PORT', 3004),
  ORCHESTRATOR_WS_PORT: optionalNumEnv('ORCHESTRATOR_WS_PORT', 3005),
  DASHBOARD_PORT: optionalNumEnv('DASHBOARD_PORT', 3000),

  // ── Strategy Parameters ──
  SPREAD_THRESHOLD: optionalNumEnv('SPREAD_THRESHOLD', 0.003),
  MAX_TRADE_SIZE_USDC: optionalNumEnv('MAX_TRADE_SIZE_USDC', 500),
  DAILY_LOSS_LIMIT_PCT: optionalNumEnv('DAILY_LOSS_LIMIT_PCT', 0.05),
  SCOUT_POLL_INTERVAL: optionalNumEnv('SCOUT_POLL_INTERVAL', 5000),
  PORTFOLIO_POLL_INTERVAL: optionalNumEnv('PORTFOLIO_POLL_INTERVAL', 30000),
  DEFAULT_SLIPPAGE: optionalEnv('DEFAULT_SLIPPAGE', '0.5'),

  // ── Chain Constants ──
  XLAYER_CHAIN_INDEX: '196' as const,
  ETH_MAINNET_CHAIN_INDEX: '1' as const,
  NATIVE_TOKEN_ADDRESS: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const,
} as const;
