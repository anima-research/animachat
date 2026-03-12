import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import {
  TestContext,
  createTestApp,
  cleanupTestApp,
} from './test-helpers.js';
import siteConfigRouter from './site-config.js';

describe('Site Config Routes', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  describe('GET /api/site-config', () => {
    it('returns site configuration (public, no auth required)', async () => {
      const res = await ctx.request.get('/api/site-config');

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      expect(typeof res.body).toBe('object');
    });

    it('returns consistent config on multiple calls', async () => {
      const res1 = await ctx.request.get('/api/site-config');
      const res2 = await ctx.request.get('/api/site-config');

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body).toEqual(res2.body);
    });
  });

  describe('POST /api/site-config/reload', () => {
    it('reloads site configuration (no auth required by default)', async () => {
      const res = await ctx.request.post('/api/site-config/reload');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.config).toBeDefined();
    });

    it('returns reloaded config matching GET response', async () => {
      const reloadRes = await ctx.request.post('/api/site-config/reload');
      expect(reloadRes.status).toBe(200);

      const getRes = await ctx.request.get('/api/site-config');
      expect(getRes.status).toBe(200);
      // After reload, GET should return the same config
      expect(getRes.body).toEqual(reloadRes.body.config);
    });
  });

  describe('POST /api/site-config/reload - admin check', () => {
    it('rejects reload for non-admin user', async () => {
      // Create a separate app with middleware that sets req.user (non-admin)
      const app = express();
      app.use(express.json());
      app.use('/api/site-config', (req, _res, next) => {
        (req as any).user = { isAdmin: false, name: 'Regular User' };
        next();
      }, siteConfigRouter);

      const req = supertest(app);
      const res = await req.post('/api/site-config/reload');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Admin access required');
    });

    it('allows reload for admin user', async () => {
      const app = express();
      app.use(express.json());
      app.use('/api/site-config', (req, _res, next) => {
        (req as any).user = { isAdmin: true, name: 'Admin User' };
        next();
      }, siteConfigRouter);

      const req = supertest(app);
      const res = await req.post('/api/site-config/reload');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
