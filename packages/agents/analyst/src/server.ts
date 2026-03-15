import express, { Express } from 'express';
import { createX402Middleware } from '@agenthedge/shared';
import type { X402RouteConfig, ExecutionRecommendation } from '@agenthedge/shared';

export function createAnalystServer(
  getLatestRecommendation: () => ExecutionRecommendation | null,
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
    'GET /api/execution-recommendation': {
      description: 'Full cost analysis and execution recommendation',
      priceUSDC: 0.03,
      receiverAddress,
      receiverAgentId: 'analyst',
    },
  };
  app.use(createX402Middleware(routes));

  app.get('/api/execution-recommendation', (_req, res) => {
    const rec = getLatestRecommendation();
    if (!rec) { res.status(204).json({ message: 'No recommendation' }); return; }
    res.json(rec);
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agentId: 'analyst' });
  });

  return app;
}
