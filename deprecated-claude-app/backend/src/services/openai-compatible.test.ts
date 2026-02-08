import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { Message } from '@deprecated-claude/shared';

// Mock the Database
vi.mock('../database/index.js', () => ({
  Database: class MockDatabase {},
}));

// Mock llmLogger
vi.mock('../utils/llmLogger.js', () => ({
  llmLogger: { logRequest: vi.fn(), logResponse: vi.fn(), logCustom: vi.fn() },
}));

import { OpenAICompatibleService } from './openai-compatible.js';
import { Database } from '../database/index.js';

function makeMessage(
  content: string,
  role: 'user' | 'assistant' | 'system' = 'user',
  opts?: {
    contentBlocks?: any[];
    attachments?: any[];
  }
): Message {
  const branchId = randomUUID();
  const branch: any = {
    id: branchId,
    content,
    role,
    createdAt: new Date(),
  };
  if (opts?.contentBlocks) branch.contentBlocks = opts.contentBlocks;
  if (opts?.attachments) branch.attachments = opts.attachments;
  return {
    id: randomUUID(),
    conversationId: randomUUID(),
    order: 0,
    activeBranchId: branchId,
    branches: [branch],
  };
}

describe('OpenAICompatibleService', () => {
  let service: OpenAICompatibleService;

  beforeEach(() => {
    const mockDb = new Database() as any;
    service = new OpenAICompatibleService(mockDb, 'test-key', 'https://api.example.com');
  });

  describe('formatMessagesForOpenAI', () => {
    it('formats simple user and assistant messages', () => {
      const messages = [
        makeMessage('Hello', 'user'),
        makeMessage('Hi there', 'assistant'),
      ];
      const result = service.formatMessagesForOpenAI(messages);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'Hi there' });
    });

    it('adds system prompt at the beginning when provided', () => {
      const messages = [makeMessage('Question', 'user')];
      const result = service.formatMessagesForOpenAI(messages, 'Be concise');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'system', content: 'Be concise' });
      expect(result[1]).toEqual({ role: 'user', content: 'Question' });
    });

    it('skips system messages from the message array', () => {
      const messages = [
        makeMessage('System in array', 'system'),
        makeMessage('User msg', 'user'),
      ];
      const result = service.formatMessagesForOpenAI(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
    });

    it('preserves multi-turn ordering', () => {
      const messages = [
        makeMessage('Q1', 'user'),
        makeMessage('A1', 'assistant'),
        makeMessage('Q2', 'user'),
        makeMessage('A2', 'assistant'),
      ];
      const result = service.formatMessagesForOpenAI(messages);

      expect(result.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    });

    // --- Thinking blocks ---

    it('prepends thinking blocks as <think> tags for assistant messages', () => {
      const messages = [
        makeMessage('The answer is 42', 'assistant', {
          contentBlocks: [
            { type: 'thinking', thinking: 'Deep reasoning here' },
            { type: 'text', text: 'The answer is 42' },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenAI(messages);

      expect(result).toHaveLength(1);
      expect(result[0].content).toContain('<think>');
      expect(result[0].content).toContain('Deep reasoning here');
      expect(result[0].content).toContain('</think>');
      expect(result[0].content).toContain('The answer is 42');
      // Thinking tags should come BEFORE the main content
      const thinkIdx = result[0].content.indexOf('<think>');
      const contentIdx = result[0].content.indexOf('The answer is 42');
      expect(thinkIdx).toBeLessThan(contentIdx);
    });

    it('handles redacted_thinking blocks', () => {
      const messages = [
        makeMessage('Response', 'assistant', {
          contentBlocks: [
            { type: 'redacted_thinking', data: 'encrypted' },
            { type: 'text', text: 'Response' },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenAI(messages);

      expect(result[0].content).toContain('<think>[Redacted for safety]</think>');
      expect(result[0].content).toContain('Response');
    });

    it('does not add thinking tags for user messages', () => {
      const messages = [
        makeMessage('User message', 'user', {
          contentBlocks: [
            { type: 'thinking', thinking: 'Should not appear' },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenAI(messages);

      // User messages don't get thinking prepended
      expect(result[0].content).not.toContain('<think>');
      expect(result[0].content).toBe('User message');
    });

    // --- Attachments ---

    it('appends text attachments inline to user messages', () => {
      const messages = [
        makeMessage('Review this', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'code.py',
              fileSize: 50,
              fileType: 'py',
              content: 'print("hello")',
              encoding: 'text',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenAI(messages);

      expect(result[0].content).toContain('Review this');
      expect(result[0].content).toContain('<attachment filename="code.py">');
      expect(result[0].content).toContain('print("hello")');
    });

    it('appends multiple attachments', () => {
      const messages = [
        makeMessage('Check both', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'a.txt',
              fileSize: 10,
              fileType: 'txt',
              content: 'File A',
              encoding: 'text',
              createdAt: new Date(),
            },
            {
              id: randomUUID(),
              fileName: 'b.txt',
              fileSize: 10,
              fileType: 'txt',
              content: 'File B',
              encoding: 'text',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenAI(messages);

      expect(result[0].content).toContain('File A');
      expect(result[0].content).toContain('File B');
      expect(result[0].content).toContain('filename="a.txt"');
      expect(result[0].content).toContain('filename="b.txt"');
    });

    // --- Edge cases ---

    it('returns empty array for empty messages', () => {
      const result = service.formatMessagesForOpenAI([]);
      expect(result).toEqual([]);
    });

    it('handles message with no active branch', () => {
      const message: Message = {
        id: randomUUID(),
        conversationId: randomUUID(),
        order: 0,
        activeBranchId: 'nonexistent',
        branches: [{ id: randomUUID(), content: 'ghost', role: 'user', createdAt: new Date() }],
      };
      const result = service.formatMessagesForOpenAI([message]);
      expect(result).toEqual([]);
    });

    it('includes system prompt even when messages are empty', () => {
      const result = service.formatMessagesForOpenAI([], 'System prompt');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ role: 'system', content: 'System prompt' });
    });
  });

  describe('parseThinkingTags (private)', () => {
    it('parses single <think> block and extracts text', () => {
      const svc = service as any;
      const result = svc.parseThinkingTags(
        '<think>Reasoning here</think>\n\nThe answer is 42'
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: 'thinking', thinking: 'Reasoning here' });
      expect(result[1]).toEqual({ type: 'text', text: 'The answer is 42' });
    });

    it('parses multiple <think> blocks', () => {
      const svc = service as any;
      const result = svc.parseThinkingTags(
        '<think>Step 1</think>\n<think>Step 2</think>\nFinal answer'
      );

      expect(result).toHaveLength(3);
      expect(result[0].thinking).toBe('Step 1');
      expect(result[1].thinking).toBe('Step 2');
      expect(result[2].text).toBe('Final answer');
    });

    it('returns empty array when no think tags', () => {
      const svc = service as any;
      const result = svc.parseThinkingTags('Plain text without thinking');
      expect(result).toEqual([]);
    });

    it('skips empty think blocks', () => {
      const svc = service as any;
      const result = svc.parseThinkingTags('<think></think>Some text');
      expect(result).toEqual([]);
    });

    it('handles think block with only thinking and no text after', () => {
      const svc = service as any;
      const result = svc.parseThinkingTags('<think>Just thinking</think>');

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('thinking');
      expect(result[0].thinking).toBe('Just thinking');
    });

    it('handles multiline content in think tags', () => {
      const svc = service as any;
      const result = svc.parseThinkingTags(
        '<think>\nLine 1\nLine 2\nLine 3\n</think>\nResponse'
      );

      expect(result).toHaveLength(2);
      expect(result[0].thinking).toContain('Line 1');
      expect(result[0].thinking).toContain('Line 2');
      expect(result[0].thinking).toContain('Line 3');
    });
  });
});
