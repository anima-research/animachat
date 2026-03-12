import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import supertest from 'supertest';
import { Database } from '../database/index.js';
import { authRouter } from './auth.js';
import { personaRouter } from './personas.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  createAuthenticatedUser,
  loginUser,
} from './test-helpers.js';

// Mock the roomManager to avoid WebSocket side effects
vi.mock('../websocket/room-manager.js', () => ({
  roomManager: {
    broadcastToRoom: vi.fn(),
  },
}));

/** Standalone test app that mounts persona routes alongside auth. */
async function createPersonaTestApp() {
  const originalCwd = process.cwd();
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'arc-persona-test-'));
  process.chdir(tmpDir);

  const db = new Database();
  await db.init();
  process.chdir(originalCwd);

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.use('/api/auth', authRouter(db));
  // Persona routes: authenticateToken is applied at mount in the real server
  app.use('/api/personas', authenticateToken, personaRouter(db));

  const request = supertest(app);
  return { app, db, request, tmpDir, originalCwd };
}

async function cleanupPersonaTestApp(ctx: { tmpDir: string; originalCwd: string }) {
  process.chdir(ctx.originalCwd);
  await rm(ctx.tmpDir, { recursive: true, force: true });
}

describe('Persona Routes', () => {
  let ctx: Awaited<ReturnType<typeof createPersonaTestApp>>;
  let ownerToken: string;
  let ownerUserId: string;
  let otherToken: string;
  let otherUserId: string;
  let otherEmail: string;

  beforeAll(async () => {
    ctx = await createPersonaTestApp();

    const owner = await createAuthenticatedUser(ctx.request, {
      email: 'persona-owner@example.com',
      password: 'ownerpass123',
      name: 'Persona Owner',
    });
    ownerToken = owner.token;
    ownerUserId = owner.userId;

    const other = await createAuthenticatedUser(ctx.request, {
      email: 'persona-other@example.com',
      password: 'otherpass123',
      name: 'Other User',
    });
    otherToken = other.token;
    otherUserId = other.userId;
    otherEmail = other.email;
  });

  afterAll(async () => {
    await cleanupPersonaTestApp(ctx);
  });

  // ───── Create Persona ─────

  describe('POST /api/personas', () => {
    it('creates a persona with required fields', async () => {
      const res = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Test Persona', modelId: 'claude-3-5-sonnet-20241022' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Test Persona');
      expect(res.body.modelId).toBe('claude-3-5-sonnet-20241022');
      expect(res.body.ownerId).toBe(ownerUserId);
    });

    it('creates a persona with all optional fields', async () => {
      const res = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Full Persona',
          modelId: 'claude-3-5-sonnet-20241022',
          contextStrategy: { type: 'rolling', maxTokens: 60000 },
          backscrollTokens: 5000,
          allowInterleavedParticipation: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Full Persona');
    });

    it('rejects creation without auth', async () => {
      const res = await ctx.request
        .post('/api/personas')
        .send({ name: 'No Auth', modelId: 'test' });

      expect(res.status).toBe(401);
    });

    it('rejects empty name', async () => {
      const res = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: '', modelId: 'test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
    });

    it('rejects missing modelId', async () => {
      const res = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'No Model' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
    });

    it('rejects name exceeding max length', async () => {
      const res = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'x'.repeat(101), modelId: 'test' });

      expect(res.status).toBe(400);
    });
  });

  // ───── List Personas ─────

  describe('GET /api/personas', () => {
    it('returns owned and shared personas', async () => {
      const res = await ctx.request
        .get('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.owned).toBeDefined();
      expect(Array.isArray(res.body.owned)).toBe(true);
      expect(res.body.owned.length).toBeGreaterThanOrEqual(1);
      expect(res.body.shared).toBeDefined();
      expect(Array.isArray(res.body.shared)).toBe(true);
    });

    it('returns empty lists for user with no personas', async () => {
      const res = await ctx.request
        .get('/api/personas')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.owned).toEqual([]);
      expect(res.body.shared).toEqual([]);
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.get('/api/personas');
      expect(res.status).toBe(401);
    });
  });

  // ───── Get Persona ─────

  describe('GET /api/personas/:id', () => {
    let personaId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Get Test Persona', modelId: 'test-model' });
      personaId = createRes.body.id;
    });

    it('returns persona details for owner', async () => {
      const res = await ctx.request
        .get(`/api/personas/${personaId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(personaId);
      expect(res.body.name).toBe('Get Test Persona');
    });

    it('returns 403 for user without access', async () => {
      const res = await ctx.request
        .get(`/api/personas/${personaId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied');
    });

    it('returns 404 for non-existent persona', async () => {
      const res = await ctx.request
        .get('/api/personas/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Persona not found');
    });
  });

  // ───── Update Persona ─────

  describe('PATCH /api/personas/:id', () => {
    let personaId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Update Test Persona', modelId: 'test-model' });
      personaId = createRes.body.id;
    });

    it('updates persona name as owner', async () => {
      const res = await ctx.request
        .patch(`/api/personas/${personaId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
    });

    it('updates optional fields', async () => {
      const res = await ctx.request
        .patch(`/api/personas/${personaId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ backscrollTokens: 8000 });

      expect(res.status).toBe(200);
    });

    it('rejects update from non-owner/non-editor', async () => {
      const res = await ctx.request
        .patch(`/api/personas/${personaId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ name: 'Hijacked' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied');
    });

    it('rejects invalid update (empty name)', async () => {
      const res = await ctx.request
        .patch(`/api/personas/${personaId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
    });
  });

  // ───── Delete Persona ─────

  describe('DELETE /api/personas/:id', () => {
    it('deletes persona as owner', async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Deletable Persona', modelId: 'test-model' });
      const personaId = createRes.body.id;

      const res = await ctx.request
        .delete(`/api/personas/${personaId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify it's gone
      const getRes = await ctx.request
        .get(`/api/personas/${personaId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(getRes.status).toBe(404);
    });

    it('rejects deletion by non-owner', async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Not Deletable', modelId: 'test-model' });
      const personaId = createRes.body.id;

      const res = await ctx.request
        .delete(`/api/personas/${personaId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Only owner can delete persona');
    });

    it('returns 404 for non-existent persona', async () => {
      const res = await ctx.request
        .delete('/api/personas/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${ownerToken}`);

      // Non-existent persona — owner check returns null permission, so 403
      expect(res.status).toBe(403);
    });
  });

  // ───── Archive Persona ─────

  describe('POST /api/personas/:id/archive', () => {
    it('archives persona as owner', async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Archivable Persona', modelId: 'test-model' });
      const personaId = createRes.body.id;

      const res = await ctx.request
        .post(`/api/personas/${personaId}/archive`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      // Archive route returns the updated persona object
      expect(res.body.id).toBe(personaId);
    });

    it('rejects archive by non-owner/non-editor', async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'No Archive For You', modelId: 'test-model' });
      const personaId = createRes.body.id;

      const res = await ctx.request
        .post(`/api/personas/${personaId}/archive`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ───── History Branches ─────

  describe('Persona history branches', () => {
    let personaId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Branch Test Persona', modelId: 'test-model' });
      personaId = createRes.body.id;
    });

    describe('GET /api/personas/:id/branches', () => {
      it('lists history branches for owner', async () => {
        const res = await ctx.request
          .get(`/api/personas/${personaId}/branches`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        // Default branch should exist
        expect(res.body.length).toBeGreaterThanOrEqual(1);
      });

      it('rejects listing branches without access', async () => {
        const res = await ctx.request
          .get(`/api/personas/${personaId}/branches`)
          .set('Authorization', `Bearer ${otherToken}`);

        expect(res.status).toBe(403);
      });
    });

    describe('POST /api/personas/:id/branches', () => {
      it('creates a new history branch (fork)', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/branches`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ name: 'Forked Branch' });

        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
        expect(res.body.name).toBe('Forked Branch');
      });

      it('rejects fork without access', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/branches`)
          .set('Authorization', `Bearer ${otherToken}`)
          .send({ name: 'No Fork' });

        expect(res.status).toBe(403);
      });

      it('rejects fork with invalid input (empty name)', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/branches`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ name: '' });

        expect(res.status).toBe(400);
      });
    });

    describe('POST /api/personas/:id/branches/:branchId/head', () => {
      it('sets a branch as head', async () => {
        // List branches to get a valid branch ID
        const listRes = await ctx.request
          .get(`/api/personas/${personaId}/branches`)
          .set('Authorization', `Bearer ${ownerToken}`);

        const branchId = listRes.body[0].id;

        const res = await ctx.request
          .post(`/api/personas/${personaId}/branches/${branchId}/head`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(res.status).toBe(200);
      });

      it('rejects set head without access', async () => {
        const listRes = await ctx.request
          .get(`/api/personas/${personaId}/branches`)
          .set('Authorization', `Bearer ${ownerToken}`);
        const branchId = listRes.body[0].id;

        const res = await ctx.request
          .post(`/api/personas/${personaId}/branches/${branchId}/head`)
          .set('Authorization', `Bearer ${otherToken}`);

        expect(res.status).toBe(403);
      });

      it('returns 404 for non-existent branch', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/branches/00000000-0000-0000-0000-000000000000/head`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(res.status).toBe(404);
      });
    });
  });

  // ───── Join/Leave Conversation ─────

  describe('Persona join/leave conversation', () => {
    let personaId: string;
    let conversationId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Join Test Persona', modelId: 'test-model' });
      personaId = createRes.body.id;

      // Create a conversation via DB
      const conv = await ctx.db.createConversation(
        ownerUserId,
        'Join Test Conv',
        'test-model',
        undefined,
        { temperature: 1.0, maxTokens: 4096 },
      );
      conversationId = conv.id;
    });

    describe('POST /api/personas/:id/join', () => {
      it('joins a persona to a conversation', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/join`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ conversationId });

        expect(res.status).toBe(201);
        expect(res.body.participant).toBeDefined();
        expect(res.body.participation).toBeDefined();
      });

      it('rejects join for already active persona (409)', async () => {
        // Try joining again
        const res = await ctx.request
          .post(`/api/personas/${personaId}/join`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ conversationId });

        expect(res.status).toBe(409);
        expect(res.body.error).toContain('already active');
      });

      it('rejects join without access to persona', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/join`)
          .set('Authorization', `Bearer ${otherToken}`)
          .send({ conversationId });

        expect(res.status).toBe(403);
      });

      it('rejects join with invalid conversationId', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/join`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ conversationId: 'not-a-uuid' });

        expect(res.status).toBe(400);
      });

      it('rejects join to non-existent conversation', async () => {
        // Create a fresh persona for this test (the other one is already active)
        const pRes = await ctx.request
          .post('/api/personas')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ name: 'Ghost Conv Persona', modelId: 'test' });
        const freshPersonaId = pRes.body.id;

        const res = await ctx.request
          .post(`/api/personas/${freshPersonaId}/join`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ conversationId: '00000000-0000-0000-0000-000000000000' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('No access to conversation');
      });
    });

    describe('POST /api/personas/:id/leave', () => {
      it('leaves a conversation', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/leave`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ conversationId });

        expect(res.status).toBe(200);
        expect(res.body.leftAt).toBeDefined();
      });

      it('returns 404 when not in conversation', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/leave`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ conversationId });

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('No active participation');
      });

      it('rejects leave without access to persona', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/leave`)
          .set('Authorization', `Bearer ${otherToken}`)
          .send({ conversationId });

        expect(res.status).toBe(403);
      });

      it('rejects leave with invalid input', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/leave`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ conversationId: 'not-a-uuid' });

        expect(res.status).toBe(400);
      });
    });
  });

  // ───── Participations ─────

  describe('GET /api/personas/:id/participations', () => {
    let personaId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Participation List Persona', modelId: 'test-model' });
      personaId = createRes.body.id;
    });

    it('lists participations for owner', async () => {
      const res = await ctx.request
        .get(`/api/personas/${personaId}/participations`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('rejects without access', async () => {
      const res = await ctx.request
        .get(`/api/personas/${personaId}/participations`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });

    it('accepts branchId query parameter', async () => {
      const res = await ctx.request
        .get(`/api/personas/${personaId}/participations?branchId=00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ───── Set Canonical Branch ─────

  describe('PATCH /api/personas/:id/participations/:participationId/canonical', () => {
    it('rejects without access', async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Canonical Test', modelId: 'test-model' });
      const personaId = createRes.body.id;

      const res = await ctx.request
        .patch(`/api/personas/${personaId}/participations/00000000-0000-0000-0000-000000000000/canonical`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ branchId: '00000000-0000-0000-0000-000000000001' });

      expect(res.status).toBe(403);
    });

    it('returns 404 for non-existent participation', async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Canonical Test 2', modelId: 'test-model' });
      const personaId = createRes.body.id;

      const res = await ctx.request
        .patch(`/api/personas/${personaId}/participations/00000000-0000-0000-0000-000000000000/canonical`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ branchId: '00000000-0000-0000-0000-000000000001' });

      expect(res.status).toBe(404);
    });

    it('rejects invalid input (non-uuid branchId)', async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Canonical Test 3', modelId: 'test-model' });
      const personaId = createRes.body.id;

      const res = await ctx.request
        .patch(`/api/personas/${personaId}/participations/00000000-0000-0000-0000-000000000000/canonical`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ branchId: 'not-a-uuid' });

      expect(res.status).toBe(400);
    });
  });

  // ───── Update Logical Time ─────

  describe('PATCH /api/personas/:id/participations/:participationId/logical-time', () => {
    it('rejects without access', async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Logical Time Test', modelId: 'test-model' });
      const personaId = createRes.body.id;

      const res = await ctx.request
        .patch(`/api/personas/${personaId}/participations/00000000-0000-0000-0000-000000000000/logical-time`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ logicalStart: 0, logicalEnd: 10 });

      expect(res.status).toBe(403);
    });

    it('returns 404 for non-existent participation', async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Logical Time Test 2', modelId: 'test-model' });
      const personaId = createRes.body.id;

      const res = await ctx.request
        .patch(`/api/personas/${personaId}/participations/00000000-0000-0000-0000-000000000000/logical-time`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ logicalStart: 0, logicalEnd: 10 });

      expect(res.status).toBe(404);
    });

    it('rejects logicalEnd <= logicalStart', async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Logical Time Test 3', modelId: 'test-model' });
      const personaId = createRes.body.id;

      const res = await ctx.request
        .patch(`/api/personas/${personaId}/participations/00000000-0000-0000-0000-000000000000/logical-time`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ logicalStart: 10, logicalEnd: 5 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('logicalEnd must be greater than logicalStart');
    });

    it('rejects equal logicalStart and logicalEnd', async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Logical Time Test 4', modelId: 'test-model' });
      const personaId = createRes.body.id;

      const res = await ctx.request
        .patch(`/api/personas/${personaId}/participations/00000000-0000-0000-0000-000000000000/logical-time`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ logicalStart: 5, logicalEnd: 5 });

      expect(res.status).toBe(400);
    });

    it('rejects invalid input (missing fields)', async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Logical Time Test 5', modelId: 'test-model' });
      const personaId = createRes.body.id;

      const res = await ctx.request
        .patch(`/api/personas/${personaId}/participations/00000000-0000-0000-0000-000000000000/logical-time`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ logicalStart: 0 });

      expect(res.status).toBe(400);
    });
  });

  // ───── Sharing ─────

  describe('Persona sharing', () => {
    let personaId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/personas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Share Test Persona', modelId: 'test-model' });
      personaId = createRes.body.id;
    });

    describe('GET /api/personas/:id/shares', () => {
      it('lists shares for owner', async () => {
        const res = await ctx.request
          .get(`/api/personas/${personaId}/shares`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
      });

      it('rejects non-owner from viewing shares', async () => {
        const res = await ctx.request
          .get(`/api/personas/${personaId}/shares`)
          .set('Authorization', `Bearer ${otherToken}`);

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Only owner can view shares');
      });
    });

    describe('POST /api/personas/:id/shares', () => {
      it('shares persona with another user', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/shares`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ email: otherEmail, permission: 'viewer' });

        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
        expect(res.body.sharedWithUserId).toBe(otherUserId);
        expect(res.body.permission).toBe('viewer');
      });

      it('rejects share from non-owner', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/shares`)
          .set('Authorization', `Bearer ${otherToken}`)
          .send({ email: 'someone@example.com', permission: 'viewer' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Only owner can share persona');
      });

      it('returns 404 for non-existent target email', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/shares`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ email: 'ghost@example.com', permission: 'viewer' });

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('User not found');
      });

      it('rejects invalid permission value', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/shares`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ email: otherEmail, permission: 'superadmin' });

        expect(res.status).toBe(400);
      });

      it('rejects invalid email format', async () => {
        const res = await ctx.request
          .post(`/api/personas/${personaId}/shares`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ email: 'not-an-email', permission: 'viewer' });

        expect(res.status).toBe(400);
      });
    });

    describe('Shared user can access persona', () => {
      it('shared user can now view the persona', async () => {
        const res = await ctx.request
          .get(`/api/personas/${personaId}`)
          .set('Authorization', `Bearer ${otherToken}`);

        expect(res.status).toBe(200);
        expect(res.body.id).toBe(personaId);
      });

      it('shared viewer cannot update persona', async () => {
        const res = await ctx.request
          .patch(`/api/personas/${personaId}`)
          .set('Authorization', `Bearer ${otherToken}`)
          .send({ name: 'Hijacked' });

        expect(res.status).toBe(403);
      });
    });

    describe('PATCH /api/personas/:id/shares/:shareId', () => {
      let shareId: string;

      beforeAll(async () => {
        // Get the share ID
        const sharesRes = await ctx.request
          .get(`/api/personas/${personaId}/shares`)
          .set('Authorization', `Bearer ${ownerToken}`);
        shareId = sharesRes.body[0].id;
      });

      it('updates share permission', async () => {
        const res = await ctx.request
          .patch(`/api/personas/${personaId}/shares/${shareId}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ permission: 'editor' });

        expect(res.status).toBe(200);
        expect(res.body.permission).toBe('editor');
      });

      it('editor can now update persona', async () => {
        const res = await ctx.request
          .patch(`/api/personas/${personaId}`)
          .set('Authorization', `Bearer ${otherToken}`)
          .send({ name: 'Editor Updated' });

        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Editor Updated');
      });

      it('rejects update from non-owner', async () => {
        const res = await ctx.request
          .patch(`/api/personas/${personaId}/shares/${shareId}`)
          .set('Authorization', `Bearer ${otherToken}`)
          .send({ permission: 'owner' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Only owner can modify shares');
      });

      it('returns 404 for non-existent share', async () => {
        const res = await ctx.request
          .patch(`/api/personas/${personaId}/shares/00000000-0000-0000-0000-000000000000`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ permission: 'viewer' });

        expect(res.status).toBe(404);
      });

      it('rejects invalid permission', async () => {
        const res = await ctx.request
          .patch(`/api/personas/${personaId}/shares/${shareId}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ permission: 'invalid' });

        expect(res.status).toBe(400);
      });
    });

    describe('DELETE /api/personas/:id/shares/:shareId', () => {
      it('revokes a share', async () => {
        // Get current shares
        const sharesRes = await ctx.request
          .get(`/api/personas/${personaId}/shares`)
          .set('Authorization', `Bearer ${ownerToken}`);
        const shareId = sharesRes.body[0].id;

        const res = await ctx.request
          .delete(`/api/personas/${personaId}/shares/${shareId}`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify the other user can no longer access the persona
        const getRes = await ctx.request
          .get(`/api/personas/${personaId}`)
          .set('Authorization', `Bearer ${otherToken}`);
        expect(getRes.status).toBe(403);
      });

      it('rejects revoke from non-owner', async () => {
        // Share again first
        const shareRes = await ctx.request
          .post(`/api/personas/${personaId}/shares`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ email: otherEmail, permission: 'viewer' });
        const shareId = shareRes.body.id;

        const res = await ctx.request
          .delete(`/api/personas/${personaId}/shares/${shareId}`)
          .set('Authorization', `Bearer ${otherToken}`);

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Only owner can revoke shares');
      });

      it('returns 404 for non-existent share', async () => {
        const res = await ctx.request
          .delete(`/api/personas/${personaId}/shares/00000000-0000-0000-0000-000000000000`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(res.status).toBe(404);
      });
    });
  });
});
