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
  getIndexPrice, getCandles, getRecentTrades,
  getTotalValue, getTokenBalances, getGasPrice, getPortfolioOverview,
  estimateTradeCosts, calculateMinProfitableSize, formatProfitReport,
  isDemoMode, getDemoPortfolio, updateDemoBalance, maybeInjectVolatilitySpike, FEE_STRUCTURE, findOptimalTradeSize,
  TRACKED_TOKENS, USDC_XLAYER,
  createX402Middleware, callPaidEndpoint,
  attestCycleOnChain,
  executeFullPaymentCycle, executeMonitorPaymentCycle, logAllAgentBalances,
} from '@agenthedge/shared';
import type {
  ArbitrageOpportunity, ExecutionRecommendation,
  PortfolioSnapshot, X402RouteConfig,
  AgentKeys, AgentAddresses,
} from '@agenthedge/shared';

const NATIVE = config.NATIVE_TOKEN_ADDRESS;
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Real x402 payment config ──
const isRealPayments = () => process.env.X402_REAL_PAYMENTS === 'true';

const agentKeys: AgentKeys = {
  scout: config.SCOUT_PK,
  analyst: config.ANALYST_PK,
  executor: config.EXECUTOR_PK,
  treasury: config.TREASURY_PK,
};

const agentAddresses: AgentAddresses = {
  scout: new ethers.Wallet(config.SCOUT_PK).address,
  analyst: new ethers.Wallet(config.ANALYST_PK).address,
  executor: new ethers.Wallet(config.EXECUTOR_PK).address,
  treasury: new ethers.Wallet(config.TREASURY_PK).address,
};

let latestSignal: ArbitrageOpportunity | null = null;
const demoTradeHistory: any[] = [];
const demoPaymentHistory: any[] = [];
const attestationHistory: { cycleId: number; txHash: string; spreadBps: number; decision: string; timestamp: string }[] = [];

// Attestation throttling: every EXECUTE + every Nth MONITOR
const ATTEST_EVERY_N_MONITOR = 5;
let monitorCount = 0;
let attestCycleId = 0;

// Use scout wallet for attestation (registered agent)
const scoutWallet = new ethers.Wallet(config.SCOUT_PK);

async function maybeAttestCycle(
  decision: 'EXECUTE' | 'MONITOR' | 'SKIP',
  signal: ArbitrageOpportunity | null,
  estimatedProfitCents: number
) {
  if (!signal) return;

  // Throttle: always attest EXECUTE, every Nth MONITOR, skip SKIP
  if (decision === 'SKIP') return;
  if (decision === 'MONITOR') {
    monitorCount++;
    if (monitorCount % ATTEST_EVERY_N_MONITOR !== 0) return;
  }

  attestCycleId++;
  const spreadBps = Math.round(signal.spreadPercent * 100);

  logInfo('attestation', `Attesting cycle #${attestCycleId} (${decision}, ${spreadBps}bps) on-chain...`);

  const result = await attestCycleOnChain(scoutWallet, {
    cycleId: attestCycleId,
    bestBidPrice: signal.buyVenue.price,
    bestAskPrice: signal.sellVenue.price,
    spreadBps,
    venueCount: signal.venuesResponded,
    buyVenue: signal.buyVenue.venue,
    sellVenue: signal.sellVenue.venue,
    decision,
    estimatedProfitCents,
  });

  if (result) {
    const entry = {
      cycleId: attestCycleId,
      txHash: result.txHash,
      spreadBps,
      decision,
      timestamp: new Date().toISOString(),
    };
    attestationHistory.push(entry);
    logInfo('attestation', `Cycle #${attestCycleId} attested: tx ${result.txHash}`);

    eventBus.emitDashboardEvent({
      type: 'chain_attestation',
      data: entry,
      timestamp: entry.timestamp,
    });
  } else {
    logInfo('attestation', `Cycle #${attestCycleId} attestation failed (non-critical)`);
  }
}

export function getAttestationHistory() { return attestationHistory; }

export function getDemoHistory() { return { trades: demoTradeHistory, payments: demoPaymentHistory, attestations: attestationHistory }; }
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
        let scan = await scanAllVenues(token);
        // Demo mode: occasionally inject volatility spikes for realistic demo
        scan = maybeInjectVolatilitySpike(scan);
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

      const tokenCfg = TRACKED_TOKENS.find(t => t.symbol === signal.token);
      if (!tokenCfg) return;

      // In demo mode: use the spiked signal directly (don't re-scan which loses the spike)
      // In real mode: re-scan for fresh prices
      let freshScan = { cheapest: signal.buyVenue, mostExpensive: signal.sellVenue, venues: signal.allVenues, spreadPercent: signal.spreadPercent, spreadAbsolute: signal.spreadAbsolute, scanDuration: 0, token: signal.token, timestamp: signal.timestamp };
      if (!isDemoMode()) {
        const realScan = await scanAllVenues(tokenCfg);
        freshScan = realScan;
      }

      const freshOpp = { ...signal, buyVenue: freshScan.cheapest, sellVenue: freshScan.mostExpensive, allVenues: freshScan.venues, spreadPercent: freshScan.spreadPercent };

      // Trade size optimization
      const sizing = calculateMinProfitableSize(freshOpp);
      const tradeSize = isDemoMode()
        ? parseFloat(process.env.DEMO_TRADE_SIZE ?? '10000')
        : Math.min(sizing.optimalSizeUSD, config.MAX_TRADE_SIZE_USDC);
      logInfo('analyst', `Sizing: min $${sizing.minSizeUSD} | optimal $${sizing.optimalSizeUSD} | using $${tradeSize}`);

      // Full cost breakdown with context-dependent transfer fees
      const costs = estimateTradeCosts(freshOpp, tradeSize);
      const report = formatProfitReport(costs, freshScan.cheapest.venue, freshScan.mostExpensive.venue, signal.token);
      logInfo('analyst', `\n${report}`);

      const hasSpread = freshScan.spreadPercent > 0.05;
      const action: 'EXECUTE' | 'MONITOR' | 'SKIP' = costs.profitable ? 'EXECUTE' : hasSpread ? 'MONITOR' : 'SKIP';

      latestRecommendation = {
        id: uuidv4(),
        signalId: signal.id,
        action,
        confidence: signal.confidence,
        estimatedProfit: costs.netProfit,
        estimatedSlippage: costs.buySlippage + costs.sellSlippage,
        estimatedPriceImpact: costs.buyExchangeFee + costs.sellExchangeFee,
        suggestedAmount: tokenCfg.quoteAmount,
        suggestedMinOutput: '0',
        reason: `${freshScan.cheapest.venue} $${freshScan.cheapest.price.toFixed(2)} -> ${freshScan.mostExpensive.venue} $${freshScan.mostExpensive.price.toFixed(2)} | net $${costs.netProfit.toFixed(3)} | transfer: ${costs.transferNote}`,
        timestamp: new Date().toISOString(),
      };

      logInfo('analyst', `${signal.token}: ${action} | net $${costs.netProfit.toFixed(3)} (${costs.netProfitPercent.toFixed(2)}%) | transfer: ${costs.transferNote}`);
      eventBus.emitDashboardEvent({ type: 'analysis_complete', data: latestRecommendation, timestamp: latestRecommendation.timestamp });

      // On-chain attestation (throttled: every EXECUTE + every 5th MONITOR)
      void maybeAttestCycle(action, freshOpp, Math.round(costs.netProfit * 100));

      // Demo mode: execute ALL profitable venue pairs with dynamic sizing
      if (action === 'EXECUTE' && isDemoMode()) {
        const now = new Date().toISOString();
        const venues = freshScan.venues;

        // Probe DEX liquidity to find optimal trade size (REAL API call)
        logInfo('executor', `[DEMO] Probing liquidity for ${signal.token} on X Layer DEX...`);
        let optimalSize;
        try {
          optimalSize = await findOptimalTradeSize(freshOpp, 50000);
          logInfo('executor', `[DEMO] ${optimalSize.reason}`);
        } catch {
          optimalSize = { sizeUSD: 10000, sizeToken: 10000 / freshScan.cheapest.price, impact: 0, reason: 'Fallback size', probes: [] };
        }
        const tradeSize = optimalSize.sizeUSD;
        let totalSessionProfit = 0;
        let tradeCount = 0;

        // x402 payments — real or simulated
        // (Real payments happen AFTER trades complete, simulated happen now)
        if (!isRealPayments()) {
          const p1 = { from: 'analyst', to: 'scout', amount: 0.02, purpose: 'signal_purchase', timestamp: now };
          const p2 = { from: 'executor', to: 'analyst', amount: 0.03, purpose: 'analysis_purchase', timestamp: now };
          demoPaymentHistory.push(p1, p2);
          eventBus.emitDashboardEvent({ type: 'x402_payment', data: p1, timestamp: now });
          eventBus.emitDashboardEvent({ type: 'x402_payment', data: p2, timestamp: now });
        }

        // Find ALL profitable pairs: every buyVenue cheaper than every sellVenue
        for (let i = 0; i < venues.length; i++) {
          for (let j = i + 1; j < venues.length; j++) {
            const buyV = venues[i];  // cheaper (sorted ascending)
            const sellV = venues[j]; // more expensive
            const pairSpread = sellV.price - buyV.price;
            const pairSpreadPct = (pairSpread / sellV.price) * 100;

            // Calculate costs for this pair
            const buyFeeRate = FEE_STRUCTURE.takerFees[buyV.venue] ?? 0.002;
            const sellFeeRate = FEE_STRUCTURE.takerFees[sellV.venue] ?? 0.002;
            const okbAmount = tradeSize / buyV.price;
            const grossProfit = pairSpread * okbAmount;
            const buyCost = tradeSize * buyFeeRate;
            const sellCost = (tradeSize + grossProfit) * sellFeeRate;
            const sellSlip = sellV.venueType === 'dex' ? tradeSize * 0.001 : 0;
            const pairNetProfit = grossProfit - buyCost - sellCost - sellSlip - 0.01; // tiny agent fee share

            if (pairNetProfit <= 0) continue; // skip unprofitable pairs

            tradeCount++;
            totalSessionProfit += pairNetProfit;
            updateDemoBalance(buyV.venue, sellV.venue, okbAmount, tradeSize, pairNetProfit);

            logInfo('executor', `[DEMO] #${tradeCount} BUY ${okbAmount.toFixed(1)} OKB @ ${buyV.venue} $${buyV.price.toFixed(2)} -> SELL @ ${sellV.venue} $${sellV.price.toFixed(2)} | net +$${pairNetProfit.toFixed(2)}`);

            const tradeEvent = {
              tradeId: `demo-${Date.now()}-${tradeCount}`,
              token: signal.token,
              buyVenue: { venue: buyV.venue, price: buyV.price, type: buyV.venueType },
              sellVenue: { venue: sellV.venue, price: sellV.price, type: sellV.venueType },
              size: parseFloat(okbAmount.toFixed(4)),
              sizeUSD: tradeSize,
              spreadPercent: parseFloat(pairSpreadPct.toFixed(4)),
              grossProfit: parseFloat(grossProfit.toFixed(4)),
              buyFee: parseFloat(buyCost.toFixed(4)),
              sellFee: parseFloat((sellCost + sellSlip).toFixed(4)),
              agentFees: 0.05,
              transferCost: 0,
              totalCosts: parseFloat((buyCost + sellCost + sellSlip + 0.01).toFixed(4)),
              netProfit: parseFloat(pairNetProfit.toFixed(4)),
              allVenues: venues.map(v => ({ venue: v.venue, price: v.price, type: v.venueType })),
              status: 'FILLED' as const,
              timestamp: now,
              // Legacy compat fields
              id: uuidv4(), recommendationId: latestRecommendation.id,
              fromToken: signal.token, toToken: 'USDC',
              amountIn: okbAmount.toFixed(4), amountOut: (tradeSize + pairNetProfit).toFixed(2),
              realizedProfit: parseFloat(pairNetProfit.toFixed(4)),
            };

            // Store in history
            demoTradeHistory.push(tradeEvent);
            demoPaymentHistory.push(
              { from: 'treasury', to: 'executor', amount: parseFloat((pairNetProfit * 0.10).toFixed(4)), purpose: `executor_fee (${buyV.venue}->${sellV.venue})`, timestamp: now }
            );

            eventBus.emitDashboardEvent({ type: 'trade_executed', data: tradeEvent, timestamp: now });
            if (!isRealPayments()) {
              eventBus.emitDashboardEvent({ type: 'x402_payment', data: { from: 'treasury', to: 'executor', amount: parseFloat((pairNetProfit * 0.10).toFixed(4)), purpose: `executor_fee (${buyV.venue}->${sellV.venue})` }, timestamp: now });
            }
          }
        }

        if (tradeCount > 0) {
          logInfo('executor', `[DEMO] Cycle: ${tradeCount} trades across ${venues.length} venues, cycle profit +$${totalSessionProfit.toFixed(2)}`);

          // Profit distribution summary
          eventBus.emitDashboardEvent({
            type: 'profit_distributed',
            data: { tradeId: latestRecommendation.id, totalProfit: totalSessionProfit, executorFee: totalSessionProfit * 0.10, treasuryFee: totalSessionProfit * 0.05, poolReturn: totalSessionProfit * 0.85, timestamp: now },
            timestamp: now,
          });

          // Update portfolio
          const dp = getDemoPortfolio();
          eventBus.emitDashboardEvent({
            type: 'portfolio_update',
            data: {
              totalValueUSD: dp.totalCapital, dailyPnL: dp.sessionPnL,
              dailyPnLPercent: (dp.sessionPnL / 800000) * 100,
              tokenBalances: [
                { token: 'OKB', balance: dp.totalOKB.toFixed(2), valueUSD: dp.totalOKB * venues[venues.length - 1].price },
                { token: 'USDT', balance: dp.totalUSDT.toFixed(2), valueUSD: dp.totalUSDT },
              ],
              circuitBreakerActive: false,
            },
            timestamp: now,
          });

          logInfo('executor', `[DEMO] Session total: $${dp.sessionPnL.toFixed(2)} (${dp.tradeCount} trades, ${dp.profitableCount} profitable)`);

          // Real x402 payments — full 5-payment closed-loop cycle
          if (isRealPayments()) {
            const executorFee = Math.min(totalSessionProfit * 0.10, 0.10);
            void executeFullPaymentCycle(agentKeys, agentAddresses, executorFee).catch(err => {
              logError('x402', 'Real payment cycle failed (non-critical)', err);
            });
          }
        }
      }

      // MONITOR cycles — lightweight real payment (signal purchase only)
      if (action === 'MONITOR' && isRealPayments()) {
        void executeMonitorPaymentCycle(agentKeys, agentAddresses).catch(err => {
          logError('x402', 'Monitor payment cycle failed (non-critical)', err);
        });
      }
    } catch (err) {
      logError('analyst', 'Analysis failed', err);
    }
  }

  const analyzeDelay = isDemoMode() ? 8000 : 15000;
  const analyzeInterval = isDemoMode() ? config.SCOUT_POLL_INTERVAL * 4 : config.SCOUT_POLL_INTERVAL * 7;
  await sleep(analyzeDelay);
  await analyze();
  setInterval(() => { void analyze(); }, analyzeInterval);
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
  const wallet = new ethers.Wallet(config.TREASURY_PK);

  const app = express();
  app.use(express.json());
  app.post('/api/risk-check', (_req, res) => res.json({ approved: !portfolio.circuitBreakerActive, maxTradeSize: '1000000' }));
  app.get('/api/portfolio', (_req, res) => res.json(portfolio));
  app.post('/api/trade-result', (_req, res) => res.json({ received: true }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', agentId: 'treasury' }));
  app.listen(config.TREASURY_PORT, () => logInfo('treasury', `Listening on port ${config.TREASURY_PORT}`));

  async function refreshPortfolio() {
    try {
      if (isDemoMode()) {
        // Demo mode: show simulated $800K portfolio
        const dp = getDemoPortfolio();
        portfolio = {
          totalValueUSD: dp.totalCapital,
          tokenBalances: [
            { token: 'OKB', balance: dp.totalOKB.toFixed(2), valueUSD: dp.totalOKB * 96 },
            { token: 'USDT', balance: dp.totalUSDT.toFixed(2), valueUSD: dp.totalUSDT },
          ],
          dailyPnL: dp.sessionPnL,
          dailyPnLPercent: dp.totalCapital > 0 ? (dp.sessionPnL / dp.totalCapital) * 100 : 0,
          circuitBreakerActive: false,
        };
        logInfo('treasury', `[DEMO] Portfolio: $${dp.totalCapital.toFixed(0)} | Session P&L: $${dp.sessionPnL.toFixed(2)} | ${dp.tradeCount} trades`);
      } else {
        // Real mode: OnchainOS Balance API
        const totalResult = await getTotalValue('196', wallet.address);
        const balances = await getTokenBalances('196', wallet.address);

        const tokenBalances = balances.map(b => ({
          token: b.symbol,
          balance: b.balance,
          valueUSD: parseFloat(b.balance) * parseFloat(b.tokenPrice),
        }));

        let pnlData = { realizedPnlUsd: '0' };
        try { pnlData = await getPortfolioOverview('196', wallet.address); } catch { /* skip */ }

        portfolio = {
          totalValueUSD: parseFloat(totalResult.totalValue.toFixed(4)),
          tokenBalances,
          dailyPnL: parseFloat(pnlData.realizedPnlUsd || '0'),
          dailyPnLPercent: 0,
          circuitBreakerActive: false,
        };

        logInfo('treasury', `Portfolio: $${totalResult.totalValue.toFixed(2)} (${balances.length} tokens via OnchainOS Balance API)`);
      }
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

  // Log x402 payment mode
  if (isRealPayments()) {
    logInfo('x402', '=== REAL ON-CHAIN x402 PAYMENTS ENABLED ===');
    try {
      await logAllAgentBalances(agentAddresses as unknown as Record<string, string>);
    } catch (err) {
      logError('x402', 'Failed to check balances', err);
    }
  } else {
    logInfo('x402', 'Simulated x402 payments (set X402_REAL_PAYMENTS=true for on-chain)');
  }

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
