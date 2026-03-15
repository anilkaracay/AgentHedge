import { ethers } from 'ethers';

const roles = ['SCOUT', 'ANALYST', 'EXECUTOR', 'TREASURY', 'DEPLOYER'] as const;

console.log('# ── Generated Agent Wallets ──');
console.log('# Copy these into your .env file\n');

for (const role of roles) {
  const wallet = ethers.Wallet.createRandom();
  console.log(`# ${role}`);
  console.log(`${role}_PK=${wallet.privateKey}`);
  console.log(`# ${role}_ADDRESS=${wallet.address}`);
  console.log('');
}
