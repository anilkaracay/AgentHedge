/**
 * Live testnet integration test — registers agents on deployed
 * AgentRegistry contract on X Layer testnet and verifies on-chain.
 *
 * Usage: npx tsx scripts/testnetLive.ts
 */
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

const REGISTRY_ABI = [
  'function register(string _agentId, string _role, string _endpoint, uint256 _pricePerReq, address _payToken) external',
  'function getAgent(string _agentId) external view returns (tuple(address wallet, string agentId, string role, string endpoint, uint256 pricePerReq, address payToken, uint256 successCount, uint256 failCount, uint256 registeredAt, bool active))',
  'function getAgentCount() external view returns (uint256)',
  'function getAllAgents() external view returns (tuple(address wallet, string agentId, string role, string endpoint, uint256 pricePerReq, address payToken, uint256 successCount, uint256 failCount, uint256 registeredAt, bool active)[])',
  'function recordSuccess(string _agentId) external',
  'function recordFailure(string _agentId) external',
  'event AgentRegistered(string indexed agentId, address wallet, string role)',
  'event SuccessRecorded(string indexed agentId, uint256 total)',
];

const RPC = process.env.XLAYER_RPC!;
const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS!;
const USDC_MOCK = '0x0000000000000000000000000000000000000001';

const agentConfigs = [
  { pkEnv: 'SCOUT_PK', id: 'scout', role: 'scout', port: 3001, price: 20000n },
  { pkEnv: 'ANALYST_PK', id: 'analyst', role: 'analyst', port: 3002, price: 30000n },
  { pkEnv: 'EXECUTOR_PK', id: 'executor', role: 'executor', port: 3003, price: 0n },
  { pkEnv: 'TREASURY_PK', id: 'treasury', role: 'treasury', port: 3004, price: 0n },
];

const txHashes: { description: string; hash: string }[] = [];

async function main() {
  console.log(`\n${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  AgentHedge — Live Testnet Integration Test${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`\n  RPC:      ${RPC}`);
  console.log(`  Registry: ${REGISTRY_ADDRESS}\n`);

  const provider = new ethers.JsonRpcProvider(RPC);
  const network = await provider.getNetwork();
  console.log(`  Chain ID: ${network.chainId}\n`);

  // ── Step 1: Check deployer balance ──
  const deployerWallet = new ethers.Wallet(process.env.DEPLOYER_PK!, provider);
  const balance = await provider.getBalance(deployerWallet.address);
  console.log(`  Deployer: ${deployerWallet.address}`);
  console.log(`  Balance:  ${ethers.formatEther(balance)} OKB\n`);

  // ── Step 2: Register all 4 agents ──
  console.log(`${YELLOW}━━━ Registering Agents ━━━${RESET}\n`);

  for (const cfg of agentConfigs) {
    const pk = process.env[cfg.pkEnv];
    if (!pk) {
      console.log(`${RED}❌ Missing ${cfg.pkEnv}${RESET}`);
      continue;
    }

    const wallet = new ethers.Wallet(pk, provider);
    const walletBalance = await provider.getBalance(wallet.address);
    console.log(`  ${cfg.role} wallet: ${wallet.address} (${ethers.formatEther(walletBalance)} OKB)`);

    // Check if wallet has gas — if not, fund from deployer
    if (walletBalance === 0n) {
      console.log(`  ${YELLOW}Funding ${cfg.role} from deployer...${RESET}`);
      try {
        const fundTx = await deployerWallet.sendTransaction({
          to: wallet.address,
          value: ethers.parseEther('0.001'),
        });
        await fundTx.wait();
        txHashes.push({ description: `Fund ${cfg.role}`, hash: fundTx.hash });
        console.log(`  ${GREEN}✅ Funded${RESET} tx: ${fundTx.hash}`);
      } catch (err) {
        console.log(`  ${RED}❌ Funding failed: ${(err as Error).message}${RESET}`);
        continue;
      }
    }

    // Register agent
    const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, wallet);

    try {
      // Check if already registered
      try {
        await registry.getAgent(cfg.id);
        console.log(`  ${GREEN}✅ ${cfg.role} already registered${RESET}\n`);
        continue;
      } catch {
        // Not registered yet — proceed
      }

      const tx = await registry.register(
        cfg.id,
        cfg.role,
        `http://localhost:${cfg.port}`,
        cfg.price,
        USDC_MOCK
      );
      const receipt = await tx.wait();
      txHashes.push({ description: `Register ${cfg.role}`, hash: receipt.hash });
      console.log(`  ${GREEN}✅ ${cfg.role} registered${RESET} tx: ${receipt.hash}`);
      console.log(`     Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed.toString()}\n`);
    } catch (err) {
      console.log(`  ${RED}❌ Register ${cfg.role} failed: ${(err as Error).message}${RESET}\n`);
    }
  }

  // ── Step 3: Verify all agents ──
  console.log(`${YELLOW}━━━ Verifying Registration ━━━${RESET}\n`);

  const readRegistry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);

  const count = await readRegistry.getAgentCount();
  console.log(`  Agent count: ${count}`);

  const allAgents = await readRegistry.getAllAgents();
  console.log(`  getAllAgents() returned ${allAgents.length} agents:\n`);

  for (const agent of allAgents) {
    console.log(`    ${CYAN}${agent.agentId}${RESET}`);
    console.log(`      Role:     ${agent.role}`);
    console.log(`      Wallet:   ${agent.wallet}`);
    console.log(`      Endpoint: ${agent.endpoint}`);
    console.log(`      Price:    ${agent.pricePerReq.toString()} base units`);
    console.log(`      Active:   ${agent.active}`);
    console.log(`      Success:  ${agent.successCount.toString()}`);
    console.log('');
  }

  if (allAgents.length === 4) {
    console.log(`  ${GREEN}✅ All 4 agents registered on-chain${RESET}\n`);
  } else {
    console.log(`  ${RED}❌ Expected 4 agents, got ${allAgents.length}${RESET}\n`);
  }

  // ── Step 4: Record a success for scout ──
  console.log(`${YELLOW}━━━ Recording Success ━━━${RESET}\n`);

  const scoutWallet = new ethers.Wallet(process.env.SCOUT_PK!, provider);
  const scoutRegistry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, scoutWallet);

  try {
    const tx = await scoutRegistry.recordSuccess('scout');
    const receipt = await tx.wait();
    txHashes.push({ description: 'Scout recordSuccess', hash: receipt.hash });
    console.log(`  ${GREEN}✅ recordSuccess() tx: ${receipt.hash}${RESET}`);

    const scoutData = await readRegistry.getAgent('scout');
    console.log(`  Scout successCount: ${scoutData.successCount.toString()}\n`);
  } catch (err) {
    console.log(`  ${RED}❌ recordSuccess failed: ${(err as Error).message}${RESET}\n`);
  }

  // ── Summary ──
  console.log(`${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  Transaction Hashes${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════${RESET}\n`);

  for (const tx of txHashes) {
    console.log(`  ${tx.description}:`);
    console.log(`    ${tx.hash}`);
    console.log(`    https://www.okx.com/web3/explorer/xlayer-test/tx/${tx.hash}\n`);
  }

  console.log(`  Total transactions: ${txHashes.length}`);
  console.log(`  Registry: ${REGISTRY_ADDRESS}`);
  console.log(`  Explorer: https://www.okx.com/web3/explorer/xlayer-test/address/${REGISTRY_ADDRESS}\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
