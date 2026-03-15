import express, { Express } from 'express';
import type { TradeResult } from '@agenthedge/shared';

export function createExecutorServer(
  getLatestResult: () => TradeResult | null
): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/trade-result', (_req, res) => {
    const result = getLatestResult();
    if (!result) {
      res.status(204).json({ message: 'No trade result' });
      return;
    }
    res.json(result);
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agentId: 'executor' });
  });

  return app;
}
