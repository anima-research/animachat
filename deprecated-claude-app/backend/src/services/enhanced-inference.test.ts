import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Model, Message, Conversation, Participant, ModelSettings } from '@deprecated-claude/shared';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock logger to suppress output
vi.mock('../utils/logger.js', () => ({
  Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    context: vi.fn(),
    cache: vi.fn(),
    inference: vi.fn(),
  },
}));

// Mock pricing-cache
const mockGetOpenRouterPricing = vi.fn().mockReturnValue(null);
const mockTryRefreshOpenRouterCache = vi.fn().mockResolvedValue(false);
vi.mock('./pricing-cache.js', () => ({
  getOpenRouterPricing: (...args: any[]) => mockGetOpenRouterPricing(...args),
  tryRefreshOpenRouterCache: (...args: any[]) => mockTryRefreshOpenRouterCache(...args),
}));

// Mock ConfigLoader singleton
const mockLoadConfig = vi.fn();
vi.mock('../config/loader.js', () => ({
  ConfigLoader: {
    getInstance: () => ({
      loadConfig: mockLoadConfig,
    }),
  },
}));

// Mock InferenceService
const mockStreamCompletion = vi.fn();
const mockInferenceService = {
  streamCompletion: mockStreamCompletion,
};

// Mock ContextManager
const mockPrepareContext = vi.fn();
const mockUpdateAfterInference = vi.fn();
const mockSetContextManagement = vi.fn();
const mockGetStatistics = vi.fn();
const mockGetCacheMarker = vi.fn();
const mockContextManager = {
  prepareContext: mockPrepareContext,
  updateAfterInference: mockUpdateAfterInference,
  setContextManagement: mockSetContextManagement,
  getStatistics: mockGetStatistics,
  getCacheMarker: mockGetCacheMarker,
};

vi.mock('./context-manager.js', () => {
  const MockCM = vi.fn().mockImplementation(function(this: any) {
    this.prepareContext = mockPrepareContext;
    this.updateAfterInference = mockUpdateAfterInference;
    this.setContextManagement = mockSetContextManagement;
    this.getStatistics = mockGetStatistics;
    this.getCacheMarker = mockGetCacheMarker;
  });
  return { ContextManager: MockCM };
});

// Import after mocks
import { EnhancedInferenceService, PricingNotConfiguredError, validatePricingAvailable } from './enhanced-inference.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'claude-3.5-sonnet',
    providerModelId: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
    shortName: 'Sonnet 3.5',
    provider: 'anthropic',
    hidden: false,
    contextWindow: 200000,
    outputTokenLimit: 8192,
    settings: {
      temperature: { min: 0, max: 1, default: 1, step: 0.1 },
      maxTokens: { min: 1, max: 8192, default: 8192 },
    },
    ...overrides,
  } as Model;
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    parentId: null,
    branches: [{
      id: 'branch-1',
      role: 'user' as const,
      content: 'Hello',
      contentBlocks: [],
      timestamp: new Date().toISOString(),
    }],
    activeBranchId: 'branch-1',
    childIds: [],
    ...overrides,
  } as unknown as Message;
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 'Test Conversation',
    userId: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rootMessageId: 'msg-1',
    activeLeafId: 'msg-1',
    format: 'standard',
    mode: 'conversation',
    ...overrides,
  } as unknown as Conversation;
}

function makeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'participant-1',
    conversationId: 'conv-1',
    name: 'Assistant',
    model: 'claude-3.5-sonnet',
    systemPrompt: 'You are helpful.',
    settings: { temperature: 1, maxTokens: 8192 },
    isActive: true,
    ...overrides,
  } as unknown as Participant;
}

const defaultSettings: ModelSettings = {
  temperature: 1,
  maxTokens: 8192,
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PricingNotConfiguredError', () => {
  it('includes model ID, provider, and providerModelId in message', () => {
    const err = new PricingNotConfiguredError('my-model', 'anthropic', 'claude-3-5-sonnet-20241022');
    expect(err.message).toContain('my-model');
    expect(err.message).toContain('anthropic');
    expect(err.message).toContain('claude-3-5-sonnet-20241022');
    expect(err.name).toBe('PricingNotConfiguredError');
    expect(err.modelId).toBe('my-model');
    expect(err.provider).toBe('anthropic');
    expect(err.providerModelId).toBe('claude-3-5-sonnet-20241022');
  });

  it('handles missing providerModelId', () => {
    const err = new PricingNotConfiguredError('my-model', 'openrouter');
    expect(err.message).toContain('none');
    expect(err.providerModelId).toBeUndefined();
  });

  it('is an instance of Error', () => {
    const err = new PricingNotConfiguredError('m', 'p');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('validatePricingAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOpenRouterPricing.mockReturnValue(null);
    mockTryRefreshOpenRouterCache.mockResolvedValue(false);
  });

  it('returns valid for model with hardcoded pricing', async () => {
    const model = makeModel({ id: 'claude-3.5-sonnet', providerModelId: 'claude-3-5-sonnet-20241022' });
    const result = await validatePricingAvailable(model);
    expect(result).toEqual({ valid: true });
  });

  it('returns invalid for model without any pricing source', async () => {
    const model = makeModel({ id: 'unknown-model', providerModelId: 'unknown-provider-model', provider: 'anthropic' });
    const result = await validatePricingAvailable(model);
    expect(result).toEqual(expect.objectContaining({ valid: false }));
    expect((result as any).error).toContain('unknown-model');
  });

  it('bypasses validation for UUID-based custom models', async () => {
    const model = makeModel({ id: '12345678-1234-1234-1234-123456789abc', providerModelId: 'anything' });
    const result = await validatePricingAvailable(model);
    expect(result).toEqual({ valid: true });
  });

  it('bypasses validation for models with customEndpoint', async () => {
    const model = makeModel({ id: 'my-custom-model', providerModelId: 'anything' });
    (model as any).customEndpoint = { baseUrl: 'http://localhost:11434' };
    const result = await validatePricingAvailable(model);
    expect(result).toEqual({ valid: true });
  });

  it('checks admin-configured pricing via db', async () => {
    const model = makeModel({ id: 'unknown-model', providerModelId: 'unknown-prov' });
    const mockDb = {
      getAdminPricingConfig: vi.fn().mockResolvedValue({ input: 3, output: 15 }),
    };
    const result = await validatePricingAvailable(model, mockDb);
    expect(result).toEqual({ valid: true });
    expect(mockDb.getAdminPricingConfig).toHaveBeenCalledWith('anthropic', 'unknown-model', 'unknown-prov');
  });

  it('continues to other sources when admin config returns null', async () => {
    const model = makeModel({ id: 'claude-3.5-sonnet', providerModelId: 'claude-3-5-sonnet-20241022' });
    const mockDb = {
      getAdminPricingConfig: vi.fn().mockResolvedValue(null),
    };
    const result = await validatePricingAvailable(model, mockDb);
    // Falls through to hardcoded pricing
    expect(result).toEqual({ valid: true });
  });

  it('continues when admin config throws', async () => {
    const model = makeModel({ id: 'claude-3.5-sonnet', providerModelId: 'claude-3-5-sonnet-20241022' });
    const mockDb = {
      getAdminPricingConfig: vi.fn().mockRejectedValue(new Error('db error')),
    };
    const result = await validatePricingAvailable(model, mockDb);
    // Falls through to hardcoded pricing
    expect(result).toEqual({ valid: true });
  });

  it('checks OpenRouter cached pricing for openrouter provider', async () => {
    const model = makeModel({ id: 'or-model', providerModelId: 'anthropic/claude-3-opus', provider: 'openrouter' });
    // Not in hardcoded table by this exact id combo, so we rely on OR cache
    mockGetOpenRouterPricing.mockReturnValue({ input: 15, output: 75 });
    const result = await validatePricingAvailable(model);
    expect(result).toEqual({ valid: true });
    expect(mockGetOpenRouterPricing).toHaveBeenCalledWith('anthropic/claude-3-opus');
  });

  it('attempts cache refresh for openrouter when pricing missing', async () => {
    const model = makeModel({ id: 'or-unknown', providerModelId: 'openrouter/unknown-model', provider: 'openrouter' });
    mockGetOpenRouterPricing
      .mockReturnValueOnce(null) // First call: not cached
      .mockReturnValueOnce({ input: 1, output: 5 }); // After refresh
    mockTryRefreshOpenRouterCache.mockResolvedValue(true);

    const result = await validatePricingAvailable(model);
    expect(result).toEqual({ valid: true });
    expect(mockTryRefreshOpenRouterCache).toHaveBeenCalled();
  });

  it('returns invalid when openrouter cache refresh fails to find pricing', async () => {
    const model = makeModel({ id: 'or-unknown', providerModelId: 'openrouter/nonexistent', provider: 'openrouter' });
    mockGetOpenRouterPricing.mockReturnValue(null);
    mockTryRefreshOpenRouterCache.mockResolvedValue(false);

    const result = await validatePricingAvailable(model);
    expect(result).toEqual(expect.objectContaining({ valid: false }));
  });

  it('validates using model.id fallback when providerModelId not in table', async () => {
    // Model with a providerModelId not in the table, but model.id IS in the table
    const model = makeModel({ id: 'claude-3.5-sonnet', providerModelId: 'custom-alias-not-in-table' });
    const result = await validatePricingAvailable(model);
    expect(result).toEqual({ valid: true });
  });

  it('works without db parameter', async () => {
    const model = makeModel();
    const result = await validatePricingAvailable(model);
    expect(result).toEqual({ valid: true });
  });
});

describe('EnhancedInferenceService', () => {
  let service: EnhancedInferenceService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default config: no provider-specific pricing
    mockLoadConfig.mockResolvedValue({
      providers: {},
    });
    // Default context manager behavior
    mockPrepareContext.mockResolvedValue({
      formattedMessages: [],
      cacheKey: 'cache-key-1',
      window: {
        messages: [makeMessage()],
        cacheablePrefix: [],
        activeWindow: [makeMessage()],
        metadata: {
          totalMessages: 1,
          totalTokens: 100,
          windowStart: 0,
          windowEnd: 1,
          lastRotation: null,
          cacheKey: 'cache-key-1',
        },
      },
    });
    // Default streamCompletion: immediately calls callback with completion
    mockStreamCompletion.mockImplementation(async (
      _modelId: string,
      _messages: any[],
      _systemPrompt: string,
      _settings: any,
      _userId: string,
      onChunk: (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => Promise<void>,
    ) => {
      await onChunk('Hello', false);
      await onChunk(' world', true, undefined, {
        inputTokens: 50,
        outputTokens: 20,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      });
      return { usage: { inputTokens: 50, outputTokens: 20 } };
    });

    service = new EnhancedInferenceService(mockInferenceService as any, mockContextManager as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('streamCompletion', () => {
    it('falls back to direct inference when no conversation provided', async () => {
      const model = makeModel();
      const messages = [makeMessage()];
      const callback = vi.fn();

      await service.streamCompletion(
        model, messages, 'system prompt', defaultSettings, 'user-1', callback
      );

      expect(mockStreamCompletion).toHaveBeenCalledWith(
        'claude-3.5-sonnet', messages, 'system prompt', defaultSettings,
        'user-1', callback, 'standard', [], undefined, undefined
      );
      // Context manager should NOT have been called
      expect(mockPrepareContext).not.toHaveBeenCalled();
    });

    it('uses context manager when conversation is provided', async () => {
      const model = makeModel();
      const messages = [makeMessage()];
      const conversation = makeConversation();
      const callback = vi.fn();

      await service.streamCompletion(
        model, messages, 'system prompt', defaultSettings, 'user-1', callback,
        conversation
      );

      expect(mockPrepareContext).toHaveBeenCalledWith(
        conversation, messages, undefined, undefined, model.contextWindow
      );
      expect(mockStreamCompletion).toHaveBeenCalled();
    });

    it('passes participant to context manager', async () => {
      const model = makeModel();
      const messages = [makeMessage()];
      const conversation = makeConversation();
      const participant = makeParticipant();
      const callback = vi.fn();

      await service.streamCompletion(
        model, messages, 'system prompt', defaultSettings, 'user-1', callback,
        conversation, participant
      );

      expect(mockPrepareContext).toHaveBeenCalledWith(
        conversation, messages, undefined, participant, model.contextWindow
      );
    });

    it('calls updateAfterInference on completion', async () => {
      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'system', defaultSettings, 'user-1', callback,
        conversation
      );

      expect(mockUpdateAfterInference).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ cacheHit: false }),
        undefined
      );
    });

    it('calls onMetrics callback when provided', async () => {
      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'system', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({
        inputTokens: 50,
        outputTokens: 20,
        cachedTokens: 0,
        model: 'claude-3.5-sonnet',
      }));
    });

    it('records cache hit from actual usage', async () => {
      mockStreamCompletion.mockImplementation(async (
        _mid: any, _msgs: any, _sp: any, _s: any, _uid: any,
        onChunk: any,
      ) => {
        await onChunk('response', true, undefined, {
          inputTokens: 10,
          outputTokens: 5,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 80,
        });
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      expect(mockUpdateAfterInference).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ cacheHit: true, cachedTokens: 80 }),
        undefined
      );
    });

    it('records cacheCreation tokens when no cache read', async () => {
      mockStreamCompletion.mockImplementation(async (
        _mid: any, _msgs: any, _sp: any, _s: any, _uid: any,
        onChunk: any,
      ) => {
        await onChunk('response', true, undefined, {
          inputTokens: 30,
          outputTokens: 10,
          cacheCreationInputTokens: 50,
          cacheReadInputTokens: 0,
        });
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      // cachedTokens = cacheCreation when cacheRead is 0
      expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({
        cachedTokens: 50,
      }));
    });

    it('passes through failure info in metrics', async () => {
      mockStreamCompletion.mockImplementation(async (
        _mid: any, _msgs: any, _sp: any, _s: any, _uid: any,
        onChunk: any,
      ) => {
        await onChunk('', true, undefined, {
          inputTokens: 10,
          outputTokens: 0,
          failed: true,
          error: 'rate limited',
        });
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({
        failed: true,
        error: 'rate limited',
      }));
    });

    it('throws on abort signal during streaming', async () => {
      const abortController = new AbortController();
      mockStreamCompletion.mockImplementation(async (
        _mid: any, _msgs: any, _sp: any, _s: any, _uid: any,
        onChunk: any,
      ) => {
        abortController.abort();
        await onChunk('data', false);
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();

      await expect(
        service.streamCompletion(
          model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
          conversation, undefined, undefined, undefined, abortController.signal
        )
      ).rejects.toThrow('Generation aborted');
    });

    it('adds cache control to messages for anthropic standard format', async () => {
      const cacheableMsg = makeMessage({ id: 'msg-cache' });
      mockPrepareContext.mockResolvedValue({
        formattedMessages: [],
        cacheKey: 'key-1',
        window: {
          messages: [cacheableMsg, makeMessage({ id: 'msg-2' })],
          cacheablePrefix: [cacheableMsg],
          activeWindow: [makeMessage({ id: 'msg-2' })],
          cacheMarkers: [{ messageId: 'msg-cache', messageIndex: 0, tokenCount: 500 }],
          metadata: {
            totalMessages: 2,
            totalTokens: 200,
            windowStart: 0,
            windowEnd: 2,
            lastRotation: null,
            cacheKey: 'key-1',
          },
        },
      });

      const model = makeModel({ provider: 'anthropic' });
      const conversation = makeConversation({ format: 'standard' as any });
      const callback = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      // Should have called streamCompletion with messages that have _cacheControl
      const sentMessages = mockStreamCompletion.mock.calls[0][1];
      expect(sentMessages).toHaveLength(2);
      // First message should have cache control added to active branch
      const branch = sentMessages[0].branches.find((b: any) => b.id === sentMessages[0].activeBranchId);
      expect(branch._cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' });
    });

    it('uses chapter II caching for anthropic prefill format', async () => {
      mockPrepareContext.mockResolvedValue({
        formattedMessages: [],
        cacheKey: 'key-1',
        window: {
          messages: [makeMessage()],
          cacheablePrefix: [makeMessage()],
          activeWindow: [],
          cacheMarkers: [{ messageId: 'msg-1', messageIndex: 0, tokenCount: 500 }],
          metadata: {
            totalMessages: 1,
            totalTokens: 100,
            windowStart: 0,
            windowEnd: 1,
            lastRotation: null,
            cacheKey: 'key-1',
          },
        },
      });

      const model = makeModel({ provider: 'anthropic' });
      const conversation = makeConversation({ format: 'prefill' as any });
      const callback = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      // For anthropic prefill, cacheMarkerIndices should be passed
      const call = mockStreamCompletion.mock.calls[0];
      const cacheMarkerIndices = call[10]; // 11th argument
      expect(cacheMarkerIndices).toEqual([0]);
    });

    it('uses message-level cache control for openrouter with cacheable prefix', async () => {
      const cacheableMsg = makeMessage({ id: 'msg-cache' });
      mockPrepareContext.mockResolvedValue({
        formattedMessages: [],
        cacheKey: 'key-1',
        window: {
          messages: [cacheableMsg],
          cacheablePrefix: [cacheableMsg],
          activeWindow: [],
          cacheMarkers: [{ messageId: 'msg-cache', messageIndex: 0, tokenCount: 500 }],
          metadata: {
            totalMessages: 1,
            totalTokens: 100,
            windowStart: 0,
            windowEnd: 1,
            lastRotation: null,
            cacheKey: 'key-1',
          },
        },
      });

      const model = makeModel({ provider: 'openrouter' });
      const conversation = makeConversation({ format: 'prefill' as any });
      const callback = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      // For openrouter, even with prefill, should use message-level cache control (not text breakpoints)
      const sentMessages = mockStreamCompletion.mock.calls[0][1];
      const branch = sentMessages[0].branches.find((b: any) => b.id === sentMessages[0].activeBranchId);
      expect(branch._cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' });
    });

    it('does not add cache control for non-anthropic/non-openrouter providers', async () => {
      mockPrepareContext.mockResolvedValue({
        formattedMessages: [],
        cacheKey: 'key-1',
        window: {
          messages: [makeMessage()],
          cacheablePrefix: [makeMessage()],
          activeWindow: [],
          metadata: {
            totalMessages: 1,
            totalTokens: 100,
            windowStart: 0,
            windowEnd: 1,
            lastRotation: null,
          },
        },
      });

      const model = makeModel({ provider: 'openai-compatible' as any });
      const conversation = makeConversation();
      const callback = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      // Messages sent as-is, no cache control
      const sentMessages = mockStreamCompletion.mock.calls[0][1];
      const branch = sentMessages[0].branches.find((b: any) => b.id === sentMessages[0].activeBranchId);
      expect(branch._cacheControl).toBeUndefined();
    });

    it('handles legacy single cacheMarker for cache control', async () => {
      const cacheableMsg = makeMessage({ id: 'msg-cache' });
      mockPrepareContext.mockResolvedValue({
        formattedMessages: [],
        cacheKey: 'key-1',
        window: {
          messages: [cacheableMsg],
          cacheablePrefix: [cacheableMsg],
          activeWindow: [],
          // Legacy: single cacheMarker instead of cacheMarkers array
          cacheMarker: { messageId: 'msg-cache', messageIndex: 0, tokenCount: 500 },
          metadata: {
            totalMessages: 1,
            totalTokens: 100,
            windowStart: 0,
            windowEnd: 1,
            lastRotation: null,
          },
        },
      });

      const model = makeModel({ provider: 'anthropic' });
      const conversation = makeConversation();
      const callback = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      const sentMessages = mockStreamCompletion.mock.calls[0][1];
      const branch = sentMessages[0].branches.find((b: any) => b.id === sentMessages[0].activeBranchId);
      expect(branch._cacheControl).toBeDefined();
    });

    it('skips cache control when no markers and no cacheable prefix', async () => {
      mockPrepareContext.mockResolvedValue({
        formattedMessages: [],
        cacheKey: 'key-1',
        window: {
          messages: [makeMessage()],
          cacheablePrefix: [],
          activeWindow: [makeMessage()],
          metadata: {
            totalMessages: 1,
            totalTokens: 100,
            windowStart: 0,
            windowEnd: 1,
            lastRotation: null,
          },
        },
      });

      const model = makeModel({ provider: 'anthropic' });
      const conversation = makeConversation();
      const callback = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      const sentMessages = mockStreamCompletion.mock.calls[0][1];
      const branch = sentMessages[0].branches.find((b: any) => b.id === sentMessages[0].activeBranchId);
      expect(branch._cacheControl).toBeUndefined();
    });

    it('uses conversation format for inference service call', async () => {
      const model = makeModel();
      const conversation = makeConversation({ format: 'prefill' as any });
      const callback = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      // 7th arg is format
      expect(mockStreamCompletion.mock.calls[0][6]).toBe('prefill');
    });

    it('defaults to standard format when conversation format is missing', async () => {
      const model = makeModel();
      const conversation = makeConversation({ format: undefined as any });
      const callback = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      expect(mockStreamCompletion.mock.calls[0][6]).toBe('standard');
    });

    it('passes participants to inference service', async () => {
      const model = makeModel();
      const conversation = makeConversation();
      const participants = [makeParticipant()];
      const callback = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, undefined, participants
      );

      expect(mockStreamCompletion.mock.calls[0][7]).toEqual(participants);
    });

    it('handles context window with rotation (hasRotation logging branch)', async () => {
      mockPrepareContext.mockResolvedValue({
        formattedMessages: [],
        cacheKey: 'key-1',
        window: {
          messages: [makeMessage()],
          cacheablePrefix: [],
          activeWindow: [makeMessage()],
          metadata: {
            totalMessages: 5,
            totalTokens: 500,
            windowStart: 2, // Rotation happened — dropped 2 messages
            windowEnd: 5,
            lastRotation: null,
          },
        },
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();

      // Should not throw; exercises the hasRotation && !hasCaching branch
      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      expect(mockStreamCompletion).toHaveBeenCalled();
    });

    it('handles context window with caching and markers', async () => {
      mockPrepareContext.mockResolvedValue({
        formattedMessages: [],
        cacheKey: 'key-1',
        window: {
          messages: [makeMessage(), makeMessage({ id: 'msg-2' })],
          cacheablePrefix: [makeMessage()],
          activeWindow: [makeMessage({ id: 'msg-2' })],
          cacheMarkers: [
            { messageId: 'msg-1', messageIndex: 0, tokenCount: 200 },
            { messageId: 'msg-2', messageIndex: 1, tokenCount: 400 },
          ],
          metadata: {
            totalMessages: 2,
            totalTokens: 400,
            windowStart: 0,
            windowEnd: 2,
            lastRotation: null,
            cacheKey: 'key-1',
          },
        },
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();

      // Exercises the hasCaching branch with multiple markers
      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      expect(mockStreamCompletion).toHaveBeenCalled();
    });

    it('handles context window with single legacy cacheMarker (non-array)', async () => {
      mockPrepareContext.mockResolvedValue({
        formattedMessages: [],
        cacheKey: 'key-1',
        window: {
          messages: [makeMessage()],
          cacheablePrefix: [makeMessage()],
          activeWindow: [],
          cacheMarker: { messageId: 'msg-1', messageIndex: 0, tokenCount: 200 },
          // No cacheMarkers array
          metadata: {
            totalMessages: 1,
            totalTokens: 200,
            windowStart: 0,
            windowEnd: 1,
            lastRotation: null,
            cacheKey: 'key-1',
          },
        },
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();

      // Exercises the else if (window.cacheMarker) branch in logging
      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      expect(mockStreamCompletion).toHaveBeenCalled();
    });

    it('handles bedrock provider for prefill format (text breakpoints)', async () => {
      mockPrepareContext.mockResolvedValue({
        formattedMessages: [],
        cacheKey: 'key-1',
        window: {
          messages: [makeMessage()],
          cacheablePrefix: [makeMessage()],
          activeWindow: [],
          cacheMarkers: [{ messageId: 'msg-1', messageIndex: 0, tokenCount: 500 }],
          metadata: {
            totalMessages: 1,
            totalTokens: 100,
            windowStart: 0,
            windowEnd: 1,
            lastRotation: null,
            cacheKey: 'key-1',
          },
        },
      });

      const model = makeModel({ provider: 'bedrock' });
      const conversation = makeConversation({ format: 'prefill' as any });
      const callback = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      // Bedrock + prefill should use text breakpoints (cacheMarkerIndices)
      const cacheMarkerIndices = mockStreamCompletion.mock.calls[0][10];
      expect(cacheMarkerIndices).toEqual([0]);
    });

    it('handles no cacheMarkers for prefill anthropic (no breakpoints)', async () => {
      mockPrepareContext.mockResolvedValue({
        formattedMessages: [],
        cacheKey: 'key-1',
        window: {
          messages: [makeMessage()],
          cacheablePrefix: [makeMessage()],
          activeWindow: [],
          // No cacheMarkers or cacheMarker
          metadata: {
            totalMessages: 1,
            totalTokens: 100,
            windowStart: 0,
            windowEnd: 1,
            lastRotation: null,
          },
        },
      });

      const model = makeModel({ provider: 'anthropic' });
      const conversation = makeConversation({ format: 'prefill' as any });
      const callback = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation
      );

      // No markers => no cacheMarkerIndices
      const cacheMarkerIndices = mockStreamCompletion.mock.calls[0][10];
      expect(cacheMarkerIndices).toBeUndefined();
    });

    it('handles actualUsage with defensive defaults for NaN prevention', async () => {
      mockStreamCompletion.mockImplementation(async (
        _mid: any, _msgs: any, _sp: any, _s: any, _uid: any,
        onChunk: any,
      ) => {
        await onChunk('response', true, undefined, {
          // inputTokens and outputTokens undefined — should default to 0
          inputTokens: undefined,
          outputTokens: undefined,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        });
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      // Should use 0 defaults, not NaN
      expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({
        inputTokens: 0,
        outputTokens: 0,
      }));
    });
  });

  describe('getConfigPricing (via getInputPricePerToken/getOutputPricePerToken)', () => {
    it('uses admin-configured pricing when available', async () => {
      mockLoadConfig.mockResolvedValue({
        providers: {
          anthropic: [{
            modelCosts: [{
              modelId: 'claude-3-5-sonnet-20241022',
              providerCost: { inputTokensPerMillion: 2.5, outputTokensPerMillion: 12.5 },
            }],
          }],
        },
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      // Cost should be based on admin pricing (2.5/12.5 per million), not hardcoded (3/15)
      const metrics = onMetrics.mock.calls[0][0];
      // inputTokens=50, outputTokens=20
      // inputCost = 50 * (2.5 / 1_000_000) = 0.000125
      // outputCost = 20 * (12.5 / 1_000_000) = 0.00025
      expect(metrics.cost).toBeCloseTo(0.000125 + 0.00025, 8);
    });

    it('falls back to OpenRouter pricing cache for openrouter models', async () => {
      mockLoadConfig.mockResolvedValue({ providers: {} });
      mockGetOpenRouterPricing.mockReturnValue({ input: 5.0, output: 25.0 });

      const model = makeModel({
        provider: 'openrouter',
        providerModelId: 'anthropic/claude-3-opus',
        id: 'or-opus',
      });
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      // Should use OpenRouter pricing: 5.0/25.0 per million
      const metrics = onMetrics.mock.calls[0][0];
      // inputCost = 50 * (5/1M) = 0.00025, outputCost = 20 * (25/1M) = 0.0005
      expect(metrics.cost).toBeCloseTo(0.00025 + 0.0005, 8);
    });

    it('falls back to hardcoded pricing table', async () => {
      mockLoadConfig.mockResolvedValue({ providers: {} });

      const model = makeModel(); // claude-3.5-sonnet has hardcoded pricing: 3/15
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      // Hardcoded pricing: input=3/M, output=15/M
      const metrics = onMetrics.mock.calls[0][0];
      // inputCost = 50 * (3/1M) = 0.00015, outputCost = 20 * (15/1M) = 0.0003
      expect(metrics.cost).toBeCloseTo(0.00015 + 0.0003, 8);
    });

    it('throws PricingNotConfiguredError for unknown model', async () => {
      mockLoadConfig.mockResolvedValue({ providers: {} });

      const model = makeModel({
        id: 'unknown-model-xyz',
        providerModelId: 'unknown-provider-model',
        provider: 'anthropic',
      });
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await expect(
        service.streamCompletion(
          model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
          conversation, undefined, onMetrics
        )
      ).rejects.toThrow(PricingNotConfiguredError);
    });

    it('handles config loading error gracefully (falls through to other sources)', async () => {
      mockLoadConfig.mockRejectedValue(new Error('config file not found'));

      const model = makeModel(); // Has hardcoded pricing
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      // Should fall back to hardcoded pricing without throwing
      expect(onMetrics).toHaveBeenCalled();
    });

    it('searches all profiles in a provider for model costs', async () => {
      mockLoadConfig.mockResolvedValue({
        providers: {
          anthropic: [
            { modelCosts: [{ modelId: 'other-model', providerCost: { inputTokensPerMillion: 99, outputTokensPerMillion: 99 } }] },
            { modelCosts: [{ modelId: 'claude-3-5-sonnet-20241022', providerCost: { inputTokensPerMillion: 2, outputTokensPerMillion: 10 } }] },
          ],
        },
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      // Should find the model in the second profile
      const metrics = onMetrics.mock.calls[0][0];
      expect(metrics.cost).toBeCloseTo(50 * 2 / 1e6 + 20 * 10 / 1e6, 8);
    });

    it('skips profiles without modelCosts', async () => {
      mockLoadConfig.mockResolvedValue({
        providers: {
          anthropic: [
            { /* no modelCosts */ },
            { modelCosts: [{ modelId: 'claude-3-5-sonnet-20241022', providerCost: { inputTokensPerMillion: 1, outputTokensPerMillion: 5 } }] },
          ],
        },
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      const metrics = onMetrics.mock.calls[0][0];
      expect(metrics.cost).toBeCloseTo(50 * 1 / 1e6 + 20 * 5 / 1e6, 8);
    });

    it('returns null for empty provider array', async () => {
      mockLoadConfig.mockResolvedValue({
        providers: { anthropic: [] },
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      // Falls back to hardcoded pricing
      const metrics = onMetrics.mock.calls[0][0];
      expect(metrics.cost).toBeCloseTo(50 * 3 / 1e6 + 20 * 15 / 1e6, 8);
    });
  });

  describe('buildUsageDetails', () => {
    it('includes input, output, and cached_input details', async () => {
      mockStreamCompletion.mockImplementation(async (
        _mid: any, _msgs: any, _sp: any, _s: any, _uid: any,
        onChunk: any,
      ) => {
        await onChunk('', true, undefined, {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 200,
        });
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      const metrics = onMetrics.mock.calls[0][0];
      expect(metrics.details).toHaveProperty('input');
      expect(metrics.details).toHaveProperty('output');
      expect(metrics.details).toHaveProperty('cached_input');

      // Input details: tokens=300 (100+0+200), price = 3/1M (hardcoded)
      expect(metrics.details.input.tokens).toBe(300);
      expect(metrics.details.output.tokens).toBe(50);
      expect(metrics.details.cached_input.tokens).toBe(200);
      // Cached input has negative price (it's a discount)
      expect(metrics.details.cached_input.price).toBeLessThan(0);
    });

    it('omits sections with zero tokens', async () => {
      mockStreamCompletion.mockImplementation(async (
        _mid: any, _msgs: any, _sp: any, _s: any, _uid: any,
        onChunk: any,
      ) => {
        await onChunk('', true, undefined, {
          inputTokens: 100,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        });
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      const metrics = onMetrics.mock.calls[0][0];
      expect(metrics.details).toHaveProperty('input');
      expect(metrics.details).not.toHaveProperty('output');
      expect(metrics.details).not.toHaveProperty('cached_input');
    });
  });

  describe('getCacheMetrics', () => {
    it('returns all metrics when no filter provided', async () => {
      // Run two completions to populate metrics
      const model = makeModel();
      const conv1 = makeConversation({ id: 'conv-1' });
      const conv2 = makeConversation({ id: 'conv-2' });
      const callback = vi.fn();

      await service.streamCompletion(model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback, conv1);
      await service.streamCompletion(model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback, conv2);

      const metrics = service.getCacheMetrics();
      expect(metrics).toHaveLength(2);
    });

    it('filters by conversationId', async () => {
      const model = makeModel();
      const conv1 = makeConversation({ id: 'conv-1' });
      const conv2 = makeConversation({ id: 'conv-2' });
      const callback = vi.fn();

      await service.streamCompletion(model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback, conv1);
      await service.streamCompletion(model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback, conv2);

      const metrics = service.getCacheMetrics('conv-1');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].conversationId).toBe('conv-1');
    });

    it('filters by both conversationId and participantId', async () => {
      const model = makeModel();
      const conv = makeConversation({ id: 'conv-1' });
      const participant1 = makeParticipant({ id: 'p1' });
      const participant2 = makeParticipant({ id: 'p2' });
      const callback = vi.fn();

      await service.streamCompletion(model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback, conv, participant1);
      await service.streamCompletion(model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback, conv, participant2);

      const metrics = service.getCacheMetrics('conv-1', 'p1');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].participantId).toBe('p1');
    });

    it('returns a copy (not the internal array)', async () => {
      const metrics = service.getCacheMetrics();
      expect(metrics).toEqual([]);
      // Mutating the returned array should not affect internal state
      metrics.push({} as any);
      expect(service.getCacheMetrics()).toHaveLength(0);
    });
  });

  describe('getCacheSavings', () => {
    it('returns zero values when no metrics recorded', () => {
      const savings = service.getCacheSavings();
      expect(savings.totalSaved).toBe(0);
      expect(savings.cacheHitRate).toBe(0);
      expect(Object.keys(savings.byModel)).toHaveLength(0);
    });

    it('calculates savings from recorded metrics', async () => {
      mockStreamCompletion.mockImplementation(async (
        _mid: any, _msgs: any, _sp: any, _s: any, _uid: any,
        onChunk: any,
      ) => {
        await onChunk('', true, undefined, {
          inputTokens: 10,
          outputTokens: 5,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 100,
        });
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();

      await service.streamCompletion(model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback, conversation);

      const savings = service.getCacheSavings();
      expect(savings.totalSaved).toBeGreaterThan(0);
      expect(savings.cacheHitRate).toBe(1); // 1 out of 1 was a cache hit
      expect(savings.byModel['Claude 3.5 Sonnet']).toBeGreaterThan(0);
    });

    it('filters metrics by date', async () => {
      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();

      await service.streamCompletion(model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback, conversation);

      // Future date - should filter out all metrics
      const futureSavings = service.getCacheSavings(new Date(Date.now() + 100000));
      expect(futureSavings.totalSaved).toBe(0);
      expect(futureSavings.cacheHitRate).toBe(0);
    });
  });

  describe('estimateTokens', () => {
    it('is exercised through streamCompletion (cacheable prefix token estimation)', async () => {
      mockPrepareContext.mockResolvedValue({
        formattedMessages: [],
        cacheKey: 'key-1',
        window: {
          messages: [makeMessage()],
          cacheablePrefix: [makeMessage(), makeMessage({ id: 'msg-2' })], // Array of messages
          activeWindow: [],
          metadata: {
            totalMessages: 2,
            totalTokens: 200,
            windowStart: 0,
            windowEnd: 2,
            lastRotation: null,
          },
        },
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      // This exercises estimateTokens with an array input
      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      expect(onMetrics).toHaveBeenCalled();
    });
  });

  describe('setContextStrategy (deprecated)', () => {
    it('logs deprecation warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      service.setContextStrategy('conv-1', 'rolling');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
      warnSpy.mockRestore();
    });
  });

  describe('setContextManagement', () => {
    it('delegates to context manager', () => {
      const mgmt = { strategy: 'rolling' };
      service.setContextManagement('conv-1', mgmt, 'part-1');
      expect(mockSetContextManagement).toHaveBeenCalledWith('conv-1', mgmt, 'part-1');
    });
  });

  describe('getContextStatistics', () => {
    it('delegates to context manager', () => {
      mockGetStatistics.mockReturnValue({ hits: 5 });
      const stats = service.getContextStatistics('conv-1', 'part-1');
      expect(stats).toEqual({ hits: 5 });
      expect(mockGetStatistics).toHaveBeenCalledWith('conv-1', 'part-1');
    });
  });

  describe('getCacheMarker', () => {
    it('delegates to context manager', () => {
      const marker = { messageId: 'msg-1', messageIndex: 0, tokenCount: 100 };
      mockGetCacheMarker.mockReturnValue(marker);
      const result = service.getCacheMarker('conv-1', 'part-1');
      expect(result).toEqual(marker);
      expect(mockGetCacheMarker).toHaveBeenCalledWith('conv-1', 'part-1');
    });
  });

  describe('calculateCostSaved (via cache savings)', () => {
    it('applies CACHE_DISCOUNT (0.9) to cached token cost', async () => {
      mockStreamCompletion.mockImplementation(async (
        _mid: any, _msgs: any, _sp: any, _s: any, _uid: any,
        onChunk: any,
      ) => {
        await onChunk('', true, undefined, {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 1000,
        });
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      const metrics = onMetrics.mock.calls[0][0];
      // cacheSavings = 1000 * (3/1M) * 0.9 = 0.0000027
      expect(metrics.cacheSavings).toBeCloseTo(1000 * (3 / 1_000_000) * 0.9, 10);
    });
  });

  describe('cost is non-negative (Math.max)', () => {
    it('cost never goes below zero even with large cache savings', async () => {
      mockStreamCompletion.mockImplementation(async (
        _mid: any, _msgs: any, _sp: any, _s: any, _uid: any,
        onChunk: any,
      ) => {
        await onChunk('', true, undefined, {
          inputTokens: 1,
          outputTokens: 1,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 100000, // Huge cache savings
        });
      });

      const model = makeModel();
      const conversation = makeConversation();
      const callback = vi.fn();
      const onMetrics = vi.fn();

      await service.streamCompletion(
        model, [makeMessage()], 'sys', defaultSettings, 'user-1', callback,
        conversation, undefined, onMetrics
      );

      const metrics = onMetrics.mock.calls[0][0];
      expect(metrics.cost).toBeGreaterThanOrEqual(0);
    });
  });

  describe('constructor without contextManager', () => {
    it('creates a default ContextManager', () => {
      // Just constructing without contextManager should not throw
      const svc = new EnhancedInferenceService(mockInferenceService as any);
      expect(svc).toBeDefined();
    });
  });
});
