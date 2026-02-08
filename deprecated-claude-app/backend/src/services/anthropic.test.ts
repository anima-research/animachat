import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { Message } from '@deprecated-claude/shared';

// Mock sharp (image processing) — we don't want real image manipulation in tests
vi.mock('sharp', () => {
  const mockSharp = vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 1000, height: 800 }),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized-image-data')),
  }));
  return { default: mockSharp };
});

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: vi.fn() };
    constructor(_opts?: any) {}
  }
  return { default: MockAnthropic };
});

// Mock the Database
vi.mock('../database/index.js', () => {
  return {
    Database: class MockDatabase {},
  };
});

// Mock llmLogger
vi.mock('../utils/llmLogger.js', () => ({
  llmLogger: {
    logRequest: vi.fn(),
    logResponse: vi.fn(),
    logCustom: vi.fn(),
  },
}));

import { AnthropicService } from './anthropic.js';
import { Database } from '../database/index.js';

// Helper: create a Message with a single active branch
function makeMessage(
  content: string,
  role: 'user' | 'assistant' | 'system' = 'user',
  opts?: {
    contentBlocks?: any[];
    attachments?: any[];
    cacheControl?: any;
    hasCacheBreakpoints?: boolean;
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
  if (opts?.cacheControl) branch._cacheControl = opts.cacheControl;
  if (opts?.hasCacheBreakpoints) branch._hasCacheBreakpoints = true;

  return {
    id: randomUUID(),
    conversationId: randomUUID(),
    order: 0,
    activeBranchId: branchId,
    branches: [branch],
  };
}

describe('AnthropicService', () => {
  let service: AnthropicService;

  beforeEach(() => {
    const mockDb = new Database() as any;
    service = new AnthropicService(mockDb, 'test-api-key');
  });

  describe('formatMessagesForAnthropic', () => {
    it('formats a simple user message as a string', async () => {
      const messages = [makeMessage('Hello Claude')];
      const result = await service.formatMessagesForAnthropic(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Hello Claude');
    });

    it('formats a simple assistant message as a string', async () => {
      const messages = [makeMessage('Hi there!', 'assistant')];
      const result = await service.formatMessagesForAnthropic(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('Hi there!');
    });

    it('skips system role messages', async () => {
      const messages = [
        makeMessage('You are a helpful assistant', 'system'),
        makeMessage('Hello', 'user'),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Hello');
    });

    it('skips messages with empty content', async () => {
      const messages = [
        makeMessage('', 'user'),
        makeMessage('   ', 'user'),
        makeMessage('Non-empty', 'user'),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Non-empty');
    });

    it('preserves multi-turn conversation ordering', async () => {
      const messages = [
        makeMessage('Question 1', 'user'),
        makeMessage('Answer 1', 'assistant'),
        makeMessage('Question 2', 'user'),
        makeMessage('Answer 2', 'assistant'),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ role: 'user', content: 'Question 1' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'Answer 1' });
      expect(result[2]).toEqual({ role: 'user', content: 'Question 2' });
      expect(result[3]).toEqual({ role: 'assistant', content: 'Answer 2' });
    });

    it('uses the active branch content from messages with multiple branches', async () => {
      const activeBranchId = randomUUID();
      const inactiveBranchId = randomUUID();
      const message: Message = {
        id: randomUUID(),
        conversationId: randomUUID(),
        order: 0,
        activeBranchId,
        branches: [
          {
            id: inactiveBranchId,
            content: 'Inactive branch content',
            role: 'user',
            createdAt: new Date(),
          },
          {
            id: activeBranchId,
            content: 'Active branch content',
            role: 'user',
            createdAt: new Date(),
          },
        ],
      };
      const result = await service.formatMessagesForAnthropic([message]);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Active branch content');
    });

    // --- Attachment handling ---

    it('formats user message with image attachment as content blocks', async () => {
      const smallBase64 = Buffer.from('tiny').toString('base64'); // Well under 4MB
      const messages = [
        makeMessage('Describe this image', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'photo.png',
              fileSize: 100,
              fileType: 'png',
              content: smallBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(Array.isArray(result[0].content)).toBe(true);

      const parts = result[0].content as any[];
      expect(parts).toHaveLength(2);
      expect(parts[0]).toEqual({ type: 'text', text: 'Describe this image' });
      expect(parts[1].type).toBe('image');
      expect(parts[1].source.type).toBe('base64');
      expect(parts[1].source.media_type).toBe('image/png');
      expect(parts[1].source.data).toBe(smallBase64);
    });

    it('formats user message with PDF attachment as document block', async () => {
      const pdfBase64 = Buffer.from('pdf-content').toString('base64');
      const messages = [
        makeMessage('Read this PDF', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'document.pdf',
              fileSize: 200,
              fileType: 'pdf',
              content: pdfBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      expect(parts).toHaveLength(2);
      expect(parts[1].type).toBe('document');
      expect(parts[1].source.media_type).toBe('application/pdf');
      expect(parts[1].source.data).toBe(pdfBase64);
    });

    it('appends text attachment content inline', async () => {
      const messages = [
        makeMessage('Check this code', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'main.ts',
              fileSize: 50,
              fileType: 'ts',
              content: 'console.log("hello")',
              encoding: 'text',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('text');
      expect(parts[0].text).toContain('Check this code');
      expect(parts[0].text).toContain('<attachment filename="main.ts">');
      expect(parts[0].text).toContain('console.log("hello")');
    });

    it('handles multiple mixed attachments in one message', async () => {
      const imgBase64 = Buffer.from('img').toString('base64');
      const messages = [
        makeMessage('Multi attachment', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'photo.jpg',
              fileSize: 100,
              fileType: 'jpg',
              content: imgBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
            {
              id: randomUUID(),
              fileName: 'notes.txt',
              fileSize: 20,
              fileType: 'txt',
              content: 'Some notes',
              encoding: 'text',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      // 1 text block (with appended txt) + 1 image block
      expect(parts).toHaveLength(2);
      expect(parts[0].type).toBe('text');
      expect(parts[0].text).toContain('Some notes');
      expect(parts[1].type).toBe('image');
      expect(parts[1].source.media_type).toBe('image/jpeg');
    });

    // --- Cache control ---

    it('adds cache_control to simple text message when _cacheControl is set', async () => {
      const cacheControl = { type: 'ephemeral' as const, ttl: '1h' as const };
      const messages = [makeMessage('Cached message', 'user', { cacheControl })];
      const result = await service.formatMessagesForAnthropic(messages);

      expect(result).toHaveLength(1);
      // Should be in content block format, not plain string
      const parts = result[0].content as any[];
      expect(Array.isArray(parts)).toBe(true);
      expect(parts[0].type).toBe('text');
      expect(parts[0].text).toBe('Cached message');
      expect(parts[0].cache_control).toEqual(cacheControl);
    });

    it('adds cache_control to the last content part when message has attachments', async () => {
      const cacheControl = { type: 'ephemeral' as const, ttl: '1h' as const };
      const imgBase64 = Buffer.from('small-img').toString('base64');
      const messages = [
        makeMessage('Describe', 'user', {
          cacheControl,
          attachments: [
            {
              id: randomUUID(),
              fileName: 'img.png',
              fileSize: 50,
              fileType: 'png',
              content: imgBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      // cache_control should be on the LAST part
      expect(parts[parts.length - 1].cache_control).toEqual(cacheControl);
      // First part (text) should NOT have cache_control
      expect(parts[0].cache_control).toBeUndefined();
    });

    // --- Cache breakpoints ---

    it('splits content at cache breakpoints into separate blocks', async () => {
      const content = 'Section A<|cache_breakpoint|>Section B<|cache_breakpoint|>Section C';
      const messages = [
        makeMessage(content, 'user', { hasCacheBreakpoints: true }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      expect(parts).toHaveLength(3);
      // First two sections get cache_control, last one doesn't
      expect(parts[0].text).toBe('Section A');
      expect(parts[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
      expect(parts[1].text).toBe('Section B');
      expect(parts[1].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
      expect(parts[2].text).toBe('Section C');
      expect(parts[2].cache_control).toBeUndefined();
    });

    it('handles cache breakpoint content with empty sections', async () => {
      const content = '<|cache_breakpoint|>Only content after marker';
      const messages = [
        makeMessage(content, 'user', { hasCacheBreakpoints: true }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      // Empty first section should be skipped
      expect(parts).toHaveLength(1);
      expect(parts[0].text).toBe('Only content after marker');
      // Since it's the only section (last), no cache_control
      expect(parts[0].cache_control).toBeUndefined();
    });

    // --- Thinking blocks (assistant messages) ---

    it('formats assistant message with signed thinking blocks as structured content', async () => {
      const messages = [
        makeMessage('The answer is 42', 'assistant', {
          contentBlocks: [
            { type: 'thinking', thinking: 'Let me think...', signature: 'sig123' },
            { type: 'text', text: 'The answer is 42' },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      expect(Array.isArray(parts)).toBe(true);
      expect(parts).toHaveLength(2);
      expect(parts[0]).toEqual({
        type: 'thinking',
        thinking: 'Let me think...',
        signature: 'sig123',
      });
      expect(parts[1]).toEqual({
        type: 'text',
        text: 'The answer is 42',
      });
    });

    it('converts unsigned thinking blocks to XML text instead of structured blocks', async () => {
      const messages = [
        makeMessage('The answer is 42', 'assistant', {
          contentBlocks: [
            { type: 'thinking', thinking: 'Unsigned thinking' },
            { type: 'text', text: 'The answer is 42' },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      // Unsigned thinking gets converted to text prepended to the text block
      // Should NOT have a structured thinking block
      const thinkingBlocks = parts.filter((p: any) => p.type === 'thinking');
      expect(thinkingBlocks).toHaveLength(0);

      const textBlocks = parts.filter((p: any) => p.type === 'text');
      expect(textBlocks).toHaveLength(1);
      expect(textBlocks[0].text).toContain('<thinking>');
      expect(textBlocks[0].text).toContain('Unsigned thinking');
      expect(textBlocks[0].text).toContain('</thinking>');
      expect(textBlocks[0].text).toContain('The answer is 42');
    });

    it('handles redacted_thinking blocks in assistant messages', async () => {
      const messages = [
        makeMessage('Response', 'assistant', {
          contentBlocks: [
            { type: 'redacted_thinking', data: 'encrypted-data' },
            { type: 'text', text: 'Response' },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      expect(parts).toHaveLength(2);
      expect(parts[0]).toEqual({
        type: 'redacted_thinking',
        data: 'encrypted-data',
      });
      expect(parts[1]).toEqual({
        type: 'text',
        text: 'Response',
      });
    });

    it('adds main content as text block when contentBlocks has only thinking blocks', async () => {
      const messages = [
        makeMessage('Visible response', 'assistant', {
          contentBlocks: [
            { type: 'thinking', thinking: 'Deep thought', signature: 'sig456' },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      // Should have thinking block + text block from main content
      expect(parts).toHaveLength(2);
      expect(parts[0].type).toBe('thinking');
      expect(parts[1]).toEqual({
        type: 'text',
        text: 'Visible response',
      });
    });

    it('applies cache_control to last block of assistant message with thinking', async () => {
      const cacheControl = { type: 'ephemeral' as const, ttl: '1h' as const };
      const messages = [
        makeMessage('Response', 'assistant', {
          cacheControl,
          contentBlocks: [
            { type: 'thinking', thinking: 'Hmm', signature: 'sig789' },
            { type: 'text', text: 'Response' },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      // cache_control on the last block
      expect(parts[parts.length - 1].cache_control).toEqual(cacheControl);
      // Not on the first block
      expect(parts[0].cache_control).toBeUndefined();
    });

    // --- Prefill-mode thinking in user/assistant messages ---

    it('prepends thinking tags to prefill-format messages with content blocks', async () => {
      // Prefill format: content starts with a participant name followed by ':'
      const content = 'Claude: Some response';
      const messages = [
        makeMessage(content, 'user', {
          contentBlocks: [
            { type: 'thinking', thinking: 'Prefill thinking' },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      // For user messages with attachments path won't trigger, so this goes through the
      // simple text path. Content should have thinking tags prepended.
      const msgContent = result[0].content as string;
      expect(msgContent).toContain('<thinking>');
      expect(msgContent).toContain('Prefill thinking');
      expect(msgContent).toContain('Claude: Some response');
    });

    it('prepends redacted thinking tags in prefill-format messages', async () => {
      const content = 'Claude: Some prefill response';
      const messages = [
        makeMessage(content, 'user', {
          contentBlocks: [
            { type: 'redacted_thinking', data: 'encrypted' },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const msgContent = result[0].content as string;
      expect(msgContent).toContain('<thinking>[Redacted for safety]</thinking>');
      expect(msgContent).toContain('Claude: Some prefill response');
    });

    it('does not add thinking tags for non-prefill format messages', async () => {
      const content = 'just a regular message without colon at start';
      const messages = [
        makeMessage(content, 'user', {
          contentBlocks: [
            { type: 'thinking', thinking: 'This should not appear' },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      // Regular messages (no "Name:" pattern) should NOT get thinking prepended
      const msgContent = result[0].content as string;
      expect(msgContent).toBe(content);
    });

    // --- Image resizing ---

    it('does not resize images under 4MB', async () => {
      const smallBase64 = Buffer.from('small').toString('base64');
      const messages = [
        makeMessage('Look', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'small.jpg',
              fileSize: 100,
              fileType: 'jpg',
              content: smallBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      const imgPart = parts.find((p: any) => p.type === 'image');
      // Original data should be preserved (not resized)
      expect(imgPart.source.data).toBe(smallBase64);
      expect(imgPart.source.media_type).toBe('image/jpeg');
    });

    it('resizes images over 4MB and changes media type to jpeg', async () => {
      // Create base64 string large enough to exceed 4MB when decoded
      // 4MB = 4 * 1024 * 1024 = 4194304 bytes
      // base64 is ~4/3 of binary, so we need base64 string of length ceil(4194304 / 0.75) + margin
      const largeBase64 = 'A'.repeat(6_000_000); // > 4MB when decoded

      const messages = [
        makeMessage('Big image', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'huge.png',
              fileSize: 5_000_000,
              fileType: 'png',
              content: largeBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      const imgPart = parts.find((p: any) => p.type === 'image');
      // After resize, data should be different from the original
      expect(imgPart.source.data).not.toBe(largeBase64);
      // Media type should change to jpeg after resize
      expect(imgPart.source.media_type).toBe('image/jpeg');
    });

    it('returns original image when sharp cannot get dimensions', async () => {
      // Override the sharp mock to return no dimensions
      const sharp = (await import('sharp')).default as any;
      sharp.mockImplementationOnce(() => ({
        metadata: vi.fn().mockResolvedValue({ width: undefined, height: undefined }),
        resize: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('should not reach')),
      }));

      const largeBase64 = 'C'.repeat(6_000_000);
      const messages = [
        makeMessage('No dimensions', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'mystery.png',
              fileSize: 5_000_000,
              fileType: 'png',
              content: largeBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      const imgPart = parts.find((p: any) => p.type === 'image');
      // Should return original data since dimensions are unknown
      expect(imgPart.source.data).toBe(largeBase64);
    });

    it('returns original image when sharp throws an error during resize', async () => {
      const sharp = (await import('sharp')).default as any;
      sharp.mockImplementationOnce(() => ({
        metadata: vi.fn().mockRejectedValue(new Error('corrupt image')),
      }));

      const largeBase64 = 'D'.repeat(6_000_000);
      const messages = [
        makeMessage('Corrupt image', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'corrupt.png',
              fileSize: 5_000_000,
              fileType: 'png',
              content: largeBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      const imgPart = parts.find((p: any) => p.type === 'image');
      // Should fall back to original data on error
      expect(imgPart.source.data).toBe(largeBase64);
    });

    // --- Edge cases ---

    it('returns empty array for empty messages array', async () => {
      const result = await service.formatMessagesForAnthropic([]);
      expect(result).toEqual([]);
    });

    it('handles message with no active branch gracefully', async () => {
      const message: Message = {
        id: randomUUID(),
        conversationId: randomUUID(),
        order: 0,
        activeBranchId: 'nonexistent-id',
        branches: [
          {
            id: randomUUID(),
            content: 'This branch is not active',
            role: 'user',
            createdAt: new Date(),
          },
        ],
      };
      const result = await service.formatMessagesForAnthropic([message]);
      expect(result).toEqual([]);
    });

    it('handles assistant message with mixed signed and unsigned thinking', async () => {
      const messages = [
        makeMessage('Final answer', 'assistant', {
          contentBlocks: [
            { type: 'thinking', thinking: 'Signed thought', signature: 'valid-sig' },
            { type: 'thinking', thinking: 'Unsigned thought' },
            { type: 'text', text: 'Final answer' },
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      // Should have: signed thinking block, text block with unsigned thinking prepended
      const thinkingBlocks = parts.filter((p: any) => p.type === 'thinking');
      expect(thinkingBlocks).toHaveLength(1);
      expect(thinkingBlocks[0].signature).toBe('valid-sig');

      const textBlocks = parts.filter((p: any) => p.type === 'text');
      expect(textBlocks).toHaveLength(1);
      expect(textBlocks[0].text).toContain('<thinking>');
      expect(textBlocks[0].text).toContain('Unsigned thought');
      expect(textBlocks[0].text).toContain('Final answer');
    });

    it('handles assistant message with only unsigned thinking and main content', async () => {
      const messages = [
        makeMessage('The result', 'assistant', {
          contentBlocks: [
            { type: 'thinking', thinking: 'I need to think' },
            // No text block in contentBlocks, so content comes from main message
          ],
        }),
      ];
      const result = await service.formatMessagesForAnthropic(messages);

      const parts = result[0].content as any[];
      // Only unsigned thinking → converted to text, combined with main content
      const textBlocks = parts.filter((p: any) => p.type === 'text');
      expect(textBlocks).toHaveLength(1);
      expect(textBlocks[0].text).toContain('<thinking>');
      expect(textBlocks[0].text).toContain('I need to think');
      expect(textBlocks[0].text).toContain('The result');
    });
  });

  describe('parseThinkingTags (via streamCompletion message_stop handling)', () => {
    // parseThinkingTags is private; we test it indirectly through the public interface.
    // We can access it directly for unit testing since TypeScript access modifiers
    // don't exist at runtime.

    it('parses single <think> block and extracts text', () => {
      const service2 = service as any;
      const result = service2.parseThinkingTags(
        '<think>This is thinking</think>\n\nThis is the response'
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        type: 'thinking',
        thinking: 'This is thinking',
      });
      expect(result[1]).toEqual({
        type: 'text',
        text: 'This is the response',
      });
    });

    it('parses multiple <think> blocks', () => {
      const service2 = service as any;
      const result = service2.parseThinkingTags(
        '<think>First thought</think>\n<think>Second thought</think>\nThe answer'
      );

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('thinking');
      expect(result[0].thinking).toBe('First thought');
      expect(result[1].type).toBe('thinking');
      expect(result[1].thinking).toBe('Second thought');
      expect(result[2].type).toBe('text');
      expect(result[2].text).toBe('The answer');
    });

    it('returns empty array when no think tags are present', () => {
      const service2 = service as any;
      const result = service2.parseThinkingTags('Just regular text');
      expect(result).toEqual([]);
    });

    it('returns empty array when think tag has empty content', () => {
      const service2 = service as any;
      const result = service2.parseThinkingTags('<think></think>Some text');
      // Empty thinking is skipped, and since there are no valid thinking blocks,
      // the text won't be added either (contentBlocks.length === 0 check)
      expect(result).toEqual([]);
    });

    it('handles think block with only thinking and no text after', () => {
      const service2 = service as any;
      const result = service2.parseThinkingTags('<think>Only thinking here</think>');

      // Should have thinking block but no text block (empty text after removal)
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('thinking');
      expect(result[0].thinking).toBe('Only thinking here');
    });
  });

  describe('isImageAttachment (private)', () => {
    it('recognizes jpg, jpeg, png, webp as images', () => {
      const svc = service as any;
      expect(svc.isImageAttachment('photo.jpg')).toBe(true);
      expect(svc.isImageAttachment('photo.jpeg')).toBe(true);
      expect(svc.isImageAttachment('photo.png')).toBe(true);
      expect(svc.isImageAttachment('photo.webp')).toBe(true);
    });

    it('does NOT recognize gif as an image (Anthropic API issue)', () => {
      const svc = service as any;
      expect(svc.isImageAttachment('animation.gif')).toBe(false);
    });

    it('is case-insensitive for extensions', () => {
      const svc = service as any;
      expect(svc.isImageAttachment('PHOTO.JPG')).toBe(true);
      expect(svc.isImageAttachment('Photo.Png')).toBe(true);
    });

    it('returns false for non-image files', () => {
      const svc = service as any;
      expect(svc.isImageAttachment('doc.pdf')).toBe(false);
      expect(svc.isImageAttachment('script.ts')).toBe(false);
      expect(svc.isImageAttachment('noext')).toBe(false);
    });
  });

  describe('isPdfAttachment (private)', () => {
    it('recognizes pdf extension', () => {
      const svc = service as any;
      expect(svc.isPdfAttachment('doc.pdf')).toBe(true);
      expect(svc.isPdfAttachment('DOC.PDF')).toBe(true);
    });

    it('returns false for non-pdf files', () => {
      const svc = service as any;
      expect(svc.isPdfAttachment('image.png')).toBe(false);
      expect(svc.isPdfAttachment('data.json')).toBe(false);
    });
  });

  describe('getMediaType (private)', () => {
    it('uses provided mimeType when available', () => {
      const svc = service as any;
      expect(svc.getMediaType('file.xyz', 'custom/type')).toBe('custom/type');
    });

    it('derives media type from extension for known types', () => {
      const svc = service as any;
      expect(svc.getMediaType('photo.jpg')).toBe('image/jpeg');
      expect(svc.getMediaType('photo.jpeg')).toBe('image/jpeg');
      expect(svc.getMediaType('photo.png')).toBe('image/png');
      expect(svc.getMediaType('photo.gif')).toBe('image/gif');
      expect(svc.getMediaType('photo.webp')).toBe('image/webp');
      expect(svc.getMediaType('doc.pdf')).toBe('application/pdf');
      expect(svc.getMediaType('song.mp3')).toBe('audio/mpeg');
      expect(svc.getMediaType('video.mp4')).toBe('video/mp4');
    });

    it('falls back to application/octet-stream for unknown extensions', () => {
      const svc = service as any;
      expect(svc.getMediaType('data.xyz')).toBe('application/octet-stream');
      expect(svc.getMediaType('noext')).toBe('application/octet-stream');
    });
  });

  describe('getImageMediaType (private)', () => {
    it('delegates to getMediaType for image extensions', () => {
      const svc = service as any;
      expect(svc.getImageMediaType('photo.jpg')).toBe('image/jpeg');
      expect(svc.getImageMediaType('photo.png')).toBe('image/png');
      expect(svc.getImageMediaType('photo.webp')).toBe('image/webp');
    });
  });

  describe('calculateCacheSavings (private)', () => {
    it('calculates 90% savings for a known model', () => {
      const svc = service as any;
      // claude-3-5-sonnet-20241022: $3.00 per 1M tokens
      // 1000 cached tokens = 1000 * (3.00 / 1_000_000) * 0.9 = 0.0027
      const savings = svc.calculateCacheSavings('claude-3-5-sonnet-20241022', 1000);
      expect(savings).toBeCloseTo(0.0027, 6);
    });

    it('uses default pricing ($3.00/1M) for unknown models', () => {
      const svc = service as any;
      const savings = svc.calculateCacheSavings('unknown-model', 1000);
      // Default is $3.00/1M, so same as sonnet
      expect(savings).toBeCloseTo(0.0027, 6);
    });

    it('returns 0 for 0 cached tokens', () => {
      const svc = service as any;
      const savings = svc.calculateCacheSavings('claude-3-opus-20240229', 0);
      expect(savings).toBe(0);
    });

    it('calculates correctly for opus pricing ($15/1M)', () => {
      const svc = service as any;
      // 10000 cached tokens at $15/1M = 10000 * (15 / 1_000_000) * 0.9 = 0.135
      const savings = svc.calculateCacheSavings('claude-3-opus-20240229', 10000);
      expect(savings).toBeCloseTo(0.135, 6);
    });

    it('calculates correctly for haiku pricing ($0.25/1M)', () => {
      const svc = service as any;
      // 100000 cached tokens at $0.25/1M = 100000 * (0.25 / 1_000_000) * 0.9 = 0.0225
      const savings = svc.calculateCacheSavings('claude-3-haiku-20240307', 100000);
      expect(savings).toBeCloseTo(0.0225, 6);
    });
  });

  describe('splitAtCacheBreakpoints (private)', () => {
    it('splits content and adds cache_control to non-last sections', () => {
      const svc = service as any;
      const result = svc.splitAtCacheBreakpoints('Part A<|cache_breakpoint|>Part B');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        type: 'text',
        text: 'Part A',
        cache_control: { type: 'ephemeral', ttl: '1h' },
      });
      expect(result[1]).toEqual({
        type: 'text',
        text: 'Part B',
      });
    });

    it('handles three sections', () => {
      const svc = service as any;
      const result = svc.splitAtCacheBreakpoints(
        'A<|cache_breakpoint|>B<|cache_breakpoint|>C'
      );

      expect(result).toHaveLength(3);
      expect(result[0].cache_control).toBeDefined();
      expect(result[1].cache_control).toBeDefined();
      expect(result[2].cache_control).toBeUndefined();
    });

    it('skips empty sections after splitting', () => {
      const svc = service as any;
      const result = svc.splitAtCacheBreakpoints(
        '<|cache_breakpoint|>Only section'
      );

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Only section');
    });

    it('returns single block for content with no breakpoints', () => {
      const svc = service as any;
      const result = svc.splitAtCacheBreakpoints('No breakpoints here');

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('No breakpoints here');
      // Single section = last section, so no cache_control
      expect(result[0].cache_control).toBeUndefined();
    });
  });

  describe('isAudioAttachment (private)', () => {
    it('recognizes audio file extensions', () => {
      const svc = service as any;
      expect(svc.isAudioAttachment('song.mp3')).toBe(true);
      expect(svc.isAudioAttachment('audio.wav')).toBe(true);
      expect(svc.isAudioAttachment('audio.flac')).toBe(true);
      expect(svc.isAudioAttachment('audio.ogg')).toBe(true);
      expect(svc.isAudioAttachment('audio.m4a')).toBe(true);
      expect(svc.isAudioAttachment('audio.aac')).toBe(true);
      expect(svc.isAudioAttachment('audio.webm')).toBe(true);
    });

    it('returns false for non-audio files', () => {
      const svc = service as any;
      expect(svc.isAudioAttachment('image.png')).toBe(false);
      expect(svc.isAudioAttachment('doc.pdf')).toBe(false);
    });
  });

  describe('isVideoAttachment (private)', () => {
    it('recognizes video file extensions', () => {
      const svc = service as any;
      expect(svc.isVideoAttachment('clip.mp4')).toBe(true);
      expect(svc.isVideoAttachment('clip.mov')).toBe(true);
      expect(svc.isVideoAttachment('clip.avi')).toBe(true);
      expect(svc.isVideoAttachment('clip.mkv')).toBe(true);
      expect(svc.isVideoAttachment('clip.webm')).toBe(true);
    });

    it('returns false for non-video files', () => {
      const svc = service as any;
      expect(svc.isVideoAttachment('song.mp3')).toBe(false);
      expect(svc.isVideoAttachment('doc.pdf')).toBe(false);
    });
  });

});
