/**
 * Live Demo — runs 5 arbitrage cycles with formatted terminal output.
 * Designed for demo video capture.
 * Usage: npx tsx scripts/liveDemo.ts
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import {
  scanAllVenues, estimateTradeCosts, calculateMinProfitableSize,
  formatProfitReport, TRACKED_TOKENS, config, eventBus,
} from '@agenthedge/shared';
import type { DashboardEvent } from '@agenthedge/shared';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', D = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const events: DashboardEvent[] = [];
eventBus.on('dashboard_event', (e: DashboardEvent) => events.push(e));

const stats = { cycles: 0, execute: 0, monitor: 0, skip: 0, x402Payments: 0, totalScans: 0 };

async function runCycle(n: number) {
  const start = Date.now();
  console.log(`\n${C}${B}${'='.repeat(70)}${X}`);
  console.log(`${C}${B}  CYCLE ${n}/5${X}`);
  console.log(`${C}${B}${'='.repeat(70)}${X}\n`);

  for (const token of TRACKED_TOKENS) {
    console.log(`${Y}  SCOUT scanning ${token.symbol}/USDT across 8 venues...${X}\n`);

    try {
      const scan = await scanAllVenues(token);
      stats.totalScans++;

      // Print venue table
      console.log(`  ${'VENUE'.padEnd(14)} ${'TYPE'.padEnd(6)} ${'PRICE'.padEnd(14)} ${'LATENCY'.padEnd(10)} NOTE`);
      console.log(`  ${'-'.repeat(60)}`);
      for (const v of scan.venues) {
        const isCheapest = v.venue === scan.cheapest.venue;
        const isExpensive = v.venue === scan.mostExpensive.venue;
        const note = isCheapest ? `${G}<< BUY HERE${X}` : isExpensive ? `${R}<< SELL HERE${X}` : '';
        const priceColor = isCheapest ? G : isExpensive ? R : '';
        console.log(`  ${v.venue.padEnd(14)} ${v.venueType.padEnd(6)} ${priceColor}$${v.price.toFixed(4).padEnd(13)}${X} ${String(v.latency + 'ms').padEnd(10)} ${note}`);
      }

      console.log(`\n  ${B}Spread: $${scan.spreadAbsolute.toFixed(4)} (${scan.spreadPercent.toFixed(4)}%)${X}`);
      console.log(`  ${D}${scan.venues.length} venues responded in ${scan.scanDuration}ms${X}\n`);

      // Analyst cost analysis
      console.log(`${Y}  ANALYST evaluating ${token.symbol}...${X}\n`);
      stats.x402Payments++; // scout signal purchase

      const opp = {
        id: `demo-${n}-${token.symbol}`, token: token.symbol, tokenAddress: token.xlayerAddress,
        buyVenue: scan.cheapest, sellVenue: scan.mostExpensive, allVenues: scan.venues,
        spreadPercent: scan.spreadPercent, spreadAbsolute: scan.spreadAbsolute,
        venuesScanned: 8, venuesResponded: scan.venues.length, scanDuration: scan.scanDuration,
        confidence: Math.min(1, scan.spreadPercent / 1.0),
        timestamp: new Date().toISOString(), expiresAt: new Date(Date.now() + 30000).toISOString(),
      };

      const sizing = calculateMinProfitableSize(opp);
      const tradeSize = Math.min(sizing.optimalSizeUSD, config.MAX_TRADE_SIZE_USDC);
      const costs = estimateTradeCosts(opp, tradeSize);

      console.log(`  ${formatProfitReport(costs, scan.cheapest.venue, scan.mostExpensive.venue, token.symbol).split('\n').map(l => '  ' + l).join('\n')}\n`);

      const hasSpread = scan.spreadPercent > 0.05;
      const action = costs.profitable ? 'EXECUTE' : hasSpread ? 'MONITOR' : 'SKIP';

      if (action === 'EXECUTE') {
        console.log(`  ${G}${B}>> EXECUTE${X} ${G}Net profit: $${costs.netProfit.toFixed(3)}${X}\n`);
        console.log(`  ${G}EXECUTOR: BUY ${costs.buyAmount.toFixed(4)} ${token.symbol} on ${scan.cheapest.venue} @ $${scan.cheapest.price.toFixed(2)}${X}`);
        console.log(`  ${G}EXECUTOR: SELL on ${scan.mostExpensive.venue} @ $${scan.mostExpensive.price.toFixed(2)}${X}\n`);
        stats.execute++;
      } else if (action === 'MONITOR') {
        const coverage = costs.grossProfit > 0 ? (costs.grossProfit / costs.totalCosts * 100).toFixed(0) : '0';
        console.log(`  ${Y}${B}>> MONITOR${X} ${Y}Spread covers ${coverage}% of costs. Watching for wider spread.${X}`);
        if (sizing.minSizeUSD !== Infinity) {
          console.log(`  ${D}Profitable at trade size > $${sizing.minSizeUSD.toFixed(0)}${X}`);
        } else {
          console.log(`  ${D}Variable costs exceed spread. Needs wider spread to be viable.${X}`);
        }
        console.log('');
        stats.monitor++;
      } else {
        console.log(`  ${D}>> SKIP — no meaningful spread${X}\n`);
        stats.skip++;
      }
    } catch (err) {
      console.log(`  ${R}Scan failed: ${(err as Error).message.slice(0, 60)}${X}\n`);
    }

    await sleep(3000);
  }

  stats.cycles++;
  console.log(`  ${D}Cycle ${n} completed in ${Date.now() - start}ms${X}`);
}

async function main() {
  console.log(`\n${C}${B}${'='.repeat(70)}${X}`);
  console.log(`${C}${B}  AgentHedge — Live Multi-Venue Arbitrage Demo${X}`);
  console.log(`${C}${B}${'='.repeat(70)}${X}`);
  console.log(`\n  ${D}Scanning 8 exchanges simultaneously for CeDeFi arbitrage${X}`);
  console.log(`  ${D}Venues: OKX, Binance, Gate.io, Bybit, KuCoin, MEXC, HTX, X Layer DEX${X}`);
  console.log(`  ${D}Tokens: ${TRACKED_TOKENS.map(t => t.symbol).join(', ')}${X}`);
  console.log(`  ${D}X Layer Registry: ${config.REGISTRY_ADDRESS}${X}\n`);

  for (let i = 1; i <= 5; i++) {
    await runCycle(i);
    if (i < 5) {
      console.log(`\n  ${D}Next cycle in 5 seconds...${X}`);
      await sleep(5000);
    }
  }

  // Session summary
  console.log(`\n${C}${B}${'='.repeat(70)}${X}`);
  console.log(`${C}${B}  Session Summary${X}`);
  console.log(`${C}${B}${'='.repeat(70)}${X}\n`);
  console.log(`  Cycles completed:    ${stats.cycles}`);
  console.log(`  Total venue scans:   ${stats.totalScans}`);
  console.log(`  EXECUTE decisions:   ${G}${stats.execute}${X}`);
  console.log(`  MONITOR decisions:   ${Y}${stats.monitor}${X}`);
  console.log(`  SKIP decisions:      ${D}${stats.skip}${X}`);
  console.log(`  x402 payments:       ${stats.x402Payments}`);
  console.log(`  Events emitted:      ${events.length}`);
  console.log(`\n  ${D}AgentHedge is honest: it only executes when the math works.${X}`);
  console.log(`  ${D}MONITOR means opportunity exists but costs currently exceed profit.${X}`);
  console.log(`  ${D}In production with $5,000+ capital and volatility spikes, spreads widen.${X}\n`);
}

main().catch(console.error);
