import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { llmLogger } from '../utils/llmLogger.js';

const mockLogRequest = llmLogger.logRequest as ReturnType<typeof vi.fn>;
const mockLogResponse = llmLogger.logResponse as ReturnType<typeof vi.fn>;

// Helper to build SSE data lines from OpenAI-format chunks
function sseLines(chunks: any[]): string {
  return chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('');
}

// Helper to create a readable stream from a string
function makeReadableStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// Helper to create a mock SSE response
function mockSSEResponse(chunks: any[], done = true): Response {
  let body = sseLines(chunks);
  if (done) body += 'data: [DONE]\n\n';
  return new Response(makeReadableStream(body), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// Default model settings
function defaultSettings(overrides: any = {}) {
  return {
    temperature: 0.7,
    maxTokens: 1024,
    ...overrides,
  };
}

// Helper to make an OpenAI-format streaming chunk
function makeChunk(content: string, index = 0): any {
  return {
    choices: [{ index, delta: { content } }],
  };
}

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

  describe('constructor', () => {
    it('stores apiKey, baseUrl, and modelPrefix', () => {
      const svc = new OpenAICompatibleService(new Database() as any, 'my-key', 'https://api.example.com/', 'prefix/') as any;
      expect(svc.apiKey).toBe('my-key');
      expect(svc.baseUrl).toBe('https://api.example.com'); // trailing slash removed
      expect(svc.modelPrefix).toBe('prefix/');
    });

    it('removes trailing slash from baseUrl', () => {
      const svc = new OpenAICompatibleService(new Database() as any, 'key', 'https://api.example.com/') as any;
      expect(svc.baseUrl).toBe('https://api.example.com');
    });

    it('keeps baseUrl unchanged when no trailing slash', () => {
      const svc = new OpenAICompatibleService(new Database() as any, 'key', 'https://api.example.com') as any;
      expect(svc.baseUrl).toBe('https://api.example.com');
    });
  });

  describe('streamCompletion', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchSpy = vi.spyOn(globalThis, 'fetch');
      mockLogRequest.mockClear();
      mockLogResponse.mockClear();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('streams text chunks and calls onChunk with incremental content', async () => {
      const chunks = [
        makeChunk('Hello'),
        makeChunk(' world'),
        makeChunk('!'),
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'deepseek-chat',
        [makeMessage('Hi')],
        undefined,
        defaultSettings(),
        onChunk
      );

      // Should receive each text chunk
      const textCalls = onChunk.mock.calls.filter((c: any) => c[0] !== '' && !c[1]);
      expect(textCalls.length).toBe(3);
      expect(textCalls[0][0]).toBe('Hello');
      expect(textCalls[1][0]).toBe(' world');
      expect(textCalls[2][0]).toBe('!');

      // Final completion call when [DONE] is received
      const completionCall = onChunk.mock.calls.find((c: any) => c[1] === true);
      expect(completionCall).toBeDefined();
    });

    it('builds correct endpoint URL without doubling /v1', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([makeChunk('ok')]));
      const onChunk = vi.fn().mockResolvedValue(undefined);

      await service.streamCompletion(
        'model-id',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toBe('https://api.example.com/v1/chat/completions');
    });

    it('does not double /v1 when baseUrl already ends with /v1', async () => {
      const svc = new OpenAICompatibleService(new Database() as any, 'key', 'https://api.example.com/v1');
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([makeChunk('ok')]));
      const onChunk = vi.fn().mockResolvedValue(undefined);

      await svc.streamCompletion(
        'model-id',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toBe('https://api.example.com/v1/chat/completions');
    });

    it('sends Authorization header with Bearer token', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([makeChunk('ok')]));
      const onChunk = vi.fn().mockResolvedValue(undefined);

      await service.streamCompletion(
        'model-id',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-key');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('builds request body with correct model, messages, and settings', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([makeChunk('ok')]));
      const onChunk = vi.fn().mockResolvedValue(undefined);

      await service.streamCompletion(
        'deepseek-chat',
        [makeMessage('test')],
        'Be helpful',
        defaultSettings({ temperature: 0.5, maxTokens: 2048 }),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.model).toBe('deepseek-chat');
      expect(body.stream).toBe(true);
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(2048);
      // System prompt should be in messages
      expect(body.messages[0]).toEqual({ role: 'system', content: 'Be helpful' });
    });

    it('applies model prefix when configured', async () => {
      const svc = new OpenAICompatibleService(new Database() as any, 'key', 'https://api.example.com', 'openrouter/');
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([makeChunk('ok')]));
      const onChunk = vi.fn().mockResolvedValue(undefined);

      await svc.streamCompletion(
        'deepseek-chat',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.model).toBe('openrouter/deepseek-chat');
    });

    it('includes topP and topK when provided', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([makeChunk('ok')]));
      const onChunk = vi.fn().mockResolvedValue(undefined);

      await service.streamCompletion(
        'model-id',
        [makeMessage('test')],
        undefined,
        defaultSettings({ topP: 0.9, topK: 50 }),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.top_p).toBe(0.9);
      expect(body.top_k).toBe(50);
    });

    it('does not include topP/topK when undefined', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([makeChunk('ok')]));
      const onChunk = vi.fn().mockResolvedValue(undefined);

      await service.streamCompletion(
        'model-id',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.top_p).toBeUndefined();
      expect(body.top_k).toBeUndefined();
    });

    it('includes stop sequences when provided', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([makeChunk('ok')]));
      const onChunk = vi.fn().mockResolvedValue(undefined);

      await service.streamCompletion(
        'model-id',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk,
        ['<|end|>', '\n\n']
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.stop).toEqual(['<|end|>', '\n\n']);
    });

    it('does not include stop when empty array', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([makeChunk('ok')]));
      const onChunk = vi.fn().mockResolvedValue(undefined);

      await service.streamCompletion(
        'model-id',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk,
        []
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.stop).toBeUndefined();
    });

    it('parses thinking tags from accumulated content at [DONE]', async () => {
      const chunks = [
        makeChunk('<think>'),
        makeChunk('reasoning here'),
        makeChunk('</think>'),
        makeChunk('\n\nThe answer'),
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'deepseek-r1',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      // Completion call should have content blocks with thinking
      const completionCall = onChunk.mock.calls.find((c: any) => c[1] === true);
      expect(completionCall).toBeDefined();
      const blocks = completionCall![2];
      expect(blocks).toBeDefined();
      expect(blocks.length).toBe(2);
      expect(blocks[0].type).toBe('thinking');
      expect(blocks[0].thinking).toBe('reasoning here');
      expect(blocks[1].type).toBe('text');
      expect(blocks[1].text).toBe('The answer');
    });

    it('sends undefined contentBlocks when no thinking tags in content', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([makeChunk('plain text')]));
      const onChunk = vi.fn().mockResolvedValue(undefined);

      await service.streamCompletion(
        'model-id',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      const completionCall = onChunk.mock.calls.find((c: any) => c[1] === true);
      // parseThinkingTags returns [] for plain text, and [] is falsy for .length > 0 check
      expect(completionCall![2]).toBeUndefined();
    });

    it('handles usage data in stream chunks and calls onTokenUsage', async () => {
      const chunks = [
        makeChunk('ok'),
        { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      const onTokenUsage = vi.fn().mockResolvedValue(undefined);

      await service.streamCompletion(
        'model-id',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk,
        undefined,
        onTokenUsage
      );

      expect(onTokenUsage).toHaveBeenCalledWith({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      });
    });

    it('does not call onTokenUsage when not provided', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);

      // Should not throw even though onTokenUsage is undefined
      await service.streamCompletion(
        'model-id',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );
    });

    it('throws on non-ok HTTP response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Rate limit exceeded', { status: 429, statusText: 'Too Many Requests' })
      );

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await expect(
        service.streamCompletion(
          'model-id',
          [makeMessage('test')],
          undefined,
          defaultSettings(),
          onChunk
        )
      ).rejects.toThrow('OpenAI-compatible API error: 429 Too Many Requests');
    });

    it('throws when response has no body reader', async () => {
      const resp = new Response(null, { status: 200 });
      Object.defineProperty(resp, 'body', { value: null });
      fetchSpy.mockResolvedValueOnce(resp);

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await expect(
        service.streamCompletion(
          'model-id',
          [makeMessage('test')],
          undefined,
          defaultSettings(),
          onChunk
        )
      ).rejects.toThrow('No response body');
    });

    it('handles malformed JSON in SSE data gracefully', async () => {
      const body = `data: ${JSON.stringify(makeChunk('valid'))}\n\ndata: {invalid}\n\ndata: ${JSON.stringify(makeChunk(' end'))}\n\ndata: [DONE]\n\n`;
      fetchSpy.mockResolvedValueOnce(
        new Response(makeReadableStream(body), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'model-id',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      // Valid chunks still processed
      const textCalls = onChunk.mock.calls.filter((c: any) => c[0] !== '' && !c[1]);
      expect(textCalls.length).toBe(2);
      expect(textCalls[0][0]).toBe('valid');
      expect(textCalls[1][0]).toBe(' end');
    });

    it('skips chunks with no delta content', async () => {
      const chunks = [
        { choices: [{ delta: {} }] }, // No content
        makeChunk('actual text'),
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'model-id',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      const textCalls = onChunk.mock.calls.filter((c: any) => c[0] !== '' && !c[1]);
      expect(textCalls.length).toBe(1);
      expect(textCalls[0][0]).toBe('actual text');
    });

    it('logs request and response via llmLogger', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([makeChunk('ok')]));
      const onChunk = vi.fn().mockResolvedValue(undefined);

      await service.streamCompletion(
        'model-id',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      expect(mockLogRequest).toHaveBeenCalledOnce();
      const reqCall = mockLogRequest.mock.calls[0][0];
      expect(reqCall.service).toBe('openai-compatible');
      expect(reqCall.model).toBe('model-id');

      expect(mockLogResponse).toHaveBeenCalledOnce();
      const respCall = mockLogResponse.mock.calls[0][0];
      expect(respCall.service).toBe('openai-compatible');
      expect(respCall.chunks).toBeDefined();
      expect(respCall.duration).toBeGreaterThanOrEqual(0);
    });

    it('logs error via llmLogger on failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Server error', { status: 500, statusText: 'Internal Server Error' })
      );

      const onChunk = vi.fn().mockResolvedValue(undefined);
      try {
        await service.streamCompletion(
          'model-id',
          [makeMessage('test')],
          undefined,
          defaultSettings(),
          onChunk
        );
      } catch {
        // Expected
      }

      expect(mockLogResponse).toHaveBeenCalledOnce();
      const respCall = mockLogResponse.mock.calls[0][0];
      expect(respCall.error).toContain('500');
    });

    it('returns rawRequest in the result', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([makeChunk('ok')]));
      const onChunk = vi.fn().mockResolvedValue(undefined);

      const result = await service.streamCompletion(
        'model-id',
        [makeMessage('test')],
        'system prompt',
        defaultSettings(),
        onChunk
      );

      expect(result.rawRequest).toBeDefined();
      expect(result.rawRequest.model).toBe('model-id');
      expect(result.rawRequest.stream).toBe(true);
      expect(result.rawRequest.messages[0]).toEqual({ role: 'system', content: 'system prompt' });
    });
  });

  describe('listModels', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns model list from API', async () => {
      const models = [{ id: 'model-1' }, { id: 'model-2' }];
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: models }), { status: 200 })
      );

      const result = await service.listModels();
      expect(result).toEqual(models);
    });

    it('sends Authorization header', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );

      await service.listModels();
      const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-key');
    });

    it('calls /v1/models endpoint', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );

      await service.listModels();
      expect(fetchSpy.mock.calls[0][0]).toBe('https://api.example.com/v1/models');
    });

    it('returns empty array on non-ok response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Not found', { status: 404 })
      );

      const result = await service.listModels();
      expect(result).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.listModels();
      expect(result).toEqual([]);
    });

    it('returns empty array when data field is missing', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      );

      const result = await service.listModels();
      expect(result).toEqual([]);
    });
  });

  describe('validateApiKey', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns true when listModels returns models', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'model-1' }] }), { status: 200 })
      );

      const result = await service.validateApiKey();
      expect(result).toBe(true);
    });

    it('tries completion endpoint when models endpoint returns empty', async () => {
      // First call: listModels returns empty
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
      // Second call: minimal completion returns 200
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [] }), { status: 200 })
      );

      const result = await service.validateApiKey();
      expect(result).toBe(true);
      // Second fetch should be to completions endpoint
      expect(fetchSpy.mock.calls[1][0]).toBe('https://api.example.com/v1/chat/completions');
    });

    it('returns false when completion endpoint returns 401', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
      fetchSpy.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 })
      );

      const result = await service.validateApiKey();
      expect(result).toBe(false);
    });

    it('returns false when completion endpoint returns 403', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
      fetchSpy.mockResolvedValueOnce(
        new Response('Forbidden', { status: 403 })
      );

      const result = await service.validateApiKey();
      expect(result).toBe(false);
    });

    it('returns true when completion endpoint returns 400 (auth worked, model invalid)', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
      fetchSpy.mockResolvedValueOnce(
        new Response('Model not found', { status: 400 })
      );

      const result = await service.validateApiKey();
      expect(result).toBe(true);
    });

    it('returns false on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.validateApiKey();
      expect(result).toBe(false);
    });

    it('sends minimal test request to completions', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await service.validateApiKey();

      // Check the completion request body
      const body = JSON.parse(fetchSpy.mock.calls[1][1]!.body as string);
      expect(body.model).toBe('test');
      expect(body.messages).toEqual([{ role: 'user', content: 'test' }]);
      expect(body.max_tokens).toBe(1);
    });
  });
});
