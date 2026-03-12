import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TestContext,
  createTestApp,
  cleanupTestApp,
  createAuthenticatedUser,
} from './test-helpers.js';
import { updateOpenRouterModelsCache } from '../services/pricing-cache.js';
import { ModelLoader } from '../config/model-loader.js';
import { ConfigLoader } from '../config/loader.js';

describe('Model Routes', () => {
  let ctx: TestContext;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    // Connect ModelLoader to the test Database so user custom models are available
    ModelLoader.getInstance().setDatabase(ctx.db);
    const auth = await createAuthenticatedUser(ctx.request, {
      email: 'models@example.com',
      password: 'modelspass1',
      name: 'Models User',
    });
    token = auth.token;
    userId = auth.userId;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  describe('GET /api/models', () => {
    it('returns list of available models', async () => {
      const res = await ctx.request
        .get('/api/models')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.get('/api/models');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/models/availability', () => {
    it('returns model availability info', async () => {
      const res = await ctx.request
        .get('/api/models/availability')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('userProviders');
      expect(res.body).toHaveProperty('adminProviders');
      expect(res.body).toHaveProperty('grantCurrencies');
      expect(res.body).toHaveProperty('canOverspend');
      expect(res.body).toHaveProperty('availableProviders');
      expect(Array.isArray(res.body.userProviders)).toBe(true);
      expect(Array.isArray(res.body.adminProviders)).toBe(true);
      expect(Array.isArray(res.body.availableProviders)).toBe(true);
      expect(typeof res.body.canOverspend).toBe('boolean');
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.get('/api/models/availability');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/models/:id', () => {
    it('returns a user-defined model by ID', async () => {
      // Login as the demo user who has custom models
      const loginRes = await ctx.request.post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
      });
      const demoToken = loginRes.body.token;

      // Get the model list to find a custom model ID
      const listRes = await ctx.request
        .get('/api/models')
        .set('Authorization', `Bearer ${demoToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.length).toBeGreaterThan(0);

      const modelId = listRes.body[0].id;
      const res = await ctx.request
        .get(`/api/models/${modelId}`)
        .set('Authorization', `Bearer ${demoToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(modelId);
    });

    it('returns 404 for non-existent model', async () => {
      const res = await ctx.request
        .get('/api/models/non-existent-model-xyz')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Model not found');
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.get('/api/models/some-model');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/models/availability - with API keys', () => {
    let keyToken: string;

    beforeAll(async () => {
      const auth = await createAuthenticatedUser(ctx.request, {
        email: 'models-avail@example.com',
        password: 'availpass1',
        name: 'Availability User',
      });
      keyToken = auth.token;

      // Create an API key for this user
      await ctx.request
        .post('/api/auth/api-keys')
        .set('Authorization', `Bearer ${keyToken}`)
        .send({
          name: 'Test Anthropic Key',
          provider: 'anthropic',
          credentials: { apiKey: 'sk-ant-test1234567890' },
        });
    });

    it('shows user providers when API keys are configured', async () => {
      const res = await ctx.request
        .get('/api/models/availability')
        .set('Authorization', `Bearer ${keyToken}`);

      expect(res.status).toBe(200);
      expect(res.body.userProviders).toContain('anthropic');
      expect(res.body.availableProviders).toContain('anthropic');
    });
  });

  describe('GET /api/models/availability - with grants', () => {
    let grantToken: string;

    beforeAll(async () => {
      const auth = await createAuthenticatedUser(ctx.request, {
        email: 'models-grants@example.com',
        password: 'grantpass1',
        name: 'Grant User',
      });
      grantToken = auth.token;

      // Use admin (cassandra) to mint grants to this user
      const adminLogin = await ctx.request.post('/api/auth/login').send({
        email: 'cassandra@oracle.test',
        password: 'prophecy123',
      });
      const adminToken = adminLogin.body.token;

      await ctx.request
        .post('/api/auth/grants/mint')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'models-grants@example.com',
          amount: 100,
          currency: 'sonnets',
        });
    });

    it('shows grant currencies for user with positive balance', async () => {
      const res = await ctx.request
        .get('/api/models/availability')
        .set('Authorization', `Bearer ${grantToken}`);

      expect(res.status).toBe(200);
      // 'sonnets' is migrated to 'old_sonnets' by the Database currency migration
      expect(res.body.grantCurrencies).toContain('old_sonnets');
    });
  });

  describe('GET /api/models/availability - with admin providers', () => {
    let savedConfig: any;

    beforeAll(() => {
      // Inject a config with provider credentials to test admin provider detection
      const loader = ConfigLoader.getInstance() as any;
      savedConfig = loader.config;
      loader.config = {
        providers: {
          anthropic: [
            { id: 'admin-anthropic', credentials: { apiKey: 'sk-test-admin' }, priority: 1 },
          ],
          openai: [
            { id: 'admin-openai', credentials: {}, priority: 1 }, // empty credentials
          ],
          gemini: [], // empty array
        },
        features: { allowUserApiKeys: true },
      };
    });

    afterAll(() => {
      // Restore original config
      const loader = ConfigLoader.getInstance() as any;
      loader.config = savedConfig;
    });

    it('detects admin providers with credentials', async () => {
      const res = await ctx.request
        .get('/api/models/availability')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      // anthropic has credentials -> should be in adminProviders
      expect(res.body.adminProviders).toContain('anthropic');
      // openai has empty credentials -> should NOT be in adminProviders
      expect(res.body.adminProviders).not.toContain('openai');
      // gemini is empty array -> should NOT be in adminProviders
      expect(res.body.adminProviders).not.toContain('gemini');
    });
  });

  describe('GET /api/models/openrouter/available', () => {
    it('returns models or error for OpenRouter endpoint', async () => {
      const res = await ctx.request
        .get('/api/models/openrouter/available')
        .set('Authorization', `Bearer ${token}`);

      // Might fail without proper config, but should return a proper response
      expect([200, 500]).toContain(res.status);
    });

    it('returns cached models when cache is populated', async () => {
      // Pre-populate the OpenRouter cache
      updateOpenRouterModelsCache([
        { id: 'test/model-1', name: 'Test Model 1', pricing: { prompt: '0.001', completion: '0.002' } },
        { id: 'test/model-2', name: 'Test Model 2', pricing: { prompt: '0.005', completion: '0.01' } },
      ]);

      const res = await ctx.request
        .get('/api/models/openrouter/available')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.cached).toBe(true);
      expect(res.body.models.length).toBe(2);
      expect(res.body.models[0].id).toBe('test/model-1');
    });
  });
});
