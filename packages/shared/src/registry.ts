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
  'function attestCycle(uint256 _cycleId, uint256 _bestBidPrice, uint256 _bestAskPrice, uint16 _spreadBps, uint8 _venueCount, bytes32 _buyVenueHash, bytes32 _sellVenueHash, uint8 _decision, int256 _estimatedProfitUsd) external',
  'function getAttestation(uint256 index) external view returns (tuple(uint256 cycleId, uint256 timestamp, uint256 bestBidPrice, uint256 bestAskPrice, uint16 spreadBps, uint8 venueCount, bytes32 buyVenueHash, bytes32 sellVenueHash, uint8 decision, int256 estimatedProfitUsd, address attestedBy))',
  'function getLatestAttestations(uint256 count) external view returns (tuple(uint256 cycleId, uint256 timestamp, uint256 bestBidPrice, uint256 bestAskPrice, uint16 spreadBps, uint8 venueCount, bytes32 buyVenueHash, bytes32 sellVenueHash, uint8 decision, int256 estimatedProfitUsd, address attestedBy)[])',
  'function attestationCount() external view returns (uint256)',
  'event AgentRegistered(string indexed agentId, address wallet, string role)',
  'event AgentUpdated(string indexed agentId)',
  'event SuccessRecorded(string indexed agentId, uint256 total)',
  'event FailureRecorded(string indexed agentId, uint256 total)',
  'event AgentDeactivated(string indexed agentId)',
  'event CycleAttested(uint256 indexed cycleId, uint16 spreadBps, uint8 decision, int256 estimatedProfitUsd, uint256 timestamp)',
];

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

export interface AttestCycleParams {
  cycleId: number;
  bestBidPrice: number;
  bestAskPrice: number;
  spreadBps: number;
  venueCount: number;
  buyVenue: string;
  sellVenue: string;
  decision: 'MONITOR' | 'EXECUTE' | 'SKIP';
  estimatedProfitCents: number;
}

export async function attestCycleOnChain(
  wallet: ethers.Wallet,
  params: AttestCycleParams
): Promise<{ txHash: string } | null> {
  try {
    const provider = new ethers.JsonRpcProvider(config.XLAYER_RPC);
    const signer = wallet.connect(provider);

    // Build contract directly with fresh ABI to avoid any caching issues
    const attestABI = [
      'function attestCycle(uint256 _cycleId, uint256 _bestBidPrice, uint256 _bestAskPrice, uint16 _spreadBps, uint8 _venueCount, bytes32 _buyVenueHash, bytes32 _sellVenueHash, uint8 _decision, int256 _estimatedProfitUsd) external',
    ];
    const registry = new ethers.Contract(config.REGISTRY_ADDRESS, attestABI, signer);

    const bestBidPrice = ethers.parseUnits(params.bestBidPrice.toFixed(6), 18);
    const bestAskPrice = ethers.parseUnits(params.bestAskPrice.toFixed(6), 18);
    const buyVenueHash = ethers.keccak256(ethers.toUtf8Bytes(params.buyVenue));
    const sellVenueHash = ethers.keccak256(ethers.toUtf8Bytes(params.sellVenue));
    const decision = params.decision === 'EXECUTE' ? 1 : params.decision === 'MONITOR' ? 0 : 2;

    const tx = await registry.attestCycle(
      params.cycleId,
      bestBidPrice,
      bestAskPrice,
      params.spreadBps,
      params.venueCount,
      buyVenueHash,
      sellVenueHash,
      decision,
      params.estimatedProfitCents,
      { gasLimit: 300000 }
    );

    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  } catch (err: any) {
    const { logError } = await import('./logger.js');
    logError('attestation', `attestCycleOnChain failed: ${err.message?.slice(0, 200)}`);
    return null;
  }
}
