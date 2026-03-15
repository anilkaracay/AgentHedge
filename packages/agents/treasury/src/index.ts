import { ethers } from 'ethers';
import {
  AgentBase,
  config,
  logInfo,
  logError,
  eventBus,
  getPrice,
} from '@agenthedge/shared';
import type {
  AgentConfig,
  PortfolioSnapshot,
  TradeResult,
} from '@agenthedge/shared';
import { distributeProfit } from './profitDistributor.js';
import { createTreasuryServer } from './server.js';

// Minimal ERC20 ABI for balanceOf
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

class TreasuryAgent extends AgentBase {
  private portfolio: PortfolioSnapshot = {
    totalValueUSD: 0,
    tokenBalances: [],
    dailyPnL: 0,
    dailyPnLPercent: 0,
    circuitBreakerActive: false,
  };
  private startOfDayValue: number = 0;

  constructor() {
    const agentConfig: AgentConfig = {
      agentId: 'treasury',
      role: 'treasury',
      privateKey: config.TREASURY_PK,
      port: config.TREASURY_PORT,
      endpoint: `http://localhost:${config.TREASURY_PORT}`,
      pricePerRequest: 0,
    };
    super(agentConfig);
  }

  async run(): Promise<void> {
    // Register on-chain
    try {
      await this.registerSelf();
    } catch (err) {
      logError('treasury', 'On-chain registration failed, continuing anyway', err);
    }

    // Set up server
    const treasuryApp = createTreasuryServer(() => this.portfolio);

    // Handle trade results from executor
    treasuryApp.post('/api/trade-result', async (req, res) => {
      const result = req.body as TradeResult;
      logInfo('treasury', `Received trade result: ${result.status}`, { tradeId: result.id });

      if (result.status === 'EXECUTED' && result.realizedProfit) {
        try {
          const executors = await this.discover('executor');
          const executorAddress = executors.length > 0
            ? executors[0].wallet
            : '';
          await distributeProfit(result, executorAddress);
        } catch (err) {
          logError('treasury', 'Profit distribution failed', err);
        }
      }

      await this.refreshPortfolio();
      res.json({ received: true });
    });

    this.app.use(treasuryApp);
    this.start(config.TREASURY_PORT);

    // Initial portfolio snapshot
    await this.refreshPortfolio();
    this.startOfDayValue = this.portfolio.totalValueUSD;

    // Start portfolio monitoring loop
    logInfo('treasury', `Starting portfolio monitor, interval ${config.PORTFOLIO_POLL_INTERVAL}ms`);
    setInterval(() => { void this.monitorPortfolio(); }, config.PORTFOLIO_POLL_INTERVAL);
  }

  private async refreshPortfolio(): Promise<void> {
    try {
      // Read balances directly from X Layer RPC (no API needed)
      const nativeBalance = await this.provider.getBalance(this.wallet.address);
      const nativeBalanceHuman = parseFloat(ethers.formatEther(nativeBalance));

      let usdcBalance = 0;
      if (config.USDC_ADDRESS && config.USDC_ADDRESS !== '') {
        try {
          const usdcContract = new ethers.Contract(config.USDC_ADDRESS, ERC20_ABI, this.provider);
          const rawBalance = await usdcContract.balanceOf(this.wallet.address);
          usdcBalance = parseFloat(ethers.formatUnits(rawBalance, 6));
        } catch {
          // USDC contract may not be deployed on testnet
        }
      }

      // Get native token price in USD via aggregator quote
      let nativePriceUSD = 0;
      try {
        const priceResult = await getPrice(
          config.XLAYER_CHAIN_INDEX,
          config.NATIVE_TOKEN_ADDRESS,
          config.USDC_ADDRESS
        );
        nativePriceUSD = priceResult.price;
      } catch {
        // Price oracle may fail on testnet
      }

      const nativeValueUSD = nativeBalanceHuman * nativePriceUSD;
      const totalValueUSD = nativeValueUSD + usdcBalance;

      const tokenBalances = [
        { token: 'OKB', balance: nativeBalanceHuman.toFixed(6), valueUSD: nativeValueUSD },
        { token: 'USDC', balance: usdcBalance.toFixed(6), valueUSD: usdcBalance },
      ];

      // Calculate daily P&L
      const dailyPnL = this.startOfDayValue > 0
        ? totalValueUSD - this.startOfDayValue
        : 0;
      const dailyPnLPercent = this.startOfDayValue > 0
        ? (dailyPnL / this.startOfDayValue) * 100
        : 0;

      this.portfolio = {
        totalValueUSD: parseFloat(totalValueUSD.toFixed(4)),
        tokenBalances,
        dailyPnL: parseFloat(dailyPnL.toFixed(4)),
        dailyPnLPercent: parseFloat(dailyPnLPercent.toFixed(4)),
        circuitBreakerActive: this.portfolio.circuitBreakerActive,
      };

      logInfo('treasury', `Portfolio: $${totalValueUSD.toFixed(2)} (OKB: ${nativeBalanceHuman.toFixed(4)}, USDC: ${usdcBalance.toFixed(2)})`);
    } catch (err) {
      logError('treasury', 'Failed to refresh portfolio', err);
    }
  }

  private async monitorPortfolio(): Promise<void> {
    await this.refreshPortfolio();

    // Circuit breaker check
    if (
      !this.portfolio.circuitBreakerActive &&
      this.portfolio.dailyPnLPercent < -(config.DAILY_LOSS_LIMIT_PCT * 100)
    ) {
      this.portfolio.circuitBreakerActive = true;
      logError('treasury', `Circuit breaker activated! Daily P&L: ${this.portfolio.dailyPnLPercent}%`);

      eventBus.emitDashboardEvent({
        type: 'risk_alert',
        data: {
          type: 'circuit_breaker',
          message: `Daily loss ${this.portfolio.dailyPnLPercent.toFixed(2)}% exceeds ${config.DAILY_LOSS_LIMIT_PCT * 100}% limit`,
        },
        timestamp: new Date().toISOString(),
      });
    }

    eventBus.emitDashboardEvent({
      type: 'portfolio_update',
      data: this.portfolio,
      timestamp: new Date().toISOString(),
    });
  }
}

const treasury = new TreasuryAgent();
treasury.run().catch((err) => {
  logError('treasury', 'Fatal error', err);
  process.exit(1);
});
