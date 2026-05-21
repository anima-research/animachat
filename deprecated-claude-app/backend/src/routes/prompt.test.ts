import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

/**
 * Prompt route characterization tests.
 *
 * The POST /api/prompt/build endpoint constructs an InferenceService
 * internally, which depends on ModelLoader, AnthropicService, etc.
 * We mock the InferenceService to isolate the route logic: Zod validation,
 * conversation lookup, participant filtering, and history building.
 *
 * We use a real Database for conversation/message state but mock
 * InferenceService to avoid model resolution.
 */

// Mock InferenceService before any imports that reference it
const mockBuildPrompt = vi.fn();

vi.mock('../services/inference.js', () => {
  return {
    InferenceService: class MockInferenceService {
      buildPrompt = mockBuildPrompt;
    },
  };
});

import { Database } from '../database/index.js';
import { authRouter } from './auth.js';
import { conversationRouter } from './conversations.js';
import { createPromptRouter } from './prompt.js';
import { authenticateToken, generateToken } from '../middleware/auth.js';

let app: express.Express;
let request: supertest.Agent;
let db: Database;
let tmpDir: string;
let originalCwd: string;

beforeEach(async () => {
  mockBuildPrompt.mockReset();

  originalCwd = process.cwd();
  tmpDir = await mkdtemp(path.join(tmpdir(), 'prompt-test-'));
  process.chdir(tmpDir);

  db = new Database();
  await db.init();

  process.chdir(originalCwd);

  app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/auth', authRouter(db));
  app.use('/api/conversations', authenticateToken, conversationRouter(db));
  app.use('/api/prompt', createPromptRouter(db));

  request = supertest(app);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tmpDir, { recursive: true, force: true });
});

/** Register and return token */
async function getAuthToken(): Promise<{ token: string; userId: string }> {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request
    .post('/api/auth/register')
    .send({ email, password: 'password123', name: 'Test User' });
  if (res.status !== 200) {
    throw new Error(`Registration failed: ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.token, userId: res.body.user.id };
}

/** Create a conversation */
async function createConversation(token: string, overrides: Record<string, any> = {}): Promise<string> {
  const res = await request
    .post('/api/conversations')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Test Convo',
      model: 'claude-sonnet-4-20250514',
      ...overrides,
    });
  expect([200, 201]).toContain(res.status);
  return res.body.id;
}

describe('Prompt routes', () => {
  describe('POST /api/prompt/build', () => {
    it('returns 401 without auth token', async () => {
      const res = await request
        .post('/api/prompt/build')
        .send({ conversationId: 'any', branchId: 'any' });
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent conversation', async () => {
      const { token } = await getAuthToken();

      const res = await request
        .post('/api/prompt/build')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId: '00000000-0000-4000-8000-000000000000',
          branchId: 'any-branch',
        });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Conversation not found');
    });

    it('calls buildPrompt with conversation data and returns result', async () => {
      const { token } = await getAuthToken();
      const conversationId = await createConversation(token);

      mockBuildPrompt.mockResolvedValue({
        messages: [{ role: 'user', content: 'hello' }],
        systemPrompt: 'You are helpful.',
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
      });

      const res = await request
        .post('/api/prompt/build')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          branchId: 'root',
        });

      expect(res.status).toBe(200);
      expect(res.body.provider).toBe('anthropic');
      expect(res.body.modelId).toBe('claude-sonnet-4-20250514');
      expect(res.body.messages).toEqual([{ role: 'user', content: 'hello' }]);
      expect(res.body.conversationFormat).toBe('standard');
      expect(typeof res.body.messageCount).toBe('number');

      // Verify buildPrompt was called
      expect(mockBuildPrompt).toHaveBeenCalledTimes(1);
      const [modelId, history, systemPrompt, format] = mockBuildPrompt.mock.calls[0];
      expect(modelId).toBe('claude-sonnet-4-20250514');
      expect(Array.isArray(history)).toBe(true);
      expect(format).toBe('standard');
    });

    it('returns 500 when buildPrompt throws', async () => {
      const { token } = await getAuthToken();
      const conversationId = await createConversation(token);

      mockBuildPrompt.mockRejectedValue(new Error('Model not found'));

      const res = await request
        .post('/api/prompt/build')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          branchId: 'root',
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to build prompt');
    });

    it('validates request body with Zod — missing branchId', async () => {
      const { token } = await getAuthToken();

      const res = await request
        .post('/api/prompt/build')
        .set('Authorization', `Bearer ${token}`)
        .send({ conversationId: 'test' }); // missing branchId

      expect(res.status).toBe(500); // Zod throws → caught by catch block
    });

    it('builds conversation history from messages using branchId', async () => {
      const { token, userId } = await getAuthToken();
      const conversationId = await createConversation(token);

      // Add messages directly via database
      // createMessage(conversationId, ownerUserId, content, role, model?, explicitParentBranchId?)
      const msg1 = await db.createMessage(conversationId, userId, 'Hello', 'user');
      // Get the branch ID from msg1 to use as parent
      const msg1BranchId = msg1.activeBranchId;

      const msg2 = await db.createMessage(
        conversationId, userId, 'Hi there!', 'assistant',
        undefined, msg1BranchId // explicit parent
      );
      const msg2BranchId = msg2.activeBranchId;

      mockBuildPrompt.mockResolvedValue({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        provider: 'anthropic',
        modelId: 'test-model',
      });

      const res = await request
        .post('/api/prompt/build')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          branchId: msg2BranchId,
        });

      expect(res.status).toBe(200);
      expect(res.body.messageCount).toBe(2);

      // buildPrompt should have received the history array with 2 messages
      expect(mockBuildPrompt).toHaveBeenCalledTimes(1);
      const history = mockBuildPrompt.mock.calls[0][1];
      expect(history).toHaveLength(2);
    });

    it('handles prefill format with participant filtering', async () => {
      const { token, userId } = await getAuthToken();
      const conversationId = await createConversation(token, {
        format: 'prefill',
        systemPrompt: 'Be helpful',
      });

      // createParticipant(convId, ownerUserId, name, type, model)
      await db.createParticipant(
        conversationId, userId, 'Claude', 'assistant', 'claude-sonnet-4-20250514'
      );

      mockBuildPrompt.mockResolvedValue({
        messages: [],
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
      });

      const res = await request
        .post('/api/prompt/build')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          branchId: 'root',
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationFormat).toBe('prefill');

      // buildPrompt should have been called with participants and responderId
      expect(mockBuildPrompt).toHaveBeenCalledTimes(1);
      const callArgs = mockBuildPrompt.mock.calls[0];
      const passedParticipants = callArgs[4]; // 5th arg
      const passedResponderId = callArgs[5]; // 6th arg
      expect(Array.isArray(passedParticipants)).toBe(true);
      expect(passedParticipants.length).toBeGreaterThanOrEqual(1);
      expect(passedResponderId).toBeDefined();
    });

    it('uses first active assistant model as responder', async () => {
      const { token, userId } = await getAuthToken();
      // When creating a conversation with 'prefill' format, the DB creates default
      // participants. The route picks the first active assistant as responder.
      const conversationId = await createConversation(token, {
        format: 'prefill',
        model: 'conversation-model',
      });

      mockBuildPrompt.mockResolvedValue({
        messages: [],
        provider: 'anthropic',
        modelId: 'conversation-model',
      });

      const res = await request
        .post('/api/prompt/build')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          branchId: 'root',
        });

      expect(res.status).toBe(200);
      // The model ID should be taken from the first active assistant participant
      const passedModelId = mockBuildPrompt.mock.calls[0][0];
      expect(typeof passedModelId).toBe('string');
      // responderId should be set
      const passedResponderId = mockBuildPrompt.mock.calls[0][5];
      expect(passedResponderId).toBeDefined();
    });

    it('passes undefined systemPrompt when includeSystemPrompt is false', async () => {
      const { token } = await getAuthToken();
      const conversationId = await createConversation(token, {
        systemPrompt: 'Be helpful',
      });

      mockBuildPrompt.mockResolvedValue({
        messages: [],
        provider: 'anthropic',
        modelId: 'test',
      });

      await request
        .post('/api/prompt/build')
        .set('Authorization', `Bearer ${token}`)
        .send({
          conversationId,
          branchId: 'root',
          includeSystemPrompt: false,
        });

      expect(mockBuildPrompt).toHaveBeenCalledTimes(1);
      const systemPromptArg = mockBuildPrompt.mock.calls[0][2];
      expect(systemPromptArg).toBeUndefined();
    });
  });
});
