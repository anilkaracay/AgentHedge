import { ethers } from 'hardhat';

async function main() {
  const AgentRegistry = await ethers.getContractFactory('AgentRegistry');
  const registry = await AgentRegistry.deploy();
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  console.log(`AgentRegistry deployed to: ${address}`);
}

main().catch(console.error);
