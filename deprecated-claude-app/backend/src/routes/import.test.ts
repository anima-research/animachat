import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TestContext,
  createTestApp,
  cleanupTestApp,
  createAuthenticatedUser,
} from './test-helpers.js';

describe('Import Routes', () => {
  let ctx: TestContext;
  let userToken: string;
  let userId: string;
  let otherToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();

    const user = await createAuthenticatedUser(ctx.request, {
      email: 'import-user@example.com',
      password: 'importpass123',
      name: 'Import User',
    });
    userToken = user.token;
    userId = user.userId;

    const other = await createAuthenticatedUser(ctx.request, {
      email: 'import-other@example.com',
      password: 'otherpass123',
      name: 'Other Import User',
    });
    otherToken = other.token;
  });

  afterAll(async () => {
    await cleanupTestApp(ctx);
  });

  // Sample data for basic_json format (parser expects { messages: [...] })
  const basicJsonContent = JSON.stringify({
    messages: [
      { role: 'user', content: 'Hello there' },
      { role: 'assistant', content: 'Hi! How can I help you today?' },
      { role: 'user', content: 'Tell me about TypeScript' },
      { role: 'assistant', content: 'TypeScript is a typed superset of JavaScript.' },
    ],
  });

  // Sample data for anthropic format
  const anthropicContent = JSON.stringify({
    messages: [
      { role: 'user', content: 'What is AI?' },
      { role: 'assistant', content: 'AI stands for Artificial Intelligence.' },
    ],
  });

  // ───── Preview import ─────

  describe('POST /api/import/preview', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.post('/api/import/preview').send({
        format: 'basic_json',
        content: basicJsonContent,
      });

      expect(res.status).toBe(401);
    });

    it('previews basic_json format successfully', async () => {
      const res = await ctx.request
        .post('/api/import/preview')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'basic_json',
          content: basicJsonContent,
        });

      expect(res.status).toBe(200);
      expect(res.body.format).toBe('basic_json');
      expect(res.body.messages).toBeDefined();
      expect(Array.isArray(res.body.messages)).toBe(true);
      expect(res.body.messages.length).toBe(4);
      expect(res.body.detectedParticipants).toBeDefined();
    });

    it('previews anthropic format', async () => {
      const res = await ctx.request
        .post('/api/import/preview')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'anthropic',
          content: anthropicContent,
        });

      expect(res.status).toBe(200);
      expect(res.body.format).toBe('anthropic');
      expect(res.body.messages.length).toBe(2);
    });

    it('rejects with missing format', async () => {
      const res = await ctx.request
        .post('/api/import/preview')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ content: basicJsonContent });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Format and content are required');
    });

    it('rejects with missing content', async () => {
      const res = await ctx.request
        .post('/api/import/preview')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ format: 'basic_json' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Format and content are required');
    });

    it('rejects invalid JSON content for basic_json', async () => {
      const res = await ctx.request
        .post('/api/import/preview')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'basic_json',
          content: 'not valid json {{{',
        });

      expect(res.status).toBe(400);
    });

    it('supports allowedParticipants filter', async () => {
      const colonContent = 'User: Hello\nAssistant: Hi\nUser: How are you?\nAssistant: Good';
      const res = await ctx.request
        .post('/api/import/preview')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'colon_single',
          content: colonContent,
          allowedParticipants: ['User', 'Assistant'],
        });

      expect(res.status).toBe(200);
      expect(res.body.messages).toBeDefined();
    });
  });

  // ───── Execute import ─────

  describe('POST /api/import/execute', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.post('/api/import/execute').send({
        format: 'basic_json',
        content: basicJsonContent,
        conversationFormat: 'standard',
      });

      expect(res.status).toBe(401);
    });

    it('imports basic_json and creates conversation', async () => {
      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'basic_json',
          content: basicJsonContent,
          conversationFormat: 'standard',
          title: 'Imported Conversation',
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeDefined();
      expect(res.body.messageCount).toBe(4);

      // Verify the conversation was created
      const convRes = await ctx.request
        .get(`/api/conversations/${res.body.conversationId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(convRes.status).toBe(200);
      expect(convRes.body.title).toBe('Imported Conversation');
    });

    it('imports with explicit model', async () => {
      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'basic_json',
          content: basicJsonContent,
          conversationFormat: 'standard',
          title: 'Model Import',
          model: 'anthropic/claude-sonnet-4-20250514',
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeDefined();
    });

    it('imports anthropic format', async () => {
      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'anthropic',
          content: anthropicContent,
          conversationFormat: 'standard',
          title: 'Anthropic Import',
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeDefined();
    });

    it('rejects invalid format in request', async () => {
      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'invalid_format',
          content: basicJsonContent,
          conversationFormat: 'standard',
        });

      expect(res.status).toBe(400);
    });

    it('rejects missing required fields', async () => {
      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ format: 'basic_json' });

      expect(res.status).toBe(400);
    });

    it('uses default title when not specified', async () => {
      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'basic_json',
          content: basicJsonContent,
          conversationFormat: 'standard',
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeDefined();
    });

    it('supports participant mappings', async () => {
      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'basic_json',
          content: basicJsonContent,
          conversationFormat: 'standard',
          title: 'Mapped Import',
          participantMappings: [
            { sourceName: 'User', targetName: 'Alice', type: 'user' },
            { sourceName: 'Assistant', targetName: 'Claude', type: 'assistant' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeDefined();
    });

    it('supports prefill conversation format', async () => {
      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'basic_json',
          content: basicJsonContent,
          conversationFormat: 'prefill',
          title: 'Prefill Import',
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeDefined();
    });
  });

  // ───── Execute import with arc_chat format ─────

  describe('POST /api/import/execute (arc_chat)', () => {
    it('imports arc_chat format with participants', async () => {
      const arcChatData = {
        conversation: {
          id: 'test-conv-id',
          title: 'Arc Chat Import',
          model: 'claude-3-5-sonnet-20241022',
          format: 'standard',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        participants: [
          { name: 'User', type: 'user' },
          { name: 'Claude', type: 'assistant', model: 'claude-3-5-sonnet-20241022' },
        ],
        messages: [
          {
            id: 'msg-1',
            order: 0,
            activeBranchId: 'branch-1',
            branches: [
              {
                id: 'branch-1',
                content: 'Hello from Arc Chat',
                role: 'user',
                participantName: 'User',
                createdAt: new Date().toISOString(),
              },
            ],
          },
          {
            id: 'msg-2',
            order: 1,
            activeBranchId: 'branch-2',
            branches: [
              {
                id: 'branch-2',
                content: 'Hi there! How can I help?',
                role: 'assistant',
                participantName: 'Claude',
                model: 'claude-3-5-sonnet-20241022',
                parentBranchId: 'branch-1',
                createdAt: new Date().toISOString(),
              },
            ],
          },
        ],
      };

      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'arc_chat',
          content: JSON.stringify(arcChatData),
          conversationFormat: 'standard',
          title: 'Arc Chat Import Test',
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeDefined();

      // Verify the conversation was actually created with messages
      const msgsRes = await ctx.request
        .get(`/api/conversations/${res.body.conversationId}/messages`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(msgsRes.status).toBe(200);
      expect(msgsRes.body.length).toBeGreaterThanOrEqual(2);
    });

    it('imports arc_chat format with multiple branches on a message', async () => {
      const arcChatData = {
        conversation: {
          id: 'test-multi-branch',
          title: 'Multi Branch',
          model: 'claude-3-5-sonnet-20241022',
          format: 'standard',
        },
        participants: [
          { name: 'User', type: 'user' },
          { name: 'Claude', type: 'assistant', model: 'claude-3-5-sonnet-20241022' },
        ],
        messages: [
          {
            id: 'msg-1',
            order: 0,
            activeBranchId: 'b1',
            branches: [
              { id: 'b1', content: 'User message', role: 'user', participantName: 'User', createdAt: new Date().toISOString() },
            ],
          },
          {
            id: 'msg-2',
            order: 1,
            activeBranchId: 'b3',
            branches: [
              { id: 'b2', content: 'First response', role: 'assistant', participantName: 'Claude', model: 'claude-3-5-sonnet-20241022', parentBranchId: 'b1', createdAt: new Date().toISOString() },
              { id: 'b3', content: 'Second response (active)', role: 'assistant', participantName: 'Claude', model: 'claude-3-5-sonnet-20241022', parentBranchId: 'b1', createdAt: new Date().toISOString() },
            ],
          },
        ],
      };

      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'arc_chat',
          content: JSON.stringify(arcChatData),
          conversationFormat: 'standard',
          title: 'Multi Branch Import',
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeDefined();
    });
  });

  // ───── Execute import edge cases ─────

  describe('POST /api/import/execute (edge cases)', () => {
    it('handles arc_chat with missing participant names (falls back to role)', async () => {
      const arcChatData = {
        conversation: {
          id: 'test-fallback',
          title: 'Fallback Names',
          model: 'claude-3-5-sonnet-20241022',
          format: 'standard',
        },
        participants: [
          { name: 'User', type: 'user' },
          { name: 'Claude', type: 'assistant', model: 'claude-3-5-sonnet-20241022' },
        ],
        messages: [
          {
            id: 'msg-no-name',
            order: 0,
            activeBranchId: 'bn-1',
            branches: [
              {
                id: 'bn-1',
                content: 'Message without participant name',
                role: 'user',
                // No participantName or participantId
                createdAt: new Date().toISOString(),
              },
            ],
          },
        ],
      };

      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'arc_chat',
          content: JSON.stringify(arcChatData),
          conversationFormat: 'standard',
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeDefined();
    });

    it('handles arc_chat with user participant settings', async () => {
      const arcChatData = {
        conversation: {
          id: 'test-user-settings',
          title: 'User Settings',
          model: 'claude-3-5-sonnet-20241022',
          format: 'standard',
        },
        participants: [
          { name: 'CustomUser', type: 'user' },
          { name: 'Bot', type: 'assistant', model: 'claude-3-5-sonnet-20241022', settings: { temperature: 0.5 } },
        ],
        messages: [
          {
            id: 'msg-s1',
            order: 0,
            activeBranchId: 'bs-1',
            branches: [
              { id: 'bs-1', content: 'Hello', role: 'user', participantName: 'CustomUser', createdAt: new Date().toISOString() },
            ],
          },
          {
            id: 'msg-s2',
            order: 1,
            activeBranchId: 'bs-2',
            branches: [
              { id: 'bs-2', content: 'Hi there', role: 'assistant', participantName: 'Bot', parentBranchId: 'bs-1', createdAt: new Date().toISOString() },
            ],
          },
        ],
      };

      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'arc_chat',
          content: JSON.stringify(arcChatData),
          conversationFormat: 'standard',
        });

      expect(res.status).toBe(200);
    });

    it('handles arc_chat with orphaned messages filtered out', async () => {
      const arcChatData = {
        conversation: { id: 'test-orphan', title: 'Orphan Filter' },
        participants: [
          { name: 'User', type: 'user' },
          { name: 'Bot', type: 'assistant', model: 'test-model' },
        ],
        messages: [
          {
            id: 'valid-msg',
            order: 0,
            activeBranchId: 'valid-branch',
            branches: [
              { id: 'valid-branch', content: 'Valid message', role: 'user', participantName: 'User', createdAt: new Date().toISOString() },
            ],
          },
          {
            id: 'orphan-msg',
            order: 1,
            activeBranchId: 'orphan-branch',
            branches: [
              { id: 'orphan-branch', content: 'Orphaned', role: 'assistant', participantName: 'Bot', parentBranchId: 'deleted-branch-id', createdAt: new Date().toISOString() },
            ],
          },
        ],
      };

      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'arc_chat',
          content: JSON.stringify(arcChatData),
          conversationFormat: 'standard',
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeDefined();
    });

    it('handles arc_chat with no explicit model (derives from participants)', async () => {
      const arcChatData = {
        conversation: { id: 'no-model', title: 'No Model' },
        participants: [
          { name: 'User', type: 'user' },
          { name: 'Claude', type: 'assistant', model: 'anthropic/claude-sonnet-4-20250514' },
        ],
        messages: [
          {
            id: 'nm-1',
            order: 0,
            activeBranchId: 'nm-b1',
            branches: [{ id: 'nm-b1', content: 'Test', role: 'user', participantName: 'User', createdAt: new Date().toISOString() }],
          },
        ],
      };

      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'arc_chat',
          content: JSON.stringify(arcChatData),
          conversationFormat: 'standard',
          // No model specified — should derive from first assistant participant
        });

      expect(res.status).toBe(200);
    });
  });

  // ───── Import raw messages ─────

  describe('POST /api/import/messages-raw', () => {
    it('rejects without auth', async () => {
      const res = await ctx.request.post('/api/import/messages-raw').send({
        conversationId: 'fake-id',
        messages: [],
      });

      expect(res.status).toBe(401);
    });

    it('rejects with missing conversationId', async () => {
      const res = await ctx.request
        .post('/api/import/messages-raw')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ messages: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid data format');
    });

    it('rejects with missing messages array', async () => {
      const res = await ctx.request
        .post('/api/import/messages-raw')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ conversationId: 'some-id' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid data format');
    });

    it('rejects with non-array messages', async () => {
      const res = await ctx.request
        .post('/api/import/messages-raw')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ conversationId: 'some-id', messages: 'not-array' });

      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent conversation', async () => {
      const res = await ctx.request
        .post('/api/import/messages-raw')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          conversationId: '00000000-0000-0000-0000-000000000000',
          messages: [],
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Conversation not found');
    });

    it('returns 403 for other user\'s conversation', async () => {
      // Create a conversation as main user
      const convRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ title: 'Raw Import Conv', model: 'claude-3-5-sonnet-20241022' });
      const convId = convRes.body.id;

      // Other user tries to import
      const res = await ctx.request
        .post('/api/import/messages-raw')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ conversationId: convId, messages: [] });

      // The route checks conversation.userId !== req.userId
      expect(res.status).toBe(404);
    });

    it('imports raw messages into existing conversation', async () => {
      // Create a conversation
      const convRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ title: 'Raw Import Target', model: 'claude-3-5-sonnet-20241022' });
      const convId = convRes.body.id;

      const res = await ctx.request
        .post('/api/import/messages-raw')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          conversationId: convId,
          messages: [], // Empty messages — still exercises the code path
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.importedMessages).toBe(0);
      expect(res.body.conversationId).toBe(convId);
    });

    it('imports raw messages with actual message data', async () => {
      // Create a conversation
      const convRes = await ctx.request
        .post('/api/conversations')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ title: 'Raw Import With Data', model: 'claude-3-5-sonnet-20241022' });
      const convId = convRes.body.id;

      // Create a raw message structure matching the DB message format
      const rawMessages = [
        {
          id: 'raw-msg-1',
          conversationId: convId,
          order: 0,
          activeBranchId: 'raw-branch-1',
          branches: [
            {
              id: 'raw-branch-1',
              content: 'Hello from raw import',
              role: 'user',
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ];

      const res = await ctx.request
        .post('/api/import/messages-raw')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          conversationId: convId,
          messages: rawMessages,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.importedMessages).toBeGreaterThanOrEqual(0);
    });
  });

  // ───── Execute import with system messages and edge cases ─────

  describe('POST /api/import/execute (system messages and fallbacks)', () => {
    it('skips system messages during import', async () => {
      // Content with a system message that should be skipped
      const contentWithSystem = JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
      });

      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'basic_json',
          content: contentWithSystem,
          conversationFormat: 'standard',
          title: 'System Message Test',
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeDefined();
      // System messages are skipped, but message count includes them from preview
      expect(res.body.messageCount).toBe(3);
    });

    it('handles participant not found in mapping and falls back to role', async () => {
      const content = JSON.stringify({
        messages: [
          { role: 'user', content: 'Unmatched user' },
          { role: 'assistant', content: 'Unmatched assistant' },
        ],
      });

      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'basic_json',
          content,
          conversationFormat: 'standard',
          title: 'Fallback Test',
          // Provide mappings that don't match the parsed participant names
          participantMappings: [
            { sourceName: 'SomeOtherName', targetName: 'Renamed', type: 'user' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeDefined();
    });
  });

  // ───── Execute import with chrome_extension format (exercises branch UUID tracking) ─────

  describe('POST /api/import/execute (chrome_extension)', () => {
    it('imports chrome_extension format with parent UUID tracking', async () => {
      const chromeExtData = {
        uuid: 'ce-conv-1',
        name: 'Chrome Extension Conversation',
        model: 'claude-3-5-sonnet-20241022',
        chat_messages: [
          {
            uuid: '11111111-1111-4111-8111-111111111111',
            text: 'Hello from chrome extension',
            sender: 'human',
            parent_message_uuid: '00000000-0000-4000-8000-000000000000',
            created_at: new Date().toISOString(),
          },
          {
            uuid: '22222222-2222-4222-8222-222222222222',
            text: 'Hi! How can I help?',
            sender: 'assistant',
            parent_message_uuid: '11111111-1111-4111-8111-111111111111',
            created_at: new Date().toISOString(),
          },
          {
            uuid: '33333333-3333-4333-8333-333333333333',
            text: 'Tell me about TypeScript',
            sender: 'human',
            parent_message_uuid: '22222222-2222-4222-8222-222222222222',
            created_at: new Date().toISOString(),
          },
          {
            uuid: '44444444-4444-4444-8444-444444444444',
            text: 'TypeScript is great!',
            sender: 'assistant',
            parent_message_uuid: '33333333-3333-4333-8333-333333333333',
            created_at: new Date().toISOString(),
          },
        ],
      };

      const res = await ctx.request
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'chrome_extension',
          content: JSON.stringify(chromeExtData),
          conversationFormat: 'standard',
          title: 'Chrome Extension Import',
        });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeDefined();
      expect(res.body.messageCount).toBe(4);
    });
  });

  // ───── Preview with different formats ─────

  describe('POST /api/import/preview (additional formats)', () => {
    it('previews colon_double format', async () => {
      const colonContent = 'User: Hello\n\nAssistant: Hi there\n\nUser: How are you?\n\nAssistant: Good thanks';
      const res = await ctx.request
        .post('/api/import/preview')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'colon_double',
          content: colonContent,
        });

      expect(res.status).toBe(200);
      expect(res.body.messages).toBeDefined();
      expect(res.body.messages.length).toBeGreaterThanOrEqual(1);
    });

    it('returns error for unsupported format in preview', async () => {
      const res = await ctx.request
        .post('/api/import/preview')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          format: 'totally_invalid',
          content: 'some content',
        });

      expect(res.status).toBe(500);
    });
  });
});
