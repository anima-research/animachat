/**
 * Vitest setup file — runs before any source module is imported.
 *
 * Several modules in the backend read environment variables at module-load
 * time and apply them as effectively-immutable values for the lifetime of
 * the process: the rate-limit middleware (`AUTH_RATE_LIMIT_MAX`), the auth
 * middleware (`JWT_SECRET`), the encryption service, etc. Setting those env
 * vars inside a `beforeAll` (or even at the top of an individual test file)
 * is too late — the modules have already been instantiated by then.
 *
 * This file sets the values that make the test suite work against the
 * post-PR-#92 / post-PR-#91 backend defaults. Everything here is a value
 * that's safe to use across all tests — none of them set per-test secrets.
 */

// Auth middleware (PR #91): minimum 32 chars, rejects known placeholders,
// case-insensitive. A unique high-entropy literal keeps both checks happy.
process.env.JWT_SECRET ??=
  'vitest-fixture-secret-not-a-real-credential-1f9a3c8d4b6e2a7f';

// Mark this as a test run. Several modules condition behavior on this:
//   - database/index.ts skips production-only init paths
//   - any code that throws "production refused"-style guards
process.env.NODE_ENV ??= 'test';

// Rate-limit middleware (PR #92) defaults to 10 auth requests per 5 min
// per IP. Test runs make many requests from 127.0.0.1, so they blow past
// the cap and 429 instead of returning the actual response under test.
// Raising the cap by 4 orders of magnitude takes the limiter effectively
// out of the picture without altering its presence — the middleware still
// runs, still counts, still adds RateLimit-* headers — so tests that
// happen to assert on those headers still see consistent behavior.
process.env.AUTH_RATE_LIMIT_MAX ??= '100000';
process.env.TOKEN_LOOKUP_RATE_LIMIT_MAX ??= '100000';
