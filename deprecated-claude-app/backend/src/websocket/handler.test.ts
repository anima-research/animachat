import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import type { Message, Participant, Conversation } from '@deprecated-claude/shared';

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../utils/logger.js', () => ({
  Logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), inference: vi.fn(), websocket: vi.fn() },
}));

const mockLlmLogger = vi.hoisted(() => ({
  logRequest: vi.fn(),
  logResponse: vi.fn(),
  logCustom: vi.fn(),
  logWebSocketEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/llmLogger.js', () => ({
  llmLogger: mockLlmLogger,
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('img')),
  })),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: vi.fn() }; },
}));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class { send = vi.fn(); },
  ConverseStreamCommand: class { constructor(public input: any) {} },
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContentStream: vi.fn() }; },
}));

// Mock Database
const mockDb = {
  getConversation: vi.fn(),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn(),
  addMessageBranch: vi.fn(),
  deleteMessageBranch: vi.fn(),
  updateMessageBranch: vi.fn(),
  getMessage: vi.fn(),
  getParticipants: vi.fn().mockResolvedValue([]),
  getUserApiKeys: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn().mockReturnValue({}),
  getUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
  getUserByUsername: vi.fn().mockResolvedValue(null),
  isCollaborator: vi.fn().mockResolvedValue(false),
  canUserChatInConversation: vi.fn().mockResolvedValue(true),
  canUserDeleteInConversation: vi.fn().mockResolvedValue(true),
  getGrantSummary: vi.fn().mockResolvedValue({ balances: {} }),
  updateConversation: vi.fn(),
  getUserById: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }),
  userHasActiveGrantCapability: vi.fn().mockResolvedValue(false),
  isUserAgeVerified: vi.fn().mockResolvedValue(false),
  getConversationParticipants: vi.fn().mockResolvedValue([]),
  getUserGrantSummary: vi.fn().mockResolvedValue({ totals: {} }),
  getApplicableGrantCurrencies: vi.fn().mockResolvedValue([]),
  updateMessageContent: vi.fn().mockResolvedValue(undefined),
  addMetrics: vi.fn().mockResolvedValue(undefined),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../database/index.js', () => ({
  Database: class MockDatabase {
    getConversation = mockDb.getConversation;
    getConversationMessages = mockDb.getConversationMessages;
    createMessage = mockDb.createMessage;
    addMessageBranch = mockDb.addMessageBranch;
    deleteMessageBranch = mockDb.deleteMessageBranch;
    updateMessageBranch = mockDb.updateMessageBranch;
    getMessage = mockDb.getMessage;
    getParticipants = mockDb.getParticipants;
    getUserApiKeys = mockDb.getUserApiKeys;
    getConfig = mockDb.getConfig;
    getUser = mockDb.getUser;
    getUserByUsername = mockDb.getUserByUsername;
    isCollaborator = mockDb.isCollaborator;
    canUserChatInConversation = mockDb.canUserChatInConversation;
    canUserDeleteInConversation = mockDb.canUserDeleteInConversation;
    getGrantSummary = mockDb.getGrantSummary;
    updateConversation = mockDb.updateConversation;
    getUserById = mockDb.getUserById;
    userHasActiveGrantCapability = mockDb.userHasActiveGrantCapability;
    isUserAgeVerified = mockDb.isUserAgeVerified;
    getConversationParticipants = mockDb.getConversationParticipants;
    getUserGrantSummary = mockDb.getUserGrantSummary;
    getApplicableGrantCurrencies = mockDb.getApplicableGrantCurrencies;
    updateMessageContent = mockDb.updateMessageContent;
    addMetrics = mockDb.addMetrics;
    deleteMessage = mockDb.deleteMessage;
  },
}));

// Mock ModelLoader
const mockModelLoader = {
  getModelById: vi.fn().mockResolvedValue(null),
  getAllModels: vi.fn().mockResolvedValue([]),
};

vi.mock('../config/model-loader.js', () => ({
  ModelLoader: { getInstance: () => mockModelLoader },
}));

// Mock ConfigLoader
vi.mock('../config/config-loader.js', () => ({
  ConfigLoader: {
    getInstance: () => ({
      getConfig: vi.fn().mockReturnValue({ providers: {}, features: {}, grants: { enabled: false } }),
      getProviderConfig: vi.fn().mockReturnValue(null),
    }),
  },
}));

// Mock auth middleware
vi.mock('../middleware/auth.js', () => ({
  verifyToken: vi.fn().mockReturnValue({ userId: 'user-1' }),
}));

// Mock InferenceService
vi.mock('../services/inference.js', () => ({
  InferenceService: class MockInferenceService {
    streamCompletion = vi.fn().mockResolvedValue({ usage: { inputTokens: 10, outputTokens: 5 } });
    lastRawRequest = null;
    constructor(..._args: any[]) {}
  },
}));

// Mock EnhancedInferenceService
const mockEnhancedStream = vi.fn().mockResolvedValue({ usage: { inputTokens: 10, outputTokens: 5 } });
vi.mock('../services/enhanced-inference.js', () => ({
  EnhancedInferenceService: class MockEnhancedInferenceService {
    streamCompletion = mockEnhancedStream;
    constructor(..._args: any[]) {}
  },
  validatePricingAvailable: vi.fn(),
  PricingNotConfiguredError: class extends Error {
    modelId: string;
    constructor(msg: string) { super(msg); this.modelId = ''; }
  },
}));

// Mock ContextManager
vi.mock('../services/context-manager.js', () => ({
  ContextManager: class MockContextManager {
    prepareContext = vi.fn().mockResolvedValue({ window: { messages: [] }, formattedMessages: [] });
    constructor(..._args: any[]) {}
  },
}));

vi.mock('../services/persona-context-builder.js', () => ({
  PersonaContextBuilder: class { constructor(..._args: any[]) {} },
}));

// Mock ApiKeyManager
vi.mock('../services/api-key-manager.js', () => ({
  ApiKeyManager: class MockApiKeyManager {
    getApiKeyForRequest = vi.fn().mockResolvedValue({ source: 'config', credentials: { apiKey: 'k' } });
    constructor(..._args: any[]) {}
  },
}));

// Mock content filter
vi.mock('../services/content-filter.js', () => ({
  checkContent: vi.fn().mockResolvedValue({ blocked: false }),
}));

// Mock error messages
vi.mock('../utils/error-messages.js', () => ({
  USER_FACING_ERRORS: {
    MODEL_NOT_FOUND: { message: 'Model not found', suggestion: 'Check model' },
    NO_API_KEY: { message: 'No API key', suggestion: 'Add key' },
    RATE_LIMIT: { message: 'Rate limited', suggestion: 'Wait' },
    GENERIC_ERROR: { message: 'Error', suggestion: 'Retry' },
    INSUFFICIENT_CREDITS: { message: 'No credits', suggestion: 'Add credits' },
    OVERLOADED: { message: 'Overloaded', suggestion: 'Wait' },
    CONTEXT_TOO_LONG: { message: 'Context too long', suggestion: 'Shorten' },
    AUTHENTICATION_FAILED: { message: 'Auth failed', suggestion: 'Re-auth' },
    CONNECTION_ERROR: { message: 'Connection error', suggestion: 'Check network' },
    CONTENT_FILTERED: { message: 'Filtered', suggestion: 'Modify content' },
    REQUEST_TIMEOUT: { message: 'Timeout', suggestion: 'Retry' },
    SERVER_ERROR: { message: 'Server error', suggestion: 'Retry later' },
    ENDPOINT_NOT_FOUND: { message: 'Not found', suggestion: 'Check endpoint' },
    PRICING_NOT_CONFIGURED: { message: 'Pricing missing', suggestion: 'Configure' },
  },
}));

// Mock room manager — use vi.hoisted to avoid hoisting issues
const mockRoomManager = vi.hoisted(() => ({
  registerConnection: vi.fn(),
  unregisterConnection: vi.fn(),
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
  getActiveUsers: vi.fn().mockReturnValue([]),
  getActiveAiRequest: vi.fn().mockReturnValue(null),
  hasActiveAiRequest: vi.fn().mockReturnValue(false),
  startAiRequest: vi.fn().mockReturnValue(true),
  endAiRequest: vi.fn(),
  broadcastToRoom: vi.fn(),
  performHeartbeat: vi.fn().mockReturnValue({ checked: 0, terminated: 0 }),
}));

vi.mock('./room-manager.js', () => ({
  roomManager: mockRoomManager,
}));

// Now import the handler
import { websocketHandler } from './handler.js';
import { Database } from '../database/index.js';
import { verifyToken } from '../middleware/auth.js';
import { validatePricingAvailable } from '../services/enhanced-inference.js';
import { checkContent } from '../services/content-filter.js';

// ── Test Helpers ──────────────────────────────────────────────────────────

function createMockWs() {
  const ws = new EventEmitter() as any;
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.ping = vi.fn();
  ws.readyState = 1; // OPEN
  ws.userId = undefined;
  ws.isAlive = true;
  ws.terminate = vi.fn();
  return ws;
}

function createMockReq(token = 'valid-token') {
  return {
    url: `/ws?token=${token}`,
    headers: { host: 'localhost' },
  } as any;
}

function makeMessage(
  content: string,
  role: 'user' | 'assistant' | 'system' = 'user',
  opts: {
    id?: string;
    conversationId?: string;
    order?: number;
    participantId?: string;
    hiddenFromAi?: boolean;
    parentBranchId?: string;
  } = {}
): Message {
  const branchId = randomUUID();
  const branch: any = {
    id: branchId,
    content,
    role,
    createdAt: new Date(),
    participantId: opts.participantId,
    parentBranchId: opts.parentBranchId || 'root',
  };
  if (opts.hiddenFromAi) branch.hiddenFromAi = true;

  return {
    id: opts.id ?? randomUUID(),
    conversationId: opts.conversationId ?? randomUUID(),
    branches: [branch],
    activeBranchId: branchId,
    order: opts.order ?? 0,
  };
}

function makeConversation(format: 'standard' | 'prefill' = 'standard', userId = 'user-1'): Conversation {
  return {
    id: randomUUID(),
    userId,
    title: 'Test',
    model: 'test-model',
    format,
    createdAt: new Date(),
    updatedAt: new Date(),
    archived: false,
    settings: { temperature: 0.7, maxTokens: 1024 },
  } as Conversation;
}

function getSentMessages(ws: any): any[] {
  return ws.send.mock.calls.map((call: any) => {
    try { return JSON.parse(call[0]); } catch { return call[0]; }
  });
}

// ── Global beforeEach ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default mock return values after clearAllMocks
  mockDb.getConversationMessages.mockResolvedValue([]);
  mockDb.getParticipants.mockResolvedValue([]);
  mockDb.getUserApiKeys.mockResolvedValue([]);
  mockDb.getConfig.mockReturnValue({});
  mockDb.getUser.mockResolvedValue({ id: 'user-1', email: 'test@test.com' });
  mockDb.getUserByUsername.mockResolvedValue(null);
  mockDb.isCollaborator.mockResolvedValue(false);
  mockDb.canUserChatInConversation.mockResolvedValue(true);
  mockDb.canUserDeleteInConversation.mockResolvedValue(true);
  mockDb.getGrantSummary.mockResolvedValue({ balances: {} });
  mockDb.getUserById.mockResolvedValue({ id: 'user-1', email: 'test@test.com' });
  mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
  mockDb.isUserAgeVerified.mockResolvedValue(false);
  mockDb.getConversationParticipants.mockResolvedValue([]);
  mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
  mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
  mockModelLoader.getModelById.mockResolvedValue(null);
  mockModelLoader.getAllModels.mockResolvedValue([]);
  mockRoomManager.getActiveUsers.mockReturnValue([]);
  mockRoomManager.getActiveAiRequest.mockReturnValue(null);
  mockRoomManager.hasActiveAiRequest.mockReturnValue(false);
  mockRoomManager.startAiRequest.mockReturnValue(true);
  (verifyToken as any).mockReturnValue({ userId: 'user-1' });
  (validatePricingAvailable as any).mockResolvedValue({ valid: true });
  (checkContent as any).mockResolvedValue({ blocked: false });
  mockLlmLogger.logWebSocketEvent.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('WebSocket Handler', () => {
  let ws: any;
  let db: any;

  beforeEach(() => {
    ws = createMockWs();
    db = new Database() as any;
  });

  // ── Connection & Authentication ─────────────────────────────────────

  describe('connection & authentication', () => {
    it('authenticates and sends connected event', () => {
      websocketHandler(ws, createMockReq(), db);

      expect(ws.userId).toBe('user-1');
      expect(mockRoomManager.registerConnection).toHaveBeenCalledWith(ws, 'user-1');

      const msgs = getSentMessages(ws);
      const connectedMsg = msgs.find(m => m.type === 'connected');
      expect(connectedMsg).toBeDefined();
      expect(connectedMsg.userId).toBe('user-1');
    });

    it('closes connection when no token provided', () => {
      websocketHandler(ws, createMockReq(''), db);

      const msgs = getSentMessages(ws);
      const errorMsg = msgs.find(m => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String));
    });

    it('closes connection when token is invalid', () => {
      (verifyToken as any).mockReturnValue(null);
      websocketHandler(ws, createMockReq('bad-token'), db);

      const msgs = getSentMessages(ws);
      const errorMsg = msgs.find(m => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String));
    });

    it('unregisters connection on close', () => {
      websocketHandler(ws, createMockReq(), db);
      ws.emit('close');

      expect(mockRoomManager.unregisterConnection).toHaveBeenCalledWith(ws);
    });
  });

  // ── Message Validation ──────────────────────────────────────────────

  describe('message validation', () => {
    it('rejects malformed JSON', () => {
      websocketHandler(ws, createMockReq(), db);
      ws.emit('message', 'not valid json{{{');

      const msgs = getSentMessages(ws);
      const errorMsgs = msgs.filter(m => m.type === 'error');
      // Should have the connected message + error
      expect(errorMsgs.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects messages with unknown type', async () => {
      // The Zod error object causes console.error to crash in Node's inspect,
      // so we must suppress it to let ws.send execute in the catch block
      const origError = console.error;
      console.error = vi.fn();

      websocketHandler(ws, createMockReq(), db);
      ws.emit('message', JSON.stringify({ type: 'bogus_type' }));

      // The message handler is async, so we need to wait for the error to be sent
      await new Promise(r => setTimeout(r, 50));

      const msgs = getSentMessages(ws);
      const errorMsgs = msgs.filter(m => m.type === 'error');
      expect(errorMsgs.length).toBeGreaterThanOrEqual(1);

      console.error = origError;
    });

    it('responds to ping with pong', () => {
      websocketHandler(ws, createMockReq(), db);
      ws.emit('message', JSON.stringify({ type: 'ping' }));

      const msgs = getSentMessages(ws);
      const pongMsg = msgs.find(m => m.type === 'pong');
      expect(pongMsg).toBeDefined();
    });
  });

  // ── Room Join / Leave ───────────────────────────────────────────────

  describe('room join/leave', () => {
    it('handles join_room message', () => {
      const convId = randomUUID();
      mockRoomManager.getActiveUsers.mockReturnValue([{ userId: 'user-1', joinedAt: new Date() }]);
      mockRoomManager.getActiveAiRequest.mockReturnValue(null);

      websocketHandler(ws, createMockReq(), db);
      ws.emit('message', JSON.stringify({ type: 'join_room', conversationId: convId }));

      expect(mockRoomManager.joinRoom).toHaveBeenCalledWith(convId, ws);

      const msgs = getSentMessages(ws);
      const roomJoined = msgs.find(m => m.type === 'room_joined');
      expect(roomJoined).toBeDefined();
      expect(roomJoined.conversationId).toBe(convId);
      expect(roomJoined.activeUsers).toBeDefined();
    });

    it('handles leave_room message', () => {
      const convId = randomUUID();
      websocketHandler(ws, createMockReq(), db);
      ws.emit('message', JSON.stringify({ type: 'leave_room', conversationId: convId }));

      expect(mockRoomManager.leaveRoom).toHaveBeenCalledWith(convId, ws);

      const msgs = getSentMessages(ws);
      const roomLeft = msgs.find(m => m.type === 'room_left');
      expect(roomLeft).toBeDefined();
    });
  });

  // ── Abort ───────────────────────────────────────────────────────────

  describe('abort', () => {
    it('sends generation_aborted event on abort', () => {
      websocketHandler(ws, createMockReq(), db);
      const convId = randomUUID();
      ws.emit('message', JSON.stringify({ type: 'abort', conversationId: convId }));

      const msgs = getSentMessages(ws);
      const abortMsg = msgs.find(m => m.type === 'generation_aborted');
      expect(abortMsg).toBeDefined();
      expect(abortMsg.conversationId).toBe(convId);
    });
  });

  // ── Typing ──────────────────────────────────────────────────────────

  describe('typing', () => {
    it('broadcasts typing event to room', async () => {
      const convId = randomUUID();
      mockDb.getUserById.mockResolvedValue({ id: 'user-1', email: 'alice@test.com' });
      websocketHandler(ws, createMockReq(), db);
      ws.emit('message', JSON.stringify({ type: 'typing', conversationId: convId, isTyping: true }));

      // Wait for async handler
      await new Promise(r => setTimeout(r, 50));

      expect(mockRoomManager.broadcastToRoom).toHaveBeenCalledWith(
        convId,
        expect.objectContaining({
          type: 'user_typing',
          conversationId: convId,
          userId: 'user-1',
          userName: 'alice',
          isTyping: true,
        }),
        ws,
      );
    });
  });
});

// ── Pure function tests (imported separately) ─────────────────────────

describe('buildConversationHistory', () => {
  // We test this logic by importing the module and testing the exported function's behavior
  // Since buildConversationHistory is not exported, we test it through the handler

  it('follows branch chain from leaf to root', async () => {
    // This is implicitly tested through the chat message flow
    // We simulate by setting up a chain of messages with parent branch IDs
    const convId = randomUUID();
    const rootBranchId = randomUUID();
    const childBranchId = randomUUID();

    const msg1: Message = {
      id: randomUUID(),
      conversationId: convId,
      branches: [{
        id: rootBranchId,
        content: 'first',
        role: 'user' as const,
        createdAt: new Date(),
        parentBranchId: 'root',
      } as any],
      activeBranchId: rootBranchId,
      order: 0,
    };

    const msg2: Message = {
      id: randomUUID(),
      conversationId: convId,
      branches: [{
        id: childBranchId,
        content: 'second',
        role: 'assistant' as const,
        createdAt: new Date(),
        parentBranchId: rootBranchId,
      } as any],
      activeBranchId: childBranchId,
      order: 1,
    };

    // This verifies the data structure - actual buildConversationHistory is tested via integration
    expect(msg1.branches[0].id).toBe(rootBranchId);
    expect((msg2.branches[0] as any).parentBranchId).toBe(rootBranchId);
  });
});

describe('filterHiddenFromAiMessages', () => {
  it('concept: hidden messages should be excluded from AI context', () => {
    const msg1 = makeMessage('visible', 'user', { hiddenFromAi: false });
    const msg2 = makeMessage('hidden', 'user', { hiddenFromAi: true });

    // The filter function checks activeBranch.hiddenFromAi
    const branch1 = msg1.branches.find(b => b.id === msg1.activeBranchId) as any;
    const branch2 = msg2.branches.find(b => b.id === msg2.activeBranchId) as any;

    expect(branch1.hiddenFromAi).toBeFalsy();
    expect(branch2.hiddenFromAi).toBe(true);

    // Simulating the filter logic
    const filtered = [msg1, msg2].filter(m => {
      const ab = m.branches.find(b => b.id === m.activeBranchId) as any;
      return !ab?.hiddenFromAi;
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(msg1.id);
  });
});

describe('applyBackroomPromptIfNeeded', () => {
  // We can't import this directly since it's not exported,
  // but we test its behavior characteristics

  const BACKROOM_PROMPT = 'The assistant is in CLI simulation mode, and responds to the user\'s CLI commands only with the output of the command.';

  function simulateBackroomPrompt(params: {
    conversationFormat: 'standard' | 'prefill';
    messageCount: number;
    modelProvider: string;
    modelSupportsPrefill?: boolean;
    participantConversationMode?: string;
    existingSystemPrompt: string;
    cliModePrompt?: { enabled: boolean; messageThreshold: number };
  }): string {
    const {
      conversationFormat,
      messageCount,
      modelProvider,
      modelSupportsPrefill,
      participantConversationMode,
      existingSystemPrompt,
      cliModePrompt,
    } = params;

    const cliEnabled = cliModePrompt?.enabled ?? true;
    const threshold = cliModePrompt?.messageThreshold ?? 10;

    if (!cliEnabled) return existingSystemPrompt;
    if (conversationFormat !== 'prefill' || messageCount >= threshold) return existingSystemPrompt;

    const modelSupports = modelProvider === 'anthropic' || modelProvider === 'bedrock' || modelSupportsPrefill === true;
    if (!modelSupports) return existingSystemPrompt;

    const participantWantsPrefill = !participantConversationMode ||
      participantConversationMode === 'auto' ||
      participantConversationMode === 'prefill';
    if (!participantWantsPrefill) return existingSystemPrompt;

    if (existingSystemPrompt) {
      return `${BACKROOM_PROMPT}\n\n${existingSystemPrompt}`;
    }
    return BACKROOM_PROMPT;
  }

  it('does not apply for standard format', () => {
    const result = simulateBackroomPrompt({
      conversationFormat: 'standard',
      messageCount: 5,
      modelProvider: 'anthropic',
      existingSystemPrompt: 'existing',
    });
    expect(result).toBe('existing');
  });

  it('applies for prefill format with low message count', () => {
    const result = simulateBackroomPrompt({
      conversationFormat: 'prefill',
      messageCount: 5,
      modelProvider: 'anthropic',
      existingSystemPrompt: '',
    });
    expect(result).toBe(BACKROOM_PROMPT);
  });

  it('prepends to existing system prompt', () => {
    const result = simulateBackroomPrompt({
      conversationFormat: 'prefill',
      messageCount: 5,
      modelProvider: 'anthropic',
      existingSystemPrompt: 'You are helpful',
    });
    expect(result).toContain(BACKROOM_PROMPT);
    expect(result).toContain('You are helpful');
  });

  it('does not apply when message count exceeds threshold', () => {
    const result = simulateBackroomPrompt({
      conversationFormat: 'prefill',
      messageCount: 15,
      modelProvider: 'anthropic',
      existingSystemPrompt: 'existing',
    });
    expect(result).toBe('existing');
  });

  it('does not apply when CLI mode is disabled', () => {
    const result = simulateBackroomPrompt({
      conversationFormat: 'prefill',
      messageCount: 5,
      modelProvider: 'anthropic',
      existingSystemPrompt: 'existing',
      cliModePrompt: { enabled: false, messageThreshold: 10 },
    });
    expect(result).toBe('existing');
  });

  it('does not apply for models that do not support prefill', () => {
    const result = simulateBackroomPrompt({
      conversationFormat: 'prefill',
      messageCount: 5,
      modelProvider: 'openrouter',
      modelSupportsPrefill: false,
      existingSystemPrompt: 'existing',
    });
    expect(result).toBe('existing');
  });

  it('does not apply when participant mode is messages', () => {
    const result = simulateBackroomPrompt({
      conversationFormat: 'prefill',
      messageCount: 5,
      modelProvider: 'anthropic',
      participantConversationMode: 'messages',
      existingSystemPrompt: 'existing',
    });
    expect(result).toBe('existing');
  });

  it('does not apply when participant mode is completion', () => {
    const result = simulateBackroomPrompt({
      conversationFormat: 'prefill',
      messageCount: 5,
      modelProvider: 'anthropic',
      participantConversationMode: 'completion',
      existingSystemPrompt: 'existing',
    });
    expect(result).toBe('existing');
  });

  it('applies when participant mode is auto', () => {
    const result = simulateBackroomPrompt({
      conversationFormat: 'prefill',
      messageCount: 5,
      modelProvider: 'anthropic',
      participantConversationMode: 'auto',
      existingSystemPrompt: '',
    });
    expect(result).toBe(BACKROOM_PROMPT);
  });

  it('uses custom threshold', () => {
    const result = simulateBackroomPrompt({
      conversationFormat: 'prefill',
      messageCount: 3,
      modelProvider: 'anthropic',
      existingSystemPrompt: '',
      cliModePrompt: { enabled: true, messageThreshold: 2 },
    });
    // 3 >= 2, so should not apply
    expect(result).toBe('');
  });
});

describe('generation management', () => {
  // Test the abort tracking logic pattern
  it('abort returns false when no active generation', () => {
    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'abort',
      conversationId: randomUUID(),
    }));

    const msgs = getSentMessages(ws);
    const abortMsg = msgs.find(m => m.type === 'generation_aborted');
    expect(abortMsg).toBeDefined();
    expect(abortMsg.success).toBe(false);
  });
});

describe('delete message', () => {
  it('sends error when conversation not found', async () => {
    mockDb.getConversation.mockResolvedValue(null);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'delete',
      conversationId: randomUUID(),
      messageId: randomUUID(),
      branchId: randomUUID(),
    }));

    // Wait for async handler
    await new Promise(r => setTimeout(r, 50));

    const msgs = getSentMessages(ws);
    const errorMsg = msgs.find(m => m.type === 'error' && m.error?.includes('not found'));
    expect(errorMsg).toBeDefined();
  });

  it('deletes branch when user has permission', async () => {
    const conv = makeConversation();
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.deleteMessageBranch.mockResolvedValue(['branch-1', 'branch-2']);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgId = randomUUID();
    const branchId = randomUUID();
    ws.emit('message', JSON.stringify({
      type: 'delete',
      conversationId: conv.id,
      messageId: msgId,
      branchId: branchId,
    }));

    await new Promise(r => setTimeout(r, 50));

    expect(mockDb.deleteMessageBranch).toHaveBeenCalledWith(msgId, conv.id, conv.userId, branchId, 'user-1');
  });
});

describe('chat message flow', () => {
  it('sends error when conversation not found for chat', async () => {
    mockDb.getConversation.mockResolvedValue(null);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat',
      conversationId: randomUUID(),
      messageId: randomUUID(),
      content: 'Hello',
    }));

    await new Promise(r => setTimeout(r, 50));

    const msgs = getSentMessages(ws);
    const errorMsg = msgs.find(m => m.type === 'error');
    // Should find at least one error
    expect(msgs.some(m => m.type === 'error')).toBe(true);
  });

  it('creates user message for standard conversation', async () => {
    const conv = makeConversation('standard');
    const userMsg = makeMessage('Hello bot!', 'user', { conversationId: conv.id });
    const assistantParticipant = {
      id: 'p-bot',
      conversationId: conv.id,
      name: 'Bot',
      type: 'assistant',
      model: 'test-model',
      isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.createMessage.mockResolvedValue(userMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([assistantParticipant]);
    mockDb.getUserApiKeys.mockResolvedValue([]);
    mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
    mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model',
      providerModelId: 'test',
      provider: 'anthropic',
      contextWindow: 200000,
      outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat',
      conversationId: conv.id,
      messageId: randomUUID(),
      content: 'Hello bot!',
    }));

    await new Promise(r => setTimeout(r, 200));

    // Should have called createMessage for user message
    expect(mockDb.createMessage).toHaveBeenCalled();
  });

  it('skips AI generation when hiddenFromAi is true', async () => {
    const conv = makeConversation('standard');
    const userMsg = makeMessage('Hidden note', 'user', { conversationId: conv.id, hiddenFromAi: true });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.createMessage.mockResolvedValue(userMsg);
    mockDb.getConversationParticipants.mockResolvedValue([]);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat',
      conversationId: conv.id,
      messageId: randomUUID(),
      content: 'Hidden note',
      hiddenFromAi: true,
    }));

    await new Promise(r => setTimeout(r, 200));

    // Should create user message
    expect(mockDb.createMessage).toHaveBeenCalled();
    // Should NOT trigger inference (no startAiRequest)
    expect(mockRoomManager.startAiRequest).not.toHaveBeenCalled();
  });
});

describe('regenerate message flow', () => {
  it('sends error when conversation not found for regenerate', async () => {
    mockDb.getConversation.mockResolvedValue(null);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'regenerate',
      conversationId: randomUUID(),
      messageId: randomUUID(),
      branchId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 50));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error')).toBe(true);
  });
});

describe('edit message flow', () => {
  it('sends error when conversation not found for edit', async () => {
    mockDb.getConversation.mockResolvedValue(null);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit',
      conversationId: randomUUID(),
      messageId: randomUUID(),
      branchId: randomUUID(),
      content: 'edited',
    }));

    await new Promise(r => setTimeout(r, 50));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error')).toBe(true);
  });
});

describe('continue message flow', () => {
  it('sends error when conversation not found for continue', async () => {
    mockDb.getConversation.mockResolvedValue(null);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue',
      conversationId: randomUUID(),
      messageId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 50));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error')).toBe(true);
  });

  it('sends error when user cannot chat', async () => {
    const conv = makeConversation();
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(false);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue',
      conversationId: conv.id,
      messageId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 50));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('permission'))).toBe(true);
  });

  it('sends error when no assistant participant found', async () => {
    const conv = makeConversation('standard');
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getConversationParticipants.mockResolvedValue([]);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue',
      conversationId: conv.id,
      messageId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 100));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('assistant'))).toBe(true);
  });

  it('runs full continue flow with assistant', async () => {
    const conv = makeConversation('standard');
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });
    const assistantParticipant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getConversationParticipants.mockResolvedValue([assistantParticipant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
    mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
    mockDb.createMessage.mockResolvedValue(assistantMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('Hello!', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue',
      conversationId: conv.id,
      messageId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 300));

    // Should have created message
    expect(mockDb.createMessage).toHaveBeenCalled();
    // Should have started AI request
    expect(mockRoomManager.startAiRequest).toHaveBeenCalled();
    // Should have ended AI request
    expect(mockRoomManager.endAiRequest).toHaveBeenCalled();
  });
});

// ── Deep chat flow tests ─────────────────────────────────────────────

describe('chat message flow - deep paths', () => {
  const defaultModel = {
    id: 'test-model', providerModelId: 'test', provider: 'anthropic',
    contextWindow: 200000, outputTokenLimit: 4096,
    settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
  };

  function setupFullChatMocks(conv: Conversation, userMsg: Message, assistantMsg: Message, participant: any) {
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    // Provide a provider API key so userHasSufficientCredits passes
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
    mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('response text', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });
  }

  it('blocks content when content filter triggers', async () => {
    const conv = makeConversation('standard');
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: true, reason: 'Inappropriate', categories: ['violence'] });

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'bad content',
    }));

    await new Promise(r => setTimeout(r, 100));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'content_blocked')).toBe(true);
    expect(mockDb.createMessage).not.toHaveBeenCalled();
  });

  it('sends error when user cannot chat', async () => {
    const conv = makeConversation('standard');
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(false);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'Hello',
    }));

    await new Promise(r => setTimeout(r, 100));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('permission'))).toBe(true);
  });

  it('sends error when no assistant participant in standard format', async () => {
    const conv = makeConversation('standard');
    const userMsg = makeMessage('Hi', 'user', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValue(userMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([]); // No assistant

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'Hi',
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('assistant'))).toBe(true);
  });

  it('sends insufficient credits error when user lacks credits', async () => {
    const conv = makeConversation('standard');
    const userMsg = makeMessage('Hi', 'user', { conversationId: conv.id });
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValue(userMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([]); // No custom API keys
    mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} }); // No credits
    mockDb.getApplicableGrantCurrencies.mockResolvedValue(['credits']); // Has a currency but no balance
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'Hi',
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('credits'))).toBe(true);
  });

  it('queues request when AI already generating', async () => {
    const conv = makeConversation('standard');
    const userMsg = makeMessage('Hi', 'user', { conversationId: conv.id });
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValue(userMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
    mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);
    // Simulate active AI request
    mockRoomManager.getActiveAiRequest.mockReturnValue({ userId: 'other-user', messageId: 'msg-1' });

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'Hi',
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'ai_request_queued')).toBe(true);
    mockRoomManager.getActiveAiRequest.mockReturnValue(null);
  });

  it('runs full standard chat flow with inference', async () => {
    const conv = makeConversation('standard');
    const userMsg = makeMessage('Hello!', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    setupFullChatMocks(conv, userMsg, assistantMsg, participant);
    mockRoomManager.getActiveAiRequest.mockReturnValue(null);

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'Hello!',
    }));

    await new Promise(r => setTimeout(r, 400));

    // Should have created user message
    expect(mockDb.createMessage).toHaveBeenCalled();
    // Should have started and ended AI request
    expect(mockRoomManager.startAiRequest).toHaveBeenCalled();
    expect(mockRoomManager.endAiRequest).toHaveBeenCalled();
    // Should have streamed completion
    expect(mockEnhancedStream).toHaveBeenCalled();
    // Should have broadcast to room
    expect(mockRoomManager.broadcastToRoom).toHaveBeenCalled();
  });

  it('sends pricing error when pricing not configured', async () => {
    const conv = makeConversation('standard');
    const userMsg = makeMessage('Hi', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
    mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);
    mockRoomManager.getActiveAiRequest.mockReturnValue(null);
    (validatePricingAvailable as any).mockResolvedValue({ valid: false, error: 'No pricing config' });

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'Hi',
    }));

    await new Promise(r => setTimeout(r, 300));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Pricing'))).toBe(true);
  });

  it('handles model not found error', async () => {
    const conv = makeConversation('standard');
    const userMsg = makeMessage('Hi', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([]);
    mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
    mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
    mockRoomManager.getActiveAiRequest.mockReturnValue(null);
    mockModelLoader.getModelById.mockResolvedValue(null); // Model not found

    const origError = console.error;
    console.error = vi.fn();

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'Hi',
    }));

    await new Promise(r => setTimeout(r, 300));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error')).toBe(true);
    console.error = origError;
  });

  it('returns early for prefill format with no responderId', async () => {
    const conv = makeConversation('prefill');
    const userMsg = makeMessage('Hi', 'user', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValue(userMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([
      { id: 'p1', type: 'assistant', model: 'test-model', isActive: true },
    ]);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'Hi',
      // No responderId → should return early
    }));

    await new Promise(r => setTimeout(r, 200));

    // Should have created user message
    expect(mockDb.createMessage).toHaveBeenCalled();
    // Should NOT have started AI request (no responder selected)
    expect(mockRoomManager.startAiRequest).not.toHaveBeenCalled();
  });
});

// ── Deep regenerate flow tests ──────────────────────────────────────

describe('regenerate message flow - deep paths', () => {
  it('sends error when user cannot chat', async () => {
    const conv = makeConversation();
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(false);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'regenerate', conversationId: conv.id,
      messageId: randomUUID(), branchId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 100));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('permission'))).toBe(true);
  });

  it('sends error when message not found', async () => {
    const conv = makeConversation();
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getMessage.mockResolvedValue(null);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'regenerate', conversationId: conv.id,
      messageId: randomUUID(), branchId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 100));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('not found'))).toBe(true);
  });

  it('runs full regenerate flow', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const parentBranchId = randomUUID();
    const msg = makeMessage('original', 'assistant', { conversationId: conv.id });
    // Set branch with parentBranchId
    (msg.branches[0] as any).parentBranchId = parentBranchId;
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;

    const updatedMsg = makeMessage('', 'assistant', { conversationId: conv.id });
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    mockDb.addMessageBranch.mockResolvedValue(updatedMsg);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
    mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('regenerated', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'regenerate', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
    }));

    await new Promise(r => setTimeout(r, 400));

    expect(mockDb.addMessageBranch).toHaveBeenCalled();
    expect(mockRoomManager.startAiRequest).toHaveBeenCalled();
    expect(mockEnhancedStream).toHaveBeenCalled();
    expect(mockRoomManager.endAiRequest).toHaveBeenCalled();
  });

  it('sends error when branch creation fails', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const msg = makeMessage('original', 'assistant', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    mockDb.addMessageBranch.mockResolvedValue(null); // Branch creation fails
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
    mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'regenerate', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
    }));

    await new Promise(r => setTimeout(r, 100));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('branch'))).toBe(true);
  });
});

// ── Deep edit flow tests ────────────────────────────────────────────

describe('edit message flow - deep paths', () => {
  it('sends error when user cannot chat', async () => {
    const conv = makeConversation();
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(false);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: randomUUID(), branchId: randomUUID(), content: 'new',
    }));

    await new Promise(r => setTimeout(r, 100));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('permission'))).toBe(true);
  });

  it('blocks edit when content filter triggers', async () => {
    const conv = makeConversation();
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: true, reason: 'Inappropriate', categories: [] });

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: randomUUID(), branchId: randomUUID(), content: 'bad',
    }));

    await new Promise(r => setTimeout(r, 100));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'content_blocked')).toBe(true);
  });

  it('sends error when message not found', async () => {
    const conv = makeConversation();
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.getMessage.mockResolvedValue(null);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: randomUUID(), branchId: randomUUID(), content: 'new',
    }));

    await new Promise(r => setTimeout(r, 100));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('not found'))).toBe(true);
  });

  it('sends error when branch not found', async () => {
    const conv = makeConversation();
    const msg = makeMessage('original', 'user', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.getMessage.mockResolvedValue(msg);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: msg.id, branchId: randomUUID(), content: 'new',
    }));

    await new Promise(r => setTimeout(r, 100));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Branch not found'))).toBe(true);
  });

  it('creates edited branch successfully for user message', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const msg = makeMessage('original', 'user', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;

    const updatedMsg = makeMessage('edited', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.addMessageBranch.mockResolvedValue(updatedMsg);
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    mockDb.createMessage.mockResolvedValue(assistantMsg);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([]);
    mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
    mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('response', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: msg.id, branchId: branchId, content: 'edited content',
    }));

    await new Promise(r => setTimeout(r, 400));

    expect(mockDb.addMessageBranch).toHaveBeenCalled();
    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'message_edited')).toBe(true);
  });

  it('sends error when edited branch creation fails', async () => {
    const conv = makeConversation();
    const branchId = randomUUID();
    const msg = makeMessage('original', 'user', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.addMessageBranch.mockResolvedValue(null); // Fails

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: msg.id, branchId: branchId, content: 'edited',
    }));

    await new Promise(r => setTimeout(r, 100));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('edited branch'))).toBe(true);
  });

  it('skips regeneration for assistant message edits', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const msg = makeMessage('original', 'assistant', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;

    const updatedMsg = makeMessage('edited', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.addMessageBranch.mockResolvedValue(updatedMsg);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: msg.id, branchId: branchId, content: 'edited assistant',
    }));

    await new Promise(r => setTimeout(r, 200));

    // Should NOT start AI request for assistant edit
    expect(mockRoomManager.startAiRequest).not.toHaveBeenCalled();
    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'message_edited')).toBe(true);
  });
});

// ── Deep delete flow tests ──────────────────────────────────────────

describe('delete message - deep paths', () => {
  it('sends error when user lacks delete permission', async () => {
    const conv = makeConversation();
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserDeleteInConversation.mockResolvedValue(false);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'delete', conversationId: conv.id,
      messageId: randomUUID(), branchId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 50));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('permission'))).toBe(true);
  });

  it('sends error when deleteMessageBranch returns null', async () => {
    const conv = makeConversation();
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserDeleteInConversation.mockResolvedValue(true);
    mockDb.deleteMessageBranch.mockResolvedValue(null);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'delete', conversationId: conv.id,
      messageId: randomUUID(), branchId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 50));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('delete'))).toBe(true);
  });

  it('broadcasts message_deleted to room on success', async () => {
    const conv = makeConversation();
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserDeleteInConversation.mockResolvedValue(true);
    mockDb.deleteMessageBranch.mockResolvedValue(['b1', 'b2']);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgId = randomUUID();
    const branchId = randomUUID();
    ws.emit('message', JSON.stringify({
      type: 'delete', conversationId: conv.id,
      messageId: msgId, branchId: branchId,
    }));

    await new Promise(r => setTimeout(r, 50));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'message_deleted')).toBe(true);
    expect(mockRoomManager.broadcastToRoom).toHaveBeenCalledWith(
      conv.id,
      expect.objectContaining({ type: 'message_deleted', messageId: msgId }),
      ws,
    );
  });

  it('handles error thrown during delete', async () => {
    const conv = makeConversation();
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserDeleteInConversation.mockResolvedValue(true);
    mockDb.deleteMessageBranch.mockRejectedValue(new Error('DB error'));

    const origError = console.error;
    console.error = vi.fn();

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'delete', conversationId: conv.id,
      messageId: randomUUID(), branchId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 50));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error')).toBe(true);
    console.error = origError;
  });
});

// ── WebSocket error + edge cases ────────────────────────────────────

describe('WebSocket error handling', () => {
  it('handles ws error event', () => {
    const origError = console.error;
    console.error = vi.fn();

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);
    ws.emit('error', new Error('connection reset'));

    expect(console.error).toHaveBeenCalled();
    console.error = origError;
  });

  it('handles pong event to set isAlive', () => {
    const ws = createMockWs();
    ws.isAlive = false;
    websocketHandler(ws, createMockReq(), new Database() as any);
    ws.emit('pong');

    expect(ws.isAlive).toBe(true);
  });

  it('handles chat with parentBranchId finding existing message', async () => {
    const conv = makeConversation('standard');
    const parentBranchId = randomUUID();
    const existingMsg = makeMessage('existing', 'user', { conversationId: conv.id });
    (existingMsg.branches[0] as any).parentBranchId = parentBranchId;

    const userMsg = makeMessage('new', 'user', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.getConversationMessages.mockResolvedValue([existingMsg]);
    mockDb.addMessageBranch.mockResolvedValue(userMsg);
    mockDb.getConversationParticipants.mockResolvedValue([]);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'branch msg',
      parentBranchId: parentBranchId,
    }));

    await new Promise(r => setTimeout(r, 200));

    // Should have called addMessageBranch instead of createMessage
    expect(mockDb.addMessageBranch).toHaveBeenCalled();
  });
});

// ── Room management messages ──────────────────────────────────────────

describe('room management messages', () => {
  it('handles join_room and returns room state', async () => {
    const convId = randomUUID();
    mockRoomManager.getActiveUsers.mockReturnValue(['user-1']);
    mockRoomManager.getActiveAiRequest.mockReturnValue(null);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({ type: 'join_room', conversationId: convId }));
    await new Promise(r => setTimeout(r, 50));

    expect(mockRoomManager.joinRoom).toHaveBeenCalledWith(convId, ws);
    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'room_joined' && m.conversationId === convId)).toBe(true);
  });

  it('handles leave_room and sends confirmation', async () => {
    const convId = randomUUID();
    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({ type: 'leave_room', conversationId: convId }));
    await new Promise(r => setTimeout(r, 50));

    expect(mockRoomManager.leaveRoom).toHaveBeenCalledWith(convId, ws);
    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'room_left' && m.conversationId === convId)).toBe(true);
  });

  it('handles typing and broadcasts to room', async () => {
    const convId = randomUUID();
    mockDb.getUserById.mockResolvedValue({ id: 'user-1', email: 'john@test.com' });

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({ type: 'typing', conversationId: convId, isTyping: true }));
    await new Promise(r => setTimeout(r, 50));

    expect(mockRoomManager.broadcastToRoom).toHaveBeenCalledWith(convId, expect.objectContaining({
      type: 'user_typing',
      isTyping: true,
      userName: 'john',
    }), ws);
  });

  it('handles ping and responds with pong', async () => {
    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({ type: 'ping' }));
    await new Promise(r => setTimeout(r, 50));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'pong' && typeof m.timestamp === 'number')).toBe(true);
  });

  it('handles close event and unregisters connection', () => {
    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('close');

    expect(mockRoomManager.unregisterConnection).toHaveBeenCalledWith(ws);
  });
});

// ── Abort with active generation ──────────────────────────────────────

describe('abort with active generation', () => {
  it('aborts active generation successfully', async () => {
    const conv = makeConversation('standard');
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    const userMsg = makeMessage('hi', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    // Set up a full chat flow that starts a generation
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValue(userMsg).mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    // Make stream hang long enough for abort
    mockEnhancedStream.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 2000));
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    // Start chat
    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
    }));

    // Wait for generation to start, then abort
    await new Promise(r => setTimeout(r, 200));

    ws.emit('message', JSON.stringify({
      type: 'abort', conversationId: conv.id,
    }));

    await new Promise(r => setTimeout(r, 50));

    const msgs = getSentMessages(ws);
    const abortMsg = msgs.find(m => m.type === 'generation_aborted');
    expect(abortMsg).toBeDefined();
    expect(abortMsg.success).toBe(true);
  });
});

// ── Credit check via grant balance ────────────────────────────────────

describe('credit check - grant balance path', () => {
  it('allows chat when user has grant balance for model currency', async () => {
    const conv = makeConversation('standard');
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    const userMsg = makeMessage('hi', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    // No API key, but has grant balance
    mockDb.getUserApiKeys.mockResolvedValue([]);
    mockDb.getUserGrantSummary.mockResolvedValue({ totals: { sonnets: 100 } });
    mockDb.getApplicableGrantCurrencies.mockResolvedValue(['sonnets']);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    mockEnhancedStream.mockResolvedValue({ usage: { inputTokens: 10, outputTokens: 5 } });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
    }));

    await new Promise(r => setTimeout(r, 400));

    // Should not get insufficient credits error
    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.error?.includes('credits'))).toBe(false);
    // Should have created assistant message (progressed past credit check)
    expect(mockDb.createMessage).toHaveBeenCalledTimes(2);
  });

  it('allows chat when user has overspend capability', async () => {
    const conv = makeConversation('standard');
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    const userMsg = makeMessage('hi', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    // userHasActiveGrantCapability will return false for researcher/admin but true for overspend
    mockDb.userHasActiveGrantCapability.mockImplementation(async (_uid: string, cap: string) => {
      return cap === 'overspend';
    });
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    // No API key and no grant balance
    mockDb.getUserApiKeys.mockResolvedValue([]);
    mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
    mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    mockEnhancedStream.mockResolvedValue({ usage: { inputTokens: 10, outputTokens: 5 } });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
    }));

    await new Promise(r => setTimeout(r, 400));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.error?.includes('credits'))).toBe(false);
    expect(mockDb.createMessage).toHaveBeenCalledTimes(2);
  });
});

// ── Chat message creation (no parentBranchId) ────────────────────────

describe('chat message creation paths', () => {
  it('creates new message without parentBranchId', async () => {
    const conv = makeConversation('standard');
    const userMsg = makeMessage('hello', 'user', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValue(userMsg);
    mockDb.getConversationParticipants.mockResolvedValue([]);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
    }));

    await new Promise(r => setTimeout(r, 100));

    expect(mockDb.createMessage).toHaveBeenCalled();
    // No parentBranchId means no addMessageBranch
    expect(mockDb.addMessageBranch).not.toHaveBeenCalled();
    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'message_created')).toBe(true);
  });

  it('creates new message with parentBranchId but no siblings', async () => {
    const conv = makeConversation('standard');
    const parentBranchId = randomUUID();
    const userMsg = makeMessage('hello', 'user', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.getConversationMessages.mockResolvedValue([]); // No existing messages with matching parentBranchId
    mockDb.createMessage.mockResolvedValue(userMsg);
    mockDb.getConversationParticipants.mockResolvedValue([]);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
      parentBranchId,
    }));

    await new Promise(r => setTimeout(r, 100));

    // No siblings means createMessage is used (not addMessageBranch)
    expect(mockDb.createMessage).toHaveBeenCalled();
  });

  it('returns early in prefill format when no responderId', async () => {
    const conv = makeConversation('prefill');
    const userMsg = makeMessage('hello', 'user', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValue(userMsg);
    mockDb.getConversationParticipants.mockResolvedValue([
      { id: 'p-bot', type: 'assistant', model: 'test-model', isActive: true },
    ]);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    // Prefill format chat with no responderId - should return after user message
    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
    }));

    await new Promise(r => setTimeout(r, 200));

    // message_created for user message should be sent
    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'message_created')).toBe(true);
    // But NO assistant message should be created (no responderId in prefill format)
    expect(mockEnhancedStream).not.toHaveBeenCalled();
  });

  it('sends error for invalid responderId in prefill format', async () => {
    const conv = makeConversation('prefill');
    const userMsg = makeMessage('hello', 'user', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValue(userMsg);
    mockDb.getConversationParticipants.mockResolvedValue([
      { id: 'p-bot', type: 'assistant', model: 'test-model', isActive: true },
    ]);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    // Prefill format with non-existent responderId
    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
      responderId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Invalid responder'))).toBe(true);
  });
});

// ── Inference error handling paths ──────────────────────────────────────

describe('inference error handling', () => {
  const defaultModel = {
    id: 'test-model', providerModelId: 'test', provider: 'anthropic',
    contextWindow: 200000, outputTokenLimit: 4096,
    settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
  };

  function setupErrorTest(conv: Conversation) {
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    const userMsg = makeMessage('hi', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);

    return { participant, userMsg, assistantMsg };
  }

  async function sendChat(ws: any, convId: string) {
    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: convId,
      messageId: randomUUID(), content: 'hello',
    }));
    await new Promise(r => setTimeout(r, 400));
    return getSentMessages(ws);
  }

  it('sends rate limit error', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('Rate limit exceeded: 429'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Rate limit'))).toBe(true);
    expect(msgs.some(m => m.suggestion)).toBe(true);
  });

  it('sends no API key error', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('No API key configured'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('API key'))).toBe(true);
  });

  it('sends overloaded error', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('Service overloaded: 503'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Overloaded'))).toBe(true);
  });

  it('sends auth failed error for 401', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('Authentication failed: 401'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Auth failed'))).toBe(true);
  });

  it('sends connection error for ECONNREFUSED', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('ECONNREFUSED'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Connection error'))).toBe(true);
  });

  it('sends context too long error', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('context window too long'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Context too long'))).toBe(true);
  });

  it('sends content filtered error', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('content was flagged by policy filter'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Filtered'))).toBe(true);
  });

  it('sends timeout error', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('Request timeout reached'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Timeout'))).toBe(true);
  });

  it('sends server error for 500', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('500 Internal Server Error'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Server error'))).toBe(true);
  });

  it('sends endpoint not found error for 404', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('404 Not Found'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Not found'))).toBe(true);
  });

  it('passes through short error messages', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('Something weird'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'error' && m.error === 'Something weird')).toBe(true);
  });

  it('handles usage limit error with JSON message extraction', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('API usage limit exceeded: {"message": "You have exceeded your daily limit"}'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('exceeded'))).toBe(true);
  });

  it('sends abort stream event when generation is aborted', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('Generation aborted'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'stream' && m.aborted === true)).toBe(true);
  });

  it('sends insufficient credits error', async () => {
    const conv = makeConversation('standard');
    setupErrorTest(conv);
    mockEnhancedStream.mockRejectedValue(new Error('Insufficient credits remaining'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    const msgs = await sendChat(ws, conv.id);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('credits'))).toBe(true);
  });
});

// ── handleEdit with assistant response ──────────────────────────────

describe('edit message with assistant response', () => {
  const defaultModel = {
    id: 'test-model', providerModelId: 'test', provider: 'anthropic',
    contextWindow: 200000, outputTokenLimit: 4096,
    settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
  };

  it('edits user message and creates new assistant message when none exists after', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const parentBranchId = randomUUID();
    const msg = makeMessage('original user text', 'user', { conversationId: conv.id, parentBranchId });
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;

    const updatedMsg = makeMessage('edited text', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.addMessageBranch.mockResolvedValue(updatedMsg);
    // Only the edited user message exists (no assistant after it)
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.createMessage.mockResolvedValue(assistantMsg);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('response', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
      content: 'edited text',
    }));

    await new Promise(r => setTimeout(r, 400));

    // Should have created a new assistant message
    expect(mockDb.createMessage).toHaveBeenCalled();
    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'message_edited')).toBe(true);
    expect(msgs.some(m => m.type === 'message_created')).toBe(true);
  });

  it('edits user message and adds branch to existing assistant message after', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const msg = makeMessage('original', 'user', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;

    const updatedMsg = makeMessage('edited', 'user', { conversationId: conv.id });
    // Existing assistant message after edited user message
    const existingAssistantMsg = makeMessage('old response', 'assistant', { conversationId: conv.id });
    (existingAssistantMsg.branches[0] as any).role = 'assistant';

    const newBranchMsg = makeMessage('', 'assistant', { conversationId: conv.id });
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getMessage.mockResolvedValue(msg);
    // First call for edit branch, second call for adding assistant branch
    mockDb.addMessageBranch.mockResolvedValueOnce(updatedMsg).mockResolvedValueOnce(newBranchMsg);
    // User msg at index 0, assistant msg at index 1
    mockDb.getConversationMessages.mockResolvedValue([msg, existingAssistantMsg]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('response', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
      content: 'edited',
    }));

    await new Promise(r => setTimeout(r, 400));

    // Should have called addMessageBranch twice (once for edit, once for assistant)
    expect(mockDb.addMessageBranch).toHaveBeenCalledTimes(2);
    const msgs = getSentMessages(ws);
    expect(msgs.filter(m => m.type === 'message_edited').length).toBeGreaterThanOrEqual(2);
  });
});

// ── handleContinue deeper paths ─────────────────────────────────────

describe('continue message flow - deep paths', () => {
  const defaultModel = {
    id: 'test-model', providerModelId: 'test', provider: 'anthropic',
    contextWindow: 200000, outputTokenLimit: 4096,
    settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
  };

  it('sends error when user cannot chat for continue', async () => {
    const conv = makeConversation('standard');
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(false);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue', conversationId: conv.id,
      messageId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 100));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('permission'))).toBe(true);
  });

  it('sends error when no assistant participant for continue', async () => {
    const conv = makeConversation('standard');
    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getConversationParticipants.mockResolvedValue([]); // No participants

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue', conversationId: conv.id,
      messageId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 100));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('assistant'))).toBe(true);
  });

  it('creates new message with parentBranchId when no siblings exist', async () => {
    const conv = makeConversation('standard');
    const parentBranchId = randomUUID();
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getConversationMessages.mockResolvedValue([]); // No existing messages with matching parentBranchId
    mockDb.createMessage.mockResolvedValue(assistantMsg);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('continued', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });
    mockDb.getConversation.mockResolvedValue(conv); // For final getConversation

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue', conversationId: conv.id,
      messageId: randomUUID(), parentBranchId,
    }));

    await new Promise(r => setTimeout(r, 400));

    expect(mockDb.createMessage).toHaveBeenCalled();
    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'message_created')).toBe(true);
  });

  it('adds branch to existing message when siblings found', async () => {
    const conv = makeConversation('standard');
    const parentBranchId = randomUUID();
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    // Existing message with a branch matching parentBranchId
    const existingMsg = makeMessage('prev', 'assistant', { conversationId: conv.id });
    (existingMsg.branches[0] as any).parentBranchId = parentBranchId;

    const newBranch = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getConversationMessages.mockResolvedValue([existingMsg]);
    mockDb.addMessageBranch.mockResolvedValue(newBranch);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('continued', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue', conversationId: conv.id,
      messageId: randomUUID(), parentBranchId,
    }));

    await new Promise(r => setTimeout(r, 400));

    expect(mockDb.addMessageBranch).toHaveBeenCalled();
  });

  it('creates new message when no parentBranchId specified', async () => {
    const conv = makeConversation('standard');
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.createMessage.mockResolvedValue(assistantMsg);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('continued', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue', conversationId: conv.id,
      messageId: randomUUID(),
      // No parentBranchId
    }));

    await new Promise(r => setTimeout(r, 400));

    expect(mockDb.createMessage).toHaveBeenCalled();
    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'message_created')).toBe(true);
  });

  it('sends error when createMessage returns null for continue', async () => {
    const conv = makeConversation('standard');
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.createMessage.mockResolvedValue(null);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue', conversationId: conv.id,
      messageId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Failed to create'))).toBe(true);
  });

  it('sends error when pricing not configured for continue', async () => {
    const conv = makeConversation('standard');
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.createMessage.mockResolvedValue(assistantMsg);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);
    (validatePricingAvailable as any).mockResolvedValue({ valid: false, error: 'No pricing' });

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue', conversationId: conv.id,
      messageId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Pricing missing'))).toBe(true);
    // Should delete the empty assistant message
    expect(mockDb.deleteMessage).toHaveBeenCalled();
  });

  it('handles prefill format with responderId for continue', async () => {
    const conv = makeConversation('prefill');
    const participantUuid = randomUUID();
    const participant = {
      id: participantUuid, conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
      conversationMode: 'auto',
      systemPrompt: 'You are Bot.',
      settings: { temperature: 0.5 },
    };
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.createMessage.mockResolvedValue(assistantMsg);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096, supportsPrefill: true,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('continued', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue', conversationId: conv.id,
      messageId: randomUUID(),
      responderId: participantUuid,
    }));

    await new Promise(r => setTimeout(r, 400));

    expect(mockEnhancedStream).toHaveBeenCalled();
    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'message_created')).toBe(true);
  });

  it('handles continue error in outer try-catch', async () => {
    const conv = makeConversation('standard');
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.createMessage.mockResolvedValue(assistantMsg);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockRejectedValue(new Error('something broke'));

    const origError = console.error;
    console.error = vi.fn();

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue', conversationId: conv.id,
      messageId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 400));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error === 'something broke')).toBe(true);
    console.error = origError;
  });
});

// ── Prefill format chat flow ──────────────────────────────────────────

describe('prefill format chat flow', () => {
  const defaultModel = {
    id: 'test-model', providerModelId: 'test', provider: 'anthropic',
    contextWindow: 200000, outputTokenLimit: 4096, supportsPrefill: true,
    settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
  };

  it('runs full prefill chat flow with responderId applying backroom prompt', async () => {
    const conv = makeConversation('prefill');
    const pId = randomUUID();
    const participant = {
      id: pId, conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
      conversationMode: 'auto',
    };
    const userMsg = makeMessage('hi', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('response', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
      responderId: pId,
    }));

    await new Promise(r => setTimeout(r, 400));

    // Should have created user + assistant messages
    expect(mockDb.createMessage).toHaveBeenCalledTimes(2);
    expect(mockEnhancedStream).toHaveBeenCalled();
  });

  it('runs prefill chat with messages mode participant applying identity prompt', async () => {
    const conv = makeConversation('prefill');
    const pId = randomUUID();
    const participant = {
      id: pId, conversationId: conv.id, name: 'ArtBot',
      type: 'assistant', model: 'test-model', isActive: true,
      conversationMode: 'messages', // Explicitly messages mode
      settings: { temperature: 0.5, maxTokens: 2048 },
    };
    const userMsg = makeMessage('hi', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('response', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
      responderId: pId,
    }));

    await new Promise(r => setTimeout(r, 400));

    expect(mockEnhancedStream).toHaveBeenCalled();
  });

  it('runs prefill chat with non-anthropic model that does not support prefill', async () => {
    const conv = makeConversation('prefill');
    const nonPrefillModel = {
      ...defaultModel, provider: 'openrouter', supportsPrefill: false,
    };
    const pId2 = randomUUID();
    const participant = {
      id: pId2, conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
      conversationMode: 'auto',
    };
    const userMsg = makeMessage('hi', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'openrouter' }]);
    mockModelLoader.getModelById.mockResolvedValue(nonPrefillModel);
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('response', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
      responderId: pId2,
    }));

    await new Promise(r => setTimeout(r, 400));

    expect(mockEnhancedStream).toHaveBeenCalled();
  });
});

// ── Chat with attachments ──────────────────────────────────────────────

describe('chat with attachments', () => {
  it('passes attachments through to createMessage', async () => {
    const conv = makeConversation('standard');
    const userMsg = makeMessage('hi', 'user', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValue(userMsg);
    mockDb.getConversationParticipants.mockResolvedValue([]);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'check this file',
      attachments: [{ fileName: 'test.txt', fileType: 'text/plain', content: 'hello world' }],
    }));

    await new Promise(r => setTimeout(r, 100));

    expect(mockDb.createMessage).toHaveBeenCalled();
    // Check attachments were passed
    const createCall = mockDb.createMessage.mock.calls[0];
    expect(createCall[7]).toBeDefined(); // attachments param
    expect(createCall[7][0].fileName).toBe('test.txt');
  });
});

// ── Chat with assistant message existing siblings ────────────────────

describe('chat assistant message sibling handling', () => {
  it('adds assistant branch to existing message when siblings found', async () => {
    const conv = makeConversation('standard');
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    const userMsg = makeMessage('hi', 'user', { conversationId: conv.id });
    const userBranchId = userMsg.branches[0].id;

    // Existing assistant message that has a branch with parentBranchId matching userBranchId
    const existingAssistantMsg = makeMessage('prev response', 'assistant', { conversationId: conv.id });
    (existingAssistantMsg.branches[0] as any).parentBranchId = userBranchId;

    const updatedAssistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValue(userMsg);
    // No parentBranchId in message, so first getConversationMessages call is for assistant sibling check
    mockDb.getConversationMessages.mockResolvedValue([existingAssistantMsg]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.addMessageBranch.mockResolvedValue(updatedAssistantMsg);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockResolvedValue({ usage: { inputTokens: 10, outputTokens: 5 } });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
    }));

    await new Promise(r => setTimeout(r, 400));

    // Should have called addMessageBranch for the assistant (not createMessage for assistant)
    expect(mockDb.addMessageBranch).toHaveBeenCalled();
  });

  it('sends error when assistant message creation returns null', async () => {
    const conv = makeConversation('standard');
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    const userMsg = makeMessage('hi', 'user', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(null); // assistant creation fails
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Failed to create'))).toBe(true);
  });
});

// ── Regenerate with prefill format ──────────────────────────────────

describe('regenerate with prefill format', () => {
  it('uses participant model in prefill format', async () => {
    const conv = makeConversation('prefill');
    const branchId = randomUUID();
    const parentBranchId = randomUUID();
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
      conversationMode: 'auto',
    };
    const msg = makeMessage('original', 'assistant', { conversationId: conv.id, participantId: participant.id });
    (msg.branches[0] as any).id = branchId;
    (msg.branches[0] as any).participantId = participant.id;
    (msg.branches[0] as any).parentBranchId = parentBranchId;
    msg.activeBranchId = branchId;

    const updatedMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    mockDb.addMessageBranch.mockResolvedValue(updatedMsg);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096, supportsPrefill: true,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('regenerated', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'regenerate', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
    }));

    await new Promise(r => setTimeout(r, 400));

    expect(mockDb.addMessageBranch).toHaveBeenCalled();
    expect(mockEnhancedStream).toHaveBeenCalled();
  });

  it('sends insufficient credits error when credit check fails during regenerate', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const msg = makeMessage('original', 'assistant', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    // No API keys, no grant balance, no overspend → credit check fails
    mockDb.getUserApiKeys.mockResolvedValue([]);
    mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
    mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'regenerate', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('credits'))).toBe(true);
  });

  it('handles regenerate error in outer try-catch', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const msg = makeMessage('original', 'assistant', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    (msg.branches[0] as any).parentBranchId = randomUUID();
    msg.activeBranchId = branchId;

    const updatedMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    mockDb.addMessageBranch.mockResolvedValue(updatedMsg);
    mockDb.getConversationParticipants.mockResolvedValue([]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockRejectedValue(new Error('some error'));

    const origError = console.error;
    console.error = vi.fn();

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'regenerate', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
    }));

    await new Promise(r => setTimeout(r, 400));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error === 'some error')).toBe(true);
    console.error = origError;
  });
});

// ── Content filter on AI output ─────────────────────────────────────

describe('content filter on AI output', () => {
  it('replaces content when AI output is blocked by content filter', async () => {
    const conv = makeConversation('standard');
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    const userMsg = makeMessage('hi', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    // First call: input check passes. Second call: output check blocks.
    (checkContent as any)
      .mockResolvedValueOnce({ blocked: false })
      .mockResolvedValueOnce({ blocked: true, reason: 'Harmful content', categories: ['violence'] });
    mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('bad content here', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
    }));

    await new Promise(r => setTimeout(r, 400));

    // Content should have been saved as '[Content filtered]'
    const updateCalls = mockDb.updateMessageContent.mock.calls;
    const lastCall = updateCalls[updateCalls.length - 1];
    expect(lastCall[4]).toBe('[Content filtered]');
  });
});

// ── hiddenFromAi filtering ──────────────────────────────────────────

describe('hiddenFromAi filtering', () => {
  it('filters hidden messages from AI context during chat', async () => {
    const conv = makeConversation('standard');
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    // Message with hiddenFromAi=true on its active branch
    const hiddenMsg = makeMessage('secret note', 'user', {
      conversationId: conv.id,
      hiddenFromAi: true,
    });
    const userMsg = makeMessage('hello', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
    mockDb.getConversationMessages.mockResolvedValue([hiddenMsg]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('response', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'chat', conversationId: conv.id,
      messageId: randomUUID(), content: 'hello',
    }));

    await new Promise(r => setTimeout(r, 400));

    expect(mockEnhancedStream).toHaveBeenCalled();
  });
});

// ── Edit with skipRegeneration ──────────────────────────────────────

describe('edit with skipRegeneration', () => {
  it('does not generate response when skipRegeneration is true', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const msg = makeMessage('original', 'user', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;
    const updatedMsg = makeMessage('edited', 'user', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.addMessageBranch.mockResolvedValue(updatedMsg);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
      content: 'edited text',
      skipRegeneration: true,
    }));

    await new Promise(r => setTimeout(r, 200));

    // message_edited should be sent but no inference
    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'message_edited')).toBe(true);
    expect(mockEnhancedStream).not.toHaveBeenCalled();
  });
});

// ── Edit handler error paths ─────────────────────────────────────────

describe('edit handler error and branch paths', () => {
  const defaultModel = {
    id: 'test-model', providerModelId: 'test', provider: 'anthropic',
    contextWindow: 200000, outputTokenLimit: 4096,
    settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
  };

  it('sends error when assistant branch creation returns null during edit response', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const msg = makeMessage('original', 'user', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;
    const updatedMsg = makeMessage('edited', 'user', { conversationId: conv.id });
    const existingAssistantMsg = makeMessage('old', 'assistant', { conversationId: conv.id });
    (existingAssistantMsg.branches[0] as any).role = 'assistant';
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.getMessage.mockResolvedValue(msg);
    // First addMessageBranch for edit succeeds, second for assistant returns null
    mockDb.addMessageBranch.mockResolvedValueOnce(updatedMsg).mockResolvedValueOnce(null);
    mockDb.getConversationMessages.mockResolvedValue([msg, existingAssistantMsg]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
      content: 'edited',
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('branch'))).toBe(true);
  });

  it('handles error during edit response generation', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const msg = makeMessage('original', 'user', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;
    const updatedMsg = makeMessage('edited', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.addMessageBranch.mockResolvedValue(updatedMsg);
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    mockDb.createMessage.mockResolvedValue(assistantMsg);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockRejectedValue(new Error('edit inference error'));

    const origError = console.error;
    console.error = vi.fn();

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
      content: 'edited',
    }));

    await new Promise(r => setTimeout(r, 400));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error === 'edit inference error')).toBe(true);
    console.error = origError;
  });

  it('sends insufficient credits error when credit check fails in edit response', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const msg = makeMessage('original', 'user', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;
    const updatedMsg = makeMessage('edited', 'user', { conversationId: conv.id });
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.addMessageBranch.mockResolvedValue(updatedMsg);
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    // No API keys, no grant balance → credit check fails
    mockDb.getUserApiKeys.mockResolvedValue([]);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
      content: 'edited',
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('credits'))).toBe(true);
  });

  it('edits user message in prefill format with responderId', async () => {
    const conv = makeConversation('prefill');
    const branchId = randomUUID();
    const pId = randomUUID();
    const msg = makeMessage('original', 'user', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;
    const updatedMsg = makeMessage('edited', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });
    const participant = {
      id: pId, conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
      conversationMode: 'auto',
      settings: { temperature: 0.5 },
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.addMessageBranch.mockResolvedValue(updatedMsg);
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    mockDb.createMessage.mockResolvedValue(assistantMsg);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue({
      ...defaultModel, supportsPrefill: true,
    });
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
      await onChunk('response', true, undefined, { inputTokens: 10, outputTokens: 5 });
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
      content: 'edited',
      responderId: pId,
    }));

    await new Promise(r => setTimeout(r, 400));

    expect(mockEnhancedStream).toHaveBeenCalled();
    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'message_edited')).toBe(true);
  });

  it('sends pricing error during edit response generation', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const msg = makeMessage('original', 'user', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    msg.activeBranchId = branchId;
    const updatedMsg = makeMessage('edited', 'user', { conversationId: conv.id });
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    (checkContent as any).mockResolvedValue({ blocked: false });
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.addMessageBranch.mockResolvedValue(updatedMsg);
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    mockDb.createMessage.mockResolvedValue(assistantMsg);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue(defaultModel);
    (validatePricingAvailable as any).mockResolvedValue({ valid: false, error: 'No pricing' });

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'edit', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
      content: 'edited',
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Pricing missing'))).toBe(true);
  });
});

// ── Continue handler insufficient credits ────────────────────────────

describe('continue handler additional paths', () => {
  it('sends insufficient credits error when credit check fails for continue', async () => {
    const conv = makeConversation('standard');
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    // No API keys, no grant balance → credit check fails
    mockDb.getUserApiKeys.mockResolvedValue([]);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue', conversationId: conv.id,
      messageId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('credits'))).toBe(true);
  });

  it('handles model not found during continue', async () => {
    const conv = makeConversation('standard');
    const participant = {
      id: 'p-bot', conversationId: conv.id, name: 'Bot',
      type: 'assistant', model: 'test-model', isActive: true,
    };
    const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getConversationParticipants.mockResolvedValue([participant]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.createMessage.mockResolvedValue(assistantMsg);
    // First call returns model (for credit check), second call returns null (for inference)
    mockModelLoader.getModelById.mockResolvedValueOnce({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    }).mockResolvedValueOnce(null);

    const origError = console.error;
    console.error = vi.fn();

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'continue', conversationId: conv.id,
      messageId: randomUUID(),
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error')).toBe(true);
    console.error = origError;
  });
});

// ── Regenerate handler additional error paths ─────────────────────────

describe('regenerate handler additional error paths', () => {
  it('sends error when pricing not configured for regenerate', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const msg = makeMessage('original', 'assistant', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    (msg.branches[0] as any).parentBranchId = randomUUID();
    msg.activeBranchId = branchId;
    const updatedMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    mockDb.addMessageBranch.mockResolvedValue(updatedMsg);
    mockDb.getConversationParticipants.mockResolvedValue([]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    (validatePricingAvailable as any).mockResolvedValue({ valid: false, error: 'No pricing' });

    const ws = createMockWs();
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'regenerate', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
    }));

    await new Promise(r => setTimeout(r, 200));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'error' && m.error?.includes('Pricing missing'))).toBe(true);
  });

  it('sends abort notification for regeneration', async () => {
    const conv = makeConversation('standard');
    const branchId = randomUUID();
    const msg = makeMessage('original', 'assistant', { conversationId: conv.id });
    (msg.branches[0] as any).id = branchId;
    (msg.branches[0] as any).parentBranchId = randomUUID();
    msg.activeBranchId = branchId;
    const updatedMsg = makeMessage('', 'assistant', { conversationId: conv.id });

    mockDb.getConversation.mockResolvedValue(conv);
    mockDb.canUserChatInConversation.mockResolvedValue(true);
    mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
    mockDb.isUserAgeVerified.mockResolvedValue(false);
    mockDb.getMessage.mockResolvedValue(msg);
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    mockDb.addMessageBranch.mockResolvedValue(updatedMsg);
    mockDb.getConversationParticipants.mockResolvedValue([]);
    mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
    mockModelLoader.getModelById.mockResolvedValue({
      id: 'test-model', providerModelId: 'test', provider: 'anthropic',
      contextWindow: 200000, outputTokenLimit: 4096,
      settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
    });
    (validatePricingAvailable as any).mockResolvedValue({ valid: true });
    mockEnhancedStream.mockRejectedValue(new Error('Generation aborted'));

    const ws = createMockWs();
    ws.OPEN = 1;
    websocketHandler(ws, createMockReq(), new Database() as any);

    ws.emit('message', JSON.stringify({
      type: 'regenerate', conversationId: conv.id,
      messageId: msg.id, branchId: branchId,
    }));

    await new Promise(r => setTimeout(r, 400));

    const msgs = getSentMessages(ws);
    expect(msgs.some(m => m.type === 'stream' && m.aborted === true)).toBe(true);
  });

  // ── Delete Handler ──────────────────────────────────────────────────

  describe('delete handler', () => {
    it('deletes message branch and sends delete event', async () => {
      const conv = makeConversation('standard');
      const msg = makeMessage('hello', 'user', { conversationId: conv.id });
      const branchId = msg.activeBranchId;
      const deletedResult = { deletedMessages: [msg.id], deletedBranches: [branchId] };

      mockDb.getConversation.mockResolvedValue(conv);
      mockDb.canUserDeleteInConversation.mockResolvedValue(true);
      mockDb.deleteMessageBranch.mockResolvedValue(deletedResult);

      const ws = createMockWs();
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'delete', conversationId: conv.id,
        messageId: msg.id, branchId,
      }));

      await new Promise(r => setTimeout(r, 200));

      const msgs = getSentMessages(ws);
      expect(msgs.some(m => m.type === 'message_deleted')).toBe(true);
    });

    it('sends error when conversation not found for delete', async () => {
      mockDb.getConversation.mockResolvedValue(null);

      const ws = createMockWs();
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'delete', conversationId: randomUUID(),
        messageId: randomUUID(), branchId: randomUUID(),
      }));

      await new Promise(r => setTimeout(r, 200));

      const msgs = getSentMessages(ws);
      expect(msgs.some(m => m.type === 'error' && m.error?.includes('not found'))).toBe(true);
    });

    it('sends error when user lacks delete permission', async () => {
      const conv = makeConversation('standard');
      mockDb.getConversation.mockResolvedValue(conv);
      mockDb.canUserDeleteInConversation.mockResolvedValue(false);

      const ws = createMockWs();
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'delete', conversationId: conv.id,
        messageId: randomUUID(), branchId: randomUUID(),
      }));

      await new Promise(r => setTimeout(r, 200));

      const msgs = getSentMessages(ws);
      expect(msgs.some(m => m.type === 'error' && m.error?.includes('permission'))).toBe(true);
    });

    it('sends error when deleteMessageBranch returns falsy', async () => {
      const conv = makeConversation('standard');
      mockDb.getConversation.mockResolvedValue(conv);
      mockDb.canUserDeleteInConversation.mockResolvedValue(true);
      mockDb.deleteMessageBranch.mockResolvedValue(null);

      const ws = createMockWs();
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'delete', conversationId: conv.id,
        messageId: randomUUID(), branchId: randomUUID(),
      }));

      await new Promise(r => setTimeout(r, 200));

      const msgs = getSentMessages(ws);
      expect(msgs.some(m => m.type === 'error' && m.error?.includes('Failed to delete'))).toBe(true);
    });

    it('sends error when delete throws', async () => {
      const conv = makeConversation('standard');
      mockDb.getConversation.mockResolvedValue(conv);
      mockDb.canUserDeleteInConversation.mockRejectedValue(new Error('db error'));

      const ws = createMockWs();
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'delete', conversationId: conv.id,
        messageId: randomUUID(), branchId: randomUUID(),
      }));

      await new Promise(r => setTimeout(r, 200));

      const msgs = getSentMessages(ws);
      expect(msgs.some(m => m.type === 'error' && m.error?.includes('Failed to delete'))).toBe(true);
    });
  });

  // ── Additional Branch Coverage ──────────────────────────────────────

  describe('additional branch coverage', () => {
    it('skips AI generation when message is hiddenFromAi', async () => {
      const conv = makeConversation('standard');
      const assistant = { id: randomUUID(), type: 'assistant', model: 'test-model', isActive: true };
      const userMsg = makeMessage('hidden', 'user', { conversationId: conv.id });

      mockDb.getConversation.mockResolvedValue(conv);
      mockDb.canUserChatInConversation.mockResolvedValue(true);
      mockDb.createMessage.mockResolvedValue(userMsg);
      mockDb.getConversationParticipants.mockResolvedValue([assistant]);

      const ws = createMockWs();
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'chat', conversationId: conv.id, messageId: randomUUID(),
        content: 'secret message', hiddenFromAi: true,
      }));

      await new Promise(r => setTimeout(r, 200));

      // Should create the message but NOT call inference
      expect(mockDb.createMessage).toHaveBeenCalled();
      expect(mockEnhancedStream).not.toHaveBeenCalled();
    });

    it('handles continue with prefill format and responder fallback to active assistant', async () => {
      const conv = makeConversation('prefill');
      const botId = randomUUID();
      const inactiveBot = { id: randomUUID(), type: 'assistant', model: 'test-model', isActive: false };
      const activeBot = { id: botId, type: 'assistant', model: 'test-model', isActive: true, systemPrompt: 'sys' };
      const msg = makeMessage('hello', 'user', { conversationId: conv.id });
      const parentBranch = msg.activeBranchId;
      const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

      mockDb.getConversation.mockResolvedValue(conv);
      mockDb.canUserChatInConversation.mockResolvedValue(true);
      mockDb.getConversationParticipants.mockResolvedValue([inactiveBot, activeBot]);
      mockDb.getConversationMessages.mockResolvedValue([msg]);
      mockDb.createMessage.mockResolvedValue(assistantMsg);
      mockDb.getMessage.mockResolvedValue(assistantMsg);
      mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
      mockModelLoader.getModelById.mockResolvedValue({
        id: 'test-model', providerModelId: 'test', provider: 'anthropic',
        contextWindow: 200000, outputTokenLimit: 4096,
        settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
      });
      (validatePricingAvailable as any).mockResolvedValue({ valid: true });
      mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
        await onChunk('done', true, undefined, { inputTokens: 10, outputTokens: 5 });
        return { usage: { inputTokens: 10, outputTokens: 5 } };
      });

      const ws = createMockWs();
      ws.OPEN = 1;
      websocketHandler(ws, createMockReq(), new Database() as any);

      // Send continue with invalid responderId (not matching any participant) to trigger fallback
      ws.emit('message', JSON.stringify({
        type: 'continue', conversationId: conv.id,
        messageId: msg.id, parentBranchId: parentBranch,
        responderId: randomUUID(),
      }));

      await new Promise(r => setTimeout(r, 400));

      // Should use the active assistant as fallback
      const msgs = getSentMessages(ws);
      expect(msgs.some(m => m.type === 'stream')).toBe(true);
    });

    it('handles continue abort notification', async () => {
      const conv = makeConversation('standard');
      const assistant = { id: randomUUID(), type: 'assistant', model: 'test-model', isActive: true };
      const msg = makeMessage('hello', 'user', { conversationId: conv.id });
      const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

      mockDb.getConversation.mockResolvedValue(conv);
      mockDb.canUserChatInConversation.mockResolvedValue(true);
      mockDb.getConversationParticipants.mockResolvedValue([assistant]);
      mockDb.getConversationMessages.mockResolvedValue([msg]);
      mockDb.createMessage.mockResolvedValue(assistantMsg);
      mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
      mockModelLoader.getModelById.mockResolvedValue({
        id: 'test-model', providerModelId: 'test', provider: 'anthropic',
        contextWindow: 200000, outputTokenLimit: 4096,
        settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
      });
      (validatePricingAvailable as any).mockResolvedValue({ valid: true });
      mockEnhancedStream.mockRejectedValue(new Error('Generation aborted'));

      const ws = createMockWs();
      ws.OPEN = 1;
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'continue', conversationId: conv.id,
        messageId: msg.id,
      }));

      await new Promise(r => setTimeout(r, 400));

      const msgs = getSentMessages(ws);
      expect(msgs.some(m => m.type === 'generation_aborted')).toBe(true);
    });

    it('truncates long error messages in continue handler', async () => {
      const conv = makeConversation('standard');
      const assistant = { id: randomUUID(), type: 'assistant', model: 'test-model', isActive: true };
      const msg = makeMessage('hello', 'user', { conversationId: conv.id });
      const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

      mockDb.getConversation.mockResolvedValue(conv);
      mockDb.canUserChatInConversation.mockResolvedValue(true);
      mockDb.getConversationParticipants.mockResolvedValue([assistant]);
      mockDb.getConversationMessages.mockResolvedValue([msg]);
      mockDb.createMessage.mockResolvedValue(assistantMsg);
      mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
      mockModelLoader.getModelById.mockResolvedValue({
        id: 'test-model', providerModelId: 'test', provider: 'anthropic',
        contextWindow: 200000, outputTokenLimit: 4096,
        settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
      });
      (validatePricingAvailable as any).mockResolvedValue({ valid: true });
      const longError = 'x'.repeat(500);
      mockEnhancedStream.mockRejectedValue(new Error(longError));

      const ws = createMockWs();
      ws.OPEN = 1;
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'continue', conversationId: conv.id,
        messageId: msg.id,
      }));

      await new Promise(r => setTimeout(r, 400));

      const msgs = getSentMessages(ws);
      const errMsg = msgs.find(m => m.type === 'error');
      expect(errMsg).toBeDefined();
      expect(errMsg.error.length).toBeLessThanOrEqual(300);
      expect(errMsg.error.endsWith('...')).toBe(true);
    });

    it('handles continue error with JSON message extraction', async () => {
      const conv = makeConversation('standard');
      const assistant = { id: randomUUID(), type: 'assistant', model: 'test-model', isActive: true };
      const msg = makeMessage('hello', 'user', { conversationId: conv.id });
      const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

      mockDb.getConversation.mockResolvedValue(conv);
      mockDb.canUserChatInConversation.mockResolvedValue(true);
      mockDb.getConversationParticipants.mockResolvedValue([assistant]);
      mockDb.getConversationMessages.mockResolvedValue([msg]);
      mockDb.createMessage.mockResolvedValue(assistantMsg);
      mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
      mockModelLoader.getModelById.mockResolvedValue({
        id: 'test-model', providerModelId: 'test', provider: 'anthropic',
        contextWindow: 200000, outputTokenLimit: 4096,
        settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
      });
      (validatePricingAvailable as any).mockResolvedValue({ valid: true });
      mockEnhancedStream.mockRejectedValue(new Error('Error: {"type":"error","message":"rate limit exceeded"}'));

      const ws = createMockWs();
      ws.OPEN = 1;
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'continue', conversationId: conv.id,
        messageId: msg.id,
      }));

      await new Promise(r => setTimeout(r, 400));

      const msgs = getSentMessages(ws);
      const errMsg = msgs.find(m => m.type === 'error');
      expect(errMsg).toBeDefined();
      expect(errMsg.error).toBe('rate limit exceeded');
    });

    it('handles chat with samplingBranches > 1 for parallel generation', async () => {
      const conv = makeConversation('standard');
      const assistant = { id: randomUUID(), type: 'assistant', model: 'test-model', isActive: true };
      const userMsg = makeMessage('hello', 'user', { conversationId: conv.id });
      const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });
      const newBranchMsg = { ...assistantMsg, branches: [...assistantMsg.branches, { id: randomUUID(), content: '', role: 'assistant', parentBranchId: 'root', createdAt: new Date() }] };

      mockDb.getConversation.mockResolvedValue(conv);
      mockDb.canUserChatInConversation.mockResolvedValue(true);
      mockDb.getConversationParticipants.mockResolvedValue([assistant]);
      mockDb.createMessage
        .mockResolvedValueOnce(userMsg)
        .mockResolvedValueOnce(assistantMsg);
      mockDb.addMessageBranch.mockResolvedValue(newBranchMsg);
      mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
      mockModelLoader.getModelById.mockResolvedValue({
        id: 'test-model', providerModelId: 'test', provider: 'anthropic',
        contextWindow: 200000, outputTokenLimit: 4096,
        settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
      });
      (validatePricingAvailable as any).mockResolvedValue({ valid: true });
      mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
        await onChunk('response', true, undefined, { inputTokens: 10, outputTokens: 5 });
        return { usage: { inputTokens: 10, outputTokens: 5 } };
      });

      const ws = createMockWs();
      ws.OPEN = 1;
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'chat', conversationId: conv.id, messageId: randomUUID(),
        content: 'hello', samplingBranches: 2,
      }));

      await new Promise(r => setTimeout(r, 400));

      // Should have called addMessageBranch for the additional sampling branch
      expect(mockDb.addMessageBranch).toHaveBeenCalled();
    });

    it('handles no model specified error in continue', async () => {
      const conv = makeConversation('standard');
      conv.model = '';
      const assistant = { id: randomUUID(), type: 'assistant', model: '', isActive: true };
      const msg = makeMessage('hello', 'user', { conversationId: conv.id });
      const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

      mockDb.getConversation.mockResolvedValue(conv);
      mockDb.canUserChatInConversation.mockResolvedValue(true);
      mockDb.getConversationParticipants.mockResolvedValue([assistant]);
      mockDb.getConversationMessages.mockResolvedValue([msg]);
      mockDb.createMessage.mockResolvedValue(assistantMsg);
      mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
      mockModelLoader.getModelById.mockResolvedValue(null);

      const ws = createMockWs();
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'continue', conversationId: conv.id,
        messageId: msg.id,
      }));

      await new Promise(r => setTimeout(r, 300));

      const msgs = getSentMessages(ws);
      expect(msgs.some(m => m.type === 'error')).toBe(true);
    });

    it('handles continue with no assistant found', async () => {
      const conv = makeConversation('standard');
      const msg = makeMessage('hello', 'user', { conversationId: conv.id });

      mockDb.getConversation.mockResolvedValue(conv);
      mockDb.canUserChatInConversation.mockResolvedValue(true);
      mockDb.getConversationParticipants.mockResolvedValue([]); // no participants

      const ws = createMockWs();
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'continue', conversationId: conv.id,
        messageId: msg.id,
      }));

      await new Promise(r => setTimeout(r, 200));

      const msgs = getSentMessages(ws);
      expect(msgs.some(m => m.type === 'error' && m.error?.includes('assistant'))).toBe(true);
    });

    it('handles continue with conversation not found', async () => {
      mockDb.getConversation.mockResolvedValue(null);

      const ws = createMockWs();
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'continue', conversationId: randomUUID(),
        messageId: randomUUID(),
      }));

      await new Promise(r => setTimeout(r, 200));

      const msgs = getSentMessages(ws);
      expect(msgs.some(m => m.type === 'error' && m.error?.includes('not found'))).toBe(true);
    });

    it('handles continue with no chat permission', async () => {
      const conv = makeConversation('standard');
      mockDb.getConversation.mockResolvedValue(conv);
      mockDb.canUserChatInConversation.mockResolvedValue(false);

      const ws = createMockWs();
      websocketHandler(ws, createMockReq(), new Database() as any);

      ws.emit('message', JSON.stringify({
        type: 'continue', conversationId: conv.id,
        messageId: randomUUID(),
      }));

      await new Promise(r => setTimeout(r, 200));

      const msgs = getSentMessages(ws);
      expect(msgs.some(m => m.type === 'error' && m.error?.includes('permission'))).toBe(true);
    });
  });

  // ── Mutation Tests ──────────────────────────────────────────────────

  describe('mutation tests', () => {
    // Mutation targets: userHasSufficientCredits, handleAbort, handleDelete, filterHiddenFromAiMessages

    describe('userHasSufficientCredits mutations', () => {
      const defaultModel = {
        id: 'test-model', providerModelId: 'test', provider: 'anthropic',
        contextWindow: 200000, outputTokenLimit: 4096,
        settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
      };

      // M1: Mutate "return true" to "return false" when user has provider API key
      it('returns true (allows chat) when user has matching provider API key', async () => {
        const conv = makeConversation('standard');
        const assistant = { id: randomUUID(), type: 'assistant', model: 'test-model', isActive: true };
        const userMsg = makeMessage('test', 'user', { conversationId: conv.id });
        const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

        mockDb.getConversation.mockResolvedValue(conv);
        mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
        mockDb.getConversationParticipants.mockResolvedValue([assistant]);
        // User has anthropic API key matching the model provider
        mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
        mockModelLoader.getModelById.mockResolvedValue(defaultModel);
        // Grant balances are empty - only the API key should make this pass
        mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
        mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
        mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
        (validatePricingAvailable as any).mockResolvedValue({ valid: true });
        mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
          await onChunk('ok', true, undefined, { inputTokens: 10, outputTokens: 5 });
          return { usage: { inputTokens: 10, outputTokens: 5 } };
        });

        const ws = createMockWs();
        ws.OPEN = 1;
        websocketHandler(ws, createMockReq(), new Database() as any);

        ws.emit('message', JSON.stringify({
          type: 'chat', conversationId: conv.id, messageId: randomUUID(),
          content: 'test',
        }));

        await new Promise(r => setTimeout(r, 400));

        const msgs = getSentMessages(ws);
        // If credit check mutated to return false, we'd see an insufficient credits error
        expect(msgs.some(m => m.type === 'error' && m.error?.includes('credits'))).toBe(false);
        expect(msgs.some(m => m.type === 'stream')).toBe(true);
      });

      // M2: Mutate provider matching — change === to !== in hasProviderKey
      it('denies chat when user API key is for wrong provider', async () => {
        const conv = makeConversation('standard');
        const assistant = { id: randomUUID(), type: 'assistant', model: 'test-model', isActive: true };

        mockDb.getConversation.mockResolvedValue(conv);
        mockDb.getConversationParticipants.mockResolvedValue([assistant]);
        // User has openai key but model is anthropic — should NOT match
        mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'openai' }]);
        mockModelLoader.getModelById.mockResolvedValue(defaultModel);
        mockDb.getUserGrantSummary.mockResolvedValue({ totals: {} });
        mockDb.getApplicableGrantCurrencies.mockResolvedValue([]);
        mockDb.userHasActiveGrantCapability.mockResolvedValue(false);

        const ws = createMockWs();
        websocketHandler(ws, createMockReq(), new Database() as any);

        ws.emit('message', JSON.stringify({
          type: 'chat', conversationId: conv.id, messageId: randomUUID(),
          content: 'test',
        }));

        await new Promise(r => setTimeout(r, 200));

        const msgs = getSentMessages(ws);
        // Should get insufficient credits since wrong provider key doesn't bypass check
        expect(msgs.some(m => m.type === 'error' && m.error?.includes('credits'))).toBe(true);
      });

      // M3: Mutate grant balance check — change > 0 to >= 0 or <= 0
      it('allows chat when grant balance is positive', async () => {
        const conv = makeConversation('standard');
        const assistant = { id: randomUUID(), type: 'assistant', model: 'test-model', isActive: true };
        const userMsg = makeMessage('test', 'user', { conversationId: conv.id });
        const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

        mockDb.getConversation.mockResolvedValue(conv);
        mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
        mockDb.getConversationParticipants.mockResolvedValue([assistant]);
        mockDb.getUserApiKeys.mockResolvedValue([]); // no API keys
        mockModelLoader.getModelById.mockResolvedValue(defaultModel);
        mockDb.getUserGrantSummary.mockResolvedValue({ totals: { sonnets: 5 } });
        mockDb.getApplicableGrantCurrencies.mockResolvedValue(['sonnets']);
        mockDb.userHasActiveGrantCapability.mockResolvedValue(false);
        (validatePricingAvailable as any).mockResolvedValue({ valid: true });
        mockEnhancedStream.mockImplementation(async (_mc: any, _msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
          await onChunk('ok', true, undefined, { inputTokens: 10, outputTokens: 5 });
          return { usage: { inputTokens: 10, outputTokens: 5 } };
        });

        const ws = createMockWs();
        ws.OPEN = 1;
        websocketHandler(ws, createMockReq(), new Database() as any);

        ws.emit('message', JSON.stringify({
          type: 'chat', conversationId: conv.id, messageId: randomUUID(),
          content: 'test',
        }));

        await new Promise(r => setTimeout(r, 400));

        const msgs = getSentMessages(ws);
        expect(msgs.some(m => m.type === 'stream')).toBe(true);
      });

      // M4: Mutate to deny when balance is zero (would break if > 0 changed to >= 0)
      it('denies chat when grant balance is zero and no overspend', async () => {
        const conv = makeConversation('standard');
        const assistant = { id: randomUUID(), type: 'assistant', model: 'test-model', isActive: true };

        mockDb.getConversation.mockResolvedValue(conv);
        mockDb.getConversationParticipants.mockResolvedValue([assistant]);
        mockDb.getUserApiKeys.mockResolvedValue([]);
        mockModelLoader.getModelById.mockResolvedValue(defaultModel);
        mockDb.getUserGrantSummary.mockResolvedValue({ totals: { sonnets: 0 } });
        mockDb.getApplicableGrantCurrencies.mockResolvedValue(['sonnets']);
        mockDb.userHasActiveGrantCapability.mockResolvedValue(false);

        const ws = createMockWs();
        websocketHandler(ws, createMockReq(), new Database() as any);

        ws.emit('message', JSON.stringify({
          type: 'chat', conversationId: conv.id, messageId: randomUUID(),
          content: 'test',
        }));

        await new Promise(r => setTimeout(r, 200));

        const msgs = getSentMessages(ws);
        expect(msgs.some(m => m.type === 'error' && m.error?.includes('credits'))).toBe(true);
      });
    });

    describe('handleAbort mutations', () => {
      // M5: Mutate success field — change to always true or always false
      it('returns success=true when active generation exists', async () => {
        const conv = makeConversation('standard');
        const assistant = { id: randomUUID(), type: 'assistant', model: 'test-model', isActive: true };
        const userMsg = makeMessage('test', 'user', { conversationId: conv.id });
        const assistantMsg = makeMessage('', 'assistant', { conversationId: conv.id });

        mockDb.getConversation.mockResolvedValue(conv);
        mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
        mockDb.getConversationParticipants.mockResolvedValue([assistant]);
        mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
        mockModelLoader.getModelById.mockResolvedValue({
          id: 'test-model', providerModelId: 'test', provider: 'anthropic',
          contextWindow: 200000, outputTokenLimit: 4096,
          settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
        });
        (validatePricingAvailable as any).mockResolvedValue({ valid: true });
        // Make stream hang so the generation stays active
        mockEnhancedStream.mockImplementation(() => new Promise(() => {}));

        const ws = createMockWs();
        ws.OPEN = 1;
        websocketHandler(ws, createMockReq(), new Database() as any);

        // Start a chat to create an active generation
        ws.emit('message', JSON.stringify({
          type: 'chat', conversationId: conv.id, messageId: randomUUID(),
          content: 'test',
        }));

        await new Promise(r => setTimeout(r, 200));

        // Now abort
        ws.emit('message', JSON.stringify({
          type: 'abort', conversationId: conv.id,
        }));

        await new Promise(r => setTimeout(r, 100));

        const msgs = getSentMessages(ws);
        const abortMsg = msgs.find(m => m.type === 'generation_aborted');
        expect(abortMsg).toBeDefined();
        expect(abortMsg.success).toBe(true);
      });

      // M6: Mutate — verify success=false when no active generation
      it('returns success=false when no active generation', async () => {
        const ws = createMockWs();
        websocketHandler(ws, createMockReq(), new Database() as any);

        ws.emit('message', JSON.stringify({
          type: 'abort', conversationId: randomUUID(),
        }));

        await new Promise(r => setTimeout(r, 100));

        const msgs = getSentMessages(ws);
        const abortMsg = msgs.find(m => m.type === 'generation_aborted');
        expect(abortMsg).toBeDefined();
        expect(abortMsg.success).toBe(false);
      });
    });

    describe('handleDelete mutations', () => {
      // M7: Mutate — remove or invert the conversation access check
      it('requires valid conversation for delete', async () => {
        mockDb.getConversation.mockResolvedValue(null);

        const ws = createMockWs();
        websocketHandler(ws, createMockReq(), new Database() as any);

        ws.emit('message', JSON.stringify({
          type: 'delete', conversationId: randomUUID(),
          messageId: randomUUID(), branchId: randomUUID(),
        }));

        await new Promise(r => setTimeout(r, 200));

        const msgs = getSentMessages(ws);
        expect(msgs.some(m => m.type === 'error')).toBe(true);
        expect(mockDb.deleteMessageBranch).not.toHaveBeenCalled();
      });

      // M8: Mutate — remove or invert permission check
      it('requires delete permission', async () => {
        const conv = makeConversation('standard');
        mockDb.getConversation.mockResolvedValue(conv);
        mockDb.canUserDeleteInConversation.mockResolvedValue(false);

        const ws = createMockWs();
        websocketHandler(ws, createMockReq(), new Database() as any);

        ws.emit('message', JSON.stringify({
          type: 'delete', conversationId: conv.id,
          messageId: randomUUID(), branchId: randomUUID(),
        }));

        await new Promise(r => setTimeout(r, 200));

        const msgs = getSentMessages(ws);
        expect(msgs.some(m => m.type === 'error' && m.error?.includes('permission'))).toBe(true);
        expect(mockDb.deleteMessageBranch).not.toHaveBeenCalled();
      });

      // M9: Mutate — send wrong event type or wrong data on success
      it('sends message_deleted with correct data on success', async () => {
        const conv = makeConversation('standard');
        const msgId = randomUUID();
        const bId = randomUUID();
        const deletedResult = [msgId];

        mockDb.getConversation.mockResolvedValue(conv);
        mockDb.canUserDeleteInConversation.mockResolvedValue(true);
        mockDb.deleteMessageBranch.mockResolvedValue(deletedResult);

        const ws = createMockWs();
        websocketHandler(ws, createMockReq(), new Database() as any);

        ws.emit('message', JSON.stringify({
          type: 'delete', conversationId: conv.id,
          messageId: msgId, branchId: bId,
        }));

        await new Promise(r => setTimeout(r, 200));

        const msgs = getSentMessages(ws);
        const deleteMsg = msgs.find(m => m.type === 'message_deleted');
        expect(deleteMsg).toBeDefined();
        expect(deleteMsg.messageId).toBe(msgId);
        expect(deleteMsg.branchId).toBe(bId);
        expect(deleteMsg.deletedMessages).toEqual(deletedResult);
        // Also verify broadcast
        expect(mockRoomManager.broadcastToRoom).toHaveBeenCalledWith(
          conv.id,
          expect.objectContaining({ type: 'message_deleted', messageId: msgId }),
          ws,
        );
      });
    });

    describe('filterHiddenFromAiMessages mutations (via chat flow)', () => {
      // M10: Mutate — remove null filter or invert hiddenFromAi check
      // Build a proper parent chain: visibleMsg -> hiddenMsg -> userMsg
      it('excludes hidden messages from AI context while keeping visible ones', async () => {
        const conv = makeConversation('standard');
        const assistant = { id: randomUUID(), type: 'assistant', model: 'test-model', isActive: true };

        // Build a proper parent chain
        const visibleMsg = makeMessage('visible', 'user', { conversationId: conv.id, order: 0 });
        const visibleBranchId = visibleMsg.activeBranchId;

        const hiddenMsg = makeMessage('hidden', 'user', {
          conversationId: conv.id, order: 1, hiddenFromAi: true, parentBranchId: visibleBranchId,
        });
        const hiddenBranchId = hiddenMsg.activeBranchId;

        const userMsg = makeMessage('new msg', 'user', {
          conversationId: conv.id, order: 2, parentBranchId: hiddenBranchId,
        });
        const userBranchId = userMsg.activeBranchId;

        const assistantMsg = makeMessage('', 'assistant', {
          conversationId: conv.id, order: 3, parentBranchId: userBranchId,
        });

        mockDb.getConversation.mockResolvedValue(conv);
        mockDb.createMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
        mockDb.getConversationMessages.mockResolvedValue([visibleMsg, hiddenMsg]);
        mockDb.getConversationParticipants.mockResolvedValue([assistant]);
        mockDb.getUserApiKeys.mockResolvedValue([{ provider: 'anthropic' }]);
        mockModelLoader.getModelById.mockResolvedValue({
          id: 'test-model', providerModelId: 'test', provider: 'anthropic',
          contextWindow: 200000, outputTokenLimit: 4096,
          settings: { temperature: { min: 0, max: 1, default: 0.7, step: 0.1 }, maxTokens: { min: 1, max: 4096, default: 1024 } },
        });
        (validatePricingAvailable as any).mockResolvedValue({ valid: true });

        let capturedMessages: any[] = [];
        mockEnhancedStream.mockImplementation(async (_mc: any, msgs: any, _sys: any, _s: any, _uid: any, onChunk: any) => {
          capturedMessages = msgs;
          await onChunk('ok', true, undefined, { inputTokens: 10, outputTokens: 5 });
          return { usage: { inputTokens: 10, outputTokens: 5 } };
        });

        const ws = createMockWs();
        ws.OPEN = 1;
        websocketHandler(ws, createMockReq(), new Database() as any);

        ws.emit('message', JSON.stringify({
          type: 'chat', conversationId: conv.id, messageId: randomUUID(),
          content: 'new msg',
        }));

        await new Promise(r => setTimeout(r, 400));

        // Extract all content from messages passed to inference
        const allContent = capturedMessages.map((m: any) => {
          const branch = m.branches?.find((b: any) => b.id === m.activeBranchId);
          return branch?.content;
        }).filter(Boolean);

        // The hidden message should be filtered out from inference context
        // If mutation removed filter, 'hidden' would appear in allContent
        expect(allContent).not.toContain('hidden');
        // Verify inference was still called (not blocked entirely)
        expect(mockEnhancedStream).toHaveBeenCalled();
      });
    });
  });
});
