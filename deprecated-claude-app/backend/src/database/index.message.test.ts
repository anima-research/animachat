import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Database } from './index.js';
import { Message } from '@deprecated-claude/shared';
import fs from 'fs/promises';
import path from 'path';

const TEMP_BASE = '/tmp/animachat-test-db-message';

let db: Database;
let tempDir: string;
let originalCwd: string;
let userId: string;

beforeAll(async () => {
  originalCwd = process.cwd();
  tempDir = path.join(TEMP_BASE, `msg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });
  process.chdir(tempDir);

  db = new Database();
  await db.init();

  const user = await db.createUser('msguser@example.com', 'pass', 'MsgUser');
  userId = user.id;
}, 30000);

afterAll(async () => {
  await db.close();
  process.chdir(originalCwd);
  await fs.rm(tempDir, { recursive: true, force: true });
});

// Helper: create a conversation with explicit settings to avoid ModelLoader dependency
async function createConv(title = 'Test Conv'): Promise<string> {
  const conv = await db.createConversation(userId, title, 'test-model', 'System prompt', {
    temperature: 1.0,
    maxTokens: 4096,
  });
  return conv.id;
}

describe('Database — Message + branching operations', () => {
  describe('createMessage + getConversationMessages', () => {
    it('creates a message that appears in getConversationMessages', async () => {
      const convId = await createConv('Simple message test');

      const msg = await db.createMessage(convId, userId, 'Hello world', 'user');

      const messages = await db.getConversationMessages(convId, userId);
      // There will be system messages from default participants, plus our message
      const userMsgs = messages.filter(m => m.branches.some(b => b.role === 'user'));
      expect(userMsgs.length).toBeGreaterThanOrEqual(1);
      const found = messages.find(m => m.id === msg.id);
      expect(found).toBeDefined();
      expect(found!.branches[0].content).toBe('Hello world');
      expect(found!.branches[0].role).toBe('user');
    });

    it('message has a UUID id and correct activeBranchId', async () => {
      const convId = await createConv();
      const msg = await db.createMessage(convId, userId, 'Test', 'user');

      expect(msg.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(msg.activeBranchId).toBe(msg.branches[0].id);
      expect(msg.branches).toHaveLength(1);
    });

    it('empty conversation returns only participant messages', async () => {
      const convId = await createConv('Empty conv');
      const messages = await db.getConversationMessages(convId, userId);
      // createConversation creates participants, which are system messages (0 or more)
      // But no user/assistant messages
      const userOrAssistant = messages.filter(m =>
        m.branches.some(b => b.role === 'user' || b.role === 'assistant')
      );
      expect(userOrAssistant).toHaveLength(0);
    });
  });

  describe('linear conversation (A → B → C)', () => {
    let convId: string;
    let msgA: Message, msgB: Message, msgC: Message;

    beforeAll(async () => {
      convId = await createConv('Linear conv');
      msgA = await db.createMessage(convId, userId, 'Message A', 'user');
      msgB = await db.createMessage(convId, userId, 'Message B', 'assistant');
      msgC = await db.createMessage(convId, userId, 'Message C', 'user');
    });

    it('getConversationMessages returns messages in tree order', async () => {
      const messages = await db.getConversationMessages(convId, userId);
      const ids = messages.map(m => m.id);

      // A, B, C should appear in order (there may be participant system messages before them)
      const idxA = ids.indexOf(msgA.id);
      const idxB = ids.indexOf(msgB.id);
      const idxC = ids.indexOf(msgC.id);

      expect(idxA).toBeLessThan(idxB);
      expect(idxB).toBeLessThan(idxC);
    });

    it('each message has its parent branch as parentBranchId', async () => {
      const messages = await db.getConversationMessages(convId, userId);
      const mA = messages.find(m => m.id === msgA.id)!;
      const mB = messages.find(m => m.id === msgB.id)!;
      const mC = messages.find(m => m.id === msgC.id)!;

      // B's parent should be A's active branch
      expect(mB.branches[0].parentBranchId).toBe(mA.activeBranchId);
      // C's parent should be B's active branch
      expect(mC.branches[0].parentBranchId).toBe(mB.activeBranchId);
    });
  });

  describe('single branch point (A → B1, A → B2)', () => {
    let convId: string;
    let msgA: Message, msgB: Message;
    let branchB1Id: string, branchB2Id: string;

    beforeAll(async () => {
      convId = await createConv('Branching conv');
      msgA = await db.createMessage(convId, userId, 'Message A', 'user');
      msgB = await db.createMessage(convId, userId, 'Branch B1', 'assistant');
      branchB1Id = msgB.branches[0].id;

      // Add a second branch to the B message
      const updated = await db.addMessageBranch(
        msgB.id, convId, userId, 'Branch B2', 'assistant',
        msgA.activeBranchId // same parent as B1
      );
      branchB2Id = updated!.branches[updated!.branches.length - 1].id;
    });

    it('message B has two branches', async () => {
      const messages = await db.getConversationMessages(convId, userId);
      const mB = messages.find(m => m.id === msgB.id)!;
      expect(mB.branches).toHaveLength(2);
      expect(mB.branches[0].content).toBe('Branch B1');
      expect(mB.branches[1].content).toBe('Branch B2');
    });

    it('active branch defaults to the newest branch (B2)', async () => {
      const messages = await db.getConversationMessages(convId, userId);
      const mB = messages.find(m => m.id === msgB.id)!;
      // addMessageBranch sets activeBranchId to the new branch by default
      expect(mB.activeBranchId).toBe(branchB2Id);
    });

    it('setActiveBranch switches active to B1', async () => {
      const result = await db.setActiveBranch(msgB.id, convId, userId, branchB1Id);
      expect(result).toBe(true);

      const messages = await db.getConversationMessages(convId, userId);
      const mB = messages.find(m => m.id === msgB.id)!;
      expect(mB.activeBranchId).toBe(branchB1Id);
    });

    it('setActiveBranch returns false for nonexistent branch', async () => {
      const result = await db.setActiveBranch(msgB.id, convId, userId, 'nonexistent-branch-id');
      expect(result).toBe(false);
    });

    it('setActiveBranch returns false for nonexistent message', async () => {
      const result = await db.setActiveBranch('nonexistent-msg-id', convId, userId, branchB1Id);
      expect(result).toBe(false);
    });
  });

  describe('nested branches (multi-level)', () => {
    let convId: string;
    let msgA: Message, msgB: Message, msgC: Message;
    let branchB1Id: string, branchB2Id: string;
    let branchC1Id: string, branchC2Id: string;

    beforeAll(async () => {
      convId = await createConv('Nested branching');
      msgA = await db.createMessage(convId, userId, 'Root A', 'user');

      // Create B with branch B1
      msgB = await db.createMessage(convId, userId, 'B1 content', 'assistant');
      branchB1Id = msgB.branches[0].id;

      // Create C (child of B1) with branch C1
      msgC = await db.createMessage(convId, userId, 'C1 content', 'user');
      branchC1Id = msgC.branches[0].id;

      // Add C2 branch (also child of B1)
      const updatedC = await db.addMessageBranch(
        msgC.id, convId, userId, 'C2 content', 'user', branchB1Id
      );
      branchC2Id = updatedC!.branches[updatedC!.branches.length - 1].id;

      // Add B2 branch (child of A)
      const updatedB = await db.addMessageBranch(
        msgB.id, convId, userId, 'B2 content', 'assistant', msgA.activeBranchId
      );
      branchB2Id = updatedB!.branches[updatedB!.branches.length - 1].id;
    });

    it('B has two branches (B1, B2)', async () => {
      const messages = await db.getConversationMessages(convId, userId);
      const mB = messages.find(m => m.id === msgB.id)!;
      expect(mB.branches).toHaveLength(2);
    });

    it('C has two branches (C1, C2) both parented to B1', async () => {
      const messages = await db.getConversationMessages(convId, userId);
      const mC = messages.find(m => m.id === msgC.id)!;
      expect(mC.branches).toHaveLength(2);
      expect(mC.branches[0].parentBranchId).toBe(branchB1Id);
      expect(mC.branches[1].parentBranchId).toBe(branchB1Id);
    });

    it('switching B to B2 changes the tree path', async () => {
      await db.setActiveBranch(msgB.id, convId, userId, branchB2Id);

      const messages = await db.getConversationMessages(convId, userId);
      const mB = messages.find(m => m.id === msgB.id)!;
      expect(mB.activeBranchId).toBe(branchB2Id);
    });

    it('switching B back to B1 restores access to C branches', async () => {
      await db.setActiveBranch(msgB.id, convId, userId, branchB1Id);

      const messages = await db.getConversationMessages(convId, userId);
      const mB = messages.find(m => m.id === msgB.id)!;
      expect(mB.activeBranchId).toBe(branchB1Id);
      // C should still be in the messages list with its branches
      const mC = messages.find(m => m.id === msgC.id)!;
      expect(mC.branches.length).toBe(2);
    });
  });

  describe('addMessageBranch (edit-creates-branch semantics)', () => {
    it('adding a branch to a message creates a new branch on the same message', async () => {
      const convId = await createConv('Edit branch test');
      const msg = await db.createMessage(convId, userId, 'Original', 'user');
      expect(msg.branches).toHaveLength(1);

      const updated = await db.addMessageBranch(
        msg.id, convId, userId, 'Edited version', 'user'
      );

      expect(updated).not.toBeNull();
      expect(updated!.branches).toHaveLength(2);
      expect(updated!.branches[0].content).toBe('Original');
      expect(updated!.branches[1].content).toBe('Edited version');
      // Active branch switches to the new one
      expect(updated!.activeBranchId).toBe(updated!.branches[1].id);
    });

    it('preserveActiveBranch=true keeps the old active branch', async () => {
      const convId = await createConv('Preserve active test');
      const msg = await db.createMessage(convId, userId, 'Original', 'user');
      const originalBranchId = msg.branches[0].id;

      const updated = await db.addMessageBranch(
        msg.id, convId, userId, 'Parallel branch', 'assistant',
        undefined, undefined, undefined, undefined, undefined, undefined,
        true // preserveActiveBranch
      );

      expect(updated!.branches).toHaveLength(2);
      expect(updated!.activeBranchId).toBe(originalBranchId);
    });

    it('returns null for nonexistent message', async () => {
      const convId = await createConv();
      const result = await db.addMessageBranch(
        'nonexistent-msg', convId, userId, 'Content', 'user'
      );
      expect(result).toBeNull();
    });
  });

  describe('deleteMessage', () => {
    it('deletes a message and it no longer appears in getConversationMessages', async () => {
      const convId = await createConv('Delete test');
      const msg = await db.createMessage(convId, userId, 'To delete', 'user');

      const deleted = await db.deleteMessage(msg.id, convId, userId);
      expect(deleted).toBe(true);

      const messages = await db.getConversationMessages(convId, userId);
      const found = messages.find(m => m.id === msg.id);
      expect(found).toBeUndefined();
    });

    it('returns false for nonexistent message', async () => {
      const convId = await createConv();
      const result = await db.deleteMessage('nonexistent', convId, userId);
      expect(result).toBe(false);
    });

    it('deleting a message does not affect other messages', async () => {
      const convId = await createConv('Delete sibling test');
      const msg1 = await db.createMessage(convId, userId, 'Keep', 'user');
      const msg2 = await db.createMessage(convId, userId, 'Delete', 'assistant');

      await db.deleteMessage(msg2.id, convId, userId);

      const messages = await db.getConversationMessages(convId, userId);
      const found1 = messages.find(m => m.id === msg1.id);
      expect(found1).toBeDefined();
    });
  });

  describe('deleteMessageBranch', () => {
    it('deletes a branch from a multi-branch message, preserving siblings', async () => {
      const convId = await createConv('Delete branch test');
      const msg = await db.createMessage(convId, userId, 'Branch A', 'user');
      const branchAId = msg.branches[0].id;

      await db.addMessageBranch(msg.id, convId, userId, 'Branch B', 'user');

      const result = await db.deleteMessageBranch(msg.id, convId, userId, branchAId);
      expect(result).not.toBeNull();

      const messages = await db.getConversationMessages(convId, userId);
      const found = messages.find(m => m.id === msg.id);
      expect(found).toBeDefined();
      expect(found!.branches).toHaveLength(1);
      expect(found!.branches[0].content).toBe('Branch B');
    });

    it('deleting the only branch deletes the entire message', async () => {
      const convId = await createConv('Delete only branch');
      const msg = await db.createMessage(convId, userId, 'Only branch', 'user');
      const branchId = msg.branches[0].id;

      const result = await db.deleteMessageBranch(msg.id, convId, userId, branchId);
      expect(result).not.toBeNull();
      expect(result).toContain(msg.id);

      const messages = await db.getConversationMessages(convId, userId);
      const found = messages.find(m => m.id === msg.id);
      expect(found).toBeUndefined();
    });

    it('deleting the active branch switches active to another branch', async () => {
      const convId = await createConv('Switch active on delete');
      const msg = await db.createMessage(convId, userId, 'First', 'user');
      const firstBranchId = msg.branches[0].id;

      const updated = await db.addMessageBranch(msg.id, convId, userId, 'Second', 'user');
      const secondBranchId = updated!.branches[1].id;

      // Active should be the second branch
      expect(updated!.activeBranchId).toBe(secondBranchId);

      // Delete the active (second) branch
      await db.deleteMessageBranch(msg.id, convId, userId, secondBranchId);

      const messages = await db.getConversationMessages(convId, userId);
      const found = messages.find(m => m.id === msg.id)!;
      expect(found.branches).toHaveLength(1);
      expect(found.activeBranchId).toBe(firstBranchId);
    });

    it('cascade deletes descendant messages when deleting the only branch', async () => {
      const convId = await createConv('Cascade delete');
      const parent = await db.createMessage(convId, userId, 'Parent', 'user');
      const child = await db.createMessage(convId, userId, 'Child', 'assistant');

      // Child's branch is parented to parent's branch
      const messages = await db.getConversationMessages(convId, userId);
      const childMsg = messages.find(m => m.id === child.id)!;
      expect(childMsg.branches[0].parentBranchId).toBe(parent.activeBranchId);

      // Delete parent's only branch — should cascade to child
      const result = await db.deleteMessageBranch(
        parent.id, convId, userId, parent.branches[0].id
      );

      expect(result).not.toBeNull();
      expect(result).toContain(parent.id);
      expect(result).toContain(child.id);

      const afterDelete = await db.getConversationMessages(convId, userId);
      expect(afterDelete.find(m => m.id === parent.id)).toBeUndefined();
      expect(afterDelete.find(m => m.id === child.id)).toBeUndefined();
    });

    it('returns null for nonexistent branch', async () => {
      const convId = await createConv();
      const msg = await db.createMessage(convId, userId, 'Test', 'user');
      const result = await db.deleteMessageBranch(msg.id, convId, userId, 'nonexistent-branch');
      expect(result).toBeNull();
    });
  });

  describe('post-hoc operations', () => {
    it('createPostHocOperation creates a system message with operation metadata', async () => {
      const convId = await createConv('Post-hoc test');
      const target = await db.createMessage(convId, userId, 'Target message', 'user');

      const postHoc = await db.createPostHocOperation(convId, userId, 'hide', {
        type: 'hide',
        targetMessageId: target.id,
        targetBranchId: target.branches[0].id,
        parentBranchId: target.activeBranchId,
      });

      expect(postHoc).toBeDefined();
      expect(postHoc.branches[0].role).toBe('system');
      expect(postHoc.branches[0].postHocOperation).toBeDefined();
      expect(postHoc.branches[0].postHocOperation!.type).toBe('hide');
      expect(postHoc.branches[0].postHocOperation!.targetMessageId).toBe(target.id);
    });

    it('post-hoc edit stores replacement content', async () => {
      const convId = await createConv('Post-hoc edit test');
      const target = await db.createMessage(convId, userId, 'Original content', 'assistant');

      const postHoc = await db.createPostHocOperation(convId, userId, 'edit', {
        type: 'edit',
        targetMessageId: target.id,
        targetBranchId: target.branches[0].id,
        replacementContent: [{ type: 'text', text: 'Edited content' }],
        parentBranchId: target.activeBranchId,
      });

      expect(postHoc.branches[0].postHocOperation!.type).toBe('edit');
      expect(postHoc.branches[0].postHocOperation!.replacementContent).toEqual([
        { type: 'text', text: 'Edited content' },
      ]);
    });
  });

  describe('getMessage', () => {
    it('returns the message when it exists', async () => {
      const convId = await createConv();
      const msg = await db.createMessage(convId, userId, 'Get me', 'user');

      const fetched = await db.getMessage(msg.id, convId, userId);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(msg.id);
      expect(fetched!.branches[0].content).toBe('Get me');
    });

    it('returns null for nonexistent message', async () => {
      const convId = await createConv();
      const fetched = await db.getMessage('nonexistent', convId, userId);
      expect(fetched).toBeNull();
    });
  });

  describe('updateMessage', () => {
    it('updates a message in place', async () => {
      const convId = await createConv('Update test');
      const msg = await db.createMessage(convId, userId, 'Before update', 'user');

      const updated = {
        ...msg,
        branches: [{
          ...msg.branches[0],
          content: 'After update',
        }],
      };

      const result = await db.updateMessage(msg.id, convId, userId, updated);
      expect(result).toBe(true);

      const fetched = await db.getMessage(msg.id, convId, userId);
      expect(fetched!.branches[0].content).toBe('After update');
    });

    it('returns false for nonexistent message', async () => {
      const convId = await createConv();
      const result = await db.updateMessage('nonexistent', convId, userId, {} as any);
      expect(result).toBe(false);
    });
  });

  describe('hiddenFromAi flag', () => {
    it('creates a message with hiddenFromAi=true', async () => {
      const convId = await createConv('Hidden test');
      const msg = await db.createMessage(
        convId, userId, 'Hidden message', 'user',
        undefined, undefined, undefined, undefined, undefined, true
      );

      expect(msg.branches[0].hiddenFromAi).toBe(true);

      const messages = await db.getConversationMessages(convId, userId);
      const found = messages.find(m => m.id === msg.id);
      expect(found).toBeDefined();
      expect(found!.branches[0].hiddenFromAi).toBe(true);
    });
  });

  describe('message ordering and tree structure', () => {
    it('messages are sorted by tree order (parents before children)', async () => {
      const convId = await createConv('Tree order test');
      const m1 = await db.createMessage(convId, userId, 'First', 'user');
      const m2 = await db.createMessage(convId, userId, 'Second', 'assistant');
      const m3 = await db.createMessage(convId, userId, 'Third', 'user');

      const messages = await db.getConversationMessages(convId, userId);
      const ids = messages.map(m => m.id);
      const i1 = ids.indexOf(m1.id);
      const i2 = ids.indexOf(m2.id);
      const i3 = ids.indexOf(m3.id);

      expect(i1).toBeLessThan(i2);
      expect(i2).toBeLessThan(i3);
    });
  });

  describe('state survives event replay', () => {
    it('messages survive DB reload', async () => {
      const convId = await createConv('Replay msg test');
      const msg = await db.createMessage(convId, userId, 'Survives replay', 'user');

      const db2 = new Database();
      await db2.init();

      try {
        const messages = await db2.getConversationMessages(convId, userId);
        const found = messages.find(m => m.id === msg.id);
        expect(found).toBeDefined();
        expect(found!.branches[0].content).toBe('Survives replay');
      } finally {
        await db2.close();
      }
    });

    it('branches survive DB reload', async () => {
      const convId = await createConv('Replay branch test');
      const msg = await db.createMessage(convId, userId, 'Original', 'user');
      await db.addMessageBranch(msg.id, convId, userId, 'Branch 2', 'user');

      const db2 = new Database();
      await db2.init();

      try {
        const messages = await db2.getConversationMessages(convId, userId);
        const found = messages.find(m => m.id === msg.id);
        expect(found).toBeDefined();
        expect(found!.branches).toHaveLength(2);
      } finally {
        await db2.close();
      }
    });

    it('deleted messages stay deleted after DB reload', async () => {
      const convId = await createConv('Replay delete test');
      const msg = await db.createMessage(convId, userId, 'To delete', 'user');
      await db.deleteMessage(msg.id, convId, userId);

      const db2 = new Database();
      await db2.init();

      try {
        const messages = await db2.getConversationMessages(convId, userId);
        const found = messages.find(m => m.id === msg.id);
        expect(found).toBeUndefined();
      } finally {
        await db2.close();
      }
    });
  });

  describe('edge cases', () => {
    it('creating a message in a nonexistent conversation throws', async () => {
      await expect(
        db.createMessage('nonexistent-conv', userId, 'Content', 'user')
      ).rejects.toThrow();
    });

    it('message with attachments stores them correctly', async () => {
      const convId = await createConv('Attachment test');
      const msg = await db.createMessage(
        convId, userId, 'With attachment', 'user',
        undefined, undefined, undefined,
        [{ fileName: 'test.txt', fileSize: 100, fileType: 'text/plain', content: 'dGVzdA==' }]
      );

      expect(msg.branches[0].attachments).toBeDefined();
      expect(msg.branches[0].attachments).toHaveLength(1);
      expect(msg.branches[0].attachments![0].fileName).toBe('test.txt');
    });

    it('createMessage auto-links to last message active branch as parent', async () => {
      const convId = await createConv('Auto parent test');
      const m1 = await db.createMessage(convId, userId, 'First', 'user');
      const m2 = await db.createMessage(convId, userId, 'Second', 'assistant');

      // m2's parent should be m1's active branch
      expect(m2.branches[0].parentBranchId).toBe(m1.activeBranchId);
    });

    it('first message in empty conversation gets parentBranchId=root', async () => {
      const convId = await createConv('First msg test');
      // When no prior messages exist (model not found = no participants created),
      // the first message defaults to 'root' parent
      const msg = await db.createMessage(convId, userId, 'First user msg', 'user');

      expect(msg.branches[0].parentBranchId).toBe('root');
    });

    it('creationSource is stored on branches', async () => {
      const convId = await createConv('Creation source test');
      const msg = await db.createMessage(
        convId, userId, 'With source', 'user',
        undefined, undefined, undefined, undefined, undefined, undefined,
        'human_edit'
      );

      expect(msg.branches[0].creationSource).toBe('human_edit');
    });
  });
});
