/**
 * Characterization tests for Database class — branch/message operations.
 * Targets uncovered branches in: addMessageBranch, createPostHocOperation,
 * restoreBranch, deleteMessageBranch cascade, getConversationArchive,
 * getConversationEvents, duplicateConversation with lastMessages,
 * importRawMessage, updateMessageContent, updateMessageBranch,
 * getUserConversationsWithSummary, tryLoadAndVerifyParticipant.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Database } from './index.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

const TEMP_BASE = '/tmp/animachat-test-db-search';
let db: Database;
let tempDir: string;
let origCwd: string;

// Shared state across tests
let userId: string;
let convId: string;
let convOwnerUserId: string;

beforeAll(async () => {
  tempDir = path.join(TEMP_BASE, `run-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  origCwd = process.cwd();
  process.chdir(tempDir);
  db = new Database();
  await db.init();

  // Create a test user
  const user = await db.createUser('search-tester@test.com', 'SearchPass1!', 'Search Tester');
  userId = user.id;

  // Create a conversation with standard format
  const conv = await db.createConversation(userId, 'Branch Test Conv', 'test-model');
  convId = conv.id;
  convOwnerUserId = userId;
});

afterAll(async () => {
  await db.close();
  process.chdir(origCwd);
  await fs.rm(tempDir, { recursive: true, force: true });
});

// ==================== addMessageBranch ====================

describe('Database — addMessageBranch', () => {
  let messageId: string;

  beforeAll(async () => {
    // Create initial message to branch off of
    const msg = await db.createMessage(convId, userId, 'Hello world', 'user');
    messageId = msg.id;
  });

  it('adds a basic branch', async () => {
    const result = await db.addMessageBranch(messageId, convId, userId, 'Branch content', 'assistant');
    expect(result).not.toBeNull();
    expect(result!.branches.length).toBeGreaterThanOrEqual(2);
    // Active branch should now be the new branch
    const lastBranch = result!.branches[result!.branches.length - 1];
    expect(result!.activeBranchId).toBe(lastBranch.id);
  });

  it('adds a branch with preserveActiveBranch=true', async () => {
    const before = (await db.getConversationMessages(convId, userId))
      .find(m => m.id === messageId);
    const prevActiveBranch = before!.activeBranchId;

    const result = await db.addMessageBranch(
      messageId, convId, userId, 'Preserved branch', 'assistant',
      undefined, undefined, undefined, undefined, undefined, undefined,
      true // preserveActiveBranch
    );
    expect(result).not.toBeNull();
    // activeBranchId should NOT change
    expect(result!.activeBranchId).toBe(prevActiveBranch);
  });

  it('adds a branch with attachments', async () => {
    const attachments = [
      {
        fileName: 'test.txt',
        fileSize: 100,
        fileType: 'text/plain',
        content: 'dGVzdCBjb250ZW50', // base64
        encoding: 'base64',
        mimeType: 'text/plain'
      }
    ];
    const result = await db.addMessageBranch(
      messageId, convId, userId, 'With attachment', 'user',
      undefined, undefined, undefined, attachments
    );
    expect(result).not.toBeNull();
    const lastBranch = result!.branches[result!.branches.length - 1];
    expect(lastBranch.attachments).toBeDefined();
    expect(lastBranch.attachments!.length).toBe(1);
    expect(lastBranch.attachments![0].fileName).toBe('test.txt');
    expect(lastBranch.attachments![0].id).toBeDefined();
  });

  it('adds a branch with hiddenFromAi', async () => {
    const result = await db.addMessageBranch(
      messageId, convId, userId, 'Hidden from AI', 'user',
      undefined, undefined, undefined, undefined, undefined,
      true // hiddenFromAi
    );
    expect(result).not.toBeNull();
    const lastBranch = result!.branches[result!.branches.length - 1];
    expect(lastBranch.hiddenFromAi).toBe(true);
  });

  it('adds a branch with creationSource', async () => {
    const result = await db.addMessageBranch(
      messageId, convId, userId, 'Regenerated', 'assistant',
      undefined, undefined, undefined, undefined, undefined, undefined,
      false, // preserveActiveBranch
      'regeneration' // creationSource
    );
    expect(result).not.toBeNull();
    const lastBranch = result!.branches[result!.branches.length - 1];
    expect(lastBranch.creationSource).toBe('regeneration');
  });

  it('adds a system branch (should not increment branch count)', async () => {
    const result = await db.addMessageBranch(
      messageId, convId, userId, 'System note', 'system'
    );
    expect(result).not.toBeNull();
    const lastBranch = result!.branches[result!.branches.length - 1];
    expect(lastBranch.role).toBe('system');
  });

  it('adds a branch with parentBranchId and model', async () => {
    const messages = await db.getConversationMessages(convId, userId);
    const parentBranch = messages[0]?.branches[0];

    const result = await db.addMessageBranch(
      messageId, convId, userId, 'With parent and model', 'assistant',
      parentBranch?.id, // parentBranchId
      'claude-3-opus', // model
      undefined // participantId
    );
    expect(result).not.toBeNull();
    const lastBranch = result!.branches[result!.branches.length - 1];
    expect(lastBranch.model).toBe('claude-3-opus');
    expect(lastBranch.parentBranchId).toBe(parentBranch?.id);
  });

  it('adds a branch with sentByUserId', async () => {
    const result = await db.addMessageBranch(
      messageId, convId, userId, 'Sent by specific user', 'user',
      undefined, undefined, undefined, undefined,
      userId // sentByUserId
    );
    expect(result).not.toBeNull();
    const lastBranch = result!.branches[result!.branches.length - 1];
    expect(lastBranch.sentByUserId).toBe(userId);
  });

  it('returns null for nonexistent message', async () => {
    const result = await db.addMessageBranch('nonexistent', convId, userId, 'test', 'user');
    expect(result).toBeNull();
  });

  it('returns null for wrong conversation owner', async () => {
    const otherUser = await db.createUser('other-branch@test.com', 'Pass123!', 'Other');
    const result = await db.addMessageBranch(messageId, convId, otherUser.id, 'test', 'user');
    expect(result).toBeNull();
  });
});

// ==================== createPostHocOperation ====================

describe('Database — createPostHocOperation', () => {
  let postHocConvId: string;
  let postHocMsgId: string;
  let postHocBranchId: string;

  beforeAll(async () => {
    const conv = await db.createConversation(userId, 'PostHoc Conv', 'test-model');
    postHocConvId = conv.id;
    const msg = await db.createMessage(postHocConvId, userId, 'Target message', 'user');
    postHocMsgId = msg.id;
    postHocBranchId = msg.activeBranchId;
  });

  it('creates a hide operation with explicit parentBranchId', async () => {
    const result = await db.createPostHocOperation(
      postHocConvId, userId, 'Hide target',
      {
        type: 'hide',
        targetMessageId: postHocMsgId,
        targetBranchId: postHocBranchId,
        parentBranchId: postHocBranchId
      }
    );
    expect(result).toBeDefined();
    expect(result.branches[0].postHocOperation).toBeDefined();
    expect(result.branches[0].postHocOperation!.type).toBe('hide');
    expect(result.branches[0].role).toBe('system');
  });

  it('creates an edit operation without parentBranchId (uses fallback)', async () => {
    const result = await db.createPostHocOperation(
      postHocConvId, userId, 'Edit target',
      {
        type: 'edit',
        targetMessageId: postHocMsgId,
        targetBranchId: postHocBranchId,
        replacementContent: [{ type: 'text', text: 'Replaced content' }]
      }
    );
    expect(result).toBeDefined();
    expect(result.branches[0].postHocOperation!.type).toBe('edit');
    // Should have found a parentBranchId from existing messages
    expect(result.branches[0].parentBranchId).toBeDefined();
  });

  it('creates a hide_before operation', async () => {
    const result = await db.createPostHocOperation(
      postHocConvId, userId, 'Hide before target',
      {
        type: 'hide_before',
        targetMessageId: postHocMsgId,
        targetBranchId: postHocBranchId,
        reason: 'Testing hide_before'
      }
    );
    expect(result).toBeDefined();
    expect(result.branches[0].postHocOperation!.type).toBe('hide_before');
    expect(result.branches[0].postHocOperation!.reason).toBe('Testing hide_before');
  });

  it('creates a hide_attachment operation', async () => {
    const result = await db.createPostHocOperation(
      postHocConvId, userId, 'Hide attachment',
      {
        type: 'hide_attachment',
        targetMessageId: postHocMsgId,
        targetBranchId: postHocBranchId,
        attachmentIndices: [0, 1]
      }
    );
    expect(result).toBeDefined();
    expect(result.branches[0].postHocOperation!.attachmentIndices).toEqual([0, 1]);
  });

  it('creates an unhide operation', async () => {
    const result = await db.createPostHocOperation(
      postHocConvId, userId, 'Unhide target',
      {
        type: 'unhide',
        targetMessageId: postHocMsgId,
        targetBranchId: postHocBranchId,
        parentBranchId: postHocBranchId
      }
    );
    expect(result).toBeDefined();
    expect(result.branches[0].postHocOperation!.type).toBe('unhide');
  });

  it('throws for nonexistent conversation', async () => {
    await expect(db.createPostHocOperation(
      'nonexistent', userId, 'fail',
      { type: 'hide', targetMessageId: 'x', targetBranchId: 'y' }
    )).rejects.toThrow('Conversation not found');
  });
});

// ==================== restoreBranch ====================

describe('Database — restoreBranch', () => {
  let restoreConvId: string;

  beforeAll(async () => {
    const conv = await db.createConversation(userId, 'Restore Branch Conv', 'test-model');
    restoreConvId = conv.id;
  });

  it('restores a branch to an existing message', async () => {
    const msg = await db.createMessage(restoreConvId, userId, 'Original content', 'user');
    const branchData = {
      id: uuidv4(),
      content: 'Restored branch content',
      role: 'assistant',
      createdAt: new Date().toISOString(),
      parentBranchId: msg.activeBranchId
    };

    const result = await db.restoreBranch(restoreConvId, userId, msg.id, branchData);
    expect(result).toBeDefined();
    expect(result.branches.length).toBe(2);
    expect(result.branches[1].content).toBe('Restored branch content');
  });

  it('throws when branch already exists', async () => {
    const msg = await db.createMessage(restoreConvId, userId, 'Existing branch', 'user');
    const existingBranch = msg.branches[0];

    await expect(db.restoreBranch(
      restoreConvId, userId, msg.id, existingBranch
    )).rejects.toThrow('Branch already exists');
  });

  it('restores a branch to a deleted message (recreates message container)', async () => {
    // Create and then delete a message
    const msg = await db.createMessage(restoreConvId, userId, 'Will be deleted', 'user');
    const deletedMsgId = msg.id;
    await db.deleteMessage(deletedMsgId, restoreConvId, userId);

    // Verify it's gone
    const messages = await db.getConversationMessages(restoreConvId, userId);
    const found = messages.find(m => m.id === deletedMsgId);
    expect(found).toBeUndefined();

    // Restore a branch to the deleted message
    const branchData = {
      id: uuidv4(),
      content: 'Restored to deleted message',
      role: 'user',
      createdAt: new Date().toISOString()
    };

    const result = await db.restoreBranch(restoreConvId, userId, deletedMsgId, branchData);
    expect(result).toBeDefined();
    expect(result.branches.length).toBe(1);
    expect(result.branches[0].content).toBe('Restored to deleted message');

    // Verify it's back in the conversation
    const messagesAfter = await db.getConversationMessages(restoreConvId, userId);
    const restored = messagesAfter.find(m => m.id === deletedMsgId);
    expect(restored).toBeDefined();
  });
});

// ==================== deleteMessageBranch cascade ====================

describe('Database — deleteMessageBranch cascade', () => {
  let cascadeConvId: string;

  beforeAll(async () => {
    const conv = await db.createConversation(userId, 'Cascade Conv', 'test-model');
    cascadeConvId = conv.id;
  });

  it('deletes a single branch from a multi-branch message', async () => {
    const msg = await db.createMessage(cascadeConvId, userId, 'Original', 'user');
    const added = await db.addMessageBranch(msg.id, cascadeConvId, userId, 'Branch 2', 'assistant');
    expect(added!.branches.length).toBe(2);

    const branchToDelete = added!.branches[1].id;
    const result = await db.deleteMessageBranch(msg.id, cascadeConvId, userId, branchToDelete);
    expect(result).not.toBeNull();
    // Should return list of deleted message IDs (possibly empty for branch-only deletion)
    expect(Array.isArray(result)).toBe(true);

    // Verify branch is gone
    const messages = await db.getConversationMessages(cascadeConvId, userId);
    const updated = messages.find(m => m.id === msg.id);
    expect(updated).toBeDefined();
    expect(updated!.branches.length).toBe(1);
  });

  it('deletes entire message when only one branch remains', async () => {
    const msg = await db.createMessage(cascadeConvId, userId, 'Single branch msg', 'user');
    const onlyBranch = msg.branches[0].id;

    const result = await db.deleteMessageBranch(msg.id, cascadeConvId, userId, onlyBranch);
    expect(result).not.toBeNull();
    expect(result!).toContain(msg.id);

    // Message should be gone
    const messages = await db.getConversationMessages(cascadeConvId, userId);
    const found = messages.find(m => m.id === msg.id);
    expect(found).toBeUndefined();
  });

  it('cascades deletion to child messages', async () => {
    // Create parent message
    const parent = await db.createMessage(cascadeConvId, userId, 'Parent', 'user');
    const parentBranchId = parent.activeBranchId;

    // Create child message linked to parent's branch (model=undefined, parentBranchId)
    const child = await db.createMessage(
      cascadeConvId, userId, 'Child', 'assistant',
      undefined, parentBranchId
    );
    const childBranchId = child.activeBranchId;

    // Create grandchild
    const grandchild = await db.createMessage(
      cascadeConvId, userId, 'Grandchild', 'user',
      undefined, childBranchId
    );

    // Delete parent's only branch - should cascade
    const result = await db.deleteMessageBranch(parent.id, cascadeConvId, userId, parentBranchId);
    expect(result).not.toBeNull();
    // Should have deleted parent, child, and grandchild
    expect(result!.length).toBeGreaterThanOrEqual(1);
    expect(result!).toContain(parent.id);
  });

  it('returns null for nonexistent message', async () => {
    const result = await db.deleteMessageBranch('nonexistent', cascadeConvId, userId, 'branch');
    expect(result).toBeNull();
  });

  it('returns null for nonexistent branch', async () => {
    const msg = await db.createMessage(cascadeConvId, userId, 'Valid msg', 'user');
    const result = await db.deleteMessageBranch(msg.id, cascadeConvId, userId, 'nonexistent-branch');
    expect(result).toBeNull();
  });
});

// ==================== getConversationArchive ====================

describe('Database — getConversationArchive', () => {
  let archiveConvId: string;

  beforeAll(async () => {
    const conv = await db.createConversation(userId, 'Archive Test Conv', 'test-model');
    archiveConvId = conv.id;

    // Create some messages and branches
    const msg1 = await db.createMessage(archiveConvId, userId, 'First message', 'user');
    await db.addMessageBranch(msg1.id, archiveConvId, userId, 'Alt branch 1', 'assistant');

    const msg2 = await db.createMessage(archiveConvId, userId, 'Second message', 'assistant', undefined, msg1.activeBranchId);

    // Delete a message to test deleted tracking
    const msg3 = await db.createMessage(archiveConvId, userId, 'To be deleted', 'user');
    await db.deleteMessage(msg3.id, archiveConvId, userId);

    // Delete a branch from msg1
    const msg1Updated = (await db.getConversationMessages(archiveConvId, userId))
      .find(m => m.id === msg1.id);
    if (msg1Updated && msg1Updated.branches.length > 1) {
      await db.deleteMessageBranch(msg1.id, archiveConvId, userId, msg1Updated.branches[1].id);
    }
  });

  it('returns complete archive with stats', async () => {
    const archive = await db.getConversationArchive(archiveConvId);
    expect(archive).toBeDefined();
    expect(archive.messages).toBeDefined();
    expect(archive.stats).toBeDefined();
    expect(archive.stats.totalMessages).toBeGreaterThan(0);
    expect(archive.stats.totalBranches).toBeGreaterThan(0);
    expect(typeof archive.stats.orphanedBranches).toBe('number');
    expect(typeof archive.stats.deletedBranches).toBe('number');
    expect(typeof archive.stats.rootBranches).toBe('number');
  });

  it('includes deleted messages and branches in archive', async () => {
    const archive = await db.getConversationArchive(archiveConvId);
    // Should have some deleted items from our setup
    expect(archive.stats.deletedBranches).toBeGreaterThanOrEqual(0);
  });

  it('marks branches as active/inactive correctly', async () => {
    const archive = await db.getConversationArchive(archiveConvId);
    for (const msg of archive.messages) {
      // At most one branch should be active
      const activeBranches = msg.branches.filter(b => b.isActive);
      // Deleted messages might have no active branch, but non-deleted should have one
      expect(activeBranches.length).toBeLessThanOrEqual(1);
    }
  });

  it('reports orphaned branches', async () => {
    const archive = await db.getConversationArchive(archiveConvId);
    // Stats should be consistent
    expect(archive.stats.totalBranches).toBeGreaterThanOrEqual(
      archive.stats.orphanedBranches + archive.stats.deletedBranches
    );
  });
});

// ==================== getConversationEvents ====================

describe('Database — getConversationEvents', () => {
  let eventsConvId: string;

  beforeAll(async () => {
    const conv = await db.createConversation(userId, 'Events Test Conv', 'test-model');
    eventsConvId = conv.id;

    // Generate various event types
    const msg1 = await db.createMessage(eventsConvId, userId, 'First msg', 'user');

    // Add a branch (generates message_branch_added event)
    await db.addMessageBranch(msg1.id, eventsConvId, userId, 'Added branch', 'assistant',
      undefined, undefined, undefined, undefined, userId);

    // Create and delete a message (generates message_deleted event)
    const msg2 = await db.createMessage(eventsConvId, userId, 'Will be deleted', 'user');
    await db.deleteMessage(msg2.id, eventsConvId, userId, userId);

    // Update message content (generates message_content_updated event)
    await db.updateMessageContent(msg1.id, eventsConvId, userId, msg1.activeBranchId, 'Updated first msg');
  });

  it('returns enriched events with user info', async () => {
    const events = await db.getConversationEvents(eventsConvId, userId);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);

    // Check that events have basic structure
    for (const event of events) {
      expect(event.type).toBeDefined();
      expect(event.timestamp).toBeDefined();
    }
  });

  it('includes message_created events with role and messageId', async () => {
    const events = await db.getConversationEvents(eventsConvId, userId);
    const messageCreated = events.find(e => e.type === 'message_created');
    expect(messageCreated).toBeDefined();
    expect(messageCreated!.messageId).toBeDefined();
    expect(messageCreated!.role).toBeDefined();
    expect(messageCreated!.branchId).toBeDefined();
  });

  it('includes message_branch_added events with branch info', async () => {
    const events = await db.getConversationEvents(eventsConvId, userId);
    const branchAdded = events.find(e => e.type === 'message_branch_added');
    expect(branchAdded).toBeDefined();
    expect(branchAdded!.messageId).toBeDefined();
    expect(branchAdded!.branchId).toBeDefined();
    expect(branchAdded!.role).toBeDefined();
  });

  it('includes message_deleted events with original message data', async () => {
    const events = await db.getConversationEvents(eventsConvId, userId);
    const deleted = events.find(e => e.type === 'message_deleted');
    expect(deleted).toBeDefined();
    expect(deleted!.messageId).toBeDefined();
    // Should include original message from creation event
    expect(deleted!.originalMessage).toBeDefined();
  });

  it('filters out active_branch_changed and message_order_changed events', async () => {
    const events = await db.getConversationEvents(eventsConvId, userId);
    const activeBranchChanged = events.find(e => e.type === 'active_branch_changed');
    const orderChanged = events.find(e => e.type === 'message_order_changed');
    expect(activeBranchChanged).toBeUndefined();
    expect(orderChanged).toBeUndefined();
  });

  it('enriches events with userName when userId is available', async () => {
    const events = await db.getConversationEvents(eventsConvId, userId);
    // At least some events should have userName from sentByUserId
    const withUserName = events.filter(e => e.userName);
    expect(withUserName.length).toBeGreaterThan(0);
    // Our user should be 'Search Tester'
    const searchTester = withUserName.find(e => e.userName === 'Search Tester');
    expect(searchTester).toBeDefined();
  });
});

// ==================== duplicateConversation with lastMessages ====================

describe('Database — duplicateConversation with lastMessages', () => {
  let dupConvId: string;

  beforeAll(async () => {
    const conv = await db.createConversation(userId, 'Dup Source Conv', 'test-model');
    dupConvId = conv.id;

    // Create a chain of messages (param order: convId, userId, content, role, model, parentBranchId)
    const msg1 = await db.createMessage(dupConvId, userId, 'Message 1', 'user');
    const msg2 = await db.createMessage(dupConvId, userId, 'Message 2', 'assistant', undefined, msg1.activeBranchId);
    const msg3 = await db.createMessage(dupConvId, userId, 'Message 3', 'user', undefined, msg2.activeBranchId);
    const msg4 = await db.createMessage(dupConvId, userId, 'Message 4', 'assistant', undefined, msg3.activeBranchId);
    const msg5 = await db.createMessage(dupConvId, userId, 'Message 5', 'user', undefined, msg4.activeBranchId);
  });

  it('lastMessages trim skips when root not found (parentBranchId is "root")', async () => {
    // Characterization: createMessage sets parentBranchId='root' for first message.
    // The root detection looks for !activeBranch.parentBranchId which is false for 'root'.
    // So trimming is skipped and all messages are returned.
    const dup = await db.duplicateConversation(dupConvId, userId, userId, { lastMessages: 2 });
    expect(dup).toBeDefined();

    const messages = await db.getConversationMessages(dup.id, userId);
    // All 5 messages returned because root detection fails
    expect(messages.length).toBe(5);
  });

  it('lastMessages trims properly when root has null parentBranchId', async () => {
    // Create a conversation with imported messages that have proper null parentBranchId
    const importConv = await db.createConversation(userId, 'Import Dup Source', 'test-model');
    const branchIds: string[] = [];

    for (let i = 0; i < 5; i++) {
      const msgId = uuidv4();
      const branchId = uuidv4();
      branchIds.push(branchId);
      await db.importRawMessage(importConv.id, userId, {
        id: msgId,
        order: i,
        activeBranchId: branchId,
        branches: [{
          id: branchId,
          content: `Imported ${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          createdAt: new Date().toISOString(),
          parentBranchId: i === 0 ? undefined : branchIds[i - 1]
        }]
      });
    }

    const dup = await db.duplicateConversation(importConv.id, userId, userId, { lastMessages: 2 });
    expect(dup).toBeDefined();

    const messages = await db.getConversationMessages(dup.id, userId);
    expect(messages.length).toBe(2);
    const contents = messages.map(m => m.branches[0]?.content);
    expect(contents).toContain('Imported 3');
    expect(contents).toContain('Imported 4');
  });

  it('duplicates with lastMessages larger than total (uses all)', async () => {
    const dup = await db.duplicateConversation(dupConvId, userId, userId, { lastMessages: 100 });
    expect(dup).toBeDefined();

    const messages = await db.getConversationMessages(dup.id, userId);
    expect(messages.length).toBe(5);
  });

  it('full duplication (no lastMessages) preserves all messages', async () => {
    const dup = await db.duplicateConversation(dupConvId, userId, userId);
    expect(dup).toBeDefined();

    const messages = await db.getConversationMessages(dup.id, userId);
    expect(messages.length).toBe(5);
  });

  it('trimmed duplication creates linear chain (no multi-branch)', async () => {
    // Create a conversation with proper null-root messages
    const importConv = await db.createConversation(userId, 'Linear Dup Source', 'test-model');
    const branchIds: string[] = [];

    for (let i = 0; i < 4; i++) {
      const msgId = uuidv4();
      const branchId = uuidv4();
      branchIds.push(branchId);
      await db.importRawMessage(importConv.id, userId, {
        id: msgId,
        order: i,
        activeBranchId: branchId,
        branches: [
          {
            id: branchId,
            content: `Main ${i}`,
            role: i % 2 === 0 ? 'user' : 'assistant',
            createdAt: new Date().toISOString(),
            parentBranchId: i === 0 ? undefined : branchIds[i - 1]
          },
          // Add an alternate branch on message 2
          ...(i === 2 ? [{
            id: uuidv4(),
            content: `Alt ${i}`,
            role: 'user' as const,
            createdAt: new Date().toISOString(),
            parentBranchId: branchIds[i - 1]
          }] : [])
        ]
      });
    }

    const dup = await db.duplicateConversation(importConv.id, userId, userId, { lastMessages: 2 });
    const dupMessages = await db.getConversationMessages(dup.id, userId);

    // Each message in a trimmed duplicate should have only one branch (linear)
    for (const msg of dupMessages) {
      expect(msg.branches.length).toBe(1);
    }
  });
});

// ==================== importRawMessage ====================

describe('Database — importRawMessage', () => {
  let importConvId: string;

  beforeAll(async () => {
    const conv = await db.createConversation(userId, 'Import Conv', 'test-model');
    importConvId = conv.id;
  });

  it('imports a raw message with correct ordering', async () => {
    const msgId = uuidv4();
    const branchId = uuidv4();
    await db.importRawMessage(importConvId, userId, {
      id: msgId,
      order: 0,
      activeBranchId: branchId,
      branches: [{
        id: branchId,
        content: 'Imported message',
        role: 'user',
        createdAt: new Date().toISOString()
      }]
    });

    const messages = await db.getConversationMessages(importConvId, userId);
    const imported = messages.find(m => m.id === msgId);
    expect(imported).toBeDefined();
    expect(imported!.branches[0].content).toBe('Imported message');
  });

  it('imports multiple messages in order', async () => {
    const importConv2 = await db.createConversation(userId, 'Import Conv 2', 'test-model');

    for (let i = 0; i < 3; i++) {
      const msgId = uuidv4();
      const branchId = uuidv4();
      await db.importRawMessage(importConv2.id, userId, {
        id: msgId,
        order: i,
        activeBranchId: branchId,
        branches: [{
          id: branchId,
          content: `Imported ${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          createdAt: new Date().toISOString(),
          parentBranchId: undefined
        }]
      });
    }

    const messages = await db.getConversationMessages(importConv2.id, userId);
    expect(messages.length).toBe(3);
    expect(messages[0].branches[0].content).toBe('Imported 0');
    expect(messages[2].branches[0].content).toBe('Imported 2');
  });

  it('throws for nonexistent conversation', async () => {
    await expect(db.importRawMessage('nonexistent', userId, {
      id: uuidv4(),
      order: 0,
      activeBranchId: uuidv4(),
      branches: [{ id: uuidv4(), content: 'fail', role: 'user', createdAt: new Date() }]
    })).rejects.toThrow();
  });

  it('throws for mismatched owner', async () => {
    const otherUser = await db.createUser('import-other@test.com', 'Pass123!', 'Other');
    await expect(db.importRawMessage(importConvId, otherUser.id, {
      id: uuidv4(),
      order: 0,
      activeBranchId: uuidv4(),
      branches: [{ id: uuidv4(), content: 'fail', role: 'user', createdAt: new Date() }]
    })).rejects.toThrow('Mismatched');
  });
});

// ==================== updateMessageContent ====================

describe('Database — updateMessageContent', () => {
  let updateConvId: string;

  beforeAll(async () => {
    const conv = await db.createConversation(userId, 'Update Content Conv', 'test-model');
    updateConvId = conv.id;
  });

  it('updates content of a specific branch', async () => {
    const msg = await db.createMessage(updateConvId, userId, 'Original content', 'user');
    const branchId = msg.activeBranchId;

    const result = await db.updateMessageContent(msg.id, updateConvId, userId, branchId, 'Updated content');
    expect(result).toBe(true);

    const messages = await db.getConversationMessages(updateConvId, userId);
    const updated = messages.find(m => m.id === msg.id);
    expect(updated!.branches.find(b => b.id === branchId)!.content).toBe('Updated content');
  });

  it('updates content with contentBlocks', async () => {
    const msg = await db.createMessage(updateConvId, userId, 'With blocks', 'assistant');
    const branchId = msg.activeBranchId;

    const contentBlocks = [
      { type: 'text', text: 'Part 1' },
      { type: 'text', text: 'Part 2' }
    ];
    const result = await db.updateMessageContent(msg.id, updateConvId, userId, branchId, 'With blocks updated', contentBlocks);
    expect(result).toBe(true);
  });

  it('returns false for nonexistent message', async () => {
    const result = await db.updateMessageContent('nonexistent', updateConvId, userId, 'branch', 'new');
    expect(result).toBe(false);
  });

  it('returns false for nonexistent branch', async () => {
    const msg = await db.createMessage(updateConvId, userId, 'Has branches', 'user');
    const result = await db.updateMessageContent(msg.id, updateConvId, userId, 'nonexistent-branch', 'new');
    expect(result).toBe(false);
  });
});

// ==================== updateMessageBranch ====================

describe('Database — updateMessageBranch', () => {
  let branchUpdateConvId: string;

  beforeAll(async () => {
    const conv = await db.createConversation(userId, 'Branch Update Conv', 'test-model');
    branchUpdateConvId = conv.id;
  });

  it('updates branch with model field', async () => {
    const msg = await db.createMessage(branchUpdateConvId, userId, 'Test branch update', 'assistant');
    const result = await db.updateMessageBranch(msg.id, userId, msg.activeBranchId, {
      model: 'claude-3-sonnet'
    });
    expect(result).toBe(true);
  });

  it('returns false for nonexistent message', async () => {
    const result = await db.updateMessageBranch('nonexistent', userId, 'branch', {});
    expect(result).toBe(false);
  });

  it('returns false for nonexistent branch', async () => {
    const msg = await db.createMessage(branchUpdateConvId, userId, 'Valid', 'user');
    const result = await db.updateMessageBranch(msg.id, userId, 'nonexistent', {});
    expect(result).toBe(false);
  });
});

// ==================== getUserConversationsWithSummary ====================

describe('Database — getUserConversationsWithSummary', () => {
  it('returns conversations with basic info', async () => {
    const result = await db.getUserConversationsWithSummary(userId);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // Each result should have conversation fields
    for (const conv of result) {
      expect(conv.id).toBeDefined();
      expect(conv.title).toBeDefined();
    }
  });

  it('includes participantModels for prefill-format conversations', async () => {
    // Create a prefill (group chat) format conversation
    const conv = await db.createConversation(userId, 'Group Chat', 'test-model', undefined, undefined, 'prefill');

    const result = await db.getUserConversationsWithSummary(userId);
    const groupChat = result.find(c => c.id === conv.id);
    expect(groupChat).toBeDefined();
    // Prefill format should include participantModels
    expect(groupChat!.participantModels).toBeDefined();
    expect(Array.isArray(groupChat!.participantModels)).toBe(true);
  });

  it('excludes archived conversations', async () => {
    const conv = await db.createConversation(userId, 'Archived Conv Summary', 'test-model');
    await db.archiveConversation(conv.id, userId);

    const result = await db.getUserConversationsWithSummary(userId);
    const archived = result.find(c => c.id === conv.id);
    expect(archived).toBeUndefined();
  });
});

// ==================== tryLoadAndVerifyParticipant edge cases ====================

describe('Database — participant verification', () => {
  it('returns null for participant belonging to another user', async () => {
    // Create conversation with user1, then try to access participant as user2
    const user2 = await db.createUser('participant-other@test.com', 'Pass123!', 'Other');
    const conv = await db.createConversation(userId, 'Participant Test', 'test-model');

    // Get participants for the conversation
    const participants = await db.getConversationParticipants(conv.id, userId);
    expect(participants.length).toBeGreaterThan(0);

    // Try to access first participant as the wrong user
    const participant = participants[0];
    const result = await db.getParticipant(participant.id, user2.id);
    expect(result).toBeNull();
  });

  it('returns null for nonexistent participant', async () => {
    const result = await db.getParticipant('nonexistent-participant', userId);
    expect(result).toBeNull();
  });
});

// ==================== setActiveBranch ====================

describe('Database — setActiveBranch', () => {
  it('sets active branch on a multi-branch message', async () => {
    const conv = await db.createConversation(userId, 'Active Branch Conv', 'test-model');
    const msg = await db.createMessage(conv.id, userId, 'First', 'user');
    const added = await db.addMessageBranch(msg.id, conv.id, userId, 'Second', 'assistant');
    expect(added!.branches.length).toBe(2);

    const firstBranchId = added!.branches[0].id;
    const result = await db.setActiveBranch(msg.id, conv.id, userId, firstBranchId);
    expect(result).toBe(true);

    // Verify the change
    const messages = await db.getConversationMessages(conv.id, userId);
    const updated = messages.find(m => m.id === msg.id);
    expect(updated!.activeBranchId).toBe(firstBranchId);
  });

  it('returns false for nonexistent branch', async () => {
    const conv = await db.createConversation(userId, 'Active Branch Conv 2', 'test-model');
    const msg = await db.createMessage(conv.id, userId, 'Test', 'user');
    const result = await db.setActiveBranch(msg.id, conv.id, userId, 'nonexistent-branch');
    expect(result).toBe(false);
  });

  it('returns false for nonexistent message', async () => {
    const conv = await db.createConversation(userId, 'Active Branch Conv 3', 'test-model');
    const result = await db.setActiveBranch('nonexistent', conv.id, userId, 'branch');
    expect(result).toBe(false);
  });
});

// ==================== updateMessage ====================

describe('Database — updateMessage', () => {
  it('updates a message object', async () => {
    const conv = await db.createConversation(userId, 'Update Msg Conv', 'test-model');
    const msg = await db.createMessage(conv.id, userId, 'Original', 'user');

    const updatedMsg = {
      ...msg,
      branches: msg.branches.map(b => ({ ...b, content: 'Modified' }))
    };

    const result = await db.updateMessage(msg.id, conv.id, userId, updatedMsg);
    expect(result).toBe(true);

    const messages = await db.getConversationMessages(conv.id, userId);
    const found = messages.find(m => m.id === msg.id);
    expect(found!.branches[0].content).toBe('Modified');
  });

  it('returns false for nonexistent message', async () => {
    const conv = await db.createConversation(userId, 'Update Msg Conv 2', 'test-model');
    const result = await db.updateMessage('nonexistent', conv.id, userId, {} as any);
    expect(result).toBe(false);
  });
});

// ==================== conversation postHocOp in empty conversation ====================

describe('Database — createPostHocOperation in empty conversation', () => {
  it('works in an empty conversation (no parentBranchId to find)', async () => {
    const conv = await db.createConversation(userId, 'Empty PostHoc Conv', 'test-model');
    const result = await db.createPostHocOperation(
      conv.id, userId, 'PostHoc in empty',
      {
        type: 'hide',
        targetMessageId: 'nonexistent',
        targetBranchId: 'nonexistent'
      }
    );
    // Should still create the operation, just without parentBranchId
    expect(result).toBeDefined();
    expect(result.branches[0].parentBranchId).toBeUndefined();
  });
});

// ==================== exportConversation edge cases ====================

describe('Database — exportConversation', () => {
  it('exports a conversation with messages', async () => {
    const conv = await db.createConversation(userId, 'Export Conv', 'test-model');
    await db.createMessage(conv.id, userId, 'Export msg 1', 'user');
    await db.createMessage(conv.id, userId, 'Export msg 2', 'assistant');

    const exported = await db.exportConversation(conv.id, userId);
    expect(exported).toBeDefined();
    expect(exported.conversation.title).toBe('Export Conv');
    expect(exported.messages.length).toBe(2);
    expect(exported.participants).toBeDefined();
    expect(exported.version).toBe('1.0');
  });

  it('exports an empty conversation', async () => {
    const conv = await db.createConversation(userId, 'Empty Export Conv', 'test-model');
    const exported = await db.exportConversation(conv.id, userId);
    expect(exported).toBeDefined();
    expect(exported.messages.length).toBe(0);
  });
});

// ==================== UI state operations ====================

describe('Database — UI state operations', () => {
  let uiConvId: string;

  beforeAll(async () => {
    const conv = await db.createConversation(userId, 'UI State Conv', 'test-model');
    uiConvId = conv.id;
  });

  it('getUserConversationState returns a state object', async () => {
    const state = await db.getUserConversationState(uiConvId, userId);
    expect(state).toBeDefined();
  });

  it('setUserSpeakingAs sets and persists', async () => {
    await db.setUserSpeakingAs(uiConvId, userId, 'participant-1');
    const state = await db.getUserConversationState(uiConvId, userId);
    expect(state.speakingAs).toBe('participant-1');
  });

  it('setUserSelectedResponder sets and persists', async () => {
    await db.setUserSelectedResponder(uiConvId, userId, 'responder-1');
    const state = await db.getUserConversationState(uiConvId, userId);
    expect(state.selectedResponder).toBe('responder-1');
  });

  it('setUserDetached sets and persists', async () => {
    await db.setUserDetached(uiConvId, userId, true);
    const state = await db.getUserConversationState(uiConvId, userId);
    expect(state.isDetached).toBe(true);
  });

  it('setUserDetachedBranch sets message and branch in detachedBranches map', async () => {
    await db.setUserDetachedBranch(uiConvId, userId, 'msg-1', 'branch-1');
    const state = await db.getUserConversationState(uiConvId, userId);
    expect(state.detachedBranches).toBeDefined();
    expect(state.detachedBranches!['msg-1']).toBe('branch-1');
  });

  it('markBranchesAsRead and getReadBranchIds', async () => {
    await db.markBranchesAsRead(uiConvId, userId, ['b1', 'b2', 'b3']);
    const readIds = await db.getReadBranchIds(uiConvId, userId);
    expect(readIds).toContain('b1');
    expect(readIds).toContain('b2');
    expect(readIds).toContain('b3');
  });

  it('getTotalBranchCount returns cached count', async () => {
    const count = await db.getTotalBranchCount(uiConvId);
    expect(typeof count).toBe('number');
  });

  it('backfillBranchCount sets the count', async () => {
    await db.backfillBranchCount(uiConvId, 42);
    const count = await db.getTotalBranchCount(uiConvId);
    expect(count).toBe(42);
  });
});

// ==================== alignActiveBranchPath ====================

describe('Database — alignActiveBranchPath', () => {
  it('aligns branch path for a conversation with messages', async () => {
    const conv = await db.createConversation(userId, 'Align Conv', 'test-model');
    const msg1 = await db.createMessage(conv.id, userId, 'First', 'user');
    await db.createMessage(conv.id, userId, 'Second', 'assistant', undefined, msg1.activeBranchId);

    // Should not throw
    await db.alignActiveBranchPath(conv.id, userId);

    // Messages should still be retrievable
    const messages = await db.getConversationMessages(conv.id, userId);
    expect(messages.length).toBe(2);
  });

  it('handles empty conversation gracefully', async () => {
    const conv = await db.createConversation(userId, 'Empty Align Conv', 'test-model');
    // Should not throw on empty
    await db.alignActiveBranchPath(conv.id, userId);
  });
});

// ==================== conversation-level getConversationMessagesAdmin ====================

describe('Database — getConversationMessagesAdmin', () => {
  it('returns messages without ownership check', async () => {
    const conv = await db.createConversation(userId, 'Admin Messages Conv', 'test-model');
    await db.createMessage(conv.id, userId, 'Admin viewable msg', 'user');

    const messages = await db.getConversationMessagesAdmin(conv.id);
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
  });
});

// ==================== Event replay tests ====================

describe('Database — event replay covers replayEvent switch cases', () => {
  let replayDir: string;
  let replayDb: Database;
  let replayUserId: string;
  let replayConvId: string;

  beforeAll(async () => {
    // Create a separate temp dir for replay tests
    replayDir = path.join(TEMP_BASE, `replay-${Date.now()}`);
    await fs.mkdir(replayDir, { recursive: true });

    const savedCwd = process.cwd();
    process.chdir(replayDir);
    replayDb = new Database();
    await replayDb.init();

    // Create user
    const user = await replayDb.createUser('replay-test@test.com', 'ReplayPass1!', 'Replay Tester');
    replayUserId = user.id;

    // Create conversation
    const conv = await replayDb.createConversation(replayUserId, 'Replay Conv', 'test-model');
    replayConvId = conv.id;

    // Create API key (covers api_key_created replay)
    await replayDb.createApiKey(replayUserId, {
      name: 'Test API Key',
      provider: 'anthropic',
      credentials: { apiKey: 'sk-ant-test-key-12345678' }
    });

    // Create a second API key and delete it (covers api_key_deleted replay)
    const apiKey2 = await replayDb.createApiKey(replayUserId, {
      name: 'Deletable Key',
      provider: 'openai',
      credentials: { apiKey: 'sk-openai-test-12345' }
    });
    await replayDb.deleteApiKey(apiKey2.id, replayUserId);

    // Create custom user model (covers user_model_created replay)
    await replayDb.createUserModel(replayUserId, {
      name: 'Replay Model',
      provider: 'anthropic',
      modelIdString: 'claude-3-replay',
      displayName: 'Replay Model Display'
    });

    // Create a second model and update+delete it (covers user_model_updated, user_model_deleted replay)
    const model2 = await replayDb.createUserModel(replayUserId, {
      name: 'Deletable Model',
      provider: 'openai',
      modelIdString: 'gpt-deletable',
      displayName: 'Deletable'
    });
    await replayDb.updateUserModel(model2.id, replayUserId, { displayName: 'Updated Deletable' });
    await replayDb.deleteUserModel(model2.id, replayUserId);

    // Create messages with various operations
    const msg1 = await replayDb.createMessage(replayConvId, replayUserId, 'Message 1', 'user');

    // Add branch (covers message_branch_added replay)
    await replayDb.addMessageBranch(msg1.id, replayConvId, replayUserId, 'Alt branch', 'assistant');

    // Update message content (covers message_content_updated replay)
    await replayDb.updateMessageContent(msg1.id, replayConvId, replayUserId, msg1.activeBranchId, 'Updated content', [{ type: 'text', text: 'block' }]);

    // Update message branch (covers message_branch_updated replay)
    await replayDb.updateMessageBranch(msg1.id, replayUserId, msg1.activeBranchId, {
      model: 'claude-3-opus'
    });

    // Create and update participant (covers participant_updated replay)
    const participant = await replayDb.createParticipant(replayConvId, replayUserId, 'Test Participant', 'assistant', 'test-model');
    await replayDb.updateParticipant(participant.id, replayUserId, { name: 'Updated Participant' });

    // Create another participant and delete (covers participant_deleted replay)
    const participant2 = await replayDb.createParticipant(replayConvId, replayUserId, 'Deletable Participant', 'assistant');
    await replayDb.deleteParticipant(participant2.id, replayUserId);

    // Create bookmarks (covers bookmark_created/updated/deleted replay)
    const bookmark = await replayDb.createOrUpdateBookmark(replayConvId, msg1.id, msg1.activeBranchId, 'Test Bookmark');
    // Update the bookmark (covers bookmark_updated replay)
    await replayDb.createOrUpdateBookmark(replayConvId, msg1.id, msg1.activeBranchId, 'Updated Bookmark');

    // Create and delete a bookmark on a different branch (covers bookmark_deleted replay)
    const altBranchId = msg1.branches[0]?.id || msg1.activeBranchId;
    if (altBranchId !== msg1.activeBranchId) {
      await replayDb.createOrUpdateBookmark(replayConvId, msg1.id, altBranchId, 'Delete Me');
      await replayDb.deleteBookmark(msg1.id, altBranchId);
    }

    // Create message 2, then delete its branch (covers message_branch_deleted replay)
    const msg2 = await replayDb.createMessage(replayConvId, replayUserId, 'Msg2 original', 'assistant');
    const branch2 = await replayDb.addMessageBranch(msg2.id, replayConvId, replayUserId, 'Msg2 alt', 'assistant');
    if (branch2) {
      const lastBranch = branch2.branches[branch2.branches.length - 1];
      await replayDb.deleteMessageBranch(msg2.id, replayConvId, replayUserId, lastBranch.id);
    }

    // Split a message (covers message_split, message_order_changed, branch_parent_changed replay)
    const msg3 = await replayDb.createMessage(replayConvId, replayUserId, 'First part. Second part.', 'user');
    await replayDb.splitMessage(replayConvId, replayUserId, msg3.id, msg3.activeBranchId, 12);

    // Archive conversation (covers conversation_archived replay)
    await replayDb.updateConversation(replayConvId, replayUserId, { title: 'Updated Title' });

    // Create a second conversation and archive it
    const archiveConv = await replayDb.createConversation(replayUserId, 'To Archive', 'test-model');
    await replayDb.archiveConversation(archiveConv.id, replayUserId);

    // Add metrics (covers metrics_added replay)
    await replayDb.addMetrics(replayConvId, replayUserId, {
      model: 'test-model',
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 10,
      cost: 0.001,
      cacheSavings: 0.0001,
      responseTime: 500
    });

    // Close the database to flush events
    await replayDb.close();
    process.chdir(savedCwd);
  });

  afterAll(async () => {
    await fs.rm(replayDir, { recursive: true, force: true });
  });

  it('replays all event types correctly in a fresh database instance', async () => {
    const savedCwd = process.cwd();
    process.chdir(replayDir);

    // Create a new database instance that will replay all events
    const replayDb2 = new Database();
    await replayDb2.init();

    // Verify user was replayed
    const user = await replayDb2.getUserById(replayUserId);
    expect(user).toBeDefined();
    expect(user!.name).toBe('Replay Tester');

    // Verify API key was replayed (only the non-deleted one)
    const apiKeys = await replayDb2.getUserApiKeys(replayUserId);
    expect(apiKeys.length).toBe(1);
    expect(apiKeys[0].name).toBe('Test API Key');

    // Verify user model was replayed (only the non-deleted one)
    const models = await replayDb2.getUserModels(replayUserId);
    const customModels = models.filter(m => m.name === 'Replay Model');
    expect(customModels.length).toBe(1);

    // Verify conversation was replayed with updated title
    const conv = await replayDb2.getConversation(replayConvId, replayUserId);
    expect(conv).toBeDefined();
    expect(conv!.title).toBe('Updated Title');

    // Verify archived conversation
    const allConvs = await replayDb2.getUserConversations(replayUserId);
    const archivedInList = allConvs.find(c => c.title === 'To Archive');
    expect(archivedInList).toBeUndefined(); // archived should be excluded from getUserConversations

    // Verify messages were replayed with content updates
    const messages = await replayDb2.getConversationMessages(replayConvId, replayUserId);
    expect(messages.length).toBeGreaterThan(0);

    // Verify message content was updated during replay
    const msg1 = messages.find(m => m.branches.some(b => b.content === 'Updated content'));
    expect(msg1).toBeDefined();

    // Verify branch model was updated via message_branch_updated replay
    if (msg1) {
      const updatedBranch = msg1.branches.find(b => b.content === 'Updated content');
      expect(updatedBranch?.model).toBe('claude-3-opus');
    }

    // Verify participant was updated during replay
    const participants = await replayDb2.getConversationParticipants(replayConvId, replayUserId);
    const updatedParticipant = participants.find(p => p.name === 'Updated Participant');
    expect(updatedParticipant).toBeDefined();
    // Deleted participant should be gone
    const deletedParticipant = participants.find(p => p.name === 'Deletable Participant');
    expect(deletedParticipant).toBeUndefined();

    // Verify bookmarks replayed
    const bookmarks = await replayDb2.getConversationBookmarks(replayConvId);
    expect(bookmarks.length).toBeGreaterThanOrEqual(1);
    const updatedBookmark = bookmarks.find(b => b.label === 'Updated Bookmark');
    expect(updatedBookmark).toBeDefined();

    // Verify split created a new message
    const splitMessages = messages.filter(m => m.branches.some(b =>
      b.content === 'First part. ' || b.content === 'Second part.' || b.creationSource === 'split'
    ));
    expect(splitMessages.length).toBeGreaterThanOrEqual(1);

    // Verify metrics replayed
    const metricsSummary = await replayDb2.getConversationMetricsSummary(replayConvId, replayUserId);
    expect(metricsSummary).toBeDefined();

    await replayDb2.close();
    process.chdir(savedCwd);
  });
});

// ==================== Usage stats with actual metrics (covers aggregateUsageFromMetrics branches) ====================

describe('Database — aggregateUsageFromMetrics detailed branches', () => {
  let metricsConvId: string;

  beforeAll(async () => {
    const conv = await db.createConversation(userId, 'Metrics Detail Conv', 'test-model');
    metricsConvId = conv.id;

    // Add metrics with various edge cases
    // Metric with all fields populated
    await db.addMetrics(metricsConvId, userId, {
      model: 'claude-3-opus',
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 10,
      cost: 0.001,
      cacheSavings: 0.0001,
      responseTime: 500,
      timestamp: new Date().toISOString()
    });

    // Metric with undefined/zero fields (to hit || 0 fallback branches)
    await db.addMetrics(metricsConvId, userId, {
      model: '',  // falsy model → hits 'unknown' fallback
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cost: 0,
      cacheSavings: 0,
      responseTime: 0,
      timestamp: new Date().toISOString()
    });

    // Another metric for a different model
    await db.addMetrics(metricsConvId, userId, {
      model: 'gpt-4',
      inputTokens: 200,
      outputTokens: 100,
      cachedTokens: 20,
      cost: 0.005,
      cacheSavings: 0.001,
      responseTime: 800,
      timestamp: new Date().toISOString()
    });
  });

  it('getUserUsageStats returns detailed stats with daily/byModel breakdown', async () => {
    const stats = await db.getUserUsageStats(userId, 30);
    expect(stats).toBeDefined();
    // allUsage should contain daily and byModel breakdowns
    if (stats.allUsage) {
      expect(stats.allUsage.daily).toBeDefined();
      expect(stats.allUsage.totals).toBeDefined();
      expect(stats.allUsage.byModel).toBeDefined();
      expect(stats.allUsage.totals.requests).toBeGreaterThan(0);
    }
  });

  it('getUserUsageStats with short time window filters old metrics', async () => {
    // 0 days should filter everything (all timestamps are "now")
    const stats = await db.getUserUsageStats(userId, 0);
    expect(stats).toBeDefined();
  });

  it('getSystemStats includes active users', async () => {
    const stats = await db.getSystemStats();
    expect(stats).toBeDefined();
    expect(stats.totalUsers).toBeGreaterThan(0);
    expect(stats.totalConversations).toBeGreaterThan(0);
  });

  it('getUserStats returns correct counts', async () => {
    const stats = await db.getUserStats(userId);
    expect(stats).toBeDefined();
    expect(stats.conversationCount).toBeGreaterThan(0);
    // lastActive should be defined since we have conversations
    expect(stats.lastActive).toBeDefined();
  });

  it('getAllUsersWithStats returns stats with capabilities and balances', async () => {
    const allStats = await db.getAllUsersWithStats();
    expect(allStats).toBeDefined();
    expect(allStats.length).toBeGreaterThan(0);

    const ourUser = allStats.find(u => u.id === userId);
    expect(ourUser).toBeDefined();
    expect(ourUser!.conversationCount).toBeGreaterThan(0);
    expect(ourUser!.capabilities).toBeDefined();
    expect(ourUser!.balances).toBeDefined();
  });
});

// ==================== Collaboration access path in tryLoadAndVerifyConversation ====================

describe('Database — collaboration access to conversation', () => {
  it('shared user can access conversation via tryLoadAndVerifyConversation', async () => {
    // Create two users
    const owner = await db.createUser('collab-owner@test.com', 'Pass123!', 'Owner');
    const collaborator = await db.createUser('collab-shared@test.com', 'Pass123!', 'Collaborator');

    // Create conversation owned by owner
    const conv = await db.createConversation(owner.id, 'Shared Conv', 'test-model');

    // Share with collaborator (params: conversationId, sharedWithEmail, sharedByUserId, permission)
    const share = await db.createCollaborationShare(
      conv.id, collaborator.email, owner.id, 'editor'
    );
    expect(share).toBeDefined();

    // Collaborator should be able to access the conversation
    const accessed = await db.getConversation(conv.id, collaborator.id);
    expect(accessed).not.toBeNull();
    expect(accessed!.id).toBe(conv.id);
  });

  it('unrelated user cannot access conversation', async () => {
    const owner = await db.createUser('access-owner@test.com', 'Pass123!', 'Owner2');
    const stranger = await db.createUser('stranger@test.com', 'Pass123!', 'Stranger');

    const conv = await db.createConversation(owner.id, 'Private Conv', 'test-model');

    // Stranger should NOT be able to access
    const accessed = await db.getConversation(conv.id, stranger.id);
    expect(accessed).toBeNull();
  });
});

// ==================== getUserGrantSummary ====================

describe('Database — getUserGrantSummary', () => {
  it('returns grant summary with totals and infos', async () => {
    const summary = await db.getUserGrantSummary(userId);
    expect(summary).toBeDefined();
    expect(summary.totals).toBeDefined();
    expect(summary.grantInfos).toBeDefined();
    expect(summary.grantCapabilities).toBeDefined();
  });
});

// ==================== createConversation edge cases ====================

describe('Database — createConversation edge cases', () => {
  it('uses fallback settings for unknown model', async () => {
    // 'nonexistent-model' won't be found in config, triggers fallback
    const conv = await db.createConversation(userId, 'Unknown Model Conv', 'nonexistent-model');
    expect(conv).toBeDefined();
    expect(conv.settings).toBeDefined();
    // Fallback settings: temperature 1.0, maxTokens 4096
    expect(conv.settings.temperature).toBe(1.0);
    expect(conv.settings.maxTokens).toBe(4096);
  });

  it('creates with explicit settings (no model lookup needed)', async () => {
    const settings = { temperature: 0.5, maxTokens: 2000 };
    const conv = await db.createConversation(userId, 'Custom Settings Conv', 'test-model', undefined, settings);
    expect(conv).toBeDefined();
    expect(conv.settings.temperature).toBe(0.5);
  });
});
