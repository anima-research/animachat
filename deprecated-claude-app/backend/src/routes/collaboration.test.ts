import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TestContext,
  createTestApp,
  cleanupTestApp,
  createAuthenticatedUser,
} from './test-helpers.js';

describe('Collaboration Routes', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let ownerUserId: string;
  let otherToken: string;
  let otherUserId: string;
  let otherEmail: string;
  let conversationId: string;

  beforeAll(async () => {
    ctx = await createTestApp();

    // Create owner user
    const owner = await createAuthenticatedUser(ctx.request, {
      email: 'collab-owner@example.com',
      password: 'ownerpass123',
      name: 'Collab Owner',
    });
    ownerToken = owner.token;
    ownerUserId = owner.userId;

    // Create another user to share with
    const other = await createAuthenticatedUser(ctx.request, {
      email: 'collab-other@example.com',
      password: 'otherpass123',
      name: 'Collab Other',
    });
    otherToken = other.token;
    otherUserId = other.userId;
    otherEmail = other.email;

    // Create a conversation owned by owner
    const convRes = await ctx.request
      .post('/api/conversations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Collab Test Conv', model: 'claude-3-5-sonnet-20241022' });
    conversationId = convRes.body.id;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // ───── Public invite token lookup ─────

  describe('GET /api/collaboration/invites/token/:token', () => {
    it('returns 404 for non-existent invite token', async () => {
      const res = await ctx.request.get(
        '/api/collaboration/invites/token/nonexistent-token-123'
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Invite not found or expired');
    });

    it('returns invite details for a valid token', async () => {
      // First create an invite so we have a valid token
      const createRes = await ctx.request
        .post('/api/collaboration/invites')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          conversationId,
          permission: 'viewer',
          label: 'Public Test Invite',
        });
      expect(createRes.status).toBe(200);
      const inviteToken = createRes.body.inviteToken;

      // Lookup the invite publicly
      const res = await ctx.request.get(
        `/api/collaboration/invites/token/${inviteToken}`
      );

      expect(res.status).toBe(200);
      expect(res.body.permission).toBe('viewer');
      expect(res.body.label).toBe('Public Test Invite');
      expect(res.body.conversationTitle).toBe('Collab Test Conv');
      expect(res.body.createdByName).toBe('Collab Owner');
    });
  });

  // ───── Create share (POST /share) ─────

  describe('POST /api/collaboration/share', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.post('/api/collaboration/share').send({
        conversationId,
        email: otherEmail,
        permission: 'viewer',
      });

      expect(res.status).toBe(401);
    });

    it('rejects with missing required fields', async () => {
      const res = await ctx.request
        .post('/api/collaboration/share')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ conversationId });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required fields');
    });

    it('rejects invalid permission value', async () => {
      const res = await ctx.request
        .post('/api/collaboration/share')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          conversationId,
          email: otherEmail,
          permission: 'superadmin',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid permission');
    });

    it('rejects sharing with yourself', async () => {
      const res = await ctx.request
        .post('/api/collaboration/share')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          conversationId,
          email: 'collab-owner@example.com',
          permission: 'viewer',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot share with yourself');
    });

    it('returns error for non-existent target email', async () => {
      const res = await ctx.request
        .post('/api/collaboration/share')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          conversationId,
          email: 'ghost@example.com',
          permission: 'viewer',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Failed to create share');
    });

    it('creates a share with valid data', async () => {
      const res = await ctx.request
        .post('/api/collaboration/share')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          conversationId,
          email: otherEmail,
          permission: 'collaborator',
        });

      expect(res.status).toBe(200);
      expect(res.body.share).toBeDefined();
      expect(res.body.share.permission).toBe('collaborator');
    });

    it('rejects duplicate share for same user', async () => {
      const res = await ctx.request
        .post('/api/collaboration/share')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          conversationId,
          email: otherEmail,
          permission: 'viewer',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Failed to create share');
    });
  });

  // ───── Update share permission ─────

  describe('PATCH /api/collaboration/shares/:shareId', () => {
    let shareId: string;

    beforeAll(async () => {
      // Create a second conversation and share it
      const convRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Patch Test Conv', model: 'claude-3-5-sonnet-20241022' });
      const conv2Id = convRes.body.id;

      const shareRes = await ctx.request
        .post('/api/collaboration/share')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          conversationId: conv2Id,
          email: otherEmail,
          permission: 'viewer',
        });
      shareId = shareRes.body.share.id;
    });

    it('rejects without auth', async () => {
      const res = await ctx.request
        .patch(`/api/collaboration/shares/${shareId}`)
        .send({ permission: 'editor' });

      expect(res.status).toBe(401);
    });

    it('rejects with missing permission', async () => {
      const res = await ctx.request
        .patch(`/api/collaboration/shares/${shareId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required field');
    });

    it('rejects invalid permission value', async () => {
      const res = await ctx.request
        .patch(`/api/collaboration/shares/${shareId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ permission: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid permission');
    });

    it('updates share permission successfully', async () => {
      const res = await ctx.request
        .patch(`/api/collaboration/shares/${shareId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ permission: 'editor' });

      expect(res.status).toBe(200);
      expect(res.body.share).toBeDefined();
      expect(res.body.share.permission).toBe('editor');
    });

    it('returns 404 for non-existent share ID', async () => {
      const res = await ctx.request
        .patch('/api/collaboration/shares/nonexistent-id')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ permission: 'viewer' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Share not found');
    });
  });

  // ───── Revoke share ─────

  describe('DELETE /api/collaboration/shares/:shareId', () => {
    let revokeShareId: string;

    beforeAll(async () => {
      // Create a conversation and share it
      const convRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Revoke Test Conv', model: 'claude-3-5-sonnet-20241022' });
      const conv3Id = convRes.body.id;

      const shareRes = await ctx.request
        .post('/api/collaboration/share')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          conversationId: conv3Id,
          email: otherEmail,
          permission: 'viewer',
        });
      revokeShareId = shareRes.body.share.id;
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.delete(
        `/api/collaboration/shares/${revokeShareId}`
      );
      expect(res.status).toBe(401);
    });

    it('deletes a share successfully', async () => {
      const res = await ctx.request
        .delete(`/api/collaboration/shares/${revokeShareId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for non-existent share ID', async () => {
      const res = await ctx.request
        .delete('/api/collaboration/shares/nonexistent-id')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Share not found');
    });
  });

  // ───── Get shares for a conversation ─────

  describe('GET /api/collaboration/conversation/:conversationId/shares', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.get(
        `/api/collaboration/conversation/${conversationId}/shares`
      );
      expect(res.status).toBe(401);
    });

    it('returns shares for a conversation the user owns', async () => {
      const res = await ctx.request
        .get(`/api/collaboration/conversation/${conversationId}/shares`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.shares).toBeDefined();
      expect(Array.isArray(res.body.shares)).toBe(true);
    });

    it('returns 403 for a conversation the user has no access to', async () => {
      // Create a third user with no access
      const third = await createAuthenticatedUser(ctx.request, {
        email: 'collab-third@example.com',
        password: 'thirdpass123',
        name: 'Third User',
      });

      const res = await ctx.request
        .get(`/api/collaboration/conversation/${conversationId}/shares`)
        .set('Authorization', `Bearer ${third.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied');
    });
  });

  // ───── Shared with me ─────

  describe('GET /api/collaboration/shared-with-me', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.get('/api/collaboration/shared-with-me');
      expect(res.status).toBe(401);
    });

    it('returns conversations shared with the user', async () => {
      const res = await ctx.request
        .get('/api/collaboration/shared-with-me')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.shares).toBeDefined();
      expect(Array.isArray(res.body.shares)).toBe(true);
      // The 'other' user had at least one conversation shared with them
      expect(res.body.shares.length).toBeGreaterThanOrEqual(1);

      // Verify enriched data
      const share = res.body.shares[0];
      expect(share.conversation).toBeDefined();
      expect(share.conversation.id).toBeDefined();
      expect(share.conversation.title).toBeDefined();
      expect(share.sharedBy).toBeDefined();
      expect(share.sharedBy.email).toBe('collab-owner@example.com');
    });

    it('returns empty for user with no shares', async () => {
      const lonely = await createAuthenticatedUser(ctx.request, {
        email: 'lonely@example.com',
        password: 'lonelypass1',
        name: 'Lonely User',
      });

      const res = await ctx.request
        .get('/api/collaboration/shared-with-me')
        .set('Authorization', `Bearer ${lonely.token}`);

      expect(res.status).toBe(200);
      expect(res.body.shares).toEqual([]);
    });
  });

  // ───── My permission ─────

  describe('GET /api/collaboration/conversation/:conversationId/my-permission', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.get(
        `/api/collaboration/conversation/${conversationId}/my-permission`
      );
      expect(res.status).toBe(401);
    });

    it('returns owner permission for conversation owner', async () => {
      const res = await ctx.request
        .get(`/api/collaboration/conversation/${conversationId}/my-permission`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.canAccess).toBe(true);
      expect(res.body.isOwner).toBe(true);
      expect(res.body.canChat).toBe(true);
      expect(res.body.canDelete).toBe(true);
    });

    it('returns collaborator permission for shared user', async () => {
      const res = await ctx.request
        .get(`/api/collaboration/conversation/${conversationId}/my-permission`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.canAccess).toBe(true);
      expect(res.body.isOwner).toBe(false);
      // Was shared with 'collaborator' permission
      expect(res.body.permission).toBe('collaborator');
      expect(res.body.canChat).toBe(true);
    });

    it('returns no access for unrelated user', async () => {
      const unrelated = await createAuthenticatedUser(ctx.request, {
        email: 'unrelated@example.com',
        password: 'unrelatedpass1',
        name: 'Unrelated User',
      });

      const res = await ctx.request
        .get(`/api/collaboration/conversation/${conversationId}/my-permission`)
        .set('Authorization', `Bearer ${unrelated.token}`);

      expect(res.status).toBe(200);
      expect(res.body.canAccess).toBe(false);
      expect(res.body.isOwner).toBe(false);
    });
  });

  // ───── Create invite link ─────

  describe('POST /api/collaboration/invites', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request
        .post('/api/collaboration/invites')
        .send({ conversationId, permission: 'viewer' });

      expect(res.status).toBe(401);
    });

    it('rejects with missing required fields', async () => {
      const res = await ctx.request
        .post('/api/collaboration/invites')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ conversationId });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required fields');
    });

    it('rejects invalid permission', async () => {
      const res = await ctx.request
        .post('/api/collaboration/invites')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ conversationId, permission: 'superadmin' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid permission');
    });

    it('rejects when user is not owner or editor', async () => {
      // Create a user who is only a viewer
      const viewer = await createAuthenticatedUser(ctx.request, {
        email: 'collab-viewer@example.com',
        password: 'viewerpass123',
        name: 'Viewer User',
      });

      // Create a conv and share with viewer as 'viewer' permission
      const convRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Viewer Conv', model: 'claude-3-5-sonnet-20241022' });

      await ctx.request
        .post('/api/collaboration/share')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          conversationId: convRes.body.id,
          email: 'collab-viewer@example.com',
          permission: 'viewer',
        });

      const res = await ctx.request
        .post('/api/collaboration/invites')
        .set('Authorization', `Bearer ${viewer.token}`)
        .send({ conversationId: convRes.body.id, permission: 'viewer' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Only owners and editors');
    });

    it('creates invite link successfully', async () => {
      const res = await ctx.request
        .post('/api/collaboration/invites')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          conversationId,
          permission: 'collaborator',
          label: 'Team invite',
          expiresInHours: 48,
          maxUses: 5,
        });

      expect(res.status).toBe(200);
      expect(res.body.inviteToken).toBeDefined();
      expect(res.body.inviteUrl).toContain('/invite/');
      expect(res.body.permission).toBe('collaborator');
    });
  });

  // ───── Claim invite ─────

  describe('POST /api/collaboration/invites/token/:token/claim', () => {
    let claimableToken: string;

    beforeAll(async () => {
      // Create an invite to be claimed
      const createRes = await ctx.request
        .post('/api/collaboration/invites')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          conversationId,
          permission: 'viewer',
          label: 'Claim test',
        });
      claimableToken = createRes.body.inviteToken;
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.post(
        `/api/collaboration/invites/token/${claimableToken}/claim`
      );
      expect(res.status).toBe(401);
    });

    it('claims invite successfully for new user', async () => {
      const claimer = await createAuthenticatedUser(ctx.request, {
        email: 'claimer@example.com',
        password: 'claimerpass1',
        name: 'Claimer',
      });

      const res = await ctx.request
        .post(`/api/collaboration/invites/token/${claimableToken}/claim`)
        .set('Authorization', `Bearer ${claimer.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.conversationId).toBe(conversationId);
      expect(res.body.permission).toBe('viewer');
    });

    it('returns error when user already has access', async () => {
      // Owner tries to claim their own conversation's invite
      const res = await ctx.request
        .post(`/api/collaboration/invites/token/${claimableToken}/claim`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('returns error for invalid token', async () => {
      const user = await createAuthenticatedUser(ctx.request, {
        email: 'badclaim@example.com',
        password: 'badclaimpass1',
        name: 'Bad Claimer',
      });

      const res = await ctx.request
        .post('/api/collaboration/invites/token/nonexistent-token/claim')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  // ───── Get invites for conversation ─────

  describe('GET /api/collaboration/conversation/:conversationId/invites', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.get(
        `/api/collaboration/conversation/${conversationId}/invites`
      );
      expect(res.status).toBe(401);
    });

    it('returns invites for conversation owner', async () => {
      const res = await ctx.request
        .get(`/api/collaboration/conversation/${conversationId}/invites`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.invites).toBeDefined();
      expect(Array.isArray(res.body.invites)).toBe(true);
      expect(res.body.invites.length).toBeGreaterThanOrEqual(1);
      // Each invite should have an inviteUrl
      expect(res.body.invites[0].inviteUrl).toContain('/invite/');
    });

    it('returns 403 for viewer user', async () => {
      const viewer = await createAuthenticatedUser(ctx.request, {
        email: 'invite-viewer@example.com',
        password: 'viewerpass123',
        name: 'Invite Viewer',
      });

      // Share as viewer only
      const convRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Invite List Conv', model: 'claude-3-5-sonnet-20241022' });

      await ctx.request
        .post('/api/collaboration/share')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          conversationId: convRes.body.id,
          email: 'invite-viewer@example.com',
          permission: 'viewer',
        });

      const res = await ctx.request
        .get(`/api/collaboration/conversation/${convRes.body.id}/invites`)
        .set('Authorization', `Bearer ${viewer.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied');
    });
  });

  // ───── Delete invite ─────

  describe('DELETE /api/collaboration/invites/:inviteId', () => {
    let deleteInviteId: string;

    beforeAll(async () => {
      const createRes = await ctx.request
        .post('/api/collaboration/invites')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          conversationId,
          permission: 'viewer',
          label: 'Delete test',
        });
      deleteInviteId = createRes.body.id;
    });

    it('rejects without auth', async () => {
      const res = await ctx.request.delete(
        `/api/collaboration/invites/${deleteInviteId}`
      );
      expect(res.status).toBe(401);
    });

    it('deletes invite successfully', async () => {
      const res = await ctx.request
        .delete(`/api/collaboration/invites/${deleteInviteId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for non-existent invite', async () => {
      const res = await ctx.request
        .delete('/api/collaboration/invites/nonexistent-id')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });
});
