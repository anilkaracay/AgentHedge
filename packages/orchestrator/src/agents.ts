/**
 * In-process agent runtime — starts all 4 agents within the orchestrator process.
 * Each agent gets its own Express server on its own port, exactly as if running standalone.
 * The agents communicate via HTTP (x402) just like in production.
 */
import express from 'express';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import {
  config,
  logInfo,
  logError,
  eventBus,
  getPrice,
  getSwapQuote,
  createX402Middleware,
  callPaidEndpoint,
} from '@agenthedge/shared';
import type {
  OpportunitySignal,
  ExecutionRecommendation,
  PortfolioSnapshot,
  X402RouteConfig,
} from '@agenthedge/shared';

const NATIVE = config.NATIVE_TOKEN_ADDRESS;
const USDC_XLAYER = config.USDC_ADDRESS;
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Shared state ──
let latestSignal: OpportunitySignal | null = null;
let latestRecommendation: ExecutionRecommendation | null = null;
let portfolio: PortfolioSnapshot = {
  totalValueUSD: 0, tokenBalances: [], dailyPnL: 0, dailyPnLPercent: 0, circuitBreakerActive: false,
};

// ── Scout Agent ──
async function startScout(): Promise<void> {
  const wallet = new ethers.Wallet(config.SCOUT_PK);
  const app = express();
  app.use(express.json());

  // x402 protected endpoint
  const routes: Record<string, X402RouteConfig> = {
    'GET /api/opportunity-signal': {
      description: 'CeDeFi arbitrage signal',
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

  app.listen(config.SCOUT_PORT, () => {
    logInfo('scout', `Listening on port ${config.SCOUT_PORT}`);
  });

  // Price scanning loop
  async function scan() {
    try {
      const xlayer = await getPrice('196', NATIVE, USDC_XLAYER);
      await sleep(1500);
      const eth = await getPrice('1', NATIVE, USDC_ETH);

      const dexPrice = xlayer.price;
      const cexPrice = eth.price;
      if (cexPrice === 0) return;

      const spreadPercent = Math.abs(dexPrice - cexPrice) / cexPrice * 100;
      const direction: OpportunitySignal['direction'] = dexPrice < cexPrice ? 'BUY_DEX' : 'SELL_DEX';

      logInfo('scout', `X Layer: $${dexPrice.toFixed(2)} | Ethereum: $${cexPrice.toFixed(2)} | Spread: ${spreadPercent.toFixed(2)}%`);

      const now = new Date();
      latestSignal = {
        id: uuidv4(),
        tokenPair: 'OKB/USDC',
        fromToken: NATIVE,
        toToken: USDC_XLAYER,
        cexPrice, dexPrice,
        spreadPercent: parseFloat(spreadPercent.toFixed(4)),
        direction,
        volume24h: 0,
        confidence: Math.min(1, spreadPercent / 10),
        timestamp: now.toISOString(),
        expiresAt: new Date(now.getTime() + 30_000).toISOString(),
      };

      eventBus.emitDashboardEvent({
        type: 'signal_detected',
        data: latestSignal,
        timestamp: latestSignal.timestamp,
      });
    } catch (err) {
      logError('scout', 'Price scan failed', err);
    }
  }

  // Initial scan + interval
  await scan();
  setInterval(() => { void scan(); }, config.SCOUT_POLL_INTERVAL * 4); // 20s to avoid rate limits
}

// ── Analyst Agent ──
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

  app.listen(config.ANALYST_PORT, () => {
    logInfo('analyst', `Listening on port ${config.ANALYST_PORT}`);
  });

  // Analysis loop — buy signal from Scout, analyze, store recommendation
  async function analyze() {
    if (!latestSignal) { logInfo('analyst', 'No signal available'); return; }

    try {
      // Purchase signal from Scout via x402
      const signal = await callPaidEndpoint<OpportunitySignal>(
        wallet as any, // Wallet without provider is fine for signing
        `http://localhost:${config.SCOUT_PORT}/api/opportunity-signal`,
        'GET', 'analyst', 'scout'
      );

      if (!signal?.id) { logInfo('analyst', 'No signal from Scout'); return; }

      // Check freshness
      if (Date.now() > new Date(signal.expiresAt).getTime()) {
        logInfo('analyst', 'Signal expired');
        return;
      }

      // Re-validate with fresh quote
      await sleep(1500);
      let priceImpact = 0.1;
      let gasFee = '288000';
      try {
        const quote = await getSwapQuote({
          chainIndex: '196', fromTokenAddress: signal.fromToken,
          toTokenAddress: signal.toToken, amount: '1000000000000000', slippagePercent: '0.5',
        });
        priceImpact = parseFloat(quote.priceImpactPercentage || '0.1');
        gasFee = quote.estimateGasFee;
      } catch { /* use defaults */ }

      const tradeAmountUSDC = config.MAX_TRADE_SIZE_USDC;
      const grossProfit = (signal.spreadPercent / 100) * tradeAmountUSDC;
      const slippageCost = (Math.max(priceImpact, 0.1) / 100) * tradeAmountUSDC;
      const netProfit = grossProfit - slippageCost - 0.05;
      const action = netProfit > 0.5 && signal.confidence > 0.01 ? 'EXECUTE' as const : 'SKIP' as const;

      latestRecommendation = {
        id: uuidv4(),
        signalId: signal.id,
        action,
        confidence: signal.confidence,
        estimatedProfit: parseFloat(netProfit.toFixed(4)),
        estimatedSlippage: parseFloat(priceImpact.toFixed(4)),
        estimatedPriceImpact: priceImpact,
        suggestedAmount: '10000000000000000',
        suggestedMinOutput: '0',
        reason: `Net profit $${netProfit.toFixed(2)}, confidence ${signal.confidence.toFixed(2)}`,
        timestamp: new Date().toISOString(),
      };

      logInfo('analyst', `Analysis: ${action} | profit $${netProfit.toFixed(2)} | confidence ${signal.confidence.toFixed(2)}`);

      eventBus.emitDashboardEvent({
        type: 'analysis_complete',
        data: latestRecommendation,
        timestamp: latestRecommendation.timestamp,
      });
    } catch (err) {
      logError('analyst', 'Analysis failed', err);
    }
  }

  // Wait for Scout to have data, then start
  await sleep(8000);
  await analyze();
  setInterval(() => { void analyze(); }, config.SCOUT_POLL_INTERVAL * 5); // 25s
}

// ── Executor Agent ──
async function startExecutor(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.get('/api/trade-result', (_req, res) => res.status(204).json({ message: 'No result' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', agentId: 'executor' }));

  app.listen(config.EXECUTOR_PORT, () => {
    logInfo('executor', `Listening on port ${config.EXECUTOR_PORT}`);
  });
}

// ── Treasury Agent ──
async function startTreasury(): Promise<void> {
  const provider = new ethers.JsonRpcProvider(config.XLAYER_RPC);
  const wallet = new ethers.Wallet(config.TREASURY_PK, provider);
  const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

  const app = express();
  app.use(express.json());

  app.post('/api/risk-check', (_req, res) => {
    res.json({
      approved: !portfolio.circuitBreakerActive,
      maxTradeSize: '1000000',
      reason: portfolio.circuitBreakerActive ? 'Circuit breaker active' : undefined,
    });
  });
  app.get('/api/portfolio', (_req, res) => res.json(portfolio));
  app.post('/api/trade-result', (_req, res) => res.json({ received: true }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', agentId: 'treasury' }));

  app.listen(config.TREASURY_PORT, () => {
    logInfo('treasury', `Listening on port ${config.TREASURY_PORT}`);
  });

  // Portfolio monitoring
  async function refreshPortfolio() {
    try {
      const nativeBal = await provider.getBalance(wallet.address);
      const nativeHuman = parseFloat(ethers.formatEther(nativeBal));

      let usdcBal = 0;
      try {
        const usdc = new ethers.Contract(USDC_XLAYER, ERC20_ABI, provider);
        const raw = await usdc.balanceOf(wallet.address);
        usdcBal = parseFloat(ethers.formatUnits(raw, 6));
      } catch { /* skip */ }

      // Get native price for USD conversion
      let nativePrice = 0;
      try {
        const p = await getPrice('196', NATIVE, USDC_XLAYER);
        nativePrice = p.price;
      } catch { /* skip */ }

      const nativeValue = nativeHuman * nativePrice;
      const totalValue = nativeValue + usdcBal;

      portfolio = {
        totalValueUSD: parseFloat(totalValue.toFixed(4)),
        tokenBalances: [
          { token: 'OKB', balance: nativeHuman.toFixed(6), valueUSD: parseFloat(nativeValue.toFixed(4)) },
          { token: 'USDC', balance: usdcBal.toFixed(6), valueUSD: usdcBal },
        ],
        dailyPnL: 0,
        dailyPnLPercent: 0,
        circuitBreakerActive: false,
      };

      logInfo('treasury', `Portfolio: $${totalValue.toFixed(2)} (OKB: ${nativeHuman.toFixed(4)}, USDC: ${usdcBal.toFixed(2)})`);

      eventBus.emitDashboardEvent({
        type: 'portfolio_update',
        data: portfolio,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logError('treasury', 'Portfolio refresh failed', err);
    }
  }

  await sleep(3000);
  await refreshPortfolio();
  setInterval(() => { void refreshPortfolio(); }, config.PORTFOLIO_POLL_INTERVAL * 2); // 60s
}

// ── Start all agents ──
export async function startAllAgents(): Promise<void> {
  logInfo('orchestrator', 'Starting all 4 agents in-process...');

  await startScout();
  await startExecutor();
  await startTreasury();
  await startAnalyst(); // Last — needs Scout to be running

  logInfo('orchestrator', 'All 4 agents started');

  // Emit agent_registered events for dashboard
  for (const agent of ['scout', 'analyst', 'executor', 'treasury']) {
    eventBus.emitDashboardEvent({
      type: 'agent_registered',
      data: { agentId: agent, role: agent, endpoint: `http://localhost:${(config as any)[`${agent.toUpperCase()}_PORT`]}` },
      timestamp: new Date().toISOString(),
    });
  }
}
