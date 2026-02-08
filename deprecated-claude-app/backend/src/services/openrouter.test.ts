import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { Message } from '@deprecated-claude/shared';

// Mock the Database
vi.mock('../database/index.js', () => ({
  Database: class MockDatabase {},
}));

// Mock blob store
const mockSaveBlob = vi.fn().mockResolvedValue('mock-blob-id');
const mockDeleteBlob = vi.fn().mockResolvedValue(undefined);
vi.mock('../database/blob-store.js', () => ({
  getBlobStore: vi.fn(() => ({
    saveBlob: mockSaveBlob,
    loadBlob: vi.fn(),
    deleteBlob: mockDeleteBlob,
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
import { llmLogger } from '../utils/llmLogger.js';
import { logOpenRouterRequest, logOpenRouterResponse } from '../utils/openrouterLogger.js';

// ── SSE stream test helpers ──────────────────────────────────────────

/** Encode SSE lines into a ReadableStream of Uint8Array chunks */
function makeSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let idx = 0;
  return new ReadableStream({
    pull(controller) {
      if (idx < events.length) {
        controller.enqueue(encoder.encode(events[idx] + '\n'));
        idx++;
      } else {
        controller.close();
      }
    }
  });
}

/** Build a standard SSE data line */
function sseData(obj: any): string {
  return `data: ${JSON.stringify(obj)}`;
}

/** Build a simple streaming delta chunk */
function makeDelta(content: string, extraFields?: any): string {
  return sseData({
    id: 'gen-test',
    choices: [{ delta: { content, ...extraFields }, index: 0 }],
  });
}

/** Build a usage-only chunk (typically the final chunk before [DONE]) */
function makeUsageChunk(usage: any): string {
  return sseData({
    id: 'gen-test',
    choices: [{ delta: {}, index: 0 }],
    usage,
  });
}

/** Create a mock fetch Response with SSE body */
function mockSSEResponse(events: string[], status = 200, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    body: makeSSEStream(events),
    headers: new Headers(),
    text: async () => events.join('\n'),
    json: async () => ({}),
  } as any;
}

/** Create a mock fetch Response for non-streaming JSON */
function mockJSONResponse(body: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    body: null,
    headers: new Headers(),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as any;
}

/** Default model settings for tests */
function defaultSettings(overrides?: any) {
  return {
    maxTokens: 1024,
    temperature: 0.7,
    ...overrides,
  };
}

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
    vi.restoreAllMocks();
    const mockDb = new Database() as any;
    service = new OpenRouterService(mockDb, 'test-openrouter-key');
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  // ══════════════════════════════════════════════════════════════════════
  // streamCompletion — core streaming method
  // ══════════════════════════════════════════════════════════════════════

  describe('streamCompletion', () => {
    const messages = () => [makeMessage('Hello', 'user')];
    const settings = () => defaultSettings();

    // ── Request building ──────────────────────────────────────────────

    describe('request building', () => {
      it('sends correct headers including HTTP-Referer and X-Title', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([makeDelta('Hi'), 'data: [DONE]'])
        );

        await service.streamCompletion('openai/gpt-4', messages(), undefined, settings(), vi.fn());

        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url, opts] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(opts.method).toBe('POST');
        const headers = opts.headers;
        expect(headers['Authorization']).toBe('Bearer test-openrouter-key');
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers['HTTP-Referer']).toBeDefined();
        expect(headers['X-Title']).toBe('Deprecated Claude App');
      });

      it('includes stream: true and usage: {include: true} in request body', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([makeDelta('ok'), 'data: [DONE]'])
        );

        await service.streamCompletion('openai/gpt-4', messages(), 'system prompt', settings(), vi.fn());

        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.stream).toBe(true);
        expect(body.usage).toEqual({ include: true });
        expect(body.model).toBe('openai/gpt-4');
        expect(body.temperature).toBe(0.7);
        expect(body.max_tokens).toBe(1024);
      });

      it('includes topP and topK when provided', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([makeDelta('ok'), 'data: [DONE]'])
        );

        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined,
          defaultSettings({ topP: 0.9, topK: 40 }),
          vi.fn()
        );

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
        expect(body.top_p).toBe(0.9);
        expect(body.top_k).toBe(40);
      });

      it('includes stop sequences when provided', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([makeDelta('ok'), 'data: [DONE]'])
        );

        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          vi.fn(), ['<stop>', '</end>']
        );

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
        expect(body.stop).toEqual(['<stop>', '</end>']);
      });

      it('does not include stop when stopSequences is empty', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([makeDelta('ok'), 'data: [DONE]'])
        );

        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          vi.fn(), []
        );

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
        expect(body.stop).toBeUndefined();
      });

      it('forces Anthropic provider and prompt-caching for Claude models', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([makeDelta('ok'), 'data: [DONE]'])
        );

        await service.streamCompletion(
          'anthropic/claude-3.5-sonnet', messages(), undefined, settings(), vi.fn()
        );

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
        expect(body.provider).toEqual({ order: ['Anthropic'], allow_fallbacks: false });
        expect(body.transforms).toEqual(['prompt-caching']);
      });

      it('does not add provider/transforms for non-Anthropic models', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([makeDelta('ok'), 'data: [DONE]'])
        );

        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(), vi.fn()
        );

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
        expect(body.provider).toBeUndefined();
        expect(body.transforms).toBeUndefined();
      });
    });

    // ── Thinking/reasoning support ────────────────────────────────────

    describe('thinking/reasoning support', () => {
      it('includes reasoning config when thinking is enabled', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([makeDelta('ok'), 'data: [DONE]'])
        );

        await service.streamCompletion(
          'anthropic/claude-3.5-sonnet', messages(), undefined,
          defaultSettings({ thinking: { enabled: true, budgetTokens: 8000 } }),
          vi.fn()
        );

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
        expect(body.reasoning).toEqual({ max_tokens: 8000 });
      });

      it('adjusts max_tokens when thinking budget exceeds it', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([makeDelta('ok'), 'data: [DONE]'])
        );

        // maxTokens=1024, budgetTokens=5000 → should adjust to 5000+4096=9096
        await service.streamCompletion(
          'anthropic/claude-3.5-sonnet', messages(), undefined,
          defaultSettings({ maxTokens: 1024, thinking: { enabled: true, budgetTokens: 5000 } }),
          vi.fn()
        );

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
        expect(body.max_tokens).toBe(5000 + 4096);
      });

      it('does not include reasoning when thinking is disabled', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([makeDelta('ok'), 'data: [DONE]'])
        );

        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined,
          defaultSettings({ thinking: { enabled: false, budgetTokens: 8000 } }),
          vi.fn()
        );

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
        expect(body.reasoning).toBeUndefined();
      });
    });

    // ── SSE streaming & content assembly ──────────────────────────────

    describe('SSE streaming', () => {
      it('streams text content chunks to onChunk callback', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            makeDelta('Hello'),
            makeDelta(' world'),
            makeDelta('!'),
            'data: [DONE]',
          ])
        );

        const chunks: Array<{ text: string; isComplete: boolean }> = [];
        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          async (text, isComplete) => { chunks.push({ text, isComplete }); }
        );

        // Should get 3 content chunks + 1 completion chunk
        const contentChunks = chunks.filter(c => !c.isComplete && c.text !== '');
        expect(contentChunks.map(c => c.text)).toEqual(['Hello', ' world', '!']);
        expect(chunks[chunks.length - 1].isComplete).toBe(true);
      });

      it('handles empty lines between SSE events (buffer splitting)', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            makeDelta('chunk1'),
            '',  // empty line (separator)
            makeDelta('chunk2'),
            'data: [DONE]',
          ])
        );

        const texts: string[] = [];
        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          async (text, isComplete) => { if (text && !isComplete) texts.push(text); }
        );

        expect(texts).toEqual(['chunk1', 'chunk2']);
      });

      it('handles malformed JSON in SSE data gracefully (does not throw)', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            'data: {invalid json',
            makeDelta('valid'),
            'data: [DONE]',
          ])
        );

        const texts: string[] = [];
        // Should not throw
        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          async (text, isComplete) => { if (text && !isComplete) texts.push(text); }
        );

        expect(texts).toEqual(['valid']);
      });

      it('ignores non-SSE lines (lines not starting with data:)', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            ': comment line',
            'event: something',
            makeDelta('content'),
            'data: [DONE]',
          ])
        );

        const texts: string[] = [];
        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          async (text, isComplete) => { if (text && !isComplete) texts.push(text); }
        );

        expect(texts).toEqual(['content']);
      });
    });

    // ── Usage/token tracking ──────────────────────────────────────────

    describe('usage tracking', () => {
      it('returns usage when tokens are available', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            makeDelta('Hi'),
            makeUsageChunk({
              prompt_tokens: 100,
              completion_tokens: 20,
              total_tokens: 120,
            }),
            'data: [DONE]',
          ])
        );

        const result = await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(), vi.fn()
        );

        expect(result.usage).toEqual({
          inputTokens: 100,
          outputTokens: 20,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        });
      });

      it('returns rawRequest when usage is not available', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            makeDelta('Hi'),
            'data: [DONE]',
          ])
        );

        const result = await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(), vi.fn()
        );

        expect(result.usage).toBeUndefined();
        expect(result.rawRequest).toBeDefined();
        expect(result.rawRequest.model).toBe('openai/gpt-4');
      });

      it('reports fresh input tokens (total - cached) matching Anthropic semantics', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            makeDelta('Hi'),
            makeUsageChunk({
              prompt_tokens: 500,
              completion_tokens: 50,
              total_tokens: 550,
              prompt_tokens_details: { cached_tokens: 300 },
            }),
            'data: [DONE]',
          ])
        );

        const result = await service.streamCompletion(
          'anthropic/claude-3.5-sonnet', messages(), undefined, settings(), vi.fn()
        );

        expect(result.usage).toEqual({
          inputTokens: 200,      // 500 - 300 = fresh
          outputTokens: 50,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 300,
        });
      });

      it('handles native Anthropic cache format (cache_creation_input_tokens / cache_read_input_tokens)', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            makeDelta('content'),
            makeUsageChunk({
              prompt_tokens: 400,
              completion_tokens: 30,
              total_tokens: 430,
              cache_creation_input_tokens: 100,
              cache_read_input_tokens: 200,
            }),
            'data: [DONE]',
          ])
        );

        const result = await service.streamCompletion(
          'anthropic/claude-3.5-sonnet', messages(), undefined, settings(), vi.fn()
        );

        // Native Anthropic format overrides; fresh = 400 - 200 = 200
        expect(result.usage!.cacheCreationInputTokens).toBe(100);
        expect(result.usage!.cacheReadInputTokens).toBe(200);
        expect(result.usage!.inputTokens).toBe(200);
      });

      it('calls onTokenUsage callback with fresh prompt tokens', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            makeDelta('x'),
            makeUsageChunk({
              prompt_tokens: 1000,
              completion_tokens: 50,
              total_tokens: 1050,
              prompt_tokens_details: { cached_tokens: 600 },
            }),
            'data: [DONE]',
          ])
        );

        const tokenUsageCb = vi.fn();
        await service.streamCompletion(
          'anthropic/claude-3.5-sonnet', messages(), undefined, settings(),
          vi.fn(), undefined, tokenUsageCb
        );

        expect(tokenUsageCb).toHaveBeenCalledWith({
          promptTokens: 400,      // 1000 - 600
          completionTokens: 50,
          totalTokens: 1050,
        });
      });

      it('passes usage in the completion onChunk call', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            makeDelta('hello'),
            makeUsageChunk({
              prompt_tokens: 100,
              completion_tokens: 10,
              total_tokens: 110,
            }),
            'data: [DONE]',
          ])
        );

        const calls: any[] = [];
        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          async (text, isComplete, blocks, usage) => {
            calls.push({ text, isComplete, usage });
          }
        );

        // The last call should be the completion with usage
        const completionCall = calls.find(c => c.isComplete);
        expect(completionCall).toBeDefined();
        expect(completionCall.usage).toEqual({
          inputTokens: 100,
          outputTokens: 10,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        });
      });
    });

    // ── Reasoning content streaming ───────────────────────────────────

    describe('reasoning content in SSE', () => {
      it('handles reasoning_content field (priority 1)', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            sseData({
              id: 'gen-test',
              choices: [{ delta: { reasoning_content: 'Step 1: think...' }, index: 0 }],
            }),
            sseData({
              id: 'gen-test',
              choices: [{ delta: { reasoning_content: ' Step 2: more thinking' }, index: 0 }],
            }),
            makeDelta('The answer is 42'),
            'data: [DONE]',
          ])
        );

        const calls: Array<{ text: string; isComplete: boolean; blocks?: any[] }> = [];
        await service.streamCompletion(
          'anthropic/claude-3.5-sonnet', messages(), undefined,
          defaultSettings({ thinking: { enabled: true, budgetTokens: 8000 } }),
          async (text, isComplete, blocks) => { calls.push({ text, isComplete, blocks: blocks ? [...blocks] : undefined }); }
        );

        // Should have reasoning blocks
        const reasoningCalls = calls.filter(c => c.blocks && c.blocks.length > 0 && c.blocks[0].type === 'thinking');
        expect(reasoningCalls.length).toBeGreaterThanOrEqual(2);
        // Final thinking should have accumulated text
        const lastReasoningCall = reasoningCalls[reasoningCalls.length - 1];
        expect(lastReasoningCall.blocks![0].thinking).toBe('Step 1: think... Step 2: more thinking');
      });

      it('handles reasoning field as string (priority 2)', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            sseData({
              id: 'gen-test',
              choices: [{ delta: { reasoning: 'I should analyze...' }, index: 0 }],
            }),
            makeDelta('Result'),
            'data: [DONE]',
          ])
        );

        const calls: Array<{ blocks?: any[] }> = [];
        await service.streamCompletion(
          'anthropic/claude-3.5-sonnet', messages(), undefined, settings(),
          async (_text, _isComplete, blocks) => { calls.push({ blocks: blocks ? [...blocks] : undefined }); }
        );

        const withThinking = calls.filter(c => c.blocks?.[0]?.type === 'thinking');
        expect(withThinking.length).toBeGreaterThanOrEqual(1);
        expect(withThinking[0].blocks![0].thinking).toBe('I should analyze...');
      });

      it('handles reasoning field as array format', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            sseData({
              id: 'gen-test',
              choices: [{
                delta: {
                  reasoning: [
                    { type: 'reasoning.text', text: 'Part A' },
                    { type: 'reasoning.text', text: ' Part B' },
                  ]
                },
                index: 0
              }],
            }),
            makeDelta('Answer'),
            'data: [DONE]',
          ])
        );

        const calls: Array<{ blocks?: any[] }> = [];
        await service.streamCompletion(
          'anthropic/claude-3.5-sonnet', messages(), undefined, settings(),
          async (_text, _isComplete, blocks) => { calls.push({ blocks: blocks ? [...blocks] : undefined }); }
        );

        const withThinking = calls.filter(c => c.blocks?.[0]?.type === 'thinking');
        expect(withThinking.length).toBeGreaterThanOrEqual(1);
        expect(withThinking[0].blocks![0].thinking).toBe('Part A Part B');
      });

      it('handles reasoning field as object format', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            sseData({
              id: 'gen-test',
              choices: [{
                delta: { reasoning: { type: 'reasoning.text', text: 'Object reasoning' } },
                index: 0
              }],
            }),
            makeDelta('Done'),
            'data: [DONE]',
          ])
        );

        const calls: Array<{ blocks?: any[] }> = [];
        await service.streamCompletion(
          'anthropic/claude-3.5-sonnet', messages(), undefined, settings(),
          async (_text, _isComplete, blocks) => { calls.push({ blocks: blocks ? [...blocks] : undefined }); }
        );

        const withThinking = calls.filter(c => c.blocks?.[0]?.type === 'thinking');
        expect(withThinking.length).toBeGreaterThanOrEqual(1);
        expect(withThinking[0].blocks![0].thinking).toBe('Object reasoning');
      });

      it('handles reasoning_details field as string (priority 3 fallback)', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            sseData({
              id: 'gen-test',
              choices: [{ delta: { reasoning_details: 'Detailed thought' }, index: 0 }],
            }),
            makeDelta('Answer'),
            'data: [DONE]',
          ])
        );

        const calls: Array<{ blocks?: any[] }> = [];
        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          async (_text, _isComplete, blocks) => { calls.push({ blocks: blocks ? [...blocks] : undefined }); }
        );

        const withThinking = calls.filter(c => c.blocks?.[0]?.type === 'thinking');
        expect(withThinking.length).toBeGreaterThanOrEqual(1);
        expect(withThinking[0].blocks![0].thinking).toBe('Detailed thought');
      });

      it('handles reasoning_details as array format', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            sseData({
              id: 'gen-test',
              choices: [{
                delta: {
                  reasoning_details: [
                    { type: 'reasoning', text: 'Detail A' },
                    { type: 'reasoning', text: ' Detail B' },
                  ]
                },
                index: 0
              }],
            }),
            makeDelta('Final'),
            'data: [DONE]',
          ])
        );

        const calls: Array<{ blocks?: any[] }> = [];
        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          async (_text, _isComplete, blocks) => { calls.push({ blocks: blocks ? [...blocks] : undefined }); }
        );

        const withThinking = calls.filter(c => c.blocks?.[0]?.type === 'thinking');
        expect(withThinking.length).toBeGreaterThanOrEqual(1);
        expect(withThinking[0].blocks![0].thinking).toBe('Detail A Detail B');
      });

      it('handles reasoning_details as object format', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            sseData({
              id: 'gen-test',
              choices: [{ delta: { reasoning_details: { text: 'Object detail' } }, index: 0 }],
            }),
            makeDelta('End'),
            'data: [DONE]',
          ])
        );

        const calls: Array<{ blocks?: any[] }> = [];
        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          async (_text, _isComplete, blocks) => { calls.push({ blocks: blocks ? [...blocks] : undefined }); }
        );

        const withThinking = calls.filter(c => c.blocks?.[0]?.type === 'thinking');
        expect(withThinking.length).toBeGreaterThanOrEqual(1);
        expect(withThinking[0].blocks![0].thinking).toBe('Object detail');
      });

      it('reasoning_content takes priority over reasoning field', async () => {
        // When both reasoning_content and reasoning are present, only reasoning_content is used
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            sseData({
              id: 'gen-test',
              choices: [{
                delta: {
                  reasoning_content: 'Priority content',
                  reasoning: 'Should be ignored',
                },
                index: 0
              }],
            }),
            makeDelta('Answer'),
            'data: [DONE]',
          ])
        );

        const calls: Array<{ blocks?: any[] }> = [];
        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          async (_text, _isComplete, blocks) => { calls.push({ blocks: blocks ? [...blocks] : undefined }); }
        );

        const withThinking = calls.filter(c => c.blocks?.[0]?.type === 'thinking');
        expect(withThinking[0].blocks![0].thinking).toBe('Priority content');
      });

      it('includes accumulated contentBlocks in final [DONE] call', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            sseData({
              id: 'gen-test',
              choices: [{ delta: { reasoning_content: 'Thinking...' }, index: 0 }],
            }),
            makeDelta('Answer'),
            'data: [DONE]',
          ])
        );

        const calls: Array<{ isComplete: boolean; blocks?: any[] }> = [];
        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          async (_text, isComplete, blocks) => {
            calls.push({ isComplete, blocks: blocks ? [...blocks] : undefined });
          }
        );

        const doneCall = calls.find(c => c.isComplete);
        expect(doneCall!.blocks).toBeDefined();
        expect(doneCall!.blocks![0].type).toBe('thinking');
        expect(doneCall!.blocks![0].thinking).toBe('Thinking...');
      });
    });

    // ── Image handling ────────────────────────────────────────────────

    describe('image generation in streaming', () => {
      it('handles delta.images with data URL format', async () => {
        const base64Data = Buffer.from('fake-image-data').toString('base64');
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            sseData({
              id: 'gen-test',
              choices: [{
                delta: {
                  images: [{
                    type: 'image_url',
                    image_url: { url: `data:image/png;base64,${base64Data}` }
                  }]
                },
                index: 0,
              }],
            }),
            'data: [DONE]',
          ])
        );

        const calls: Array<{ blocks?: any[] }> = [];
        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          async (_text, _isComplete, blocks) => {
            calls.push({ blocks: blocks ? [...blocks] : undefined });
          }
        );

        // Should have saved the blob
        expect(mockSaveBlob).toHaveBeenCalledWith(base64Data, 'image/png');
        // Should have an image block in contentBlocks
        const withImage = calls.filter(c => c.blocks?.some(b => b.type === 'image'));
        expect(withImage.length).toBeGreaterThanOrEqual(1);
        expect(withImage[0].blocks!.find((b: any) => b.type === 'image')).toEqual({
          type: 'image',
          mimeType: 'image/png',
          blobId: 'mock-blob-id',
        });
      });

      it('handles message.images (non-streaming format)', async () => {
        const base64Data = Buffer.from('img2').toString('base64');
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            sseData({
              id: 'gen-test',
              choices: [{
                delta: {},
                message: {
                  images: [{
                    type: 'image_url',
                    image_url: { url: `data:image/jpeg;base64,${base64Data}` }
                  }]
                },
                index: 0,
              }],
            }),
            'data: [DONE]',
          ])
        );

        const calls: Array<{ blocks?: any[] }> = [];
        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(),
          async (_text, _isComplete, blocks) => {
            calls.push({ blocks: blocks ? [...blocks] : undefined });
          }
        );

        expect(mockSaveBlob).toHaveBeenCalledWith(base64Data, 'image/jpeg');
      });

      it('handles inlineData format (Gemini-style)', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            sseData({
              id: 'gen-test',
              choices: [{
                delta: {
                  inlineData: {
                    data: 'abc123base64',
                    mimeType: 'image/webp',
                  }
                },
                index: 0,
              }],
            }),
            'data: [DONE]',
          ])
        );

        await service.streamCompletion(
          'google/gemini-pro', messages(), undefined, settings(), vi.fn()
        );

        expect(mockSaveBlob).toHaveBeenCalledWith('abc123base64', 'image/webp');
      });

      it('replaces existing image and deletes old blob on duplicate', async () => {
        // Reset call counts from earlier tests
        mockSaveBlob.mockReset();
        mockDeleteBlob.mockReset();

        // First call returns blob-1, second returns blob-2
        mockSaveBlob
          .mockResolvedValueOnce('blob-1')
          .mockResolvedValueOnce('blob-2');

        const base64A = Buffer.from('imgA').toString('base64');
        const base64B = Buffer.from('imgB').toString('base64');
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            sseData({
              id: 'gen-test',
              choices: [{
                delta: {
                  images: [{
                    type: 'image_url',
                    image_url: { url: `data:image/png;base64,${base64A}` }
                  }]
                },
                index: 0,
              }],
            }),
            sseData({
              id: 'gen-test',
              choices: [{
                delta: {
                  images: [{
                    type: 'image_url',
                    image_url: { url: `data:image/png;base64,${base64B}` }
                  }]
                },
                index: 0,
              }],
            }),
            'data: [DONE]',
          ])
        );

        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(), vi.fn()
        );

        // Should have deleted the old blob when replacing
        expect(mockDeleteBlob).toHaveBeenCalledWith('blob-1');
        expect(mockSaveBlob).toHaveBeenCalledTimes(2);
      });
    });

    // ── Error handling ────────────────────────────────────────────────

    describe('error handling', () => {
      it('throws on non-ok HTTP response', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          body: null,
          headers: new Headers(),
        } as any);

        await expect(
          service.streamCompletion('openai/gpt-4', messages(), undefined, settings(), vi.fn())
        ).rejects.toThrow('OpenRouter API error: 429 Too Many Requests');
      });

      it('throws when response body is null', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: null,
          headers: new Headers(),
        } as any);

        await expect(
          service.streamCompletion('openai/gpt-4', messages(), undefined, settings(), vi.fn())
        ).rejects.toThrow('No response body');
      });

      it('calls onChunk with failure usage estimate on error', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

        const calls: any[] = [];
        await expect(
          service.streamCompletion(
            'openai/gpt-4', messages(), undefined, settings(),
            async (text, isComplete, blocks, usage) => {
              calls.push({ text, isComplete, usage });
            }
          )
        ).rejects.toThrow('Network failure');

        // Should have called onChunk with estimated failure metrics
        const failCall = calls.find(c => c.usage?.failed);
        expect(failCall).toBeDefined();
        expect(failCall.usage.failed).toBe(true);
        expect(failCall.usage.error).toBe('Network failure');
        expect(failCall.usage.inputTokens).toBeGreaterThan(0);
        expect(failCall.usage.outputTokens).toBe(0);
      });

      it('logs error response via llmLogger', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Server down'));

        await expect(
          service.streamCompletion('openai/gpt-4', messages(), undefined, settings(), vi.fn())
        ).rejects.toThrow('Server down');

        expect(vi.mocked(llmLogger.logResponse)).toHaveBeenCalledWith(
          expect.objectContaining({
            service: 'openrouter',
            model: 'openai/gpt-4',
            error: 'Server down',
          })
        );
      });

      it('records failure metrics even if onChunk throws during error path', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('API timeout'));

        // This should still throw the original error, not the metrics error
        await expect(
          service.streamCompletion(
            'openai/gpt-4', messages(), undefined, settings(),
            async () => { throw new Error('callback error'); }
          )
        ).rejects.toThrow('API timeout');
      });
    });

    // ── Logging ───────────────────────────────────────────────────────

    describe('logging', () => {
      it('calls logOpenRouterRequest before fetch', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([makeDelta('ok'), 'data: [DONE]'])
        );

        await service.streamCompletion(
          'openai/gpt-4', messages(), 'Be helpful', settings(), vi.fn()
        );

        expect(vi.mocked(logOpenRouterRequest)).toHaveBeenCalledWith(
          expect.stringContaining('openrouter-'),
          'openai/gpt-4',
          expect.objectContaining({ model: 'openai/gpt-4', stream: true }),
          'openai',
        );
      });

      it('calls logOpenRouterResponse after streaming completes', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            makeDelta('Hello world'),
            makeUsageChunk({
              prompt_tokens: 50,
              completion_tokens: 10,
              total_tokens: 60,
            }),
            'data: [DONE]',
          ])
        );

        await service.streamCompletion(
          'openai/gpt-4', messages(), undefined, settings(), vi.fn()
        );

        expect(vi.mocked(logOpenRouterResponse)).toHaveBeenCalledWith(
          expect.stringContaining('openrouter-'),
          expect.objectContaining({
            model: 'openai/gpt-4',
            choices: [expect.objectContaining({
              message: expect.objectContaining({ content: 'Hello world' }),
            })],
          }),
          expect.objectContaining({
            prompt_tokens: 50,
            completion_tokens: 10,
          }),
          expect.objectContaining({
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
          }),
          'Hello world',
        );
      });

      it('logs cache metrics via llmLogger.logCustom when cache hits occur', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          mockSSEResponse([
            makeDelta('cached'),
            makeUsageChunk({
              prompt_tokens: 1000,
              completion_tokens: 50,
              total_tokens: 1050,
              prompt_tokens_details: { cached_tokens: 800 },
            }),
            'data: [DONE]',
          ])
        );

        await service.streamCompletion(
          'anthropic/claude-3.5-sonnet', messages(), undefined, settings(), vi.fn()
        );

        expect(vi.mocked(llmLogger.logCustom)).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'CACHE_METRICS',
            provider: 'anthropic',
            model: 'anthropic/claude-3.5-sonnet',
            cacheReadInputTokens: 800,
          })
        );
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // streamCompletionExactTest — non-streaming exact test method
  // ══════════════════════════════════════════════════════════════════════

  describe('streamCompletionExactTest', () => {
    const messages = () => [makeMessage('Hello', 'user')];
    const settings = () => defaultSettings();

    it('sends non-streaming request (no stream: true in body)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({
          id: 'gen-test',
          choices: [{ message: { content: 'Test response', role: 'assistant' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        })
      );

      await service.streamCompletionExactTest(
        'anthropic/claude-3.5-sonnet', messages(), 'system', settings(), vi.fn()
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.stream).toBeUndefined();
      expect(body.model).toBe('anthropic/claude-3.5-sonnet');
    });

    it('forces Anthropic provider with prompt-caching transforms', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({
          id: 'gen-test',
          choices: [{ message: { content: 'ok', role: 'assistant' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
        })
      );

      await service.streamCompletionExactTest(
        'anthropic/claude-3.5-sonnet', messages(), undefined, settings(), vi.fn()
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.provider).toEqual({ order: ['Anthropic'], allow_fallbacks: false });
      expect(body.transforms).toEqual(['prompt-caching']);
      expect(body.usage).toEqual({ include: true });
    });

    it('sends correct headers with X-Title "Arc Chat"', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({
          id: 'gen-test',
          choices: [{ message: { content: 'ok', role: 'assistant' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        })
      );

      await service.streamCompletionExactTest(
        'anthropic/claude-3.5-sonnet', messages(), undefined, settings(), vi.fn()
      );

      const headers = fetchSpy.mock.calls[0][1].headers;
      expect(headers['X-Title']).toBe('Arc Chat');
      expect(headers['Authorization']).toBe('Bearer test-openrouter-key');
    });

    it('delivers entire content at once then completes', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({
          id: 'gen-test',
          choices: [{ message: { content: 'Full response here', role: 'assistant' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        })
      );

      const calls: Array<{ text: string; isComplete: boolean; usage?: any }> = [];
      await service.streamCompletionExactTest(
        'anthropic/claude-3.5-sonnet', messages(), undefined, settings(),
        async (text, isComplete, _blocks, usage) => {
          calls.push({ text, isComplete, usage });
        }
      );

      expect(calls).toHaveLength(2);
      // First call: full content, not complete
      expect(calls[0].text).toBe('Full response here');
      expect(calls[0].isComplete).toBe(false);
      // Second call: empty text, complete with usage
      expect(calls[1].text).toBe('');
      expect(calls[1].isComplete).toBe(true);
      expect(calls[1].usage).toBeDefined();
    });

    it('returns usage with fresh input tokens (total - cached)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({
          id: 'gen-test',
          choices: [{ message: { content: 'Cached reply', role: 'assistant' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 500,
            completion_tokens: 30,
            total_tokens: 530,
            prompt_tokens_details: { cached_tokens: 300 },
          },
        })
      );

      const result = await service.streamCompletionExactTest(
        'anthropic/claude-3.5-sonnet', messages(), undefined, settings(), vi.fn()
      );

      expect(result.usage).toEqual({
        inputTokens: 200,      // 500 - 300
        outputTokens: 30,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 300,
      });
    });

    it('returns zero cached tokens when no cache hit', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({
          id: 'gen-test',
          choices: [{ message: { content: 'No cache', role: 'assistant' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        })
      );

      const result = await service.streamCompletionExactTest(
        'anthropic/claude-3.5-sonnet', messages(), undefined, settings(), vi.fn()
      );

      expect(result.usage).toEqual({
        inputTokens: 100,
        outputTokens: 10,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      });
    });

    it('handles empty content in response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({
          id: 'gen-test',
          choices: [{ message: { content: '', role: 'assistant' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 },
        })
      );

      const calls: Array<{ text: string }> = [];
      await service.streamCompletionExactTest(
        'anthropic/claude-3.5-sonnet', messages(), undefined, settings(),
        async (text) => { calls.push({ text }); }
      );

      expect(calls[0].text).toBe('');
    });

    it('handles missing choices gracefully (returns empty content)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({
          id: 'gen-test',
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        })
      );

      const calls: Array<{ text: string }> = [];
      await service.streamCompletionExactTest(
        'anthropic/claude-3.5-sonnet', messages(), undefined, settings(),
        async (text) => { calls.push({ text }); }
      );

      expect(calls[0].text).toBe('');
    });

    it('throws on non-ok response with error text', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Backend crashed',
        headers: new Headers(),
      } as any);

      await expect(
        service.streamCompletionExactTest(
          'anthropic/claude-3.5-sonnet', messages(), undefined, settings(), vi.fn()
        )
      ).rejects.toThrow('OpenRouter API error (500): Backend crashed');
    });

    it('rethrows on network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('DNS resolution failed'));

      await expect(
        service.streamCompletionExactTest(
          'anthropic/claude-3.5-sonnet', messages(), undefined, settings(), vi.fn()
        )
      ).rejects.toThrow('DNS resolution failed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // listModels
  // ══════════════════════════════════════════════════════════════════════

  describe('listModels', () => {
    it('fetches models from OpenRouter API', async () => {
      const modelData = [
        { id: 'openai/gpt-4', name: 'GPT-4' },
        { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus' },
      ];
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({ data: modelData })
      );

      const result = await service.listModels();

      expect(result).toEqual(modelData);
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-openrouter-key',
          }),
        })
      );
    });

    it('returns empty array on API error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({}, 500)
      );

      const result = await service.listModels();

      expect(result).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

      const result = await service.listModels();

      expect(result).toEqual([]);
    });

    it('returns empty array when response has no data field', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({ models: [] })
      );

      const result = await service.listModels();

      expect(result).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // validateApiKey
  // ══════════════════════════════════════════════════════════════════════

  describe('validateApiKey', () => {
    it('returns true when models are returned', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({ data: [{ id: 'model-1' }] })
      );

      const result = await service.validateApiKey('valid-key');

      expect(result).toBe(true);
    });

    it('returns false when no models returned', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({ data: [] })
      );

      const result = await service.validateApiKey('invalid-key');

      expect(result).toBe(false);
    });

    it('returns false on fetch error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unauthorized'));

      const result = await service.validateApiKey('bad-key');

      expect(result).toBe(false);
    });

    it('passes the provided key to the test service (not the instance key)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockJSONResponse({ data: [{ id: 'model-1' }] })
      );

      await service.validateApiKey('custom-test-key');

      // The fetch should use the custom key
      const headers = fetchSpy.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer custom-test-key');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Constructor
  // ══════════════════════════════════════════════════════════════════════

  describe('constructor', () => {
    it('uses provided API key', () => {
      const svc = new OpenRouterService(new Database() as any, 'my-key');
      expect((svc as any).apiKey).toBe('my-key');
    });

    it('falls back to OPENROUTER_API_KEY env var', () => {
      const original = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'env-key';
      try {
        const svc = new OpenRouterService(new Database() as any);
        expect((svc as any).apiKey).toBe('env-key');
      } finally {
        if (original !== undefined) {
          process.env.OPENROUTER_API_KEY = original;
        } else {
          delete process.env.OPENROUTER_API_KEY;
        }
      }
    });

    it('sets empty string and logs error when no key is available', () => {
      const original = process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const svc = new OpenRouterService(new Database() as any);
        expect((svc as any).apiKey).toBe('');
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('API KEY ERROR'));
      } finally {
        if (original !== undefined) {
          process.env.OPENROUTER_API_KEY = original;
        }
        errorSpy.mockRestore();
      }
    });
  });
});
