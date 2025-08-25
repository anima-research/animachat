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
    provider: z.enum(['bedrock', 'anthropic']),
    masked: z.string(),
    createdAt: z.date()
  })).optional()
});

export type User = z.infer<typeof UserSchema>;

// Model types
export const ModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  provider: z.enum(['bedrock', 'anthropic']),
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

// Message types
export const MessageBranchSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  createdAt: z.date(),
  model: z.string().optional(),
  parentBranchId: z.string().uuid().optional(),
  isActive: z.boolean()
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

// Conversation types
export const ConversationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string(),
  model: z.string(),
  systemPrompt: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  archived: z.boolean().default(false),
  settings: z.object({
    temperature: z.number(),
    maxTokens: z.number(),
    topP: z.number().optional(),
    topK: z.number().optional()
  })
});

export type Conversation = z.infer<typeof ConversationSchema>;

// WebSocket message types
export const WsMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat'),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    content: z.string(),
    parentBranchId: z.string().uuid().optional()
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
    content: z.string()
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
  systemPrompt: z.string().optional(),
  settings: z.object({
    temperature: z.number(),
    maxTokens: z.number(),
    topP: z.number().optional(),
    topK: z.number().optional()
  }).optional()
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
