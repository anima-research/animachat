import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TestContext,
  createTestApp,
  cleanupTestApp,
  createAuthenticatedUser,
} from './test-helpers.js';

describe('Shares Routes', () => {
  let ctx: TestContext;
  let userToken: string;
  let userId: string;
  let otherToken: string;
  let conversationId: string;

  beforeAll(async () => {
    ctx = await createTestApp();

    const user = await createAuthenticatedUser(ctx.request, {
      email: 'share-user@example.com',
      password: 'sharepass123',
      name: 'Share User',
    });
    userToken = user.token;
    userId = user.userId;

    const other = await createAuthenticatedUser(ctx.request, {
      email: 'share-other@example.com',
      password: 'otherpass123',
      name: 'Other Share User',
    });
    otherToken = other.token;

    // Create a conversation with a message so shares have content
    const convRes = await ctx.request
      .post('/api/conversations')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ title: 'Share Test Conv', model: 'claude-3-5-sonnet-20241022' });
    conversationId = convRes.body.id;

    // Add a message so the shared conversation has content
    await ctx.request
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        content: 'Test message for sharing',
        role: 'user',
      });
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // ───── Create share ─────

  describe('POST /api/shares/create', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.post('/api/shares/create').send({
        conversationId,
        shareType: 'tree',
      });

      expect(res.status).toBe(401);
    });

    it('creates a tree share successfully', async () => {
      const res = await ctx.request
        .post('/api/shares/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          conversationId,
          shareType: 'tree',
          settings: {
            showModelInfo: true,
            showTimestamps: true,
            title: 'My Shared Conversation',
            description: 'Test description',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.shareToken).toBeDefined();
      expect(res.body.shareUrl).toContain('/share/');
      expect(res.body.shareType).toBe('tree');
      expect(res.body.conversationId).toBe(conversationId);
    });

    it('creates a share with expiration', async () => {
      const res = await ctx.request
        .post('/api/shares/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          conversationId,
          shareType: 'tree',
          expiresIn: 24, // 24 hours
        });

      expect(res.status).toBe(200);
      expect(res.body.shareToken).toBeDefined();
      expect(res.body.expiresAt).toBeDefined();
    });

    it('rejects invalid shareType', async () => {
      const res = await ctx.request
        .post('/api/shares/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          conversationId,
          shareType: 'invalid',
        });

      expect(res.status).toBe(500);
    });

    it('rejects invalid conversationId format', async () => {
      const res = await ctx.request
        .post('/api/shares/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          conversationId: 'not-a-uuid',
          shareType: 'tree',
        });

      // Zod validation should catch this
      expect(res.status).toBe(500);
    });

    it('returns 404 for non-existent conversation', async () => {
      const res = await ctx.request
        .post('/api/shares/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          conversationId: '00000000-0000-0000-0000-000000000000',
          shareType: 'tree',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  // ───── Get share by token (public) ─────

  describe('GET /api/shares/:token', () => {
    let shareToken: string;

    beforeAll(async () => {
      const res = await ctx.request
        .post('/api/shares/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          conversationId,
          shareType: 'tree',
          settings: {
            showModelInfo: true,
            showTimestamps: true,
            title: 'Public Share Test',
          },
        });
      shareToken = res.body.shareToken;
    });

    it('returns shared conversation data (no auth required)', async () => {
      const res = await ctx.request.get(`/api/shares/${shareToken}`);

      expect(res.status).toBe(200);
      expect(res.body.share).toBeDefined();
      expect(res.body.conversation).toBeDefined();
      expect(res.body.conversation.title).toBe('Public Share Test');
      expect(res.body.messages).toBeDefined();
      expect(Array.isArray(res.body.messages)).toBe(true);
      expect(res.body.participants).toBeDefined();
      // userId should not be exposed
      expect(res.body.share.userId).toBeUndefined();
    });

    it('returns sanitized data respecting share settings', async () => {
      // Create a share without model info or timestamps
      const createRes = await ctx.request
        .post('/api/shares/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          conversationId,
          shareType: 'tree',
          settings: {
            showModelInfo: false,
            showTimestamps: false,
          },
        });

      const res = await ctx.request.get(
        `/api/shares/${createRes.body.shareToken}`
      );

      expect(res.status).toBe(200);
      // Model and timestamps should be stripped when settings say false
      expect(res.body.conversation.model).toBeUndefined();
    });

    it('returns 404 for non-existent token', async () => {
      const res = await ctx.request.get('/api/shares/nonexistent-token');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  // ───── List user's shares ─────

  describe('GET /api/shares/my-shares', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.get('/api/shares/my-shares');
      expect(res.status).toBe(401);
    });

    it('returns shares for authenticated user', async () => {
      const res = await ctx.request
        .get('/api/shares/my-shares')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      // Each share should have a shareUrl
      expect(res.body[0].shareUrl).toContain('/share/');
    });

    it('returns empty for user with no shares', async () => {
      const res = await ctx.request
        .get('/api/shares/my-shares')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });
  });

  // ───── Delete share ─────

  describe('DELETE /api/shares/:id', () => {
    let deleteShareId: string;

    beforeAll(async () => {
      const res = await ctx.request
        .post('/api/shares/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          conversationId,
          shareType: 'tree',
        });
      deleteShareId = res.body.id;
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.delete(`/api/shares/${deleteShareId}`);
      expect(res.status).toBe(401);
    });

    it('returns 404 when other user tries to delete', async () => {
      const res = await ctx.request
        .delete(`/api/shares/${deleteShareId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('deletes share successfully', async () => {
      const res = await ctx.request
        .delete(`/api/shares/${deleteShareId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for already deleted share', async () => {
      const res = await ctx.request
        .delete(`/api/shares/${deleteShareId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(404);
    });

    it('returns 404 for non-existent share', async () => {
      const res = await ctx.request
        .delete('/api/shares/nonexistent-id')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ───── Share with download settings ─────

  describe('Share settings', () => {
    it('creates share with allowDownload setting', async () => {
      const res = await ctx.request
        .post('/api/shares/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          conversationId,
          shareType: 'tree',
          settings: {
            allowDownload: true,
            showModelInfo: true,
            showTimestamps: true,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.settings).toBeDefined();
      expect(res.body.settings.allowDownload).toBe(true);
    });
  });

  // ───── Branch share ─────

  describe('Branch share', () => {
    let branchConvId: string;
    let branchId: string;

    beforeAll(async () => {
      // Create a conversation
      const convRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ title: 'Branch Share Conv', model: 'claude-3-5-sonnet-20241022' });
      branchConvId = convRes.body.id;

      // Add a message via the database directly (no REST endpoint for message creation)
      const msg = await ctx.db.createMessage(
        branchConvId,
        userId,
        'Branch test message',
        'user',
        undefined
      );
      branchId = msg.branches[0].id;
    });

    it('creates a branch share and retrieves branch-filtered data', async () => {
      // Create a branch share
      const createRes = await ctx.request
        .post('/api/shares/create')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          conversationId: branchConvId,
          shareType: 'branch',
          branchId,
          settings: {
            showModelInfo: true,
            showTimestamps: true,
          },
        });

      expect(createRes.status).toBe(200);
      expect(createRes.body.shareType).toBe('branch');

      // Retrieve the branch share - exercises the branch filtering path
      const getRes = await ctx.request.get(
        `/api/shares/${createRes.body.shareToken}`
      );

      expect(getRes.status).toBe(200);
      expect(getRes.body.messages).toBeDefined();
      expect(getRes.body.conversation).toBeDefined();
      expect(getRes.body.participants).toBeDefined();
    });
  });
});
