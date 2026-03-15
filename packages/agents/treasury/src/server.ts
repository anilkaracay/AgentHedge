import express, { Express } from 'express';
import type { PortfolioSnapshot, RiskApproval } from '@agenthedge/shared';
import { checkRiskLimits } from './riskManager.js';

export function createTreasuryServer(
  getPortfolio: () => PortfolioSnapshot
): Express {
  const app = express();
  app.use(express.json());

  app.post('/api/risk-check', (req, res) => {
    const { amount } = req.body as { amount?: string };
    const portfolio = getPortfolio();
    const approval: RiskApproval = checkRiskLimits(amount || '0', portfolio);
    res.json(approval);
  });

  app.post('/api/trade-result', (req, res) => {
    // Executor reports trade results here; handled in index.ts via event
    res.json({ received: true });
  });

  app.get('/api/portfolio', (_req, res) => {
    res.json(getPortfolio());
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agentId: 'treasury' });
  });

  return app;
}
