import { describe, it, expect } from 'vitest';
import {
  RawMessageSchema,
  ParsedMessageSchema,
  ImportFormatSchema,
  ParticipantMappingSchema,
  ImportPreviewSchema,
  ImportRequestSchema,
} from './import-types.js';

// ============================================================================
// RawMessageSchema
// ============================================================================

describe('RawMessageSchema', () => {
  it('accepts a message with string content', () => {
    const result = RawMessageSchema.safeParse({
      role: 'user',
      content: 'Hello world',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a message with array-of-string content', () => {
    const result = RawMessageSchema.safeParse({
      role: 'assistant',
      content: ['Part 1', 'Part 2'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a message with array-of-object content', () => {
    const result = RawMessageSchema.safeParse({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts content objects with value instead of text', () => {
    const result = RawMessageSchema.safeParse({
      role: 'user',
      content: [{ value: 'Some content' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts all optional fields', () => {
    const result = RawMessageSchema.safeParse({
      role: 'user',
      content: 'Hello',
      name: 'Alice',
      timestamp: '2025-01-15T10:00:00Z',
      model: 'claude-3-opus',
      images: [{ url: 'https://example.com/img.png', mimeType: 'image/png' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts timestamp as Date', () => {
    const result = RawMessageSchema.safeParse({
      role: 'user',
      content: 'Hello',
      timestamp: new Date('2025-01-15'),
    });
    expect(result.success).toBe(true);
  });

  it('accepts images with base64 data', () => {
    const result = RawMessageSchema.safeParse({
      role: 'user',
      content: 'See image',
      images: [{ base64: 'aGVsbG8=', mimeType: 'image/jpeg' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing role', () => {
    const result = RawMessageSchema.safeParse({ content: 'Hello' });
    expect(result.success).toBe(false);
  });

  it('accepts missing content due to z.any() fallback', () => {
    // The schema uses z.union([z.string(), z.array(...), z.any()]) for content,
    // so undefined is accepted by the z.any() branch
    const result = RawMessageSchema.safeParse({ role: 'user' });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// ParsedMessageSchema
// ============================================================================

describe('ParsedMessageSchema', () => {
  it('accepts a valid parsed message', () => {
    const result = ParsedMessageSchema.safeParse({
      role: 'user',
      content: 'Hello',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a parsed message with all optional fields', () => {
    const result = ParsedMessageSchema.safeParse({
      role: 'assistant',
      content: 'Hi there',
      participantName: 'Claude',
      timestamp: new Date('2025-01-15'),
      model: 'claude-3-opus',
      images: [{ url: 'https://example.com/img.png' }],
      metadata: { source: 'import' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid role', () => {
    const result = ParsedMessageSchema.safeParse({
      role: 'bot',
      content: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  it('accepts system role', () => {
    const result = ParsedMessageSchema.safeParse({
      role: 'system',
      content: 'You are a helpful assistant.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing content', () => {
    const result = ParsedMessageSchema.safeParse({ role: 'user' });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ImportFormatSchema
// ============================================================================

describe('ImportFormatSchema', () => {
  const validFormats = [
    'basic_json',
    'anthropic',
    'chrome_extension',
    'arc_chat',
    'openai',
    'cursor',
    'cursor_json',
    'colon_single',
    'colon_double',
  ] as const;

  it.each(validFormats)('accepts "%s"', (format) => {
    expect(ImportFormatSchema.parse(format)).toBe(format);
  });

  it('rejects unknown format', () => {
    expect(ImportFormatSchema.safeParse('chatgpt').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(ImportFormatSchema.safeParse('').success).toBe(false);
  });
});

// ============================================================================
// ParticipantMappingSchema
// ============================================================================

describe('ParticipantMappingSchema', () => {
  it('accepts a valid user mapping', () => {
    const result = ParticipantMappingSchema.safeParse({
      sourceName: 'Human',
      targetName: 'Alice',
      type: 'user',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid assistant mapping', () => {
    const result = ParticipantMappingSchema.safeParse({
      sourceName: 'Claude',
      targetName: 'Claude Opus',
      type: 'assistant',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = ParticipantMappingSchema.safeParse({
      sourceName: 'Test',
      targetName: 'Test',
      type: 'system',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing sourceName', () => {
    const result = ParticipantMappingSchema.safeParse({
      targetName: 'Test',
      type: 'user',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ImportPreviewSchema
// ============================================================================

describe('ImportPreviewSchema', () => {
  it('accepts a valid import preview', () => {
    const result = ImportPreviewSchema.safeParse({
      format: 'basic_json',
      messages: [{ role: 'user', content: 'Hello' }],
      detectedParticipants: [
        { name: 'User', role: 'user', messageCount: 5 },
        { name: 'Claude', role: 'assistant', messageCount: 5 },
      ],
      suggestedFormat: 'standard',
    });
    expect(result.success).toBe(true);
  });

  it('accepts preview with optional fields', () => {
    const result = ImportPreviewSchema.safeParse({
      format: 'arc_chat',
      messages: [],
      detectedParticipants: [],
      suggestedFormat: 'prefill',
      title: 'Imported Chat',
      metadata: { version: 2 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts unknown participant role', () => {
    const result = ImportPreviewSchema.safeParse({
      format: 'basic_json',
      messages: [],
      detectedParticipants: [{ name: 'Mystery', role: 'unknown', messageCount: 1 }],
      suggestedFormat: 'standard',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid format', () => {
    const result = ImportPreviewSchema.safeParse({
      format: 'invalid',
      messages: [],
      detectedParticipants: [],
      suggestedFormat: 'standard',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid suggestedFormat', () => {
    const result = ImportPreviewSchema.safeParse({
      format: 'basic_json',
      messages: [],
      detectedParticipants: [],
      suggestedFormat: 'markdown',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ImportRequestSchema
// ============================================================================

describe('ImportRequestSchema', () => {
  it('accepts a minimal import request', () => {
    const result = ImportRequestSchema.safeParse({
      format: 'basic_json',
      content: '{"messages": []}',
      conversationFormat: 'standard',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a fully populated request', () => {
    const result = ImportRequestSchema.safeParse({
      format: 'anthropic',
      content: 'raw conversation text',
      participantMappings: [
        { sourceName: 'Human', targetName: 'User', type: 'user' },
      ],
      conversationFormat: 'prefill',
      title: 'My Import',
      model: 'claude-3-opus',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid format', () => {
    const result = ImportRequestSchema.safeParse({
      format: 'unknown_format',
      content: 'data',
      conversationFormat: 'standard',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid conversationFormat', () => {
    const result = ImportRequestSchema.safeParse({
      format: 'basic_json',
      content: 'data',
      conversationFormat: 'xml',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing content', () => {
    const result = ImportRequestSchema.safeParse({
      format: 'basic_json',
      conversationFormat: 'standard',
    });
    expect(result.success).toBe(false);
  });
});
