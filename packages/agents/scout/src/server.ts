import express, { Express } from 'express';
import { createX402Middleware } from '@agenthedge/shared';
import type { X402RouteConfig } from '@agenthedge/shared';
import type { OpportunitySignal } from '@agenthedge/shared';

export function createScoutServer(
  getLatestSignal: () => OpportunitySignal | null,
  receiverAddress: string
): Express {
  const app = express();
  app.use(express.json());

  const routes: Record<string, X402RouteConfig> = {
    'GET /api/opportunity-signal': {
      description: 'Latest CeDeFi arbitrage opportunity signal',
      priceUSDC: 0.02,
      receiverAddress,
      receiverAgentId: 'scout',
    },
  };
  app.use(createX402Middleware(routes));

  app.get('/api/opportunity-signal', (_req, res) => {
    const signal = getLatestSignal();
    if (!signal) {
      res.status(204).json({ message: 'No opportunity' });
      return;
    }
    res.json(signal);
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agentId: 'scout' });
  });

  return app;
}
