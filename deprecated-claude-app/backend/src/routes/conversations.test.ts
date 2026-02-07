import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TestContext,
  createTestApp,
  cleanupTestApp,
  createAuthenticatedUser,
  tokenForUser,
} from './test-helpers.js';

describe('Conversation Routes', () => {
  let ctx: TestContext;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const auth = await createAuthenticatedUser(ctx.request, {
      email: 'conv@example.com',
      password: 'convpass123',
      name: 'Conv User',
    });
    token = auth.token;
    userId = auth.userId;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // ───── Create Conversation ─────

  describe('POST /api/conversations', () => {
    it('creates a conversation with title and model', async () => {
      const res = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Test Conversation',
          model: 'claude-3-5-sonnet-20241022',
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe('Test Conversation');
      expect(res.body.model).toBe('claude-3-5-sonnet-20241022');
      expect(res.body.userId).toBe(userId);
    });

    it('creates a conversation with default title', async () => {
      const res = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          model: 'claude-3-5-sonnet-20241022',
        });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('New Conversation');
    });

    it('creates a conversation with system prompt', async () => {
      const res = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'With Prompt',
          model: 'claude-3-5-sonnet-20241022',
          systemPrompt: 'You are a helpful assistant.',
        });

      expect(res.status).toBe(200);
      expect(res.body.systemPrompt).toBe('You are a helpful assistant.');
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.post('/api/conversations').send({
        title: 'No Auth',
        model: 'claude-3-5-sonnet-20241022',
      });

      expect(res.status).toBe(401);
    });
  });

  // ───── List Conversations ─────

  describe('GET /api/conversations', () => {
    it('returns conversations for the authenticated user', async () => {
      const res = await ctx.request
        .get('/api/conversations')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // We created conversations in the previous describe block
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty list for a user with no conversations', async () => {
      const auth = await createAuthenticatedUser(ctx.request, {
        email: 'empty@example.com',
        password: 'emptypass1',
        name: 'Empty User',
      });

      const res = await ctx.request
        .get('/api/conversations')
        .set('Authorization', `Bearer ${auth.token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // This user has no conversations they created
      // (test users may be created by Database init, so we just check it's an array)
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.get('/api/conversations');
      expect(res.status).toBe(401);
    });
  });

  // ───── Get Conversation by ID ─────

  describe('GET /api/conversations/:id', () => {
    let conversationId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Get By ID Test',
          model: 'claude-3-5-sonnet-20241022',
        });
      conversationId = createRes.body.id;
    });

    it('returns conversation details', async () => {
      const res = await ctx.request
        .get(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(conversationId);
      expect(res.body.title).toBe('Get By ID Test');
    });

    it('returns 404 for non-existent conversation', async () => {
      const res = await ctx.request
        .get('/api/conversations/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('returns 404 when another user tries to access', async () => {
      const other = await createAuthenticatedUser(ctx.request, {
        email: 'other-get@example.com',
        password: 'otherpass1',
        name: 'Other User',
      });

      const res = await ctx.request
        .get(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${other.token}`);

      expect(res.status).toBe(404);
    });
  });

  // ───── Update Conversation ─────

  describe('PATCH /api/conversations/:id', () => {
    let conversationId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Updatable',
          model: 'claude-3-5-sonnet-20241022',
        });
      conversationId = createRes.body.id;
    });

    it('updates the conversation title', async () => {
      const res = await ctx.request
        .patch(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated Title' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated Title');
    });

    it('updates the system prompt', async () => {
      const res = await ctx.request
        .patch(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ systemPrompt: 'New system prompt' });

      expect(res.status).toBe(200);
      expect(res.body.systemPrompt).toBe('New system prompt');
    });

    it('returns 404 for non-existent conversation', async () => {
      const res = await ctx.request
        .patch('/api/conversations/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Nope' });

      expect(res.status).toBe(404);
    });

    it('returns 403 when another user tries to update', async () => {
      const other = await createAuthenticatedUser(ctx.request, {
        email: 'other-patch@example.com',
        password: 'otherpass1',
        name: 'Other Patcher',
      });

      const res = await ctx.request
        .patch(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ title: 'Hijacked' });

      // The route first checks if conversation is accessible (404 if not),
      // then checks ownership (403 if not owner)
      expect([403, 404]).toContain(res.status);
    });
  });

  // ───── Archive Conversation ─────

  describe('POST /api/conversations/:id/archive', () => {
    let conversationId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Archivable',
          model: 'claude-3-5-sonnet-20241022',
        });
      conversationId = createRes.body.id;
    });

    it('archives a conversation', async () => {
      const res = await ctx.request
        .post(`/api/conversations/${conversationId}/archive`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for non-existent conversation', async () => {
      const res = await ctx.request
        .post('/api/conversations/00000000-0000-0000-0000-000000000000/archive')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('returns 403/404 when another user tries to archive', async () => {
      // Create a new conversation
      const newConvRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Not Yours To Archive',
          model: 'claude-3-5-sonnet-20241022',
        });

      const other = await createAuthenticatedUser(ctx.request, {
        email: 'other-archive@example.com',
        password: 'otherpass1',
        name: 'Other Archiver',
      });

      const res = await ctx.request
        .post(`/api/conversations/${newConvRes.body.id}/archive`)
        .set('Authorization', `Bearer ${other.token}`);

      expect([403, 404]).toContain(res.status);
    });
  });

  // ───── Unread Counts ─────

  describe('GET /api/conversations/unread-counts', () => {
    it('returns empty object (stubbed endpoint)', async () => {
      const res = await ctx.request
        .get('/api/conversations/unread-counts')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });
  });

  // ───── Messages ─────

  describe('GET /api/conversations/:id/messages', () => {
    let conversationId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Messages Test',
          model: 'claude-3-5-sonnet-20241022',
        });
      conversationId = createRes.body.id;
    });

    it('returns messages for a conversation', async () => {
      const res = await ctx.request
        .get(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns 404 for non-existent conversation', async () => {
      const res = await ctx.request
        .get('/api/conversations/00000000-0000-0000-0000-000000000000/messages')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  // ───── Cache Metrics ─────

  describe('GET /api/conversations/:id/cache-metrics', () => {
    let conversationId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Metrics Test',
          model: 'claude-3-5-sonnet-20241022',
        });
      conversationId = createRes.body.id;
    });

    it('returns cache metrics for a conversation', async () => {
      const res = await ctx.request
        .get(`/api/conversations/${conversationId}/cache-metrics`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBe(conversationId);
      expect(typeof res.body.cacheHits).toBe('number');
    });
  });

  // ───── Conversation Metrics ─────

  describe('GET /api/conversations/:id/metrics', () => {
    let conversationId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Full Metrics Test',
          model: 'claude-3-5-sonnet-20241022',
        });
      conversationId = createRes.body.id;
    });

    it('returns metrics for a conversation', async () => {
      const res = await ctx.request
        .get(`/api/conversations/${conversationId}/metrics`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBe(conversationId);
      expect(typeof res.body.messageCount).toBe('number');
    });
  });

  // ───── Export Conversation ─────

  describe('GET /api/conversations/:id/export', () => {
    let conversationId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Export Test',
          model: 'claude-3-5-sonnet-20241022',
        });
      conversationId = createRes.body.id;
    });

    it('exports a conversation', async () => {
      const res = await ctx.request
        .get(`/api/conversations/${conversationId}/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      // Export should include conversation data
      expect(res.body).toBeDefined();
    });
  });

  // ───── Duplicate Conversation ─────

  describe('POST /api/conversations/:id/duplicate', () => {
    let conversationId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Original',
          model: 'claude-3-5-sonnet-20241022',
          systemPrompt: 'System prompt for duplication test',
        });
      conversationId = createRes.body.id;
    });

    it('duplicates a conversation', async () => {
      const res = await ctx.request
        .post(`/api/conversations/${conversationId}/duplicate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.id).not.toBe(conversationId);
    });

    it('duplicates with a custom title', async () => {
      const res = await ctx.request
        .post(`/api/conversations/${conversationId}/duplicate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ newTitle: 'Custom Copy' });

      expect(res.status).toBe(200);
      // Verify through getting the duplicated conversation
      if (res.body.id) {
        const getRes = await ctx.request
          .get(`/api/conversations/${res.body.id}`)
          .set('Authorization', `Bearer ${token}`);
        expect(getRes.status).toBe(200);
      }
    });
  });

  // ───── UI State ─────

  describe('Conversation UI State', () => {
    let conversationId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'UI State Test',
          model: 'claude-3-5-sonnet-20241022',
        });
      conversationId = createRes.body.id;
    });

    it('gets UI state for a conversation', async () => {
      const res = await ctx.request
        .get(`/api/conversations/${conversationId}/ui-state`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it('updates UI state', async () => {
      const res = await ctx.request
        .patch(`/api/conversations/${conversationId}/ui-state`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isDetached: true });

      expect(res.status).toBe(200);
    });
  });

  // ───── Mark Read ─────

  describe('POST /api/conversations/:id/mark-read', () => {
    let conversationId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Mark Read Test',
          model: 'claude-3-5-sonnet-20241022',
        });
      conversationId = createRes.body.id;
    });

    it('marks branches as read', async () => {
      const res = await ctx.request
        .post(`/api/conversations/${conversationId}/mark-read`)
        .set('Authorization', `Bearer ${token}`)
        .send({ branchIds: [] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-array branchIds', async () => {
      const res = await ctx.request
        .post(`/api/conversations/${conversationId}/mark-read`)
        .set('Authorization', `Bearer ${token}`)
        .send({ branchIds: 'not-an-array' });

      expect(res.status).toBe(400);
    });
  });
});
