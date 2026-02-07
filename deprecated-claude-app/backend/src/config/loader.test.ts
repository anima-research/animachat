import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { AppConfig } from './types.js';

// Each test gets a fresh ConfigLoader by resetting the singleton
// We use CONFIG_PATH env var to point at a temp config file

const SCRATCH = join(
  '/tmp/claude-1000/-home-quiterion-Projects-animachat/04733706-3bb5-4af3-91f8-92eec88b6339/scratchpad',
  'config-loader-test-' + Date.now()
);

async function writeConfig(config: object): Promise<string> {
  const configPath = join(SCRATCH, 'config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function makeValidConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    providers: {
      anthropic: [
        {
          id: 'test-profile-1',
          name: 'Test Anthropic',
          priority: 1,
          provider: 'anthropic' as const,
          credentials: { apiKey: 'sk-test-key-1' },
          allowedModels: ['claude-sonnet-4.5'],
        },
        {
          id: 'test-profile-2',
          name: 'Test Anthropic 2',
          priority: 2,
          provider: 'anthropic' as const,
          credentials: { apiKey: 'sk-test-key-2' },
          allowedModels: ['claude-sonnet-4.5', 'claude-opus-4.5'],
        },
      ],
    },
    features: {
      allowUserApiKeys: true,
      enforceRateLimits: false,
      trackUsage: true,
      billUsers: false,
    },
    defaultModel: 'claude-sonnet-4.5',
    ...overrides,
  };
}

// Dynamically import ConfigLoader after setting env var, and reset singleton
async function getNewConfigLoader() {
  // Reset the module to clear the singleton
  // We need to manipulate the static instance directly
  const mod = await import('./loader.js');
  const loader = mod.ConfigLoader.getInstance();
  // Force-reset internal state so it re-reads configPath from env
  // The singleton keeps old configPath, so we need to reset it
  (loader as any).config = null;
  (loader as any).configPath = process.env.CONFIG_PATH || join(process.cwd(), 'config', 'config.json');
  (loader as any).roundRobinIndexes = new Map();
  (loader as any).usageCounts = new Map();
  return loader;
}

describe('ConfigLoader', () => {
  beforeEach(async () => {
    await mkdir(SCRATCH, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.CONFIG_PATH;
    await rm(SCRATCH, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    it('loads valid config from CONFIG_PATH', async () => {
      const config = makeValidConfig();
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const loaded = await loader.loadConfig();

      expect(loaded.providers.anthropic).toHaveLength(2);
      expect(loaded.providers.anthropic![0].id).toBe('test-profile-1');
      expect(loaded.features?.allowUserApiKeys).toBe(true);
      expect(loaded.defaultModel).toBe('claude-sonnet-4.5');
    });

    it('returns cached config on subsequent calls', async () => {
      const config = makeValidConfig();
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const first = await loader.loadConfig();
      const second = await loader.loadConfig();

      expect(first).toBe(second); // Same reference
    });

    it('returns default config when config file is missing', async () => {
      process.env.CONFIG_PATH = join(SCRATCH, 'nonexistent.json');

      const loader = await getNewConfigLoader();
      const loaded = await loader.loadConfig();

      expect(loaded.providers).toEqual({});
      expect(loaded.features?.allowUserApiKeys).toBe(true);
      expect(loaded.features?.enforceRateLimits).toBe(false);
      expect(loaded.features?.trackUsage).toBe(false);
      expect(loaded.features?.billUsers).toBe(false);
    });

    it('returns default config when config file contains invalid JSON', async () => {
      const configPath = join(SCRATCH, 'config.json');
      await writeFile(configPath, '{ not valid json !!!');
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const loaded = await loader.loadConfig();

      // Should fall back to defaults
      expect(loaded.providers).toEqual({});
      expect(loaded.features?.allowUserApiKeys).toBe(true);
    });
  });

  describe('reloadConfig', () => {
    it('picks up changes from disk after reload', async () => {
      const config1 = makeValidConfig({ defaultModel: 'model-a' });
      const configPath = await writeConfig(config1);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const first = await loader.loadConfig();
      expect(first.defaultModel).toBe('model-a');

      // Write new config
      const config2 = makeValidConfig({ defaultModel: 'model-b' });
      await writeFile(configPath, JSON.stringify(config2, null, 2));

      await loader.reloadConfig();
      const reloaded = await loader.loadConfig();
      expect(reloaded.defaultModel).toBe('model-b');
    });
  });

  describe('getDefaultModel', () => {
    it('returns defaultModel from config', async () => {
      const config = makeValidConfig({ defaultModel: 'my-custom-model' });
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const model = await loader.getDefaultModel();
      expect(model).toBe('my-custom-model');
    });

    it('returns fallback when defaultModel is not set', async () => {
      const config = makeValidConfig();
      delete (config as any).defaultModel;
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const model = await loader.getDefaultModel();
      expect(model).toBe('claude-3-5-sonnet-20241022');
    });
  });

  describe('getProviderProfiles', () => {
    it('returns profiles for a known provider', async () => {
      const config = makeValidConfig();
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const profiles = await loader.getProviderProfiles('anthropic');
      expect(profiles).toHaveLength(2);
      expect(profiles[0].name).toBe('Test Anthropic');
    });

    it('returns empty array for unknown provider', async () => {
      const config = makeValidConfig();
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const profiles = await loader.getProviderProfiles('nonexistent');
      expect(profiles).toEqual([]);
    });
  });

  describe('getBestProfile', () => {
    it('returns null when no profiles exist for provider', async () => {
      const config = makeValidConfig({ providers: {} });
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const result = await loader.getBestProfile('anthropic', 'claude-sonnet-4.5');
      expect(result).toBeNull();
    });

    it('filters by allowedModels', async () => {
      const config = makeValidConfig();
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      // claude-opus-4.5 is only in profile-2's allowedModels
      const result = await loader.getBestProfile('anthropic', 'claude-opus-4.5');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('test-profile-2');
    });

    it('returns highest priority (lowest number) profile', async () => {
      const config = makeValidConfig();
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      // claude-sonnet-4.5 is in both profiles; priority 1 should win
      const result = await loader.getBestProfile('anthropic', 'claude-sonnet-4.5');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('test-profile-1');
    });

    it('filters by allowedUserGroups', async () => {
      const config = makeValidConfig({
        providers: {
          anthropic: [
            {
              id: 'premium-only',
              name: 'Premium',
              priority: 1,
              provider: 'anthropic' as const,
              credentials: { apiKey: 'key' },
              allowedUserGroups: ['premium'],
            },
          ],
        },
      });
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();

      // Free user should be rejected
      const freeResult = await loader.getBestProfile('anthropic', 'any-model', 'free');
      expect(freeResult).toBeNull();

      // Premium user should match
      const premiumResult = await loader.getBestProfile('anthropic', 'any-model', 'premium');
      expect(premiumResult).not.toBeNull();
      expect(premiumResult!.id).toBe('premium-only');
    });

    it('returns null when no eligible profiles match', async () => {
      const config = makeValidConfig();
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      // A model not in any allowedModels list
      const result = await loader.getBestProfile('anthropic', 'nonexistent-model');
      expect(result).toBeNull();
    });
  });

  describe('load balancing strategies', () => {
    async function setupMultipleProfilesSamePriority() {
      const config: AppConfig = {
        providers: {
          anthropic: [
            {
              id: 'profile-a',
              name: 'A',
              priority: 1,
              provider: 'anthropic' as const,
              credentials: { apiKey: 'key-a' },
            },
            {
              id: 'profile-b',
              name: 'B',
              priority: 1,
              provider: 'anthropic' as const,
              credentials: { apiKey: 'key-b' },
            },
          ],
        },
        loadBalancing: { strategy: 'first' },
      };
      return config;
    }

    it('first strategy always returns first profile', async () => {
      const config = await setupMultipleProfilesSamePriority();
      config.loadBalancing = { strategy: 'first' };
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const r1 = await loader.getBestProfile('anthropic', 'any-model');
      const r2 = await loader.getBestProfile('anthropic', 'any-model');
      const r3 = await loader.getBestProfile('anthropic', 'any-model');
      expect(r1!.id).toBe('profile-a');
      expect(r2!.id).toBe('profile-a');
      expect(r3!.id).toBe('profile-a');
    });

    it('round-robin strategy cycles through profiles', async () => {
      const config = await setupMultipleProfilesSamePriority();
      config.loadBalancing = { strategy: 'round-robin' };
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const r1 = await loader.getBestProfile('anthropic', 'any-model');
      const r2 = await loader.getBestProfile('anthropic', 'any-model');
      const r3 = await loader.getBestProfile('anthropic', 'any-model');

      expect(r1!.id).toBe('profile-a');
      expect(r2!.id).toBe('profile-b');
      expect(r3!.id).toBe('profile-a'); // Wraps around
    });

    it('least-used strategy picks profile with lowest usage', async () => {
      const config = await setupMultipleProfilesSamePriority();
      config.loadBalancing = { strategy: 'least-used' };
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const r1 = await loader.getBestProfile('anthropic', 'any-model');
      expect(r1!.id).toBe('profile-a'); // Both at 0, first wins

      const r2 = await loader.getBestProfile('anthropic', 'any-model');
      expect(r2!.id).toBe('profile-b'); // profile-a at 1, profile-b at 0

      const r3 = await loader.getBestProfile('anthropic', 'any-model');
      expect(r3!.id).toBe('profile-a'); // Both at 1, first wins again
    });

    it('random strategy returns one of the valid profiles', async () => {
      const config = await setupMultipleProfilesSamePriority();
      config.loadBalancing = { strategy: 'random' };
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const result = await loader.getBestProfile('anthropic', 'any-model');
      expect(['profile-a', 'profile-b']).toContain(result!.id);
    });

    it('defaults to random when no strategy specified', async () => {
      const config = await setupMultipleProfilesSamePriority();
      delete config.loadBalancing;
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();
      const result = await loader.getBestProfile('anthropic', 'any-model');
      // Should not throw, should return one of the profiles
      expect(result).not.toBeNull();
      expect(['profile-a', 'profile-b']).toContain(result!.id);
    });
  });

  describe('modelCosts-based filtering', () => {
    it('rejects models without cost configuration when modelCosts is set', async () => {
      // Set up a models.json so ModelLoader can resolve IDs
      const modelsPath = join(SCRATCH, 'models.json');
      await writeFile(
        modelsPath,
        JSON.stringify({
          models: [
            {
              id: 'claude-sonnet-4.5',
              providerModelId: 'claude-sonnet-4-5-20250929',
              displayName: 'Sonnet 4.5',
              shortName: 'S4.5',
              provider: 'anthropic',
              hidden: false,
              contextWindow: 200000,
              outputTokenLimit: 64000,
              settings: {
                temperature: { min: 0, max: 1, default: 1, step: 0.1 },
                maxTokens: { min: 1, max: 64000, default: 8096 },
              },
            },
          ],
        })
      );
      process.env.MODELS_CONFIG_PATH = modelsPath;

      // Reset ModelLoader so it uses the new path
      const mlMod = await import('./model-loader.js');
      const ml = mlMod.ModelLoader.getInstance();
      (ml as any).models = null;
      (ml as any).modelConfigPath = modelsPath;

      const config: AppConfig = {
        providers: {
          anthropic: [
            {
              id: 'costs-profile',
              name: 'With Costs',
              priority: 1,
              provider: 'anthropic' as const,
              credentials: { apiKey: 'key' },
              // No allowedModels, but has modelCosts
              modelCosts: [
                {
                  modelId: 'claude-sonnet-4-5-20250929',
                  providerCost: { inputTokensPerMillion: 3, outputTokensPerMillion: 15 },
                },
              ],
            },
          ],
        },
      };
      const configPath = await writeConfig(config);
      process.env.CONFIG_PATH = configPath;

      const loader = await getNewConfigLoader();

      // unknown-model-xyz is not in models.json, falls back to raw ID,
      // which doesn't match any modelCost entry → rejected
      const rejectResult = await loader.getBestProfile('anthropic', 'unknown-model-xyz');
      expect(rejectResult).toBeNull();

      // claude-sonnet-4.5 IS in models.json, resolves to providerModelId
      // which matches the modelCost entry → accepted
      const acceptResult = await loader.getBestProfile('anthropic', 'claude-sonnet-4.5');
      expect(acceptResult).not.toBeNull();
      expect(acceptResult!.id).toBe('costs-profile');
    });
  });

  describe('singleton pattern', () => {
    it('getInstance returns the same instance', async () => {
      const mod = await import('./loader.js');
      const a = mod.ConfigLoader.getInstance();
      const b = mod.ConfigLoader.getInstance();
      expect(a).toBe(b);
    });
  });
});
