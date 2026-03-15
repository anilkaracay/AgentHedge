import { ethers } from 'ethers';
import express, { Express } from 'express';
import { config } from './config.js';
import { logInfo, logError } from './logger.js';
import { eventBus } from './eventBus.js';
import { onchainOSGet } from './onchainOS.js';
import { getRegistryContract, registerAgent as registryRegister, getAllAgents } from './registry.js';
import { callPaidEndpoint } from './x402Client.js';
import type { AgentConfig } from './types.js';
import type { OnChainAgent } from './registry.js';

export abstract class AgentBase {
  readonly agentId: string;
  readonly role: AgentConfig['role'];
  readonly wallet: ethers.Wallet;
  readonly provider: ethers.JsonRpcProvider;
  readonly app: Express;
  readonly registry: ethers.Contract;
  protected readonly agentConfig: AgentConfig;

  constructor(agentConfig: AgentConfig) {
    this.agentConfig = agentConfig;
    this.agentId = agentConfig.agentId;
    this.role = agentConfig.role;

    this.provider = new ethers.JsonRpcProvider(config.XLAYER_RPC);
    this.wallet = new ethers.Wallet(agentConfig.privateKey, this.provider);

    this.app = express();
    this.app.use(express.json());

    this.registry = getRegistryContract(this.wallet);
  }

  async registerSelf(): Promise<void> {
    try {
      const receipt = await registryRegister(this.wallet, this.agentConfig);
      logInfo(this.agentId, `Registered on-chain in tx ${receipt.hash}`);

      eventBus.emitDashboardEvent({
        type: 'agent_registered',
        data: {
          agentId: this.agentId,
          role: this.role,
          endpoint: this.agentConfig.endpoint,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logError(this.agentId, 'Failed to register on-chain', err);
      throw err;
    }
  }

  async discover(role: string): Promise<OnChainAgent[]> {
    const agents = await getAllAgents(this.provider);
    return agents.filter(
      (a: OnChainAgent) => a.role === role && a.active
    );
  }

  async callAgent<T>(agentId: string, path: string): Promise<T> {
    const agentInfo = await this.registry.getAgent(agentId) as OnChainAgent;
    const url = `${agentInfo.endpoint}${path}`;

    return callPaidEndpoint<T>(
      this.wallet,
      url,
      'GET',
      this.agentId,
      agentId
    );
  }

  async onchainOS<T = unknown>(
    path: string,
    params: Record<string, string>
  ): Promise<{ code: string; data: T }> {
    return onchainOSGet<T>(path, params);
  }

  start(port: number): void {
    this.app.listen(port, () => {
      logInfo(this.agentId, `Agent ${this.agentId} listening on port ${port}`);
    });
  }

  abstract run(): Promise<void>;
}
