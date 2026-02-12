import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TestContext,
  createTestApp,
  cleanupTestApp,
  createAuthenticatedUser,
} from './test-helpers.js';

describe('Participant Routes', () => {
  let ctx: TestContext;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const auth = await createAuthenticatedUser(ctx.request, {
      email: 'participants@example.com',
      password: 'partpass123',
      name: 'Participants User',
    });
    token = auth.token;
    userId = auth.userId;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // ───── Create Participant ─────

  describe('POST /api/participants', () => {
    let conversationId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Participant Test',
          model: 'claude-3-5-sonnet-20241022',
          format: 'prefill',
        });
      conversationId = createRes.body.id;
    });

    it('creates a user participant', async () => {
      const res = await ctx.request
        .post('/api/participants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          name: 'Alice',
          type: 'user',
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      expect(res.body.name).toBe('Alice');
      expect(res.body.type).toBe('user');
    });

    it('creates an assistant participant with model', async () => {
      const res = await ctx.request
        .post('/api/participants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          name: 'Claude',
          type: 'assistant',
          model: 'claude-3-5-sonnet-20241022',
          systemPrompt: 'You are a helpful assistant named Claude.',
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Claude');
      expect(res.body.type).toBe('assistant');
      expect(res.body.model).toBe('claude-3-5-sonnet-20241022');
    });

    it('rejects invalid input', async () => {
      const res = await ctx.request
        .post('/api/participants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          name: 'Bad',
          type: 'invalid_type',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.post('/api/participants').send({
        conversationId,
        name: 'NoAuth',
        type: 'user',
      });

      expect(res.status).toBe(401);
    });

    it('rejects for non-owned conversation', async () => {
      const other = await createAuthenticatedUser(ctx.request, {
        email: 'other-part-create@example.com',
        password: 'otherpass1',
        name: 'Other Creator',
      });

      const res = await ctx.request
        .post('/api/participants')
        .set('Authorization', `Bearer ${other.token}`)
        .send({
          conversationId,
          name: 'Intruder',
          type: 'user',
        });

      expect(res.status).toBe(403);
    });
  });

  // ───── Get Participants ─────

  describe('GET /api/participants/conversation/:conversationId', () => {
    let conversationId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'List Participants Test',
          model: 'claude-3-5-sonnet-20241022',
          format: 'prefill',
        });
      conversationId = createRes.body.id;

      // Create a participant
      await ctx.request
        .post('/api/participants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          name: 'Test Participant',
          type: 'user',
        });
    });

    it('lists participants for a conversation', async () => {
      const res = await ctx.request
        .get(`/api/participants/conversation/${conversationId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.get(`/api/participants/conversation/${conversationId}`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-accessible conversation', async () => {
      const other = await createAuthenticatedUser(ctx.request, {
        email: 'other-part-list@example.com',
        password: 'otherpass1',
        name: 'Other Lister',
      });

      const res = await ctx.request
        .get(`/api/participants/conversation/${conversationId}`)
        .set('Authorization', `Bearer ${other.token}`);

      expect(res.status).toBe(403);
    });
  });

  // ───── Update Participant ─────

  describe('PATCH /api/participants/:id', () => {
    let conversationId: string;
    let participantId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Update Participant Test',
          model: 'claude-3-5-sonnet-20241022',
          format: 'prefill',
        });
      conversationId = createRes.body.id;

      const partRes = await ctx.request
        .post('/api/participants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          name: 'Updatable',
          type: 'assistant',
          model: 'claude-3-5-sonnet-20241022',
        });
      participantId = partRes.body.id;
    });

    it('updates participant name', async () => {
      const res = await ctx.request
        .patch(`/api/participants/${participantId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
    });

    it('updates participant model', async () => {
      const res = await ctx.request
        .patch(`/api/participants/${participantId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ model: 'gpt-4' });

      expect(res.status).toBe(200);
    });

    it('updates participant isActive flag', async () => {
      const res = await ctx.request
        .patch(`/api/participants/${participantId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false });

      expect(res.status).toBe(200);
    });

    it('returns 404 for non-existent participant', async () => {
      const res = await ctx.request
        .patch('/api/participants/00000000-0000-0000-0000-000000000099')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Ghost' });

      expect(res.status).toBe(404);
    });

    it('rejects without auth', async () => {
      const res = await ctx.request
        .patch(`/api/participants/${participantId}`)
        .send({ name: 'No Auth' });

      expect(res.status).toBe(401);
    });
  });

  // ───── Delete Participant ─────

  describe('DELETE /api/participants/:id', () => {
    let conversationId: string;
    let participantId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Delete Participant Test',
          model: 'claude-3-5-sonnet-20241022',
          format: 'prefill',
        });
      conversationId = createRes.body.id;

      const partRes = await ctx.request
        .post('/api/participants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          name: 'Deletable',
          type: 'user',
        });
      participantId = partRes.body.id;
    });

    it('deletes a participant', async () => {
      const res = await ctx.request
        .delete(`/api/participants/${participantId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for already-deleted participant', async () => {
      const res = await ctx.request
        .delete(`/api/participants/${participantId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('returns 404 for non-existent participant', async () => {
      const res = await ctx.request
        .delete('/api/participants/00000000-0000-0000-0000-000000000099')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('rejects without auth', async () => {
      const res = await ctx.request
        .delete(`/api/participants/${participantId}`);

      expect(res.status).toBe(401);
    });
  });

  // ───── Assign Participants to Messages ─────

  describe('POST /api/participants/conversation/:conversationId/assign-to-messages', () => {
    let conversationId: string;

    beforeAll(async () => {
      // Create a prefill conversation with messages
      const importRes = await ctx.request
        .post('/api/conversations/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Assign Participants Test',
          model: 'claude-3-5-sonnet-20241022',
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
          ],
        });
      conversationId = importRes.body.id;

      // Update conversation format to prefill
      await ctx.request
        .patch(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ format: 'prefill' });
    });

    it('assigns participants to messages', async () => {
      // Create user and assistant participants
      await ctx.request
        .post('/api/participants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          name: 'Human',
          type: 'user',
        });

      await ctx.request
        .post('/api/participants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          name: 'Bot',
          type: 'assistant',
          model: 'claude-3-5-sonnet-20241022',
        });

      const res = await ctx.request
        .post(`/api/participants/conversation/${conversationId}/assign-to-messages`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.updatedCount).toBe('number');
    });

    it('rejects without auth', async () => {
      const res = await ctx.request
        .post(`/api/participants/conversation/${conversationId}/assign-to-messages`);

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-accessible conversation', async () => {
      const other = await createAuthenticatedUser(ctx.request, {
        email: 'other-assign@example.com',
        password: 'otherpass1',
        name: 'Other Assigner',
      });

      const res = await ctx.request
        .post(`/api/participants/conversation/${conversationId}/assign-to-messages`)
        .set('Authorization', `Bearer ${other.token}`);

      expect(res.status).toBe(403);
    });
  });
});
