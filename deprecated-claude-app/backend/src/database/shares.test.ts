import { describe, it, expect, beforeEach } from 'vitest';
import { SharesStore, SharedConversation } from './shares.js';

describe('SharesStore', () => {
  let store: SharesStore;

  beforeEach(() => {
    store = new SharesStore();
  });

  describe('createShare', () => {
    it('creates a share with unique token and default settings', async () => {
      const share = await store.createShare('conv-1', 'user-1', 'tree');

      expect(share.conversationId).toBe('conv-1');
      expect(share.userId).toBe('user-1');
      expect(share.shareType).toBe('tree');
      expect(share.shareToken).toMatch(/^[0-9a-f]{10}$/);
      expect(share.viewCount).toBe(0);
      expect(share.createdAt).toBeInstanceOf(Date);
      expect(share.settings.allowDownload).toBe(true);
      expect(share.settings.showModelInfo).toBe(true);
      expect(share.settings.showTimestamps).toBe(true);
    });

    it('creates a branch share with branchId', async () => {
      const share = await store.createShare('conv-1', 'user-1', 'branch', 'branch-id-1');
      expect(share.shareType).toBe('branch');
      expect(share.branchId).toBe('branch-id-1');
    });

    it('applies custom settings', async () => {
      const share = await store.createShare('conv-1', 'user-1', 'tree', undefined, {
        allowDownload: false,
        title: 'My Shared Chat',
        description: 'A conversation about testing'
      });

      expect(share.settings.allowDownload).toBe(false);
      expect(share.settings.showModelInfo).toBe(true); // default preserved
      expect(share.settings.title).toBe('My Shared Chat');
      expect(share.settings.description).toBe('A conversation about testing');
    });

    it('sets expiration when provided', async () => {
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const share = await store.createShare('conv-1', 'user-1', 'tree', undefined, undefined, expires);
      expect(share.expiresAt).toEqual(expires);
    });

    it('generates unique tokens for multiple shares', async () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const share = await store.createShare(`conv-${i}`, 'user-1', 'tree');
        tokens.add(share.shareToken);
      }
      expect(tokens.size).toBe(10);
    });
  });

  describe('getShareByToken', () => {
    it('retrieves a share by its token', async () => {
      const created = await store.createShare('conv-1', 'user-1', 'tree');
      const found = await store.getShareByToken(created.shareToken);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.conversationId).toBe('conv-1');
    });

    it('increments view count on access', async () => {
      const created = await store.createShare('conv-1', 'user-1', 'tree');
      expect(created.viewCount).toBe(0);

      await store.getShareByToken(created.shareToken);
      const after1 = await store.getShareByToken(created.shareToken);
      // First call increments to 1, second call increments to 2
      expect(after1!.viewCount).toBe(2);
    });

    it('returns null for unknown token', async () => {
      const result = await store.getShareByToken('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null for expired share', async () => {
      const pastDate = new Date(Date.now() - 1000);
      const share = await store.createShare('conv-1', 'user-1', 'tree', undefined, undefined, pastDate);
      const result = await store.getShareByToken(share.shareToken);
      expect(result).toBeNull();
    });
  });

  describe('getSharesByUser', () => {
    it('returns all shares for a user', async () => {
      await store.createShare('conv-1', 'user-1', 'tree');
      await store.createShare('conv-2', 'user-1', 'branch', 'b-1');
      await store.createShare('conv-3', 'user-2', 'tree');

      const user1Shares = await store.getSharesByUser('user-1');
      expect(user1Shares).toHaveLength(2);
      expect(user1Shares.map(s => s.conversationId).sort()).toEqual(['conv-1', 'conv-2']);
    });

    it('returns empty array for user with no shares', async () => {
      const shares = await store.getSharesByUser('unknown');
      expect(shares).toEqual([]);
    });

    it('excludes expired shares', async () => {
      await store.createShare('conv-1', 'user-1', 'tree');
      const pastDate = new Date(Date.now() - 1000);
      await store.createShare('conv-2', 'user-1', 'tree', undefined, undefined, pastDate);

      const shares = await store.getSharesByUser('user-1');
      expect(shares).toHaveLength(1);
      expect(shares[0].conversationId).toBe('conv-1');
    });
  });

  describe('deleteShare', () => {
    it('deletes a share by its owner', async () => {
      const share = await store.createShare('conv-1', 'user-1', 'tree');

      const deleted = await store.deleteShare(share.id, 'user-1');
      expect(deleted).toBe(true);

      const found = await store.getShareByToken(share.shareToken);
      expect(found).toBeNull();
    });

    it('returns false if user is not the owner', async () => {
      const share = await store.createShare('conv-1', 'user-1', 'tree');

      const deleted = await store.deleteShare(share.id, 'user-2');
      expect(deleted).toBe(false);

      // Share still exists
      const found = await store.getShareByToken(share.shareToken);
      expect(found).not.toBeNull();
    });

    it('returns false for nonexistent share', async () => {
      const deleted = await store.deleteShare('nonexistent', 'user-1');
      expect(deleted).toBe(false);
    });
  });

  describe('deleteSharesForConversation', () => {
    it('deletes all shares for a conversation by the user', async () => {
      await store.createShare('conv-1', 'user-1', 'tree');
      await store.createShare('conv-1', 'user-1', 'branch', 'b-1');
      await store.createShare('conv-2', 'user-1', 'tree');

      const count = await store.deleteSharesForConversation('conv-1', 'user-1');
      expect(count).toBe(2);

      const remaining = await store.getSharesByUser('user-1');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].conversationId).toBe('conv-2');
    });

    it('does not delete other users shares', async () => {
      await store.createShare('conv-1', 'user-1', 'tree');
      await store.createShare('conv-1', 'user-2', 'tree');

      const count = await store.deleteSharesForConversation('conv-1', 'user-1');
      expect(count).toBe(1);

      const user2Shares = await store.getSharesByUser('user-2');
      expect(user2Shares).toHaveLength(1);
    });

    it('returns 0 when no matching shares', async () => {
      const count = await store.deleteSharesForConversation('unknown', 'user-1');
      expect(count).toBe(0);
    });
  });

  describe('replayEvent', () => {
    it('replays share_deleted event removing the share', async () => {
      const now = new Date().toISOString();
      store.replayEvent({
        type: 'share_created',
        data: {
          id: 'share-1',
          conversationId: 'conv-1',
          userId: 'user-1',
          shareToken: 'abc1234567',
          shareType: 'tree',
          createdAt: now,
          viewCount: 0,
          settings: {
            allowDownload: true,
            showModelInfo: true,
            showTimestamps: true
          }
        }
      });

      store.replayEvent({
        type: 'share_deleted',
        data: { id: 'share-1', shareToken: 'abc1234567' }
      });

      const result = await store.getShareByToken('abc1234567');
      expect(result).toBeNull();
    });

    it('replays share_viewed event updating view count', async () => {
      const now = new Date().toISOString();
      store.replayEvent({
        type: 'share_created',
        data: {
          id: 'share-1',
          conversationId: 'conv-1',
          userId: 'user-1',
          shareToken: 'abc1234567',
          shareType: 'tree',
          createdAt: now,
          viewCount: 0,
          settings: {
            allowDownload: true,
            showModelInfo: true,
            showTimestamps: true
          }
        }
      });

      store.replayEvent({
        type: 'share_viewed',
        data: { id: 'share-1', viewCount: 42 }
      });

      // getShareByToken increments viewCount, so we need to check 42+1 = 43
      const found = await store.getShareByToken('abc1234567');
      expect(found).not.toBeNull();
      expect(found!.viewCount).toBe(43); // 42 from replay + 1 from getShareByToken
    });

    it('handles share_deleted without shareToken gracefully', () => {
      const now = new Date().toISOString();
      store.replayEvent({
        type: 'share_created',
        data: {
          id: 'share-1',
          conversationId: 'conv-1',
          userId: 'user-1',
          shareToken: 'abc1234567',
          shareType: 'tree',
          createdAt: now,
          viewCount: 0,
          settings: {}
        }
      });

      // Delete without shareToken in event data — should still remove from shares map
      store.replayEvent({
        type: 'share_deleted',
        data: { id: 'share-1' }
      });

      // The share should still be removed from the shares map (by id)
      const shares = store['shares']; // access private for verification
      expect(shares.has('share-1')).toBe(false);
    });

    it('handles share_created with expiresAt', async () => {
      const now = new Date().toISOString();
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      store.replayEvent({
        type: 'share_created',
        data: {
          id: 'share-1',
          conversationId: 'conv-1',
          userId: 'user-1',
          shareToken: 'abc1234567',
          shareType: 'tree',
          createdAt: now,
          expiresAt: future,
          viewCount: 0,
          settings: {}
        }
      });

      const found = await store.getShareByToken('abc1234567');
      expect(found).not.toBeNull();
      expect(found!.expiresAt).toBeInstanceOf(Date);
    });

    it('ignores unknown event types without error', () => {
      store.replayEvent({ type: 'unknown_event', data: {} });
      // Should not throw
    });
  });
});
