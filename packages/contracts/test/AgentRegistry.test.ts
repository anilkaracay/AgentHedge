import { expect } from 'chai';
import { ethers } from 'hardhat';
import { AgentRegistry } from '../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

describe('AgentRegistry', function () {
  let registry: AgentRegistry;
  let owner: HardhatEthersSigner;
  let scout: HardhatEthersSigner;
  let analyst: HardhatEthersSigner;
  let executor: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  const USDC = '0x0000000000000000000000000000000000000001';
  const PRICE = 20000n; // 0.02 USDC

  beforeEach(async function () {
    [owner, scout, analyst, executor, treasury, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('AgentRegistry');
    registry = await Factory.deploy();
    await registry.waitForDeployment();
  });

  describe('register()', function () {
    it('should register an agent with correct fields', async function () {
      await registry.connect(scout).register(
        'scout-1', 'scout', 'http://localhost:3001', PRICE, USDC
      );

      const agent = await registry.getAgent('scout-1');
      expect(agent.wallet).to.equal(scout.address);
      expect(agent.agentId).to.equal('scout-1');
      expect(agent.role).to.equal('scout');
      expect(agent.endpoint).to.equal('http://localhost:3001');
      expect(agent.pricePerReq).to.equal(PRICE);
      expect(agent.payToken).to.equal(USDC);
      expect(agent.successCount).to.equal(0n);
      expect(agent.failCount).to.equal(0n);
      expect(agent.active).to.be.true;
    });

    it('should emit AgentRegistered event', async function () {
      await expect(
        registry.connect(scout).register('scout-1', 'scout', 'http://localhost:3001', PRICE, USDC)
      ).to.emit(registry, 'AgentRegistered');
    });

    it('should reject duplicate agent ID', async function () {
      await registry.connect(scout).register('scout-1', 'scout', 'http://localhost:3001', PRICE, USDC);
      await expect(
        registry.connect(analyst).register('scout-1', 'analyst', 'http://localhost:3002', PRICE, USDC)
      ).to.be.revertedWith('Agent ID already taken');
    });

    it('should reject empty agent ID', async function () {
      await expect(
        registry.connect(scout).register('', 'scout', 'http://localhost:3001', PRICE, USDC)
      ).to.be.revertedWith('Agent ID cannot be empty');
    });

    it('should reject empty role', async function () {
      await expect(
        registry.connect(scout).register('scout-1', '', 'http://localhost:3001', PRICE, USDC)
      ).to.be.revertedWith('Role cannot be empty');
    });
  });

  describe('getAgent()', function () {
    it('should return correct agent data', async function () {
      await registry.connect(scout).register('scout-1', 'scout', 'http://localhost:3001', PRICE, USDC);
      const agent = await registry.getAgent('scout-1');
      expect(agent.role).to.equal('scout');
      expect(agent.wallet).to.equal(scout.address);
    });

    it('should revert for non-existent agent', async function () {
      await expect(registry.getAgent('nonexistent')).to.be.revertedWith('Agent not found');
    });
  });

  describe('getAllAgents()', function () {
    it('should return all registered agents', async function () {
      await registry.connect(scout).register('scout-1', 'scout', 'http://localhost:3001', PRICE, USDC);
      await registry.connect(analyst).register('analyst-1', 'analyst', 'http://localhost:3002', 30000n, USDC);
      await registry.connect(executor).register('executor-1', 'executor', 'http://localhost:3003', 0n, USDC);
      await registry.connect(treasury).register('treasury-1', 'treasury', 'http://localhost:3004', 0n, USDC);

      const all = await registry.getAllAgents();
      expect(all.length).to.equal(4);
      expect(all[0].role).to.equal('scout');
      expect(all[1].role).to.equal('analyst');
      expect(all[2].role).to.equal('executor');
      expect(all[3].role).to.equal('treasury');
    });

    it('should return empty array when no agents registered', async function () {
      const all = await registry.getAllAgents();
      expect(all.length).to.equal(0);
    });
  });

  describe('getAgentCount()', function () {
    it('should return correct count', async function () {
      expect(await registry.getAgentCount()).to.equal(0n);
      await registry.connect(scout).register('scout-1', 'scout', 'http://localhost:3001', PRICE, USDC);
      expect(await registry.getAgentCount()).to.equal(1n);
    });
  });

  describe('updateEndpoint()', function () {
    beforeEach(async function () {
      await registry.connect(scout).register('scout-1', 'scout', 'http://localhost:3001', PRICE, USDC);
    });

    it('should allow owner to update endpoint', async function () {
      await registry.connect(scout).updateEndpoint('scout-1', 'http://newhost:4001');
      const agent = await registry.getAgent('scout-1');
      expect(agent.endpoint).to.equal('http://newhost:4001');
    });

    it('should emit AgentUpdated event', async function () {
      await expect(
        registry.connect(scout).updateEndpoint('scout-1', 'http://newhost:4001')
      ).to.emit(registry, 'AgentUpdated');
    });

    it('should reject non-owner', async function () {
      await expect(
        registry.connect(other).updateEndpoint('scout-1', 'http://evil:666')
      ).to.be.revertedWith('Not agent owner');
    });
  });

  describe('updatePrice()', function () {
    beforeEach(async function () {
      await registry.connect(scout).register('scout-1', 'scout', 'http://localhost:3001', PRICE, USDC);
    });

    it('should allow owner to update price', async function () {
      await registry.connect(scout).updatePrice('scout-1', 50000n);
      const agent = await registry.getAgent('scout-1');
      expect(agent.pricePerReq).to.equal(50000n);
    });

    it('should reject non-owner', async function () {
      await expect(
        registry.connect(other).updatePrice('scout-1', 50000n)
      ).to.be.revertedWith('Not agent owner');
    });
  });

  describe('recordSuccess() / recordFailure()', function () {
    beforeEach(async function () {
      await registry.connect(scout).register('scout-1', 'scout', 'http://localhost:3001', PRICE, USDC);
    });

    it('should increment success count', async function () {
      await registry.connect(scout).recordSuccess('scout-1');
      await registry.connect(scout).recordSuccess('scout-1');
      const agent = await registry.getAgent('scout-1');
      expect(agent.successCount).to.equal(2n);
    });

    it('should emit SuccessRecorded event', async function () {
      await expect(
        registry.connect(scout).recordSuccess('scout-1')
      ).to.emit(registry, 'SuccessRecorded');
    });

    it('should increment fail count', async function () {
      await registry.connect(scout).recordFailure('scout-1');
      const agent = await registry.getAgent('scout-1');
      expect(agent.failCount).to.equal(1n);
    });

    it('should emit FailureRecorded event', async function () {
      await expect(
        registry.connect(scout).recordFailure('scout-1')
      ).to.emit(registry, 'FailureRecorded');
    });

    it('should reject non-owner for recordSuccess', async function () {
      await expect(
        registry.connect(other).recordSuccess('scout-1')
      ).to.be.revertedWith('Not agent owner');
    });

    it('should reject non-owner for recordFailure', async function () {
      await expect(
        registry.connect(other).recordFailure('scout-1')
      ).to.be.revertedWith('Not agent owner');
    });
  });

  describe('deactivate()', function () {
    beforeEach(async function () {
      await registry.connect(scout).register('scout-1', 'scout', 'http://localhost:3001', PRICE, USDC);
    });

    it('should deactivate agent', async function () {
      await registry.connect(scout).deactivate('scout-1');
      const agent = await registry.getAgent('scout-1');
      expect(agent.active).to.be.false;
    });

    it('should emit AgentDeactivated event', async function () {
      await expect(
        registry.connect(scout).deactivate('scout-1')
      ).to.emit(registry, 'AgentDeactivated');
    });

    it('should reject non-owner', async function () {
      await expect(
        registry.connect(other).deactivate('scout-1')
      ).to.be.revertedWith('Not agent owner');
    });
  });

  describe('attestCycle()', function () {
    const buyHash = ethers.keccak256(ethers.toUtf8Bytes('okx'));
    const sellHash = ethers.keccak256(ethers.toUtf8Bytes('binance'));

    beforeEach(async function () {
      await registry.connect(scout).register('scout-1', 'scout', 'http://localhost:3001', PRICE, USDC);
    });

    it('should allow registered agent to attest a cycle', async function () {
      await registry.connect(scout).attestCycle(
        1, // cycleId
        ethers.parseUnits('95.50', 18), // bestBidPrice
        ethers.parseUnits('96.10', 18), // bestAskPrice
        63, // spreadBps (0.63%)
        7,  // venueCount
        buyHash,
        sellHash,
        1,  // decision: EXECUTE
        1250 // estimatedProfitUsd in cents ($12.50)
      );

      const att = await registry.getAttestation(0);
      expect(att.cycleId).to.equal(1);
      expect(att.bestBidPrice).to.equal(ethers.parseUnits('95.50', 18));
      expect(att.bestAskPrice).to.equal(ethers.parseUnits('96.10', 18));
      expect(att.spreadBps).to.equal(63);
      expect(att.venueCount).to.equal(7);
      expect(att.buyVenueHash).to.equal(buyHash);
      expect(att.sellVenueHash).to.equal(sellHash);
      expect(att.decision).to.equal(1);
      expect(att.estimatedProfitUsd).to.equal(1250);
      expect(att.attestedBy).to.equal(scout.address);
      expect(await registry.attestationCount()).to.equal(1);
    });

    it('should reject attestation from unregistered address', async function () {
      await expect(
        registry.connect(other).attestCycle(1, 0, 0, 0, 0, buyHash, sellHash, 0, 0)
      ).to.be.revertedWith('Not an active agent');
    });

    it('should reject attestation from deactivated agent', async function () {
      await registry.connect(scout).deactivate('scout-1');
      await expect(
        registry.connect(scout).attestCycle(1, 0, 0, 0, 0, buyHash, sellHash, 0, 0)
      ).to.be.revertedWith('Not an active agent');
    });

    it('should emit CycleAttested event with correct data', async function () {
      await expect(
        registry.connect(scout).attestCycle(
          5, ethers.parseUnits('95.50', 18), ethers.parseUnits('96.10', 18),
          63, 7, buyHash, sellHash, 1, 1250
        )
      ).to.emit(registry, 'CycleAttested').withArgs(5, 63, 1, 1250, (v: any) => v > 0);
    });

    it('should store multiple attestations', async function () {
      await registry.connect(scout).attestCycle(1, 0, 0, 10, 5, buyHash, sellHash, 0, -50);
      await registry.connect(scout).attestCycle(2, 0, 0, 42, 7, buyHash, sellHash, 1, 1250);
      await registry.connect(scout).attestCycle(3, 0, 0, 8, 6, buyHash, sellHash, 2, -100);

      expect(await registry.attestationCount()).to.equal(3);

      const att1 = await registry.getAttestation(0);
      expect(att1.cycleId).to.equal(1);
      expect(att1.decision).to.equal(0); // MONITOR

      const att3 = await registry.getAttestation(2);
      expect(att3.cycleId).to.equal(3);
      expect(att3.decision).to.equal(2); // SKIP
    });
  });

  describe('getAttestation()', function () {
    beforeEach(async function () {
      await registry.connect(scout).register('scout-1', 'scout', 'http://localhost:3001', PRICE, USDC);
    });

    it('should revert for out-of-bounds index', async function () {
      await expect(registry.getAttestation(0)).to.be.revertedWith('Index out of bounds');
    });
  });

  describe('getLatestAttestations()', function () {
    const buyHash = ethers.keccak256(ethers.toUtf8Bytes('okx'));
    const sellHash = ethers.keccak256(ethers.toUtf8Bytes('binance'));

    beforeEach(async function () {
      await registry.connect(scout).register('scout-1', 'scout', 'http://localhost:3001', PRICE, USDC);
      // Add 5 attestations
      for (let i = 1; i <= 5; i++) {
        await registry.connect(scout).attestCycle(i, 0, 0, i * 10, 7, buyHash, sellHash, i % 3, i * 100);
      }
    });

    it('should return last N attestations', async function () {
      const latest = await registry.getLatestAttestations(3);
      expect(latest.length).to.equal(3);
      expect(latest[0].cycleId).to.equal(3); // 3rd attestation
      expect(latest[1].cycleId).to.equal(4);
      expect(latest[2].cycleId).to.equal(5);
    });

    it('should return all when count exceeds total', async function () {
      const latest = await registry.getLatestAttestations(100);
      expect(latest.length).to.equal(5);
    });

    it('should return empty for zero count', async function () {
      const latest = await registry.getLatestAttestations(0);
      expect(latest.length).to.equal(0);
    });
  });
});
