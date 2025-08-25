export * from './types.js';

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

// Constants
export const MODELS: import('./types.js').Model[] = [
  {
    id: 'claude-3-opus-20240229',
    name: 'claude-3-opus',
    displayName: 'Claude 3 Opus',
    provider: 'anthropic',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 800,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'claude-3-5-sonnet-20240620',
    name: 'claude-3-6-sonnet',
    displayName: 'Claude 3.6 Sonnet',
    provider: 'anthropic',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 800,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'anthropic.claude-3-sonnet-20240229-v1:0',
    name: 'claude-3-sonnet',
    displayName: 'Claude 3 Sonnet',
    provider: 'bedrock',
    deprecated: true,
    contextWindow: 200000,
    outputTokenLimit: 800,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'anthropic.claude-2.1-20240219-v1:0',
    name: 'claude-2.1',
    displayName: 'Claude 2.1',
    provider: 'bedrock',
    deprecated: true,
    contextWindow: 100000,
    outputTokenLimit: 800,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'anthropic.claude-2.0-20240219-v1:0',
    name: 'claude-2.0',
    displayName: 'Claude 2.0',
    provider: 'bedrock',
    deprecated: true,
    contextWindow: 100000,
    outputTokenLimit: 800,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'anthropic.claude-instant-1.2-20240219-v1:0',
    name: 'claude-instant-1.2',
    displayName: 'Claude Instant 1.2',
    provider: 'bedrock',
    deprecated: true,
    contextWindow: 100000,
    outputTokenLimit: 800,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  }
];
