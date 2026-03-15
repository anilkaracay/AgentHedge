import { ethers } from 'ethers';
import { config } from './config.js';
import type { AgentConfig } from './types.js';

const AGENT_REGISTRY_ABI = [
  'function register(string _agentId, string _role, string _endpoint, uint256 _pricePerReq, address _payToken) external',
  'function getAgent(string _agentId) external view returns (tuple(address wallet, string agentId, string role, string endpoint, uint256 pricePerReq, address payToken, uint256 successCount, uint256 failCount, uint256 registeredAt, bool active))',
  'function getAgentCount() external view returns (uint256)',
  'function getAllAgents() external view returns (tuple(address wallet, string agentId, string role, string endpoint, uint256 pricePerReq, address payToken, uint256 successCount, uint256 failCount, uint256 registeredAt, bool active)[])',
  'function updateEndpoint(string _agentId, string _newEndpoint) external',
  'function updatePrice(string _agentId, uint256 _newPrice) external',
  'function recordSuccess(string _agentId) external',
  'function recordFailure(string _agentId) external',
  'function deactivate(string _agentId) external',
  'event AgentRegistered(string indexed agentId, address wallet, string role)',
  'event AgentUpdated(string indexed agentId)',
  'event SuccessRecorded(string indexed agentId, uint256 total)',
  'event FailureRecorded(string indexed agentId, uint256 total)',
  'event AgentDeactivated(string indexed agentId)',
] as const;

export interface OnChainAgent {
  wallet: string;
  agentId: string;
  role: string;
  endpoint: string;
  pricePerReq: bigint;
  payToken: string;
  successCount: bigint;
  failCount: bigint;
  registeredAt: bigint;
  active: boolean;
}

export function getRegistryContract(
  signerOrProvider: ethers.Wallet | ethers.Provider
): ethers.Contract {
  return new ethers.Contract(
    config.REGISTRY_ADDRESS,
    AGENT_REGISTRY_ABI,
    signerOrProvider
  );
}

export async function registerAgent(
  wallet: ethers.Wallet,
  agentConfig: AgentConfig
): Promise<ethers.TransactionReceipt> {
  const registry = getRegistryContract(wallet);
  const priceBaseUnits = Math.round(agentConfig.pricePerRequest * 1_000_000);
  const tx = await registry.register(
    agentConfig.agentId,
    agentConfig.role,
    agentConfig.endpoint,
    priceBaseUnits,
    config.USDC_ADDRESS
  );
  return await tx.wait();
}

export async function getAgent(
  provider: ethers.Provider,
  agentId: string
): Promise<OnChainAgent> {
  const registry = getRegistryContract(provider);
  return await registry.getAgent(agentId);
}

export async function getAllAgents(
  provider: ethers.Provider
): Promise<OnChainAgent[]> {
  const registry = getRegistryContract(provider);
  return await registry.getAllAgents();
}
