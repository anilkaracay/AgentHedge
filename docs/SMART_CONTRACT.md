# Smart Contract: AgentRegistry

## Purpose

Lightweight on-chain registry on X Layer where agents register metadata (role, endpoint, pricing) and track performance. This is NOT a payment contract — all payments go through x402. The registry is purely for discovery and reputation.

## Contract: AgentRegistry.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract AgentRegistry is Ownable {
    struct Agent {
        address wallet;
        string agentId;
        string role;          // "scout" | "analyst" | "executor" | "treasury"
        string endpoint;      // "http://host:port"
        uint256 pricePerReq;  // in stablecoin base units (6 decimals for USDC)
        address payToken;     // USDC or USDT address on X Layer
        uint256 successCount;
        uint256 failCount;
        uint256 registeredAt;
        bool active;
    }

    mapping(string => Agent) public agents;
    string[] public agentIds;

    event AgentRegistered(string indexed agentId, address wallet, string role);
    event AgentUpdated(string indexed agentId);
    event SuccessRecorded(string indexed agentId, uint256 total);
    event FailureRecorded(string indexed agentId, uint256 total);
    event AgentDeactivated(string indexed agentId);

    constructor() Ownable(msg.sender) {}

    function register(
        string calldata _agentId,
        string calldata _role,
        string calldata _endpoint,
        uint256 _pricePerReq,
        address _payToken
    ) external {
        require(agents[_agentId].wallet == address(0), "Agent ID already taken");
        require(bytes(_agentId).length > 0, "Agent ID cannot be empty");
        require(bytes(_role).length > 0, "Role cannot be empty");

        agents[_agentId] = Agent({
            wallet: msg.sender,
            agentId: _agentId,
            role: _role,
            endpoint: _endpoint,
            pricePerReq: _pricePerReq,
            payToken: _payToken,
            successCount: 0,
            failCount: 0,
            registeredAt: block.timestamp,
            active: true
        });

        agentIds.push(_agentId);
        emit AgentRegistered(_agentId, msg.sender, _role);
    }

    function getAgent(string calldata _agentId) external view returns (Agent memory) {
        require(agents[_agentId].wallet != address(0), "Agent not found");
        return agents[_agentId];
    }

    function getAgentCount() external view returns (uint256) {
        return agentIds.length;
    }

    function getAllAgents() external view returns (Agent[] memory) {
        Agent[] memory result = new Agent[](agentIds.length);
        for (uint256 i = 0; i < agentIds.length; i++) {
            result[i] = agents[agentIds[i]];
        }
        return result;
    }

    function updateEndpoint(string calldata _agentId, string calldata _newEndpoint) external {
        require(agents[_agentId].wallet == msg.sender, "Not agent owner");
        agents[_agentId].endpoint = _newEndpoint;
        emit AgentUpdated(_agentId);
    }

    function updatePrice(string calldata _agentId, uint256 _newPrice) external {
        require(agents[_agentId].wallet == msg.sender, "Not agent owner");
        agents[_agentId].pricePerReq = _newPrice;
        emit AgentUpdated(_agentId);
    }

    function recordSuccess(string calldata _agentId) external {
        require(agents[_agentId].wallet == msg.sender, "Not agent owner");
        agents[_agentId].successCount++;
        emit SuccessRecorded(_agentId, agents[_agentId].successCount);
    }

    function recordFailure(string calldata _agentId) external {
        require(agents[_agentId].wallet == msg.sender, "Not agent owner");
        agents[_agentId].failCount++;
        emit FailureRecorded(_agentId, agents[_agentId].failCount);
    }

    function deactivate(string calldata _agentId) external {
        require(agents[_agentId].wallet == msg.sender, "Not agent owner");
        agents[_agentId].active = false;
        emit AgentDeactivated(_agentId);
    }
}
```

## Deployment Script

```typescript
// scripts/deploy.ts
import { ethers } from 'hardhat';

async function main() {
  const AgentRegistry = await ethers.getContractFactory('AgentRegistry');
  const registry = await AgentRegistry.deploy();
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  console.log(`AgentRegistry deployed to: ${address}`);
  // Save address to .env or config file
}

main().catch(console.error);
```

## Hardhat Config

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    xlayer: {
      url: 'https://rpc.xlayer.tech',
      chainId: 196,
      accounts: process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [],
    },
    xlayer_testnet: {
      url: 'https://testrpc.xlayer.tech',
      chainId: 195,
      accounts: process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [],
    },
  },
};
export default config;
```

## Dependencies

```bash
cd packages/contracts
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox @openzeppelin/contracts dotenv
```

## Client Usage (from shared/registry.ts)

```typescript
import { ethers } from 'ethers';
import AgentRegistryABI from '@agenthedge/contracts/artifacts/contracts/AgentRegistry.sol/AgentRegistry.json';
import { config } from './config';

const provider = new ethers.JsonRpcProvider(config.XLAYER_RPC);

export function getRegistryContract(wallet: ethers.Wallet) {
  return new ethers.Contract(
    config.REGISTRY_ADDRESS,
    AgentRegistryABI.abi,
    wallet
  );
}
```

## Testing

Write Hardhat tests that:
1. Register 4 agents (scout, analyst, executor, treasury)
2. Verify getAgent returns correct data
3. Verify getAllAgents returns all 4
4. Test updateEndpoint and updatePrice (only owner)
5. Test recordSuccess/recordFailure
6. Test that non-owner cannot modify another agent
7. Test duplicate agentId rejection
