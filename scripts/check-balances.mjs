import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://rpc.xlayer.tech');

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const wallets = [
  { name: 'DEPLOYER', address: '0x4aF5d30b53B20d68A90D3FCb5780D9d661493326' },
  { name: 'SCOUT',    address: '0xddEecB2b67564541D5E765c4351C579F5F73a41e' },
  { name: 'ANALYST',  address: '0x103b2E12CDB4AaE9700b67f77c72394E26402d09' },
  { name: 'EXECUTOR', address: '0xd934004742213b3263A9A66c6d9390215B7f95e6' },
  { name: 'TREASURY', address: '0x89583a5f27585309639d7Ed4ce30814d581F68Ed' },
];

const tokens = [
  { symbol: 'USDC', address: '0x74b7f16337b8972027f6196a17a631ac6de26d22' },
  { symbol: 'USDT', address: '0x1e4a5963abfd975d8c9021ce480b42188849d41d' },
];

async function checkAll() {
  console.log('=== X LAYER MAINNET WALLET BALANCES ===\n');

  const results = [];

  for (const wallet of wallets) {
    console.log(`${wallet.name}: ${wallet.address}`);

    const okbBalance = await provider.getBalance(wallet.address);
    const okbStr = ethers.formatEther(okbBalance);
    console.log(`  OKB:  ${okbStr}`);

    const row = { name: wallet.name, okb: okbStr, usdc: '0', usdt: '0' };

    for (const token of tokens) {
      const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
      try {
        const balance = await contract.balanceOf(wallet.address);
        const decimals = await contract.decimals();
        const formatted = ethers.formatUnits(balance, decimals);
        console.log(`  ${token.symbol}: ${formatted}`);
        if (token.symbol === 'USDC') row.usdc = formatted;
        if (token.symbol === 'USDT') row.usdt = formatted;
      } catch (e) {
        console.log(`  ${token.symbol}: ERROR — ${e.message}`);
      }
    }
    console.log('');
    results.push(row);
  }

  // Summary table
  console.log('=== SUMMARY ===');
  console.log('WALLET      OKB              USDC             USDT');
  console.log('─────────   ──────────────   ──────────────   ──────────────');
  for (const r of results) {
    console.log(
      `${r.name.padEnd(12)}${r.okb.padStart(14)}   ${r.usdc.padStart(14)}   ${r.usdt.padStart(14)}`
    );
  }

  // Totals
  const totalOKB = results.reduce((s, r) => s + parseFloat(r.okb), 0);
  const totalUSDC = results.reduce((s, r) => s + parseFloat(r.usdc), 0);
  const totalUSDT = results.reduce((s, r) => s + parseFloat(r.usdt), 0);
  console.log('─────────   ──────────────   ──────────────   ──────────────');
  console.log(
    `${'TOTAL'.padEnd(12)}${totalOKB.toFixed(6).padStart(14)}   ${totalUSDC.toFixed(6).padStart(14)}   ${totalUSDT.toFixed(6).padStart(14)}`
  );

  console.log('\n=== ASSESSMENT ===');
  console.log('For real x402 payments per cycle:');
  console.log('  ANALYST pays SCOUT:     0.02 USDC');
  console.log('  EXECUTOR pays ANALYST:  0.03 USDC');
  console.log('  TREASURY pays EXECUTOR: 0.10 USDC');
  console.log('  Total per cycle:        0.15 USDC');
  console.log('  For 50 cycles:          7.50 USDC');
  console.log('  Each agent needs tiny OKB for gas (~0.001 OKB per tx)');
  console.log(`\n  Available USDC: ${totalUSDC.toFixed(6)}`);
  console.log(`  Available USDT: ${totalUSDT.toFixed(6)}`);
  console.log(`  Available OKB:  ${totalOKB.toFixed(6)}`);

  if (totalUSDC >= 7.5) {
    console.log('\n  ✓ Sufficient USDC for ~50 cycles of real x402 payments');
  } else if (totalUSDC > 0) {
    const cycles = Math.floor(totalUSDC / 0.15);
    console.log(`\n  ⚠ Only enough USDC for ~${cycles} cycles`);
  } else {
    console.log('\n  ✗ No USDC available — need to fund wallets');
  }

  if (totalOKB < 0.01) {
    console.log('  ✗ Very low OKB — agents may not have gas for transactions');
  } else {
    console.log(`  ✓ ${totalOKB.toFixed(6)} OKB available for gas`);
  }
}

checkAll().catch(console.error);
