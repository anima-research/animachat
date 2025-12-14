import { z } from 'zod';

// User types
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.date(),
  emailVerified: z.boolean().optional(), // Whether email has been verified
  emailVerifiedAt: z.date().optional(), // When email was verified
  apiKeys: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    provider: z.enum(['bedrock', 'anthropic', 'openrouter', 'openai-compatible', 'google']),
    masked: z.string(),
    createdAt: z.date()
  })).optional()
});

export type User = z.infer<typeof UserSchema>;

// Model capability types for multimodal support
export const ModelCapabilitiesSchema = z.object({
  // Input modalities
  imageInput: z.boolean().default(false),
  pdfInput: z.boolean().default(false),
  audioInput: z.boolean().default(false),
  videoInput: z.boolean().default(false),
  
  // Output modalities
  imageOutput: z.boolean().default(false),
  audioOutput: z.boolean().default(false),
  
  // Limits
  maxFileSize: z.number().optional(), // in bytes
  maxImageSize: z.number().optional(), // in pixels (width or height)
  maxAudioDuration: z.number().optional(), // in seconds
  maxVideoDuration: z.number().optional(), // in seconds
  maxPdfPages: z.number().optional(),
  
  // Context management
  autoTruncateContext: z.boolean().default(false), // Auto-truncate to model's contextWindow
});

export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

// Model-specific configurable settings schema
// These define UI controls that can be rendered dynamically for each model

// Option for select/multiselect controls
export const SettingOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
});

// Select dropdown setting
export const SelectSettingSchema = z.object({
  type: z.literal('select'),
  key: z.string(), // dot-notation path, e.g., "imageConfig.aspectRatio"
  label: z.string(),
  description: z.string().optional(),
  options: z.array(SettingOptionSchema),
  default: z.string(),
  condition: z.string().optional(), // Show only when another setting has a value, e.g., "responseModalities includes IMAGE"
});

// Boolean toggle setting
export const BooleanSettingSchema = z.object({
  type: z.literal('boolean'),
  key: z.string(),
  label: z.string(),
  description: z.string().optional(),
  default: z.boolean(),
  condition: z.string().optional(),
});

// Number slider/input setting
export const NumberSettingSchema = z.object({
  type: z.literal('number'),
  key: z.string(),
  label: z.string(),
  description: z.string().optional(),
  min: z.number(),
  max: z.number(),
  step: z.number().optional(),
  default: z.number(),
  condition: z.string().optional(),
});

// Multi-select setting (for things like responseModalities)
export const MultiselectSettingSchema = z.object({
  type: z.literal('multiselect'),
  key: z.string(),
  label: z.string(),
  description: z.string().optional(),
  options: z.array(SettingOptionSchema),
  default: z.array(z.string()),
  minSelected: z.number().optional(),
  maxSelected: z.number().optional(),
  condition: z.string().optional(),
});

// Text input setting
export const TextSettingSchema = z.object({
  type: z.literal('text'),
  key: z.string(),
  label: z.string(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  default: z.string().optional(),
  maxLength: z.number().optional(),
  condition: z.string().optional(),
});

// Union of all setting types
export const ConfigurableSettingSchema = z.discriminatedUnion('type', [
  SelectSettingSchema,
  BooleanSettingSchema,
  NumberSettingSchema,
  MultiselectSettingSchema,
  TextSettingSchema,
]);

export type ConfigurableSetting = z.infer<typeof ConfigurableSettingSchema>;
export type SelectSetting = z.infer<typeof SelectSettingSchema>;
export type BooleanSetting = z.infer<typeof BooleanSettingSchema>;
export type NumberSetting = z.infer<typeof NumberSettingSchema>;
export type MultiselectSetting = z.infer<typeof MultiselectSettingSchema>;
export type TextSetting = z.infer<typeof TextSettingSchema>;

// Provider enum - all supported AI providers
export const ProviderEnum = z.enum(['bedrock', 'anthropic', 'openrouter', 'openai-compatible', 'google']);
export type Provider = z.infer<typeof ProviderEnum>;

// Conversation mode - how messages are formatted for inference
// - 'auto': Use provider default (prefill for anthropic/bedrock, messages for others)
// - 'prefill': Force prefill format (conversation log with participant names)
// - 'messages': Force messages format (alternating user/assistant)
// - 'completion': OpenRouter completion mode (prompt field instead of messages)
export const ConversationModeEnum = z.enum(['auto', 'prefill', 'messages', 'completion']);
export type ConversationMode = z.infer<typeof ConversationModeEnum>;

// Model types
export const ModelSchema = z.object({
  id: z.string(), // Unique identifier for this model configuration
  providerModelId: z.string(), // The actual model ID to send to the provider API
  displayName: z.string(), // User-facing display name
  shortName: z.string(), // Short name for participant display
  provider: ProviderEnum,
  hidden: z.boolean(),
  contextWindow: z.number(),
  outputTokenLimit: z.number(),
  supportsThinking: z.boolean().optional(), // Whether the model supports extended thinking
  thinkingDefaultEnabled: z.boolean().optional(), // Whether thinking should be enabled by default for this model
  supportsPrefill: z.boolean().optional(), // Whether model supports prefill/completion mode (defaults based on provider)
  capabilities: ModelCapabilitiesSchema.optional(), // Multimodal capabilities
  currencies: z.record(z.boolean()).optional(),
  
  // Model-specific configurable settings (rendered as dynamic UI)
  configurableSettings: z.array(ConfigurableSettingSchema).optional(),
  
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
  }).optional(),
  
  // Model-specific settings (dynamic based on model's configurableSettings)
  // Stored as flat key-value pairs, e.g., { "imageConfig.aspectRatio": "16:9" }
  modelSpecific: z.record(z.unknown()).optional(),
});

export type ModelSettings = z.infer<typeof ModelSettingsSchema>;

// User-defined model types
export const UserDefinedModelSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string().min(1).max(100),
  shortName: z.string().min(1).max(50),
  provider: z.enum(['openrouter', 'openai-compatible', 'google']),
  providerModelId: z.string().min(1).max(500),
  contextWindow: z.number().min(1000).max(10000000),
  outputTokenLimit: z.number().min(100).max(1000000),
  supportsThinking: z.boolean().default(false),
  supportsPrefill: z.boolean().default(false), // Whether model supports prefill/completion mode
  hidden: z.boolean().default(false),
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
  provider: z.enum(['openrouter', 'openai-compatible', 'google']),
  providerModelId: z.string().min(1).max(500),
  contextWindow: z.number().min(1000).max(10000000),
  outputTokenLimit: z.number().min(100).max(1000000),
  supportsThinking: z.boolean().optional(),
  supportsPrefill: z.boolean().optional(), // Whether model supports prefill/completion mode
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
  conversationMode: ConversationModeEnum.optional(), // Per-participant format override (auto, prefill, messages, completion)
  isActive: z.boolean().default(true),

  // Persona system fields
  personaId: z.string().uuid().optional(), // If set, this participant is a persona
  personaParticipationId: z.string().uuid().optional() // Link to participation record
});

export type Participant = z.infer<typeof ParticipantSchema>;

export const UpdateParticipantSchema = z.object({
  name: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  settings: ModelSettingsSchema.optional(),
  contextManagement: ContextManagementSchema.optional(),
  conversationMode: ConversationModeEnum.optional(), // Per-participant format override
  isActive: z.boolean().optional(),
  // Persona system fields
  personaId: z.string().uuid().optional(),
  personaParticipationId: z.string().uuid().optional()
}).transform((o) => ({ ...o, contextManagement: o.contextManagement })); // specifically pass through undefined and null

// Attachment types - enhanced for multimodal support
export const AttachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  fileSize: z.number(),
  fileType: z.string(), // File extension (jpg, pdf, mp3, etc.)
  mimeType: z.string().optional(), // Full MIME type (image/jpeg, application/pdf, etc.)
  content: z.string(), // Base64 or text content
  encoding: z.enum(['base64', 'text', 'url']).default('text'),
  createdAt: z.date(),
  
  // Media-specific metadata
  metadata: z.object({
    // For images
    width: z.number().optional(),
    height: z.number().optional(),
    
    // For audio/video
    duration: z.number().optional(), // in seconds
    
    // For PDFs
    pageCount: z.number().optional(),
    
    // For extracted/fallback content
    extractedText: z.string().optional(), // Text extracted from PDF/audio transcription
  }).optional()
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
  text: z.string(),
  thoughtSignature: z.string().optional() // Gemini 3 Pro thought signature for multi-turn
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

// Image content block for model-generated images (GPT-4o, Gemini, etc.)
export const ImageContentBlockSchema = z.object({
  type: z.literal('image'),
  mimeType: z.string(), // image/png, image/jpeg, etc.
  data: z.string(), // Base64 encoded image data
  revisedPrompt: z.string().optional(), // The prompt as revised by the model (GPT returns this)
  width: z.number().optional(),
  height: z.number().optional()
});

// Audio content block for model-generated audio
export const AudioContentBlockSchema = z.object({
  type: z.literal('audio'),
  mimeType: z.string(), // audio/mp3, audio/wav, etc.
  data: z.string(), // Base64 encoded audio data
  duration: z.number().optional(), // Duration in seconds
  transcript: z.string().optional() // Text transcript of the audio
});

export const ContentBlockSchema = z.discriminatedUnion('type', [
  TextContentBlockSchema,
  ThinkingContentBlockSchema,
  RedactedThinkingContentBlockSchema,
  ImageContentBlockSchema,
  AudioContentBlockSchema
]);

export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type TextContentBlock = z.infer<typeof TextContentBlockSchema>;
export type ThinkingContentBlock = z.infer<typeof ThinkingContentBlockSchema>;
export type ImageContentBlock = z.infer<typeof ImageContentBlockSchema>;
export type AudioContentBlock = z.infer<typeof AudioContentBlockSchema>;

// Message types
export const MessageBranchSchema = z.object({
  id: z.string().uuid(),
  content: z.string(), // Main text content (for backward compatibility)
  contentBlocks: z.array(ContentBlockSchema).optional(), // Structured content blocks
  role: z.enum(['user', 'assistant', 'system']),
  participantId: z.string().uuid().optional(), // Link to participant (who they're speaking as)
  sentByUserId: z.string().uuid().optional(), // Actual user who sent this message (for multi-user attribution)
  createdAt: z.date(),
  model: z.string().optional(),
  parentBranchId: z.string().uuid().optional(),
  isActive: z.boolean().optional(), // Deprecated - not used, kept for backward compatibility
  attachments: z.array(AttachmentSchema).optional(), // Attachments for this branch
  bookmark: BookmarkSchema.optional(), // Optional bookmark for this branch
  hiddenFromAi: z.boolean().optional(), // If true, this message is visible to humans but excluded from AI context
  debugRequest: z.any().optional(), // Raw LLM request for debugging (researchers/admins only)
  debugResponse: z.any().optional() // Raw LLM response for debugging (researchers/admins only)
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
    })).optional(),
    hiddenFromAi: z.boolean().optional(), // If true, message is visible to humans but not included in AI context
    samplingBranches: z.number().min(1).max(10).optional() // Number of parallel response branches to generate
  }),
  z.object({
    type: z.literal('regenerate'),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    branchId: z.string().uuid(),
    parentBranchId: z.string().uuid().optional() // Current visible parent, for correct branch parenting after switches
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
    responderId: z.string().uuid().optional(), // Which assistant should respond
    samplingBranches: z.number().min(1).max(10).optional() // Number of parallel response branches to generate
  }),
  z.object({
    type: z.literal('abort'),
    conversationId: z.string().uuid()
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
  }),
  // Multi-user room management
  z.object({
    type: z.literal('join_room'),
    conversationId: z.string().uuid()
  }),
  z.object({
    type: z.literal('leave_room'),
    conversationId: z.string().uuid()
  }),
  z.object({
    type: z.literal('typing'),
    conversationId: z.string().uuid(),
    isTyping: z.boolean()
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

// ============================================================================
// Persona System Types
// ============================================================================

// Persona context strategy - how history is assembled
export const PersonaContextStrategySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('rolling'),
    maxTokens: z.number().default(60000) // How many tokens of history to include
  }),
  z.object({
    type: z.literal('anchored'),
    prefixTokens: z.number().default(10000), // Fixed prefix from earliest history
    rollingTokens: z.number().default(50000) // Rolling window from recent history
  })
]);

export type PersonaContextStrategy = z.infer<typeof PersonaContextStrategySchema>;

export const DEFAULT_PERSONA_CONTEXT_STRATEGY: PersonaContextStrategy = {
  type: 'rolling',
  maxTokens: 60000
};

// Persona - a persistent AI identity that accumulates history across conversations
export const PersonaSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  modelId: z.string(), // e.g., "claude-opus-4.5"
  ownerId: z.string().uuid(),

  contextStrategy: PersonaContextStrategySchema.default({ type: 'rolling', maxTokens: 60000 }),
  backscrollTokens: z.number().default(30000), // How much of current conversation to include
  allowInterleavedParticipation: z.boolean().default(false), // Allow multiple simultaneous conversations

  createdAt: z.date(),
  updatedAt: z.date(),
  archivedAt: z.date().optional() // If set, persona is frozen
});

export type Persona = z.infer<typeof PersonaSchema>;

// PersonaHistoryBranch - a timeline/branch of persona history (like git branches)
export const PersonaHistoryBranchSchema = z.object({
  id: z.string().uuid(),
  personaId: z.string().uuid(),
  name: z.string().min(1).max(100), // e.g., "main", "what-if-ethics"
  parentBranchId: z.string().uuid().optional(), // Fork source (null for root branch)
  forkPointParticipationId: z.string().uuid().optional(), // Where this branch diverged
  isHead: z.boolean().default(false), // Canonical HEAD (only one per persona)
  createdAt: z.date()
});

export type PersonaHistoryBranch = z.infer<typeof PersonaHistoryBranchSchema>;

// Canonical branch history entry - tracks changes to canonical conversation branch
export const CanonicalHistoryEntrySchema = z.object({
  branchId: z.string().uuid(),
  setAt: z.date(),
  previousBranchId: z.string().uuid().optional()
});

export type CanonicalHistoryEntry = z.infer<typeof CanonicalHistoryEntrySchema>;

// PersonaParticipation - records when a persona joins/leaves a conversation
export const PersonaParticipationSchema = z.object({
  id: z.string().uuid(),
  personaId: z.string().uuid(),
  conversationId: z.string().uuid(),
  participantId: z.string().uuid(), // Link to Participant record
  historyBranchId: z.string().uuid(), // Which persona timeline this belongs to

  joinedAt: z.date(), // Real-world timestamp
  leftAt: z.date().optional(), // Real-world timestamp (null if currently active)

  // Logical time ordering (user-editable, determines subjective order)
  logicalStart: z.number(), // e.g., 100, 200, 300...
  logicalEnd: z.number(), // Must be > logicalStart

  canonicalBranchId: z.string().uuid(), // Which conversation branch is "real"
  canonicalHistory: z.array(CanonicalHistoryEntrySchema).default([]) // Audit trail of canonical changes
});

export type PersonaParticipation = z.infer<typeof PersonaParticipationSchema>;

// PersonaShare - sharing personas with other users
export const PersonaPermissionSchema = z.enum(['viewer', 'user', 'editor', 'owner']);
export type PersonaPermission = z.infer<typeof PersonaPermissionSchema>;

export const PersonaShareSchema = z.object({
  id: z.string().uuid(),
  personaId: z.string().uuid(),
  sharedWithUserId: z.string().uuid(),
  sharedByUserId: z.string().uuid(),
  permission: PersonaPermissionSchema,
  createdAt: z.date()
});

export type PersonaShare = z.infer<typeof PersonaShareSchema>;

// API request/response schemas for personas

export const CreatePersonaRequestSchema = z.object({
  name: z.string().min(1).max(100),
  modelId: z.string(),
  contextStrategy: PersonaContextStrategySchema.optional(),
  backscrollTokens: z.number().optional(),
  allowInterleavedParticipation: z.boolean().optional()
});

export type CreatePersonaRequest = z.infer<typeof CreatePersonaRequestSchema>;

export const UpdatePersonaRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  contextStrategy: PersonaContextStrategySchema.optional(),
  backscrollTokens: z.number().optional(),
  allowInterleavedParticipation: z.boolean().optional()
});

export type UpdatePersonaRequest = z.infer<typeof UpdatePersonaRequestSchema>;

export const PersonaJoinRequestSchema = z.object({
  conversationId: z.string().uuid(),
  participantName: z.string().optional() // Defaults to persona name
});

export type PersonaJoinRequest = z.infer<typeof PersonaJoinRequestSchema>;

export const PersonaLeaveRequestSchema = z.object({
  conversationId: z.string().uuid()
});

export type PersonaLeaveRequest = z.infer<typeof PersonaLeaveRequestSchema>;

export const UpdateLogicalTimeRequestSchema = z.object({
  logicalStart: z.number(),
  logicalEnd: z.number()
});

export type UpdateLogicalTimeRequest = z.infer<typeof UpdateLogicalTimeRequestSchema>;

export const SetCanonicalBranchRequestSchema = z.object({
  branchId: z.string().uuid()
});

export type SetCanonicalBranchRequest = z.infer<typeof SetCanonicalBranchRequestSchema>;

export const ForkHistoryBranchRequestSchema = z.object({
  name: z.string().min(1).max(100),
  forkPointParticipationId: z.string().uuid().optional() // If not provided, forks from latest
});

export type ForkHistoryBranchRequest = z.infer<typeof ForkHistoryBranchRequestSchema>;

export const SharePersonaRequestSchema = z.object({
  email: z.string().email(),
  permission: PersonaPermissionSchema
});

export type SharePersonaRequest = z.infer<typeof SharePersonaRequestSchema>;

export const UpdateShareRequestSchema = z.object({
  permission: PersonaPermissionSchema
});

export type UpdateShareRequest = z.infer<typeof UpdateShareRequestSchema>;