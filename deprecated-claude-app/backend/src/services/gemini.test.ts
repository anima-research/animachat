import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    loadBlob: vi.fn().mockResolvedValue({
      data: Buffer.from('blob-data'),
      metadata: { mimeType: 'image/png' },
    }),
    deleteBlob: vi.fn(),
  })),
}));

import { GeminiService } from './gemini.js';
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

  // =========================================================================
  // Streaming / streamCompletion characterization tests
  // =========================================================================

  describe('streamCompletion', () => {
    // Helper: encode SSE data lines from Gemini stream chunks
    function makeSSEData(chunks: any[]): string {
      return chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('');
    }

    // Create a ReadableStream from a string (simulates SSE body)
    function createReadableStream(data: string): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder();
      const encoded = encoder.encode(data);
      let delivered = false;
      return new ReadableStream({
        pull(controller) {
          if (!delivered) {
            controller.enqueue(encoded);
            delivered = true;
          } else {
            controller.close();
          }
        },
      });
    }

    // Standard simple text response
    function makeSimpleTextChunks(text: string, opts?: {
      inputTokens?: number;
      outputTokens?: number;
    }): any[] {
      const words = text.split(' ');
      const chunks: any[] = [];

      for (const word of words) {
        chunks.push({
          candidates: [{
            content: {
              parts: [{ text: word + ' ' }],
              role: 'model',
            },
          }],
        });
      }

      // Final chunk with finish reason and usage
      chunks.push({
        candidates: [{
          content: { parts: [{ text: '' }], role: 'model' },
          finishReason: 'STOP',
        }],
        usageMetadata: {
          promptTokenCount: opts?.inputTokens ?? 100,
          candidatesTokenCount: opts?.outputTokens ?? 50,
          totalTokenCount: (opts?.inputTokens ?? 100) + (opts?.outputTokens ?? 50),
        },
      });

      return chunks;
    }

    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('streams a simple text response and returns usage', async () => {
      const sseChunks = makeSimpleTextChunks('Hello from Gemini', { inputTokens: 120, outputTokens: 25 });
      const sseData = makeSSEData(sseChunks);

      fetchSpy.mockResolvedValue(new Response(createReadableStream(sseData), { status: 200 }));

      const receivedChunks: string[] = [];
      let finalUsage: any;
      let completionCalled = false;

      const onChunk = vi.fn(async (chunk: string, isComplete: boolean, _contentBlocks?: any[], usage?: any) => {
        if (chunk) receivedChunks.push(chunk);
        if (isComplete) {
          completionCalled = true;
          finalUsage = usage;
        }
      });

      const result = await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('Hi')],
        'You are helpful',
        { maxTokens: 1024, temperature: 0.7 },
        onChunk,
      );

      expect(receivedChunks.join('')).toContain('Hello');
      expect(completionCalled).toBe(true);

      // Usage from the last chunk
      expect(finalUsage).toEqual({
        inputTokens: 120,
        outputTokens: 25,
      });

      expect(result.usage).toEqual({
        inputTokens: 120,
        outputTokens: 25,
      });

      expect(result.rawRequest).toBeDefined();
      expect(result.rawRequest.generationConfig.maxOutputTokens).toBe(1024);
    });

    it('builds correct URL with API key and model', async () => {
      const sseData = makeSSEData(makeSimpleTextChunks('ok'));
      fetchSpy.mockResolvedValue(new Response(createReadableStream(sseData), { status: 200 }));

      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('Test')],
        undefined,
        { maxTokens: 1024 },
        vi.fn(async () => {}),
      );

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('models/gemini-2.5-flash:streamGenerateContent'),
        expect.objectContaining({ method: 'POST' }),
      );
      // URL should contain the API key
      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('key=test-gemini-key');
    });

    it('includes system instruction when systemPrompt is provided', async () => {
      const sseData = makeSSEData(makeSimpleTextChunks('ok'));
      fetchSpy.mockResolvedValue(new Response(createReadableStream(sseData), { status: 200 }));

      const result = await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('Test')],
        'Be concise',
        { maxTokens: 1024 },
        vi.fn(async () => {}),
      );

      expect(result.rawRequest.systemInstruction).toEqual({
        parts: [{ text: 'Be concise' }],
      });
    });

    it('does not include system instruction when systemPrompt is undefined', async () => {
      const sseData = makeSSEData(makeSimpleTextChunks('ok'));
      fetchSpy.mockResolvedValue(new Response(createReadableStream(sseData), { status: 200 }));

      const result = await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('Test')],
        undefined,
        { maxTokens: 1024 },
        vi.fn(async () => {}),
      );

      expect(result.rawRequest.systemInstruction).toBeUndefined();
    });

    it('includes generationConfig with temperature, topP, topK', async () => {
      const sseData = makeSSEData(makeSimpleTextChunks('ok'));
      fetchSpy.mockResolvedValue(new Response(createReadableStream(sseData), { status: 200 }));

      const result = await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('Test')],
        undefined,
        { maxTokens: 2048, temperature: 0.5, topP: 0.9, topK: 40 },
        vi.fn(async () => {}),
      );

      expect(result.rawRequest.generationConfig.temperature).toBe(0.5);
      expect(result.rawRequest.generationConfig.topP).toBe(0.9);
      expect(result.rawRequest.generationConfig.topK).toBe(40);
      expect(result.rawRequest.generationConfig.maxOutputTokens).toBe(2048);
    });

    it('includes stop sequences (max 5)', async () => {
      const sseData = makeSSEData(makeSimpleTextChunks('ok'));
      fetchSpy.mockResolvedValue(new Response(createReadableStream(sseData), { status: 200 }));

      const result = await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('Test')],
        undefined,
        { maxTokens: 1024 },
        vi.fn(async () => {}),
        ['STOP1', 'STOP2', 'STOP3', 'STOP4', 'STOP5', 'STOP6'],
      );

      // Gemini only allows max 5 stop sequences
      expect(result.rawRequest.generationConfig.stopSequences).toHaveLength(5);
      expect(result.rawRequest.generationConfig.stopSequences).toEqual(['STOP1', 'STOP2', 'STOP3', 'STOP4', 'STOP5']);
    });

    it('includes thinking config when thinking is enabled', async () => {
      const sseData = makeSSEData(makeSimpleTextChunks('ok'));
      fetchSpy.mockResolvedValue(new Response(createReadableStream(sseData), { status: 200 }));

      const result = await service.streamCompletion(
        'gemini-3-pro-preview',
        [makeMessage('Think about this')],
        undefined,
        {
          maxTokens: 8192,
          thinking: { enabled: true, budgetTokens: 4096 },
        },
        vi.fn(async () => {}),
      );

      expect(result.rawRequest.generationConfig.thinkingConfig).toEqual({
        includeThoughts: true,
        thinkingBudget: 4096,
      });
    });

    it('includes thinking config without budget when budgetTokens is not set', async () => {
      const sseData = makeSSEData(makeSimpleTextChunks('ok'));
      fetchSpy.mockResolvedValue(new Response(createReadableStream(sseData), { status: 200 }));

      const result = await service.streamCompletion(
        'gemini-3-pro-preview',
        [makeMessage('Think')],
        undefined,
        {
          maxTokens: 8192,
          thinking: { enabled: true },
        },
        vi.fn(async () => {}),
      );

      expect(result.rawRequest.generationConfig.thinkingConfig).toEqual({
        includeThoughts: true,
      });
    });

    it('includes Google Search tool when enabled in modelSpecific', async () => {
      const sseData = makeSSEData(makeSimpleTextChunks('ok'));
      fetchSpy.mockResolvedValue(new Response(createReadableStream(sseData), { status: 200 }));

      const result = await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('Search for this')],
        undefined,
        {
          maxTokens: 1024,
          modelSpecific: { 'tools.googleSearch': true },
        },
        vi.fn(async () => {}),
      );

      expect(result.rawRequest.tools).toEqual([{ googleSearch: {} }]);
    });

    it('includes response modalities and image config when set', async () => {
      const sseData = makeSSEData(makeSimpleTextChunks('ok'));
      fetchSpy.mockResolvedValue(new Response(createReadableStream(sseData), { status: 200 }));

      const result = await service.streamCompletion(
        'gemini-2.5-flash-image',
        [makeMessage('Generate image')],
        undefined,
        {
          maxTokens: 1024,
          modelSpecific: {
            'responseModalities': ['TEXT', 'IMAGE'],
            'imageConfig.aspectRatio': '16:9',
            'imageConfig.imageSize': '4K',
          },
        },
        vi.fn(async () => {}),
      );

      expect(result.rawRequest.generationConfig.responseModalities).toEqual(['TEXT', 'IMAGE']);
      expect(result.rawRequest.generationConfig.imageConfig).toEqual({
        aspectRatio: '16:9',
        imageSize: '4K',
      });
    });

    it('does not include imageConfig when IMAGE is not in responseModalities', async () => {
      const sseData = makeSSEData(makeSimpleTextChunks('ok'));
      fetchSpy.mockResolvedValue(new Response(createReadableStream(sseData), { status: 200 }));

      const result = await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('Text only')],
        undefined,
        {
          maxTokens: 1024,
          modelSpecific: {
            'responseModalities': ['TEXT'],
            'imageConfig.aspectRatio': '16:9',
          },
        },
        vi.fn(async () => {}),
      );

      expect(result.rawRequest.generationConfig.imageConfig).toBeUndefined();
    });

    // --- Streaming event handling ---

    it('handles thinking content in streaming response', async () => {
      const chunks = [
        {
          candidates: [{
            content: {
              parts: [{ text: 'Let me reason about this...', thought: true }],
              role: 'model',
            },
          }],
        },
        {
          candidates: [{
            content: {
              parts: [{ text: ' and more thinking', thought: true }],
              role: 'model',
            },
          }],
        },
        {
          candidates: [{
            content: {
              parts: [{ text: 'The answer is 42' }],
              role: 'model',
            },
          }],
        },
        {
          candidates: [{
            content: { parts: [{ text: '' }], role: 'model' },
            finishReason: 'STOP',
          }],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 },
        },
      ];

      fetchSpy.mockResolvedValue(new Response(createReadableStream(makeSSEData(chunks)), { status: 200 }));

      let finalContentBlocks: any[] = [];
      const onChunk = vi.fn(async (_chunk: string, isComplete: boolean, contentBlocks?: any[]) => {
        if (isComplete && contentBlocks) {
          finalContentBlocks = contentBlocks;
        }
      });

      await service.streamCompletion(
        'gemini-3-pro-preview',
        [makeMessage('Think about this')],
        undefined,
        { maxTokens: 4096 },
        onChunk,
      );

      // Should have thinking block and text block
      expect(finalContentBlocks.length).toBeGreaterThanOrEqual(2);
      const thinkingBlock = finalContentBlocks.find((b: any) => b.type === 'thinking');
      expect(thinkingBlock).toBeDefined();
      expect(thinkingBlock.thinking).toContain('Let me reason about this...');
      expect(thinkingBlock.thinking).toContain(' and more thinking');

      const textBlock = finalContentBlocks.find((b: any) => b.type === 'text');
      expect(textBlock).toBeDefined();
      expect(textBlock.text).toBe('The answer is 42');
    });

    it('captures thought_signature from response parts', async () => {
      const chunks = [
        {
          candidates: [{
            content: {
              parts: [{ text: 'Thinking...', thought: true }],
              role: 'model',
            },
          }],
        },
        {
          candidates: [{
            content: {
              parts: [{ text: 'Answer', thought_signature: 'sig-xyz-123' }],
              role: 'model',
            },
          }],
        },
        {
          candidates: [{
            content: { parts: [{ text: '' }], role: 'model' },
            finishReason: 'STOP',
          }],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, totalTokenCount: 60 },
        },
      ];

      fetchSpy.mockResolvedValue(new Response(createReadableStream(makeSSEData(chunks)), { status: 200 }));

      let finalContentBlocks: any[] = [];
      const onChunk = vi.fn(async (_chunk: string, isComplete: boolean, contentBlocks?: any[]) => {
        if (isComplete && contentBlocks) {
          finalContentBlocks = contentBlocks;
        }
      });

      await service.streamCompletion(
        'gemini-3-pro-preview',
        [makeMessage('Test')],
        undefined,
        { maxTokens: 4096 },
        onChunk,
      );

      // Text block should have thoughtSignature
      const textBlock = finalContentBlocks.find((b: any) => b.type === 'text');
      expect(textBlock).toBeDefined();
      expect(textBlock.thoughtSignature).toBe('sig-xyz-123');
    });

    it('handles image generation in streaming response', async () => {
      const imgBase64 = Buffer.from('generated-image').toString('base64');
      const chunks = [
        {
          candidates: [{
            content: {
              parts: [{ text: 'Here is the image:' }],
              role: 'model',
            },
          }],
        },
        {
          candidates: [{
            content: {
              parts: [{
                inlineData: {
                  mimeType: 'image/png',
                  data: imgBase64,
                },
              }],
              role: 'model',
            },
          }],
        },
        {
          candidates: [{
            content: { parts: [{ text: '' }], role: 'model' },
            finishReason: 'STOP',
          }],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100, totalTokenCount: 150 },
        },
      ];

      fetchSpy.mockResolvedValue(new Response(createReadableStream(makeSSEData(chunks)), { status: 200 }));

      let finalContentBlocks: any[] = [];
      const onChunk = vi.fn(async (_chunk: string, isComplete: boolean, contentBlocks?: any[]) => {
        if (isComplete && contentBlocks) {
          finalContentBlocks = contentBlocks;
        }
      });

      await service.streamCompletion(
        'gemini-2.5-flash-image',
        [makeMessage('Draw a cat')],
        undefined,
        {
          maxTokens: 1024,
          modelSpecific: { responseModalities: ['TEXT', 'IMAGE'] },
        },
        onChunk,
      );

      // Should have text and image blocks
      const imageBlock = finalContentBlocks.find((b: any) => b.type === 'image');
      expect(imageBlock).toBeDefined();
      expect(imageBlock.blobId).toBe('mock-blob-id');

      const textBlock = finalContentBlocks.find((b: any) => b.type === 'text');
      expect(textBlock).toBeDefined();
      expect(textBlock.text).toBe('Here is the image:');
    });

    it('replaces preview image with final version', async () => {
      const preview = Buffer.from('preview').toString('base64');
      const final = Buffer.from('final-high-res').toString('base64');

      const { getBlobStore } = await import('../database/blob-store.js');
      let blobCallCount = 0;
      const mockBlobStore = {
        saveBlob: vi.fn().mockImplementation(() => {
          blobCallCount++;
          return Promise.resolve(`blob-${blobCallCount}`);
        }),
        loadBlob: vi.fn(),
        deleteBlob: vi.fn(),
      };
      (getBlobStore as any).mockReturnValue(mockBlobStore);

      const chunks = [
        {
          candidates: [{
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: preview } }],
              role: 'model',
            },
          }],
        },
        {
          candidates: [{
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: final } }],
              role: 'model',
            },
          }],
        },
        {
          candidates: [{
            content: { parts: [{ text: '' }], role: 'model' },
            finishReason: 'STOP',
          }],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100, totalTokenCount: 150 },
        },
      ];

      fetchSpy.mockResolvedValue(new Response(createReadableStream(makeSSEData(chunks)), { status: 200 }));

      let finalContentBlocks: any[] = [];
      const onChunk = vi.fn(async (_chunk: string, isComplete: boolean, contentBlocks?: any[]) => {
        if (isComplete && contentBlocks) {
          finalContentBlocks = contentBlocks;
        }
      });

      await service.streamCompletion(
        'gemini-2.5-flash-image',
        [makeMessage('Draw')],
        undefined,
        { maxTokens: 1024 },
        onChunk,
      );

      // Should have only one image block (the replacement)
      const imageBlocks = finalContentBlocks.filter((b: any) => b.type === 'image');
      expect(imageBlocks).toHaveLength(1);
      // The second blob id (final version) should be used
      expect(imageBlocks[0].blobId).toBe('blob-2');
      // Old preview blob should have been deleted
      expect(mockBlobStore.deleteBlob).toHaveBeenCalledWith('blob-1');

      // Restore the default mock
      (getBlobStore as any).mockReturnValue({
        saveBlob: vi.fn().mockResolvedValue('mock-blob-id'),
        loadBlob: vi.fn().mockResolvedValue({
          data: Buffer.from('blob-data'),
          metadata: { mimeType: 'image/png' },
        }),
        deleteBlob: vi.fn(),
      });
    });

    // --- Error handling ---

    it('throws on HTTP error and records failure metrics', async () => {
      fetchSpy.mockResolvedValue(new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }));

      const onChunk = vi.fn(async () => {});

      await expect(
        service.streamCompletion(
          'gemini-2.5-flash',
          [makeMessage('Will fail')],
          undefined,
          { maxTokens: 1024 },
          onChunk,
        ),
      ).rejects.toThrow('Gemini API error: 500');

      // onChunk should have been called with failure metrics
      const failureCall = onChunk.mock.calls.find(
        (call) => call[1] === true && call[3]?.failed === true
      );
      expect(failureCall).toBeDefined();
      expect(failureCall![3].failed).toBe(true);
      expect(failureCall![3].outputTokens).toBe(0);
      expect(failureCall![3].inputTokens).toBeGreaterThan(0);
    });

    it('throws when response has no body', async () => {
      fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));

      const onChunk = vi.fn(async () => {});

      await expect(
        service.streamCompletion(
          'gemini-2.5-flash',
          [makeMessage('No body')],
          undefined,
          { maxTokens: 1024 },
          onChunk,
        ),
      ).rejects.toThrow('No response body from Gemini API');
    });

    it('still throws if onChunk fails during error recording', async () => {
      fetchSpy.mockResolvedValue(new Response('Bad Request', { status: 400 }));

      const onChunk = vi.fn(async () => {
        throw new Error('onChunk failed');
      });

      await expect(
        service.streamCompletion(
          'gemini-2.5-flash',
          [makeMessage('Double fail')],
          undefined,
          { maxTokens: 1024 },
          onChunk,
        ),
      ).rejects.toThrow('Gemini API error: 400');
    });

    it('handles malformed JSON in SSE stream gracefully', async () => {
      const sseData = `data: {invalid json\n\ndata: ${JSON.stringify({
        candidates: [{
          content: { parts: [{ text: 'recovered' }], role: 'model' },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      })}\n\n`;

      fetchSpy.mockResolvedValue(new Response(createReadableStream(sseData), { status: 200 }));

      const receivedChunks: string[] = [];
      const onChunk = vi.fn(async (chunk: string) => {
        if (chunk) receivedChunks.push(chunk);
      });

      // Should not throw - parse errors are caught and logged
      const result = await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('Parse error test')],
        undefined,
        { maxTokens: 1024 },
        onChunk,
      );

      // Should have parsed the valid chunk after the invalid one
      expect(result.usage).toBeDefined();
    });

    it('skips [DONE] SSE events', async () => {
      const chunks = makeSimpleTextChunks('hello');
      const sseData = makeSSEData(chunks) + 'data: [DONE]\n\n';

      fetchSpy.mockResolvedValue(new Response(createReadableStream(sseData), { status: 200 }));

      const result = await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('Test')],
        undefined,
        { maxTokens: 1024 },
        vi.fn(async () => {}),
      );

      // Should complete without error
      expect(result.usage).toBeDefined();
    });

    it('handles thinking-only response with no text output', async () => {
      const chunks = [
        {
          candidates: [{
            content: {
              parts: [{ text: 'Deep thinking about nothing...', thought: true }],
              role: 'model',
            },
          }],
        },
        {
          candidates: [{
            content: { parts: [{ text: '' }], role: 'model' },
            finishReason: 'STOP',
          }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 0, totalTokenCount: 100 },
        },
      ];

      fetchSpy.mockResolvedValue(new Response(createReadableStream(makeSSEData(chunks)), { status: 200 }));

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        let finalContentBlocks: any[] = [];
        const onChunk = vi.fn(async (_chunk: string, isComplete: boolean, contentBlocks?: any[]) => {
          if (isComplete && contentBlocks) {
            finalContentBlocks = contentBlocks;
          }
        });

        await service.streamCompletion(
          'gemini-3-pro-preview',
          [makeMessage('Think but no answer')],
          undefined,
          { maxTokens: 4096, thinking: { enabled: true, budgetTokens: 4000 } },
          onChunk,
        );

        expect(finalContentBlocks).toHaveLength(1);
        expect(finalContentBlocks[0].type).toBe('thinking');

        // Should warn about thinking without text
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Thinking content received'),
        );
      } finally {
        consoleWarnSpy.mockRestore();
      }
    });

    it('handles usage metadata with missing fields (defensive defaults)', async () => {
      const chunks = [
        {
          candidates: [{
            content: { parts: [{ text: 'Response' }], role: 'model' },
            finishReason: 'STOP',
          }],
          usageMetadata: {
            // Missing promptTokenCount and candidatesTokenCount
            totalTokenCount: 100,
          },
        },
      ];

      fetchSpy.mockResolvedValue(new Response(createReadableStream(makeSSEData(chunks)), { status: 200 }));

      let finalUsage: any;
      const onChunk = vi.fn(async (_chunk: string, isComplete: boolean, _contentBlocks?: any[], usage?: any) => {
        if (isComplete) finalUsage = usage;
      });

      await service.streamCompletion(
        'gemini-2.5-flash',
        [makeMessage('Test')],
        undefined,
        { maxTokens: 1024 },
        onChunk,
      );

      // Should use defaults of 0 via ?? operator
      expect(finalUsage.inputTokens).toBe(0);
      expect(finalUsage.outputTokens).toBe(0);
    });
  });

  // =========================================================================
  // generateContent (non-streaming) characterization tests
  // =========================================================================

  describe('generateContent', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('returns text content from non-streaming response', async () => {
      const responseData = {
        candidates: [{
          content: {
            parts: [{ text: 'Generated text response' }],
            role: 'model',
          },
        }],
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 10,
          totalTokenCount: 60,
        },
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

      const result = await service.generateContent(
        'gemini-2.5-flash',
        [makeMessage('Generate something')],
        'Be creative',
        { maxTokens: 1024 },
      );

      expect(result.content).toBe('Generated text response');
      expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 10 });
      expect(result.contentBlocks.length).toBeGreaterThanOrEqual(1);
      expect(result.contentBlocks[0].type).toBe('text');
    });

    it('handles thinking content in non-streaming response', async () => {
      const responseData = {
        candidates: [{
          content: {
            parts: [
              { text: 'Thinking about this...', thought: true },
              { text: 'The answer is 42' },
            ],
            role: 'model',
          },
        }],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 },
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

      const result = await service.generateContent(
        'gemini-3-pro-preview',
        [makeMessage('Think')],
        undefined,
        { maxTokens: 4096, thinking: { enabled: true, budgetTokens: 2000 } },
      );

      expect(result.content).toBe('The answer is 42');
      const thinkingBlock = result.contentBlocks.find((b: any) => b.type === 'thinking');
      expect(thinkingBlock).toBeDefined();
      expect((thinkingBlock as any).thinking).toBe('Thinking about this...');
    });

    it('handles image generation in non-streaming response', async () => {
      const imgBase64 = Buffer.from('image-data').toString('base64');
      const responseData = {
        candidates: [{
          content: {
            parts: [
              { text: 'Here is the image:' },
              { inlineData: { mimeType: 'image/png', data: imgBase64 } },
            ],
            role: 'model',
          },
        }],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100, totalTokenCount: 150 },
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

      const result = await service.generateContent(
        'gemini-2.5-flash-image',
        [makeMessage('Draw')],
        undefined,
        {
          maxTokens: 1024,
          modelSpecific: { responseModalities: ['TEXT', 'IMAGE'] },
        },
      );

      const imageBlock = result.contentBlocks.find((b: any) => b.type === 'image');
      expect(imageBlock).toBeDefined();
      expect((imageBlock as any).blobId).toBe('mock-blob-id');
    });

    it('builds correct URL for non-streaming endpoint', async () => {
      const responseData = {
        candidates: [{
          content: { parts: [{ text: 'ok' }], role: 'model' },
        }],
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(responseData), { status: 200 }));

      await service.generateContent(
        'gemini-2.5-flash',
        [makeMessage('Test')],
        undefined,
        { maxTokens: 1024 },
      );

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('models/gemini-2.5-flash:generateContent');
      expect(calledUrl).toContain('key=test-gemini-key');
      // Should NOT contain streamGenerateContent
      expect(calledUrl).not.toContain('stream');
    });

    it('throws on HTTP error', async () => {
      fetchSpy.mockResolvedValue(new Response('Forbidden', { status: 403 }));

      await expect(
        service.generateContent(
          'gemini-2.5-flash',
          [makeMessage('Will fail')],
          undefined,
          { maxTokens: 1024 },
        ),
      ).rejects.toThrow('Gemini API error: 403');
    });

    it('includes thinking config for non-streaming request', async () => {
      const responseData = {
        candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' } }],
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(responseData), { status: 200 }));

      await service.generateContent(
        'gemini-3-pro-preview',
        [makeMessage('Test')],
        undefined,
        { maxTokens: 8192, thinking: { enabled: true, budgetTokens: 4000 } },
      );

      const calledBody = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
      expect(calledBody.generationConfig.thinkingConfig).toEqual({
        includeThoughts: true,
        thinkingBudget: 4000,
      });
    });

    it('includes Google Search tool in non-streaming request', async () => {
      const responseData = {
        candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' } }],
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(responseData), { status: 200 }));

      await service.generateContent(
        'gemini-2.5-flash',
        [makeMessage('Search')],
        undefined,
        { maxTokens: 1024, modelSpecific: { 'tools.googleSearch': true } },
      );

      const calledBody = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
      expect(calledBody.tools).toEqual([{ googleSearch: {} }]);
    });

    it('returns undefined usage when usageMetadata is missing', async () => {
      const responseData = {
        candidates: [{ content: { parts: [{ text: 'no usage' }], role: 'model' } }],
        // No usageMetadata
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(responseData), { status: 200 }));

      const result = await service.generateContent(
        'gemini-2.5-flash',
        [makeMessage('Test')],
        undefined,
        { maxTokens: 1024 },
      );

      expect(result.usage).toBeUndefined();
    });
  });
});
