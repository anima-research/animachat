import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateActiveBranches } from './fix-branches.js';

/**
 * Fix-branches characterization tests.
 *
 * We mock the Database to provide controlled message data and verify
 * that validateActiveBranches correctly identifies and repairs invalid
 * activeBranchId references.
 */

function makeMockDb() {
  const getConversationMessages = vi.fn();
  const setActiveBranch = vi.fn();
  return {
    db: { getConversationMessages, setActiveBranch } as any,
    getConversationMessages,
    setActiveBranch,
  };
}

describe('validateActiveBranches', () => {
  it('does nothing when all branches are valid', async () => {
    const { db, setActiveBranch } = makeMockDb();

    db.getConversationMessages.mockResolvedValue([
      {
        id: 'msg1',
        activeBranchId: 'b1',
        branches: [
          { id: 'b1', createdAt: '2025-01-01T00:00:00Z' },
          { id: 'b2', createdAt: '2025-01-02T00:00:00Z' },
        ],
      },
    ]);

    await validateActiveBranches(db, 'conv1', 'user1');

    expect(setActiveBranch).not.toHaveBeenCalled();
  });

  it('repairs invalid activeBranchId by setting to most recent branch', async () => {
    const { db, setActiveBranch } = makeMockDb();

    db.getConversationMessages.mockResolvedValue([
      {
        id: 'msg1',
        activeBranchId: 'nonexistent-branch',
        branches: [
          { id: 'b-old', createdAt: '2025-01-01T00:00:00Z' },
          { id: 'b-new', createdAt: '2025-06-15T00:00:00Z' },
        ],
      },
    ]);

    await validateActiveBranches(db, 'conv1', 'user1');

    expect(setActiveBranch).toHaveBeenCalledTimes(1);
    expect(setActiveBranch).toHaveBeenCalledWith('msg1', 'conv1', 'user1', 'b-new');
  });

  it('fixes multiple messages with invalid branches', async () => {
    const { db, setActiveBranch } = makeMockDb();

    db.getConversationMessages.mockResolvedValue([
      {
        id: 'msg1',
        activeBranchId: 'invalid-1',
        branches: [
          { id: 'b1', createdAt: '2025-01-01T00:00:00Z' },
        ],
      },
      {
        id: 'msg2',
        activeBranchId: 'valid-branch',
        branches: [
          { id: 'valid-branch', createdAt: '2025-01-01T00:00:00Z' },
        ],
      },
      {
        id: 'msg3',
        activeBranchId: 'invalid-2',
        branches: [
          { id: 'b3a', createdAt: '2025-03-01T00:00:00Z' },
          { id: 'b3b', createdAt: '2025-04-01T00:00:00Z' },
        ],
      },
    ]);

    await validateActiveBranches(db, 'conv1', 'user1');

    expect(setActiveBranch).toHaveBeenCalledTimes(2);
    // msg1 -> b1 (only branch)
    expect(setActiveBranch).toHaveBeenCalledWith('msg1', 'conv1', 'user1', 'b1');
    // msg3 -> b3b (most recent)
    expect(setActiveBranch).toHaveBeenCalledWith('msg3', 'conv1', 'user1', 'b3b');
  });

  it('handles conversation with no messages', async () => {
    const { db, setActiveBranch } = makeMockDb();
    db.getConversationMessages.mockResolvedValue([]);

    await validateActiveBranches(db, 'conv1', 'user1');

    expect(setActiveBranch).not.toHaveBeenCalled();
  });

  it('skips messages with no branches (edge case)', async () => {
    const { db, setActiveBranch } = makeMockDb();

    db.getConversationMessages.mockResolvedValue([
      {
        id: 'msg1',
        activeBranchId: 'nonexistent',
        branches: [], // No branches at all — can't repair
      },
    ]);

    await validateActiveBranches(db, 'conv1', 'user1');

    // sortedBranches.length is 0, so no repair
    expect(setActiveBranch).not.toHaveBeenCalled();
  });
});
