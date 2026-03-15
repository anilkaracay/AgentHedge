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
});
