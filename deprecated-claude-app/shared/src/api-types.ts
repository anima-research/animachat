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
  thinkingTokens: z.number().optional(), // Thinking tokens used (for extended thinking)
  cost: z.number().optional()
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

// OpenRouter model info
export const OpenRouterModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  pricing: z.object({
    prompt: z.string().or(z.number()).optional(),
    completion: z.string().or(z.number()).optional()
  }).optional(),
  context_length: z.number().optional(),
  architecture: z.object({
    modality: z.string().optional(),
    tokenizer: z.string().optional(),
    instruct_type: z.string().optional(),
    // Modality arrays for capability detection
    input_modalities: z.array(z.string()).optional(),
    output_modalities: z.array(z.string()).optional()
  }).optional(),
  top_provider: z.object({
    context_length: z.number().optional(),
    max_completion_tokens: z.number().optional(),
    is_moderated: z.boolean().optional()
  }).optional(),
  per_request_limits: z.object({
    prompt_tokens: z.string().or(z.number()).optional(),
    completion_tokens: z.string().or(z.number()).optional()
  }).optional(),
  // Supported parameters can indicate function calling, etc.
  supported_parameters: z.array(z.string()).optional()
});

export type OpenRouterModel = z.infer<typeof OpenRouterModelSchema>;

export const OpenRouterModelsResponseSchema = z.object({
  models: z.array(OpenRouterModelSchema),
  cached: z.boolean(),
  cacheAge: z.number(),
  warning: z.string().optional()
});

export type OpenRouterModelsResponse = z.infer<typeof OpenRouterModelsResponseSchema>;

export const ModelPricingCostSchema = z.object({
  perToken: z.object({
    input: z.number().nullable(),
    output: z.number().nullable()
  }),
  perMillion: z.object({
    input: z.number().nullable(),
    output: z.number().nullable()
  })
});

export const ModelPricingTierSchema = z.object({
  profileId: z.string(),
  profileName: z.string(),
  profilePriority: z.number(),
  providerCost: ModelPricingCostSchema.nullable(),
  billedCost: ModelPricingCostSchema.nullable()
});

export const ModelPricingSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  provider: z.string(),
  providerModelId: z.string(),
  hidden: z.boolean(),
  contextWindow: z.number(),
  outputTokenLimit: z.number(),
  supportsThinking: z.boolean().optional(),
  thinkingDefaultEnabled: z.boolean().optional(),
  pricing: z.array(ModelPricingTierSchema),
  currencies: z.array(z.string()).default([])
});

export const PublicModelPricingResponseSchema = z.object({
  models: z.array(ModelPricingSummarySchema)
});

export type ModelPricingCost = z.infer<typeof ModelPricingCostSchema>;
export type ModelPricingTier = z.infer<typeof ModelPricingTierSchema>;
export type ModelPricingSummary = z.infer<typeof ModelPricingSummarySchema>;
export type PublicModelPricingResponse = z.infer<typeof PublicModelPricingResponseSchema>;
