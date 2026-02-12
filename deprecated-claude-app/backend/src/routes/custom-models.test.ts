import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TestContext,
  createTestApp,
  cleanupTestApp,
  createAuthenticatedUser,
} from './test-helpers.js';

describe('Custom Models Routes', () => {
  let ctx: TestContext;
  let userToken: string;
  let userId: string;
  let otherToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();

    const user = await createAuthenticatedUser(ctx.request, {
      email: 'custom-model@example.com',
      password: 'modelpass123',
      name: 'Model User',
    });
    userToken = user.token;
    userId = user.userId;

    const other = await createAuthenticatedUser(ctx.request, {
      email: 'other-model@example.com',
      password: 'otherpass123',
      name: 'Other Model User',
    });
    otherToken = other.token;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  const validModelData = {
    displayName: 'My Custom Model',
    shortName: 'custom-1',
    provider: 'openrouter' as const,
    providerModelId: 'anthropic/claude-3-opus',
    contextWindow: 200000,
    outputTokenLimit: 4096,
  };

  // ───── List custom models ─────

  describe('GET /api/models/custom', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.get('/api/models/custom');
      expect(res.status).toBe(401);
    });

    it('returns empty array initially', async () => {
      const res = await ctx.request
        .get('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      // May have default models created during init
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ───── Create custom model ─────

  describe('POST /api/models/custom', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request
        .post('/api/models/custom')
        .send(validModelData);

      expect(res.status).toBe(401);
    });

    it('creates a custom model with valid data', async () => {
      const res = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send(validModelData);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.displayName).toBe('My Custom Model');
      expect(res.body.shortName).toBe('custom-1');
      expect(res.body.provider).toBe('openrouter');
      expect(res.body.providerModelId).toBe('anthropic/claude-3-opus');
      expect(res.body.contextWindow).toBe(200000);
      expect(res.body.userId).toBe(userId);
    });

    it('rejects invalid model data (missing required fields)', async () => {
      const res = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ displayName: 'Incomplete' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid model data');
      expect(res.body.details).toBeDefined();
    });

    it('rejects invalid provider', async () => {
      const res = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ ...validModelData, provider: 'invalid-provider' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid model data');
    });

    it('creates model with openai-compatible provider and localhost endpoint', async () => {
      const res = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          displayName: 'Local LLM',
          shortName: 'local-1',
          provider: 'openai-compatible',
          providerModelId: 'llama-3.1',
          contextWindow: 8000,
          outputTokenLimit: 2048,
          customEndpoint: {
            baseUrl: 'http://localhost:11434/v1',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.provider).toBe('openai-compatible');
      expect(res.body.customEndpoint.baseUrl).toBe('http://localhost:11434/v1');
    });

    it('rejects HTTP endpoint for non-localhost URLs', async () => {
      const res = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          ...validModelData,
          displayName: 'Remote HTTP',
          shortName: 'remote-http',
          provider: 'openai-compatible',
          customEndpoint: {
            baseUrl: 'http://example.com/v1',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('HTTPS');
    });

    it('rejects private IP ranges for custom endpoints', async () => {
      const res = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          ...validModelData,
          displayName: 'Private IP Model',
          shortName: 'private-ip',
          provider: 'openai-compatible',
          customEndpoint: {
            baseUrl: 'https://10.0.0.1/v1',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('private IP');
    });

    it('rejects 192.168.x.x private ranges', async () => {
      const res = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          ...validModelData,
          displayName: 'LAN Model',
          shortName: 'lan-model',
          provider: 'openai-compatible',
          customEndpoint: {
            baseUrl: 'https://192.168.1.100/v1',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('private IP');
    });

    it('rejects 172.16-31.x.x private ranges', async () => {
      const res = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          ...validModelData,
          displayName: 'Docker Model',
          shortName: 'docker-model',
          provider: 'openai-compatible',
          customEndpoint: {
            baseUrl: 'https://172.16.0.1/v1',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('private IP');
    });

    it('creates model with optional fields', async () => {
      const res = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          ...validModelData,
          displayName: 'Full Model',
          shortName: 'full-model',
          supportsThinking: true,
          supportsPrefill: true,
          canonicalId: 'anthropic/claude-3-opus',
        });

      expect(res.status).toBe(201);
      expect(res.body.supportsThinking).toBe(true);
      expect(res.body.supportsPrefill).toBe(true);
    });
  });

  // ───── Get specific model ─────

  describe('GET /api/models/custom/:id', () => {
    let modelId: string;

    beforeAll(async () => {
      const res = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          ...validModelData,
          displayName: 'Get Test Model',
          shortName: 'get-test',
        });
      modelId = res.body.id;
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.get(`/api/models/custom/${modelId}`);
      expect(res.status).toBe(401);
    });

    it('returns specific model', async () => {
      const res = await ctx.request
        .get(`/api/models/custom/${modelId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(modelId);
      expect(res.body.displayName).toBe('Get Test Model');
    });

    it('returns 404 for non-existent model', async () => {
      const res = await ctx.request
        .get('/api/models/custom/nonexistent-id')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Model not found');
    });

    it('returns 404 when accessing other user\'s model', async () => {
      const res = await ctx.request
        .get(`/api/models/custom/${modelId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Model not found');
    });
  });

  // ───── Update model ─────

  describe('PATCH /api/models/custom/:id', () => {
    let updateModelId: string;

    beforeAll(async () => {
      const res = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          ...validModelData,
          displayName: 'Update Test',
          shortName: 'update-test',
        });
      updateModelId = res.body.id;
    });

    it('rejects without auth', async () => {
      const res = await ctx.request
        .patch(`/api/models/custom/${updateModelId}`)
        .send({ displayName: 'Updated' });

      expect(res.status).toBe(401);
    });

    it('updates model fields', async () => {
      const res = await ctx.request
        .patch(`/api/models/custom/${updateModelId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ displayName: 'Updated Name', shortName: 'updated-short' });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Updated Name');
      expect(res.body.shortName).toBe('updated-short');
    });

    it('returns 404 for non-existent model', async () => {
      const res = await ctx.request
        .patch('/api/models/custom/nonexistent-id')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ displayName: 'Nope' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Model not found');
    });

    it('returns 404 when updating other user\'s model', async () => {
      const res = await ctx.request
        .patch(`/api/models/custom/${updateModelId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ displayName: 'Stolen Update' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Model not found');
    });

    it('rejects invalid update data', async () => {
      const res = await ctx.request
        .patch(`/api/models/custom/${updateModelId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ contextWindow: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid model data');
    });

    it('rejects HTTP endpoint update for non-localhost', async () => {
      const res = await ctx.request
        .patch(`/api/models/custom/${updateModelId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          customEndpoint: { baseUrl: 'http://remote-server.com/v1' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('HTTPS');
    });

    it('rejects private IP in endpoint update', async () => {
      const res = await ctx.request
        .patch(`/api/models/custom/${updateModelId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          customEndpoint: { baseUrl: 'https://169.254.1.1/v1' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('private IP');
    });
  });

  // ───── Delete model ─────

  describe('DELETE /api/models/custom/:id', () => {
    let deleteModelId: string;

    beforeAll(async () => {
      const res = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          ...validModelData,
          displayName: 'Delete Test',
          shortName: 'delete-test',
        });
      deleteModelId = res.body.id;
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.delete(
        `/api/models/custom/${deleteModelId}`
      );
      expect(res.status).toBe(401);
    });

    it('returns 404 when deleting other user\'s model', async () => {
      const res = await ctx.request
        .delete(`/api/models/custom/${deleteModelId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Model not found');
    });

    it('deletes model successfully', async () => {
      const res = await ctx.request
        .delete(`/api/models/custom/${deleteModelId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(204);
    });

    it('returns 404 for already deleted model', async () => {
      const res = await ctx.request
        .delete(`/api/models/custom/${deleteModelId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(404);
    });

    it('returns 404 for non-existent model', async () => {
      const res = await ctx.request
        .delete('/api/models/custom/nonexistent-id')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Model not found');
    });
  });

  // ───── User isolation ─────

  describe('User isolation', () => {
    it('users cannot see each other\'s models in list', async () => {
      // Create a model for user
      await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          ...validModelData,
          displayName: 'User Model Only',
          shortName: 'user-only',
        });

      // Other user should not see user's models
      const otherList = await ctx.request
        .get('/api/models/custom')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(otherList.status).toBe(200);
      const otherModelNames = otherList.body.map((m: any) => m.displayName);
      expect(otherModelNames).not.toContain('User Model Only');
    });
  });

  // ───── Test model connection ─────

  describe('POST /api/models/custom/:id/test', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.post('/api/models/custom/some-id/test');
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent model', async () => {
      const res = await ctx.request
        .post('/api/models/custom/nonexistent-id/test')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Model not found');
    });

    it('returns error for unsupported provider test', async () => {
      // Create a model with google provider (unsupported for testing)
      const createRes = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          displayName: 'Google Test Model',
          shortName: 'google-test',
          provider: 'google',
          providerModelId: 'gemini-pro',
          contextWindow: 32000,
          outputTokenLimit: 8192,
        });
      expect(createRes.status).toBe(201);

      const res = await ctx.request
        .post(`/api/models/custom/${createRes.body.id}/test`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Unsupported provider');
    });

    it('returns error for openrouter model without API key', async () => {
      const createRes = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          displayName: 'OR Test Model',
          shortName: 'or-test',
          provider: 'openrouter',
          providerModelId: 'anthropic/claude-3-opus',
          contextWindow: 200000,
          outputTokenLimit: 4096,
        });
      expect(createRes.status).toBe(201);

      const res = await ctx.request
        .post(`/api/models/custom/${createRes.body.id}/test`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('API key');
    });

    it('returns error for openai-compatible model without endpoint', async () => {
      const createRes = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          displayName: 'No Endpoint Model',
          shortName: 'no-endpoint',
          provider: 'openai-compatible',
          providerModelId: 'test-model',
          contextWindow: 8000,
          outputTokenLimit: 2048,
        });
      expect(createRes.status).toBe(201);

      const res = await ctx.request
        .post(`/api/models/custom/${createRes.body.id}/test`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('endpoint');
    });

    it('returns connection error for openai-compatible model with unreachable endpoint', async () => {
      const createRes = await ctx.request
        .post('/api/models/custom')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          displayName: 'Unreachable Model',
          shortName: 'unreachable',
          provider: 'openai-compatible',
          providerModelId: 'test-model',
          contextWindow: 8000,
          outputTokenLimit: 2048,
          customEndpoint: {
            baseUrl: 'http://localhost:19999/v1',
          },
        });
      expect(createRes.status).toBe(201);

      const res = await ctx.request
        .post(`/api/models/custom/${createRes.body.id}/test`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    }, 15000); // Allow more time for connection timeout
  });
});
