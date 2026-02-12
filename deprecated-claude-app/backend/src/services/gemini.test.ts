import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { Message } from '@deprecated-claude/shared';

// Mock the Database
vi.mock('../database/index.js', () => ({
  Database: class MockDatabase {},
}));

// Mock blob store
const mockSaveBlob = vi.fn().mockResolvedValue('mock-blob-id');
const mockLoadBlob = vi.fn().mockResolvedValue({
  data: Buffer.from('blob-data'),
  metadata: { mimeType: 'image/png' },
});
const mockDeleteBlob = vi.fn();
vi.mock('../database/blob-store.js', () => ({
  getBlobStore: vi.fn(() => ({
    saveBlob: mockSaveBlob,
    loadBlob: mockLoadBlob,
    deleteBlob: mockDeleteBlob,
  })),
}));

import { GeminiService } from './gemini.js';
import { Database } from '../database/index.js';

// Helper to build SSE data lines from JSON chunks
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

// Helper to create a mock fetch Response with SSE body
function mockSSEResponse(chunks: any[], status = 200): Response {
  const body = sseLines(chunks);
  return new Response(makeReadableStream(body), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// Helper to create a mock error Response
function mockErrorResponse(status: number, errorText: string): Response {
  return new Response(errorText, { status, statusText: 'Error' });
}

// Default model settings
function defaultSettings(overrides: any = {}) {
  return {
    temperature: 0.7,
    maxTokens: 1024,
    ...overrides,
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

describe('GeminiService', () => {
  let service: GeminiService;

  beforeEach(() => {
    const mockDb = new Database() as any;
    service = new GeminiService(mockDb, 'test-gemini-key');
  });

  describe('formatMessagesForGemini (private)', () => {
    it('formats a simple user message', async () => {
      const svc = service as any;
      const messages = [makeMessage('Hello Gemini')];
      const result = await svc.formatMessagesForGemini(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].parts).toHaveLength(1);
      expect(result[0].parts[0].text).toBe('Hello Gemini');
    });

    it('maps assistant role to model role', async () => {
      const svc = service as any;
      const messages = [makeMessage('Response', 'assistant')];
      const result = await svc.formatMessagesForGemini(messages);

      expect(result[0].role).toBe('model');
      expect(result[0].parts[0].text).toBe('Response');
    });

    it('skips system messages', async () => {
      const svc = service as any;
      const messages = [
        makeMessage('System instruction', 'system'),
        makeMessage('Question', 'user'),
      ];
      const result = await svc.formatMessagesForGemini(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
    });

    it('preserves multi-turn ordering', async () => {
      const svc = service as any;
      const messages = [
        makeMessage('Q1', 'user'),
        makeMessage('A1', 'assistant'),
        makeMessage('Q2', 'user'),
      ];
      const result = await svc.formatMessagesForGemini(messages);

      expect(result.map((m: any) => m.role)).toEqual(['user', 'model', 'user']);
    });

    // --- Thought signatures ---

    it('attaches thought_signature from contentBlocks to text part', async () => {
      const svc = service as any;
      const messages = [
        makeMessage('Response with signature', 'assistant', {
          contentBlocks: [
            { type: 'text', text: 'Response with signature', thoughtSignature: 'sig-abc-123' },
          ],
        }),
      ];
      const result = await svc.formatMessagesForGemini(messages);

      expect(result[0].parts[0].thought_signature).toBe('sig-abc-123');
    });

    it('does not add thought_signature when not present', async () => {
      const svc = service as any;
      const messages = [makeMessage('No signature', 'user')];
      const result = await svc.formatMessagesForGemini(messages);

      expect(result[0].parts[0].thought_signature).toBeUndefined();
    });

    // --- Attachments ---

    it('adds image attachment as inlineData part', async () => {
      const svc = service as any;
      const imgBase64 = Buffer.from('img').toString('base64');
      const messages = [
        makeMessage('Describe', 'user', {
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
      const result = await svc.formatMessagesForGemini(messages);

      expect(result[0].parts).toHaveLength(2);
      expect(result[0].parts[0].text).toBe('Describe');
      expect(result[0].parts[1].inlineData).toEqual({
        mimeType: 'image/jpeg',
        data: imgBase64,
      });
    });

    it('adds PDF attachment as inlineData part', async () => {
      const svc = service as any;
      const pdfBase64 = Buffer.from('pdf').toString('base64');
      const messages = [
        makeMessage('Read', 'user', {
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
      const result = await svc.formatMessagesForGemini(messages);

      expect(result[0].parts[1].inlineData.mimeType).toBe('application/pdf');
    });

    it('adds audio attachment as inlineData part', async () => {
      const svc = service as any;
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
      const result = await svc.formatMessagesForGemini(messages);

      expect(result[0].parts[1].inlineData.mimeType).toBe('audio/mpeg');
    });

    it('appends unsupported attachment types as text', async () => {
      const svc = service as any;
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
      const result = await svc.formatMessagesForGemini(messages);

      // Unsupported type gets appended to text part
      expect(result[0].parts).toHaveLength(1);
      expect(result[0].parts[0].text).toContain('<attachment filename="code.ts">');
      expect(result[0].parts[0].text).toContain('const x = 1;');
    });

    // --- Content blocks with images (history) ---

    it('includes image content blocks from history via blob store', async () => {
      const svc = service as any;
      const messages = [
        makeMessage('Describe what you drew', 'assistant', {
          contentBlocks: [
            { type: 'image', mimeType: 'image/png', blobId: 'blob-123' },
          ],
        }),
      ];
      const result = await svc.formatMessagesForGemini(messages);

      // Should have text part + inlineData part from blob
      const inlineDataParts = result[0].parts.filter((p: any) => p.inlineData);
      expect(inlineDataParts).toHaveLength(1);
      expect(inlineDataParts[0].inlineData.mimeType).toBe('image/png');
    });

    it('skips image content blocks when blob loading fails', async () => {
      const { getBlobStore } = await import('../database/blob-store.js');
      (getBlobStore as any).mockReturnValueOnce({
        loadBlob: vi.fn().mockResolvedValue(null),
        saveBlob: vi.fn(),
        deleteBlob: vi.fn(),
      });

      const svc = service as any;
      const messages = [
        makeMessage('Describe missing image', 'assistant', {
          contentBlocks: [
            { type: 'image', mimeType: 'image/png', blobId: 'missing-blob-id' },
          ],
        }),
      ];
      const result = await svc.formatMessagesForGemini(messages);

      // Should have text part but no inlineData since blob loading returned null
      const inlineDataParts = result[0].parts.filter((p: any) => p.inlineData);
      expect(inlineDataParts).toHaveLength(0);
    });

    it('includes legacy inline image data from content blocks', async () => {
      const svc = service as any;
      const imgData = Buffer.from('old-format').toString('base64');
      const messages = [
        makeMessage('Old image', 'assistant', {
          contentBlocks: [
            { type: 'image', mimeType: 'image/jpeg', data: imgData },
          ],
        }),
      ];
      const result = await svc.formatMessagesForGemini(messages);

      const inlineDataParts = result[0].parts.filter((p: any) => p.inlineData);
      expect(inlineDataParts).toHaveLength(1);
      expect(inlineDataParts[0].inlineData.data).toBe(imgData);
    });

    // --- Edge cases ---

    it('returns empty array for empty messages', async () => {
      const svc = service as any;
      const result = await svc.formatMessagesForGemini([]);
      expect(result).toEqual([]);
    });

    it('skips messages with no active branch', async () => {
      const svc = service as any;
      const message: Message = {
        id: randomUUID(),
        conversationId: randomUUID(),
        order: 0,
        activeBranchId: 'nonexistent',
        branches: [{ id: randomUUID(), content: 'ghost', role: 'user', createdAt: new Date() }],
      };
      const result = await svc.formatMessagesForGemini([message]);
      expect(result).toEqual([]);
    });

    it('skips messages with empty content and no attachments', async () => {
      const svc = service as any;
      const messages = [makeMessage('', 'user')];
      const result = await svc.formatMessagesForGemini(messages);

      // Message has empty content, no parts → skipped
      expect(result).toEqual([]);
    });
  });

  describe('getMimeType (private)', () => {
    it('uses provided mimeType when available', () => {
      const svc = service as any;
      expect(svc.getMimeType('file.xyz', 'custom/type')).toBe('custom/type');
    });

    it('maps known extensions correctly', () => {
      const svc = service as any;
      expect(svc.getMimeType('photo.jpg')).toBe('image/jpeg');
      expect(svc.getMimeType('photo.jpeg')).toBe('image/jpeg');
      expect(svc.getMimeType('photo.png')).toBe('image/png');
      expect(svc.getMimeType('photo.gif')).toBe('image/gif');
      expect(svc.getMimeType('photo.webp')).toBe('image/webp');
      expect(svc.getMimeType('doc.pdf')).toBe('application/pdf');
      expect(svc.getMimeType('song.mp3')).toBe('audio/mpeg');
      expect(svc.getMimeType('video.mp4')).toBe('video/mp4');
      expect(svc.getMimeType('video.avi')).toBe('video/x-msvideo');
    });

    it('falls back to application/octet-stream for unknown extensions', () => {
      const svc = service as any;
      expect(svc.getMimeType('data.xyz')).toBe('application/octet-stream');
    });
  });

  describe('isSupportedMediaType (private)', () => {
    it('supports image types', () => {
      const svc = service as any;
      expect(svc.isSupportedMediaType('image/jpeg')).toBe(true);
      expect(svc.isSupportedMediaType('image/png')).toBe(true);
      expect(svc.isSupportedMediaType('image/webp')).toBe(true);
    });

    it('supports audio types', () => {
      const svc = service as any;
      expect(svc.isSupportedMediaType('audio/mpeg')).toBe(true);
      expect(svc.isSupportedMediaType('audio/wav')).toBe(true);
    });

    it('supports video types', () => {
      const svc = service as any;
      expect(svc.isSupportedMediaType('video/mp4')).toBe(true);
    });

    it('supports PDF', () => {
      const svc = service as any;
      expect(svc.isSupportedMediaType('application/pdf')).toBe(true);
    });

    it('rejects unsupported types', () => {
      const svc = service as any;
      expect(svc.isSupportedMediaType('application/octet-stream')).toBe(false);
      expect(svc.isSupportedMediaType('text/plain')).toBe(false);
      expect(svc.isSupportedMediaType('application/json')).toBe(false);
    });
  });

  describe('constructor', () => {
    it('stores provided API key', () => {
      const svc = service as any;
      expect(svc.apiKey).toBe('test-gemini-key');
    });

    it('sets default base URL', () => {
      const svc = service as any;
      expect(svc.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    });

    it('falls back to empty string when no key provided and env not set', () => {
      const origKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const svc = new GeminiService(new Database() as any) as any;
      expect(svc.apiKey).toBe('');
      consoleSpy.mockRestore();
      if (origKey !== undefined) process.env.GEMINI_API_KEY = origKey;
    });
  });

  describe('streamCompletion', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      fetchSpy = vi.spyOn(globalThis, 'fetch');
      mockSaveBlob.mockClear();
      mockDeleteBlob.mockClear();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('streams text chunks and calls onChunk with incremental text', async () => {
      const chunks = [
        { candidates: [{ content: { parts: [{ text: 'Hello' }] } }] },
        { candidates: [{ content: { parts: [{ text: ' world' }] } }] },
        { candidates: [{ content: { parts: [{ text: '!' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      const result = await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('Hi')],
        undefined,
        defaultSettings(),
        onChunk
      );

      // Should receive each text chunk + completion call
      const textCalls = onChunk.mock.calls.filter((c: any) => c[0] !== '' && !c[1]);
      expect(textCalls.length).toBe(3);
      expect(textCalls[0][0]).toBe('Hello');
      expect(textCalls[1][0]).toBe(' world');
      expect(textCalls[2][0]).toBe('!');

      // Final completion call
      const completionCall = onChunk.mock.calls.find((c: any) => c[1] === true);
      expect(completionCall).toBeDefined();

      // Usage returned
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });

    it('builds request URL with model ID and API key', async () => {
      const chunks = [
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      expect(fetchSpy).toHaveBeenCalledOnce();
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('models/gemini-2.5-flash:streamGenerateContent');
      expect(url).toContain('alt=sse');
      expect(url).toContain('key=test-gemini-key');
    });

    it('includes system instruction when systemPrompt provided', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        'Be helpful',
        defaultSettings(),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.systemInstruction).toEqual({
        parts: [{ text: 'Be helpful' }],
      });
    });

    it('does not include systemInstruction when systemPrompt is undefined', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.systemInstruction).toBeUndefined();
    });

    it('sets temperature and maxOutputTokens in generationConfig', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings({ temperature: 0.5, maxTokens: 2048 }),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.generationConfig.temperature).toBe(0.5);
      expect(body.generationConfig.maxOutputTokens).toBe(2048);
    });

    it('includes topP and topK when provided', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings({ topP: 0.9, topK: 40 }),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.generationConfig.topP).toBe(0.9);
      expect(body.generationConfig.topK).toBe(40);
    });

    it('does not include topP/topK when undefined', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.generationConfig.topP).toBeUndefined();
      expect(body.generationConfig.topK).toBeUndefined();
    });

    it('includes stop sequences limited to 5', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk,
        ['a', 'b', 'c', 'd', 'e', 'f', 'g']
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.generationConfig.stopSequences).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(body.generationConfig.stopSequences).toHaveLength(5);
    });

    it('does not include stopSequences when empty array', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk,
        []
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.generationConfig.stopSequences).toBeUndefined();
    });

    it('includes responseModalities from modelSpecific settings', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash-image',
        [makeMessage('draw a cat')],
        undefined,
        defaultSettings({ modelSpecific: { responseModalities: ['TEXT', 'IMAGE'] } }),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.generationConfig.responseModalities).toEqual(['TEXT', 'IMAGE']);
    });

    it('includes imageConfig when IMAGE is in responseModalities', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash-image',
        [makeMessage('draw a cat')],
        undefined,
        defaultSettings({
          modelSpecific: {
            responseModalities: ['TEXT', 'IMAGE'],
            'imageConfig.aspectRatio': '16:9',
            'imageConfig.imageSize': '1024x1024',
          },
        }),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.generationConfig.imageConfig).toEqual({
        aspectRatio: '16:9',
        imageSize: '1024x1024',
      });
    });

    it('does not include imageConfig when IMAGE is not in responseModalities', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings({
          modelSpecific: {
            responseModalities: ['TEXT'],
            'imageConfig.aspectRatio': '16:9',
          },
        }),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.generationConfig.imageConfig).toBeUndefined();
    });

    it('includes Google Search tool when enabled', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('search for cats')],
        undefined,
        defaultSettings({ modelSpecific: { 'tools.googleSearch': true } }),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.tools).toEqual([{ googleSearch: {} }]);
    });

    it('does not include tools when Google Search is not enabled', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.tools).toBeUndefined();
    });

    it('includes thinkingConfig when thinking is enabled', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-3-pro-preview',
        [makeMessage('think about this')],
        undefined,
        defaultSettings({ thinking: { enabled: true, budgetTokens: 4096 } }),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.generationConfig.thinkingConfig).toEqual({
        includeThoughts: true,
        thinkingBudget: 4096,
      });
    });

    it('includes thinkingConfig without budget when budgetTokens not specified', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-3-pro-preview',
        [makeMessage('think')],
        undefined,
        defaultSettings({ thinking: { enabled: true } }),
        onChunk
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.generationConfig.thinkingConfig).toEqual({
        includeThoughts: true,
      });
    });

    it('handles thinking content in stream (thought: true parts)', async () => {
      const chunks = [
        { candidates: [{ content: { parts: [{ text: 'Let me think...', thought: true }] } }] },
        { candidates: [{ content: { parts: [{ text: ' more reasoning', thought: true }] } }] },
        { candidates: [{ content: { parts: [{ text: 'The answer is 42' }] } }] },
        { usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 30, totalTokenCount: 50 } },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      const result = await service.streamCompletion(
        'gemini-3-pro-preview',
        [makeMessage('What is the meaning of life?')],
        undefined,
        defaultSettings({ thinking: { enabled: true } }),
        onChunk
      );

      // The completion call should include content blocks with thinking
      const completionCall = onChunk.mock.calls.find((c: any) => c[1] === true);
      expect(completionCall).toBeDefined();
      const blocks = completionCall![2];
      expect(blocks).toBeDefined();
      // First block should be thinking
      expect(blocks[0].type).toBe('thinking');
      expect(blocks[0].thinking).toBe('Let me think... more reasoning');
      // Second block should be text
      expect(blocks[1].type).toBe('text');
      expect(blocks[1].text).toBe('The answer is 42');
    });

    it('handles thought_signature in stream chunks', async () => {
      const chunks = [
        { candidates: [{ content: { parts: [{ text: 'Response', thought_signature: 'sig-xyz-789' }] } }] },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-3-pro-preview',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      // Completion call should include text block with thoughtSignature
      const completionCall = onChunk.mock.calls.find((c: any) => c[1] === true);
      const blocks = completionCall![2];
      expect(blocks).toBeDefined();
      const textBlock = blocks.find((b: any) => b.type === 'text');
      expect(textBlock.thoughtSignature).toBe('sig-xyz-789');
    });

    it('handles inline image data in stream', async () => {
      const imageData = Buffer.from('fake-image').toString('base64');
      const chunks = [
        { candidates: [{ content: { parts: [{ text: 'Here is an image' }] } }] },
        { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: imageData } }] } }] },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash-image',
        [makeMessage('draw something')],
        undefined,
        defaultSettings({ modelSpecific: { responseModalities: ['TEXT', 'IMAGE'] } }),
        onChunk
      );

      // saveBlob should have been called with the image data
      expect(mockSaveBlob).toHaveBeenCalledWith(imageData, 'image/png');

      // Completion call should have image content block
      const completionCall = onChunk.mock.calls.find((c: any) => c[1] === true);
      const blocks = completionCall![2];
      expect(blocks).toBeDefined();
      const imageBlock = blocks.find((b: any) => b.type === 'image');
      expect(imageBlock).toBeDefined();
      expect(imageBlock.blobId).toBe('mock-blob-id');
    });

    it('replaces preview image with final image and deletes old blob', async () => {
      const previewData = Buffer.from('preview').toString('base64');
      const finalData = Buffer.from('final-hires').toString('base64');
      mockSaveBlob
        .mockResolvedValueOnce('preview-blob-id')
        .mockResolvedValueOnce('final-blob-id');

      const chunks = [
        { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: previewData } }] } }] },
        { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: finalData } }] } }] },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash-image',
        [makeMessage('draw')],
        undefined,
        defaultSettings({ modelSpecific: { responseModalities: ['TEXT', 'IMAGE'] } }),
        onChunk
      );

      // Should save both blobs
      expect(mockSaveBlob).toHaveBeenCalledTimes(2);
      // Should delete the old preview blob
      expect(mockDeleteBlob).toHaveBeenCalledWith('preview-blob-id');

      // Final content blocks should have the final blob
      const completionCall = onChunk.mock.calls.find((c: any) => c[1] === true);
      const blocks = completionCall![2];
      const imageBlock = blocks.find((b: any) => b.type === 'image');
      expect(imageBlock.blobId).toBe('final-blob-id');
    });

    it('returns rawRequest in the result', async () => {
      fetchSpy.mockResolvedValueOnce(mockSSEResponse([
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ]));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      const result = await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        'system',
        defaultSettings(),
        onChunk
      );

      expect(result.rawRequest).toBeDefined();
      expect(result.rawRequest.contents).toBeDefined();
      expect(result.rawRequest.generationConfig).toBeDefined();
      expect(result.rawRequest.systemInstruction).toBeDefined();
    });

    it('throws on non-ok HTTP response', async () => {
      fetchSpy.mockResolvedValueOnce(mockErrorResponse(429, 'Rate limit exceeded'));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await expect(
        service.streamCompletion(
          'gemini-2.5-flash',
          [makeMessage('test')],
          undefined,
          defaultSettings(),
          onChunk
        )
      ).rejects.toThrow('Gemini API error: 429 Rate limit exceeded');
    });

    it('throws when response has no body', async () => {
      // Create a Response with null body
      const resp = new Response(null, { status: 200 });
      Object.defineProperty(resp, 'body', { value: null });
      fetchSpy.mockResolvedValueOnce(resp);

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await expect(
        service.streamCompletion(
          'gemini-2.5-flash',
          [makeMessage('test')],
          undefined,
          defaultSettings(),
          onChunk
        )
      ).rejects.toThrow('No response body from Gemini API');
    });

    it('calls onChunk with failure metrics on error', async () => {
      fetchSpy.mockResolvedValueOnce(mockErrorResponse(500, 'Internal server error'));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      try {
        await service.streamCompletion(
          'gemini-2.5-flash',
          [makeMessage('test')],
          undefined,
          defaultSettings(),
          onChunk
        );
      } catch {
        // Expected
      }

      // onChunk should be called with failure metrics
      const failureCall = onChunk.mock.calls.find((c: any) => c[1] === true && c[3]?.failed);
      expect(failureCall).toBeDefined();
      expect(failureCall![3].failed).toBe(true);
      expect(failureCall![3].error).toContain('500');
      expect(failureCall![3].inputTokens).toBeGreaterThan(0);
      expect(failureCall![3].outputTokens).toBe(0);
    });

    it('handles malformed JSON in SSE data gracefully', async () => {
      // Create a stream with invalid JSON
      const body = `data: {"candidates":[{"content":{"parts":[{"text":"valid"}]}}]}\n\ndata: {invalid json}\n\ndata: {"candidates":[{"content":{"parts":[{"text":" end"}]}}]}\n\n`;
      fetchSpy.mockResolvedValueOnce(
        new Response(makeReadableStream(body), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      // Should still process valid chunks; the invalid one gets logged and skipped
      const textCalls = onChunk.mock.calls.filter((c: any) => c[0] !== '' && !c[1]);
      expect(textCalls.length).toBe(2);
      expect(textCalls[0][0]).toBe('valid');
      expect(textCalls[1][0]).toBe(' end');
    });

    it('skips [DONE] marker in SSE stream', async () => {
      const body = `data: {"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}\n\ndata: [DONE]\n\n`;
      fetchSpy.mockResolvedValueOnce(
        new Response(makeReadableStream(body), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      // Should only get one text chunk, not crash on [DONE]
      const textCalls = onChunk.mock.calls.filter((c: any) => c[0] !== '' && !c[1]);
      expect(textCalls.length).toBe(1);
    });

    it('handles usage metadata with defensive defaults for missing fields', async () => {
      const chunks = [
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { totalTokenCount: 100 } },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      const result = await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      // Should use ?? 0 defaults for missing prompt/candidates counts
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    });

    it('handles finishReason in candidates', async () => {
      const chunks = [
        { candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }] },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      // Should complete without error (finish reason logged)
      const completionCall = onChunk.mock.calls.find((c: any) => c[1] === true);
      expect(completionCall).toBeDefined();
    });

    it('handles thinking without subsequent text content (diagnostic case)', async () => {
      const chunks = [
        { candidates: [{ content: { parts: [{ text: 'Thinking deeply...', thought: true }] } }] },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-3-pro-preview',
        [makeMessage('test')],
        undefined,
        defaultSettings({ thinking: { enabled: true } }),
        onChunk
      );

      // Completion call should have only thinking block (no text)
      const completionCall = onChunk.mock.calls.find((c: any) => c[1] === true);
      const blocks = completionCall![2];
      expect(blocks).toBeDefined();
      expect(blocks.length).toBe(1);
      expect(blocks[0].type).toBe('thinking');
      expect(blocks[0].thinking).toBe('Thinking deeply...');
    });

    it('handles text + image output (text first, then image)', async () => {
      const imageData = Buffer.from('cat-img').toString('base64');
      const chunks = [
        { candidates: [{ content: { parts: [{ text: 'Here is a cat' }] } }] },
        { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: imageData } }] } }] },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash-image',
        [makeMessage('draw a cat')],
        undefined,
        defaultSettings({ modelSpecific: { responseModalities: ['TEXT', 'IMAGE'] } }),
        onChunk
      );

      // Completion should have text block first (unshift), then image
      const completionCall = onChunk.mock.calls.find((c: any) => c[1] === true);
      const blocks = completionCall![2];
      expect(blocks[0].type).toBe('text');
      expect(blocks[0].text).toBe('Here is a cat');
      expect(blocks[1].type).toBe('image');
    });

    it('returns no usage when stream has no usageMetadata', async () => {
      const chunks = [
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      const result = await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      expect(result.usage).toBeUndefined();
    });

    it('records failure metrics even when onChunk throws during error handling', async () => {
      fetchSpy.mockResolvedValueOnce(mockErrorResponse(500, 'Server error'));

      const onChunk = vi.fn()
        .mockRejectedValueOnce(new Error('onChunk failed'));

      await expect(
        service.streamCompletion(
          'gemini-2.5-flash',
          [makeMessage('test')],
          undefined,
          defaultSettings(),
          onChunk
        )
      ).rejects.toThrow('Gemini API error: 500');

      // Even though onChunk threw, the original error should still propagate
    });

    it('handles empty candidates array in chunk', async () => {
      const chunks = [
        { candidates: [] },
        { candidates: [{ content: { parts: [{ text: 'after empty' }] } }] },
      ];
      fetchSpy.mockResolvedValueOnce(mockSSEResponse(chunks));

      const onChunk = vi.fn().mockResolvedValue(undefined);
      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings(),
        onChunk
      );

      // Should still process the second chunk
      const textCalls = onChunk.mock.calls.filter((c: any) => c[0] !== '' && !c[1]);
      expect(textCalls.length).toBe(1);
      expect(textCalls[0][0]).toBe('after empty');
    });
  });

  describe('generateContent', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchSpy = vi.spyOn(globalThis, 'fetch');
      mockSaveBlob.mockClear();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns text content from non-streaming response', async () => {
      const apiResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'The answer is 42' }],
            role: 'model',
          },
        }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 },
      };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(apiResponse), { status: 200 }));

      const result = await service.generateContent(
        'gemini-2.5-flash',
        [makeMessage('question')],
        undefined,
        defaultSettings()
      );

      expect(result.content).toBe('The answer is 42');
      expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 10 });
    });

    it('builds URL without SSE params for non-streaming', async () => {
      const apiResponse = {
        candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' } }],
      };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(apiResponse), { status: 200 }));

      await service.generateContent(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings()
      );

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('models/gemini-2.5-flash:generateContent');
      expect(url).not.toContain('streamGenerateContent');
      expect(url).not.toContain('alt=sse');
    });

    it('includes system instruction in non-streaming request', async () => {
      const apiResponse = {
        candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' } }],
      };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(apiResponse), { status: 200 }));

      await service.generateContent(
        'gemini-2.5-flash',
        [makeMessage('test')],
        'Be concise',
        defaultSettings()
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.systemInstruction).toEqual({ parts: [{ text: 'Be concise' }] });
    });

    it('handles thinking content in non-streaming response', async () => {
      const apiResponse = {
        candidates: [{
          content: {
            parts: [
              { text: 'Let me think...', thought: true },
              { text: 'The answer is 42' },
            ],
            role: 'model',
          },
        }],
      };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(apiResponse), { status: 200 }));

      const result = await service.generateContent(
        'gemini-3-pro-preview',
        [makeMessage('test')],
        undefined,
        defaultSettings({ thinking: { enabled: true } })
      );

      expect(result.content).toBe('The answer is 42');
      expect(result.contentBlocks[0].type).toBe('thinking');
      expect((result.contentBlocks[0] as any).thinking).toBe('Let me think...');
      expect(result.contentBlocks[1].type).toBe('text');
      expect((result.contentBlocks[1] as any).text).toBe('The answer is 42');
    });

    it('handles image content in non-streaming response', async () => {
      const imageData = Buffer.from('image-bytes').toString('base64');
      const apiResponse = {
        candidates: [{
          content: {
            parts: [
              { text: 'Here is an image' },
              { inlineData: { mimeType: 'image/png', data: imageData } },
            ],
            role: 'model',
          },
        }],
      };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(apiResponse), { status: 200 }));

      const result = await service.generateContent(
        'gemini-2.5-flash-image',
        [makeMessage('draw')],
        undefined,
        defaultSettings({ modelSpecific: { responseModalities: ['TEXT', 'IMAGE'] } })
      );

      expect(result.content).toBe('Here is an image');
      expect(mockSaveBlob).toHaveBeenCalledWith(imageData, 'image/png');
      const imageBlock = result.contentBlocks.find((b: any) => b.type === 'image') as any;
      expect(imageBlock).toBeDefined();
      expect(imageBlock.blobId).toBe('mock-blob-id');
    });

    it('throws on non-ok response for non-streaming', async () => {
      fetchSpy.mockResolvedValueOnce(mockErrorResponse(400, 'Bad request'));

      await expect(
        service.generateContent(
          'gemini-2.5-flash',
          [makeMessage('test')],
          undefined,
          defaultSettings()
        )
      ).rejects.toThrow('Gemini API error: 400 Bad request');
    });

    it('returns undefined usage when no usageMetadata', async () => {
      const apiResponse = {
        candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' } }],
      };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(apiResponse), { status: 200 }));

      const result = await service.generateContent(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings()
      );

      expect(result.usage).toBeUndefined();
    });

    it('handles empty candidates in non-streaming response', async () => {
      const apiResponse = { candidates: [] };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(apiResponse), { status: 200 }));

      const result = await service.generateContent(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings()
      );

      expect(result.content).toBe('');
      expect(result.contentBlocks).toEqual([]);
    });

    it('includes Google Search tool in non-streaming request', async () => {
      const apiResponse = {
        candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' } }],
      };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(apiResponse), { status: 200 }));

      await service.generateContent(
        'gemini-2.5-flash',
        [makeMessage('test')],
        undefined,
        defaultSettings({ modelSpecific: { 'tools.googleSearch': true } })
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.tools).toEqual([{ googleSearch: {} }]);
    });

    it('includes thinkingConfig in non-streaming request', async () => {
      const apiResponse = {
        candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' } }],
      };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(apiResponse), { status: 200 }));

      await service.generateContent(
        'gemini-3-pro-preview',
        [makeMessage('test')],
        undefined,
        defaultSettings({ thinking: { enabled: true, budgetTokens: 2048 } })
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.generationConfig.thinkingConfig).toEqual({
        includeThoughts: true,
        thinkingBudget: 2048,
      });
    });

    it('includes imageConfig in non-streaming request when IMAGE in responseModalities', async () => {
      const apiResponse = {
        candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' } }],
      };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(apiResponse), { status: 200 }));

      await service.generateContent(
        'gemini-2.5-flash-image',
        [makeMessage('draw')],
        undefined,
        defaultSettings({
          modelSpecific: {
            responseModalities: ['TEXT', 'IMAGE'],
            'imageConfig.aspectRatio': '1:1',
          },
        })
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: '1:1' });
    });

    it('places text block after thinking block when both present', async () => {
      const apiResponse = {
        candidates: [{
          content: {
            parts: [
              { text: 'reasoning', thought: true },
              { text: 'answer' },
            ],
            role: 'model',
          },
        }],
      };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(apiResponse), { status: 200 }));

      const result = await service.generateContent(
        'gemini-3-pro-preview',
        [makeMessage('test')],
        undefined,
        defaultSettings({ thinking: { enabled: true } })
      );

      expect(result.contentBlocks[0].type).toBe('thinking');
      expect(result.contentBlocks[1].type).toBe('text');
    });

    it('places text block first when no thinking and has images', async () => {
      const imageData = Buffer.from('img').toString('base64');
      const apiResponse = {
        candidates: [{
          content: {
            parts: [
              { text: 'caption' },
              { inlineData: { mimeType: 'image/png', data: imageData } },
            ],
            role: 'model',
          },
        }],
      };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(apiResponse), { status: 200 }));

      const result = await service.generateContent(
        'gemini-2.5-flash-image',
        [makeMessage('draw')],
        undefined,
        defaultSettings({ modelSpecific: { responseModalities: ['TEXT', 'IMAGE'] } })
      );

      // Text should be unshifted to beginning
      expect(result.contentBlocks[0].type).toBe('text');
      expect((result.contentBlocks[0] as any).text).toBe('caption');
      expect(result.contentBlocks[1].type).toBe('image');
    });
  });
});
