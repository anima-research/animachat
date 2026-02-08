import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { Message } from '@deprecated-claude/shared';

// Mock the Database
vi.mock('../database/index.js', () => ({
  Database: class MockDatabase {},
}));

// Mock blob store
vi.mock('../database/blob-store.js', () => ({
  getBlobStore: vi.fn(() => ({
    saveBlob: vi.fn().mockResolvedValue('mock-blob-id'),
    loadBlob: vi.fn(),
    deleteBlob: vi.fn(),
  })),
}));

// Mock loggers
vi.mock('../utils/llmLogger.js', () => ({
  llmLogger: { logRequest: vi.fn(), logResponse: vi.fn(), logCustom: vi.fn() },
}));
vi.mock('../utils/logger.js', () => ({
  Logger: { cache: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../utils/openrouterLogger.js', () => ({
  logOpenRouterRequest: vi.fn(),
  logOpenRouterResponse: vi.fn(),
}));

import { OpenRouterService } from './openrouter.js';
import { Database } from '../database/index.js';

function makeMessage(
  content: string,
  role: 'user' | 'assistant' | 'system' = 'user',
  opts?: {
    contentBlocks?: any[];
    attachments?: any[];
    cacheControl?: any;
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
  return {
    id: randomUUID(),
    conversationId: randomUUID(),
    order: 0,
    activeBranchId: branchId,
    branches: [branch],
  };
}

describe('OpenRouterService', () => {
  let service: OpenRouterService;

  beforeEach(() => {
    const mockDb = new Database() as any;
    service = new OpenRouterService(mockDb, 'test-openrouter-key');
  });

  describe('formatMessagesForOpenRouter', () => {
    it('formats simple user and assistant messages', () => {
      const messages = [
        makeMessage('Hello', 'user'),
        makeMessage('Hi there', 'assistant'),
      ];
      const result = service.formatMessagesForOpenRouter(messages);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'Hi there' });
    });

    it('adds system prompt at the beginning when provided', () => {
      const messages = [makeMessage('Question', 'user')];
      const result = service.formatMessagesForOpenRouter(messages, 'Be helpful');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'system', content: 'Be helpful' });
      expect(result[1]).toEqual({ role: 'user', content: 'Question' });
    });

    it('skips system role messages from the message array', () => {
      const messages = [
        makeMessage('System prompt in messages', 'system'),
        makeMessage('User question', 'user'),
      ];
      const result = service.formatMessagesForOpenRouter(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
    });

    it('preserves multi-turn ordering', () => {
      const messages = [
        makeMessage('Q1', 'user'),
        makeMessage('A1', 'assistant'),
        makeMessage('Q2', 'user'),
      ];
      const result = service.formatMessagesForOpenRouter(messages);

      expect(result.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
      expect(result.map(m => m.content)).toEqual(['Q1', 'A1', 'Q2']);
    });

    // --- Attachments ---

    it('adds image attachments for Anthropic provider as source blocks', () => {
      const imgBase64 = Buffer.from('img').toString('base64');
      const messages = [
        makeMessage('Look at this', 'user', {
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
          ],
        }),
      ];
      const result = service.formatMessagesForOpenRouter(messages, undefined, 'anthropic');

      expect(Array.isArray(result[0].content)).toBe(true);
      const parts = result[0].content as any[];
      expect(parts[0]).toEqual({ type: 'text', text: 'Look at this' });
      expect(parts[1].type).toBe('image');
      expect(parts[1].source.type).toBe('base64');
      expect(parts[1].source.media_type).toBe('image/jpeg');
    });

    it('adds image attachments for non-Anthropic provider as file blocks', () => {
      const imgBase64 = Buffer.from('img').toString('base64');
      const messages = [
        makeMessage('Check this', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'photo.png',
              fileSize: 100,
              fileType: 'png',
              content: imgBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenRouter(messages, undefined, 'openai');

      const parts = result[0].content as any[];
      expect(parts[1].type).toBe('file');
      expect(parts[1].file.filename).toBe('photo.png');
      expect(parts[1].file.file_data).toContain('data:image/png;base64,');
    });

    it('adds PDF attachment as file block', () => {
      const pdfBase64 = Buffer.from('pdf').toString('base64');
      const messages = [
        makeMessage('Read this', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'doc.pdf',
              fileSize: 200,
              fileType: 'pdf',
              content: pdfBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenRouter(messages, undefined, 'openai');

      const parts = result[0].content as any[];
      expect(parts[1].type).toBe('file');
      expect(parts[1].file.file_data).toContain('data:application/pdf;base64,');
    });

    it('adds audio attachment as file block', () => {
      const audioBase64 = Buffer.from('audio').toString('base64');
      const messages = [
        makeMessage('Listen', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'song.mp3',
              fileSize: 500,
              fileType: 'mp3',
              content: audioBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenRouter(messages);

      const parts = result[0].content as any[];
      expect(parts[1].type).toBe('file');
      expect(parts[1].file.file_data).toContain('data:audio/mpeg;base64,');
    });

    it('adds video attachment as file block', () => {
      const videoBase64 = Buffer.from('video').toString('base64');
      const messages = [
        makeMessage('Watch', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'clip.mp4',
              fileSize: 1000,
              fileType: 'mp4',
              content: videoBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenRouter(messages);

      const parts = result[0].content as any[];
      expect(parts[1].type).toBe('file');
      expect(parts[1].file.file_data).toContain('data:video/mp4;base64,');
    });

    it('appends text attachments inline to text content', () => {
      const messages = [
        makeMessage('Review', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'code.ts',
              fileSize: 50,
              fileType: 'ts',
              content: 'const x = 1;',
              encoding: 'text',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenRouter(messages);

      const parts = result[0].content as any[];
      expect(parts[0].text).toContain('<attachment filename="code.ts">');
      expect(parts[0].text).toContain('const x = 1;');
    });

    // --- Cache control ---

    it('adds cache_control to messages with Anthropic provider', () => {
      const cacheControl = { type: 'ephemeral' as const, ttl: '1h' as const };
      const messages = [makeMessage('Cached msg', 'user', { cacheControl })];
      const result = service.formatMessagesForOpenRouter(messages, undefined, 'anthropic');

      const parts = result[0].content as any[];
      expect(Array.isArray(parts)).toBe(true);
      expect(parts[0].cache_control).toEqual(cacheControl);
    });

    it('does not add cache_control for non-Anthropic providers', () => {
      const cacheControl = { type: 'ephemeral' as const, ttl: '1h' as const };
      const messages = [makeMessage('Not cached', 'user', { cacheControl })];
      const result = service.formatMessagesForOpenRouter(messages, undefined, 'openai');

      // For non-Anthropic, content should remain as string (no content blocks)
      expect(typeof result[0].content).toBe('string');
    });

    // --- Thinking blocks for assistant messages (Anthropic provider) ---

    it('formats assistant thinking blocks for Anthropic provider', () => {
      const messages = [
        makeMessage('Answer', 'assistant', {
          contentBlocks: [
            { type: 'thinking', thinking: 'Let me think', signature: 'sig1' },
            { type: 'text', text: 'Answer' },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenRouter(messages, undefined, 'anthropic');

      const parts = result[0].content as any[];
      expect(Array.isArray(parts)).toBe(true);
      const thinkingBlocks = parts.filter((p: any) => p.type === 'thinking');
      expect(thinkingBlocks).toHaveLength(1);
      expect(thinkingBlocks[0].thinking).toBe('Let me think');
      expect(thinkingBlocks[0].signature).toBe('sig1');
    });

    it('adds cache_control to assistant messages with thinking blocks', () => {
      const cacheControl = { type: 'ephemeral' as const };
      const messages = [
        makeMessage('Thought out answer', 'assistant', {
          contentBlocks: [
            { type: 'thinking', thinking: 'Reasoning', signature: 'sig-abc' },
            { type: 'text', text: 'Thought out answer' },
          ],
          cacheControl,
        }),
      ];
      const result = service.formatMessagesForOpenRouter(messages, undefined, 'anthropic');

      const parts = result[0].content as any[];
      expect(Array.isArray(parts)).toBe(true);
      // Cache control should be on the last block
      const lastBlock = parts[parts.length - 1];
      expect(lastBlock.cache_control).toEqual(cacheControl);
    });

    it('adds main content when contentBlocks have only thinking (no text block)', () => {
      const messages = [
        makeMessage('Fallback content', 'assistant', {
          contentBlocks: [
            { type: 'thinking', thinking: 'Only thinking', signature: 'sig-x' },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenRouter(messages, undefined, 'anthropic');

      const parts = result[0].content as any[];
      const textBlocks = parts.filter((p: any) => p.type === 'text');
      expect(textBlocks).toHaveLength(1);
      expect(textBlocks[0].text).toBe('Fallback content');
    });

    it('includes redacted_thinking blocks for Anthropic provider', () => {
      const messages = [
        makeMessage('Response', 'assistant', {
          contentBlocks: [
            { type: 'redacted_thinking', data: 'encrypted-data' },
            { type: 'text', text: 'Response' },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenRouter(messages, undefined, 'anthropic');

      const parts = result[0].content as any[];
      const redacted = parts.filter((p: any) => p.type === 'redacted_thinking');
      expect(redacted).toHaveLength(1);
      expect(redacted[0].data).toBe('encrypted-data');
    });

    it('converts unsigned thinking to XML text for Anthropic provider', () => {
      const messages = [
        makeMessage('Result', 'assistant', {
          contentBlocks: [
            { type: 'thinking', thinking: 'Unsigned thought' },
            { type: 'text', text: 'Result' },
          ],
        }),
      ];
      const result = service.formatMessagesForOpenRouter(messages, undefined, 'anthropic');

      const parts = result[0].content as any[];
      const thinkingBlocks = parts.filter((p: any) => p.type === 'thinking');
      expect(thinkingBlocks).toHaveLength(0);
      const textBlocks = parts.filter((p: any) => p.type === 'text');
      expect(textBlocks[0].text).toContain('<thinking>');
      expect(textBlocks[0].text).toContain('Unsigned thought');
    });

    // --- Edge cases ---

    it('returns empty array for empty messages', () => {
      const result = service.formatMessagesForOpenRouter([]);
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
      const result = service.formatMessagesForOpenRouter([message]);
      expect(result).toEqual([]);
    });
  });

  describe('detectProviderFromModelId (private)', () => {
    it('detects Anthropic from model ID prefix', () => {
      const svc = service as any;
      expect(svc.detectProviderFromModelId('anthropic/claude-3-opus')).toBe('anthropic');
      expect(svc.detectProviderFromModelId('anthropic/claude-3.5-sonnet')).toBe('anthropic');
    });

    it('detects Anthropic from claude keyword', () => {
      const svc = service as any;
      expect(svc.detectProviderFromModelId('claude-3-opus-20240229')).toBe('anthropic');
    });

    it('detects OpenAI from model ID prefix', () => {
      const svc = service as any;
      expect(svc.detectProviderFromModelId('openai/gpt-4o')).toBe('openai');
    });

    it('detects OpenAI from gpt keyword', () => {
      const svc = service as any;
      expect(svc.detectProviderFromModelId('gpt-4-turbo')).toBe('openai');
    });

    it('detects Google from model ID prefix', () => {
      const svc = service as any;
      expect(svc.detectProviderFromModelId('google/gemini-pro')).toBe('google');
    });

    it('detects Google from gemini/palm keywords', () => {
      const svc = service as any;
      expect(svc.detectProviderFromModelId('gemini-1.5-flash')).toBe('google');
      expect(svc.detectProviderFromModelId('palm-2')).toBe('google');
    });

    it('detects Meta from model ID prefix', () => {
      const svc = service as any;
      expect(svc.detectProviderFromModelId('meta-llama/llama-3-70b')).toBe('meta');
    });

    it('detects Meta from llama keyword', () => {
      const svc = service as any;
      expect(svc.detectProviderFromModelId('llama-3.1-405b')).toBe('meta');
    });

    it('detects Mistral from model ID prefix', () => {
      const svc = service as any;
      expect(svc.detectProviderFromModelId('mistralai/mixtral-8x7b')).toBe('mistral');
    });

    it('detects Mistral from mistral keyword', () => {
      const svc = service as any;
      expect(svc.detectProviderFromModelId('mistral-large')).toBe('mistral');
    });

    it('detects Cohere from model ID prefix', () => {
      const svc = service as any;
      expect(svc.detectProviderFromModelId('cohere/command-r-plus')).toBe('cohere');
    });

    it('returns unknown for unrecognized models', () => {
      const svc = service as any;
      expect(svc.detectProviderFromModelId('some-random-model')).toBe('unknown');
    });
  });

  describe('calculateCacheSavings (private)', () => {
    it('returns 0 for non-Anthropic providers', () => {
      const svc = service as any;
      expect(svc.calculateCacheSavings('openai/gpt-4', 1000, 'openai')).toBe(0);
    });

    it('returns 0 for zero cached tokens', () => {
      const svc = service as any;
      expect(svc.calculateCacheSavings('anthropic/claude-3-opus', 0, 'anthropic')).toBe(0);
    });

    it('calculates 90% savings for known Anthropic model', () => {
      const svc = service as any;
      // anthropic/claude-3-opus-20240229: $15/1M
      // 10000 tokens * (15 / 1_000_000) * 0.9 = 0.135
      const savings = svc.calculateCacheSavings('anthropic/claude-3-opus-20240229', 10000, 'anthropic');
      expect(savings).toBeCloseTo(0.135, 6);
    });

    it('uses default pricing ($3/1M) for unknown Anthropic model', () => {
      const svc = service as any;
      // 1000 tokens * (3.00 / 1_000_000) * 0.9 = 0.0027
      const savings = svc.calculateCacheSavings('anthropic/unknown-model', 1000, 'anthropic');
      expect(savings).toBeCloseTo(0.0027, 6);
    });

    it('calculates correctly for haiku pricing ($0.25/1M)', () => {
      const svc = service as any;
      // 100000 tokens * (0.25 / 1_000_000) * 0.9 = 0.0225
      const savings = svc.calculateCacheSavings('anthropic/claude-3-haiku-20240307', 100000, 'anthropic');
      expect(savings).toBeCloseTo(0.0225, 6);
    });
  });

  describe('getMediaType (private)', () => {
    it('uses provided mimeType when available', () => {
      const svc = service as any;
      expect(svc.getMediaType('file.xyz', 'custom/type')).toBe('custom/type');
    });

    it('maps known extensions correctly', () => {
      const svc = service as any;
      expect(svc.getMediaType('photo.jpg')).toBe('image/jpeg');
      expect(svc.getMediaType('doc.pdf')).toBe('application/pdf');
      expect(svc.getMediaType('song.mp3')).toBe('audio/mpeg');
      expect(svc.getMediaType('clip.mp4')).toBe('video/mp4');
      expect(svc.getMediaType('video.mkv')).toBe('video/x-matroska');
    });

    it('falls back to application/octet-stream', () => {
      const svc = service as any;
      expect(svc.getMediaType('data.xyz')).toBe('application/octet-stream');
    });
  });
});
