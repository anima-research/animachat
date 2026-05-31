import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Database } from '../database/index.js';
import { AuthRequest } from '../middleware/auth.js';
import {
  BillingService,
  USD_PER_CREDIT,
  getCreditMarkup,
  isBillingEnabled,
  MIN_CREDITS,
  MAX_CREDITS,
} from '../services/billing.js';

/** Suggested purchase amounts (in whole credits) shown as quick-pick buttons. */
const PRESET_CREDITS = [5, 10, 25, 50];

/**
 * Authenticated billing routes: GET /config and POST /checkout.
 *
 * The Stripe webhook is NOT here — it must receive the raw request body and be
 * unauthenticated, so it is mounted separately in index.ts (see
 * createBillingWebhookHandler) BEFORE the global express.json() parser.
 */
export function createBillingRouter(db: Database): Router {
  const router = Router();

  // Construct the Stripe-backed service lazily so the app boots without keys.
  let service: BillingService | null = null;
  const getService = (): BillingService => (service ??= new BillingService(db));

  // Non-secret config for the Buy Credits UI. Mounted behind auth, but returns
  // nothing sensitive — just the pricing knobs the frontend needs to render.
  router.get('/config', (_req: Request, res: Response) => {
    res.json({
      enabled: isBillingEnabled(),
      usdPerCredit: USD_PER_CREDIT,
      creditMarkup: getCreditMarkup(),
      minCredits: MIN_CREDITS,
      maxCredits: MAX_CREDITS,
      presetsCredits: PRESET_CREDITS,
    });
  });

  // Create a Stripe Checkout session for a whole-credit purchase.
  router.post('/checkout', async (req: AuthRequest, res: Response) => {
    try {
      if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
      if (!isBillingEnabled()) return res.status(503).json({ error: 'Billing is not enabled' });

      const { credits } = z
        .object({ credits: z.number().int().min(MIN_CREDITS).max(MAX_CREDITS) })
        .parse(req.body);

      const base = process.env.FRONTEND_URL || 'http://localhost:5173';
      const { url } = await getService().createCheckoutSession({
        userId: req.userId,
        credits,
        successUrl: `${base}/?purchase=success`,
        cancelUrl: `${base}/?purchase=cancelled`,
      });

      res.json({ url });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: error.errors });
      }
      console.error('[billing] checkout failed:', error);
      res.status(500).json({ error: 'Failed to start checkout' });
    }
  });

  return router;
}

/**
 * Stripe webhook handler. Mount with express.raw({ type: 'application/json' })
 * and WITHOUT auth, ahead of the global JSON parser — Stripe signs the exact raw
 * bytes, so any prior body parsing breaks signature verification.
 */
export function createBillingWebhookHandler(db: Database) {
  let service: BillingService | null = null;
  const getService = (): BillingService => (service ??= new BillingService(db));

  return async (req: Request, res: Response) => {
    if (!isBillingEnabled()) return res.status(503).end();

    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    try {
      // req.body is a Buffer here because the route is mounted with express.raw.
      const result = await getService().handleWebhookEvent(req.body, signature);
      res.json(result);
    } catch (error) {
      // Bad signature or malformed payload — 400 tells Stripe to retry later.
      console.error('[billing] webhook error:', error);
      res.status(400).json({ error: 'Webhook verification failed' });
    }
  };
}
