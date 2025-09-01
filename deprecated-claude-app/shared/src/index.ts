export * from './types.js';
export * from './import-types.js';
export * from './api-types.js';

// Utility functions for handling conversation branches
export function getActiveBranch(message: import('./types.js').Message): import('./types.js').MessageBranch | undefined {
  return message.branches.find(b => b.id === message.activeBranchId);
}

export function createBranch(
  content: string,
  role: 'user' | 'assistant' | 'system',
  parentBranchId?: string,
  model?: string
): import('./types.js').MessageBranch {
  return {
    id: crypto.randomUUID(),
    content,
    role,
    createdAt: new Date(),
    model,
    parentBranchId,
    isActive: true
  };
}

