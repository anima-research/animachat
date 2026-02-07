import express from 'express';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import supertest from 'supertest';
import { Database } from '../database/index.js';
import { authRouter } from './auth.js';
import { conversationRouter } from './conversations.js';
import { participantRouter } from './participants.js';
import { createBookmarksRouter } from './bookmarks.js';
import { modelRouter } from './models.js';
import { systemRouter } from './system.js';
import siteConfigRouter from './site-config.js';
import { authenticateToken } from '../middleware/auth.js';
import { generateToken } from '../middleware/auth.js';

export interface TestContext {
  app: express.Express;
  db: Database;
  request: supertest.Agent;
  tmpDir: string;
  originalCwd: string;
}

/**
 * Create a test Express app with a real Database backed by a temp directory.
 *
 * The Database constructor uses `./data` relative paths, so we change cwd
 * to a temp dir before constructing it. This ensures complete test isolation.
 */
export async function createTestApp(): Promise<TestContext> {
  const originalCwd = process.cwd();
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'arc-route-test-'));

  // Change cwd so Database creates its data dirs inside our temp directory
  process.chdir(tmpDir);

  const db = new Database();
  await db.init();

  // Restore cwd (Database only uses relative paths during init for creating dirs)
  process.chdir(originalCwd);

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Mount routes matching the real server's structure
  app.use('/api/auth', authRouter(db));
  app.use('/api/conversations', authenticateToken, conversationRouter(db));
  app.use('/api/participants', authenticateToken, participantRouter(db));
  app.use('/api/bookmarks', createBookmarksRouter(db));
  app.use('/api/models', authenticateToken, modelRouter(db));
  app.use('/api/system', systemRouter());
  app.use('/api/site-config', siteConfigRouter);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const request = supertest(app);

  return { app, db, request, tmpDir, originalCwd };
}

/**
 * Clean up test context: remove temp dir.
 */
export async function cleanupTestApp(ctx: TestContext): Promise<void> {
  // Ensure we're not in the temp dir before removing it
  process.chdir(ctx.originalCwd);
  await rm(ctx.tmpDir, { recursive: true, force: true });
}

/**
 * Register a test user and return the response body.
 */
export async function registerUser(
  request: supertest.Agent,
  overrides: Partial<{ email: string; password: string; name: string }> = {}
) {
  const data = {
    email: overrides.email ?? 'test@example.com',
    password: overrides.password ?? 'password123',
    name: overrides.name ?? 'Test User',
  };
  const res = await request.post('/api/auth/register').send(data);
  return res;
}

/**
 * Login a user and return the response body.
 */
export async function loginUser(
  request: supertest.Agent,
  overrides: Partial<{ email: string; password: string }> = {}
) {
  const data = {
    email: overrides.email ?? 'test@example.com',
    password: overrides.password ?? 'password123',
  };
  const res = await request.post('/api/auth/login').send(data);
  return res;
}

/**
 * Register a user and return their auth token directly.
 * Convenience for tests that just need an authenticated user.
 */
export async function createAuthenticatedUser(
  request: supertest.Agent,
  overrides: Partial<{ email: string; password: string; name: string }> = {}
): Promise<{ token: string; userId: string; email: string }> {
  const regRes = await registerUser(request, overrides);
  if (regRes.status !== 200) {
    throw new Error(`Registration failed: ${JSON.stringify(regRes.body)}`);
  }
  // When email verification is not required (no RESEND_API_KEY), token is returned directly
  const token = regRes.body.token;
  const userId = regRes.body.user.id;
  const email = regRes.body.user.email;
  return { token, userId, email };
}

/**
 * Generate a token for a user directly (bypass registration/login).
 */
export function tokenForUser(userId: string): string {
  return generateToken(userId);
}
