export * from './types.js';
export * from './import-types.js';
export * from './api-types.js';
export * from './grants.js';
export * from './sharing.js';

// Utility functions for handling conversation branches
export function getActiveBranch(message: import('./types.js').Message): import('./types.js').MessageBranch | undefined {
  return message.branches.find(b => b.id === message.activeBranchId);
}

