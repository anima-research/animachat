import { z } from 'zod';

// Raw message formats that we'll parse from various sources
export const RawMessageSchema = z.object({
  role: z.string(),
  content: z.union([
    z.string(),
    z.array(z.union([
      z.string(),
      z.object({
        type: z.string().optional(),
        text: z.string().optional(),
        value: z.string().optional() // Some formats use 'value' instead of 'text'
      })
    ])),
    z.any() // Fallback for unexpected formats
  ]),
  name: z.string().optional(), // For multi-participant formats
  timestamp: z.union([z.string(), z.date()]).optional(),
  model: z.string().optional(),
  images: z.array(z.object({
    url: z.string().optional(),
    base64: z.string().optional(),
    mimeType: z.string().optional()
  })).optional()
});

export type RawMessage = z.infer<typeof RawMessageSchema>;

// Parsed format that we'll show in preview
export const ParsedMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  participantName: z.string().optional(),
  timestamp: z.date().optional(),
  model: z.string().optional(),
  images: z.array(z.object({
    url: z.string().optional(),
    base64: z.string().optional(),
    mimeType: z.string().optional()
  })).optional(),
  metadata: z.record(z.any()).optional() // Additional metadata for format-specific data
});

export type ParsedMessage = z.infer<typeof ParsedMessageSchema>;

// Import format types
export const ImportFormatSchema = z.enum([
  'basic_json',
  'anthropic',
  'chrome_extension',
  'arc_chat',
  'openai',
  'cursor',
  'cursor_json',
  'colon_single',
  'colon_double'
]);

export type ImportFormat = z.infer<typeof ImportFormatSchema>;

// Participant mapping
export const ParticipantMappingSchema = z.object({
  sourceName: z.string(), // Name from the import
  targetName: z.string(), // Name in our system
  type: z.enum(['user', 'assistant'])
});

export type ParticipantMapping = z.infer<typeof ParticipantMappingSchema>;

// Import preview data
export const ImportPreviewSchema = z.object({
  format: ImportFormatSchema,
  messages: z.array(ParsedMessageSchema),
  detectedParticipants: z.array(z.object({
    name: z.string(),
    role: z.enum(['user', 'assistant', 'unknown']),
    messageCount: z.number()
  })),
  suggestedFormat: z.enum(['standard', 'prefill']),
  title: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

export type ImportPreview = z.infer<typeof ImportPreviewSchema>;

// Import request
export const ImportRequestSchema = z.object({
  format: ImportFormatSchema,
  content: z.string(), // Raw content to parse
  participantMappings: z.array(ParticipantMappingSchema).optional(),
  conversationFormat: z.enum(['standard', 'prefill']),
  title: z.string().optional(),
  model: z.string().optional() // Optional for group chats - derived from first assistant participant
});

export type ImportRequest = z.infer<typeof ImportRequestSchema>;
