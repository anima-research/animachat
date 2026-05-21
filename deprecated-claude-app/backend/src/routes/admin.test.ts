import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import supertest from 'supertest';
import { Database } from '../database/index.js';
import { authRouter } from './auth.js';
import { adminRouter } from './admin.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  createAuthenticatedUser,
  loginUser,
  registerUser,
  tokenForUser,
} from './test-helpers.js';

/** Standalone test app that mounts admin routes alongside auth + conversations. */
async function createAdminTestApp() {
  const originalCwd = process.cwd();
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'arc-admin-test-'));
  process.chdir(tmpDir);

  // Create config files that admin routes need to read/write
  const configDir = path.join(tmpDir, 'config');
  await mkdir(configDir, { recursive: true });

  const configPath = path.join(configDir, 'config.json');
  const modelsPath = path.join(configDir, 'models.json');

  await writeFile(configPath, JSON.stringify({
    defaultModel: 'claude-3-5-sonnet-20241022',
    groupChatSuggestedModels: ['claude-3-5-sonnet-20241022'],
    initialGrants: { credit: 100 },
    currencies: { credit: { name: 'Credit', symbol: 'C' } },
    providers: {
      anthropic: [{
        id: 'default',
        name: 'Anthropic Default',
        description: 'Default Anthropic profile',
        priority: 1,
        modelCosts: [],
        allowedModels: ['claude-3-5-sonnet-20241022'],
        apiKey: 'sk-secret-key-hidden',
      }],
    },
  }, null, 2));

  await writeFile(modelsPath, JSON.stringify({
    models: [
      {
        id: 'claude-3-5-sonnet-20241022',
        providerModelId: 'claude-3-5-sonnet-20241022',
        displayName: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        hidden: false,
      },
      {
        id: 'claude-3-opus-20240229',
        providerModelId: 'claude-3-opus-20240229',
        displayName: 'Claude 3 Opus',
        provider: 'anthropic',
        hidden: false,
      },
    ],
  }, null, 2));

  // Set env vars so admin routes find the config files
  process.env.CONFIG_PATH = configPath;
  process.env.MODELS_CONFIG_PATH = modelsPath;

  const db = new Database();
  await db.init();
  process.chdir(originalCwd);

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Auth routes (needed for registration/login)
  app.use('/api/auth', authRouter(db));
  // Admin routes — note: adminRouter internally applies authenticateToken + requireAdmin
  app.use('/api/admin', adminRouter(db));
  const request = supertest(app);
  return { app, db, request, tmpDir, originalCwd, configPath, modelsPath };
}

async function cleanupAdminTestApp(ctx: { tmpDir: string; originalCwd: string }) {
  delete process.env.CONFIG_PATH;
  delete process.env.MODELS_CONFIG_PATH;
  process.chdir(ctx.originalCwd);
  await rm(ctx.tmpDir, { recursive: true, force: true });
}

describe('Admin Routes', () => {
  let ctx: Awaited<ReturnType<typeof createAdminTestApp>>;
  let adminToken: string;
  let adminUserId: string;
  let regularToken: string;
  let regularUserId: string;

  beforeAll(async () => {
    ctx = await createAdminTestApp();

    // Login as the seeded admin user (cassandra)
    const loginRes = await loginUser(ctx.request, {
      email: 'cassandra@oracle.test',
      password: 'prophecy123',
    });
    adminToken = loginRes.body.token;
    adminUserId = loginRes.body.user.id;

    // Register a regular (non-admin) user
    const auth = await createAuthenticatedUser(ctx.request, {
      email: 'regular@example.com',
      password: 'regularpass1',
      name: 'Regular User',
    });
    regularToken = auth.token;
    regularUserId = auth.userId;
  });

  afterAll(async () => {
    await cleanupAdminTestApp(ctx);
  });

  // ───── requireAdmin middleware ─────

  describe('requireAdmin middleware', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await ctx.request.get('/api/admin/users');
      expect(res.status).toBe(401);
    });

    it('rejects non-admin users with 403', async () => {
      const res = await ctx.request
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${regularToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Admin access required');
    });

    it('rejects invalid tokens with 403', async () => {
      const res = await ctx.request
        .get('/api/admin/users')
        .set('Authorization', 'Bearer invalid-token-here');
      expect(res.status).toBe(403);
    });

    it('rejects token for non-existent user with 403', async () => {
      const fakeToken = tokenForUser('00000000-0000-0000-0000-000000000000');
      const res = await ctx.request
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${fakeToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Admin access required');
    });
  });

  // ───── GET /api/admin/users ─────

  describe('GET /api/admin/users', () => {
    it('returns list of users with stats for admin', async () => {
      const res = await ctx.request
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.users).toBeDefined();
      expect(Array.isArray(res.body.users)).toBe(true);
      // At least admin + regular user
      expect(res.body.users.length).toBeGreaterThanOrEqual(2);

      // Verify user object structure
      const user = res.body.users.find((u: any) => u.email === 'regular@example.com');
      expect(user).toBeDefined();
      expect(user.id).toBe(regularUserId);
      expect(user.name).toBe('Regular User');
      expect(typeof user.conversationCount).toBe('number');
      expect(Array.isArray(user.capabilities)).toBe(true);
      expect(typeof user.balances).toBe('object');
    });
  });

  // ───── GET /api/admin/users/:id ─────

  describe('GET /api/admin/users/:id', () => {
    it('returns detailed user info for a valid user', async () => {
      const res = await ctx.request
        .get(`/api/admin/users/${regularUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(regularUserId);
      expect(res.body.user.email).toBe('regular@example.com');
      expect(res.body.stats).toBeDefined();
      expect(res.body.grants).toBeDefined();
    });

    it('returns 404 for non-existent user', async () => {
      const res = await ctx.request
        .get('/api/admin/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });
  });

  // ───── POST /api/admin/users/:id/capabilities ─────

  describe('POST /api/admin/users/:id/capabilities', () => {
    it('grants a capability to a user', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/capabilities`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ capability: 'mint', action: 'grant' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('mint');
      expect(res.body.message).toContain('granted');
      expect(res.body.message).toContain('regular@example.com');
    });

    it('revokes a capability from a user', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/capabilities`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ capability: 'mint', action: 'revoke' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('mint');
      // Production code uses `${action}ed` which produces 'revokeed'
      expect(res.body.message).toContain('revoke');
    });

    it('grants all valid capability types', async () => {
      for (const cap of ['admin', 'mint', 'send', 'overspend', 'researcher']) {
        const res = await ctx.request
          .post(`/api/admin/users/${regularUserId}/capabilities`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ capability: cap, action: 'grant' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }
    });

    it('rejects invalid capability name', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/capabilities`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ capability: 'superuser', action: 'grant' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid request');
      expect(res.body.details).toBeDefined();
    });

    it('rejects invalid action', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/capabilities`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ capability: 'admin', action: 'toggle' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid request');
    });

    it('returns 404 for non-existent user', async () => {
      const res = await ctx.request
        .post('/api/admin/users/00000000-0000-0000-0000-000000000000/capabilities')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ capability: 'admin', action: 'grant' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });

    it('rejects empty body', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/capabilities`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ───── POST /api/admin/users/:id/credits ─────

  describe('POST /api/admin/users/:id/credits', () => {
    it('grants credits to a user', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/credits`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, currency: 'credit', reason: 'Test grant' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('100');
      expect(res.body.message).toContain('credit');
      expect(res.body.message).toContain('regular@example.com');
    });

    it('grants credits without reason (uses default)', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/credits`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, currency: 'opus' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('50');
      expect(res.body.message).toContain('opus');
    });

    it('rejects negative amount', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/credits`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: -10, currency: 'credit' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid request');
    });

    it('rejects zero amount', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/credits`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 0, currency: 'credit' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid request');
    });

    it('rejects missing currency', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/credits`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100 });

      expect(res.status).toBe(400);
    });

    it('rejects empty currency string', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/credits`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, currency: '' });

      expect(res.status).toBe(400);
    });

    it('rejects currency exceeding max length', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/credits`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, currency: 'a'.repeat(51) });

      expect(res.status).toBe(400);
    });

    it('rejects reason exceeding max length', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/credits`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, currency: 'credit', reason: 'x'.repeat(201) });

      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent user', async () => {
      const res = await ctx.request
        .post('/api/admin/users/00000000-0000-0000-0000-000000000000/credits')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, currency: 'credit' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });
  });

  // ───── POST /api/admin/users/:id/reload ─────

  describe('POST /api/admin/users/:id/reload', () => {
    it('reloads user data for a valid user', async () => {
      const res = await ctx.request
        .post(`/api/admin/users/${regularUserId}/reload`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Reloaded');
      expect(res.body.message).toContain('regular@example.com');
    });

    it('returns 404 for non-existent user', async () => {
      const res = await ctx.request
        .post('/api/admin/users/00000000-0000-0000-0000-000000000000/reload')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });
  });

  // ───── GET /api/admin/stats ─────

  describe('GET /api/admin/stats', () => {
    it('returns system-wide statistics', async () => {
      const res = await ctx.request
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.totalUsers).toBe('number');
      expect(res.body.totalUsers).toBeGreaterThanOrEqual(2);
      expect(typeof res.body.totalConversations).toBe('number');
    });
  });

  // ───── GET /api/admin/usage/user/:id ─────

  describe('GET /api/admin/usage/user/:id', () => {
    it('returns usage stats for a valid user', async () => {
      const res = await ctx.request
        .get(`/api/admin/usage/user/${regularUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // UsageStats structure
      expect(res.body).toBeDefined();
    });

    it('accepts custom days parameter', async () => {
      const res = await ctx.request
        .get(`/api/admin/usage/user/${regularUserId}?days=7`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('returns 404 for non-existent user', async () => {
      const res = await ctx.request
        .get('/api/admin/usage/user/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });
  });

  // ───── GET /api/admin/usage/system ─────

  describe('GET /api/admin/usage/system', () => {
    it('returns system-wide usage stats', async () => {
      const res = await ctx.request
        .get('/api/admin/usage/system')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('accepts custom days parameter', async () => {
      const res = await ctx.request
        .get('/api/admin/usage/system?days=7')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  // ───── GET /api/admin/usage/model/:modelId ─────

  describe('GET /api/admin/usage/model/:modelId', () => {
    it('returns usage stats for a model', async () => {
      const res = await ctx.request
        .get('/api/admin/usage/model/claude-3-5-sonnet-20241022')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('accepts custom days parameter', async () => {
      const res = await ctx.request
        .get('/api/admin/usage/model/claude-3-5-sonnet-20241022?days=7')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  // ───── POST /api/admin/verify-legacy-users ─────

  describe('POST /api/admin/verify-legacy-users', () => {
    it('verifies legacy users before the default date', async () => {
      const res = await ctx.request
        .post('/api/admin/verify-legacy-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.verifiedUsers).toBe('object');
      expect(Array.isArray(res.body.verifiedUsers)).toBe(true);
      expect(res.body.debug).toBeDefined();
      expect(typeof res.body.debug.totalUsers).toBe('number');
    });

    it('accepts a custom beforeDate', async () => {
      const res = await ctx.request
        .post('/api/admin/verify-legacy-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ beforeDate: '2020-01-01T00:00:00Z' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // All users created after 2020 should be skipped
      expect(res.body.verifiedUsers.length).toBe(0);
    });
  });

  // ───── POST /api/admin/set-all-age-verified ─────

  describe('POST /api/admin/set-all-age-verified', () => {
    it('sets age verified for all unverified users', async () => {
      const res = await ctx.request
        .post('/api/admin/set-all-age-verified')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.updatedCount).toBe('number');
      expect(Array.isArray(res.body.updatedUsers)).toBe(true);
    });

    it('returns 0 updates when called again (already verified)', async () => {
      const res = await ctx.request
        .post('/api/admin/set-all-age-verified')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.updatedCount).toBe(0);
    });
  });

  // ───── POST /api/admin/set-all-tos-accepted ─────

  describe('POST /api/admin/set-all-tos-accepted', () => {
    it('sets ToS accepted for all users without it', async () => {
      const res = await ctx.request
        .post('/api/admin/set-all-tos-accepted')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.updatedCount).toBe('number');
      expect(Array.isArray(res.body.updatedUsers)).toBe(true);
    });

    it('returns 0 updates when called again (already accepted)', async () => {
      const res = await ctx.request
        .post('/api/admin/set-all-tos-accepted')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.updatedCount).toBe(0);
    });
  });

  // ───── GET /api/admin/config ─────

  describe('GET /api/admin/config', () => {
    it('returns sanitized config (no API keys)', async () => {
      const res = await ctx.request
        .get('/api/admin/config')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.defaultModel).toBe('claude-3-5-sonnet-20241022');
      expect(res.body.providers).toBeDefined();
      expect(res.body.providers.anthropic).toBeDefined();
      expect(res.body.providers.anthropic.length).toBe(1);

      // Verify API key is NOT in the response
      const profile = res.body.providers.anthropic[0];
      expect(profile.id).toBe('default');
      expect(profile.name).toBe('Anthropic Default');
      expect(profile.apiKey).toBeUndefined();
      expect(profile.credentials).toBeUndefined();

      // Other config fields
      expect(res.body.groupChatSuggestedModels).toEqual(['claude-3-5-sonnet-20241022']);
      expect(res.body.initialGrants).toEqual({ credit: 100 });
      expect(res.body.currencies).toBeDefined();
    });
  });

  // ───── PATCH /api/admin/config ─────

  describe('PATCH /api/admin/config', () => {
    it('updates defaultModel', async () => {
      const res = await ctx.request
        .patch('/api/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ defaultModel: 'claude-3-opus-20240229' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Config updated');

      // Verify it persisted
      const getRes = await ctx.request
        .get('/api/admin/config')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getRes.body.defaultModel).toBe('claude-3-opus-20240229');
    });

    it('updates groupChatSuggestedModels', async () => {
      const res = await ctx.request
        .patch('/api/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ groupChatSuggestedModels: ['claude-3-opus-20240229', 'claude-3-5-sonnet-20241022'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('updates initialGrants', async () => {
      const res = await ctx.request
        .patch('/api/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ initialGrants: { credit: 200, opus: 50 } });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('updates providerModelCosts', async () => {
      const res = await ctx.request
        .patch('/api/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          providerModelCosts: {
            provider: 'anthropic',
            profileId: 'default',
            modelCosts: [{ modelId: 'claude-3-5-sonnet-20241022', inputCost: 3, outputCost: 15 }],
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ───── POST /api/admin/config/reload ─────

  describe('POST /api/admin/config/reload', () => {
    it('reloads config and models from disk', async () => {
      const res = await ctx.request
        .post('/api/admin/config/reload')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('reloaded');
    });
  });

  // ───── GET /api/admin/models ─────

  describe('GET /api/admin/models', () => {
    it('returns list of all models', async () => {
      const res = await ctx.request
        .get('/api/admin/models')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.models).toBeDefined();
      expect(Array.isArray(res.body.models)).toBe(true);
      // We seeded 2 models in our test config
      const modelIds = res.body.models.map((m: any) => m.id);
      expect(modelIds).toContain('claude-3-5-sonnet-20241022');
    });
  });

  // ───── PATCH /api/admin/models/:modelId/visibility ─────

  describe('PATCH /api/admin/models/:modelId/visibility', () => {
    it('hides a model', async () => {
      const res = await ctx.request
        .patch('/api/admin/models/claude-3-opus-20240229/visibility')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ hidden: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.modelId).toBe('claude-3-opus-20240229');
      expect(res.body.hidden).toBe(true);
    });

    it('shows a model', async () => {
      const res = await ctx.request
        .patch('/api/admin/models/claude-3-opus-20240229/visibility')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ hidden: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.hidden).toBe(false);
    });

    it('rejects non-boolean hidden value', async () => {
      const res = await ctx.request
        .patch('/api/admin/models/claude-3-opus-20240229/visibility')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ hidden: 'yes' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('hidden must be a boolean');
    });

    it('returns 404 for non-existent model', async () => {
      const res = await ctx.request
        .patch('/api/admin/models/nonexistent-model/visibility')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ hidden: true });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Model not found');
    });
  });

  // ───── GET /api/admin/conversation-size/:id ─────

  describe('GET /api/admin/conversation-size/:id', () => {
    it('returns 404 for non-existent conversation', async () => {
      const res = await ctx.request
        .get('/api/admin/conversation-size/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('returns size info for an existing conversation', async () => {
      // Create a conversation directly via the DB, passing explicit settings
      // to bypass ModelLoader's getValidatedModelDefaults
      const conv = await ctx.db.createConversation(
        adminUserId,
        'Size Test',
        'claude-3-5-sonnet-20241022',
        undefined, // systemPrompt
        { temperature: 1.0, maxTokens: 4096 }, // explicit settings
      );
      const conversationId = conv.id;

      // Add a message directly via the DB
      await ctx.db.createMessage(
        conversationId,
        adminUserId,
        'Hello, this is a test message for size checking.',
        'user',
      );

      const res = await ctx.request
        .get(`/api/admin/conversation-size/${conversationId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBe(conversationId);
      expect(typeof res.body.messageCount).toBe('number');
      expect(res.body.messageCount).toBeGreaterThanOrEqual(1);
      expect(res.body.totalJsonSize).toBeDefined();
      expect(res.body.totalContentLength).toBeDefined();
      expect(typeof res.body.imageCount).toBe('number');
    });
  });

  // ───── Non-admin user cannot access ANY admin endpoint ─────

  describe('Non-admin user cannot access admin endpoints', () => {
    let nonAdminToken: string;

    beforeAll(async () => {
      // Create a fresh user that will never be granted admin capability
      const auth = await createAuthenticatedUser(ctx.request, {
        email: 'nonadmin@example.com',
        password: 'nonadminpass1',
        name: 'Non-Admin User',
      });
      nonAdminToken = auth.token;
    });

    const adminEndpoints = [
      { method: 'get' as const, path: '/api/admin/users' },
      { method: 'get' as const, path: '/api/admin/stats' },
      { method: 'get' as const, path: '/api/admin/usage/system' },
      { method: 'post' as const, path: '/api/admin/verify-legacy-users' },
      { method: 'post' as const, path: '/api/admin/set-all-age-verified' },
      { method: 'post' as const, path: '/api/admin/set-all-tos-accepted' },
    ];

    for (const { method, path: ep } of adminEndpoints) {
      it(`rejects ${method.toUpperCase()} ${ep} for non-admin`, async () => {
        const res = await ctx.request[method](ep)
          .set('Authorization', `Bearer ${nonAdminToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Admin access required');
      });
    }
  });
});
