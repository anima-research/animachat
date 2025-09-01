// Re-export all types from individual files
export * from './types.js';
export * from './api-types.js';
export * from './import-types.js';

// Utility functions
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

// Model list moved to config/models.json for flexibility
// This export is kept for backward compatibility but should not be used
// Use ModelLoader service instead
export const MODELS: import('./types.js').Model[] = [];