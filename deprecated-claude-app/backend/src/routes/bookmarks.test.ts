import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TestContext,
  createTestApp,
  cleanupTestApp,
  createAuthenticatedUser,
} from './test-helpers.js';

describe('Bookmark Routes', () => {
  let ctx: TestContext;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const auth = await createAuthenticatedUser(ctx.request, {
      email: 'bookmarks@example.com',
      password: 'bookmarkpass1',
      name: 'Bookmark User',
    });
    token = auth.token;
    userId = auth.userId;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // ───── Create Bookmark ─────

  describe('POST /api/bookmarks', () => {
    let conversationId: string;
    let messageId: string;
    let branchId: string;

    beforeAll(async () => {
      // Import a conversation to get real message/branch IDs
      const importRes = await ctx.request
        .post('/api/conversations/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Bookmark Test Conversation',
          model: 'claude-3-5-sonnet-20241022',
          messages: [
            { role: 'user', content: 'Bookmarkable message' },
            { role: 'assistant', content: 'Response to bookmark' },
          ],
        });
      conversationId = importRes.body.id;

      const msgRes = await ctx.request
        .get(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`);
      messageId = msgRes.body[0].id;
      branchId = msgRes.body[0].branches[0].id;
    });

    it('creates a bookmark', async () => {
      const res = await ctx.request
        .post('/api/bookmarks')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          messageId,
          branchId,
          label: 'Important point',
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      expect(res.body.label).toBe('Important point');
    });

    it('updates an existing bookmark (same message/branch)', async () => {
      const res = await ctx.request
        .post('/api/bookmarks')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          messageId,
          branchId,
          label: 'Updated label',
        });

      expect(res.status).toBe(200);
      expect(res.body.label).toBe('Updated label');
    });

    it('rejects bookmark without auth', async () => {
      const res = await ctx.request.post('/api/bookmarks').send({
        conversationId,
        messageId,
        branchId,
        label: 'No auth',
      });

      expect(res.status).toBe(401);
    });

    it('rejects bookmark with invalid data', async () => {
      const res = await ctx.request
        .post('/api/bookmarks')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId: 'not-a-uuid',
          messageId,
          branchId,
          label: 'Invalid',
        });

      expect(res.status).toBe(400);
    });

    it('rejects bookmark with empty label', async () => {
      const res = await ctx.request
        .post('/api/bookmarks')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          messageId,
          branchId,
          label: '',
        });

      expect(res.status).toBe(400);
    });

    it('rejects bookmark for non-owned conversation', async () => {
      const other = await createAuthenticatedUser(ctx.request, {
        email: 'other-bookmark@example.com',
        password: 'otherpass1',
        name: 'Other Bookmark User',
      });

      const res = await ctx.request
        .post('/api/bookmarks')
        .set('Authorization', `Bearer ${other.token}`)
        .send({
          conversationId,
          messageId,
          branchId,
          label: 'Not my conversation',
        });

      expect(res.status).toBe(404);
    });
  });

  // ───── List Bookmarks ─────

  describe('GET /api/bookmarks/conversation/:conversationId', () => {
    let conversationId: string;

    beforeAll(async () => {
      const importRes = await ctx.request
        .post('/api/conversations/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'List Bookmarks Test',
          model: 'claude-3-5-sonnet-20241022',
          messages: [
            { role: 'user', content: 'First message' },
            { role: 'assistant', content: 'First reply' },
          ],
        });
      conversationId = importRes.body.id;

      // Get message IDs and create bookmarks
      const msgRes = await ctx.request
        .get(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`);

      await ctx.request
        .post('/api/bookmarks')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          messageId: msgRes.body[0].id,
          branchId: msgRes.body[0].branches[0].id,
          label: 'First bookmark',
        });
    });

    it('lists bookmarks for a conversation', async () => {
      const res = await ctx.request
        .get(`/api/bookmarks/conversation/${conversationId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.get(`/api/bookmarks/conversation/${conversationId}`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-owned conversation', async () => {
      const other = await createAuthenticatedUser(ctx.request, {
        email: 'other-list-bm@example.com',
        password: 'otherpass1',
        name: 'Other List User',
      });

      const res = await ctx.request
        .get(`/api/bookmarks/conversation/${conversationId}`)
        .set('Authorization', `Bearer ${other.token}`);

      expect(res.status).toBe(404);
    });
  });

  // ───── Delete Bookmark ─────

  describe('DELETE /api/bookmarks/:messageId/:branchId', () => {
    let conversationId: string;
    let messageId: string;
    let branchId: string;

    beforeAll(async () => {
      const importRes = await ctx.request
        .post('/api/conversations/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Delete Bookmark Test',
          model: 'claude-3-5-sonnet-20241022',
          messages: [
            { role: 'user', content: 'Delete me bookmark' },
          ],
        });
      conversationId = importRes.body.id;

      const msgRes = await ctx.request
        .get(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`);
      messageId = msgRes.body[0].id;
      branchId = msgRes.body[0].branches[0].id;

      // Create a bookmark to delete
      await ctx.request
        .post('/api/bookmarks')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          messageId,
          branchId,
          label: 'Will be deleted',
        });
    });

    it('deletes a bookmark', async () => {
      const res = await ctx.request
        .delete(`/api/bookmarks/${messageId}/${branchId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for already-deleted bookmark', async () => {
      const res = await ctx.request
        .delete(`/api/bookmarks/${messageId}/${branchId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('returns 404 for non-existent bookmark', async () => {
      const res = await ctx.request
        .delete('/api/bookmarks/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('rejects without auth', async () => {
      const res = await ctx.request
        .delete(`/api/bookmarks/${messageId}/${branchId}`);

      expect(res.status).toBe(401);
    });
  });
});
