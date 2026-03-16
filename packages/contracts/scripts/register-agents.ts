import { ethers } from 'hardhat';

const REGISTRY_ADDRESS = '0xB8406ad5A79721d8D411837b68dfc5E4FF1A41e4';
const USDC = '0x74b7f16337b8972027f6196a17a631ac6de26d22';

const AGENTS = [
  { pk: process.env.SCOUT_PK!, id: 'scout', role: 'scout', port: 4001, price: 20000n },
  { pk: process.env.ANALYST_PK!, id: 'analyst', role: 'analyst', port: 4002, price: 30000n },
  { pk: process.env.EXECUTOR_PK!, id: 'executor', role: 'executor', port: 4003, price: 0n },
  { pk: process.env.TREASURY_PK!, id: 'treasury', role: 'treasury', port: 4004, price: 0n },
];

async function main() {
  const provider = new ethers.JsonRpcProvider('https://rpc.xlayer.tech');
  const abi = [
    'function register(string _agentId, string _role, string _endpoint, uint256 _pricePerReq, address _payToken) external',
    'function getAgentCount() external view returns (uint256)',
  ];

  for (const agent of AGENTS) {
    const wallet = new ethers.Wallet(agent.pk, provider);
    const contract = new ethers.Contract(REGISTRY_ADDRESS, abi, wallet);

    try {
      const tx = await contract.register(
        agent.id, agent.role, `http://localhost:${agent.port}`, agent.price, USDC,
        { gasLimit: 300000 }
      );
      const receipt = await tx.wait();
      console.log(`✓ ${agent.id} registered: tx ${receipt.hash}`);
    } catch (err: any) {
      if (err.message?.includes('already taken')) {
        console.log(`- ${agent.id} already registered`);
      } else {
        console.log(`✗ ${agent.id} failed: ${err.message}`);
      }
    }
  }

  // Verify
  const readContract = new ethers.Contract(REGISTRY_ADDRESS, abi, provider);
  const count = await readContract.getAgentCount();
  console.log(`\nTotal agents registered: ${count}`);
}

main().catch(console.error);
