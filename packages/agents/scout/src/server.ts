import express, { Express } from 'express';
import { createX402Middleware } from '@agenthedge/shared';
import type { X402RouteConfig, OpportunitySignal } from '@agenthedge/shared';

const SUPPORTED_VENUES = [
  { name: 'okx', type: 'cex', status: 'active' },
  { name: 'binance', type: 'cex', status: 'active' },
  { name: 'gateio', type: 'cex', status: 'active' },
  { name: 'bybit', type: 'cex', status: 'active' },
  { name: 'kucoin', type: 'cex', status: 'active' },
  { name: 'mexc', type: 'cex', status: 'active' },
  { name: 'htx', type: 'cex', status: 'active' },
  { name: 'xlayer-dex', type: 'dex', status: 'active' },
];

export function createScoutServer(
  getLatestSignal: () => OpportunitySignal | null,
  receiverAddress: string
): Express {
  const app = express();
  app.use(express.json());

  // CORS for external x402 consumers
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Payment');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (_req.method === 'OPTIONS') { res.sendStatus(200); return; }
    next();
  });

  const routes: Record<string, X402RouteConfig> = {
    'GET /api/opportunity-signal': {
      description: 'Multi-venue CeDeFi arbitrage signal',
      priceUSDC: 0.02,
      receiverAddress,
      receiverAgentId: 'scout',
    },
  };
  app.use(createX402Middleware(routes));

  app.get('/api/opportunity-signal', (_req, res) => {
    const signal = getLatestSignal();
    if (!signal) { res.status(204).json({ message: 'No opportunity' }); return; }
    res.json(signal);
  });

  app.get('/api/venues', (_req, res) => {
    res.json({ venues: SUPPORTED_VENUES, count: SUPPORTED_VENUES.length });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agentId: 'scout', venues: SUPPORTED_VENUES.length });
  });

  return app;
}
