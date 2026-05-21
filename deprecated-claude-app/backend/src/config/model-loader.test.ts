import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';

const SCRATCH = join(
  '/tmp/claude-1000/-home-quiterion-Projects-animachat/04733706-3bb5-4af3-91f8-92eec88b6339/scratchpad',
  'model-loader-test-' + Date.now()
);

const SAMPLE_MODELS = {
  models: [
    {
      id: 'claude-sonnet-4.5',
      providerModelId: 'claude-sonnet-4-5-20250929',
      displayName: 'Claude Sonnet 4.5',
      shortName: 'Sonnet 4.5',
      provider: 'anthropic',
      hidden: false,
      contextWindow: 200000,
      outputTokenLimit: 64000,
      supportsThinking: true,
      settings: {
        temperature: { min: 0, max: 1, default: 1, step: 0.1 },
        maxTokens: { min: 1, max: 64000, default: 8096 },
      },
    },
    {
      id: 'claude-opus-4.5',
      providerModelId: 'claude-opus-4-5-20251101',
      displayName: 'Claude Opus 4.5',
      shortName: 'Opus 4.5',
      provider: 'anthropic',
      hidden: false,
      contextWindow: 200000,
      outputTokenLimit: 32000,
      supportsThinking: true,
      settings: {
        temperature: { min: 0, max: 1, default: 1, step: 0.1 },
        maxTokens: { min: 1, max: 32000, default: 8096 },
      },
    },
    {
      id: 'gpt-4o',
      providerModelId: 'gpt-4o-2024-08-06',
      displayName: 'GPT-4o',
      shortName: 'GPT-4o',
      provider: 'openrouter',
      hidden: false,
      contextWindow: 128000,
      outputTokenLimit: 16384,
      settings: {
        temperature: { min: 0, max: 2, default: 1, step: 0.1 },
        maxTokens: { min: 1, max: 16384, default: 4096 },
      },
    },
    {
      id: 'hidden-model',
      providerModelId: 'hidden-model-v1',
      displayName: 'Hidden Model',
      shortName: 'Hidden',
      provider: 'anthropic',
      hidden: true,
      contextWindow: 100000,
      outputTokenLimit: 4096,
      settings: {
        temperature: { min: 0, max: 1, default: 0.7, step: 0.1 },
        maxTokens: { min: 1, max: 4096, default: 2048 },
      },
    },
  ],
};

async function writeModels(models: object): Promise<string> {
  const modelsPath = join(SCRATCH, 'models.json');
  await writeFile(modelsPath, JSON.stringify(models, null, 2));
  return modelsPath;
}

async function getNewModelLoader() {
  const mod = await import('./model-loader.js');
  const loader = mod.ModelLoader.getInstance();
  // Reset internal cached state
  (loader as any).models = null;
  (loader as any).db = null;
  (loader as any).modelConfigPath =
    process.env.MODELS_CONFIG_PATH || join(process.cwd(), 'config', 'models.json');
  return loader;
}

describe('ModelLoader', () => {
  beforeEach(async () => {
    await mkdir(SCRATCH, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.MODELS_CONFIG_PATH;
    await rm(SCRATCH, { recursive: true, force: true });
  });

  describe('loadModels', () => {
    it('loads models from MODELS_CONFIG_PATH', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const models = await loader.loadModels();

      expect(models).toHaveLength(4);
      expect(models[0].id).toBe('claude-sonnet-4.5');
      expect(models[0].provider).toBe('anthropic');
    });

    it('returns cached models on subsequent calls', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const first = await loader.loadModels();
      const second = await loader.loadModels();

      expect(first).toBe(second); // Same reference
    });

    it('returns empty array when file does not exist', async () => {
      process.env.MODELS_CONFIG_PATH = join(SCRATCH, 'nonexistent.json');

      const loader = await getNewModelLoader();
      const models = await loader.loadModels();

      expect(models).toEqual([]);
    });

    it('returns empty array when file contains invalid JSON', async () => {
      const modelsPath = join(SCRATCH, 'models.json');
      await writeFile(modelsPath, 'invalid json {{{');
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const models = await loader.loadModels();

      expect(models).toEqual([]);
    });

    it('handles JSON with no "models" field gracefully', async () => {
      const modelsPath = await writeModels({ other: 'data' });
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const models = await loader.loadModels();

      expect(models).toEqual([]);
    });
  });

  describe('getAllModels', () => {
    it('returns system models when no userId provided', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const models = await loader.getAllModels();

      expect(models).toHaveLength(4);
    });

    it('returns system models when userId provided but no db set', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const models = await loader.getAllModels('user-123');

      // No db set, so just system models
      expect(models).toHaveLength(4);
    });

    it('merges user-defined models with system models when db is set', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();

      const mockDb = {
        getUserModels: vi.fn().mockResolvedValue([
          {
            id: 'custom-model-1',
            providerModelId: 'custom-v1',
            displayName: 'My Custom Model',
            shortName: 'Custom',
            provider: 'openai-compatible',
            hidden: false,
            contextWindow: 8000,
            outputTokenLimit: 2000,
            supportsThinking: false,
            customEndpoint: 'https://my-api.example.com/v1',
            settings: {
              temperature: 0.7,
              maxTokens: 2000,
              topP: 0.9,
              topK: 40,
            },
          },
        ]),
      };

      loader.setDatabase(mockDb as any);
      const models = await loader.getAllModels('user-123');

      expect(models).toHaveLength(5); // 4 system + 1 custom
      expect(mockDb.getUserModels).toHaveBeenCalledWith('user-123');

      const custom = models.find((m) => m.id === 'custom-model-1');
      expect(custom).toBeDefined();
      expect(custom!.displayName).toBe('My Custom Model');
      expect(custom!.provider).toBe('openai-compatible');
      expect((custom as any).customEndpoint).toBe('https://my-api.example.com/v1');
      // User models always get credit currency
      expect(custom!.currencies).toEqual({ credit: true });
      // Settings should be converted to range format
      expect(custom!.settings.temperature.default).toBe(0.7);
      expect(custom!.settings.maxTokens.max).toBe(2000);
    });

    it('handles user-defined model without optional topP/topK', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();

      const mockDb = {
        getUserModels: vi.fn().mockResolvedValue([
          {
            id: 'simple-model',
            providerModelId: 'simple-v1',
            displayName: 'Simple',
            shortName: 'S',
            provider: 'openai-compatible',
            hidden: false,
            contextWindow: 4000,
            outputTokenLimit: 1000,
            supportsThinking: false,
            settings: {
              temperature: 0.5,
              maxTokens: 1000,
              // No topP/topK
            },
          },
        ]),
      };

      loader.setDatabase(mockDb as any);
      const models = await loader.getAllModels('user-456');

      const simple = models.find((m) => m.id === 'simple-model');
      expect(simple).toBeDefined();
      expect(simple!.settings.topP).toBeUndefined();
      expect(simple!.settings.topK).toBeUndefined();
    });
  });

  describe('getModelsByProvider', () => {
    it('returns only models for the specified provider', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const anthropicModels = await loader.getModelsByProvider('anthropic');

      // 3 anthropic models in sample data (including hidden one)
      expect(anthropicModels).toHaveLength(3);
      expect(anthropicModels.every((m) => m.provider === 'anthropic')).toBe(true);
    });

    it('returns empty array for unknown provider', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const models = await loader.getModelsByProvider('nonexistent');

      expect(models).toEqual([]);
    });

    it('filters correctly for openrouter provider', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const openrouterModels = await loader.getModelsByProvider('openrouter');

      expect(openrouterModels).toHaveLength(1);
      expect(openrouterModels[0].id).toBe('gpt-4o');
    });
  });

  describe('getModelById', () => {
    it('returns the correct model by ID', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const model = await loader.getModelById('claude-opus-4.5');

      expect(model).not.toBeNull();
      expect(model!.displayName).toBe('Claude Opus 4.5');
      expect(model!.contextWindow).toBe(200000);
      expect(model!.outputTokenLimit).toBe(32000);
    });

    it('returns null for non-existent model ID', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const model = await loader.getModelById('nonexistent-model');

      expect(model).toBeNull();
    });

    it('can find user-defined models when userId and db are provided', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const mockDb = {
        getUserModels: vi.fn().mockResolvedValue([
          {
            id: 'user-custom',
            providerModelId: 'custom-v1',
            displayName: 'User Custom',
            shortName: 'UC',
            provider: 'openai-compatible',
            hidden: false,
            contextWindow: 8000,
            outputTokenLimit: 2000,
            supportsThinking: false,
            settings: { temperature: 0.7, maxTokens: 2000 },
          },
        ]),
      };
      loader.setDatabase(mockDb as any);

      const model = await loader.getModelById('user-custom', 'user-123');
      expect(model).not.toBeNull();
      expect(model!.displayName).toBe('User Custom');
    });
  });

  describe('getModelProvider', () => {
    it('returns the provider for a known model', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const provider = await loader.getModelProvider('gpt-4o');

      expect(provider).toBe('openrouter');
    });

    it('returns null for unknown model', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const provider = await loader.getModelProvider('nonexistent');

      expect(provider).toBeNull();
    });
  });

  describe('reloadModels', () => {
    it('picks up changes from disk after reload', async () => {
      const modelsPath = await writeModels(SAMPLE_MODELS);
      process.env.MODELS_CONFIG_PATH = modelsPath;

      const loader = await getNewModelLoader();
      const initial = await loader.loadModels();
      expect(initial).toHaveLength(4);

      // Write updated models file
      const updated = {
        models: [SAMPLE_MODELS.models[0]], // Only one model
      };
      await writeFile(modelsPath, JSON.stringify(updated));

      await loader.reloadModels();
      const reloaded = await loader.loadModels();
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0].id).toBe('claude-sonnet-4.5');
    });
  });

  describe('singleton pattern', () => {
    it('getInstance returns the same instance', async () => {
      const mod = await import('./model-loader.js');
      const a = mod.ModelLoader.getInstance();
      const b = mod.ModelLoader.getInstance();
      expect(a).toBe(b);
    });
  });
});
