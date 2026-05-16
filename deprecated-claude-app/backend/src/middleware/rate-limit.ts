/**
 * Rate-limiting middleware for unauthenticated and abuse-prone endpoints.
 *
 * Two limiters with different thresholds:
 *
 *   - `authLimiter`         : login, register, forgot-password, etc.
 *                              Tight — these are brute-force targets and
 *                              email-send-cost surfaces.
 *
 *   - `tokenLookupLimiter`  : public lookups by capability token (invite
 *                              `/check`, share-by-token view, collab invite
 *                              preview). More permissive than auth since
 *                              legitimate users may load these multiple
 *                              times per session.
 *
 * Both key off `req.ip`. For this to be meaningful behind nginx, the
 * backend sets `app.set('trust proxy', 'loopback')` so X-Forwarded-For from
 * the local nginx is honored. Without that, every request would key to the
 * nginx loopback address and the limit would be useless.
 *
 * Defense-in-depth: the primary protection against capability-token brute
 * force is high token entropy (128 bits, see invites.ts / shares.ts /
 * collaboration.ts). Rate limiting blocks the *single-IP* enumeration
 * vector and slows credential-stuffing on login — botnets routing through
 * many IPs are not stopped by per-IP limits, but with full-entropy tokens
 * there is nothing reachable to find by enumeration anyway.
 *
 * Thresholds can be overridden via env vars for ops flexibility (e.g. for
 * load-testing or staging tighter/looser policies):
 *
 *   AUTH_RATE_LIMIT_MAX           (default 10)
 *   AUTH_RATE_LIMIT_WINDOW_MIN    (default 5)
 *   TOKEN_LOOKUP_RATE_LIMIT_MAX           (default 60)
 *   TOKEN_LOOKUP_RATE_LIMIT_WINDOW_MIN    (default 5)
 */
import rateLimit from 'express-rate-limit';

const minutes = (n: number) => n * 60 * 1000;

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  // Greptile review of #92: a fractional value like `0.5` previously slipped
  // through (`Number.isFinite(0.5) && 0.5 > 0` is true) and got passed
  // straight to express-rate-limit. The very first request then triggered
  // 429 because `1 >= 0.5`. Limiter values must be positive integers.
  if (!Number.isInteger(n) || n < 1) {
    console.warn(
      `[rate-limit] Ignoring invalid ${name}="${raw}" — must be a positive ` +
      `integer. Using default ${fallback}.`,
    );
    return fallback;
  }
  return n;
}

const AUTH_MAX = readNumberEnv('AUTH_RATE_LIMIT_MAX', 10);
const AUTH_WINDOW_MIN = readNumberEnv('AUTH_RATE_LIMIT_WINDOW_MIN', 5);
const TOKEN_LOOKUP_MAX = readNumberEnv('TOKEN_LOOKUP_RATE_LIMIT_MAX', 60);
const TOKEN_LOOKUP_WINDOW_MIN = readNumberEnv('TOKEN_LOOKUP_RATE_LIMIT_WINDOW_MIN', 5);

/**
 * Tighter limiter for auth-credential endpoints (login, register, password
 * reset, email verification). At default settings: 10 requests per 5 minutes
 * per IP. Returns 429 with a `Retry-After` header when exceeded.
 */
export const authLimiter = rateLimit({
  windowMs: minutes(AUTH_WINDOW_MIN),
  max: AUTH_MAX,
  standardHeaders: true,   // emit RateLimit-* headers (RFC draft)
  legacyHeaders: false,    // drop the older X-RateLimit-* variants
  message: { error: 'Too many requests. Please try again later.' },
});

/**
 * Permissive limiter for public capability-token lookups (invite check,
 * share-by-token view, collab invite preview). At default settings: 60
 * requests per 5 minutes per IP.
 */
export const tokenLookupLimiter = rateLimit({
  windowMs: minutes(TOKEN_LOOKUP_WINDOW_MIN),
  max: TOKEN_LOOKUP_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
