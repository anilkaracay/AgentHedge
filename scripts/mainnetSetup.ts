/**
 * Mainnet setup: fund wallets, register agents, run demo cycles.
 * Usage: npx tsx scripts/mainnetSetup.ts
 */
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const RPC = process.env.XLAYER_RPC!;
const REGISTRY = process.env.REGISTRY_ADDRESS!;
const USDC_ADDR = process.env.USDC_ADDRESS!;

const REGISTRY_ABI = [
  'function register(string _agentId, string _role, string _endpoint, uint256 _pricePerReq, address _payToken) external',
  'function getAgent(string _agentId) external view returns (tuple(address wallet, string agentId, string role, string endpoint, uint256 pricePerReq, address payToken, uint256 successCount, uint256 failCount, uint256 registeredAt, bool active))',
  'function getAgentCount() external view returns (uint256)',
  'function getAllAgents() external view returns (tuple(address wallet, string agentId, string role, string endpoint, uint256 pricePerReq, address payToken, uint256 successCount, uint256 failCount, uint256 registeredAt, bool active)[])',
  'function recordSuccess(string _agentId) external',
];

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const allTxHashes: { step: string; description: string; hash: string }[] = [];

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log(`\n${CYAN}═════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  AgentHedge — X Layer Mainnet Setup${RESET}`);
  console.log(`${CYAN}═════════════════════════════════════════════════════${RESET}\n`);

  const provider = new ethers.JsonRpcProvider(RPC);
  const network = await provider.getNetwork();
  console.log(`  Network:  ${RPC}`);
  console.log(`  Chain ID: ${network.chainId}`);
  console.log(`  Registry: ${REGISTRY}\n`);

  // Verify registry is deployed
  const code = await provider.getCode(REGISTRY);
  if (code.length <= 2) {
    console.log(`${RED}  Registry contract not found at ${REGISTRY}!${RESET}`);
    process.exit(1);
  }
  console.log(`  ${GREEN}✅ Registry contract verified on mainnet${RESET}\n`);

  const deployer = new ethers.Wallet(process.env.DEPLOYER_PK!, provider);
  const scout = new ethers.Wallet(process.env.SCOUT_PK!, provider);
  const analyst = new ethers.Wallet(process.env.ANALYST_PK!, provider);
  const executor = new ethers.Wallet(process.env.EXECUTOR_PK!, provider);
  const treasury = new ethers.Wallet(process.env.TREASURY_PK!, provider);

  // ── Step 3: Fund agent wallets ──
  console.log(`${YELLOW}━━━ Step 3: Fund Agent Wallets ━━━${RESET}\n`);

  const deployerBal = await provider.getBalance(deployer.address);
  console.log(`  Deployer balance: ${ethers.formatEther(deployerBal)} OKB\n`);

  // Send OKB for gas
  const gasAmount = ethers.parseEther('0.003');
  const agents = [
    { wallet: scout, name: 'SCOUT' },
    { wallet: analyst, name: 'ANALYST' },
    { wallet: executor, name: 'EXECUTOR' },
    { wallet: treasury, name: 'TREASURY' },
  ];

  for (const agent of agents) {
    const bal = await provider.getBalance(agent.wallet.address);
    if (bal >= gasAmount) {
      console.log(`  ${agent.name}: already has ${ethers.formatEther(bal)} OKB, skipping`);
      continue;
    }
    try {
      const tx = await deployer.sendTransaction({
        to: agent.wallet.address,
        value: gasAmount,
      });
      const receipt = await tx.wait();
      allTxHashes.push({ step: 'fund-okb', description: `Fund ${agent.name} with OKB`, hash: receipt!.hash });
      console.log(`  ${GREEN}✅ ${agent.name} funded${RESET} — ${receipt!.hash}`);
    } catch (err) {
      console.log(`  ${RED}❌ Fund ${agent.name} failed: ${(err as Error).message}${RESET}`);
    }
    await sleep(2000);
  }

  // Send USDC from Treasury
  console.log(`\n  Distributing USDC from Treasury...\n`);

  const usdcContract = new ethers.Contract(USDC_ADDR, ERC20_ABI, treasury);
  const treasuryUSDCBal = await usdcContract.balanceOf(treasury.address);
  console.log(`  Treasury USDC balance: ${ethers.formatUnits(treasuryUSDCBal, 6)} USDC`);

  const usdcDistribution = [
    { wallet: scout, name: 'SCOUT', amount: ethers.parseUnits('0.1', 6) },
    { wallet: analyst, name: 'ANALYST', amount: ethers.parseUnits('0.5', 6) },
    { wallet: executor, name: 'EXECUTOR', amount: ethers.parseUnits('0.5', 6) },
  ];

  for (const dist of usdcDistribution) {
    try {
      const tx = await usdcContract.transfer(dist.wallet.address, dist.amount);
      const receipt = await tx.wait();
      allTxHashes.push({ step: 'fund-usdc', description: `Send ${ethers.formatUnits(dist.amount, 6)} USDC to ${dist.name}`, hash: receipt!.hash });
      console.log(`  ${GREEN}✅ ${dist.name}: ${ethers.formatUnits(dist.amount, 6)} USDC${RESET} — ${receipt!.hash}`);
    } catch (err) {
      console.log(`  ${RED}❌ USDC transfer to ${dist.name} failed: ${(err as Error).message}${RESET}`);
    }
    await sleep(2000);
  }

  // Verify final balances
  console.log(`\n  ${CYAN}Final Balances:${RESET}`);
  for (const agent of agents) {
    const okb = ethers.formatEther(await provider.getBalance(agent.wallet.address));
    let usdc = '0';
    try {
      const usdcBal = await usdcContract.balanceOf(agent.wallet.address);
      usdc = ethers.formatUnits(usdcBal, 6);
    } catch { /* skip */ }
    console.log(`  ${agent.name.padEnd(10)} OKB: ${okb.padStart(12)} | USDC: ${usdc.padStart(10)}`);
  }

  // ── Step 4: Register agents on mainnet ──
  console.log(`\n${YELLOW}━━━ Step 4: Register Agents On-Chain ━━━${RESET}\n`);

  const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);

  const agentConfigs = [
    { wallet: scout, id: 'scout', role: 'scout', port: 3001, price: 20000n },
    { wallet: analyst, id: 'analyst', role: 'analyst', port: 3002, price: 30000n },
    { wallet: executor, id: 'executor', role: 'executor', port: 3003, price: 0n },
    { wallet: treasury, id: 'treasury', role: 'treasury', port: 3004, price: 0n },
  ];

  for (const cfg of agentConfigs) {
    // Check if already registered
    try {
      await registry.getAgent(cfg.id);
      console.log(`  ${cfg.id}: already registered, skipping`);
      continue;
    } catch { /* not registered yet */ }

    try {
      const registryWithSigner = new ethers.Contract(REGISTRY, REGISTRY_ABI, cfg.wallet);
      const tx = await registryWithSigner.register(
        cfg.id, cfg.role, `http://localhost:${cfg.port}`, cfg.price, USDC_ADDR
      );
      const receipt = await tx.wait();
      allTxHashes.push({ step: 'register', description: `Register ${cfg.id}`, hash: receipt!.hash });
      console.log(`  ${GREEN}✅ ${cfg.id} registered${RESET} — ${receipt!.hash}`);
    } catch (err) {
      console.log(`  ${RED}❌ Register ${cfg.id} failed: ${(err as Error).message}${RESET}`);
    }
    await sleep(2000);
  }

  // Verify
  const count = await registry.getAgentCount();
  console.log(`\n  Agents on-chain: ${count}`);
  const allAgents = await registry.getAllAgents();
  for (const a of allAgents) {
    console.log(`    ${CYAN}${a.agentId}${RESET}: ${a.role} | ${a.wallet.slice(0, 10)}... | active: ${a.active}`);
  }

  // ── Step 5: Live demo cycles (quotes only, no real swaps) ──
  console.log(`\n${YELLOW}━━━ Step 5: Live Demo Cycles (Quotes Only) ━━━${RESET}\n`);

  // Import shared after env is loaded
  const { getPrice, getSwapQuote, config: sharedConfig } = await import('@agenthedge/shared');

  for (let cycle = 1; cycle <= 2; cycle++) {
    console.log(`  ${CYAN}── Cycle ${cycle}/2 ──${RESET}\n`);

    // Scout: get prices
    console.log(`  Scout: fetching prices...`);
    try {
      const xlayerPrice = await getPrice('196', sharedConfig.NATIVE_TOKEN_ADDRESS, USDC_ADDR);
      await sleep(2000);
      const ethPrice = await getPrice('1', sharedConfig.NATIVE_TOKEN_ADDRESS, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');

      const spread = Math.abs(xlayerPrice.price - ethPrice.price) / ethPrice.price * 100;
      console.log(`    X Layer OKB: $${xlayerPrice.price.toFixed(2)}`);
      console.log(`    Ethereum ETH: $${ethPrice.price.toFixed(2)}`);
      console.log(`    Cross-chain spread: ${spread.toFixed(4)}%`);
      console.log(`    ${GREEN}✅ Scout price scan complete${RESET}\n`);
    } catch (err) {
      console.log(`    ${RED}❌ Price scan failed: ${(err as Error).message}${RESET}\n`);
    }

    // Analyst: get fresh quote for validation
    console.log(`  Analyst: validating with fresh quote...`);
    await sleep(2000);
    try {
      const quote = await getSwapQuote({
        chainIndex: '196',
        fromTokenAddress: sharedConfig.NATIVE_TOKEN_ADDRESS,
        toTokenAddress: USDC_ADDR,
        amount: '10000000000000000', // 0.01 OKB
        slippagePercent: '0.5',
      });
      console.log(`    Quote: 0.01 OKB → ${ethers.formatUnits(quote.toTokenAmount, 6)} USDC`);
      console.log(`    DEX: ${quote.dexRouterList?.[0]?.dexProtocol.dexName ?? 'unknown'}`);
      console.log(`    Gas: ${quote.estimateGasFee}`);
      console.log(`    ${GREEN}✅ Analyst validation complete${RESET}\n`);
    } catch (err) {
      console.log(`    ${RED}❌ Quote failed: ${(err as Error).message}${RESET}\n`);
    }

    // Executor: record success on-chain (demonstrates contract interaction)
    console.log(`  Executor: recording success on registry...`);
    try {
      const execRegistry = new ethers.Contract(REGISTRY, REGISTRY_ABI, executor);
      const tx = await execRegistry.recordSuccess('executor');
      const receipt = await tx.wait();
      allTxHashes.push({ step: `cycle-${cycle}`, description: `Cycle ${cycle}: executor recordSuccess`, hash: receipt!.hash });
      console.log(`    ${GREEN}✅ Success recorded${RESET} — ${receipt!.hash}\n`);
    } catch (err) {
      console.log(`    ${RED}❌ recordSuccess failed: ${(err as Error).message}${RESET}\n`);
    }
    await sleep(3000);

    // Treasury: check portfolio
    console.log(`  Treasury: checking portfolio...`);
    const treasuryOKB = ethers.formatEther(await provider.getBalance(treasury.address));
    let treasuryUSDC = '0';
    try {
      const bal = await usdcContract.balanceOf(treasury.address);
      treasuryUSDC = ethers.formatUnits(bal, 6);
    } catch { /* skip */ }
    console.log(`    Portfolio: ${treasuryOKB} OKB + ${treasuryUSDC} USDC`);
    console.log(`    ${GREEN}✅ Treasury portfolio check complete${RESET}\n`);
  }

  // ── Step 6: Save results ──
  console.log(`${YELLOW}━━━ Step 6: Results ━━━${RESET}\n`);

  const outputPath = path.resolve(__dirname, 'mainnet-tx-hashes.json');
  fs.writeFileSync(outputPath, JSON.stringify(allTxHashes, null, 2));
  console.log(`  Saved ${allTxHashes.length} tx hashes to ${outputPath}\n`);

  console.log(`  ${CYAN}All Transaction Hashes:${RESET}\n`);
  for (const tx of allTxHashes) {
    console.log(`  ${tx.description}:`);
    console.log(`    ${tx.hash}`);
    console.log(`    ${DIM}https://www.okx.com/web3/explorer/xlayer/tx/${tx.hash}${RESET}\n`);
  }

  console.log(`${CYAN}═════════════════════════════════════════════════════${RESET}`);
  console.log(`  Total transactions:  ${allTxHashes.length}`);
  console.log(`  Agents registered:   ${(await registry.getAgentCount()).toString()}`);
  console.log(`  Registry:            ${REGISTRY}`);
  console.log(`  Explorer:            https://www.okx.com/web3/explorer/xlayer/address/${REGISTRY}`);
  console.log(`${CYAN}═════════════════════════════════════════════════════${RESET}\n`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
