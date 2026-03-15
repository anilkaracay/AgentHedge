/**
 * In-process agent runtime — starts all 4 agents.
 * Scout scans ALL venues simultaneously for multi-venue arbitrage.
 */
import express from 'express';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import {
  config, logInfo, logError, eventBus,
  getPrice, getSwapQuote, scanAllVenues,
  TRACKED_TOKENS, USDC_XLAYER,
  createX402Middleware, callPaidEndpoint,
} from '@agenthedge/shared';
import type {
  ArbitrageOpportunity, ExecutionRecommendation,
  PortfolioSnapshot, X402RouteConfig,
} from '@agenthedge/shared';

const NATIVE = config.NATIVE_TOKEN_ADDRESS;
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

let latestSignal: ArbitrageOpportunity | null = null;
let latestRecommendation: ExecutionRecommendation | null = null;
let portfolio: PortfolioSnapshot = {
  totalValueUSD: 0, tokenBalances: [], dailyPnL: 0, dailyPnLPercent: 0, circuitBreakerActive: false,
};

// ── Scout: Multi-Venue Scanner ──
async function startScout(): Promise<void> {
  const wallet = new ethers.Wallet(config.SCOUT_PK);
  const app = express();
  app.use(express.json());

  const routes: Record<string, X402RouteConfig> = {
    'GET /api/opportunity-signal': {
      description: 'Multi-venue arbitrage signal',
      priceUSDC: 0.02,
      receiverAddress: wallet.address,
      receiverAgentId: 'scout',
    },
  };
  app.use(createX402Middleware(routes));
  app.get('/api/opportunity-signal', (_req, res) => {
    if (!latestSignal) { res.status(204).json({ message: 'No opportunity' }); return; }
    res.json(latestSignal);
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok', agentId: 'scout' }));
  app.listen(config.SCOUT_PORT, () => logInfo('scout', `Listening on port ${config.SCOUT_PORT}`));

  async function scan() {
    for (const token of TRACKED_TOKENS) {
      try {
        const scan = await scanAllVenues(token);
        const now = new Date();

        latestSignal = {
          id: uuidv4(),
          token: token.symbol,
          tokenAddress: token.xlayerAddress,
          buyVenue: scan.cheapest,
          sellVenue: scan.mostExpensive,
          allVenues: scan.venues,
          spreadPercent: scan.spreadPercent,
          spreadAbsolute: scan.spreadAbsolute,
          venuesScanned: 8,
          venuesResponded: scan.venues.length,
          scanDuration: scan.scanDuration,
          confidence: Math.min(1, scan.spreadPercent / 1.0),
          timestamp: now.toISOString(),
          expiresAt: new Date(now.getTime() + 30_000).toISOString(),
        };

        eventBus.emitDashboardEvent({
          type: 'signal_detected',
          data: latestSignal,
          timestamp: latestSignal.timestamp,
        });
      } catch (err) {
        logError('scout', `Scan failed for ${token.symbol}`, err);
      }
      await sleep(2000);
    }
  }

  await scan();
  setInterval(() => { void scan(); }, config.SCOUT_POLL_INTERVAL * 6);
}

// ── Analyst ──
async function startAnalyst(): Promise<void> {
  const wallet = new ethers.Wallet(config.ANALYST_PK);
  const app = express();
  app.use(express.json());

  const routes: Record<string, X402RouteConfig> = {
    'GET /api/execution-recommendation': {
      description: 'Execution recommendation',
      priceUSDC: 0.03,
      receiverAddress: wallet.address,
      receiverAgentId: 'analyst',
    },
  };
  app.use(createX402Middleware(routes));
  app.get('/api/execution-recommendation', (_req, res) => {
    if (!latestRecommendation) { res.status(204).json({ message: 'No recommendation' }); return; }
    res.json(latestRecommendation);
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok', agentId: 'analyst' }));
  app.listen(config.ANALYST_PORT, () => logInfo('analyst', `Listening on port ${config.ANALYST_PORT}`));

  async function analyze() {
    if (!latestSignal) return;
    try {
      const signal = await callPaidEndpoint<ArbitrageOpportunity>(
        wallet as any,
        `http://localhost:${config.SCOUT_PORT}/api/opportunity-signal`,
        'GET', 'analyst', 'scout'
      );
      if (!signal?.id) return;
      if (Date.now() > new Date(signal.expiresAt).getTime()) return;

      // Re-scan for fresh prices
      const tokenCfg = TRACKED_TOKENS.find(t => t.symbol === signal.token);
      if (!tokenCfg) return;
      const freshScan = await scanAllVenues(tokenCfg);

      const tradeAmountUSDC = config.MAX_TRADE_SIZE_USDC;
      const grossProfit = (freshScan.spreadPercent / 100) * tradeAmountUSDC;
      const dexCost = 0.05; // slippage + gas estimate
      const netProfit = grossProfit - dexCost - 0.05;
      const action = netProfit > 0.10 ? 'EXECUTE' as const : 'SKIP' as const;

      const buyV = freshScan.cheapest;
      const sellV = freshScan.mostExpensive;

      latestRecommendation = {
        id: uuidv4(),
        signalId: signal.id,
        action,
        confidence: signal.confidence,
        estimatedProfit: parseFloat(netProfit.toFixed(4)),
        estimatedSlippage: 0.1,
        estimatedPriceImpact: 0.1,
        suggestedAmount: tokenCfg.quoteAmount,
        suggestedMinOutput: '0',
        reason: `BUY @ ${buyV.venue} $${buyV.price.toFixed(2)}, SELL @ ${sellV.venue} $${sellV.price.toFixed(2)} | ${freshScan.venues.length} venues | net $${netProfit.toFixed(2)}`,
        timestamp: new Date().toISOString(),
      };

      logInfo('analyst', `${signal.token}: ${action} | spread ${freshScan.spreadPercent.toFixed(2)}% | net $${netProfit.toFixed(2)}`);
      eventBus.emitDashboardEvent({ type: 'analysis_complete', data: latestRecommendation, timestamp: latestRecommendation.timestamp });
    } catch (err) {
      logError('analyst', 'Analysis failed', err);
    }
  }

  await sleep(15000);
  await analyze();
  setInterval(() => { void analyze(); }, config.SCOUT_POLL_INTERVAL * 7);
}

// ── Executor + Treasury (unchanged logic) ──
async function startExecutor(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.get('/api/trade-result', (_req, res) => res.status(204).json({ message: 'No result' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', agentId: 'executor' }));
  app.listen(config.EXECUTOR_PORT, () => logInfo('executor', `Listening on port ${config.EXECUTOR_PORT}`));
}

async function startTreasury(): Promise<void> {
  const provider = new ethers.JsonRpcProvider(config.XLAYER_RPC);
  const wallet = new ethers.Wallet(config.TREASURY_PK, provider);
  const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

  const app = express();
  app.use(express.json());
  app.post('/api/risk-check', (_req, res) => res.json({ approved: !portfolio.circuitBreakerActive, maxTradeSize: '1000000' }));
  app.get('/api/portfolio', (_req, res) => res.json(portfolio));
  app.post('/api/trade-result', (_req, res) => res.json({ received: true }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', agentId: 'treasury' }));
  app.listen(config.TREASURY_PORT, () => logInfo('treasury', `Listening on port ${config.TREASURY_PORT}`));

  async function refreshPortfolio() {
    try {
      const nativeBal = await provider.getBalance(wallet.address);
      const nativeHuman = parseFloat(ethers.formatEther(nativeBal));
      let usdcBal = 0;
      try {
        const usdc = new ethers.Contract(USDC_XLAYER, ERC20_ABI, provider);
        usdcBal = parseFloat(ethers.formatUnits(await usdc.balanceOf(wallet.address), 6));
      } catch { /* skip */ }
      let nativePrice = 0;
      try { nativePrice = (await getPrice('196', NATIVE, USDC_XLAYER)).price; } catch { /* skip */ }
      const totalValue = nativeHuman * nativePrice + usdcBal;
      portfolio = {
        totalValueUSD: parseFloat(totalValue.toFixed(4)),
        tokenBalances: [
          { token: 'OKB', balance: nativeHuman.toFixed(6), valueUSD: parseFloat((nativeHuman * nativePrice).toFixed(4)) },
          { token: 'USDC', balance: usdcBal.toFixed(6), valueUSD: usdcBal },
        ],
        dailyPnL: 0, dailyPnLPercent: 0, circuitBreakerActive: false,
      };
      logInfo('treasury', `Portfolio: $${totalValue.toFixed(2)}`);
      eventBus.emitDashboardEvent({ type: 'portfolio_update', data: portfolio, timestamp: new Date().toISOString() });
    } catch (err) {
      logError('treasury', 'Portfolio refresh failed', err);
    }
  }

  await sleep(3000);
  await refreshPortfolio();
  setInterval(() => { void refreshPortfolio(); }, config.PORTFOLIO_POLL_INTERVAL * 2);
}

export async function startAllAgents(): Promise<void> {
  logInfo('orchestrator', 'Starting 4 agents (multi-venue arbitrage mode)...');
  await startScout();
  await startExecutor();
  await startTreasury();
  await startAnalyst();
  logInfo('orchestrator', 'All 4 agents started');
  for (const agent of ['scout', 'analyst', 'executor', 'treasury']) {
    eventBus.emitDashboardEvent({
      type: 'agent_registered',
      data: { agentId: agent, role: agent },
      timestamp: new Date().toISOString(),
    });
  }
}
