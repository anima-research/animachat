import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import type { Message, Participant, Conversation, Model, ConversationFormat, ConversationMode, ContentBlock } from '@deprecated-claude/shared';

// ── Mocks (outermost layer only) ──────────────────────────────────────────

// Mock logger so real logging doesn't pollute test output
vi.mock('../utils/logger.js', () => ({
  Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    inference: vi.fn(),
  },
}));

// Mock llmLogger
vi.mock('../utils/llmLogger.js', () => ({
  llmLogger: {
    logRequest: vi.fn(),
    logResponse: vi.fn(),
    logCustom: vi.fn(),
  },
}));

// Mock sharp (image processing)
vi.mock('sharp', () => {
  const mockSharp = vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('img')),
  }));
  return { default: mockSharp };
});

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: vi.fn() };
    constructor(_opts?: any) {}
  }
  return { default: MockAnthropic };
});

// Mock Bedrock SDK
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class { send = vi.fn(); },
  ConverseStreamCommand: class { constructor(public input: any) {} },
}));

// Mock google genai
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContentStream: vi.fn() };
    constructor(_opts?: any) {}
  },
}));

// Mock Database
const mockDb = {
  getUserApiKeys: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn().mockReturnValue({}),
  getUser: vi.fn().mockResolvedValue(null),
  getUserByUsername: vi.fn().mockResolvedValue(null),
};

vi.mock('../database/index.js', () => ({
  Database: class MockDatabase {
    getUserApiKeys = mockDb.getUserApiKeys;
    getConfig = mockDb.getConfig;
    getUser = mockDb.getUser;
    getUserByUsername = mockDb.getUserByUsername;
  },
}));

// Mock ModelLoader singleton
const mockModelLoader = {
  getModelById: vi.fn(),
  getAllModels: vi.fn().mockResolvedValue([]),
  getModelsByProvider: vi.fn().mockResolvedValue([]),
};

vi.mock('../config/model-loader.js', () => ({
  ModelLoader: {
    getInstance: () => mockModelLoader,
  },
}));

// Mock ConfigLoader singleton (used by ApiKeyManager)
vi.mock('../config/config-loader.js', () => ({
  ConfigLoader: {
    getInstance: () => ({
      getConfig: vi.fn().mockReturnValue({
        providers: {},
        features: {},
        grants: { enabled: false },
      }),
      getProviderConfig: vi.fn().mockReturnValue(null),
    }),
  },
}));

// Mock ContextManager
vi.mock('./context-manager.js', () => ({
  ContextManager: class MockContextManager {
    prepareContext = vi.fn().mockResolvedValue({
      window: { messages: [] },
      formattedMessages: [],
    });
    constructor(..._args: any[]) {}
  },
}));

// Mock PersonaContextBuilder (imported by context-manager)
vi.mock('./persona-context-builder.js', () => ({
  PersonaContextBuilder: class MockPersonaContextBuilder {
    constructor(..._args: any[]) {}
  },
}));

// Mock provider services — let streamCompletion call onChunk then return
const mockAnthropicStreamCompletion = vi.fn().mockImplementation(
  async (_modelId: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
    await onChunk('Hello from Anthropic', false);
    await onChunk('', true, undefined, { inputTokens: 10, outputTokens: 5 });
    return { usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } };
  }
);
const mockAnthropicFormatMessages = vi.fn().mockImplementation((msgs: any) =>
  msgs.map((m: any) => ({ role: m.branches?.[0]?.role || 'user', content: m.branches?.[0]?.content || '' }))
);

vi.mock('./anthropic.js', () => ({
  AnthropicService: class MockAnthropicService {
    streamCompletion = mockAnthropicStreamCompletion;
    formatMessagesForAnthropic = mockAnthropicFormatMessages;
    validateApiKey = vi.fn().mockResolvedValue(true);
    constructor(..._args: any[]) {}
  },
}));

const mockBedrockStreamCompletion = vi.fn().mockImplementation(
  async (_modelId: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
    await onChunk('Hello from Bedrock', false);
    await onChunk('', true);
    return {};
  }
);
const mockBedrockFormatMessages = vi.fn().mockImplementation((msgs: any) =>
  msgs.map((m: any) => ({ role: m.branches?.[0]?.role || 'user', content: m.branches?.[0]?.content || '' }))
);

vi.mock('./bedrock.js', () => ({
  BedrockService: class MockBedrockService {
    streamCompletion = mockBedrockStreamCompletion;
    formatMessagesForClaude = mockBedrockFormatMessages;
    validateApiKey = vi.fn().mockResolvedValue(true);
    constructor(..._args: any[]) {}
  },
}));

const mockOpenRouterStreamCompletion = vi.fn().mockImplementation(
  async (_modelId: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
    await onChunk('Hello from OpenRouter', false);
    await onChunk('', true);
    return { usage: { inputTokens: 10, outputTokens: 5 } };
  }
);
const mockOpenRouterFormatMessages = vi.fn().mockImplementation((msgs: any, _sys?: string) =>
  msgs.map((m: any) => ({ role: m.branches?.[0]?.role || 'user', content: m.branches?.[0]?.content || '' }))
);

vi.mock('./openrouter.js', () => ({
  OpenRouterService: class MockOpenRouterService {
    streamCompletion = mockOpenRouterStreamCompletion;
    streamCompletionExactTest = mockOpenRouterStreamCompletion;
    formatMessagesForOpenRouter = mockOpenRouterFormatMessages;
    constructor(..._args: any[]) {}
  },
}));

const mockOpenAIStreamCompletion = vi.fn().mockImplementation(
  async (_modelId: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
    await onChunk('Hello from OpenAI', false);
    await onChunk('', true);
    return {};
  }
);
const mockOpenAIFormatMessages = vi.fn().mockImplementation((msgs: any, _sys?: string) =>
  msgs.map((m: any) => ({ role: m.branches?.[0]?.role || 'user', content: m.branches?.[0]?.content || '' }))
);

vi.mock('./openai-compatible.js', () => ({
  OpenAICompatibleService: class MockOpenAICompatibleService {
    streamCompletion = mockOpenAIStreamCompletion;
    formatMessagesForOpenAI = mockOpenAIFormatMessages;
    constructor(..._args: any[]) {}
  },
}));

const mockGeminiStreamCompletion = vi.fn().mockImplementation(
  async (_modelId: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
    await onChunk('Hello from Gemini', false);
    await onChunk('', true);
    return {};
  }
);

vi.mock('./gemini.js', () => ({
  GeminiService: class MockGeminiService {
    streamCompletion = mockGeminiStreamCompletion;
    constructor(..._args: any[]) {}
  },
}));

// Mock ApiKeyManager
const mockGetApiKeyForRequest = vi.fn().mockResolvedValue({
  source: 'config',
  credentials: { apiKey: 'test-key', baseUrl: 'http://localhost', accessKeyId: 'ak', secretAccessKey: 'sk' },
  profile: { name: 'default', rateLimit: { maxRequests: 100, windowMs: 60000 } },
});
const mockCheckRateLimits = vi.fn().mockResolvedValue({ allowed: true });
const mockTrackUsage = vi.fn().mockResolvedValue(undefined);

vi.mock('./api-key-manager.js', () => ({
  ApiKeyManager: class MockApiKeyManager {
    getApiKeyForRequest = mockGetApiKeyForRequest;
    checkRateLimits = mockCheckRateLimits;
    trackUsage = mockTrackUsage;
    constructor(..._args: any[]) {}
  },
}));

import { InferenceService } from './inference.js';
import { Database } from '../database/index.js';

// ── Test Helpers ──────────────────────────────────────────────────────────

function makeMessage(
  content: string,
  role: 'user' | 'assistant' | 'system' = 'user',
  opts: {
    id?: string;
    conversationId?: string;
    order?: number;
    participantId?: string;
    attachments?: any[];
    contentBlocks?: ContentBlock[];
    postHocOperation?: any;
    hiddenFromAi?: boolean;
    prefixHistory?: any[];
  } = {}
): Message {
  const branchId = randomUUID();
  const branch: any = {
    id: branchId,
    content,
    role,
    createdAt: new Date(),
    participantId: opts.participantId,
  };
  if (opts.attachments) branch.attachments = opts.attachments;
  if (opts.contentBlocks) branch.contentBlocks = opts.contentBlocks;
  if (opts.postHocOperation) branch.postHocOperation = opts.postHocOperation;
  if (opts.hiddenFromAi !== undefined) branch.hiddenFromAi = opts.hiddenFromAi;
  if (opts.prefixHistory) branch.prefixHistory = opts.prefixHistory;

  return {
    id: opts.id ?? randomUUID(),
    conversationId: opts.conversationId ?? randomUUID(),
    branches: [branch],
    activeBranchId: branchId,
    order: opts.order ?? 0,
  };
}

function makeParticipant(
  name: string,
  type: 'user' | 'assistant' = 'assistant',
  opts: {
    id?: string;
    model?: string;
    conversationMode?: ConversationMode;
    personaId?: string;
  } = {}
): Participant {
  return {
    id: opts.id ?? randomUUID(),
    conversationId: randomUUID(),
    name,
    type,
    model: opts.model,
    conversationMode: opts.conversationMode,
    isActive: true,
    personaId: opts.personaId,
  } as Participant;
}

function makeModel(
  provider: string,
  opts: {
    id?: string;
    supportsPrefill?: boolean;
    supportsThinking?: boolean;
    contextWindow?: number;
    outputTokenLimit?: number;
  } = {}
): Model {
  return {
    id: opts.id ?? `test-model-${provider}`,
    providerModelId: `${provider}-model-v1`,
    displayName: `Test ${provider} Model`,
    shortName: provider,
    provider,
    hidden: false,
    contextWindow: opts.contextWindow ?? 200000,
    outputTokenLimit: opts.outputTokenLimit ?? 4096,
    supportsThinking: opts.supportsThinking,
    supportsPrefill: opts.supportsPrefill,
    settings: {
      temperature: { min: 0, max: 1, default: 0.7, step: 0.1 },
      maxTokens: { min: 1, max: 4096, default: 1024 },
    },
  } as Model;
}

function makeConversation(
  format: ConversationFormat = 'standard',
  opts: {
    id?: string;
    combineConsecutiveMessages?: boolean;
    prefillUserMessage?: { enabled: boolean; content: string };
  } = {}
): Conversation {
  return {
    id: opts.id ?? randomUUID(),
    userId: randomUUID(),
    title: 'Test Conversation',
    model: 'test-model',
    format,
    createdAt: new Date(),
    updatedAt: new Date(),
    archived: false,
    settings: { temperature: 0.7, maxTokens: 1024 },
    combineConsecutiveMessages: opts.combineConsecutiveMessages,
    prefillUserMessage: opts.prefillUserMessage,
  } as Conversation;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('InferenceService', () => {
  let service: InferenceService;

  beforeEach(() => {
    vi.clearAllMocks();
    const db = new Database() as any;
    service = new InferenceService(db);
  });

  // Access private methods via bracket notation for characterization testing
  const callPrivate = (method: string, ...args: any[]) =>
    (service as any)[method](...args);

  // ── determineActualFormat ───────────────────────────────────────────

  describe('determineActualFormat', () => {
    it('returns "standard" when conversation format is standard', () => {
      const model = makeModel('anthropic');
      const result = callPrivate('determineActualFormat', 'standard', model, undefined);
      expect(result).toBe('standard');
    });

    it('returns "standard" even if participant requests prefill when conversation is standard', () => {
      const model = makeModel('anthropic');
      const result = callPrivate('determineActualFormat', 'standard', model, 'prefill');
      expect(result).toBe('standard');
    });

    it('returns "prefill" for anthropic model when conversation format is prefill', () => {
      const model = makeModel('anthropic');
      const result = callPrivate('determineActualFormat', 'prefill', model, undefined);
      expect(result).toBe('prefill');
    });

    it('returns "prefill" for bedrock model when conversation format is prefill', () => {
      const model = makeModel('bedrock');
      const result = callPrivate('determineActualFormat', 'prefill', model, undefined);
      expect(result).toBe('prefill');
    });

    it('returns "prefill" for google model when conversation format is prefill', () => {
      const model = makeModel('google');
      const result = callPrivate('determineActualFormat', 'prefill', model, undefined);
      expect(result).toBe('prefill');
    });

    it('returns "messages" for openrouter model when conversation format is prefill (no native prefill)', () => {
      const model = makeModel('openrouter');
      const result = callPrivate('determineActualFormat', 'prefill', model, undefined);
      expect(result).toBe('messages');
    });

    it('returns "messages" for openai-compatible model when conversation format is prefill', () => {
      const model = makeModel('openai-compatible');
      const result = callPrivate('determineActualFormat', 'prefill', model, undefined);
      expect(result).toBe('messages');
    });

    // Participant mode overrides
    it('returns "prefill" when participant explicitly requests prefill and model supports it', () => {
      const model = makeModel('anthropic');
      const result = callPrivate('determineActualFormat', 'prefill', model, 'prefill');
      expect(result).toBe('prefill');
    });

    it('returns "messages" when participant requests prefill but model does not support it', () => {
      const model = makeModel('openrouter');
      const result = callPrivate('determineActualFormat', 'prefill', model, 'prefill');
      expect(result).toBe('messages');
    });

    it('returns "messages" when participant explicitly requests messages', () => {
      const model = makeModel('anthropic');
      const result = callPrivate('determineActualFormat', 'prefill', model, 'messages');
      expect(result).toBe('messages');
    });

    it('returns "completion" for openrouter when participant requests completion', () => {
      const model = makeModel('openrouter');
      const result = callPrivate('determineActualFormat', 'prefill', model, 'completion');
      expect(result).toBe('completion');
    });

    it('returns "messages" when participant requests completion on non-openrouter', () => {
      const model = makeModel('anthropic');
      const result = callPrivate('determineActualFormat', 'prefill', model, 'completion');
      expect(result).toBe('messages');
    });

    it('uses auto mode (default) when participant mode is "auto"', () => {
      const model = makeModel('anthropic');
      const result = callPrivate('determineActualFormat', 'prefill', model, 'auto');
      expect(result).toBe('prefill');
    });

    it('respects supportsPrefill=false on model even for anthropic', () => {
      const model = makeModel('anthropic', { supportsPrefill: false });
      const result = callPrivate('determineActualFormat', 'prefill', model, undefined);
      expect(result).toBe('messages');
    });

    it('respects supportsPrefill=true on openrouter model (custom opt-in)', () => {
      const model = makeModel('openrouter', { supportsPrefill: true });
      const result = callPrivate('determineActualFormat', 'prefill', model, undefined);
      expect(result).toBe('prefill');
    });
  });

  // ── modelSupportsPrefill ────────────────────────────────────────────

  describe('modelSupportsPrefill', () => {
    it('returns true for anthropic by default', () => {
      expect(callPrivate('modelSupportsPrefill', makeModel('anthropic'))).toBe(true);
    });

    it('returns true for bedrock by default', () => {
      expect(callPrivate('modelSupportsPrefill', makeModel('bedrock'))).toBe(true);
    });

    it('returns true for google by default', () => {
      expect(callPrivate('modelSupportsPrefill', makeModel('google'))).toBe(true);
    });

    it('returns false for openrouter by default', () => {
      expect(callPrivate('modelSupportsPrefill', makeModel('openrouter'))).toBe(false);
    });

    it('returns false for openai-compatible by default', () => {
      expect(callPrivate('modelSupportsPrefill', makeModel('openai-compatible'))).toBe(false);
    });

    it('returns false when supportsPrefill explicitly set to false', () => {
      expect(callPrivate('modelSupportsPrefill', makeModel('anthropic', { supportsPrefill: false }))).toBe(false);
    });

    it('returns true for openrouter when supportsPrefill explicitly set to true', () => {
      expect(callPrivate('modelSupportsPrefill', makeModel('openrouter', { supportsPrefill: true }))).toBe(true);
    });
  });

  // ── providerSupportsPrefill ─────────────────────────────────────────

  describe('providerSupportsPrefill', () => {
    it('returns true for anthropic', () => {
      expect(callPrivate('providerSupportsPrefill', 'anthropic')).toBe(true);
    });

    it('returns true for bedrock', () => {
      expect(callPrivate('providerSupportsPrefill', 'bedrock')).toBe(true);
    });

    it('returns true for google', () => {
      expect(callPrivate('providerSupportsPrefill', 'google')).toBe(true);
    });

    it('returns false for openrouter', () => {
      expect(callPrivate('providerSupportsPrefill', 'openrouter')).toBe(false);
    });

    it('returns false for openai-compatible', () => {
      expect(callPrivate('providerSupportsPrefill', 'openai-compatible')).toBe(false);
    });
  });

  // ── applyPostHocOperations ──────────────────────────────────────────

  describe('applyPostHocOperations', () => {
    const convId = randomUUID();

    it('returns messages unchanged when no operations exist', () => {
      const msgs = [
        makeMessage('Hello', 'user', { order: 0, conversationId: convId }),
        makeMessage('Hi back', 'assistant', { order: 1, conversationId: convId }),
      ];
      const result = callPrivate('applyPostHocOperations', msgs);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(msgs[0].id);
      expect(result[1].id).toBe(msgs[1].id);
    });

    it('hides a specific message', () => {
      const target = makeMessage('secret', 'user', { order: 0, conversationId: convId });
      const op = makeMessage('', 'user', {
        order: 1,
        conversationId: convId,
        postHocOperation: {
          type: 'hide',
          targetMessageId: target.id,
          targetBranchId: target.activeBranchId,
        },
      });
      const other = makeMessage('visible', 'assistant', { order: 2, conversationId: convId });

      const result = callPrivate('applyPostHocOperations', [target, op, other]);
      // operation message itself is excluded, target is hidden, only "other" remains
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(other.id);
    });

    it('hides all messages before a target via hide_before', () => {
      const m0 = makeMessage('old1', 'user', { order: 0, conversationId: convId });
      const m1 = makeMessage('old2', 'assistant', { order: 1, conversationId: convId });
      const m2 = makeMessage('keep', 'user', { order: 2, conversationId: convId });
      const op = makeMessage('', 'user', {
        order: 3,
        conversationId: convId,
        postHocOperation: {
          type: 'hide_before',
          targetMessageId: m2.id,
          targetBranchId: m2.activeBranchId,
        },
      });
      const m3 = makeMessage('also keep', 'assistant', { order: 4, conversationId: convId });

      const result = callPrivate('applyPostHocOperations', [m0, m1, m2, op, m3]);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(m2.id);
      expect(result[1].id).toBe(m3.id);
    });

    it('edits a message content via edit operation', () => {
      const target = makeMessage('original', 'user', { order: 0, conversationId: convId });
      const replacement: ContentBlock[] = [{ type: 'text', text: 'edited content' }];
      const op = makeMessage('', 'user', {
        order: 1,
        conversationId: convId,
        postHocOperation: {
          type: 'edit',
          targetMessageId: target.id,
          targetBranchId: target.activeBranchId,
          replacementContent: replacement,
        },
      });

      const result = callPrivate('applyPostHocOperations', [target, op]);
      expect(result).toHaveLength(1);
      const editedBranch = result[0].branches.find((b: any) => b.id === result[0].activeBranchId);
      expect(editedBranch.content).toBe('edited content');
      expect(editedBranch.contentBlocks).toEqual(replacement);
    });

    it('hides specific attachments via hide_attachment', () => {
      const target = makeMessage('with attachments', 'user', {
        order: 0,
        conversationId: convId,
        attachments: [
          { fileName: 'a.txt', content: 'aaa' },
          { fileName: 'b.txt', content: 'bbb' },
          { fileName: 'c.txt', content: 'ccc' },
        ],
      });
      const op = makeMessage('', 'user', {
        order: 1,
        conversationId: convId,
        postHocOperation: {
          type: 'hide_attachment',
          targetMessageId: target.id,
          targetBranchId: target.activeBranchId,
          attachmentIndices: [0, 2],
        },
      });

      const result = callPrivate('applyPostHocOperations', [target, op]);
      expect(result).toHaveLength(1);
      const branch = result[0].branches.find((b: any) => b.id === result[0].activeBranchId);
      expect(branch.attachments).toHaveLength(1);
      expect(branch.attachments[0].fileName).toBe('b.txt');
    });

    it('unhides a previously hidden message', () => {
      const target = makeMessage('toggled', 'user', { order: 0, conversationId: convId });
      const hideOp = makeMessage('', 'user', {
        order: 1,
        conversationId: convId,
        postHocOperation: {
          type: 'hide',
          targetMessageId: target.id,
          targetBranchId: target.activeBranchId,
        },
      });
      const unhideOp = makeMessage('', 'user', {
        order: 2,
        conversationId: convId,
        postHocOperation: {
          type: 'unhide',
          targetMessageId: target.id,
          targetBranchId: target.activeBranchId,
        },
      });

      const result = callPrivate('applyPostHocOperations', [target, hideOp, unhideOp]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(target.id);
    });

    it('excludes operation messages themselves from output', () => {
      const m = makeMessage('normal', 'user', { order: 0, conversationId: convId });
      const op = makeMessage('', 'user', {
        order: 1,
        conversationId: convId,
        postHocOperation: {
          type: 'hide',
          targetMessageId: randomUUID(), // targeting nonexistent is fine
          targetBranchId: randomUUID(),
        },
      });

      const result = callPrivate('applyPostHocOperations', [m, op]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(m.id);
    });

    it('handles empty message list', () => {
      const result = callPrivate('applyPostHocOperations', []);
      expect(result).toHaveLength(0);
    });
  });

  // ── estimateTokens ─────────────────────────────────────────────────

  describe('estimateTokens', () => {
    it('estimates tokens as ceil(length/4) for simple text', () => {
      const msg = makeMessage('Hello world', 'user'); // 11 chars => ceil(11/4)=3
      const result = callPrivate('estimateTokens', [msg]);
      expect(result).toBe(Math.ceil(11 / 4));
    });

    it('returns 0 for empty content', () => {
      const msg = makeMessage('', 'user');
      const result = callPrivate('estimateTokens', [msg]);
      expect(result).toBe(0);
    });

    it('sums across multiple messages', () => {
      const m1 = makeMessage('Hello', 'user');   // 5 chars
      const m2 = makeMessage('World!', 'assistant'); // 6 chars
      // joined with space: "Hello World!" = 12 chars => ceil(12/4)=3
      const result = callPrivate('estimateTokens', [m1, m2]);
      expect(result).toBe(Math.ceil(12 / 4));
    });

    it('uses active branch content', () => {
      const msg = makeMessage('active content', 'user');
      // Add an inactive branch
      msg.branches.push({
        id: randomUUID(),
        content: 'inactive should be ignored',
        role: 'user',
        createdAt: new Date(),
      } as any);
      const result = callPrivate('estimateTokens', [msg]);
      expect(result).toBe(Math.ceil('active content'.length / 4));
    });
  });

  // ── truncateMessagesToFit ───────────────────────────────────────────

  describe('truncateMessagesToFit', () => {
    it('returns all messages when they fit within context', () => {
      const msgs = [
        makeMessage('Short', 'user', { order: 0 }),
        makeMessage('Also short', 'assistant', { order: 1 }),
      ];
      // Very large context window
      const result = callPrivate('truncateMessagesToFit', msgs, 1000000, undefined);
      expect(result).toHaveLength(2);
    });

    it('truncates from the head (keeps tail)', () => {
      // Each message ~100 chars = ~25 tokens
      const msgs = Array.from({ length: 100 }, (_, i) =>
        makeMessage('x'.repeat(100) + ` msg${i}`, 'user', { order: i })
      );
      // outputReserve = 8192, so available = 8500 - 8192 = 308 tokens
      // Each message ~26 tokens, so should keep ~11 messages
      const result = callPrivate('truncateMessagesToFit', msgs, 8500, undefined);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(100);
      // Should keep the last N messages
      expect(result[result.length - 1].order).toBe(99);
    });

    it('returns last message only when context is extremely tight', () => {
      const msgs = [
        makeMessage('First message with some content', 'user', { order: 0 }),
        makeMessage('Second message', 'assistant', { order: 1 }),
      ];
      // Very tight context (just enough for 1 message after reserves)
      const result = callPrivate('truncateMessagesToFit', msgs, 8200, undefined);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('returns at least the last message even with zero available tokens', () => {
      const msgs = [makeMessage('Only message', 'user', { order: 0 })];
      // Context smaller than reserve
      const result = callPrivate('truncateMessagesToFit', msgs, 100, undefined);
      expect(result).toHaveLength(1);
    });

    it('accounts for system prompt in available token calculation', () => {
      const msgs = Array.from({ length: 50 }, (_, i) =>
        makeMessage(`Msg ${i}`, 'user', { order: i })
      );
      const longSystemPrompt = 'x'.repeat(10000); // ~2500 tokens
      const resultWithPrompt = callPrivate('truncateMessagesToFit', msgs, 15000, longSystemPrompt);
      const resultWithout = callPrivate('truncateMessagesToFit', msgs, 15000, undefined);
      // Should keep fewer messages when system prompt eats tokens
      expect(resultWithPrompt.length).toBeLessThanOrEqual(resultWithout.length);
    });
  });

  // ── consolidateConsecutiveMessages ──────────────────────────────────

  describe('consolidateConsecutiveMessages', () => {
    it('combines consecutive user messages into one', () => {
      const convId = randomUUID();
      const msgs = [
        makeMessage('User says 1', 'user', { order: 0, conversationId: convId }),
        makeMessage('User says 2', 'user', { order: 1, conversationId: convId }),
        makeMessage('Bot responds', 'assistant', { order: 2, conversationId: convId }),
      ];
      const result = callPrivate('consolidateConsecutiveMessages', msgs);
      expect(result).toHaveLength(2);
      // First should be consolidated user message
      const firstBranch = result[0].branches[0];
      expect(firstBranch.role).toBe('user');
      expect(firstBranch.content).toContain('User says 1');
      expect(firstBranch.content).toContain('User says 2');
      // Second should be the assistant message
      expect(result[1].branches[0].role).toBe('assistant');
    });

    it('leaves alternating user/assistant messages unchanged count', () => {
      const convId = randomUUID();
      const msgs = [
        makeMessage('user1', 'user', { order: 0, conversationId: convId }),
        makeMessage('bot1', 'assistant', { order: 1, conversationId: convId }),
        makeMessage('user2', 'user', { order: 2, conversationId: convId }),
        makeMessage('bot2', 'assistant', { order: 3, conversationId: convId }),
      ];
      const result = callPrivate('consolidateConsecutiveMessages', msgs);
      expect(result).toHaveLength(4);
    });

    it('handles trailing user messages', () => {
      const convId = randomUUID();
      const msgs = [
        makeMessage('bot1', 'assistant', { order: 0, conversationId: convId }),
        makeMessage('user1', 'user', { order: 1, conversationId: convId }),
        makeMessage('user2', 'user', { order: 2, conversationId: convId }),
      ];
      const result = callPrivate('consolidateConsecutiveMessages', msgs);
      expect(result).toHaveLength(2);
      // Last should be consolidated user
      const lastBranch = result[1].branches[0];
      expect(lastBranch.role).toBe('user');
      expect(lastBranch.content).toContain('user1');
      expect(lastBranch.content).toContain('user2');
    });

    it('joins consecutive user content with double newlines', () => {
      const convId = randomUUID();
      const msgs = [
        makeMessage('line1', 'user', { order: 0, conversationId: convId }),
        makeMessage('line2', 'user', { order: 1, conversationId: convId }),
        makeMessage('resp', 'assistant', { order: 2, conversationId: convId }),
      ];
      const result = callPrivate('consolidateConsecutiveMessages', msgs);
      const content = result[0].branches[0].content;
      expect(content).toBe('line1\n\nline2');
    });
  });

  // ── formatMessagesForConversation ───────────────────────────────────

  describe('formatMessagesForConversation', () => {
    const convId = randomUUID();

    describe('standard format', () => {
      it('passes messages through unchanged', () => {
        const msgs = [
          makeMessage('Hello', 'user', { order: 0, conversationId: convId }),
          makeMessage('Hi', 'assistant', { order: 1, conversationId: convId }),
        ];
        const result = callPrivate('formatMessagesForConversation', msgs, 'standard', [], undefined, undefined, undefined);
        expect(result).toHaveLength(2);
        expect(result[0].branches[0].content).toBe('Hello');
      });

      it('expands prefixHistory from first message', () => {
        const msgs = [
          makeMessage('current', 'user', {
            order: 0,
            conversationId: convId,
            prefixHistory: [
              { role: 'user', content: 'historical1' },
              { role: 'assistant', content: 'historical2' },
            ],
          }),
        ];
        const result = callPrivate('formatMessagesForConversation', msgs, 'standard', [], undefined, undefined, undefined);
        // 2 synthetic + 1 actual
        expect(result).toHaveLength(3);
        expect(result[0].branches[0].content).toBe('historical1');
        expect(result[1].branches[0].content).toBe('historical2');
        expect(result[2].branches[0].content).toBe('current');
      });
    });

    describe('prefill format', () => {
      it('produces prefill messages with participant names', () => {
        const alice = makeParticipant('Alice', 'user', { id: 'p-alice' });
        const bob = makeParticipant('Bob', 'assistant', { id: 'p-bob' });
        const msgs = [
          makeMessage('Hello Bob', 'user', { order: 0, conversationId: convId, participantId: 'p-alice' }),
          makeMessage('Hi Alice', 'assistant', { order: 1, conversationId: convId, participantId: 'p-bob' }),
        ];
        const conv = makeConversation('prefill');

        const result = callPrivate(
          'formatMessagesForConversation',
          msgs, 'prefill', [alice, bob], 'p-bob', 'anthropic', conv
        );

        // Should produce: user message (prefill cmd) + assistant message with conversation log
        expect(result.length).toBeGreaterThanOrEqual(1);
        // Find the assistant message with the conversation content
        const assistantMsg = result.find((m: any) => {
          const branch = m.branches[0];
          return branch.role === 'assistant';
        });
        expect(assistantMsg).toBeDefined();
        const content = assistantMsg.branches[0].content;
        expect(content).toContain('Alice:');
        expect(content).toContain('Bob:');
      });

      it('generates initial user message when prefillUserMessage is enabled', () => {
        const msgs = [
          makeMessage('Hello', 'user', { order: 0, conversationId: convId }),
        ];
        const conv = makeConversation('prefill', {
          prefillUserMessage: { enabled: true, content: '<cmd>test</cmd>' },
        });

        const result = callPrivate(
          'formatMessagesForConversation',
          msgs, 'prefill', [], undefined, 'anthropic', conv
        );

        // First message should be user with the prefill content
        expect(result[0].branches[0].role).toBe('user');
        expect(result[0].branches[0].content).toBe('<cmd>test</cmd>');
      });

      it('skips empty assistant messages in prefill', () => {
        const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });
        const msgs = [
          makeMessage('Hello', 'user', { order: 0, conversationId: convId }),
          makeMessage('', 'assistant', { order: 1, conversationId: convId, participantId: 'p-bot' }),
        ];
        const conv = makeConversation('prefill');

        const result = callPrivate(
          'formatMessagesForConversation',
          msgs, 'prefill', [bot], 'p-bot', 'anthropic', conv
        );

        // The empty assistant message should be handled as prefill continuation
        const lastMsg = result[result.length - 1];
        const lastContent = lastMsg.branches[0].content;
        // Should have Bot: at the end as prefill
        expect(lastContent).toContain('Bot:');
      });

      it('adds thinking prefix when triggerThinking is true', () => {
        const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });
        const msgs = [
          makeMessage('Hello', 'user', { order: 0, conversationId: convId }),
          makeMessage('', 'assistant', { order: 1, conversationId: convId, participantId: 'p-bot' }),
        ];
        const conv = makeConversation('prefill');

        const result = callPrivate(
          'formatMessagesForConversation',
          msgs, 'prefill', [bot], 'p-bot', 'anthropic', conv, undefined, true
        );

        const lastContent = result[result.length - 1].branches[0].content;
        expect(lastContent).toContain('<think>');
      });

      it('collapses same participant consecutive messages', () => {
        const alice = makeParticipant('Alice', 'user', { id: 'p-alice' });
        const msgs = [
          makeMessage('Part 1', 'user', { order: 0, conversationId: convId, participantId: 'p-alice' }),
          makeMessage('Part 2', 'user', { order: 1, conversationId: convId, participantId: 'p-alice' }),
        ];
        const conv = makeConversation('prefill');

        const result = callPrivate(
          'formatMessagesForConversation',
          msgs, 'prefill', [alice], undefined, 'anthropic', conv
        );

        // In prefill, same participant consecutive messages are joined without repeating the name
        const assistantContent = result.find((m: any) => m.branches[0].role === 'assistant')?.branches[0].content;
        if (assistantContent) {
          // Should have "Alice:" only once since consecutive
          const aliceMatches = assistantContent.match(/Alice:/g);
          expect(aliceMatches).toHaveLength(1);
        }
      });
    });

    describe('messages format', () => {
      it('formats with name prefixes and role mapping', () => {
        const alice = makeParticipant('Alice', 'user', { id: 'p-alice' });
        const bob = makeParticipant('Bob', 'assistant', { id: 'p-bob' });
        const msgs = [
          makeMessage('Hello', 'user', { order: 0, conversationId: convId, participantId: 'p-alice' }),
          makeMessage('Hi', 'assistant', { order: 1, conversationId: convId, participantId: 'p-bob' }),
        ];
        const conv = makeConversation('prefill');

        const result = callPrivate(
          'formatMessagesForConversation',
          msgs, 'messages', [alice, bob], 'p-bob', 'anthropic', conv
        );

        expect(result.length).toBeGreaterThanOrEqual(2);
        // Alice's message should have "Alice: " prefix and role=user
        const aliceMsg = result.find((m: any) => m.branches[0].content.includes('Alice:'));
        expect(aliceMsg).toBeDefined();
        expect(aliceMsg.branches[0].role).toBe('user');

        // Bob's message should be role=assistant
        const bobMsg = result.find((m: any) => {
          const b = m.branches[0];
          return b.role === 'assistant' && b.content.includes('Hi');
        });
        expect(bobMsg).toBeDefined();
      });

      it('skips empty content messages', () => {
        const alice = makeParticipant('Alice', 'user', { id: 'p-alice' });
        const msgs = [
          makeMessage('Hello', 'user', { order: 0, conversationId: convId, participantId: 'p-alice' }),
          makeMessage('', 'assistant', { order: 1, conversationId: convId }),
        ];
        const conv = makeConversation('prefill');

        const result = callPrivate(
          'formatMessagesForConversation',
          msgs, 'messages', [alice], undefined, 'anthropic', conv
        );

        // Empty assistant message should be skipped
        const assistantMsgs = result.filter((m: any) => {
          const b = m.branches.find((br: any) => br.id === m.activeBranchId);
          return b?.content === '';
        });
        expect(assistantMsgs).toHaveLength(0);
      });

      it('consolidates consecutive user messages for bedrock', () => {
        const alice = makeParticipant('Alice', 'user', { id: 'p-alice' });
        const charlie = makeParticipant('Charlie', 'user', { id: 'p-charlie' });
        const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });
        const msgs = [
          makeMessage('Alice says hi', 'user', { order: 0, conversationId: convId, participantId: 'p-alice' }),
          makeMessage('Charlie says hi', 'user', { order: 1, conversationId: convId, participantId: 'p-charlie' }),
          makeMessage('Bot responds', 'assistant', { order: 2, conversationId: convId, participantId: 'p-bot' }),
        ];
        const conv = makeConversation('prefill');

        const result = callPrivate(
          'formatMessagesForConversation',
          msgs, 'messages', [alice, charlie, bot], 'p-bot', 'bedrock', conv
        );

        // Bedrock requires alternating turns, so two user messages should be consolidated
        expect(result).toHaveLength(2);
        expect(result[0].branches[0].role).toBe('user');
        expect(result[1].branches[0].role).toBe('assistant');
      });

      it('does not prefix assistant own messages for openai-compatible', () => {
        const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });
        const msgs = [
          makeMessage('Hello', 'user', { order: 0, conversationId: convId }),
          makeMessage('Response text', 'assistant', { order: 1, conversationId: convId, participantId: 'p-bot' }),
        ];
        const conv = makeConversation('prefill');

        const result = callPrivate(
          'formatMessagesForConversation',
          msgs, 'messages', [bot], 'p-bot', 'openai-compatible', conv
        );

        // Bot's response should not have "Bot: " prefix
        const botMsg = result.find((m: any) => m.branches[0].role === 'assistant');
        expect(botMsg).toBeDefined();
        expect(botMsg.branches[0].content).toBe('Response text');
      });

      it('adds prefill message with responder name for prefill-capable providers', () => {
        const alice = makeParticipant('Alice', 'user', { id: 'p-alice' });
        const bot = makeParticipant('CustomBot', 'assistant', { id: 'p-bot' });
        const msgs = [
          makeMessage('Hello', 'user', { order: 0, conversationId: convId, participantId: 'p-alice' }),
        ];
        // Don't combine, so we see the prefill message
        const conv = makeConversation('prefill', { combineConsecutiveMessages: false });

        const result = callPrivate(
          'formatMessagesForConversation',
          msgs, 'messages', [alice, bot], 'p-bot', 'anthropic', conv
        );

        // Last message should be a prefill with "CustomBot: "
        const lastMsg = result[result.length - 1];
        expect(lastMsg.branches[0].content).toBe('CustomBot: ');
        expect(lastMsg.branches[0].role).toBe('assistant');
      });

      it('does not add prefill for providers that do not support it', () => {
        const bot = makeParticipant('CustomBot', 'assistant', { id: 'p-bot' });
        const msgs = [
          makeMessage('Hello', 'user', { order: 0, conversationId: convId }),
        ];
        const conv = makeConversation('prefill', { combineConsecutiveMessages: false });

        const result = callPrivate(
          'formatMessagesForConversation',
          msgs, 'messages', [bot], 'p-bot', 'openai-compatible', conv
        );

        // Should not have a prefill assistant message at the end
        const lastMsg = result[result.length - 1];
        // The only message should be the user message
        expect(lastMsg.branches[0].role).toBe('user');
      });

      it('does not add prefill for "Assistant" name', () => {
        const bot = makeParticipant('Assistant', 'assistant', { id: 'p-bot' });
        const msgs = [
          makeMessage('Hello', 'user', { order: 0, conversationId: convId }),
        ];
        const conv = makeConversation('prefill', { combineConsecutiveMessages: false });

        const result = callPrivate(
          'formatMessagesForConversation',
          msgs, 'messages', [bot], 'p-bot', 'anthropic', conv
        );

        // Should not add prefill for default "Assistant" name
        const hasNamePrefill = result.some((m: any) => m.branches[0].content === 'Assistant: ');
        expect(hasNamePrefill).toBe(false);
      });

      it('handles participants with empty name as raw continuation', () => {
        const emptyBot = makeParticipant('', 'assistant', { id: 'p-bot' });
        const msgs = [
          makeMessage('Prompt', 'user', { order: 0, conversationId: convId }),
          makeMessage('Response', 'assistant', { order: 1, conversationId: convId, participantId: 'p-bot' }),
        ];
        const conv = makeConversation('prefill', { combineConsecutiveMessages: false });

        const result = callPrivate(
          'formatMessagesForConversation',
          msgs, 'messages', [emptyBot], 'p-bot', 'anthropic', conv
        );

        // Empty name participant's content should not have name prefix
        const botMsg = result.find((m: any) => m.branches[0].role === 'assistant');
        expect(botMsg.branches[0].content).toBe('Response');
      });
    });
  });

  // ── createMessagesModeChunkHandler ─────────────────────────────────

  describe('createMessagesModeChunkHandler', () => {
    it('strips responder name prefix from streamed chunks', async () => {
      const chunks: string[] = [];
      const onChunk = vi.fn(async (chunk: string) => { chunks.push(chunk); });
      const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });

      const handler = callPrivate('createMessagesModeChunkHandler', onChunk, [bot], 'p-bot');

      // Simulate streaming "Bot: Hello world" in chunks
      await handler('Bot', false);
      await handler(': ', false);
      await handler('Hello', false);
      await handler(' world', false);
      await handler('', true);

      // Should have stripped "Bot: " prefix
      const allContent = chunks.filter(c => c !== '').join('');
      expect(allContent).toBe('Hello world');
    });

    it('passes through content when no name prefix present', async () => {
      const chunks: string[] = [];
      const onChunk = vi.fn(async (chunk: string) => { chunks.push(chunk); });
      const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });

      const handler = callPrivate('createMessagesModeChunkHandler', onChunk, [bot], 'p-bot');

      // Content without name prefix
      await handler('Hello directly', false);
      await handler('', true);

      const allContent = chunks.filter(c => c !== '').join('');
      expect(allContent).toContain('Hello directly');
    });

    it('handles completion with buffered content', async () => {
      const chunks: { chunk: string; isComplete: boolean }[] = [];
      const onChunk = vi.fn(async (chunk: string, isComplete: boolean) => {
        chunks.push({ chunk, isComplete });
      });
      const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });

      const handler = callPrivate('createMessagesModeChunkHandler', onChunk, [bot], 'p-bot');

      // Send just "Bo" then complete - not enough to match "Bot: "
      // but enough to decide there's no match after buffer exceeds name length + 2
      await handler('Bo', false);
      await handler('', true);

      // Should have flushed buffer on completion
      const completionCalls = chunks.filter(c => c.isComplete);
      expect(completionCalls.length).toBeGreaterThan(0);
    });
  });

  // ── buildPrompt integration ─────────────────────────────────────────

  describe('buildPrompt', () => {
    it('throws when model is not found', async () => {
      mockModelLoader.getModelById.mockResolvedValue(null);

      await expect(
        service.buildPrompt('nonexistent-model', [], undefined)
      ).rejects.toThrow('Model nonexistent-model not found');
    });

    it('returns formatted messages for anthropic standard format', async () => {
      const model = makeModel('anthropic');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const msgs = [
        makeMessage('Hello', 'user', { order: 0 }),
        makeMessage('Hi back', 'assistant', { order: 1 }),
      ];

      const result = await service.buildPrompt(
        model.id, msgs, 'You are helpful', 'standard', [], undefined
      );

      expect(result.provider).toBe('anthropic');
      expect(result.modelId).toBe(model.providerModelId);
      expect(result.systemPrompt).toBe('You are helpful');
      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
    });

    it('returns formatted messages for bedrock provider', async () => {
      const model = makeModel('bedrock');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const msgs = [makeMessage('Hello', 'user', { order: 0 })];
      const result = await service.buildPrompt(model.id, msgs, undefined, 'standard');

      expect(result.provider).toBe('bedrock');
      expect(result.messages).toBeDefined();
    });

    it('includes system prompt in messages for openai-compatible (not separate)', async () => {
      const model = makeModel('openai-compatible');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const msgs = [makeMessage('Hello', 'user', { order: 0 })];
      const result = await service.buildPrompt(model.id, msgs, 'System prompt', 'standard');

      expect(result.provider).toBe('openai-compatible');
      // System prompt should be undefined (included in messages for OpenAI)
      expect(result.systemPrompt).toBeUndefined();
    });

    it('includes system prompt in messages for openrouter (not separate)', async () => {
      const model = makeModel('openrouter');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const msgs = [makeMessage('Hello', 'user', { order: 0 })];
      const result = await service.buildPrompt(model.id, msgs, 'System prompt', 'standard');

      expect(result.provider).toBe('openrouter');
      expect(result.systemPrompt).toBeUndefined();
    });

    it('formats messages for google provider', async () => {
      const model = makeModel('google');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const msgs = [
        makeMessage('Hello', 'user', { order: 0 }),
        makeMessage('Hi', 'assistant', { order: 1 }),
      ];
      const result = await service.buildPrompt(model.id, msgs, undefined, 'standard');

      expect(result.provider).toBe('google');
      // Google format uses 'user'/'model' roles and 'parts' structure
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('model');
      expect(result.messages[0].parts).toBeDefined();
    });

    it('throws for unknown provider', async () => {
      const model = makeModel('unknown-provider');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const msgs = [makeMessage('Hello', 'user', { order: 0 })];
      await expect(
        service.buildPrompt(model.id, msgs, undefined, 'standard')
      ).rejects.toThrow('Unknown provider: unknown-provider');
    });

    it('applies post-hoc operations before formatting', async () => {
      const model = makeModel('anthropic');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const target = makeMessage('hidden message', 'user', { order: 0 });
      const op = makeMessage('', 'user', {
        order: 1,
        postHocOperation: {
          type: 'hide',
          targetMessageId: target.id,
          targetBranchId: target.activeBranchId,
        },
      });
      const visible = makeMessage('visible message', 'user', { order: 2 });

      const result = await service.buildPrompt(
        model.id, [target, op, visible], undefined, 'standard'
      );

      // Only visible message should be in the output
      expect(result.messages).toHaveLength(1);
    });

    it('uses prefill format for anthropic with prefill conversation', async () => {
      const model = makeModel('anthropic');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const alice = makeParticipant('Alice', 'user', { id: 'p-alice' });
      const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });
      const conv = makeConversation('prefill');

      const msgs = [
        makeMessage('Hello', 'user', { order: 0, participantId: 'p-alice' }),
      ];

      const result = await service.buildPrompt(
        model.id, msgs, undefined, 'prefill', [alice, bot], 'p-bot', conv
      );

      expect(result.provider).toBe('anthropic');
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty conversation (no messages)', () => {
      const result = callPrivate('applyPostHocOperations', []);
      expect(result).toEqual([]);
    });

    it('handles single message conversation', () => {
      const msg = makeMessage('Only one', 'user', { order: 0 });
      const result = callPrivate('formatMessagesForConversation', [msg], 'standard', [], undefined, undefined, undefined);
      expect(result).toHaveLength(1);
    });

    it('handles system prompt only (no user messages)', async () => {
      const model = makeModel('anthropic');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const result = await service.buildPrompt(
        model.id, [], 'System only', 'standard'
      );

      expect(result.systemPrompt).toBe('System only');
      expect(result.messages).toHaveLength(0);
    });

    it('handles messages with no active branch gracefully in post-hoc', () => {
      const msg: Message = {
        id: randomUUID(),
        conversationId: randomUUID(),
        branches: [{
          id: 'branch-a',
          content: 'hello',
          role: 'user',
          createdAt: new Date(),
        } as any],
        activeBranchId: 'branch-b', // Points to non-existent branch
        order: 0,
      };
      // Should not crash
      const result = callPrivate('applyPostHocOperations', [msg]);
      expect(result).toHaveLength(1);
    });

    it('truncateMessagesToFit handles messages in already-formatted format', () => {
      // Test with OpenAI-style {role, content} format
      const formatted = [
        { role: 'user', content: 'Short message' },
        { role: 'assistant', content: 'Short reply' },
      ];
      const result = callPrivate('truncateMessagesToFit', formatted, 1000000, undefined);
      expect(result).toHaveLength(2);
    });

    it('handles attachment in messages format', () => {
      const alice = makeParticipant('Alice', 'user', { id: 'p-alice' });
      const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });
      const msgs = [
        makeMessage('Check this file', 'user', {
          order: 0,
          conversationId: randomUUID(),
          participantId: 'p-alice',
          attachments: [{ fileName: 'doc.txt', content: 'file content' }],
        }),
        makeMessage('I see it', 'assistant', { order: 1, participantId: 'p-bot' }),
      ];
      const conv = makeConversation('prefill', { combineConsecutiveMessages: false });

      const result = callPrivate(
        'formatMessagesForConversation',
        msgs, 'messages', [alice, bot], 'p-bot', 'anthropic', conv
      );

      // User message should contain attachment reference
      const userMsg = result.find((m: any) => m.branches[0].role === 'user');
      expect(userMsg.branches[0].content).toContain('doc.txt');
      expect(userMsg.branches[0].content).toContain('file content');
    });

    it('handles image attachments in prefill format', () => {
      const alice = makeParticipant('Alice', 'user', { id: 'p-alice' });
      const msgs = [
        makeMessage('Look at this', 'user', {
          order: 0,
          conversationId: randomUUID(),
          participantId: 'p-alice',
          attachments: [{ fileName: 'photo.png', content: 'base64data' }],
        }),
      ];
      const conv = makeConversation('prefill');

      const result = callPrivate(
        'formatMessagesForConversation',
        msgs, 'prefill', [alice], undefined, 'anthropic', conv
      );

      // Image attachments should cause a user message insertion in prefill
      const userMsgs = result.filter((m: any) => m.branches[0].role === 'user');
      expect(userMsgs.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── parseThinkingTags ───────────────────────────────────────────────

  describe('parseThinkingTags', () => {
    it('extracts thinking blocks from content', () => {
      const content = '<think>reasoning here</think>actual response';
      const result = callPrivate('parseThinkingTags', content);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: 'thinking', thinking: 'reasoning here' });
      expect(result[1]).toEqual({ type: 'text', text: 'actual response' });
    });

    it('handles multiple thinking blocks', () => {
      const content = '<think>first thought</think>middle<think>second thought</think>end';
      const result = callPrivate('parseThinkingTags', content);
      const thinkingBlocks = result.filter((b: any) => b.type === 'thinking');
      expect(thinkingBlocks).toHaveLength(2);
      expect(thinkingBlocks[0].thinking).toBe('first thought');
      expect(thinkingBlocks[1].thinking).toBe('second thought');
    });

    it('returns empty array for content without thinking tags', () => {
      const content = 'just regular text';
      const result = callPrivate('parseThinkingTags', content);
      expect(result).toHaveLength(0);
    });

    it('returns only thinking block when no text after tags', () => {
      const content = '<think>just thinking</think>';
      const result = callPrivate('parseThinkingTags', content);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('thinking');
    });

    it('trims whitespace from thinking content', () => {
      const content = '<think>  spaced thinking  </think>response';
      const result = callPrivate('parseThinkingTags', content);
      expect(result[0].thinking).toBe('spaced thinking');
    });
  });

  // ── streamCompletion ────────────────────────────────────────────────

  describe('streamCompletion', () => {
    const defaultSettings = { temperature: 0.7, maxTokens: 1024 };
    const userId = 'user-123';

    beforeEach(() => {
      mockAnthropicStreamCompletion.mockImplementation(
        async (_mid: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
          await onChunk('Hello', false);
          await onChunk('', true, undefined, { inputTokens: 10, outputTokens: 5 });
          return { usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } };
        }
      );
      mockBedrockStreamCompletion.mockImplementation(
        async (_mid: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
          await onChunk('Hello', false);
          await onChunk('', true);
          return {};
        }
      );
      mockOpenRouterStreamCompletion.mockImplementation(
        async (_mid: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
          await onChunk('Hello', false);
          await onChunk('', true);
          return { usage: { inputTokens: 10, outputTokens: 5 } };
        }
      );
      mockOpenAIStreamCompletion.mockImplementation(
        async (_mid: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
          await onChunk('Hello', false);
          await onChunk('', true);
          return {};
        }
      );
      mockGeminiStreamCompletion.mockImplementation(
        async (_mid: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
          await onChunk('Hello', false);
          await onChunk('', true);
          return {};
        }
      );
      mockGetApiKeyForRequest.mockResolvedValue({
        source: 'config',
        credentials: { apiKey: 'test-key', baseUrl: 'http://localhost', accessKeyId: 'ak', secretAccessKey: 'sk' },
        profile: { name: 'default', rateLimit: { maxRequests: 100, windowMs: 60000 } },
      });
      mockCheckRateLimits.mockResolvedValue({ allowed: true });
      mockTrackUsage.mockResolvedValue(undefined);
    });

    it('throws when modelId is falsy', async () => {
      const onChunk = vi.fn();
      await expect(
        service.streamCompletion('', [], undefined, defaultSettings, userId, onChunk)
      ).rejects.toThrow();
    });

    it('throws when model is not found', async () => {
      mockModelLoader.getModelById.mockResolvedValue(null);
      const onChunk = vi.fn();
      await expect(
        service.streamCompletion('nonexistent', [], undefined, defaultSettings, userId, onChunk)
      ).rejects.toThrow('Model nonexistent not found');
    });

    it('routes to anthropic service', async () => {
      const model = makeModel('anthropic');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const chunks: string[] = [];
      const onChunk = vi.fn(async (chunk: string) => { chunks.push(chunk); });
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      const result = await service.streamCompletion(
        model.id, msgs, 'System', defaultSettings, userId, onChunk
      );

      expect(mockAnthropicStreamCompletion).toHaveBeenCalled();
      expect(result.usage).toBeDefined();
    });

    it('routes to bedrock service', async () => {
      const model = makeModel('bedrock');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      await service.streamCompletion(
        model.id, msgs, undefined, defaultSettings, userId, onChunk
      );

      expect(mockBedrockStreamCompletion).toHaveBeenCalled();
    });

    it('routes to openrouter service', async () => {
      const model = makeModel('openrouter');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      await service.streamCompletion(
        model.id, msgs, undefined, defaultSettings, userId, onChunk
      );

      expect(mockOpenRouterStreamCompletion).toHaveBeenCalled();
    });

    it('routes to openai-compatible service', async () => {
      const model = makeModel('openai-compatible');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      await service.streamCompletion(
        model.id, msgs, undefined, defaultSettings, userId, onChunk
      );

      expect(mockOpenAIStreamCompletion).toHaveBeenCalled();
    });

    it('routes to gemini service for google provider', async () => {
      const model = makeModel('google');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      await service.streamCompletion(
        model.id, msgs, undefined, defaultSettings, userId, onChunk
      );

      expect(mockGeminiStreamCompletion).toHaveBeenCalled();
    });

    it('throws for unsupported provider', async () => {
      const model = makeModel('some-unknown-provider');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      await expect(
        service.streamCompletion(model.id, msgs, undefined, defaultSettings, userId, onChunk)
      ).rejects.toThrow('Unsupported provider');
    });

    it('throws when no API key available', async () => {
      const model = makeModel('anthropic');
      mockModelLoader.getModelById.mockResolvedValue(model);
      mockGetApiKeyForRequest.mockResolvedValue(null);

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      await expect(
        service.streamCompletion(model.id, msgs, undefined, defaultSettings, userId, onChunk)
      ).rejects.toThrow('No API key available');
    });

    it('throws when rate limited', async () => {
      const model = makeModel('anthropic');
      mockModelLoader.getModelById.mockResolvedValue(model);
      mockCheckRateLimits.mockResolvedValue({ allowed: false, retryAfter: 30 });

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      await expect(
        service.streamCompletion(model.id, msgs, undefined, defaultSettings, userId, onChunk)
      ).rejects.toThrow('Rate limit exceeded');
    });

    it('tracks usage after completion for config keys', async () => {
      const model = makeModel('anthropic');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      await service.streamCompletion(
        model.id, msgs, undefined, defaultSettings, userId, onChunk
      );

      expect(mockTrackUsage).toHaveBeenCalledWith(
        userId, 'anthropic', model.id, expect.any(Number), expect.any(Number), expect.anything()
      );
    });

    it('caps maxTokens to model outputTokenLimit', async () => {
      const model = makeModel('anthropic', { outputTokenLimit: 500 });
      mockModelLoader.getModelById.mockResolvedValue(model);

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];
      const settings = { temperature: 0.7, maxTokens: 10000 };

      await service.streamCompletion(
        model.id, msgs, undefined, settings, userId, onChunk
      );

      // The capped settings should be passed to the provider
      const callArgs = mockAnthropicStreamCompletion.mock.calls[0];
      expect(callArgs[3].maxTokens).toBe(500);
    });

    it('disables thinking for models that do not support it', async () => {
      const model = makeModel('anthropic', { supportsThinking: false });
      mockModelLoader.getModelById.mockResolvedValue(model);

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];
      const settings = { temperature: 0.7, maxTokens: 1024, thinking: { enabled: true, budgetTokens: 2000 } };

      await service.streamCompletion(
        model.id, msgs, undefined, settings, userId, onChunk
      );

      // Thinking should be disabled
      const callArgs = mockAnthropicStreamCompletion.mock.calls[0];
      expect(callArgs[3].thinking).toBeUndefined();
    });

    it('builds stop sequences for prefill format', async () => {
      const model = makeModel('anthropic');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const alice = makeParticipant('Alice', 'user', { id: 'p-alice' });
      const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });
      const conv = makeConversation('prefill');

      const onChunk = vi.fn();
      const msgs = [
        makeMessage('Hello', 'user', { order: 0, participantId: 'p-alice' }),
      ];

      await service.streamCompletion(
        model.id, msgs, undefined, defaultSettings, userId, onChunk,
        'prefill', [alice, bot], 'p-bot', conv
      );

      // Stop sequences should have been passed to provider
      const callArgs = mockAnthropicStreamCompletion.mock.calls[0];
      const stopSequences = callArgs[5]; // 6th argument
      expect(stopSequences).toBeDefined();
      expect(Array.isArray(stopSequences)).toBe(true);
      expect(stopSequences).toContain('Alice:');
    });

    it('generates default system prompt for messages format with responder', async () => {
      const model = makeModel('openrouter'); // Falls back to messages mode
      mockModelLoader.getModelById.mockResolvedValue(model);

      const alice = makeParticipant('Alice', 'user', { id: 'p-alice' });
      const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });
      const conv = makeConversation('prefill');

      const onChunk = vi.fn();
      const msgs = [
        makeMessage('Hello', 'user', { order: 0, participantId: 'p-alice' }),
      ];

      await service.streamCompletion(
        model.id, msgs, undefined, defaultSettings, userId, onChunk,
        'prefill', [alice, bot], 'p-bot', conv
      );

      // Should have generated a system prompt for messages mode
      const callArgs = mockOpenRouterStreamCompletion.mock.calls[0];
      const systemPrompt = callArgs[2]; // 3rd argument
      expect(systemPrompt).toContain('Bot');
      expect(systemPrompt).toContain('multi-user chat');
    });

    it('uses user-provided system prompt without generating default', async () => {
      const model = makeModel('openrouter');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });
      const conv = makeConversation('prefill');

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      await service.streamCompletion(
        model.id, msgs, 'Custom system prompt', defaultSettings, userId, onChunk,
        'prefill', [bot], 'p-bot', conv
      );

      const callArgs = mockOpenRouterStreamCompletion.mock.calls[0];
      expect(callArgs[2]).toBe('Custom system prompt');
    });

    it('creates messages-mode chunk handler for messages format', async () => {
      const model = makeModel('openrouter');
      mockModelLoader.getModelById.mockResolvedValue(model);

      // Simulate provider responding with "Bot: Hello"
      mockOpenRouterStreamCompletion.mockImplementation(
        async (_mid: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
          await onChunk('Bot: Hello there', false);
          await onChunk('', true);
          return {};
        }
      );

      const chunks: string[] = [];
      const onChunk = vi.fn(async (chunk: string) => { chunks.push(chunk); });

      const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });
      const conv = makeConversation('prefill');
      const msgs = [makeMessage('Hi', 'user', { order: 0 })];

      await service.streamCompletion(
        model.id, msgs, undefined, defaultSettings, userId, onChunk,
        'prefill', [bot], 'p-bot', conv
      );

      // Should have stripped "Bot: " prefix
      const allContent = chunks.filter(c => c !== '').join('');
      expect(allContent).toContain('Hello there');
      expect(allContent).not.toContain('Bot:');
    });

    it('handles custom model with embedded endpoint', async () => {
      const model = {
        ...makeModel('openai-compatible'),
        customEndpoint: { baseUrl: 'http://custom:8080', apiKey: 'custom-key' },
      };
      mockModelLoader.getModelById.mockResolvedValue(model);

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      await service.streamCompletion(
        model.id, msgs, undefined, defaultSettings, userId, onChunk
      );

      // Should NOT call getApiKeyForRequest for custom models
      expect(mockGetApiKeyForRequest).not.toHaveBeenCalled();
      expect(mockOpenAIStreamCompletion).toHaveBeenCalled();
    });

    it('stores rawRequest when provider returns it', async () => {
      const model = makeModel('anthropic');
      mockModelLoader.getModelById.mockResolvedValue(model);

      mockAnthropicStreamCompletion.mockImplementation(
        async (_mid: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
          await onChunk('Hello', false);
          await onChunk('', true);
          return { usage: { inputTokens: 10, outputTokens: 5 }, rawRequest: { model: 'test', messages: [] } };
        }
      );

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      await service.streamCompletion(
        model.id, msgs, undefined, defaultSettings, userId, onChunk
      );

      expect(service.lastRawRequest).toEqual({ model: 'test', messages: [] });
    });

    it('estimates tokens when provider does not return usage', async () => {
      const model = makeModel('bedrock');
      mockModelLoader.getModelById.mockResolvedValue(model);

      mockBedrockStreamCompletion.mockImplementation(
        async (_mid: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
          await onChunk('Hello', false);
          await onChunk('', true);
          return {}; // No usage
        }
      );

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      const result = await service.streamCompletion(
        model.id, msgs, undefined, defaultSettings, userId, onChunk
      );

      // Should still complete without error
      expect(result).toBeDefined();
    });

    it('applies post-facto stop sequences in prefill mode', async () => {
      const model = makeModel('anthropic');
      mockModelLoader.getModelById.mockResolvedValue(model);

      const alice = makeParticipant('Alice', 'user', { id: 'p-alice' });
      const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });
      const conv = makeConversation('prefill');

      // Simulate provider streaming response that includes another participant's turn
      mockAnthropicStreamCompletion.mockImplementation(
        async (_mid: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
          await onChunk('Hello Alice!', false);
          await onChunk('\n\nAlice: Thanks Bot!', false); // This should trigger stop sequence
          await onChunk('', true);
          return { usage: { inputTokens: 10, outputTokens: 15 } };
        }
      );

      const chunks: string[] = [];
      const onChunk = vi.fn(async (chunk: string) => { chunks.push(chunk); });
      const msgs = [
        makeMessage('Hi', 'user', { order: 0, participantId: 'p-alice' }),
      ];

      await service.streamCompletion(
        model.id, msgs, undefined, defaultSettings, userId, onChunk,
        'prefill', [alice, bot], 'p-bot', conv
      );

      // The response should have been truncated at the stop sequence
      const fullContent = chunks.filter(c => c !== '').join('');
      expect(fullContent).toContain('Hello Alice');
      // Should NOT contain Alice's message
      expect(fullContent).not.toContain('Thanks Bot');
    });

    it('disables native thinking for prefill+thinking mode', async () => {
      const model = makeModel('anthropic', { supportsThinking: true });
      mockModelLoader.getModelById.mockResolvedValue(model);

      const bot = makeParticipant('Bot', 'assistant', { id: 'p-bot' });
      const conv = makeConversation('prefill');

      const onChunk = vi.fn();
      const msgs = [
        makeMessage('Think about this', 'user', { order: 0 }),
        makeMessage('', 'assistant', { order: 1, participantId: 'p-bot' }),
      ];
      const settings = { temperature: 0.7, maxTokens: 1024, thinking: { enabled: true, budgetTokens: 4000 } };

      // Simulate thinking response
      mockAnthropicStreamCompletion.mockImplementation(
        async (_mid: string, _msgs: any, _sys: any, _settings: any, onChunk: Function) => {
          await onChunk('Let me think about this...</think>\n\nHere is my answer.', false);
          await onChunk('', true);
          return { usage: { inputTokens: 10, outputTokens: 20 } };
        }
      );

      await service.streamCompletion(
        model.id, msgs, undefined, settings, userId, onChunk,
        'prefill', [bot], 'p-bot', conv
      );

      // Native API thinking should be disabled in the settings passed to provider
      const callArgs = mockAnthropicStreamCompletion.mock.calls[0];
      expect(callArgs[3].thinking?.enabled).toBe(false);
    });

    it('handles user key (no tracking)', async () => {
      const model = makeModel('anthropic');
      mockModelLoader.getModelById.mockResolvedValue(model);
      mockGetApiKeyForRequest.mockResolvedValue({
        source: 'user',
        credentials: { apiKey: 'user-key' },
        // No profile for user keys
      });

      const onChunk = vi.fn();
      const msgs = [makeMessage('Hello', 'user', { order: 0 })];

      await service.streamCompletion(
        model.id, msgs, undefined, defaultSettings, userId, onChunk
      );

      // Should NOT track usage for user keys (no profile)
      expect(mockTrackUsage).not.toHaveBeenCalled();
    });
  });

  // ── validateApiKey ──────────────────────────────────────────────────

  describe('validateApiKey', () => {
    it('validates anthropic key', async () => {
      const result = await service.validateApiKey('anthropic', 'test-key');
      expect(result).toBe(true);
    });

    it('returns false for unsupported provider', async () => {
      const result = await service.validateApiKey('unsupported', 'test-key');
      expect(result).toBe(false);
    });
  });

  // ── truncateMessagesToFit additional coverage ───────────────────────

  describe('truncateMessagesToFit - additional branches', () => {
    it('handles multimodal content array format', () => {
      const msgs = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this' },
            { type: 'image_url', url: 'http://example.com/img.jpg' },
          ],
        },
      ];
      // Large window — should fit
      const result = callPrivate('truncateMessagesToFit', msgs, 1000000, undefined);
      expect(result).toHaveLength(1);
    });

    it('handles Gemini parts format', () => {
      const msgs = [
        {
          role: 'user',
          parts: [
            { text: 'Look at this' },
            { inlineData: { data: 'base64', mimeType: 'image/png' } },
          ],
        },
      ];
      const result = callPrivate('truncateMessagesToFit', msgs, 1000000, undefined);
      expect(result).toHaveLength(1);
    });

    it('truncates single oversized message with branches format', () => {
      const hugeContent = 'x'.repeat(500000); // ~125k tokens
      const msg = makeMessage(hugeContent, 'user', { order: 0 });
      // Context window that can't fit the full message
      const result = callPrivate('truncateMessagesToFit', [msg], 20000, undefined);
      expect(result).toHaveLength(1);
      const branch = result[0].branches[0];
      // Content should be truncated
      expect(branch.content.length).toBeLessThan(hugeContent.length);
      expect(branch.content).toContain('[earlier context truncated]');
    });

    it('truncates single oversized message with direct content format', () => {
      const hugeContent = 'x'.repeat(500000);
      const msg = { role: 'user', content: hugeContent };
      const result = callPrivate('truncateMessagesToFit', [msg], 20000, undefined);
      expect(result).toHaveLength(1);
      expect(result[0].content.length).toBeLessThan(hugeContent.length);
      expect(result[0].content).toContain('[earlier context truncated]');
    });

    it('handles messages with image attachments in token estimation', () => {
      const msg = makeMessage('Look at this', 'user', {
        order: 0,
        attachments: [{ fileName: 'photo.jpg', isImage: true, content: 'data' }],
      });
      // Images are estimated at ~100k tokens each
      // With a small window, this should still return at least one message
      const result = callPrivate('truncateMessagesToFit', [msg], 200000, undefined);
      expect(result).toHaveLength(1);
    });

    it('handles messages with contentBlocks containing images', () => {
      const msg = makeMessage('Generated image', 'assistant', {
        order: 0,
        contentBlocks: [{ type: 'image', mimeType: 'image/png', data: 'base64data' }],
      });
      const result = callPrivate('truncateMessagesToFit', [msg], 1000000, undefined);
      expect(result).toHaveLength(1);
    });
  });
});
