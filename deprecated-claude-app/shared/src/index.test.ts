import { describe, it, expect } from 'vitest';
import { getActiveBranch } from './index.js';
import type { Message, MessageBranch } from './types.js';

// ============================================================================
// getActiveBranch
// ============================================================================

describe('getActiveBranch', () => {
  const makeBranch = (id: string): MessageBranch => ({
    id,
    content: `Content for ${id}`,
    role: 'user',
    createdAt: new Date('2025-01-15'),
  });

  it('returns the branch matching activeBranchId', () => {
    const branch1 = makeBranch('00000000-0000-4000-a000-000000000001');
    const branch2 = makeBranch('00000000-0000-4000-a000-000000000002');
    const message: Message = {
      id: '00000000-0000-4000-a000-000000000010',
      conversationId: '00000000-0000-4000-a000-000000000020',
      branches: [branch1, branch2],
      activeBranchId: branch2.id,
      order: 0,
    };
    const result = getActiveBranch(message);
    expect(result).toBe(branch2);
    expect(result!.id).toBe('00000000-0000-4000-a000-000000000002');
  });

  it('returns undefined when activeBranchId does not match any branch', () => {
    const branch = makeBranch('00000000-0000-4000-a000-000000000001');
    const message: Message = {
      id: '00000000-0000-4000-a000-000000000010',
      conversationId: '00000000-0000-4000-a000-000000000020',
      branches: [branch],
      activeBranchId: '00000000-0000-4000-a000-000000000099', // non-existent
      order: 0,
    };
    const result = getActiveBranch(message);
    expect(result).toBeUndefined();
  });

  it('returns first matching branch when message has one branch', () => {
    const branch = makeBranch('00000000-0000-4000-a000-000000000001');
    const message: Message = {
      id: '00000000-0000-4000-a000-000000000010',
      conversationId: '00000000-0000-4000-a000-000000000020',
      branches: [branch],
      activeBranchId: branch.id,
      order: 0,
    };
    const result = getActiveBranch(message);
    expect(result).toBe(branch);
    expect(result!.content).toBe('Content for 00000000-0000-4000-a000-000000000001');
  });
});
