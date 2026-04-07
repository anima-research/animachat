import { describe, it, expect, beforeEach } from 'vitest';
import { ImportParser } from './importParser.js';

// Helper to create valid basic JSON content
function basicJson(messages: Array<{ role: string; content: string; name?: string; timestamp?: string; model?: string }>, title?: string, metadata?: any): string {
  return JSON.stringify({ messages, title, metadata });
}

describe('ImportParser', () => {
  let parser: ImportParser;

  beforeEach(() => {
    parser = new ImportParser();
  });

  // ========== parse() dispatch ==========

  describe('parse() dispatch', () => {
    it('throws on unsupported format', async () => {
      await expect(parser.parse('nonexistent' as any, '{}')).rejects.toThrow('Unsupported format');
    });

    it('detects participants and deduplicates by name', async () => {
      const content = basicJson([
        { role: 'user', content: 'Hello', name: 'Alice' },
        { role: 'assistant', content: 'Hi', name: 'Bot' },
        { role: 'user', content: 'Question', name: 'Alice' },
        { role: 'assistant', content: 'Answer', name: 'Bot' },
      ]);
      const result = await parser.parse('basic_json', content);
      // Should have exactly 2 detected participants
      expect(result.detectedParticipants).toHaveLength(2);
      const alice = result.detectedParticipants.find(p => p.name === 'Alice');
      const bot = result.detectedParticipants.find(p => p.name === 'Bot');
      expect(alice).toBeDefined();
      expect(alice!.messageCount).toBe(2);
      expect(bot).toBeDefined();
      expect(bot!.messageCount).toBe(2);
    });

    it('limits auto-detected participants to MAX_AUTO_DETECTED_PARTICIPANTS (15)', async () => {
      // Create 20 unique participants
      const messages = Array.from({ length: 20 }, (_, i) => ({
        role: 'user',
        content: `Message from participant ${i}`,
        name: `Participant${i}`,
      }));
      const content = basicJson(messages);
      const result = await parser.parse('basic_json', content);
      expect(result.detectedParticipants.length).toBeLessThanOrEqual(15);
    });

    it('sorts detected participants by message count descending', async () => {
      const content = basicJson([
        { role: 'user', content: 'a', name: 'Rare' },
        { role: 'user', content: 'b', name: 'Common' },
        { role: 'user', content: 'c', name: 'Common' },
        { role: 'user', content: 'd', name: 'Common' },
        { role: 'user', content: 'e', name: 'Mid' },
        { role: 'user', content: 'f', name: 'Mid' },
      ]);
      const result = await parser.parse('basic_json', content);
      expect(result.detectedParticipants[0].name).toBe('Common');
      expect(result.detectedParticipants[0].messageCount).toBe(3);
      expect(result.detectedParticipants[1].name).toBe('Mid');
      expect(result.detectedParticipants[1].messageCount).toBe(2);
      expect(result.detectedParticipants[2].name).toBe('Rare');
      expect(result.detectedParticipants[2].messageCount).toBe(1);
    });

    it('suggests "prefill" format when more than 2 participants detected', async () => {
      const content = basicJson([
        { role: 'user', content: 'a', name: 'Alice' },
        { role: 'assistant', content: 'b', name: 'Bot1' },
        { role: 'assistant', content: 'c', name: 'Bot2' },
      ]);
      const result = await parser.parse('basic_json', content);
      expect(result.suggestedFormat).toBe('prefill');
    });

    it('suggests "standard" format when 2 or fewer participants', async () => {
      const content = basicJson([
        { role: 'user', content: 'a', name: 'Alice' },
        { role: 'assistant', content: 'b', name: 'Bot' },
      ]);
      const result = await parser.parse('basic_json', content);
      expect(result.suggestedFormat).toBe('standard');
    });

    it('assigns "User" and "Assistant" to messages missing participantName', async () => {
      const content = basicJson([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ]);
      const result = await parser.parse('basic_json', content);
      const names = result.detectedParticipants.map(p => p.name);
      expect(names).toContain('User');
      expect(names).toContain('Assistant');
    });
  });

  // ========== parseBasicJson ==========

  describe('parseBasicJson', () => {
    it('parses valid JSON with messages array', async () => {
      const content = basicJson([
        { role: 'user', content: 'Hello world' },
        { role: 'assistant', content: 'Hi there' },
      ], 'Test Chat');
      const result = await parser.parse('basic_json', content);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello world');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toBe('Hi there');
      expect(result.title).toBe('Test Chat');
    });

    it('throws on invalid JSON', async () => {
      await expect(parser.parse('basic_json', 'not json')).rejects.toThrow();
    });

    it('throws when messages array is missing', async () => {
      await expect(parser.parse('basic_json', JSON.stringify({ title: 'no messages' }))).rejects.toThrow('missing messages array');
    });

    it('throws when messages is not an array', async () => {
      await expect(parser.parse('basic_json', JSON.stringify({ messages: 'not array' }))).rejects.toThrow('missing messages array');
    });

    it('handles array content by joining text parts', async () => {
      const content = JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [
              { text: 'First part' },
              { text: 'Second part' },
            ],
          },
        ],
      });
      const result = await parser.parse('basic_json', content);
      expect(result.messages[0].content).toBe('First part\nSecond part');
    });

    it('handles array content with mixed string and object elements', async () => {
      const content = JSON.stringify({
        messages: [
          {
            role: 'user',
            content: ['plain text', { text: 'object text' }],
          },
        ],
      });
      const result = await parser.parse('basic_json', content);
      expect(result.messages[0].content).toBe('plain text\nobject text');
    });

    it('handles object content by JSON stringifying', async () => {
      const obj = { key: 'value' };
      const content = JSON.stringify({
        messages: [
          { role: 'user', content: obj },
        ],
      });
      const result = await parser.parse('basic_json', content);
      expect(result.messages[0].content).toBe(JSON.stringify(obj));
    });

    it('normalizes role names (human -> user, ai -> assistant, bot -> assistant)', async () => {
      const content = basicJson([
        { role: 'human', content: 'a' },
        { role: 'ai', content: 'b' },
        { role: 'bot', content: 'c' },
        { role: 'system', content: 'd' },
      ]);
      const result = await parser.parse('basic_json', content);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[2].role).toBe('assistant');
      expect(result.messages[3].role).toBe('system');
    });

    it('defaults unknown role to user', async () => {
      const content = basicJson([
        { role: 'narrator', content: 'Once upon a time' },
      ]);
      const result = await parser.parse('basic_json', content);
      expect(result.messages[0].role).toBe('user');
    });

    it('preserves participant name, timestamp, and model', async () => {
      const ts = '2025-01-15T10:00:00Z';
      const content = basicJson([
        { role: 'user', content: 'test', name: 'Alice', timestamp: ts, model: 'gpt-4' },
      ]);
      const result = await parser.parse('basic_json', content);
      expect(result.messages[0].participantName).toBe('Alice');
      expect(result.messages[0].timestamp).toEqual(new Date(ts));
      expect(result.messages[0].model).toBe('gpt-4');
    });

    it('preserves metadata from top-level object', async () => {
      const content = basicJson(
        [{ role: 'user', content: 'hi' }],
        'Title',
        { source: 'test', version: 2 }
      );
      const result = await parser.parse('basic_json', content);
      expect(result.metadata).toEqual({ source: 'test', version: 2 });
    });

    it('throws on invalid message format at specific index', async () => {
      // RawMessageSchema requires role and content
      const content = JSON.stringify({
        messages: [
          { role: 'user', content: 'valid' },
          { notRole: 'bad' },
        ],
      });
      await expect(parser.parse('basic_json', content)).rejects.toThrow(/index 1/);
    });

    it('handles empty messages array', async () => {
      const content = basicJson([]);
      const result = await parser.parse('basic_json', content);
      expect(result.messages).toHaveLength(0);
    });

    it('filters out empty strings from array content', async () => {
      const content = JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [{ text: '' }, { text: 'actual content' }, { value: '' }],
          },
        ],
      });
      const result = await parser.parse('basic_json', content);
      expect(result.messages[0].content).toBe('actual content');
    });
  });

  // ========== parseAnthropic ==========

  describe('parseAnthropic', () => {
    it('parses Claude.ai export format with chat_messages', async () => {
      const content = JSON.stringify({
        name: 'My Claude Chat',
        uuid: 'abc-123',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T01:00:00Z',
        chat_messages: [
          { sender: 'human', text: 'Hello Claude', created_at: '2025-01-01T00:00:00Z' },
          { sender: 'assistant', text: 'Hello!', created_at: '2025-01-01T00:01:00Z', model: 'claude-3-opus' },
        ],
      });
      const result = await parser.parse('anthropic', content);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello Claude');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toBe('Hello!');
      expect(result.messages[1].model).toBe('claude-3-opus');
      expect(result.title).toBe('My Claude Chat');
      expect(result.metadata).toEqual({
        uuid: 'abc-123',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T01:00:00Z',
      });
    });

    it('handles content array in chat_messages', async () => {
      const content = JSON.stringify({
        name: 'Test',
        chat_messages: [
          {
            sender: 'assistant',
            content: [
              { text: 'Part 1' },
              { text: 'Part 2' },
            ],
          },
        ],
      });
      const result = await parser.parse('anthropic', content);
      expect(result.messages[0].content).toBe('Part 1\nPart 2');
    });

    it('prefers text field over content field', async () => {
      const content = JSON.stringify({
        name: 'Test',
        chat_messages: [
          { sender: 'human', text: 'from text field', content: 'from content field' },
        ],
      });
      const result = await parser.parse('anthropic', content);
      expect(result.messages[0].content).toBe('from text field');
    });

    it('falls back to content string when text is absent', async () => {
      const content = JSON.stringify({
        name: 'Test',
        chat_messages: [
          { sender: 'human', content: 'fallback content' },
        ],
      });
      const result = await parser.parse('anthropic', content);
      expect(result.messages[0].content).toBe('fallback content');
    });

    it('falls back to parseBasicJson when name/chat_messages not present', async () => {
      const content = basicJson([
        { role: 'user', content: 'basic format' },
      ], 'Basic Title');
      const result = await parser.parse('anthropic', content);
      expect(result.messages[0].content).toBe('basic format');
      expect(result.title).toBe('Basic Title');
    });

    it('preserves timestamps from chat_messages', async () => {
      const ts = '2025-06-15T12:30:00Z';
      const content = JSON.stringify({
        name: 'Test',
        chat_messages: [
          { sender: 'human', text: 'hi', created_at: ts },
        ],
      });
      const result = await parser.parse('anthropic', content);
      expect(result.messages[0].timestamp).toEqual(new Date(ts));
    });

    it('handles empty chat_messages array', async () => {
      const content = JSON.stringify({
        name: 'Empty Chat',
        chat_messages: [],
      });
      const result = await parser.parse('anthropic', content);
      expect(result.messages).toHaveLength(0);
    });
  });

  // ========== parseChromeExtension ==========

  describe('parseChromeExtension', () => {
    it('parses chrome extension format with chat_messages', async () => {
      const content = JSON.stringify({
        name: 'Chrome Extension Chat',
        uuid: 'ext-123',
        model: 'claude-3-sonnet',
        chat_messages: [
          {
            uuid: 'msg-1',
            sender: 'human',
            text: 'Hello from extension',
            created_at: '2025-01-01T00:00:00Z',
            parent_message_uuid: '00000000-0000-4000-8000-000000000000',
            index: 0,
          },
          {
            uuid: 'msg-2',
            sender: 'assistant',
            text: 'Hello!',
            created_at: '2025-01-01T00:01:00Z',
            parent_message_uuid: 'msg-1',
            index: 1,
          },
        ],
      });
      const result = await parser.parse('chrome_extension', content);
      expect(result.messages.length).toBeGreaterThanOrEqual(2);
      expect(result.title).toBe('Chrome Extension Chat');
      // Check roles
      const userMsgs = result.messages.filter(m => m.role === 'user');
      const assistantMsgs = result.messages.filter(m => m.role === 'assistant');
      expect(userMsgs.length).toBeGreaterThanOrEqual(1);
      expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
    });

    it('uses summary or "Imported Conversation" as fallback title', async () => {
      const noName = JSON.stringify({
        summary: 'Summary title',
        chat_messages: [],
      });
      const result1 = await parser.parse('chrome_extension', noName);
      expect(result1.title).toBe('Summary title');

      const neither = JSON.stringify({
        chat_messages: [],
      });
      const result2 = await parser.parse('chrome_extension', neither);
      expect(result2.title).toBe('Imported Conversation');
    });

    it('skips empty messages', async () => {
      const content = JSON.stringify({
        name: 'Test',
        chat_messages: [
          {
            uuid: 'msg-1',
            sender: 'human',
            text: '   ',
            created_at: '2025-01-01T00:00:00Z',
            parent_message_uuid: '00000000-0000-4000-8000-000000000000',
            index: 0,
          },
          {
            uuid: 'msg-2',
            sender: 'human',
            text: 'Real message',
            created_at: '2025-01-01T00:01:00Z',
            parent_message_uuid: '00000000-0000-4000-8000-000000000000',
            index: 1,
          },
        ],
      });
      const result = await parser.parse('chrome_extension', content);
      expect(result.messages.every(m => m.content.trim().length > 0)).toBe(true);
    });

    it('handles content array with type=text blocks', async () => {
      const content = JSON.stringify({
        name: 'Test',
        chat_messages: [
          {
            uuid: 'msg-1',
            sender: 'assistant',
            content: [
              { type: 'text', text: 'Part 1' },
              { type: 'text', text: 'Part 2' },
              { type: 'image', url: 'http://example.com/img.png' }, // non-text, filtered
            ],
            created_at: '2025-01-01T00:00:00Z',
            parent_message_uuid: '00000000-0000-4000-8000-000000000000',
            index: 0,
          },
        ],
      });
      const result = await parser.parse('chrome_extension', content);
      expect(result.messages[0].content).toBe('Part 1\nPart 2');
    });

    it('preserves metadata fields', async () => {
      const content = JSON.stringify({
        name: 'Test',
        uuid: 'test-uuid',
        model: 'test-model',
        created_at: '2025-01-01',
        updated_at: '2025-01-02',
        settings: { temp: 0.7 },
        is_starred: true,
        current_leaf_message_uuid: 'leaf-1',
        chat_messages: [],
      });
      const result = await parser.parse('chrome_extension', content);
      expect(result.metadata.uuid).toBe('test-uuid');
      expect(result.metadata.model).toBe('test-model');
      expect(result.metadata.is_starred).toBe(true);
    });

    it('detects branches from shared parent messages', async () => {
      const content = JSON.stringify({
        name: 'Branching Chat',
        chat_messages: [
          {
            uuid: 'msg-1',
            sender: 'human',
            text: 'Root message',
            created_at: '2025-01-01T00:00:00Z',
            parent_message_uuid: '00000000-0000-4000-8000-000000000000',
            index: 0,
          },
          {
            uuid: 'msg-2a',
            sender: 'assistant',
            text: 'Response branch A',
            created_at: '2025-01-01T00:01:00Z',
            parent_message_uuid: 'msg-1',
            index: 1,
          },
          {
            uuid: 'msg-2b',
            sender: 'assistant',
            text: 'Response branch B',
            created_at: '2025-01-01T00:02:00Z',
            parent_message_uuid: 'msg-1',
            index: 1,
          },
        ],
        current_leaf_message_uuid: 'msg-2a',
      });
      const result = await parser.parse('chrome_extension', content);
      // Both branches should be present in messages
      const contents = result.messages.map(m => m.content);
      expect(contents).toContain('Root message');
      expect(contents).toContain('Response branch A');
      expect(contents).toContain('Response branch B');
    });

    it('uses model from parent data if message has no model', async () => {
      const content = JSON.stringify({
        name: 'Test',
        model: 'fallback-model',
        chat_messages: [
          {
            uuid: 'msg-1',
            sender: 'assistant',
            text: 'Response without model',
            created_at: '2025-01-01T00:00:00Z',
            parent_message_uuid: '00000000-0000-4000-8000-000000000000',
            index: 0,
          },
        ],
      });
      const result = await parser.parse('chrome_extension', content);
      expect(result.messages[0].model).toBe('fallback-model');
    });
  });

  // ========== parseArcChat ==========

  describe('parseArcChat', () => {
    function arcChatExport(opts: {
      title?: string;
      messages?: any[];
      participants?: any[];
      version?: string;
      format?: string;
    }): string {
      return JSON.stringify({
        conversation: {
          title: opts.title || 'Arc Chat Test',
          format: opts.format,
        },
        messages: opts.messages || [],
        participants: opts.participants || [],
        exportedAt: '2025-06-01T00:00:00Z',
        version: opts.version || '1.0',
      });
    }

    it('parses Arc Chat export with branches', async () => {
      const content = arcChatExport({
        title: 'My Arc Chat',
        participants: [
          { id: 'p1', name: 'Alice', type: 'user' },
          { id: 'p2', name: 'Claude', type: 'assistant', model: 'claude-3-opus' },
        ],
        messages: [
          {
            id: 'msg-1',
            createdAt: '2025-01-01T00:00:00Z',
            activeBranchId: 'b1',
            branches: [{
              id: 'b1',
              role: 'user',
              content: 'Hello Claude',
              participantName: 'Alice',
            }],
          },
          {
            id: 'msg-2',
            createdAt: '2025-01-01T00:01:00Z',
            activeBranchId: 'b2',
            branches: [{
              id: 'b2',
              role: 'assistant',
              content: 'Hello Alice!',
              participantName: 'Claude',
              parentBranchId: 'b1',
              model: 'claude-3-opus',
            }],
          },
        ],
      });
      const result = await parser.parse('arc_chat', content);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello Claude');
      expect(result.messages[0].participantName).toBe('Alice');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toBe('Hello Alice!');
      expect(result.title).toBe('My Arc Chat');
    });

    it('uses participants from export directly (not auto-detected)', async () => {
      const content = arcChatExport({
        participants: [
          { id: 'p1', name: 'User1', type: 'user' },
          { id: 'p2', name: 'Bot1', type: 'assistant', model: 'claude-3' },
          { id: 'p3', name: 'Bot2', type: 'assistant', model: 'gpt-4' },
        ],
        messages: [
          {
            id: 'msg-1',
            activeBranchId: 'b1',
            branches: [{ id: 'b1', role: 'user', content: 'Hi', participantName: 'User1' }],
          },
        ],
      });
      const result = await parser.parse('arc_chat', content);
      // Participants come from export, not auto-detected
      expect(result.detectedParticipants).toHaveLength(3);
      const bot2 = result.detectedParticipants.find(p => p.name === 'Bot2');
      expect(bot2).toBeDefined();
      expect(bot2!.role).toBe('assistant');
    });

    it('resolves participant name from participantId when participantName missing', async () => {
      const content = arcChatExport({
        participants: [
          { id: 'p1', name: 'Alice', type: 'user' },
        ],
        messages: [
          {
            id: 'msg-1',
            activeBranchId: 'b1',
            branches: [{ id: 'b1', role: 'user', content: 'Hi', participantId: 'p1' }],
          },
        ],
      });
      const result = await parser.parse('arc_chat', content);
      expect(result.messages[0].participantName).toBe('Alice');
    });

    it('falls back to "User"/"Assistant" when no participant info available', async () => {
      const content = arcChatExport({
        messages: [
          {
            id: 'msg-1',
            activeBranchId: 'b1',
            branches: [{ id: 'b1', role: 'user', content: 'Hi' }],
          },
          {
            id: 'msg-2',
            activeBranchId: 'b2',
            branches: [{ id: 'b2', role: 'assistant', content: 'Hello', parentBranchId: 'b1' }],
          },
        ],
      });
      const result = await parser.parse('arc_chat', content);
      expect(result.messages[0].participantName).toBe('User');
      expect(result.messages[1].participantName).toBe('Assistant');
    });

    it('skips messages with no content in active branch', async () => {
      const content = arcChatExport({
        messages: [
          {
            id: 'msg-1',
            activeBranchId: 'b1',
            branches: [{ id: 'b1', role: 'user', content: 'Has content' }],
          },
          {
            id: 'msg-2',
            activeBranchId: 'b2',
            branches: [{ id: 'b2', role: 'assistant', content: '' }],
          },
        ],
      });
      const result = await parser.parse('arc_chat', content);
      // Empty content message should be skipped (activeBranch.content is falsy)
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Has content');
    });

    it('defaults title to "Imported from Arc Chat" when conversation.title missing', async () => {
      const content = JSON.stringify({
        conversation: {},
        messages: [],
        participants: [],
      });
      const result = await parser.parse('arc_chat', content);
      expect(result.title).toBe('Imported from Arc Chat');
    });

    it('handles empty messages array', async () => {
      const content = arcChatExport({ messages: [] });
      const result = await parser.parse('arc_chat', content);
      expect(result.messages).toHaveLength(0);
    });

    it('uses conversation format from metadata for suggestedFormat', async () => {
      const content = arcChatExport({
        format: 'prefill',
        participants: [{ id: 'p1', name: 'A', type: 'user' }],
        messages: [
          {
            id: 'msg-1',
            activeBranchId: 'b1',
            branches: [{ id: 'b1', role: 'user', content: 'Hi', participantName: 'A' }],
          },
        ],
      });
      const result = await parser.parse('arc_chat', content);
      expect(result.suggestedFormat).toBe('prefill');
    });

    it('falls back to all messages when no root messages found', async () => {
      // All messages have parentBranchId set (no roots)
      const content = JSON.stringify({
        conversation: { title: 'No Roots' },
        messages: [
          {
            id: 'msg-1',
            createdAt: '2025-01-01T00:00:00Z',
            activeBranchId: 'b1',
            branches: [{ id: 'b1', role: 'user', content: 'Orphan 1', parentBranchId: 'b-nonexistent' }],
          },
          {
            id: 'msg-2',
            createdAt: '2025-01-01T00:01:00Z',
            activeBranchId: 'b2',
            branches: [{ id: 'b2', role: 'assistant', content: 'Orphan 2', parentBranchId: 'b-also-nonexistent' }],
          },
        ],
        participants: [],
      });
      const result = await parser.parse('arc_chat', content);
      // No root messages found, so fallback returns all sorted messages
      // Both messages should still appear since getVisibleMessagesFromExport falls back
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
    });

    it('follows active branch path for multi-root conversations', async () => {
      // Root 1 (older) and Root 2 (newer) - should pick the newer root
      const content = arcChatExport({
        messages: [
          {
            id: 'msg-old-root',
            createdAt: '2025-01-01T00:00:00Z',
            activeBranchId: 'b-old',
            branches: [{ id: 'b-old', role: 'user', content: 'Old root', createdAt: '2025-01-01T00:00:00Z' }],
          },
          {
            id: 'msg-new-root',
            createdAt: '2025-01-01T01:00:00Z',
            activeBranchId: 'b-new',
            branches: [{ id: 'b-new', role: 'user', content: 'New root', createdAt: '2025-01-01T01:00:00Z' }],
          },
          {
            id: 'msg-new-child',
            createdAt: '2025-01-01T01:01:00Z',
            activeBranchId: 'b-new-child',
            branches: [{ id: 'b-new-child', role: 'assistant', content: 'Child of new root', parentBranchId: 'b-new', createdAt: '2025-01-01T01:01:00Z' }],
          },
        ],
      });
      const result = await parser.parse('arc_chat', content);
      // Should follow the newer root's path
      const contents = result.messages.map(m => m.content);
      expect(contents).toContain('New root');
      expect(contents).toContain('Child of new root');
    });
  });

  // ========== parseOpenAI ==========

  describe('parseOpenAI', () => {
    it('parses ChatGPT export format with mapping', async () => {
      const content = JSON.stringify({
        title: 'ChatGPT Conversation',
        create_time: 1700000000,
        update_time: 1700003600,
        mapping: {
          'node-1': {
            message: {
              author: { role: 'user' },
              content: { parts: ['Hello ChatGPT'] },
              create_time: 1700000000,
              metadata: { model_slug: 'gpt-4' },
            },
          },
          'node-2': {
            message: {
              author: { role: 'assistant' },
              content: { parts: ['Hello! How can I help?'] },
              create_time: 1700000060,
              metadata: { model_slug: 'gpt-4' },
            },
          },
        },
      });
      const result = await parser.parse('openai', content);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello ChatGPT');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toBe('Hello! How can I help?');
      expect(result.title).toBe('ChatGPT Conversation');
    });

    it('converts Unix timestamps to Date objects (seconds, not ms)', async () => {
      const unixTime = 1700000000; // Nov 14, 2023
      const content = JSON.stringify({
        title: 'Test',
        mapping: {
          'node-1': {
            message: {
              author: { role: 'user' },
              content: { parts: ['test'] },
              create_time: unixTime,
            },
          },
        },
      });
      const result = await parser.parse('openai', content);
      expect(result.messages[0].timestamp).toEqual(new Date(unixTime * 1000));
    });

    it('skips nodes with empty content', async () => {
      const content = JSON.stringify({
        title: 'Test',
        mapping: {
          'node-1': {
            message: {
              author: { role: 'system' },
              content: { parts: ['   '] },
              create_time: 1700000000,
            },
          },
          'node-2': {
            message: {
              author: { role: 'user' },
              content: { parts: ['Real message'] },
              create_time: 1700000001,
            },
          },
        },
      });
      const result = await parser.parse('openai', content);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Real message');
    });

    it('skips nodes without message or content', async () => {
      const content = JSON.stringify({
        title: 'Test',
        mapping: {
          'node-empty': {},
          'node-no-content': { message: {} },
          'node-no-parts': { message: { content: {} } },
          'node-valid': {
            message: {
              author: { role: 'user' },
              content: { parts: ['Valid'] },
              create_time: 1700000000,
            },
          },
        },
      });
      const result = await parser.parse('openai', content);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Valid');
    });

    it('sorts messages by create_time', async () => {
      const content = JSON.stringify({
        title: 'Test',
        mapping: {
          'node-later': {
            message: {
              author: { role: 'assistant' },
              content: { parts: ['Second'] },
              create_time: 1700000060,
            },
          },
          'node-earlier': {
            message: {
              author: { role: 'user' },
              content: { parts: ['First'] },
              create_time: 1700000000,
            },
          },
        },
      });
      const result = await parser.parse('openai', content);
      expect(result.messages[0].content).toBe('First');
      expect(result.messages[1].content).toBe('Second');
    });

    it('joins multi-part content with newlines', async () => {
      const content = JSON.stringify({
        title: 'Test',
        mapping: {
          'node-1': {
            message: {
              author: { role: 'assistant' },
              content: { parts: ['Part 1', 'Part 2', 'Part 3'] },
              create_time: 1700000000,
            },
          },
        },
      });
      const result = await parser.parse('openai', content);
      expect(result.messages[0].content).toBe('Part 1\nPart 2\nPart 3');
    });

    it('preserves model_slug from metadata', async () => {
      const content = JSON.stringify({
        title: 'Test',
        mapping: {
          'node-1': {
            message: {
              author: { role: 'assistant' },
              content: { parts: ['Response'] },
              create_time: 1700000000,
              metadata: { model_slug: 'gpt-4-turbo' },
            },
          },
        },
      });
      const result = await parser.parse('openai', content);
      expect(result.messages[0].model).toBe('gpt-4-turbo');
    });

    it('falls back to parseBasicJson when not ChatGPT format', async () => {
      const content = basicJson([
        { role: 'user', content: 'basic' },
      ], 'Basic');
      const result = await parser.parse('openai', content);
      expect(result.messages[0].content).toBe('basic');
    });

    it('preserves create_time and update_time in metadata', async () => {
      const content = JSON.stringify({
        title: 'Test',
        create_time: 1700000000,
        update_time: 1700003600,
        mapping: {
          'node-1': {
            message: {
              author: { role: 'user' },
              content: { parts: ['hi'] },
              create_time: 1700000000,
            },
          },
        },
      });
      const result = await parser.parse('openai', content);
      expect(result.metadata).toEqual({
        create_time: 1700000000,
        update_time: 1700003600,
      });
    });
  });

  // ========== parseCursor (Markdown) ==========

  describe('parseCursor (Markdown format)', () => {
    it('parses Cursor markdown export', async () => {
      const content = `# My Cursor Chat

_Exported on 1/18/2026 at 13:59:20 PST from Cursor (2.3.29)_

---

**User**

How do I write tests?

---

**Cursor**

Here is how you write tests...`;

      const result = await parser.parse('cursor', content);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('How do I write tests?');
      expect(result.messages[0].participantName).toBe('User');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toBe('Here is how you write tests...');
      expect(result.messages[1].participantName).toBe('Cursor');
      expect(result.title).toBe('My Cursor Chat');
    });

    it('extracts metadata from export line', async () => {
      const content = `# Title

_Exported on 1/18/2026 at 13:59:20 PST from Cursor (2.3.29)_

---

**User**

Hello`;

      const result = await parser.parse('cursor', content);
      expect(result.metadata.exportedAt).toBe('1/18/2026 at 13:59:20 PST');
      expect(result.metadata.cursorVersion).toBe('2.3.29');
      expect(result.metadata.source).toBe('cursor');
    });

    it('identifies assistant speakers (cursor, assistant, claude, ai, gpt, chatgpt, gemini)', async () => {
      const speakers = ['Cursor', 'Assistant', 'Claude', 'AI', 'GPT', 'ChatGPT', 'Gemini'];
      for (const speaker of speakers) {
        const content = `---

**${speaker}**

Response text`;
        const result = await parser.parse('cursor', content);
        expect(result.messages[0].role).toBe('assistant');
      }
    });

    it('treats non-assistant speakers as user', async () => {
      const content = `---

**John**

Hello`;

      const result = await parser.parse('cursor', content);
      expect(result.messages[0].role).toBe('user');
    });

    it('skips bold text that appears too deep in a section (>50 chars in)', async () => {
      // Bold text appearing far into a section should not be treated as a speaker
      const content = `---

**User**

Here is a long message with some content. More text here to push things past 50 characters. **Bold Section Header** should not split.`;

      const result = await parser.parse('cursor', content);
      // Should only have one message (User), not split at the bold header
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toContain('Bold Section Header');
    });

    it('skips empty messages after speaker header', async () => {
      const content = `---

**User**

---

**Cursor**

Actual content`;

      const result = await parser.parse('cursor', content);
      // Only the non-empty message should be kept
      expect(result.messages.some(m => m.content === 'Actual content')).toBe(true);
      expect(result.messages.every(m => m.content.length > 0)).toBe(true);
    });

    it('defaults title to "Imported from Cursor" when no heading found', async () => {
      const content = `---

**User**

Hello`;
      const result = await parser.parse('cursor', content);
      expect(result.title).toBe('Imported from Cursor');
    });

    it('rejects bold text with colons/punctuation as speaker names', async () => {
      // **Section 3.4:** should not be treated as a speaker header
      const content = `---

**User**

Some message before **Section 3.4:** this bold text.`;

      const result = await parser.parse('cursor', content);
      // The bold text with colon should not start a new message
      expect(result.messages).toHaveLength(1);
    });
  });

  // ========== parseCursorJson ==========

  describe('parseCursorJson', () => {
    it('parses Cursor JSON export format', async () => {
      const content = JSON.stringify({
        metadata: {
          id: 'conv-1',
          name: 'Cursor JSON Chat',
          model: { modelName: 'claude-3.5-sonnet' },
          created: '2025-06-01T00:00:00Z',
          version: '1.0',
        },
        messages: [
          { role: 'user', text: 'Hello', created: '2025-06-01T00:00:00Z' },
          { role: 'assistant', text: 'Hi there!', created: '2025-06-01T00:01:00Z' },
        ],
      });
      const result = await parser.parse('cursor_json', content);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello');
      expect(result.messages[0].participantName).toBe('User');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toBe('Hi there!');
      expect(result.messages[1].participantName).toBe('Cursor');
      expect(result.messages[1].model).toBe('claude-3.5-sonnet');
      expect(result.title).toBe('Cursor JSON Chat');
    });

    it('merges consecutive same-role messages into one turn', async () => {
      const content = JSON.stringify({
        metadata: { name: 'Test' },
        messages: [
          { role: 'user', text: 'Part 1' },
          { role: 'user', text: 'Part 2' },
          { role: 'assistant', text: 'Response' },
        ],
      });
      const result = await parser.parse('cursor_json', content);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('Part 1\n\nPart 2');
      expect(result.messages[1].content).toBe('Response');
    });

    it('handles thinking blocks as contentBlocks metadata', async () => {
      const content = JSON.stringify({
        metadata: { name: 'Test' },
        messages: [
          { role: 'user', text: 'Question' },
          {
            role: 'assistant',
            thinking: { text: 'Let me think about this...', signature: 'sig123' },
            text: 'Here is the answer',
          },
        ],
      });
      const result = await parser.parse('cursor_json', content);
      expect(result.messages).toHaveLength(2);
      const assistantMsg = result.messages[1];
      expect(assistantMsg.content).toBe('Here is the answer');
      expect(assistantMsg.metadata?.contentBlocks).toBeDefined();
      expect(assistantMsg.metadata.contentBlocks).toHaveLength(2); // thinking + text
      expect(assistantMsg.metadata.contentBlocks[0].type).toBe('thinking');
      expect(assistantMsg.metadata.contentBlocks[0].thinking).toBe('Let me think about this...');
      expect(assistantMsg.metadata.contentBlocks[0].signature).toBe('sig123');
      expect(assistantMsg.metadata.contentBlocks[1].type).toBe('text');
    });

    it('handles read_file tool calls as attachments', async () => {
      const content = JSON.stringify({
        metadata: { name: 'Test' },
        messages: [
          { role: 'user', text: 'Read this file' },
          {
            role: 'assistant',
            tool_call: {
              name: 'read_file',
              params: JSON.stringify({ targetFile: 'src/utils/helpers.ts' }),
              result: JSON.stringify({ contents: 'export function helper() {}' }),
            },
            text: 'Here is the file content',
          },
        ],
      });
      const result = await parser.parse('cursor_json', content);
      const assistantMsg = result.messages[1];
      expect(assistantMsg.metadata?.attachments).toBeDefined();
      expect(assistantMsg.metadata.attachments).toHaveLength(1);
      expect(assistantMsg.metadata.attachments[0].fileName).toBe('helpers.ts');
      expect(assistantMsg.metadata.attachments[0].content).toBe('export function helper() {}');
      expect(assistantMsg.metadata.attachments[0].mimeType).toBe('text/typescript');
    });

    it('only assigns model to assistant messages', async () => {
      const content = JSON.stringify({
        metadata: {
          name: 'Test',
          model: { modelName: 'claude-3.5-sonnet' },
        },
        messages: [
          { role: 'user', text: 'Hello' },
          { role: 'assistant', text: 'Hi' },
        ],
      });
      const result = await parser.parse('cursor_json', content);
      expect(result.messages[0].model).toBeUndefined();
      expect(result.messages[1].model).toBe('claude-3.5-sonnet');
    });

    it('defaults title to "Imported from Cursor" when no name', async () => {
      const content = JSON.stringify({
        metadata: {},
        messages: [{ role: 'user', text: 'Hi' }],
      });
      const result = await parser.parse('cursor_json', content);
      expect(result.title).toBe('Imported from Cursor');
    });

    it('handles empty messages array', async () => {
      const content = JSON.stringify({
        metadata: { name: 'Empty' },
        messages: [],
      });
      const result = await parser.parse('cursor_json', content);
      expect(result.messages).toHaveLength(0);
    });

    it('preserves metadata from export', async () => {
      const content = JSON.stringify({
        metadata: {
          id: 'conv-123',
          name: 'Test',
          model: { modelName: 'gpt-4' },
          subtitle: 'A subtitle',
          created: '2025-06-01',
          version: '2.0',
        },
        messages: [{ role: 'user', text: 'Hi' }],
      });
      const result = await parser.parse('cursor_json', content);
      expect(result.metadata.id).toBe('conv-123');
      expect(result.metadata.model).toBe('gpt-4');
      expect(result.metadata.source).toBe('cursor_json');
      expect(result.metadata.version).toBe('2.0');
    });

    it('gracefully handles unparseable read_file results', async () => {
      const content = JSON.stringify({
        metadata: { name: 'Test' },
        messages: [
          {
            role: 'assistant',
            tool_call: {
              name: 'read_file',
              params: 'not valid json',
              result: 'also not valid json',
            },
            text: 'I tried to read the file',
          },
        ],
      });
      const result = await parser.parse('cursor_json', content);
      // Should still produce a message despite parse failure in the catch block
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('I tried to read the file');
      // No attachments since parse failed
      expect(result.messages[0].metadata?.attachments || []).toHaveLength(0);
    });

    it('handles read_file with contentsAfterEdit field', async () => {
      const content = JSON.stringify({
        metadata: { name: 'Test' },
        messages: [
          {
            role: 'assistant',
            tool_call: {
              name: 'read_file',
              params: JSON.stringify({ relativeWorkspacePath: 'src/main.ts' }),
              result: JSON.stringify({ contentsAfterEdit: 'edited content' }),
            },
            text: 'Edited',
          },
        ],
      });
      const result = await parser.parse('cursor_json', content);
      expect(result.messages[0].metadata?.attachments?.[0].content).toBe('edited content');
      expect(result.messages[0].metadata?.attachments?.[0].fileName).toBe('main.ts');
    });

    it('skips read_file attachment when file content is empty', async () => {
      const content = JSON.stringify({
        metadata: { name: 'Test' },
        messages: [
          {
            role: 'assistant',
            tool_call: {
              name: 'read_file',
              params: JSON.stringify({ targetFile: 'empty.txt' }),
              result: JSON.stringify({ contents: '' }),
            },
            text: 'Empty file',
          },
        ],
      });
      const result = await parser.parse('cursor_json', content);
      // Empty content should not create an attachment
      expect(result.messages[0].metadata?.attachments || []).toHaveLength(0);
    });

    it('does not add contentBlocks for user messages', async () => {
      const content = JSON.stringify({
        metadata: { name: 'Test' },
        messages: [
          {
            role: 'user',
            thinking: { text: 'Should not appear' },
            text: 'User message',
          },
        ],
      });
      const result = await parser.parse('cursor_json', content);
      // contentBlocks should not be added for user role
      expect(result.messages[0].metadata?.contentBlocks).toBeUndefined();
    });

    it('handles non-read_file tool calls without creating attachments', async () => {
      const content = JSON.stringify({
        metadata: { name: 'Test' },
        messages: [
          {
            role: 'assistant',
            tool_call: {
              name: 'run_terminal_command',
              params: '{"command": "ls"}',
              result: 'file1.txt\nfile2.txt',
            },
            text: 'Listed files',
          },
        ],
      });
      const result = await parser.parse('cursor_json', content);
      expect(result.messages[0].metadata?.attachments || []).toHaveLength(0);
    });

    it('handles thinking without signature', async () => {
      const content = JSON.stringify({
        metadata: { name: 'Test' },
        messages: [
          {
            role: 'assistant',
            thinking: { text: 'Thinking...' },
            text: 'Answer',
          },
        ],
      });
      const result = await parser.parse('cursor_json', content);
      const thinkingBlock = result.messages[0].metadata?.contentBlocks?.[0];
      expect(thinkingBlock?.thinking).toBe('Thinking...');
      expect(thinkingBlock?.signature).toBeUndefined();
    });
  });

  // ========== parseColonFormat ==========

  describe('parseColonFormat', () => {
    it('parses single-newline colon format', async () => {
      const content = `Human: Hello there
Assistant: Hi! How can I help?
Human: Write me a poem`;
      const result = await parser.parse('colon_single', content);
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello there');
      expect(result.messages[0].participantName).toBe('Human');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toBe('Hi! How can I help?');
      expect(result.messages[2].content).toBe('Write me a poem');
    });

    it('parses double-newline colon format', async () => {
      const content = `Human: Hello there\n\nAssistant: Hi! How can I help?`;
      const result = await parser.parse('colon_double', content);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('Hello there');
      expect(result.messages[1].content).toBe('Hi! How can I help?');
    });

    it('guesses assistant role from common AI names', async () => {
      const names = ['Assistant', 'Claude', 'GPT', 'AI Bot', 'Model'];
      for (const name of names) {
        const content = `${name}: Hello`;
        const result = await parser.parse('colon_single', content);
        expect(result.messages[0].role).toBe('assistant');
      }
    });

    it('defaults to user role for unknown names', async () => {
      const content = `Alice: Hello\nBob: Hi`;
      const result = await parser.parse('colon_single', content);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('user');
    });

    it('appends blocks without colons to the previous message', async () => {
      const content = `Human: Hello\nThis is a continuation\nAssistant: Response`;
      const result = await parser.parse('colon_single', content);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('Hello\nThis is a continuation');
    });

    it('silently drops orphaned blocks without colons when no previous message', async () => {
      const content = `Just some text without a header`;
      const result = await parser.parse('colon_single', content);
      // Block has no colon (colonIndex === -1), no previous message to append to, so dropped
      expect(result.messages).toHaveLength(0);
    });

    it('creates Unknown user message for blocks with invalid name at start', async () => {
      // Block has a colon but name is invalid (too long or not allowed)
      const longName = 'A'.repeat(51);
      const content = `${longName}: Some text`;
      const result = await parser.parse('colon_single', content);
      // isValidNameFormat is false (name > 50 chars), no previous message
      // Falls to else branch: creates Unknown participant
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].participantName).toBe('Unknown');
    });

    it('rejects names longer than 50 characters and appends to previous when possible', async () => {
      const longName = 'A'.repeat(51);
      const content = `Human: Start\n${longName}: Some text`;
      const result = await parser.parse('colon_single', content);
      // The long name block has invalid format, so it's appended to the Human message
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].participantName).toBe('Human');
      expect(result.messages[0].content).toContain('Start');
      expect(result.messages[0].content).toContain(longName);
    });

    it('rejects names containing newlines and appends to previous message', async () => {
      // With double-newline separator, "Human: Hello\n\nLine1\nLine2: some text"
      // splits into ["Human: Hello", "Line1\nLine2: some text"]
      // Second block: potentialName="Line1\nLine2" contains newline => invalid name
      // Since there's a previous message, it gets appended to it
      const content = `Human: Hello\n\nLine1\nLine2: some text`;
      const result = await parser.parse('colon_double', content);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].participantName).toBe('Human');
      // The invalid block is appended with the separator
      expect(result.messages[0].content).toContain('Hello');
      expect(result.messages[0].content).toContain('Line1');
      expect(result.messages[0].content).toContain('Line2');
    });

    it('generates title from first message content (truncated to 50 chars)', async () => {
      const longContent = 'A'.repeat(100);
      const content = `Human: ${longContent}`;
      const result = await parser.parse('colon_single', content);
      expect(result.title).toBe('A'.repeat(50) + '...');
    });

    it('handles title without ellipsis for short content', async () => {
      const content = `Human: Short message`;
      const result = await parser.parse('colon_single', content);
      expect(result.title).toBe('Short message');
    });

    it('returns undefined title for empty conversation', async () => {
      // All blocks empty after filtering
      const content = '   ';
      const result = await parser.parse('colon_single', content);
      expect(result.title).toBeUndefined();
    });

    it('respects allowedParticipants filter', async () => {
      const content = `Alice: Hello\nBob: Hi\nNotAParticipant: Text`;
      const result = await parser.parse('colon_single', content, {
        allowedParticipants: ['Alice', 'Bob'],
      });
      // 'NotAParticipant' should be appended to Bob's message
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].participantName).toBe('Alice');
      expect(result.messages[1].participantName).toBe('Bob');
      expect(result.messages[1].content).toContain('NotAParticipant');
    });

    it('does not limit participants when allowedParticipants is provided', async () => {
      // With allowedParticipants, the MAX_AUTO_DETECTED_PARTICIPANTS limit should not apply
      const content = `Alice: Hello\nBob: Hi`;
      const result = await parser.parse('colon_single', content, {
        allowedParticipants: ['Alice', 'Bob'],
      });
      expect(result.detectedParticipants).toHaveLength(2);
    });

    it('handles blocks where colon is present but text is empty', async () => {
      // Name:  (empty text after colon)
      const content = `Human: \nAssistant: Response`;
      const result = await parser.parse('colon_single', content);
      // "Human: " has no text, so it's not a valid message
      // It should be appended as-is to previous or create Unknown
      // Since there's no previous message and the text is empty,
      // it falls through to the else branch
      expect(result.messages.some(m => m.content === 'Response')).toBe(true);
    });
  });

  // ========== guessMimeType (via parseCursorJson) ==========

  describe('guessMimeType', () => {
    it('returns correct MIME types for known extensions', async () => {
      const extensions: Record<string, string> = {
        'file.ts': 'text/typescript',
        'file.tsx': 'text/typescript',
        'file.js': 'text/javascript',
        'file.jsx': 'text/javascript',
        'file.json': 'application/json',
        'file.md': 'text/markdown',
        'file.txt': 'text/plain',
        'file.py': 'text/x-python',
        'file.rs': 'text/x-rust',
        'file.go': 'text/x-go',
        'file.vue': 'text/x-vue',
        'file.css': 'text/css',
        'file.html': 'text/html',
        'file.yaml': 'text/yaml',
        'file.yml': 'text/yaml',
        'file.sh': 'text/x-shellscript',
        'file.sql': 'text/x-sql',
      };

      for (const [filename, expectedMime] of Object.entries(extensions)) {
        const content = JSON.stringify({
          metadata: { name: 'Test' },
          messages: [
            {
              role: 'assistant',
              tool_call: {
                name: 'read_file',
                params: JSON.stringify({ targetFile: filename }),
                result: JSON.stringify({ contents: 'content here' }),
              },
              text: 'Done',
            },
          ],
        });
        const result = await parser.parse('cursor_json', content);
        const attachment = result.messages[0].metadata?.attachments?.[0];
        expect(attachment?.mimeType).toBe(expectedMime);
      }
    });

    it('returns text/plain for unknown extensions', async () => {
      const content = JSON.stringify({
        metadata: { name: 'Test' },
        messages: [
          {
            role: 'assistant',
            tool_call: {
              name: 'read_file',
              params: JSON.stringify({ targetFile: 'file.xyz' }),
              result: JSON.stringify({ contents: 'content' }),
            },
            text: 'Done',
          },
        ],
      });
      const result = await parser.parse('cursor_json', content);
      expect(result.messages[0].metadata?.attachments?.[0]?.mimeType).toBe('text/plain');
    });
  });

  // ========== sortMessagesByTreeOrder (via parseArcChat) ==========

  describe('sortMessagesByTreeOrder', () => {
    it('sorts parent messages before children', async () => {
      // Provide messages in wrong order (child before parent)
      const content = JSON.stringify({
        conversation: { title: 'Tree Order Test' },
        messages: [
          {
            id: 'msg-child',
            createdAt: '2025-01-01T00:01:00Z',
            activeBranchId: 'b-child',
            branches: [{
              id: 'b-child',
              role: 'assistant',
              content: 'Child message',
              parentBranchId: 'b-parent',
              createdAt: '2025-01-01T00:01:00Z',
            }],
          },
          {
            id: 'msg-parent',
            createdAt: '2025-01-01T00:00:00Z',
            activeBranchId: 'b-parent',
            branches: [{
              id: 'b-parent',
              role: 'user',
              content: 'Parent message',
              createdAt: '2025-01-01T00:00:00Z',
            }],
          },
        ],
        participants: [],
      });
      const result = await parser.parse('arc_chat', content);
      // Parent should come before child in the output
      const parentIdx = result.messages.findIndex(m => m.content === 'Parent message');
      const childIdx = result.messages.findIndex(m => m.content === 'Child message');
      expect(parentIdx).toBeLessThan(childIdx);
    });
  });
});
