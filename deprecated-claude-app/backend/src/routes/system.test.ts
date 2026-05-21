import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TestContext,
  createTestApp,
  cleanupTestApp,
} from './test-helpers.js';

describe('System Routes', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  describe('GET /api/system/config', () => {
    it('returns public system configuration', async () => {
      const res = await ctx.request.get('/api/system/config');

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      // Should return public config fields
      expect(res.body).toHaveProperty('defaultModel');
      expect(res.body).toHaveProperty('groupChatSuggestedModels');
      expect(Array.isArray(res.body.groupChatSuggestedModels)).toBe(true);
    });

    it('returns default model when not configured', async () => {
      const res = await ctx.request.get('/api/system/config');

      expect(res.status).toBe(200);
      // Default should be claude-3-5-sonnet-20241022
      expect(typeof res.body.defaultModel).toBe('string');
    });
  });

  describe('GET /api/health', () => {
    it('returns 200 with status ok', async () => {
      const res = await ctx.request.get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });
});
