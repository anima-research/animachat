import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { Message } from '@deprecated-claude/shared';

// Mock sharp (image processing)
vi.mock('sharp', () => {
  const mockSharp = vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 2000, height: 1600 }),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized-bedrock-image')),
  }));
  return { default: mockSharp };
});

// Mock AWS Bedrock SDK
vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  class MockBedrockRuntimeClient {
    send = vi.fn();
    constructor(_opts?: any) {}
  }
  return {
    BedrockRuntimeClient: MockBedrockRuntimeClient,
    InvokeModelWithResponseStreamCommand: class { constructor(_opts?: any) {} },
  };
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

import { BedrockService } from './bedrock.js';
import { Database } from '../database/index.js';

// Helper: create a Message with a single active branch
function makeMessage(
  content: string,
  role: 'user' | 'assistant' | 'system' = 'user',
  opts?: {
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
  if (opts?.attachments) branch.attachments = opts.attachments;

  return {
    id: randomUUID(),
    conversationId: randomUUID(),
    order: 0,
    activeBranchId: branchId,
    branches: [branch],
  };
}

describe('BedrockService', () => {
  let service: BedrockService;

  beforeEach(() => {
    const mockDb = new Database() as any;
    service = new BedrockService(mockDb, {
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-west-2',
    });
  });

  describe('constructor', () => {
    it('creates service with explicit credentials', () => {
      const mockDb = new Database() as any;
      const svc = new BedrockService(mockDb, {
        accessKeyId: 'AKIA...',
        secretAccessKey: 'secret',
        region: 'eu-west-1',
      });
      expect(svc).toBeDefined();
    });

    it('creates service with session token', () => {
      const mockDb = new Database() as any;
      const svc = new BedrockService(mockDb, {
        accessKeyId: 'AKIA...',
        secretAccessKey: 'secret',
        region: 'us-east-1',
        sessionToken: 'session-token-123',
      });
      expect(svc).toBeDefined();
    });

    it('creates service without credentials (falls back to env vars)', () => {
      const mockDb = new Database() as any;
      const svc = new BedrockService(mockDb);
      expect(svc).toBeDefined();
    });
  });

  describe('formatMessagesForClaude', () => {
    it('formats a simple user message as a string', async () => {
      const messages = [makeMessage('Hello Bedrock')];
      const result = await service.formatMessagesForClaude(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Hello Bedrock');
    });

    it('formats a simple assistant message as a string', async () => {
      const messages = [makeMessage('Hi from Claude!', 'assistant')];
      const result = await service.formatMessagesForClaude(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('Hi from Claude!');
    });

    it('skips system role messages', async () => {
      const messages = [
        makeMessage('System prompt here', 'system'),
        makeMessage('User question', 'user'),
      ];
      const result = await service.formatMessagesForClaude(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('User question');
    });

    it('preserves multi-turn conversation ordering', async () => {
      const messages = [
        makeMessage('Q1', 'user'),
        makeMessage('A1', 'assistant'),
        makeMessage('Q2', 'user'),
        makeMessage('A2', 'assistant'),
      ];
      const result = await service.formatMessagesForClaude(messages);

      expect(result).toHaveLength(4);
      expect(result.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
      expect(result.map(m => m.content)).toEqual(['Q1', 'A1', 'Q2', 'A2']);
    });

    it('uses the active branch content from multi-branch messages', async () => {
      const activeBranchId = randomUUID();
      const message: Message = {
        id: randomUUID(),
        conversationId: randomUUID(),
        order: 0,
        activeBranchId,
        branches: [
          {
            id: randomUUID(),
            content: 'Old branch',
            role: 'user',
            createdAt: new Date(),
          },
          {
            id: activeBranchId,
            content: 'Current branch',
            role: 'user',
            createdAt: new Date(),
          },
        ],
      };
      const result = await service.formatMessagesForClaude([message]);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Current branch');
    });

    // --- Attachments ---

    it('formats image attachment as content blocks', async () => {
      const imgBase64 = Buffer.from('small-img').toString('base64');
      const messages = [
        makeMessage('Look at this', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'pic.png',
              fileSize: 100,
              fileType: 'png',
              content: imgBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForClaude(messages);

      expect(result).toHaveLength(1);
      expect(Array.isArray(result[0].content)).toBe(true);

      const parts = result[0].content as any[];
      expect(parts).toHaveLength(2);
      expect(parts[0]).toEqual({ type: 'text', text: 'Look at this' });
      expect(parts[1].type).toBe('image');
      expect(parts[1].source.type).toBe('base64');
      expect(parts[1].source.media_type).toBe('image/png');
      expect(parts[1].source.data).toBe(imgBase64);
    });

    it('formats PDF attachment as document block', async () => {
      const pdfBase64 = Buffer.from('pdf-data').toString('base64');
      const messages = [
        makeMessage('Read this', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'report.pdf',
              fileSize: 300,
              fileType: 'pdf',
              content: pdfBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForClaude(messages);

      const parts = result[0].content as any[];
      expect(parts).toHaveLength(2);
      expect(parts[1].type).toBe('document');
      expect(parts[1].source.media_type).toBe('application/pdf');
    });

    it('appends text attachments inline to the text content', async () => {
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
      const result = await service.formatMessagesForClaude(messages);

      const parts = result[0].content as any[];
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('text');
      expect(parts[0].text).toContain('Review this');
      expect(parts[0].text).toContain('<attachment filename="code.py">');
      expect(parts[0].text).toContain('print("hello")');
    });

    it('resizes oversized images and changes media type to jpeg', async () => {
      const largeBase64 = 'B'.repeat(6_000_000); // > 4MB decoded
      const messages = [
        makeMessage('Big pic', 'user', {
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
      const result = await service.formatMessagesForClaude(messages);

      const parts = result[0].content as any[];
      const imgPart = parts.find((p: any) => p.type === 'image');
      expect(imgPart.source.data).not.toBe(largeBase64);
      expect(imgPart.source.media_type).toBe('image/jpeg');
    });

    it('does not resize images under 4MB', async () => {
      const smallBase64 = Buffer.from('tiny').toString('base64');
      const messages = [
        makeMessage('Small pic', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'small.webp',
              fileSize: 100,
              fileType: 'webp',
              content: smallBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForClaude(messages);

      const parts = result[0].content as any[];
      const imgPart = parts.find((p: any) => p.type === 'image');
      expect(imgPart.source.data).toBe(smallBase64);
      expect(imgPart.source.media_type).toBe('image/webp');
    });

    it('returns original image when sharp cannot get dimensions', async () => {
      const sharp = (await import('sharp')).default as any;
      sharp.mockImplementationOnce(() => ({
        metadata: vi.fn().mockResolvedValue({ width: undefined, height: undefined }),
        resize: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('should not reach')),
      }));

      const largeBase64 = 'E'.repeat(6_000_000);
      const messages = [
        makeMessage('No dims', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'nodims.png',
              fileSize: 5_000_000,
              fileType: 'png',
              content: largeBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForClaude(messages);

      const parts = result[0].content as any[];
      const imgPart = parts.find((p: any) => p.type === 'image');
      expect(imgPart.source.data).toBe(largeBase64);
    });

    it('returns original image when sharp throws during resize', async () => {
      const sharp = (await import('sharp')).default as any;
      sharp.mockImplementationOnce(() => ({
        metadata: vi.fn().mockRejectedValue(new Error('corrupt')),
      }));

      const largeBase64 = 'F'.repeat(6_000_000);
      const messages = [
        makeMessage('Corrupt', 'user', {
          attachments: [
            {
              id: randomUUID(),
              fileName: 'bad.png',
              fileSize: 5_000_000,
              fileType: 'png',
              content: largeBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForClaude(messages);

      const parts = result[0].content as any[];
      const imgPart = parts.find((p: any) => p.type === 'image');
      expect(imgPart.source.data).toBe(largeBase64);
    });

    // --- Edge cases ---

    it('returns empty array for empty messages', async () => {
      const result = await service.formatMessagesForClaude([]);
      expect(result).toEqual([]);
    });

    it('handles message with no active branch', async () => {
      const message: Message = {
        id: randomUUID(),
        conversationId: randomUUID(),
        order: 0,
        activeBranchId: 'does-not-exist',
        branches: [
          {
            id: randomUUID(),
            content: 'Ghost branch',
            role: 'user',
            createdAt: new Date(),
          },
        ],
      };
      const result = await service.formatMessagesForClaude([message]);
      expect(result).toEqual([]);
    });

    it('handles multiple mixed attachments', async () => {
      const imgBase64 = Buffer.from('img').toString('base64');
      const pdfBase64 = Buffer.from('pdf').toString('base64');
      const messages = [
        makeMessage('Multiple files', 'user', {
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
              fileName: 'doc.pdf',
              fileSize: 200,
              fileType: 'pdf',
              content: pdfBase64,
              encoding: 'base64',
              createdAt: new Date(),
            },
            {
              id: randomUUID(),
              fileName: 'notes.txt',
              fileSize: 20,
              fileType: 'txt',
              content: 'My notes',
              encoding: 'text',
              createdAt: new Date(),
            },
          ],
        }),
      ];
      const result = await service.formatMessagesForClaude(messages);

      const parts = result[0].content as any[];
      // 1 text (with notes appended) + 1 image + 1 document
      expect(parts).toHaveLength(3);
      expect(parts[0].type).toBe('text');
      expect(parts[0].text).toContain('My notes');
      expect(parts[1].type).toBe('image');
      expect(parts[2].type).toBe('document');
    });
  });

  describe('buildRequestBody (private)', () => {
    it('builds Claude 3 Messages API format for claude-3 models', () => {
      const svc = service as any;
      const messages = [{ role: 'user', content: 'Hello' }];
      const settings = { temperature: 0.7, maxTokens: 1024 };

      const body = svc.buildRequestBody(
        'anthropic.claude-3-opus-20240229-v1:0',
        messages,
        'Be helpful',
        settings,
        undefined
      );

      expect(body.anthropic_version).toBe('bedrock-2023-05-31');
      expect(body.messages).toEqual(messages);
      expect(body.system).toBe('Be helpful');
      expect(body.max_tokens).toBe(1024);
      expect(body.temperature).toBe(0.7);
    });

    it('builds Claude 2 legacy prompt format for non-claude-3 models', () => {
      const svc = service as any;
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
      ];
      const settings = { temperature: 0.5, maxTokens: 512 };

      const body = svc.buildRequestBody(
        'anthropic.claude-v2:1',
        messages,
        'Be helpful',
        settings,
        undefined
      );

      expect(body.prompt).toBeDefined();
      expect(body.prompt).toContain('System: Be helpful');
      expect(body.prompt).toContain('Human: Hello');
      expect(body.prompt).toContain('Assistant: Hi there');
      expect(body.prompt).toContain('Human: How are you?');
      expect(body.prompt).toMatch(/\n\nAssistant:$/);
      expect(body.max_tokens_to_sample).toBe(512);
      expect(body.temperature).toBe(0.5);
      // Should NOT have Messages API fields
      expect(body.anthropic_version).toBeUndefined();
      expect(body.messages).toBeUndefined();
    });

    it('omits system prompt when not provided (Claude 3)', () => {
      const svc = service as any;
      const body = svc.buildRequestBody(
        'anthropic.claude-3-sonnet-20240229-v1:0',
        [{ role: 'user', content: 'Hi' }],
        undefined,
        { temperature: 1, maxTokens: 100 },
        undefined
      );

      expect(body.system).toBeUndefined();
    });

    it('omits system prompt from prompt string when not provided (Claude 2)', () => {
      const svc = service as any;
      const body = svc.buildRequestBody(
        'anthropic.claude-v2',
        [{ role: 'user', content: 'Hi' }],
        undefined,
        { temperature: 1, maxTokens: 100 },
        undefined
      );

      expect(body.prompt).not.toContain('System:');
      expect(body.prompt).toContain('Human: Hi');
    });

    it('includes stop_sequences when provided (Claude 3)', () => {
      const svc = service as any;
      const body = svc.buildRequestBody(
        'anthropic.claude-3-haiku-20240307-v1:0',
        [{ role: 'user', content: 'Hi' }],
        undefined,
        { temperature: 1, maxTokens: 100 },
        ['STOP', 'END']
      );

      expect(body.stop_sequences).toEqual(['STOP', 'END']);
    });

    it('includes stop_sequences when provided (Claude 2)', () => {
      const svc = service as any;
      const body = svc.buildRequestBody(
        'anthropic.claude-instant-v1',
        [{ role: 'user', content: 'Hi' }],
        undefined,
        { temperature: 1, maxTokens: 100 },
        ['STOP']
      );

      expect(body.stop_sequences).toEqual(['STOP']);
    });

    it('does not include stop_sequences when array is empty', () => {
      const svc = service as any;
      const body = svc.buildRequestBody(
        'anthropic.claude-3-opus-20240229-v1:0',
        [{ role: 'user', content: 'Hi' }],
        undefined,
        { temperature: 1, maxTokens: 100 },
        []
      );

      expect(body.stop_sequences).toBeUndefined();
    });

    it('does not send top_p/top_k when temperature is set (Claude 3)', () => {
      const svc = service as any;
      const body = svc.buildRequestBody(
        'anthropic.claude-3-sonnet-20240229-v1:0',
        [{ role: 'user', content: 'Hi' }],
        undefined,
        { temperature: 0.5, maxTokens: 100, topP: 0.9, topK: 50 },
        undefined
      );

      // When temperature is set, top_p and top_k should NOT be sent
      expect(body.temperature).toBe(0.5);
      expect(body.top_p).toBeUndefined();
      expect(body.top_k).toBeUndefined();
    });

    it('sends top_p and top_k when temperature is undefined (Claude 3)', () => {
      const svc = service as any;
      const body = svc.buildRequestBody(
        'anthropic.claude-3-sonnet-20240229-v1:0',
        [{ role: 'user', content: 'Hi' }],
        undefined,
        { temperature: undefined as any, maxTokens: 100, topP: 0.9, topK: 50 },
        undefined
      );

      expect(body.top_p).toBe(0.9);
      expect(body.top_k).toBe(50);
    });

    it('does not send top_p/top_k when temperature is set (Claude 2)', () => {
      const svc = service as any;
      const body = svc.buildRequestBody(
        'anthropic.claude-v2',
        [{ role: 'user', content: 'Hi' }],
        undefined,
        { temperature: 0.8, maxTokens: 200, topP: 0.95, topK: 40 },
        undefined
      );

      expect(body.temperature).toBe(0.8);
      expect(body.top_p).toBeUndefined();
      expect(body.top_k).toBeUndefined();
    });

    it('converts non-string non-array content to string for Claude 2 format', () => {
      const svc = service as any;
      const messages = [
        { role: 'user', content: 12345 as any }, // numeric content
      ];
      const body = svc.buildRequestBody(
        'anthropic.claude-v2',
        messages,
        undefined,
        { temperature: 1, maxTokens: 100 },
        undefined
      );

      expect(body.prompt).toContain('Human: 12345');
    });

    it('extracts only text from content blocks for Claude 2 format', () => {
      const svc = service as any;
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'image', source: { type: 'base64', data: 'imgdata' } },
            { type: 'text', text: 'More text' },
          ],
        },
      ];
      const body = svc.buildRequestBody(
        'anthropic.claude-v2',
        messages,
        undefined,
        { temperature: 1, maxTokens: 100 },
        undefined
      );

      // Claude 2 should only get text content
      expect(body.prompt).toContain('Hello');
      expect(body.prompt).toContain('More text');
      expect(body.prompt).not.toContain('imgdata');
    });
  });

  describe('extractContentFromChunk (private)', () => {
    it('extracts text from Claude 3 content_block_delta', () => {
      const svc = service as any;
      const result = svc.extractContentFromChunk(
        'anthropic.claude-3-opus-20240229-v1:0',
        { type: 'content_block_delta', delta: { text: 'Hello world' } }
      );
      expect(result).toBe('Hello world');
    });

    it('returns null for Claude 3 non-delta chunks', () => {
      const svc = service as any;
      const result = svc.extractContentFromChunk(
        'anthropic.claude-3-opus-20240229-v1:0',
        { type: 'message_start' }
      );
      expect(result).toBeNull();
    });

    it('extracts completion text from Claude 2 chunks', () => {
      const svc = service as any;
      const result = svc.extractContentFromChunk(
        'anthropic.claude-v2',
        { completion: 'Some text' }
      );
      expect(result).toBe('Some text');
    });

    it('returns null for Claude 2 chunks without completion', () => {
      const svc = service as any;
      const result = svc.extractContentFromChunk(
        'anthropic.claude-v2',
        { stop_reason: 'end_turn' }
      );
      expect(result).toBeNull();
    });
  });

  describe('isStreamComplete (private)', () => {
    it('detects message_stop for Claude 3 models', () => {
      const svc = service as any;
      expect(
        svc.isStreamComplete('anthropic.claude-3-opus-20240229-v1:0', {
          type: 'message_stop',
        })
      ).toBe(true);
    });

    it('returns false for non-stop Claude 3 events', () => {
      const svc = service as any;
      expect(
        svc.isStreamComplete('anthropic.claude-3-opus-20240229-v1:0', {
          type: 'content_block_delta',
        })
      ).toBe(false);
    });

    it('detects non-null stop_reason for Claude 2 models', () => {
      const svc = service as any;
      expect(
        svc.isStreamComplete('anthropic.claude-v2', {
          stop_reason: 'stop_sequence',
        })
      ).toBe(true);
    });

    it('returns false for null stop_reason in Claude 2', () => {
      const svc = service as any;
      expect(
        svc.isStreamComplete('anthropic.claude-v2', {
          stop_reason: null,
        })
      ).toBe(false);
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

    it('does NOT recognize gif as image', () => {
      const svc = service as any;
      expect(svc.isImageAttachment('animation.gif')).toBe(false);
    });

    it('returns false for non-image files', () => {
      const svc = service as any;
      expect(svc.isImageAttachment('doc.pdf')).toBe(false);
      expect(svc.isImageAttachment('file.ts')).toBe(false);
    });
  });

  describe('isPdfAttachment (private)', () => {
    it('recognizes pdf files', () => {
      const svc = service as any;
      expect(svc.isPdfAttachment('doc.pdf')).toBe(true);
      expect(svc.isPdfAttachment('DOC.PDF')).toBe(true);
    });

    it('rejects non-pdf files', () => {
      const svc = service as any;
      expect(svc.isPdfAttachment('image.png')).toBe(false);
    });
  });

  describe('getMediaType (private)', () => {
    it('uses provided mimeType when available', () => {
      const svc = service as any;
      expect(svc.getMediaType('file.xyz', 'custom/type')).toBe('custom/type');
    });

    it('maps known extensions to correct MIME types', () => {
      const svc = service as any;
      expect(svc.getMediaType('photo.jpg')).toBe('image/jpeg');
      expect(svc.getMediaType('photo.jpeg')).toBe('image/jpeg');
      expect(svc.getMediaType('photo.png')).toBe('image/png');
      expect(svc.getMediaType('photo.gif')).toBe('image/gif');
      expect(svc.getMediaType('photo.webp')).toBe('image/webp');
      expect(svc.getMediaType('doc.pdf')).toBe('application/pdf');
    });

    it('falls back to application/octet-stream for unknown extensions', () => {
      const svc = service as any;
      expect(svc.getMediaType('data.xyz')).toBe('application/octet-stream');
    });
  });

  describe('validateApiKey', () => {
    it('returns true for bedrock provider', async () => {
      const result = await service.validateApiKey('bedrock', 'some-key');
      expect(result).toBe(true);
    });

    it('returns false for anthropic provider (not implemented)', async () => {
      const result = await service.validateApiKey('anthropic', 'some-key');
      expect(result).toBe(false);
    });

    it('returns false for unknown provider', async () => {
      const result = await service.validateApiKey('unknown', 'some-key');
      expect(result).toBe(false);
    });
  });
});
