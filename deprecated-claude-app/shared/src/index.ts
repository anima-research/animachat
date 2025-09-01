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

// Constants
export const MODELS: import('./types.js').Model[] = [
  {
    id: 'claude-opus-4-1-20250805',
    name: 'claude-opus-4-1',
    displayName: 'Claude Opus 4.1',
    provider: 'anthropic',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'claude-opus-4',
    displayName: 'Claude Opus 4',
    provider: 'anthropic',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'claude-sonnet-4',
    displayName: 'Claude Sonnet 4',
    provider: 'anthropic',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'claude-3-7-sonnet',
    displayName: 'Claude Sonnet 3.7',
    provider: 'anthropic',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'claude-3-5-haiku',
    displayName: 'Claude Haiku 3.5',
    provider: 'anthropic',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'claude-3-opus',
    displayName: 'Claude 3 Opus',
    provider: 'anthropic',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'claude-3-5-sonnet-20240620',
    name: 'claude-3-5-sonnet',
    displayName: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'claude-3-6-sonnet',
    displayName: 'Claude 3.6 Sonnet',
    provider: 'anthropic',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'anthropic.claude-opus-4-1-20250805-v1:0',
    name: 'claude-opus-4-1-bedrock',
    displayName: 'Claude Opus 4.1 (Bedrock)',
    provider: 'bedrock',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'anthropic.claude-opus-4-20250514-v1:0',
    name: 'claude-opus-4-bedrock',
    displayName: 'Claude Opus 4 (Bedrock)',
    provider: 'bedrock',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'anthropic.claude-sonnet-4-20250514-v1:0',
    name: 'claude-sonnet-4-bedrock',
    displayName: 'Claude Sonnet 4 (Bedrock)',
    provider: 'bedrock',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
    name: 'claude-3-7-sonnet-bedrock',
    displayName: 'Claude Sonnet 3.7 (Bedrock)',
    provider: 'bedrock',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    name: 'claude-3-5-haiku-bedrock',
    displayName: 'Claude Haiku 3.5 (Bedrock)',
    provider: 'bedrock',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
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
    outputTokenLimit: 4096,
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
    outputTokenLimit: 4096,
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
    outputTokenLimit: 4096,
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
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 1, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  // OpenRouter models
  {
    id: 'anthropic/claude-3-opus',
    name: 'claude-3-opus-openrouter',
    displayName: 'Claude 3 Opus (OpenRouter)',
    provider: 'openrouter',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 2, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'claude-3-5-sonnet-openrouter',
    displayName: 'Claude 3.5 Sonnet (OpenRouter)',
    provider: 'openrouter',
    deprecated: false,
    contextWindow: 200000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 2, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'openai/gpt-4-turbo-preview',
    name: 'gpt-4-turbo-openrouter',
    displayName: 'GPT-4 Turbo (OpenRouter)',
    provider: 'openrouter',
    deprecated: false,
    contextWindow: 128000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 2, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  },
  {
    id: 'meta-llama/llama-3.1-405b-instruct',
    name: 'llama-3-1-405b-openrouter',
    displayName: 'Llama 3.1 405B (OpenRouter)',
    provider: 'openrouter',
    deprecated: false,
    contextWindow: 128000,
    outputTokenLimit: 4096,
    settings: {
      temperature: { min: 0, max: 2, default: 1.0, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
      topP: { min: 0, max: 1, default: 0.9, step: 0.01 },
      topK: { min: 1, max: 500, default: 40, step: 1 }
    }
  }
];
