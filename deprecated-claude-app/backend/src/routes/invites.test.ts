import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TestContext,
  createTestApp,
  cleanupTestApp,
  createAuthenticatedUser,
  loginUser,
} from './test-helpers.js';

describe('Invites Routes', () => {
  let ctx: TestContext;
  let adminToken: string;
  let userToken: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestApp();

    // Login as admin (has mint capability) — the default test admin user
    const adminLogin = await loginUser(ctx.request, {
      email: 'cassandra@oracle.test',
      password: 'prophecy123',
    });
    adminToken = adminLogin.body.token;

    // Create a regular user (no mint capability)
    const user = await createAuthenticatedUser(ctx.request, {
      email: 'invite-user@example.com',
      password: 'userpass123',
      name: 'Invite User',
    });
    userToken = user.token;
    userId = user.userId;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // ───── Create invite ─────

  describe('POST /api/invites', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.post('/api/invites').send({
        amount: 100,
        currency: 'credit',
      });

      expect(res.status).toBe(401);
    });

    it('rejects without mint capability', async () => {
      const res = await ctx.request
        .post('/api/invites')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ amount: 100, currency: 'credit' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Mint capability required');
    });

    it('creates invite with auto-generated code (admin)', async () => {
      const res = await ctx.request
        .post('/api/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, currency: 'credit' });

      expect(res.status).toBe(200);
      expect(res.body.code).toBeDefined();
      expect(typeof res.body.code).toBe('string');
      expect(res.body.amount).toBe(50);
      expect(res.body.currency).toBe('credit');
      expect(res.body.useCount).toBe(0);
    });

    it('creates invite with custom code', async () => {
      const res = await ctx.request
        .post('/api/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: 'CUSTOM-CODE-123',
          amount: 100,
          currency: 'credit',
        });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe('CUSTOM-CODE-123');
      expect(res.body.amount).toBe(100);
    });

    it('rejects duplicate code', async () => {
      // Create an invite first
      await ctx.request
        .post('/api/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'DUP-CODE', amount: 10, currency: 'credit' });

      // Try to create with same code
      const res = await ctx.request
        .post('/api/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'DUP-CODE', amount: 20, currency: 'credit' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invite code already exists');
    });

    it('creates invite with expiration and max uses', async () => {
      const res = await ctx.request
        .post('/api/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 25,
          currency: 'credit',
          expiresInDays: 7,
          maxUses: 10,
        });

      expect(res.status).toBe(200);
      expect(res.body.expiresAt).toBeDefined();
      expect(res.body.maxUses).toBe(10);
    });

    it('rejects invalid data (negative amount)', async () => {
      const res = await ctx.request
        .post('/api/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: -5, currency: 'credit' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid request data');
      expect(res.body.details).toBeDefined();
    });

    it('rejects missing amount', async () => {
      const res = await ctx.request
        .post('/api/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ currency: 'credit' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid request data');
    });
  });

  // ───── List invites ─────

  describe('GET /api/invites', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.get('/api/invites');
      expect(res.status).toBe(401);
    });

    it('lists invites created by the admin user', async () => {
      const res = await ctx.request
        .get('/api/invites')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty array for user with no invites', async () => {
      const res = await ctx.request
        .get('/api/invites')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });
  });

  // ───── Check invite code (public) ─────

  describe('GET /api/invites/:code/check', () => {
    let validCode: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'CHECK-CODE', amount: 75, currency: 'credit' });
      validCode = createRes.body.code;
    });

    it('returns valid for existing invite code', async () => {
      const res = await ctx.request.get(`/api/invites/${validCode}/check`);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.amount).toBe(75);
      expect(res.body.currency).toBe('credit');
    });

    it('returns invalid for non-existent code', async () => {
      const res = await ctx.request.get('/api/invites/FAKECODE999/check');

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });

  // ───── Claim invite ─────

  describe('POST /api/invites/claim', () => {
    let claimCode: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'CLAIM-CODE', amount: 30, currency: 'credit' });
      claimCode = createRes.body.code;
    });

    it('rejects without auth', async () => {
      const res = await ctx.request
        .post('/api/invites/claim')
        .send({ code: claimCode });

      expect(res.status).toBe(401);
    });

    it('claims a valid invite successfully', async () => {
      const res = await ctx.request
        .post('/api/invites/claim')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: claimCode });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.amount).toBe(30);
      expect(res.body.currency).toBe('credit');
    });

    it('rejects claim for non-existent code', async () => {
      const res = await ctx.request
        .post('/api/invites/claim')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: 'NONEXISTENT-CLAIM' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects claim with invalid request data (missing code)', async () => {
      const res = await ctx.request
        .post('/api/invites/claim')
        .set('Authorization', `Bearer ${userToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid request data');
    });

    it('enforces max uses limit', async () => {
      // Create invite with maxUses: 1
      const createRes = await ctx.request
        .post('/api/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'MAX-USE-1', amount: 10, currency: 'credit', maxUses: 1 });
      expect(createRes.status).toBe(200);

      // First claim (should succeed)
      const claimer1 = await createAuthenticatedUser(ctx.request, {
        email: 'claimer1@example.com',
        password: 'claimer1pass',
        name: 'Claimer 1',
      });
      const claim1 = await ctx.request
        .post('/api/invites/claim')
        .set('Authorization', `Bearer ${claimer1.token}`)
        .send({ code: 'MAX-USE-1' });
      expect(claim1.status).toBe(200);
      expect(claim1.body.success).toBe(true);

      // Second claim (should fail - max uses reached)
      const claimer2 = await createAuthenticatedUser(ctx.request, {
        email: 'claimer2@example.com',
        password: 'claimer2pass',
        name: 'Claimer 2',
      });
      const claim2 = await ctx.request
        .post('/api/invites/claim')
        .set('Authorization', `Bearer ${claimer2.token}`)
        .send({ code: 'MAX-USE-1' });

      expect(claim2.status).toBe(400);
      expect(claim2.body.error).toBeDefined();
    });
  });
});
