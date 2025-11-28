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
  supportsThinking: z.boolean().optional(), // Whether the model supports extended thinking
  currencies: z.record(z.boolean()).optional(),
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
  topK: z.number().optional(),
  thinking: z.object({
    enabled: z.boolean(),
    budgetTokens: z.number().min(1024)
  }).optional()
});

export type ModelSettings = z.infer<typeof ModelSettingsSchema>;

// User-defined model types
export const UserDefinedModelSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string().min(1).max(100),
  shortName: z.string().min(1).max(50),
  provider: z.enum(['openrouter', 'openai-compatible']),
  providerModelId: z.string().min(1).max(500),
  contextWindow: z.number().min(1000).max(10000000),
  outputTokenLimit: z.number().min(100).max(1000000),
  supportsThinking: z.boolean().default(false),
  deprecated: z.boolean().default(false),
  settings: ModelSettingsSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  // Custom endpoint settings (for openai-compatible only)
  customEndpoint: z.object({
    baseUrl: z.string().url(),
    apiKey: z.string().optional()
  }).optional()
});

export type UserDefinedModel = z.infer<typeof UserDefinedModelSchema>;

export const CreateUserModelSchema = z.object({
  displayName: z.string().min(1).max(100),
  shortName: z.string().min(1).max(50),
  provider: z.enum(['openrouter', 'openai-compatible']),
  providerModelId: z.string().min(1).max(500),
  contextWindow: z.number().min(1000).max(10000000),
  outputTokenLimit: z.number().min(100).max(1000000),
  supportsThinking: z.boolean().optional(),
  settings: ModelSettingsSchema.optional(),
  customEndpoint: z.object({
    baseUrl: z.string().url(),
    apiKey: z.string().optional()
  }).optional()
});

export type CreateUserModel = z.infer<typeof CreateUserModelSchema>;

export const UpdateUserModelSchema = CreateUserModelSchema.partial();
export type UpdateUserModel = z.infer<typeof UpdateUserModelSchema>;

// Context management settings
export const ContextManagementSchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('append'),
    tokensBeforeCaching: z.number().default(10000) // Token threshold before first cache (moves with conversation)
  }),
  z.object({
    strategy: z.literal('rolling'),
    maxTokens: z.number(),
    maxGraceTokens: z.number()
  })
]);

export type ContextManagement = z.infer<typeof ContextManagementSchema>;

export const DEFAULT_CONTEXT_MANAGEMENT: ContextManagement = {
  strategy: 'append',
  tokensBeforeCaching: 10000
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

export const UpdateParticipantSchema = z.object({
  name: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  settings: ModelSettingsSchema.optional(),
  contextManagement: ContextManagementSchema.optional(),
  isActive: z.boolean().optional()
}).transform((o) => ({ ...o, contextManagement: o.contextManagement })); // specifically pass through undefined and null

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

// Bookmark types
export const BookmarkSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  branchId: z.string().uuid(),
  label: z.string(),
  createdAt: z.date()
});

export type Bookmark = z.infer<typeof BookmarkSchema>;

// Content block types for messages
export const TextContentBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string()
});

export const ThinkingContentBlockSchema = z.object({
  type: z.literal('thinking'),
  thinking: z.string(),
  signature: z.string().optional() // Encrypted thinking signature
});

export const RedactedThinkingContentBlockSchema = z.object({
  type: z.literal('redacted_thinking'),
  data: z.string() // Encrypted thinking data
});

export const ContentBlockSchema = z.discriminatedUnion('type', [
  TextContentBlockSchema,
  ThinkingContentBlockSchema,
  RedactedThinkingContentBlockSchema
]);

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

// Message types
export const MessageBranchSchema = z.object({
  id: z.string().uuid(),
  content: z.string(), // Main text content (for backward compatibility)
  contentBlocks: z.array(ContentBlockSchema).optional(), // Structured content blocks
  role: z.enum(['user', 'assistant', 'system']),
  participantId: z.string().uuid().optional(), // Link to participant
  createdAt: z.date(),
  model: z.string().optional(),
  parentBranchId: z.string().uuid().optional(),
  isActive: z.boolean().optional(), // Deprecated - not used, kept for backward compatibility
  attachments: z.array(AttachmentSchema).optional(), // Attachments for this branch
  bookmark: BookmarkSchema.optional() // Optional bookmark for this branch
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

// Prefill settings
export const PrefillSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  content: z.string().default('<cmd>cat untitled.log</cmd>')
});
export type PrefillSettings = z.infer<typeof PrefillSettingsSchema>;

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
  contextManagement: ContextManagementSchema.optional(), // Conversation-level default
  prefillUserMessage: PrefillSettingsSchema.optional() // Settings for initial user message in prefill mode
});

export type Conversation = z.infer<typeof ConversationSchema>;

// Conversation with participant summary for list view
export const ConversationWithSummarySchema = ConversationSchema.extend({
  participantModels: z.array(z.string()).optional() // Model IDs only for display
});

export type ConversationWithSummary = z.infer<typeof ConversationWithSummarySchema>;

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
  contextManagement: ContextManagementSchema.optional(),
  prefillUserMessage: PrefillSettingsSchema.optional()
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
  contextManagement: ContextManagementSchema.optional(),
  totalTreeTokens: z.number().optional() // Total size of all branches in conversation tree
});

export type ConversationMetrics = z.infer<typeof ConversationMetricsSchema>;

// Invite types - claimable credit grants
export const InviteSchema = z.object({
  code: z.string(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  amount: z.number().positive(),
  currency: z.string().default('credit'),
  expiresAt: z.string().optional(),
  claimedBy: z.string().uuid().optional(),
  claimedAt: z.string().optional()
});

export type Invite = z.infer<typeof InviteSchema>;