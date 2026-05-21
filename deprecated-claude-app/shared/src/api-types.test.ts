import { describe, it, expect } from 'vitest';
import {
  BaseApiKeySchema,
  AnthropicCredentialsSchema,
  BedrockCredentialsSchema,
  OpenRouterCredentialsSchema,
  OpenAICompatibleCredentialsSchema,
  ApiKeySchema,
  CreateApiKeySchema,
  ProviderConfigSchema,
  TokenUsageSchema,
  OpenRouterModelSchema,
  OpenRouterModelsResponseSchema,
  ModelPricingCostSchema,
  ModelPricingTierSchema,
  ModelPricingSummarySchema,
  PublicModelPricingResponseSchema,
} from './api-types.js';

const uuid = () => '00000000-0000-4000-a000-000000000001';

// ============================================================================
// Credential Schemas
// ============================================================================

describe('AnthropicCredentialsSchema', () => {
  it('accepts valid credentials', () => {
    const result = AnthropicCredentialsSchema.safeParse({ apiKey: 'sk-ant-12345' });
    expect(result.success).toBe(true);
  });

  it('rejects missing apiKey', () => {
    const result = AnthropicCredentialsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('BedrockCredentialsSchema', () => {
  it('accepts valid credentials with default region', () => {
    const result = BedrockCredentialsSchema.parse({
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    expect(result.region).toBe('us-east-1');
  });

  it('accepts credentials with explicit region', () => {
    const result = BedrockCredentialsSchema.parse({
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'secret',
      region: 'eu-west-1',
    });
    expect(result.region).toBe('eu-west-1');
  });

  it('accepts credentials with sessionToken', () => {
    const result = BedrockCredentialsSchema.safeParse({
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      sessionToken: 'token123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing accessKeyId', () => {
    const result = BedrockCredentialsSchema.safeParse({ secretAccessKey: 'secret' });
    expect(result.success).toBe(false);
  });

  it('rejects missing secretAccessKey', () => {
    const result = BedrockCredentialsSchema.safeParse({ accessKeyId: 'AKID' });
    expect(result.success).toBe(false);
  });
});

describe('OpenRouterCredentialsSchema', () => {
  it('accepts valid credentials', () => {
    const result = OpenRouterCredentialsSchema.safeParse({ apiKey: 'sk-or-12345' });
    expect(result.success).toBe(true);
  });

  it('rejects missing apiKey', () => {
    const result = OpenRouterCredentialsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('OpenAICompatibleCredentialsSchema', () => {
  it('accepts valid credentials', () => {
    const result = OpenAICompatibleCredentialsSchema.safeParse({
      apiKey: 'sk-12345',
      baseUrl: 'https://api.example.com/v1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts credentials with modelPrefix', () => {
    const result = OpenAICompatibleCredentialsSchema.safeParse({
      apiKey: 'sk-12345',
      baseUrl: 'https://api.example.com/v1',
      modelPrefix: 'custom/',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid baseUrl', () => {
    const result = OpenAICompatibleCredentialsSchema.safeParse({
      apiKey: 'sk-12345',
      baseUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing baseUrl', () => {
    const result = OpenAICompatibleCredentialsSchema.safeParse({ apiKey: 'sk-12345' });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// BaseApiKeySchema
// ============================================================================

describe('BaseApiKeySchema', () => {
  it('accepts a valid base API key', () => {
    const result = BaseApiKeySchema.safeParse({
      id: uuid(),
      userId: uuid(),
      name: 'My Key',
      provider: 'anthropic',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID id', () => {
    const result = BaseApiKeySchema.safeParse({
      id: 'not-uuid',
      userId: uuid(),
      name: 'Key',
      provider: 'anthropic',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing name', () => {
    const result = BaseApiKeySchema.safeParse({
      id: uuid(),
      userId: uuid(),
      provider: 'anthropic',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ApiKeySchema (discriminated union by provider)
// ============================================================================

describe('ApiKeySchema', () => {
  const baseFields = {
    id: uuid(),
    userId: uuid(),
    name: 'Test Key',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('accepts an anthropic API key', () => {
    const result = ApiKeySchema.safeParse({
      ...baseFields,
      provider: 'anthropic',
      credentials: { apiKey: 'sk-ant-123' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.provider).toBe('anthropic');
  });

  it('accepts a bedrock API key', () => {
    const result = ApiKeySchema.safeParse({
      ...baseFields,
      provider: 'bedrock',
      credentials: {
        accessKeyId: 'AKID',
        secretAccessKey: 'secret',
        region: 'us-west-2',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.provider).toBe('bedrock');
  });

  it('accepts an openrouter API key', () => {
    const result = ApiKeySchema.safeParse({
      ...baseFields,
      provider: 'openrouter',
      credentials: { apiKey: 'sk-or-123' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an openai-compatible API key', () => {
    const result = ApiKeySchema.safeParse({
      ...baseFields,
      provider: 'openai-compatible',
      credentials: { apiKey: 'sk-123', baseUrl: 'https://api.example.com' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects anthropic key with wrong credentials shape', () => {
    const result = ApiKeySchema.safeParse({
      ...baseFields,
      provider: 'anthropic',
      credentials: { accessKeyId: 'AKID', secretAccessKey: 'secret' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects bedrock key missing secretAccessKey', () => {
    const result = ApiKeySchema.safeParse({
      ...baseFields,
      provider: 'bedrock',
      credentials: { accessKeyId: 'AKID' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown provider', () => {
    const result = ApiKeySchema.safeParse({
      ...baseFields,
      provider: 'azure',
      credentials: { apiKey: 'test' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing credentials', () => {
    const result = ApiKeySchema.safeParse({
      ...baseFields,
      provider: 'anthropic',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// CreateApiKeySchema (discriminated union by provider)
// ============================================================================

describe('CreateApiKeySchema', () => {
  it('accepts anthropic creation request', () => {
    const result = CreateApiKeySchema.safeParse({
      name: 'New Key',
      provider: 'anthropic',
      credentials: { apiKey: 'sk-ant-new' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts bedrock creation request', () => {
    const result = CreateApiKeySchema.safeParse({
      name: 'AWS Key',
      provider: 'bedrock',
      credentials: { accessKeyId: 'AKID', secretAccessKey: 'secret' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts openrouter creation request', () => {
    const result = CreateApiKeySchema.safeParse({
      name: 'OR Key',
      provider: 'openrouter',
      credentials: { apiKey: 'sk-or-new' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts openai-compatible creation request', () => {
    const result = CreateApiKeySchema.safeParse({
      name: 'Custom Key',
      provider: 'openai-compatible',
      credentials: { apiKey: 'sk-123', baseUrl: 'https://api.custom.com/v1' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects creation request without name', () => {
    const result = CreateApiKeySchema.safeParse({
      provider: 'anthropic',
      credentials: { apiKey: 'test' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects creation request with invalid provider', () => {
    const result = CreateApiKeySchema.safeParse({
      name: 'Key',
      provider: 'unknown',
      credentials: { apiKey: 'test' },
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ProviderConfigSchema
// ============================================================================

describe('ProviderConfigSchema', () => {
  it('accepts empty config', () => {
    const result = ProviderConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a fully populated config', () => {
    const result = ProviderConfigSchema.safeParse({
      anthropic: { enabled: true, apiKey: 'sk-ant-123' },
      bedrock: {
        enabled: true,
        credentials: { accessKeyId: 'AKID', secretAccessKey: 'secret', region: 'us-east-1' },
      },
      openrouter: { enabled: false },
      openai: { enabled: true, apiKey: 'sk-oai', baseUrl: 'https://api.openai.com/v1' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects anthropic config with non-boolean enabled', () => {
    const result = ProviderConfigSchema.safeParse({
      anthropic: { enabled: 'yes' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects openai config with invalid baseUrl', () => {
    const result = ProviderConfigSchema.safeParse({
      openai: { enabled: true, baseUrl: 'not-a-url' },
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// TokenUsageSchema
// ============================================================================

describe('TokenUsageSchema', () => {
  it('accepts minimal usage', () => {
    const result = TokenUsageSchema.safeParse({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    expect(result.success).toBe(true);
  });

  it('accepts usage with all optional fields', () => {
    const result = TokenUsageSchema.safeParse({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedTokens: 30,
      thinkingTokens: 500,
      cost: 0.0025,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing promptTokens', () => {
    const result = TokenUsageSchema.safeParse({
      completionTokens: 50,
      totalTokens: 50,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-number tokens', () => {
    const result = TokenUsageSchema.safeParse({
      promptTokens: '100',
      completionTokens: 50,
      totalTokens: 150,
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// OpenRouterModelSchema
// ============================================================================

describe('OpenRouterModelSchema', () => {
  it('accepts a minimal model (only id required)', () => {
    const result = OpenRouterModelSchema.safeParse({ id: 'anthropic/claude-3-opus' });
    expect(result.success).toBe(true);
  });

  it('accepts a fully populated model', () => {
    const result = OpenRouterModelSchema.safeParse({
      id: 'anthropic/claude-3-opus',
      name: 'Claude 3 Opus',
      description: 'Most capable model',
      pricing: { prompt: '0.015', completion: '0.075' },
      context_length: 200000,
      architecture: {
        modality: 'text->text',
        tokenizer: 'claude',
        instruct_type: 'claude',
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
      },
      top_provider: {
        context_length: 200000,
        max_completion_tokens: 4096,
        is_moderated: false,
      },
      supported_parameters: ['temperature', 'top_p'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects model missing id', () => {
    const result = OpenRouterModelSchema.safeParse({ name: 'Some Model' });
    expect(result.success).toBe(false);
  });

  it('accepts pricing with numeric values', () => {
    const result = OpenRouterModelSchema.safeParse({
      id: 'test-model',
      pricing: { prompt: 0.015, completion: 0.075 },
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// OpenRouterModelsResponseSchema
// ============================================================================

describe('OpenRouterModelsResponseSchema', () => {
  it('accepts a valid response', () => {
    const result = OpenRouterModelsResponseSchema.safeParse({
      models: [{ id: 'model-1' }, { id: 'model-2' }],
      cached: true,
      cacheAge: 300,
    });
    expect(result.success).toBe(true);
  });

  it('accepts response with warning', () => {
    const result = OpenRouterModelsResponseSchema.safeParse({
      models: [],
      cached: false,
      cacheAge: 0,
      warning: 'Rate limited',
    });
    expect(result.success).toBe(true);
  });

  it('rejects response missing models', () => {
    const result = OpenRouterModelsResponseSchema.safeParse({
      cached: true,
      cacheAge: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects response missing cached', () => {
    const result = OpenRouterModelsResponseSchema.safeParse({
      models: [],
      cacheAge: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ModelPricing schemas
// ============================================================================

describe('ModelPricingCostSchema', () => {
  it('accepts valid costs', () => {
    const result = ModelPricingCostSchema.safeParse({
      perToken: { input: 0.000015, output: 0.000075 },
      perMillion: { input: 15, output: 75 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts null costs', () => {
    const result = ModelPricingCostSchema.safeParse({
      perToken: { input: null, output: null },
      perMillion: { input: null, output: null },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing perToken', () => {
    const result = ModelPricingCostSchema.safeParse({
      perMillion: { input: 15, output: 75 },
    });
    expect(result.success).toBe(false);
  });
});

describe('ModelPricingSummarySchema', () => {
  it('accepts a valid pricing summary', () => {
    const result = ModelPricingSummarySchema.safeParse({
      id: 'claude-3-opus',
      displayName: 'Claude 3 Opus',
      provider: 'anthropic',
      providerModelId: 'claude-3-opus-20240229',
      hidden: false,
      contextWindow: 200000,
      outputTokenLimit: 4096,
      pricing: [{
        profileId: 'default',
        profileName: 'Default',
        profilePriority: 1,
        providerCost: {
          perToken: { input: 0.000015, output: 0.000075 },
          perMillion: { input: 15, output: 75 },
        },
        billedCost: null,
      }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Check default for currencies
      expect(result.data.currencies).toEqual([]);
    }
  });

  it('rejects pricing summary missing required fields', () => {
    const result = ModelPricingSummarySchema.safeParse({
      id: 'model',
      // missing displayName, provider, etc.
    });
    expect(result.success).toBe(false);
  });
});

describe('PublicModelPricingResponseSchema', () => {
  it('accepts a valid response', () => {
    const result = PublicModelPricingResponseSchema.safeParse({
      models: [{
        id: 'test',
        displayName: 'Test',
        provider: 'anthropic',
        providerModelId: 'test-v1',
        hidden: false,
        contextWindow: 100000,
        outputTokenLimit: 4096,
        pricing: [],
      }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty models array', () => {
    const result = PublicModelPricingResponseSchema.safeParse({ models: [] });
    expect(result.success).toBe(true);
  });

  it('rejects missing models', () => {
    const result = PublicModelPricingResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
