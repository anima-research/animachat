import { z } from 'zod';

// Base API key schema
export const BaseApiKeySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  provider: z.string(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// Provider-specific credential schemas
export const AnthropicCredentialsSchema = z.object({
  apiKey: z.string()
});

export const BedrockCredentialsSchema = z.object({
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  region: z.string().default('us-east-1'),
  sessionToken: z.string().optional()
});

export const OpenRouterCredentialsSchema = z.object({
  apiKey: z.string()
});

export const OpenAICompatibleCredentialsSchema = z.object({
  apiKey: z.string(),
  baseUrl: z.string().url(),
  modelPrefix: z.string().optional() // Some providers prefix their models
});

// Combined API key schema with provider-specific credentials
export const ApiKeySchema = z.discriminatedUnion('provider', [
  BaseApiKeySchema.extend({
    provider: z.literal('anthropic'),
    credentials: AnthropicCredentialsSchema
  }),
  BaseApiKeySchema.extend({
    provider: z.literal('bedrock'),
    credentials: BedrockCredentialsSchema
  }),
  BaseApiKeySchema.extend({
    provider: z.literal('openrouter'),
    credentials: OpenRouterCredentialsSchema
  }),
  BaseApiKeySchema.extend({
    provider: z.literal('openai-compatible'),
    credentials: OpenAICompatibleCredentialsSchema
  })
]);

export type ApiKey = z.infer<typeof ApiKeySchema>;
export type AnthropicCredentials = z.infer<typeof AnthropicCredentialsSchema>;
export type BedrockCredentials = z.infer<typeof BedrockCredentialsSchema>;
export type OpenRouterCredentials = z.infer<typeof OpenRouterCredentialsSchema>;
export type OpenAICompatibleCredentials = z.infer<typeof OpenAICompatibleCredentialsSchema>;

// API key creation/update schemas
export const CreateApiKeySchema = z.discriminatedUnion('provider', [
  z.object({
    name: z.string(),
    provider: z.literal('anthropic'),
    credentials: AnthropicCredentialsSchema
  }),
  z.object({
    name: z.string(),
    provider: z.literal('bedrock'),
    credentials: BedrockCredentialsSchema
  }),
  z.object({
    name: z.string(),
    provider: z.literal('openrouter'),
    credentials: OpenRouterCredentialsSchema
  }),
  z.object({
    name: z.string(),
    provider: z.literal('openai-compatible'),
    credentials: OpenAICompatibleCredentialsSchema
  })
]);

export type CreateApiKey = z.infer<typeof CreateApiKeySchema>;

// Provider configuration (for system-level providers)
export const ProviderConfigSchema = z.object({
  anthropic: z.object({
    enabled: z.boolean(),
    apiKey: z.string().optional()
  }).optional(),
  bedrock: z.object({
    enabled: z.boolean(),
    credentials: BedrockCredentialsSchema.optional()
  }).optional(),
  openrouter: z.object({
    enabled: z.boolean(),
    apiKey: z.string().optional()
  }).optional(),
  openai: z.object({
    enabled: z.boolean(),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional()
  }).optional()
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// Token usage tracking
export const TokenUsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
  cachedTokens: z.number().optional(),
  cost: z.number().optional()
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;
