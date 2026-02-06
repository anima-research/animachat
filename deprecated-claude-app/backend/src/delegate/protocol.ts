// Vendored from @deprecated-claude/backend
// Original location: node_modules/@deprecated-claude/backend/src/delegate/protocol.ts

/**
 * Delegate Protocol Types
 *
 * Defines the WebSocket message protocol between the server and delegate apps.
 * All messages are JSON with a discriminated 'type' field.
 */

import { z } from 'zod';

// =============================================================================
// Tool Definition Schema (Membrane-compatible)
// =============================================================================

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.unknown()),
    required: z.array(z.string()).optional(),
  }),
});

// =============================================================================
// Delegate → Server Messages
// =============================================================================

export const DelegateAuthMessageSchema = z.object({
  type: z.literal('delegate_auth'),
  version: z.string().default('1.0'),
  token: z.string(),
  delegateId: z.string(),
  capabilities: z.array(z.string()).default([]),
});

export const ToolManifestMessageSchema = z.object({
  type: z.literal('tool_manifest'),
  delegateId: z.string(),
  tools: z.array(ToolDefinitionSchema),
});

export const ToolCallResponseMessageSchema = z.object({
  type: z.literal('tool_call_response'),
  requestId: z.string(),
  toolUseId: z.string(),
  result: z.object({
    content: z.union([z.string(), z.array(z.any())]),
    isError: z.boolean().default(false),
  }),
});

export const TriggerInferenceMessageSchema = z.object({
  type: z.literal('trigger_inference'),
  triggerId: z.string(),
  source: z.string(),
  conversationId: z.string().optional(),
  participantId: z.string().optional(),
  context: z.record(z.unknown()).default({}),
  systemMessage: z.string().optional(),
});

export const DelegatePingMessageSchema = z.object({
  type: z.literal('ping'),
  timestamp: z.number(),
});

// =============================================================================
// Server → Delegate Messages
// =============================================================================

export const DelegateAuthResultMessageSchema = z.object({
  type: z.literal('delegate_auth_result'),
  success: z.boolean(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  error: z.string().optional(),
});

export const ToolCallRequestMessageSchema = z.object({
  type: z.literal('tool_call_request'),
  requestId: z.string(),
  conversationId: z.string(),
  messageId: z.string().optional(),
  tool: z.object({
    id: z.string(),
    name: z.string(),
    input: z.record(z.unknown()),
  }),
  timeout: z.number().default(30000),
});

export const TriggerInferenceResultMessageSchema = z.object({
  type: z.literal('trigger_inference_result'),
  triggerId: z.string(),
  success: z.boolean(),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
  response: z.string().optional(),
  error: z.string().optional(),
});

export const DelegatePongMessageSchema = z.object({
  type: z.literal('pong'),
  timestamp: z.number(),
});

// =============================================================================
// Union Types
// =============================================================================

/** All messages that a delegate can send to the server */
export const DelegateToServerMessageSchema = z.discriminatedUnion('type', [
  DelegateAuthMessageSchema,
  ToolManifestMessageSchema,
  ToolCallResponseMessageSchema,
  TriggerInferenceMessageSchema,
  DelegatePingMessageSchema,
]);

/** All messages that the server can send to a delegate */
export const ServerToDelegateMessageSchema = z.discriminatedUnion('type', [
  DelegateAuthResultMessageSchema,
  ToolCallRequestMessageSchema,
  TriggerInferenceResultMessageSchema,
  DelegatePongMessageSchema,
]);

// =============================================================================
// Inferred Types
// =============================================================================

export type DelegateAuthMessage = z.infer<typeof DelegateAuthMessageSchema>;
export type ToolManifestMessage = z.infer<typeof ToolManifestMessageSchema>;
export type ToolCallResponseMessage = z.infer<typeof ToolCallResponseMessageSchema>;
export type TriggerInferenceMessage = z.infer<typeof TriggerInferenceMessageSchema>;
export type DelegatePingMessage = z.infer<typeof DelegatePingMessageSchema>;

export type DelegateAuthResultMessage = z.infer<typeof DelegateAuthResultMessageSchema>;
export type ToolCallRequestMessage = z.infer<typeof ToolCallRequestMessageSchema>;
export type TriggerInferenceResultMessage = z.infer<typeof TriggerInferenceResultMessageSchema>;
export type DelegatePongMessage = z.infer<typeof DelegatePongMessageSchema>;

export type DelegateToServerMessage = z.infer<typeof DelegateToServerMessageSchema>;
export type ServerToDelegateMessage = z.infer<typeof ServerToDelegateMessageSchema>;
