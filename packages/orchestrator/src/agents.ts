/**
 * In-process agent runtime — starts all 4 agents within the orchestrator.
 * Scout compares CEX spot prices vs X Layer DEX prices (true CeDeFi arbitrage).
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
  getCEXPrice,
  TRACKED_TOKENS,
  USDC_XLAYER,
  createX402Middleware,
  callPaidEndpoint,
} from '@agenthedge/shared';
import type {
  ArbitrageOpportunity,
  ExecutionRecommendation,
  PortfolioSnapshot,
  TokenConfig,
  X402RouteConfig,
} from '@agenthedge/shared';

const NATIVE = config.NATIVE_TOKEN_ADDRESS;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Shared state ──
let latestSignal: ArbitrageOpportunity | null = null;
let latestRecommendation: ExecutionRecommendation | null = null;
let portfolio: PortfolioSnapshot = {
  totalValueUSD: 0, tokenBalances: [], dailyPnL: 0, dailyPnLPercent: 0, circuitBreakerActive: false,
};

// ── Scout: CeDeFi Price Scanner ──
async function scanToken(token: TokenConfig): Promise<ArbitrageOpportunity | null> {
  try {
    // DEX price from X Layer via OnchainOS
    const dexResult = await getPrice('196', token.xlayerAddress, USDC_XLAYER, token.quoteAmount);
    await sleep(1000);

    // CEX price from OKX/Binance public API
    const cexPoint = await getCEXPrice(token);

    const dexPrice = dexResult.price;
    const cexPrice = cexPoint.price;
    if (cexPrice === 0 || dexPrice === 0) return null;

    const spreadPercent = Math.abs(cexPrice - dexPrice) / cexPrice * 100;
    const direction = dexPrice < cexPrice ? 'BUY_DEX_SELL_CEX' as const : 'BUY_CEX_SELL_DEX' as const;

    logInfo('scout', `${token.symbol}/USDC | DEX: $${dexPrice.toFixed(4)} | CEX(${cexPoint.source}): $${cexPrice.toFixed(4)} | Spread: ${spreadPercent.toFixed(4)}% | ${direction}`);

    const now = new Date();
    return {
      id: uuidv4(),
      token: token.symbol,
      tokenAddress: token.xlayerAddress,
      dexPrice: { source: 'xlayer-dex', price: dexPrice, timestamp: now.toISOString() },
      cexPrice: cexPoint,
      spreadPercent: parseFloat(spreadPercent.toFixed(4)),
      spreadAbsolute: parseFloat(Math.abs(cexPrice - dexPrice).toFixed(6)),
      direction,
      confidence: Math.min(1, spreadPercent / 1.0),
      timestamp: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    };
  } catch (err) {
    logError('scout', `Scan failed for ${token.symbol}`, err);
    return null;
  }
}

async function startScout(): Promise<void> {
  const wallet = new ethers.Wallet(config.SCOUT_PK);
  const app = express();
  app.use(express.json());

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

  app.listen(config.SCOUT_PORT, () => logInfo('scout', `Listening on port ${config.SCOUT_PORT}`));

  // Scan all tokens
  async function scan() {
    const results: ArbitrageOpportunity[] = [];
    for (const token of TRACKED_TOKENS) {
      const opp = await scanToken(token);
      if (opp) results.push(opp);
      await sleep(2000);
    }
    if (results.length > 0) {
      results.sort((a, b) => b.spreadPercent - a.spreadPercent);
      latestSignal = results[0];
      logInfo('scout', `Best: ${latestSignal.token} spread ${latestSignal.spreadPercent}% (${latestSignal.direction})`);
      eventBus.emitDashboardEvent({ type: 'signal_detected', data: latestSignal, timestamp: latestSignal.timestamp });
    } else {
      logInfo('scout', 'No arbitrage opportunities found');
    }
  }

  await scan();
  setInterval(() => { void scan(); }, config.SCOUT_POLL_INTERVAL * 6); // 30s
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
    if (!latestSignal) { logInfo('analyst', 'No signal available'); return; }
    try {
      const signal = await callPaidEndpoint<ArbitrageOpportunity>(
        wallet as any,
        `http://localhost:${config.SCOUT_PORT}/api/opportunity-signal`,
        'GET', 'analyst', 'scout'
      );
      if (!signal?.id) return;
      if (Date.now() > new Date(signal.expiresAt).getTime()) { logInfo('analyst', 'Signal expired'); return; }

      await sleep(1500);

      // Re-validate DEX price
      let priceImpact = 0.1;
      try {
        const quote = await getSwapQuote({
          chainIndex: '196', fromTokenAddress: signal.tokenAddress,
          toTokenAddress: USDC_XLAYER,
          amount: TRACKED_TOKENS.find(t => t.symbol === signal.token)?.quoteAmount ?? '1000000000000000000',
          slippagePercent: '0.5',
        });
        priceImpact = parseFloat(quote.priceImpactPercentage || '0.1');
      } catch { /* use defaults */ }

      const tradeAmountUSDC = config.MAX_TRADE_SIZE_USDC;
      const grossProfit = (signal.spreadPercent / 100) * tradeAmountUSDC;
      const slippageCost = (Math.max(priceImpact, 0.1) / 100) * tradeAmountUSDC;
      const netProfit = grossProfit - slippageCost - 0.05;
      const action = netProfit > 0.10 ? 'EXECUTE' as const : 'SKIP' as const;

      latestRecommendation = {
        id: uuidv4(),
        signalId: signal.id,
        action, confidence: signal.confidence,
        estimatedProfit: parseFloat(netProfit.toFixed(4)),
        estimatedSlippage: parseFloat(priceImpact.toFixed(4)),
        estimatedPriceImpact: priceImpact,
        suggestedAmount: TRACKED_TOKENS.find(t => t.symbol === signal.token)?.quoteAmount ?? '0',
        suggestedMinOutput: '0',
        reason: `CeDeFi arb: ${signal.token} spread ${signal.spreadPercent.toFixed(2)}%, net $${netProfit.toFixed(2)} (${signal.direction})`,
        timestamp: new Date().toISOString(),
      };

      logInfo('analyst', `${signal.token}: ${action} | spread ${signal.spreadPercent.toFixed(2)}% | net $${netProfit.toFixed(2)}`);
      eventBus.emitDashboardEvent({ type: 'analysis_complete', data: latestRecommendation, timestamp: latestRecommendation.timestamp });
    } catch (err) {
      logError('analyst', 'Analysis failed', err);
    }
  }

  await sleep(12000);
  await analyze();
  setInterval(() => { void analyze(); }, config.SCOUT_POLL_INTERVAL * 7); // 35s
}

// ── Executor ──
async function startExecutor(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.get('/api/trade-result', (_req, res) => res.status(204).json({ message: 'No result' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', agentId: 'executor' }));
  app.listen(config.EXECUTOR_PORT, () => logInfo('executor', `Listening on port ${config.EXECUTOR_PORT}`));
}

// ── Treasury ──
async function startTreasury(): Promise<void> {
  const provider = new ethers.JsonRpcProvider(config.XLAYER_RPC);
  const wallet = new ethers.Wallet(config.TREASURY_PK, provider);
  const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

  const app = express();
  app.use(express.json());
  app.post('/api/risk-check', (_req, res) => {
    res.json({ approved: !portfolio.circuitBreakerActive, maxTradeSize: '1000000' });
  });
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

      const nativeValue = nativeHuman * nativePrice;
      const totalValue = nativeValue + usdcBal;
      portfolio = {
        totalValueUSD: parseFloat(totalValue.toFixed(4)),
        tokenBalances: [
          { token: 'OKB', balance: nativeHuman.toFixed(6), valueUSD: parseFloat(nativeValue.toFixed(4)) },
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

// ── Start all ──
export async function startAllAgents(): Promise<void> {
  logInfo('orchestrator', 'Starting 4 agents (CeDeFi arbitrage mode)...');
  await startScout();
  await startExecutor();
  await startTreasury();
  await startAnalyst();
  logInfo('orchestrator', 'All 4 agents started');

  for (const agent of ['scout', 'analyst', 'executor', 'treasury']) {
    eventBus.emitDashboardEvent({
      type: 'agent_registered',
      data: { agentId: agent, role: agent, endpoint: `http://localhost:${(config as any)[`${agent.toUpperCase()}_PORT`]}` },
      timestamp: new Date().toISOString(),
    });
  }
}
