import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Database } from './index.js';
import fs from 'fs/promises';
import path from 'path';

const TEMP_BASE = '/tmp/animachat-test-db-share';

let db: Database;
let tempDir: string;
let originalCwd: string;
let ownerUserId: string;
let otherUserId: string;
let strangerUserId: string;

beforeAll(async () => {
  originalCwd = process.cwd();
  tempDir = path.join(TEMP_BASE, `share-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });
  process.chdir(tempDir);

  db = new Database();
  await db.init();

  const owner = await db.createUser('owner@example.com', 'pass', 'Owner');
  ownerUserId = owner.id;

  const other = await db.createUser('other@example.com', 'pass', 'Other');
  otherUserId = other.id;

  const stranger = await db.createUser('stranger@example.com', 'pass', 'Stranger');
  strangerUserId = stranger.id;
}, 30000);

afterAll(async () => {
  await db.close();
  process.chdir(originalCwd);
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function createConv(title = 'Share Test Conv'): Promise<string> {
  const conv = await db.createConversation(ownerUserId, title, 'test-model', undefined, {
    temperature: 1.0,
    maxTokens: 4096,
  });
  return conv.id;
}

describe('Database — Share + permission operations', () => {
  describe('canUserAccessConversation', () => {
    it('owner always has full access', async () => {
      const convId = await createConv('Owner access');
      const result = await db.canUserAccessConversation(convId, ownerUserId);

      expect(result.canAccess).toBe(true);
      expect(result.isOwner).toBe(true);
      expect(result.permission).toBe('editor');
    });

    it('stranger (no share) is denied access', async () => {
      const convId = await createConv('Stranger denied');
      const result = await db.canUserAccessConversation(convId, strangerUserId);

      expect(result.canAccess).toBe(false);
      expect(result.isOwner).toBe(false);
      expect(result.permission).toBeNull();
    });
  });

  describe('createCollaborationShare + access control', () => {
    it('sharing gives the target user access', async () => {
      const convId = await createConv('Share access');

      const share = await db.createCollaborationShare(
        convId, 'other@example.com', ownerUserId, 'viewer'
      );

      expect(share).not.toBeNull();
      expect(share!.sharedWithUserId).toBe(otherUserId);
      expect(share!.permission).toBe('viewer');

      const result = await db.canUserAccessConversation(convId, otherUserId);
      expect(result.canAccess).toBe(true);
      expect(result.isOwner).toBe(false);
      expect(result.permission).toBe('viewer');
    });

    it('sharing with nonexistent email returns null', async () => {
      const convId = await createConv('Nonexistent share');

      const share = await db.createCollaborationShare(
        convId, 'nonexistent@example.com', ownerUserId, 'viewer'
      );

      expect(share).toBeNull();
    });

    it('duplicate share returns null', async () => {
      const convId = await createConv('Dupe share');

      await db.createCollaborationShare(convId, 'other@example.com', ownerUserId, 'viewer');
      const dupe = await db.createCollaborationShare(convId, 'other@example.com', ownerUserId, 'editor');

      expect(dupe).toBeNull();
    });
  });

  describe('permission levels', () => {
    it('viewer cannot chat', async () => {
      const convId = await createConv('Viewer no chat');
      await db.createCollaborationShare(convId, 'other@example.com', ownerUserId, 'viewer');

      const canChat = await db.canUserChatInConversation(convId, otherUserId);
      expect(canChat).toBe(false);
    });

    it('viewer cannot delete', async () => {
      const convId = await createConv('Viewer no delete');
      await db.createCollaborationShare(convId, 'other@example.com', ownerUserId, 'viewer');

      const canDelete = await db.canUserDeleteInConversation(convId, otherUserId);
      expect(canDelete).toBe(false);
    });

    it('collaborator can chat', async () => {
      const convId = await createConv('Collaborator chat');
      await db.createCollaborationShare(convId, 'other@example.com', ownerUserId, 'collaborator');

      const canChat = await db.canUserChatInConversation(convId, otherUserId);
      expect(canChat).toBe(true);
    });

    it('collaborator cannot delete', async () => {
      const convId = await createConv('Collaborator no delete');
      await db.createCollaborationShare(convId, 'other@example.com', ownerUserId, 'collaborator');

      const canDelete = await db.canUserDeleteInConversation(convId, otherUserId);
      expect(canDelete).toBe(false);
    });

    it('editor can chat and delete', async () => {
      const convId = await createConv('Editor full');
      await db.createCollaborationShare(convId, 'other@example.com', ownerUserId, 'editor');

      const canChat = await db.canUserChatInConversation(convId, otherUserId);
      expect(canChat).toBe(true);

      const canDelete = await db.canUserDeleteInConversation(convId, otherUserId);
      expect(canDelete).toBe(true);
    });

    it('owner can always chat and delete', async () => {
      const convId = await createConv('Owner full');

      expect(await db.canUserChatInConversation(convId, ownerUserId)).toBe(true);
      expect(await db.canUserDeleteInConversation(convId, ownerUserId)).toBe(true);
    });

    it('stranger cannot chat or delete', async () => {
      const convId = await createConv('Stranger denied ops');

      expect(await db.canUserChatInConversation(convId, strangerUserId)).toBe(false);
      expect(await db.canUserDeleteInConversation(convId, strangerUserId)).toBe(false);
    });
  });

  describe('revokeCollaborationShare', () => {
    it('revoked user loses access', async () => {
      const convId = await createConv('Revoke test');

      const share = await db.createCollaborationShare(
        convId, 'other@example.com', ownerUserId, 'editor'
      );
      expect(share).not.toBeNull();

      // Verify access
      expect((await db.canUserAccessConversation(convId, otherUserId)).canAccess).toBe(true);

      // Revoke
      const revoked = await db.revokeCollaborationShare(share!.id, ownerUserId);
      expect(revoked).toBe(true);

      // Access should be gone
      expect((await db.canUserAccessConversation(convId, otherUserId)).canAccess).toBe(false);
    });
  });

  describe('updateCollaborationShare', () => {
    it('updates permission level', async () => {
      const convId = await createConv('Update perm');

      const share = await db.createCollaborationShare(
        convId, 'other@example.com', ownerUserId, 'viewer'
      );

      // Viewer can't chat
      expect(await db.canUserChatInConversation(convId, otherUserId)).toBe(false);

      // Upgrade to editor
      const updated = await db.updateCollaborationShare(share!.id, 'editor', ownerUserId);
      expect(updated).not.toBeNull();
      expect(updated!.permission).toBe('editor');

      // Now can chat
      expect(await db.canUserChatInConversation(convId, otherUserId)).toBe(true);
    });
  });

  describe('getUserCollaborationPermission', () => {
    it('returns correct permission for shared user', async () => {
      const convId = await createConv('Get perm');

      await db.createCollaborationShare(convId, 'other@example.com', ownerUserId, 'collaborator');

      const perm = db.getUserCollaborationPermission(convId, otherUserId);
      expect(perm).toBe('collaborator');
    });

    it('returns null for user without share', async () => {
      const convId = await createConv('No perm');

      const perm = db.getUserCollaborationPermission(convId, strangerUserId);
      expect(perm).toBeNull();
    });
  });

  describe('getCollaborationSharesForConversation', () => {
    it('lists all shares for a conversation', async () => {
      const convId = await createConv('List shares');
      const user3 = await db.createUser('user3@example.com', 'pass', 'User3');

      await db.createCollaborationShare(convId, 'other@example.com', ownerUserId, 'viewer');
      await db.createCollaborationShare(convId, 'user3@example.com', ownerUserId, 'editor');

      const shares = db.getCollaborationSharesForConversation(convId);
      expect(shares.length).toBe(2);
      const emails = shares.map(s => s.sharedWithEmail);
      expect(emails).toContain('other@example.com');
      expect(emails).toContain('user3@example.com');
    });

    it('returns empty list for conversation with no shares', async () => {
      const convId = await createConv('No shares');
      const shares = db.getCollaborationSharesForConversation(convId);
      expect(shares).toEqual([]);
    });
  });

  describe('getConversationsSharedWithUser', () => {
    it('lists conversations shared with a user', async () => {
      const convId1 = await createConv('Shared 1');
      const convId2 = await createConv('Shared 2');

      const user4 = await db.createUser('user4@example.com', 'pass', 'User4');

      await db.createCollaborationShare(convId1, 'user4@example.com', ownerUserId, 'viewer');
      await db.createCollaborationShare(convId2, 'user4@example.com', ownerUserId, 'editor');

      const shares = db.getConversationsSharedWithUser(user4.id);
      const convIds = shares.map(s => s.conversationId);
      expect(convIds).toContain(convId1);
      expect(convIds).toContain(convId2);
    });
  });

  describe('public shares (SharesStore)', () => {
    it('creates a public share and retrieves it by token', async () => {
      const convId = await createConv('Public share');

      const share = await db.createShare(convId, ownerUserId, 'tree');
      expect(share).toBeDefined();
      expect(share.shareToken).toBeDefined();
      expect(share.conversationId).toBe(convId);

      const fetched = await db.getShareByToken(share.shareToken);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(share.id);
    });

    it('deletes a public share', async () => {
      const convId = await createConv('Delete public share');

      const share = await db.createShare(convId, ownerUserId, 'tree');
      const deleted = await db.deleteShare(share.id, ownerUserId);
      expect(deleted).toBe(true);

      const fetched = await db.getShareByToken(share.shareToken);
      expect(fetched).toBeNull();
    });

    it('getSharesByUser returns shares created by the user', async () => {
      const convId = await createConv('User shares list');
      await db.createShare(convId, ownerUserId, 'tree');

      const shares = await db.getSharesByUser(ownerUserId);
      expect(shares.length).toBeGreaterThanOrEqual(1);
      expect(shares.some(s => s.conversationId === convId)).toBe(true);
    });

    it('sharing nonexistent conversation throws', async () => {
      await expect(
        db.createShare('nonexistent-conv', ownerUserId, 'tree')
      ).rejects.toThrow();
    });
  });

  describe('state survives event replay', () => {
    it('collaboration shares survive DB reload', async () => {
      const convId = await createConv('Replay collab');
      await db.createCollaborationShare(convId, 'other@example.com', ownerUserId, 'viewer');

      const db2 = new Database();
      await db2.init();

      try {
        const result = await db2.canUserAccessConversation(convId, otherUserId);
        expect(result.canAccess).toBe(true);
        expect(result.permission).toBe('viewer');
      } finally {
        await db2.close();
      }
    });

    it('public shares survive DB reload', async () => {
      const convId = await createConv('Replay public');
      const share = await db.createShare(convId, ownerUserId, 'tree');

      const db2 = new Database();
      await db2.init();

      try {
        const fetched = await db2.getShareByToken(share.shareToken);
        expect(fetched).not.toBeNull();
        expect(fetched!.conversationId).toBe(convId);
      } finally {
        await db2.close();
      }
    });

    it('revoked collaboration share stays revoked after DB reload', async () => {
      const convId = await createConv('Replay revoke');
      const share = await db.createCollaborationShare(convId, 'other@example.com', ownerUserId, 'editor');
      await db.revokeCollaborationShare(share!.id, ownerUserId);

      const db2 = new Database();
      await db2.init();

      try {
        const result = await db2.canUserAccessConversation(convId, otherUserId);
        expect(result.canAccess).toBe(false);
      } finally {
        await db2.close();
      }
    });
  });
});
