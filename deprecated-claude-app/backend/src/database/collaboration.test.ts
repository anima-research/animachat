import { describe, it, expect, beforeEach } from 'vitest';
import { CollaborationStore, CollaborationInvite } from './collaboration.js';

describe('CollaborationStore', () => {
  let store: CollaborationStore;

  beforeEach(() => {
    store = new CollaborationStore();
  });

  describe('createShare', () => {
    it('creates a share and returns the share object with event data', () => {
      const { share, eventData } = store.createShare(
        'conv-1', 'user-2', 'user2@test.com', 'user-1', 'viewer'
      );

      expect(share.conversationId).toBe('conv-1');
      expect(share.sharedWithUserId).toBe('user-2');
      expect(share.sharedWithEmail).toBe('user2@test.com');
      expect(share.sharedByUserId).toBe('user-1');
      expect(share.permission).toBe('viewer');
      expect(share.id).toBeTruthy();
      expect(share.createdAt).toBeTruthy();

      expect(eventData.type).toBe('collaboration_share_created');
      expect(eventData.data.id).toBe(share.id);
    });

    it('makes the share immediately queryable', () => {
      const { share } = store.createShare(
        'conv-1', 'user-2', 'user2@test.com', 'user-1', 'editor'
      );

      const retrieved = store.getShare(share.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.permission).toBe('editor');
    });

    it('creates multiple shares for different users on same conversation', () => {
      store.createShare('conv-1', 'user-2', 'u2@t.com', 'user-1', 'viewer');
      store.createShare('conv-1', 'user-3', 'u3@t.com', 'user-1', 'collaborator');

      const shares = store.getSharesForConversation('conv-1');
      expect(shares).toHaveLength(2);
    });
  });

  describe('updateSharePermission', () => {
    it('updates the permission on an existing share', () => {
      const { share } = store.createShare(
        'conv-1', 'user-2', 'u2@t.com', 'user-1', 'viewer'
      );

      const { share: updated, eventData } = store.updateSharePermission(
        share.id, 'editor', 'user-1'
      );

      expect(updated).not.toBeNull();
      expect(updated!.permission).toBe('editor');
      expect(eventData.type).toBe('collaboration_share_updated');
    });

    it('returns null for nonexistent share', () => {
      const { share, eventData } = store.updateSharePermission(
        'nonexistent-id', 'editor', 'user-1'
      );

      expect(share).toBeNull();
      expect(eventData).toBeNull();
    });

    it('sets updatedAt on the share', () => {
      const { share } = store.createShare(
        'conv-1', 'user-2', 'u2@t.com', 'user-1', 'viewer'
      );

      store.updateSharePermission(share.id, 'collaborator', 'user-1');
      const retrieved = store.getShare(share.id);
      expect(retrieved!.updatedAt).toBeTruthy();
    });
  });

  describe('revokeShare', () => {
    it('removes the share from all indexes', () => {
      const { share } = store.createShare(
        'conv-1', 'user-2', 'u2@t.com', 'user-1', 'viewer'
      );

      const { success, eventData } = store.revokeShare(share.id, 'user-1');
      expect(success).toBe(true);
      expect(eventData!.type).toBe('collaboration_share_revoked');

      expect(store.getShare(share.id)).toBeUndefined();
      expect(store.getSharesForConversation('conv-1')).toHaveLength(0);
      expect(store.getSharesForUser('user-2')).toHaveLength(0);
    });

    it('returns false for nonexistent share', () => {
      const { success, eventData } = store.revokeShare('nonexistent', 'user-1');
      expect(success).toBe(false);
      expect(eventData).toBeNull();
    });

    it('does not affect other shares on the same conversation', () => {
      const { share: s1 } = store.createShare('conv-1', 'user-2', 'u2@t.com', 'user-1', 'viewer');
      store.createShare('conv-1', 'user-3', 'u3@t.com', 'user-1', 'editor');

      store.revokeShare(s1.id, 'user-1');
      const remaining = store.getSharesForConversation('conv-1');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].sharedWithUserId).toBe('user-3');
    });
  });

  describe('getSharesForConversation', () => {
    it('returns empty array for unknown conversation', () => {
      expect(store.getSharesForConversation('unknown')).toEqual([]);
    });

    it('returns all shares for a conversation', () => {
      store.createShare('conv-1', 'user-2', 'u2@t.com', 'user-1', 'viewer');
      store.createShare('conv-1', 'user-3', 'u3@t.com', 'user-1', 'editor');
      store.createShare('conv-2', 'user-4', 'u4@t.com', 'user-1', 'viewer');

      const conv1Shares = store.getSharesForConversation('conv-1');
      expect(conv1Shares).toHaveLength(2);
      const conv2Shares = store.getSharesForConversation('conv-2');
      expect(conv2Shares).toHaveLength(1);
    });
  });

  describe('getSharesForUser', () => {
    it('returns empty array for unknown user', () => {
      expect(store.getSharesForUser('unknown')).toEqual([]);
    });

    it('returns all shares for a user across conversations', () => {
      store.createShare('conv-1', 'user-2', 'u2@t.com', 'user-1', 'viewer');
      store.createShare('conv-2', 'user-2', 'u2@t.com', 'user-1', 'editor');

      const shares = store.getSharesForUser('user-2');
      expect(shares).toHaveLength(2);
      const convIds = shares.map(s => s.conversationId).sort();
      expect(convIds).toEqual(['conv-1', 'conv-2']);
    });
  });

  describe('getUserPermission', () => {
    it('returns the permission for a user on a conversation', () => {
      store.createShare('conv-1', 'user-2', 'u2@t.com', 'user-1', 'collaborator');
      expect(store.getUserPermission('conv-1', 'user-2')).toBe('collaborator');
    });

    it('returns null when user has no share', () => {
      expect(store.getUserPermission('conv-1', 'user-2')).toBeNull();
    });

    it('returns null for unknown conversation', () => {
      expect(store.getUserPermission('unknown', 'user-2')).toBeNull();
    });
  });

  describe('hasExistingShare', () => {
    it('returns true when user has a share', () => {
      store.createShare('conv-1', 'user-2', 'u2@t.com', 'user-1', 'viewer');
      expect(store.hasExistingShare('conv-1', 'user-2')).toBe(true);
    });

    it('returns false when user has no share', () => {
      expect(store.hasExistingShare('conv-1', 'user-2')).toBe(false);
    });

    it('returns false after share is revoked', () => {
      const { share } = store.createShare('conv-1', 'user-2', 'u2@t.com', 'user-1', 'viewer');
      store.revokeShare(share.id, 'user-1');
      expect(store.hasExistingShare('conv-1', 'user-2')).toBe(false);
    });
  });

  describe('createInvite', () => {
    it('creates an invite with a unique token', () => {
      const { invite, eventData } = store.createInvite(
        'conv-1', 'user-1', 'viewer'
      );

      expect(invite.conversationId).toBe('conv-1');
      expect(invite.createdByUserId).toBe('user-1');
      expect(invite.permission).toBe('viewer');
      expect(invite.inviteToken).toMatch(/^[0-9a-f]{12}$/);
      expect(invite.useCount).toBe(0);
      expect(invite.expiresAt).toBeUndefined();
      expect(invite.maxUses).toBeUndefined();

      expect(eventData.type).toBe('collaboration_invite_created');
    });

    it('creates invite with expiration', () => {
      const { invite } = store.createInvite('conv-1', 'user-1', 'viewer', {
        expiresInHours: 24
      });

      expect(invite.expiresAt).toBeTruthy();
      const expiresDate = new Date(invite.expiresAt!);
      // Should expire roughly 24 hours from now
      const diff = expiresDate.getTime() - Date.now();
      expect(diff).toBeGreaterThan(23 * 60 * 60 * 1000); // at least 23 hours
      expect(diff).toBeLessThan(25 * 60 * 60 * 1000); // at most 25 hours
    });

    it('creates invite with max uses and label', () => {
      const { invite } = store.createInvite('conv-1', 'user-1', 'collaborator', {
        maxUses: 5,
        label: 'Team invite'
      });

      expect(invite.maxUses).toBe(5);
      expect(invite.label).toBe('Team invite');
    });

    it('generates unique tokens for multiple invites', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const { invite } = store.createInvite('conv-1', 'user-1', 'viewer');
        tokens.add(invite.inviteToken);
      }
      expect(tokens.size).toBe(10);
    });
  });

  describe('getInviteByToken', () => {
    it('returns invite for valid token', () => {
      const { invite: created } = store.createInvite('conv-1', 'user-1', 'viewer');
      const found = store.getInviteByToken(created.inviteToken);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('returns null for unknown token', () => {
      expect(store.getInviteByToken('unknown')).toBeNull();
    });

    it('returns null for expired invite', () => {
      const { invite } = store.createInvite('conv-1', 'user-1', 'viewer', {
        expiresInHours: 0 // expires immediately (0 hours = now)
      });
      // Manually set expiration in the past
      // We need to access the internal invite via getInviteById
      const internalInvite = store.getInviteById(invite.id);
      if (internalInvite) {
        internalInvite.expiresAt = new Date(Date.now() - 1000).toISOString();
      }

      expect(store.getInviteByToken(invite.inviteToken)).toBeNull();
    });

    it('returns null when max uses exceeded', () => {
      const { invite } = store.createInvite('conv-1', 'user-1', 'viewer', {
        maxUses: 1
      });

      // Use the invite once
      store.useInvite(invite.id);

      // Should now return null since max uses reached
      expect(store.getInviteByToken(invite.inviteToken)).toBeNull();
    });
  });

  describe('getInviteById', () => {
    it('returns invite by ID', () => {
      const { invite } = store.createInvite('conv-1', 'user-1', 'viewer');
      expect(store.getInviteById(invite.id)).toBeDefined();
      expect(store.getInviteById(invite.id)!.id).toBe(invite.id);
    });

    it('returns undefined for unknown ID', () => {
      expect(store.getInviteById('unknown')).toBeUndefined();
    });
  });

  describe('getInvitesForConversation', () => {
    it('returns empty array for unknown conversation', () => {
      expect(store.getInvitesForConversation('unknown')).toEqual([]);
    });

    it('returns active invites only (filters expired and maxed)', () => {
      // Active invite
      store.createInvite('conv-1', 'user-1', 'viewer');

      // Expired invite
      const { invite: expired } = store.createInvite('conv-1', 'user-1', 'viewer');
      const internalExpired = store.getInviteById(expired.id);
      if (internalExpired) {
        internalExpired.expiresAt = new Date(Date.now() - 1000).toISOString();
      }

      // Maxed-out invite
      const { invite: maxed } = store.createInvite('conv-1', 'user-1', 'viewer', {
        maxUses: 1
      });
      store.useInvite(maxed.id);

      const invites = store.getInvitesForConversation('conv-1');
      expect(invites).toHaveLength(1); // only the active one
    });

    it('does not include invites from other conversations', () => {
      store.createInvite('conv-1', 'user-1', 'viewer');
      store.createInvite('conv-2', 'user-1', 'viewer');

      expect(store.getInvitesForConversation('conv-1')).toHaveLength(1);
      expect(store.getInvitesForConversation('conv-2')).toHaveLength(1);
    });
  });

  describe('useInvite', () => {
    it('increments use count', () => {
      const { invite } = store.createInvite('conv-1', 'user-1', 'viewer');
      expect(invite.useCount).toBe(0);

      const { success, eventData } = store.useInvite(invite.id);
      expect(success).toBe(true);
      expect(eventData!.type).toBe('collaboration_invite_used');
      expect(eventData!.data.useCount).toBe(1);

      const updated = store.getInviteById(invite.id);
      expect(updated!.useCount).toBe(1);
    });

    it('tracks multiple uses', () => {
      const { invite } = store.createInvite('conv-1', 'user-1', 'viewer');

      store.useInvite(invite.id);
      store.useInvite(invite.id);
      store.useInvite(invite.id);

      const updated = store.getInviteById(invite.id);
      expect(updated!.useCount).toBe(3);
    });

    it('returns false for nonexistent invite', () => {
      const { success, eventData } = store.useInvite('nonexistent');
      expect(success).toBe(false);
      expect(eventData).toBeNull();
    });
  });

  describe('deleteInvite', () => {
    it('removes invite from all indexes', () => {
      const { invite } = store.createInvite('conv-1', 'user-1', 'viewer');

      const { success, eventData } = store.deleteInvite(invite.id, 'user-1');
      expect(success).toBe(true);
      expect(eventData!.type).toBe('collaboration_invite_deleted');

      expect(store.getInviteById(invite.id)).toBeUndefined();
      expect(store.getInviteByToken(invite.inviteToken)).toBeNull();
      expect(store.getInvitesForConversation('conv-1')).toHaveLength(0);
    });

    it('returns false if not the creator', () => {
      const { invite } = store.createInvite('conv-1', 'user-1', 'viewer');

      const { success, eventData } = store.deleteInvite(invite.id, 'user-2');
      expect(success).toBe(false);
      expect(eventData).toBeNull();

      // Invite still exists
      expect(store.getInviteById(invite.id)).toBeDefined();
    });

    it('returns false for nonexistent invite', () => {
      const { success, eventData } = store.deleteInvite('nonexistent', 'user-1');
      expect(success).toBe(false);
      expect(eventData).toBeNull();
    });
  });

  describe('replayEvent', () => {
    it('rebuilds share state from events', () => {
      const newStore = new CollaborationStore();
      const now = new Date().toISOString();

      newStore.replayEvent({
        type: 'collaboration_share_created',
        data: {
          id: 'share-1',
          conversationId: 'conv-1',
          sharedWithUserId: 'user-2',
          sharedWithEmail: 'u2@t.com',
          sharedByUserId: 'user-1',
          permission: 'viewer',
          createdAt: now
        }
      });

      const share = newStore.getShare('share-1');
      expect(share).toBeDefined();
      expect(share!.permission).toBe('viewer');
      expect(newStore.getSharesForConversation('conv-1')).toHaveLength(1);
      expect(newStore.getSharesForUser('user-2')).toHaveLength(1);
    });

    it('replays share update event', () => {
      const newStore = new CollaborationStore();
      const now = new Date().toISOString();

      newStore.replayEvent({
        type: 'collaboration_share_created',
        data: {
          id: 'share-1',
          conversationId: 'conv-1',
          sharedWithUserId: 'user-2',
          sharedWithEmail: 'u2@t.com',
          sharedByUserId: 'user-1',
          permission: 'viewer',
          createdAt: now
        }
      });

      newStore.replayEvent({
        type: 'collaboration_share_updated',
        data: {
          shareId: 'share-1',
          permission: 'editor',
          time: now
        }
      });

      const share = newStore.getShare('share-1');
      expect(share!.permission).toBe('editor');
      expect(share!.updatedAt).toBe(now);
    });

    it('replays share revocation event', () => {
      const newStore = new CollaborationStore();
      const now = new Date().toISOString();

      newStore.replayEvent({
        type: 'collaboration_share_created',
        data: {
          id: 'share-1',
          conversationId: 'conv-1',
          sharedWithUserId: 'user-2',
          sharedWithEmail: 'u2@t.com',
          sharedByUserId: 'user-1',
          permission: 'viewer',
          createdAt: now
        }
      });

      newStore.replayEvent({
        type: 'collaboration_share_revoked',
        data: { shareId: 'share-1' }
      });

      expect(newStore.getShare('share-1')).toBeUndefined();
      expect(newStore.getSharesForConversation('conv-1')).toHaveLength(0);
    });

    it('rebuilds invite state from events', () => {
      const newStore = new CollaborationStore();
      const now = new Date().toISOString();

      newStore.replayEvent({
        type: 'collaboration_invite_created',
        data: {
          id: 'inv-1',
          conversationId: 'conv-1',
          createdByUserId: 'user-1',
          inviteToken: 'abc123def456',
          permission: 'viewer',
          useCount: 0,
          createdAt: now
        }
      });

      const invite = newStore.getInviteById('inv-1');
      expect(invite).toBeDefined();
      expect(invite!.inviteToken).toBe('abc123def456');
      expect(newStore.getInviteByToken('abc123def456')).not.toBeNull();
    });

    it('replays invite used event', () => {
      const newStore = new CollaborationStore();
      const now = new Date().toISOString();

      newStore.replayEvent({
        type: 'collaboration_invite_created',
        data: {
          id: 'inv-1',
          conversationId: 'conv-1',
          createdByUserId: 'user-1',
          inviteToken: 'abc123def456',
          permission: 'viewer',
          useCount: 0,
          createdAt: now
        }
      });

      newStore.replayEvent({
        type: 'collaboration_invite_used',
        data: { inviteId: 'inv-1', useCount: 3 }
      });

      const invite = newStore.getInviteById('inv-1');
      expect(invite!.useCount).toBe(3);
    });

    it('replays invite deletion event', () => {
      const newStore = new CollaborationStore();
      const now = new Date().toISOString();

      newStore.replayEvent({
        type: 'collaboration_invite_created',
        data: {
          id: 'inv-1',
          conversationId: 'conv-1',
          createdByUserId: 'user-1',
          inviteToken: 'abc123def456',
          permission: 'viewer',
          useCount: 0,
          createdAt: now
        }
      });

      newStore.replayEvent({
        type: 'collaboration_invite_deleted',
        data: { inviteId: 'inv-1', conversationId: 'conv-1' }
      });

      expect(newStore.getInviteById('inv-1')).toBeUndefined();
      expect(newStore.getInviteByToken('abc123def456')).toBeNull();
      expect(newStore.getInvitesForConversation('conv-1')).toHaveLength(0);
    });

    it('ignores unknown event types', () => {
      const newStore = new CollaborationStore();
      // Should not throw
      newStore.replayEvent({ type: 'unknown_event', data: {} });
    });
  });
});
