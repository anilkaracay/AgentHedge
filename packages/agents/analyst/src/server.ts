import express, { Express } from 'express';
import { createX402Middleware } from '@agenthedge/shared';
import type { X402RouteConfig, ExecutionRecommendation } from '@agenthedge/shared';

export function createAnalystServer(
  getLatestRecommendation: () => ExecutionRecommendation | null,
  receiverAddress: string
): Express {
  const app = express();
  app.use(express.json());

  const routes: Record<string, X402RouteConfig> = {
    'GET /api/execution-recommendation': {
      description: 'Latest execution recommendation from profitability analysis',
      priceUSDC: 0.03,
      receiverAddress,
      receiverAgentId: 'analyst',
    },
  };
  app.use(createX402Middleware(routes));

  app.get('/api/execution-recommendation', (_req, res) => {
    const rec = getLatestRecommendation();
    if (!rec) {
      res.status(204).json({ message: 'No recommendation' });
      return;
    }
    res.json(rec);
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agentId: 'analyst' });
  });

  return app;
}
