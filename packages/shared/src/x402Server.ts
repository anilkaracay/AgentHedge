import { ethers } from 'ethers';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from './config.js';
import { logInfo, logError } from './logger.js';
import { eventBus } from './eventBus.js';
import type { X402PaymentEvent } from './types.js';

const NETWORK = 'eip155:196';

export interface X402RouteConfig {
  description: string;
  priceUSDC: number; // human units, e.g. 0.02
  receiverAddress: string; // wallet address of the agent receiving payment
  receiverAgentId: string; // agent ID for event logging
}

export function createX402Middleware(
  routes: Record<string, X402RouteConfig>
): RequestHandler {
  // Build lookup: "GET /api/foo" → config
  const routeMap = new Map<string, X402RouteConfig>();
  for (const [route, cfg] of Object.entries(routes)) {
    routeMap.set(route.toUpperCase(), cfg);
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.method.toUpperCase()} ${req.path}`;
    const routeCfg = routeMap.get(key);

    // Not a protected route — pass through
    if (!routeCfg) {
      next();
      return;
    }

    const amountBaseUnits = Math.round(routeCfg.priceUSDC * 1_000_000).toString();
    const paymentHeader = req.headers['x-payment'] as string | undefined
      ?? req.headers['payment'] as string | undefined;

    if (!paymentHeader) {
      res.status(402).json({
        paymentRequired: true,
        accepts: [{
          network: NETWORK,
          token: config.USDC_ADDRESS,
          maxAmountRequired: amountBaseUnits,
          receiver: routeCfg.receiverAddress,
        }],
        description: routeCfg.description,
      });
      return;
    }

    // Verify payment
    try {
      const decoded = Buffer.from(paymentHeader, 'base64').toString();
      const paymentData = JSON.parse(decoded) as {
        network: string;
        token: string;
        amount: string;
        receiver: string;
        timestamp: number;
        signature: string;
        payer?: string;
      };

      // Validate payment fields
      if (paymentData.network !== NETWORK) {
        res.status(402).json({ error: 'Invalid network' });
        return;
      }

      if (BigInt(paymentData.amount) < BigInt(amountBaseUnits)) {
        res.status(402).json({ error: 'Insufficient payment amount' });
        return;
      }

      // Verify signature — recover signer from the signed message
      const { signature, ...payloadWithoutSig } = paymentData;
      const message = JSON.stringify(payloadWithoutSig);
      const recoveredAddress = ethers.verifyMessage(message, signature);

      // Verify payment is not stale (within 60s)
      const ageMs = Date.now() - paymentData.timestamp;
      if (ageMs > 60_000) {
        res.status(402).json({ error: 'Payment expired' });
        return;
      }

      logInfo('x402-server', `Payment verified from ${recoveredAddress}`, {
        amount: routeCfg.priceUSDC,
        route: key,
      });

      // Emit payment event
      const paymentEvent: X402PaymentEvent = {
        from: paymentData.payer ?? recoveredAddress,
        to: routeCfg.receiverAgentId,
        amount: routeCfg.priceUSDC,
        purpose: routeCfg.description,
      };
      eventBus.emitDashboardEvent({
        type: 'x402_payment',
        data: paymentEvent,
        timestamp: new Date().toISOString(),
      });

      next();
    } catch (err) {
      logError('x402-server', 'Payment verification failed', err);
      res.status(402).json({ error: 'Invalid payment' });
    }
  };
}
