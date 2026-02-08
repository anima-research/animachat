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
});
