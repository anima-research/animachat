import { Stripe } from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../database/index.js';

type CheckoutSession = Stripe.Checkout.Session;

/**
 * A webhook event that verified fine but cannot be processed (e.g. malformed
 * metadata, amount mismatch). These are *permanent* failures: retrying won't
 * help, so the route should ack (2xx) to stop Stripe re-delivering, rather than
 * returning an error that triggers retries for days.
 */
export class UnprocessableWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnprocessableWebhookError';
  }
}

/**
 * The peg between the generic `credit` currency and US dollars.
 *
 * This is the single source of truth for what a credit is worth. The burn side
 * of the system currently treats `metrics.cost` (in USD) as the credit amount,
 * i.e. an implicit 1 credit = $1. We make that explicit here so the *purchase*
 * side (Stripe) and the *spend* side stay in lockstep: change this constant and
 * both should follow. If you ever rescale credits (e.g. 1 credit = $0.01 so that
 * user-facing balances are whole numbers), update the burn path to divide by the
 * same constant.
 */

// TODO: better source of truth for this conversion factor
export const USD_PER_CREDIT = 1;

/**
 * Purchase-side premium over the at-cost USD_PER_CREDIT peg.
 *
 * A credit is always worth USD_PER_CREDIT of inference on the burn side. The
 * markup is what we charge *on top* at purchase time (margin / fees / overhead):
 * price per credit = USD_PER_CREDIT × markup. The buyer still receives N credits
 * worth N × USD_PER_CREDIT of inference — markup never touches the burn side, so
 * spend accounting stays unchanged. Configured via the CREDIT_MARKUP env var;
 * defaults to 1.0 (sell at cost). Values below 1 are ignored (we never sell below
 * cost by accident).
 */
export function getCreditMarkup(): number {
  const raw = Number(process.env.CREDIT_MARKUP);
  return Number.isFinite(raw) && raw >= 1 ? raw : 1;
}

/** Cents charged per credit, including markup. Stripe requires an integer minor-unit amount. */
function centsPerCredit(): number {
  return Math.round(USD_PER_CREDIT * getCreditMarkup() * 100);
}

/**
 * True when Stripe is fully configured. Requires BOTH the secret key (for
 * creating checkout sessions) and the webhook secret (for verifying the payment
 * confirmation that mints credits). Requiring both means we never enter a state
 * where a user can pay but the webhook silently fails to credit them. Lets the
 * app boot (and the UI hide) when billing isn't set up.
 */
export function isBillingEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
}

/** Guard rails on a single purchase. Whole credits only — Stripe quantity is an integer. */
export const MIN_CREDITS = 1;
export const MAX_CREDITS = 100_000;

/** Currency users buy. Only the generic `credit` is sold for now. */
const PURCHASE_CURRENCY = 'credit';

// TODO: likely belongs elsewhere
export interface CreateCheckoutParams {
  userId: string;
  /** Number of generic credits to purchase. Whole numbers only. */
  credits: number;
  /** Where Stripe redirects after a successful payment. */
  successUrl: string;
  /** Where Stripe redirects if the user backs out. */
  cancelUrl: string;
}

/**
 * BillingService — Stripe checkout for buying generic credits.
 *
 * Design constraints (deliberate, for the time being):
 *  - Users can buy *only* the generic `credit` currency. No per-model currencies,
 *    no carts. One homogeneous SKU, so checkout is just a quantity.
 *  - Purchases happen at the fixed USD_PER_CREDIT peg. Variable, per-model pricing
 *    lives entirely on the burn side, never here.
 *  - Credits are minted on the Stripe webhook (payment confirmed), never on the
 *    success redirect. Minting is idempotent so a replayed webhook can't double-credit.
 */
export class BillingService {
  private stripeClient: Stripe;
  private db: Database;
  private webhookSecret?: string;

  constructor(db: Database) {
    this.db = db;
    this.stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-05-27.dahlia',
    });
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  }

  /**
   * Create a Stripe Checkout session for purchasing `credits` generic credits.
   * Returns the hosted-checkout URL to redirect the user to, plus the session id.
   *
   * Credits are NOT granted here — they are minted when Stripe confirms payment
   * via {@link handleWebhookEvent}. The session id is threaded through as the grant
   * `causeId` for idempotency and as an audit trail.
   */
  async createCheckoutSession(params: CreateCheckoutParams): Promise<{ url: string; sessionId: string }> {
    const { userId, credits, successUrl, cancelUrl } = params;

    if (!Number.isInteger(credits) || credits < MIN_CREDITS || credits > MAX_CREDITS) {
      throw new Error(`credits must be a whole number between ${MIN_CREDITS} and ${MAX_CREDITS}`);
    }

    const user = await this.db.getUserById(userId);
    if (!user) {
      throw new Error(`unknown user: ${userId}`);
    }

    // metadata is the contract with the webhook: it tells us who to credit and how
    // much. We stamp the per-credit price charged here (`unitAmount`) so the webhook
    // reconciles against what the user actually paid — `centsPerCredit()` reads
    // CREDIT_MARKUP from env, so recomputing it at webhook time would reject paid
    // sessions whenever the markup changed between checkout and webhook delivery.
    const unitAmount = centsPerCredit();
    const metadata = {
      userId,
      credits: String(credits),
      currency: PURCHASE_CURRENCY,
      unitAmount: String(unitAmount),
    };

    const session = await this.stripeClient.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: userId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
      payment_intent_data: { metadata },
      line_items: [
        {
          quantity: credits,
          price_data: {
            currency: 'usd',
            unit_amount: unitAmount,
            product_data: {
              name: 'Credits',
              description: `${credits} credit${credits === 1 ? '' : 's'}`,
            },
          },
        },
      ],
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }

    return { url: session.url, sessionId: session.id };
  }

  /**
   * Verify and handle an incoming Stripe webhook. Mount this on a route that
   * receives the *raw* request body (Stripe signature verification operates on
   * the exact bytes — do not JSON-parse before calling this).
   *
   * Returns the number of credits minted, if any, so callers can log/observe.
   */
  async handleWebhookEvent(rawBody: Buffer | string, signature: string): Promise<{ received: true; minted: number }> {
    if (!this.webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    const event = this.stripeClient.webhooks.constructEvent(rawBody, signature, this.webhookSecret);

    switch (event.type) {
      // `completed` covers synchronous payment methods (cards). `async_payment_succeeded`
      // covers delayed methods that confirm later. Both are made idempotent below.
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as CheckoutSession;
        const minted = await this.fulfillCheckout(session);
        return { received: true, minted };
      }
      default:
        return { received: true, minted: 0 };
    }
  }

  /**
   * Mint purchased credits for a confirmed checkout session. Idempotent: minting
   * is keyed on the session id via the grant `causeId` inside
   * {@link Database.recordGrantInfo}, so Stripe webhook retries (and the
   * completed/async_payment_succeeded overlap) credit the user exactly once.
   *
   * Returns the number of credits minted (0 if already fulfilled or not payable).
   */
  private async fulfillCheckout(session: CheckoutSession): Promise<number> {
    if (session.payment_status !== 'paid') {
      return 0;
    }

    const userId = session.client_reference_id || session.metadata?.userId;
    const credits = Number(session.metadata?.credits);
    const currency = session.metadata?.currency || PURCHASE_CURRENCY;

    if (!userId || !Number.isFinite(credits) || credits <= 0) {
      // Permanent failure (bad/missing metadata) — surface as unprocessable so
      // the webhook acks rather than asking Stripe to retry forever.
      throw new UnprocessableWebhookError(
        `checkout session ${session.id} is missing valid userId/credits metadata`,
      );
    }

    // Reconcile the credits we're about to mint against what was actually paid.
    // metadata.credits and metadata.unitAmount are what we stamped at session
    // creation; amount_total is what Stripe charged. Validate against the stamped
    // unit price — NOT a fresh centsPerCredit(), which reads CREDIT_MARKUP from env
    // and would spuriously reject every in-flight session if the markup changed
    // between checkout and webhook delivery (charging the user but minting nothing).
    // Fall back to the live price only for legacy sessions created before unitAmount
    // was stamped.
    const stampedUnit = Number(session.metadata?.unitAmount);
    const unitAmount = Number.isFinite(stampedUnit) && stampedUnit > 0 ? stampedUnit : centsPerCredit();
    const expectedTotal = credits * unitAmount;
    if (typeof session.amount_total === 'number' && session.amount_total !== expectedTotal) {
      throw new UnprocessableWebhookError(
        `checkout session ${session.id} amount_total ${session.amount_total} != expected ${expectedTotal} for ${credits} credits`,
      );
    }

    // recordGrantInfo enforces mint idempotency on causeId atomically, so a
    // replayed/duplicate webhook returns false here and credits exactly once.
    const minted = await this.db.recordGrantInfo({
      id: uuidv4(),
      time: new Date().toISOString(),
      type: 'mint',
      amount: credits,
      toUserId: userId,
      currency,
      reason: 'Credit purchase',
      causeId: session.id,
    });

    return minted ? credits : 0;
  }
}
