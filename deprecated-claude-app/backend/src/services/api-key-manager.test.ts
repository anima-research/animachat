import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiKeyManager, type SelectedApiKey } from './api-key-manager.js';
import type { ProviderProfile, ModelCost, AnthropicProfile } from '../config/types.js';

// ── Mock ConfigLoader ────────────────────────────────────────────

const mockLoadConfig = vi.fn();
const mockGetBestProfile = vi.fn();

vi.mock('../config/loader.js', () => ({
  ConfigLoader: {
    getInstance: () => ({
      loadConfig: mockLoadConfig,
      getBestProfile: mockGetBestProfile,
    }),
  },
}));

// ── Mock Database ────────────────────────────────────────────────

const mockGetUserById = vi.fn();
const mockGetUserApiKeys = vi.fn();

function createMockDb() {
  return {
    getUserById: mockGetUserById,
    getUserApiKeys: mockGetUserApiKeys,
  } as any;
}

// ── Helpers ──────────────────────────────────────────────────────

function makeUserApiKey(provider: string, credentials: any) {
  return {
    id: 'key-123',
    userId: 'user-1',
    name: 'My API Key',
    provider,
    credentials,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeProfile(overrides: Partial<AnthropicProfile> = {}): AnthropicProfile {
  return {
    id: 'profile-1',
    name: 'Default Anthropic',
    provider: 'anthropic',
    priority: 1,
    credentials: { apiKey: 'sk-ant-test-1234567890' },
    ...overrides,
  } as AnthropicProfile;
}

// ── Setup / Teardown ─────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  // Suppress console output
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // Default config: user API keys allowed, no usage tracking
  mockLoadConfig.mockResolvedValue({
    providers: {},
    features: {
      allowUserApiKeys: true,
      enforceRateLimits: false,
      trackUsage: false,
      billUsers: false,
    },
  });

  // Default: user exists
  mockGetUserById.mockResolvedValue({ id: 'user-1', email: 'test@test.com' });
  // Default: no user API keys
  mockGetUserApiKeys.mockResolvedValue([]);
  // Default: no config profile
  mockGetBestProfile.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  // Clean up any env vars we set
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
  delete process.env.AWS_REGION;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
});

// ── Priority: user key > config profile > env var ────────────────

describe('getApiKeyForRequest — priority ordering', () => {
  it('returns user API key when available and allowed (highest priority)', async () => {
    const userKey = makeUserApiKey('anthropic', { apiKey: 'sk-user-key' });
    mockGetUserApiKeys.mockResolvedValue([userKey]);
    // Also set up config profile and env var to prove user key wins
    mockGetBestProfile.mockResolvedValue(makeProfile());
    process.env.ANTHROPIC_API_KEY = 'sk-env-key';

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'anthropic', 'claude-3-sonnet');

    expect(result).not.toBeNull();
    expect(result!.source).toBe('user');
    expect(result!.credentials).toEqual({ apiKey: 'sk-user-key' });
    expect(result!.userKey).toBe(userKey);
    // Should NOT have called getBestProfile since user key was found
    expect(mockGetBestProfile).not.toHaveBeenCalled();
  });

  it('returns config profile when no user key exists (second priority)', async () => {
    const profile = makeProfile();
    mockGetBestProfile.mockResolvedValue(profile);
    process.env.ANTHROPIC_API_KEY = 'sk-env-key';

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'anthropic', 'claude-3-sonnet');

    expect(result).not.toBeNull();
    expect(result!.source).toBe('config');
    expect(result!.credentials).toEqual({ apiKey: 'sk-ant-test-1234567890' });
    expect(result!.profile).toBe(profile);
  });

  it('returns env var key when no user key or config profile exists (lowest priority)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-env-fallback';

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'anthropic', 'claude-3-sonnet');

    expect(result).not.toBeNull();
    expect(result!.source).toBe('config');
    expect(result!.credentials).toEqual({ apiKey: 'sk-env-fallback' });
  });

  it('returns null when no keys available at any level', async () => {
    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'anthropic', 'claude-3-sonnet');

    expect(result).toBeNull();
  });
});

// ── User API key behavior ────────────────────────────────────────

describe('getApiKeyForRequest — user API key behavior', () => {
  it('skips user key check when allowUserApiKeys is false', async () => {
    mockLoadConfig.mockResolvedValue({
      providers: {},
      features: { allowUserApiKeys: false },
    });
    const userKey = makeUserApiKey('anthropic', { apiKey: 'sk-user-key' });
    mockGetUserApiKeys.mockResolvedValue([userKey]);

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'anthropic', 'claude-3-sonnet');

    // Should NOT have checked user API keys
    expect(mockGetUserApiKeys).not.toHaveBeenCalled();
    // Returns null because no config profile and no env var
    expect(result).toBeNull();
  });

  it('skips user key check when features config is undefined', async () => {
    mockLoadConfig.mockResolvedValue({
      providers: {},
    });

    const mgr = new ApiKeyManager(createMockDb());
    await mgr.getApiKeyForRequest('user-1', 'anthropic', 'claude-3-sonnet');

    expect(mockGetUserApiKeys).not.toHaveBeenCalled();
  });

  it('selects user key matching the requested provider', async () => {
    const anthropicKey = makeUserApiKey('anthropic', { apiKey: 'sk-anthropic' });
    const openrouterKey = makeUserApiKey('openrouter', { apiKey: 'sk-openrouter' });
    mockGetUserApiKeys.mockResolvedValue([anthropicKey, openrouterKey]);

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'openrouter', 'gpt-4');

    expect(result!.source).toBe('user');
    expect(result!.credentials).toEqual({ apiKey: 'sk-openrouter' });
  });

  it('falls through when user has keys for a different provider', async () => {
    const openrouterKey = makeUserApiKey('openrouter', { apiKey: 'sk-or' });
    mockGetUserApiKeys.mockResolvedValue([openrouterKey]);

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'anthropic', 'claude-3-sonnet');

    // Should fall through to config profile lookup
    expect(result).toBeNull();
    expect(mockGetBestProfile).toHaveBeenCalled();
  });

  it('falls through gracefully when getUserApiKeys throws', async () => {
    mockGetUserApiKeys.mockRejectedValue(new Error('DB connection error'));

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'anthropic', 'claude-3-sonnet');

    // Should fall through to config profile (error handled internally)
    expect(mockGetBestProfile).toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

// ── User not found ───────────────────────────────────────────────

describe('getApiKeyForRequest — user not found', () => {
  it('throws when user does not exist in database', async () => {
    mockGetUserById.mockResolvedValue(null);

    const mgr = new ApiKeyManager(createMockDb());
    await expect(
      mgr.getApiKeyForRequest('nonexistent-user', 'anthropic', 'claude-3-sonnet')
    ).rejects.toThrow('User not found');
  });
});

// ── Environment variable fallback per provider ───────────────────

describe('getApiKeyForRequest — environment variable fallback', () => {
  it('returns Anthropic key from ANTHROPIC_API_KEY', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-key';

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'anthropic', 'claude-3-sonnet');

    expect(result!.credentials).toEqual({ apiKey: 'sk-ant-env-key' });
  });

  it('returns Bedrock credentials from AWS env vars', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIATEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret123';
    process.env.AWS_SESSION_TOKEN = 'session-tok';
    process.env.AWS_REGION = 'eu-west-1';

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'bedrock', 'claude-3-sonnet');

    expect(result!.credentials).toEqual({
      accessKeyId: 'AKIATEST',
      secretAccessKey: 'secret123',
      sessionToken: 'session-tok',
      region: 'eu-west-1',
    });
  });

  it('defaults Bedrock region to us-east-1 when AWS_REGION not set', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIATEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret123';

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'bedrock', 'claude-3-sonnet');

    expect(result!.credentials.region).toBe('us-east-1');
  });

  it('returns null for Bedrock when only access key is set (missing secret)', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIATEST';
    // No AWS_SECRET_ACCESS_KEY

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'bedrock', 'claude-3-sonnet');

    expect(result).toBeNull();
  });

  it('returns OpenRouter key from OPENROUTER_API_KEY', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-env';

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'openrouter', 'gpt-4');

    expect(result!.credentials).toEqual({ apiKey: 'sk-or-env' });
  });

  it('returns OpenAI-compatible key from OPENAI_API_KEY with base URL', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-env';
    process.env.OPENAI_BASE_URL = 'https://custom.api.com/v1';

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'openai-compatible', 'gpt-4');

    expect(result!.credentials).toEqual({
      apiKey: 'sk-openai-env',
      baseUrl: 'https://custom.api.com/v1',
    });
  });

  it('defaults OpenAI base URL to api.openai.com when OPENAI_BASE_URL not set', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-env';

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'openai-compatible', 'gpt-4');

    expect(result!.credentials.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('returns null for unknown provider even with env vars set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.getApiKeyForRequest('user-1', 'unknown-provider', 'model-x');

    expect(result).toBeNull();
  });
});

// ── getBestProfile parameters ────────────────────────────────────

describe('getApiKeyForRequest — config profile lookup', () => {
  it('passes provider, modelId, and user group to getBestProfile', async () => {
    const mgr = new ApiKeyManager(createMockDb());
    await mgr.getApiKeyForRequest('user-1', 'anthropic', 'claude-3-sonnet');

    // getUserGroup returns 'free' by default (current implementation)
    expect(mockGetBestProfile).toHaveBeenCalledWith('anthropic', 'claude-3-sonnet', 'free');
  });
});

// ── checkRateLimits ──────────────────────────────────────────────

describe('checkRateLimits', () => {
  it('returns allowed when enforceRateLimits is false', async () => {
    mockLoadConfig.mockResolvedValue({
      providers: {},
      features: { enforceRateLimits: false },
    });

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.checkRateLimits('user-1', 'anthropic', makeProfile());

    expect(result).toEqual({ allowed: true });
  });

  it('returns allowed when no profile limits are defined', async () => {
    mockLoadConfig.mockResolvedValue({
      providers: {},
      features: { enforceRateLimits: true },
    });

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.checkRateLimits('user-1', 'anthropic', makeProfile());

    expect(result).toEqual({ allowed: true });
  });

  it('returns allowed when features config is undefined', async () => {
    mockLoadConfig.mockResolvedValue({ providers: {} });

    const mgr = new ApiKeyManager(createMockDb());
    const result = await mgr.checkRateLimits('user-1', 'anthropic');

    expect(result).toEqual({ allowed: true });
  });
});

// ── trackUsage ───────────────────────────────────────────────────

describe('trackUsage', () => {
  it('does nothing when trackUsage feature is disabled', async () => {
    mockLoadConfig.mockResolvedValue({
      providers: {},
      features: { trackUsage: false },
    });

    const mgr = new ApiKeyManager(createMockDb());
    // Should return without logging
    await mgr.trackUsage('user-1', 'anthropic', 'claude-3-sonnet', 100, 50);
    // No usage tracking console.log should happen (beyond the suppress)
  });

  it('calculates costs correctly using provider cost rates', async () => {
    mockLoadConfig.mockResolvedValue({
      providers: {},
      features: { trackUsage: true },
    });

    const profile = makeProfile({
      modelCosts: [{
        modelId: 'claude-3-sonnet',
        providerCost: {
          inputTokensPerMillion: 3.0,
          outputTokensPerMillion: 15.0,
        },
      }],
    });

    const mgr = new ApiKeyManager(createMockDb());
    await mgr.trackUsage('user-1', 'anthropic', 'claude-3-sonnet', 1_000_000, 500_000, profile);

    // Verify via the console.log call that was made with the usage data
    const logCall = (console.log as any).mock.calls.find(
      (call: any[]) => call[0] === 'Usage tracked:'
    );
    expect(logCall).toBeDefined();
    const usageData = logCall[1];
    expect(usageData.costs.provider.input).toBe(3.0); // 1M tokens * $3/M
    expect(usageData.costs.provider.output).toBe(7.5); // 0.5M tokens * $15/M
    expect(usageData.costs.provider.total).toBe(10.5);
  });

  it('uses billedCost rates when specified, separate from providerCost', async () => {
    mockLoadConfig.mockResolvedValue({
      providers: {},
      features: { trackUsage: true },
    });

    const profile = makeProfile({
      modelCosts: [{
        modelId: 'claude-3-sonnet',
        providerCost: {
          inputTokensPerMillion: 3.0,
          outputTokensPerMillion: 15.0,
        },
        billedCost: {
          inputTokensPerMillion: 6.0,
          outputTokensPerMillion: 30.0,
        },
      }],
    });

    const mgr = new ApiKeyManager(createMockDb());
    await mgr.trackUsage('user-1', 'anthropic', 'claude-3-sonnet', 1_000_000, 1_000_000, profile);

    const logCall = (console.log as any).mock.calls.find(
      (call: any[]) => call[0] === 'Usage tracked:'
    );
    const usageData = logCall[1];
    // Provider cost: input $3, output $15
    expect(usageData.costs.provider.input).toBe(3.0);
    expect(usageData.costs.provider.output).toBe(15.0);
    // Billed cost: input $6, output $30
    expect(usageData.costs.billed.input).toBe(6.0);
    expect(usageData.costs.billed.output).toBe(30.0);
    // Margin: billed total - provider total = 36 - 18 = 18
    expect(usageData.costs.margin).toBe(18.0);
  });

  it('defaults billedCost to providerCost when billedCost is not specified', async () => {
    mockLoadConfig.mockResolvedValue({
      providers: {},
      features: { trackUsage: true },
    });

    const profile = makeProfile({
      modelCosts: [{
        modelId: 'claude-3-sonnet',
        providerCost: {
          inputTokensPerMillion: 3.0,
          outputTokensPerMillion: 15.0,
        },
        // No billedCost
      }],
    });

    const mgr = new ApiKeyManager(createMockDb());
    await mgr.trackUsage('user-1', 'anthropic', 'claude-3-sonnet', 1_000_000, 1_000_000, profile);

    const logCall = (console.log as any).mock.calls.find(
      (call: any[]) => call[0] === 'Usage tracked:'
    );
    const usageData = logCall[1];
    // Billed should equal provider (no markup)
    expect(usageData.costs.billed.input).toBe(3.0);
    expect(usageData.costs.billed.output).toBe(15.0);
    expect(usageData.costs.margin).toBe(0);
  });

  it('reports zero costs when no modelCost matches the requested model', async () => {
    mockLoadConfig.mockResolvedValue({
      providers: {},
      features: { trackUsage: true },
    });

    const profile = makeProfile({
      modelCosts: [{
        modelId: 'claude-3-opus', // Different model
        providerCost: {
          inputTokensPerMillion: 15.0,
          outputTokensPerMillion: 75.0,
        },
      }],
    });

    const mgr = new ApiKeyManager(createMockDb());
    await mgr.trackUsage('user-1', 'anthropic', 'claude-3-sonnet', 1_000_000, 1_000_000, profile);

    const logCall = (console.log as any).mock.calls.find(
      (call: any[]) => call[0] === 'Usage tracked:'
    );
    const usageData = logCall[1];
    expect(usageData.costs.provider.total).toBe(0);
    expect(usageData.costs.billed.total).toBe(0);
  });

  it('reports zero costs when profile has no modelCosts', async () => {
    mockLoadConfig.mockResolvedValue({
      providers: {},
      features: { trackUsage: true },
    });

    const profile = makeProfile(); // No modelCosts

    const mgr = new ApiKeyManager(createMockDb());
    await mgr.trackUsage('user-1', 'anthropic', 'claude-3-sonnet', 1_000_000, 1_000_000, profile);

    const logCall = (console.log as any).mock.calls.find(
      (call: any[]) => call[0] === 'Usage tracked:'
    );
    const usageData = logCall[1];
    expect(usageData.costs.provider.total).toBe(0);
  });
});

// ── getCostForModel ──────────────────────────────────────────────

describe('getCostForModel', () => {
  it('returns the matching ModelCost for the requested model', () => {
    const profile = makeProfile({
      modelCosts: [
        {
          modelId: 'claude-3-sonnet',
          providerCost: { inputTokensPerMillion: 3.0, outputTokensPerMillion: 15.0 },
        },
        {
          modelId: 'claude-3-opus',
          providerCost: { inputTokensPerMillion: 15.0, outputTokensPerMillion: 75.0 },
        },
      ],
    });

    const mgr = new ApiKeyManager(createMockDb());
    const cost = mgr.getCostForModel(profile, 'claude-3-opus');

    expect(cost).not.toBeNull();
    expect(cost!.modelId).toBe('claude-3-opus');
    expect(cost!.providerCost.inputTokensPerMillion).toBe(15.0);
    expect(cost!.providerCost.outputTokensPerMillion).toBe(75.0);
  });

  it('returns null when model is not in the cost list', () => {
    const profile = makeProfile({
      modelCosts: [{
        modelId: 'claude-3-sonnet',
        providerCost: { inputTokensPerMillion: 3.0, outputTokensPerMillion: 15.0 },
      }],
    });

    const mgr = new ApiKeyManager(createMockDb());
    const cost = mgr.getCostForModel(profile, 'nonexistent-model');

    expect(cost).toBeNull();
  });

  it('returns null when profile has no modelCosts array', () => {
    const profile = makeProfile(); // No modelCosts

    const mgr = new ApiKeyManager(createMockDb());
    const cost = mgr.getCostForModel(profile, 'claude-3-sonnet');

    expect(cost).toBeNull();
  });
});
