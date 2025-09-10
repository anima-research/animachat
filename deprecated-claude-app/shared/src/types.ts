import { z } from 'zod';

// User types
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.date(),
  apiKeys: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    provider: z.enum(['bedrock', 'anthropic', 'openrouter', 'openai-compatible']),
    masked: z.string(),
    createdAt: z.date()
  })).optional()
});

export type User = z.infer<typeof UserSchema>;

// Model types
export const ModelSchema = z.object({
  id: z.string(), // Unique identifier for this model configuration
  providerModelId: z.string(), // The actual model ID to send to the provider API
  displayName: z.string(), // User-facing display name
  shortName: z.string(), // Short name for participant display
  provider: z.enum(['bedrock', 'anthropic', 'openrouter', 'openai-compatible']),
  deprecated: z.boolean(),
  contextWindow: z.number(),
  outputTokenLimit: z.number(),
  settings: z.object({
    temperature: z.object({
      min: z.number(),
      max: z.number(),
      default: z.number(),
      step: z.number()
    }),
    maxTokens: z.object({
      min: z.number(),
      max: z.number(),
      default: z.number()
    }),
    topP: z.object({
      min: z.number(),
      max: z.number(),
      default: z.number(),
      step: z.number()
    }).optional(),
    topK: z.object({
      min: z.number(),
      max: z.number(),
      default: z.number(),
      step: z.number()
    }).optional()
  })
});

export type Model = z.infer<typeof ModelSchema>;

// Model settings schema
export const ModelSettingsSchema = z.object({
  temperature: z.number(),
  maxTokens: z.number(),
  topP: z.number().optional(),
  topK: z.number().optional()
});

export type ModelSettings = z.infer<typeof ModelSettingsSchema>;

// Context management settings
export const ContextManagementSchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('append'),
    cacheInterval: z.number().default(10000) // Move cache marker every 10k tokens
  }),
  z.object({
    strategy: z.literal('rolling'),
    maxTokens: z.number(),
    maxGraceTokens: z.number(),
    cacheMinTokens: z.number().default(5000), // Min tokens before setting cache marker
    cacheDepthFromEnd: z.number().default(5) // Messages from end where cache marker is placed
  })
]);

export type ContextManagement = z.infer<typeof ContextManagementSchema>;

export const DEFAULT_CONTEXT_MANAGEMENT: ContextManagement = {
  strategy: 'append',
  cacheInterval: 10000
};

// Participant types
export const ParticipantSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  name: z.string(),
  type: z.enum(['user', 'assistant']),
  model: z.string().optional(), // Only for assistant participants
  systemPrompt: z.string().optional(), // Only for assistant participants
  settings: ModelSettingsSchema.optional(), // Only for assistant participants
  contextManagement: ContextManagementSchema.optional(), // Only for assistant participants
  isActive: z.boolean().default(true)
});

export type Participant = z.infer<typeof ParticipantSchema>;

// Attachment types
export const AttachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  fileSize: z.number(),
  fileType: z.string(),
  content: z.string(), // Base64 or text content
  createdAt: z.date()
});

export type Attachment = z.infer<typeof AttachmentSchema>;

// Message types
export const MessageBranchSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  participantId: z.string().uuid().optional(), // Link to participant
  createdAt: z.date(),
  model: z.string().optional(),
  parentBranchId: z.string().uuid().optional(),
  isActive: z.boolean().optional(), // Deprecated - not used, kept for backward compatibility
  attachments: z.array(AttachmentSchema).optional() // Attachments for this branch
});

export type MessageBranch = z.infer<typeof MessageBranchSchema>;

export const MessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  branches: z.array(MessageBranchSchema),
  activeBranchId: z.string().uuid(),
  order: z.number()
});

export type Message = z.infer<typeof MessageSchema>;

// Conversation format types
export const ConversationFormatSchema = z.enum(['standard', 'prefill']);
export type ConversationFormat = z.infer<typeof ConversationFormatSchema>;

// Conversation types
export const ConversationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string(),
  model: z.string(),
  systemPrompt: z.string().optional(),
  format: ConversationFormatSchema.default('standard'),
  createdAt: z.date(),
  updatedAt: z.date(),
  archived: z.boolean().default(false),
  settings: ModelSettingsSchema,
  contextManagement: ContextManagementSchema.optional() // Conversation-level default
});

export type Conversation = z.infer<typeof ConversationSchema>;

// WebSocket message types
export const WsMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat'),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    content: z.string(),
    parentBranchId: z.string().uuid().optional(),
    participantId: z.string().uuid().optional(),
    responderId: z.string().uuid().optional(), // Which assistant should respond (if any)
    attachments: z.array(z.object({
      fileName: z.string(),
      fileType: z.string(),
      content: z.string()
    })).optional()
  }),
  z.object({
    type: z.literal('regenerate'),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    branchId: z.string().uuid()
  }),
  z.object({
    type: z.literal('edit'),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    branchId: z.string().uuid(),
    content: z.string(),
    responderId: z.string().uuid().optional() // Which assistant should respond after edit
  }),
  z.object({
    type: z.literal('delete'),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    branchId: z.string().uuid()
  }),
  z.object({
    type: z.literal('continue'),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    parentBranchId: z.string().uuid().optional(),
    responderId: z.string().uuid().optional() // Which assistant should respond
  }),
  z.object({
    type: z.literal('stream'),
    messageId: z.string().uuid(),
    branchId: z.string().uuid(),
    content: z.string(),
    isComplete: z.boolean()
  }),
  z.object({
    type: z.literal('error'),
    error: z.string()
  })
]);

export type WsMessage = z.infer<typeof WsMessageSchema>;

// API Request/Response types
export const CreateConversationRequestSchema = z.object({
  title: z.string().optional(),
  model: z.string(),
  format: ConversationFormatSchema.optional(),
  systemPrompt: z.string().optional(),
  settings: ModelSettingsSchema.optional(),
  contextManagement: ContextManagementSchema.optional()
});

export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>;

export const ImportConversationRequestSchema = z.object({
  title: z.string(),
  model: z.string(),
  systemPrompt: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    branches: z.array(z.object({
      content: z.string(),
      createdAt: z.date().optional()
    })).optional()
  })),
  metadata: z.record(z.unknown()).optional()
});

export type ImportConversationRequest = z.infer<typeof ImportConversationRequestSchema>;

// Conversation metrics types
const LastCompletionMetricsSchema = z.object({
  timestamp:     z.string(),
  model:         z.string(),
  inputTokens:   z.number(),
  outputTokens:  z.number(),
  cachedTokens:  z.number(),
  cost:          z.number(),
  cacheSavings:  z.number(),
  responseTime:  z.number()
});

export type LastCompletionMetrics = z.infer<typeof LastCompletionMetricsSchema>;

export const TotalsMetricsSchema = z.object({
  inputTokens:     z.number().default(0),
  outputTokens:    z.number().default(0),
  cachedTokens:    z.number().default(0),
  totalCost:       z.number().default(0),
  totalSavings:    z.number().default(0),
  completionCount: z.number().default(0)
});

export type TotalsMetrics = z.infer<typeof TotalsMetricsSchema>;

export const ModelConversationMetricsSchema = z.object({
  participant: ParticipantSchema,
  lastCompletion: LastCompletionMetricsSchema.optional(),
  totals: TotalsMetricsSchema.default({}),
  contextManagement: ContextManagementSchema.optional()
});

export type ModelConversationMetrics = z.infer<typeof ModelConversationMetricsSchema>;

export const ConversationMetricsSchema = z.object({
  conversationId:   z.string(),
  messageCount:    z.number().default(0),
  perModelMetrics: z.record(z.string(), ModelConversationMetricsSchema).default({}),
  lastCompletion: LastCompletionMetricsSchema.optional(),
  totals: TotalsMetricsSchema.default({}),
  contextManagement: ContextManagementSchema.optional()
});

export type ConversationMetrics = z.infer<typeof ConversationMetricsSchema>;