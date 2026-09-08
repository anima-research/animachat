import { readFile } from 'fs/promises';
import { join } from 'path';
import { Model, UserDefinedModel } from '@deprecated-claude/shared';
import type { Database } from '../database/index.js';
import { getOpenRouterModelsCache } from '../services/pricing-cache.js';

// Effort levels OpenRouter's unified `reasoning.effort` accepts. Used for
// models whose entry does not declare its own levels.
const OPENROUTER_EFFORT_LEVELS = ['low', 'medium', 'high'];
// OpenRouter ids of model families whose reasoning cannot be disabled
// (OpenAI's o-series and GPT-5 line). The catalogue does not expose this.
const REASONING_ONLY_MODEL = /^openai\/(o[0-9]|gpt-5)/;

export class ModelLoader {
  private static instance: ModelLoader;
  private models: Model[] | null = null;
  private modelConfigPath: string;
  private db: Database | null = null;
  // System models enriched from the OpenRouter catalogue, keyed by the
  // catalogue snapshot they were derived from.
  private enrichedSystemModels: Model[] | null = null;
  private enrichedFromCacheTime = -1;
  private enrichmentLogged = new Set<string>();

  private constructor() {
    // Look for models config in these locations (in order):
    // 1. Environment variable MODELS_CONFIG_PATH
    // 2. Same directory as main config
    this.modelConfigPath = process.env.MODELS_CONFIG_PATH || 
      (process.env.NODE_ENV === 'production' 
        ? '/etc/claude-app/models.json'
        : join(process.cwd(), 'config', 'models.json'));
  }

  static getInstance(): ModelLoader {
    if (!ModelLoader.instance) {
      ModelLoader.instance = new ModelLoader();
    }
    return ModelLoader.instance;
  }

  setDatabase(db: Database): void {
    this.db = db;
  }

  async loadModels(): Promise<Model[]> {
    if (this.models) {
      return this.models;
    }

    try {
      const modelsData = await readFile(this.modelConfigPath, 'utf-8');
      const parsed = JSON.parse(modelsData);
      this.models = parsed.models || [];
      console.log(`Loaded ${this.models?.length || 0} models from ${this.modelConfigPath}`);
      return this.models || [];
    } catch (error) {
      console.error(`Failed to load models from ${this.modelConfigPath}:`, error);
      // Return empty array as fallback
      return [];
    }
  }

  /**
   * Fill in what the OpenRouter catalogue knows about an OpenRouter-routed
   * model: context window, output limit, and whether the provider accepts the
   * `reasoning` parameter (which drives the thinking toggle and effort levels
   * in the UI). Hand-maintained values in models.json are only replaced when
   * the catalogue reports something different, and each change is logged once.
   */
  /**
   * Fill a model entry from the OpenRouter catalogue.
   *
   * `authoritative` (system entries from models.json): the catalogue wins for
   * context window, output limit and reasoning support, since those drift as
   * providers update models.
   * `fill` (user-defined models): only blanks are filled and the owner's own
   * limits and "supports thinking" choice are kept, so a catalogue refresh
   * never silently changes a custom model.
   */
  private enrichFromOpenRouter(model: Model, mode: 'authoritative' | 'fill' = 'authoritative'): Model {
    if (model.provider !== 'openrouter') return model;
    const cache = getOpenRouterModelsCache();
    if (!cache.models.length) return model;
    const entry = cache.models.find((m: any) => m?.id === model.providerModelId);
    if (!entry) return model;

    const enriched: Model = { ...model, settings: { ...model.settings, maxTokens: { ...model.settings.maxTokens } } };
    const changes: string[] = [];

    const fillOnly = mode === 'fill';
    const contextLength = Number(entry.context_length);
    if (Number.isFinite(contextLength) && contextLength > 0 && contextLength !== model.contextWindow && !(fillOnly && model.contextWindow)) {
      enriched.contextWindow = contextLength;
      changes.push(`contextWindow ${model.contextWindow} → ${contextLength}`);
    }
    const outputLimit = Number(entry.top_provider?.max_completion_tokens);
    if (Number.isFinite(outputLimit) && outputLimit > 0 && outputLimit !== model.outputTokenLimit && !(fillOnly && model.outputTokenLimit)) {
      enriched.outputTokenLimit = outputLimit;
      enriched.settings.maxTokens.max = outputLimit;
      // Max tokens defaults to the output limit (see getValidatedModelDefaults).
      enriched.settings.maxTokens.default = outputLimit;
      changes.push(`outputTokenLimit ${model.outputTokenLimit} → ${outputLimit}`);
    }
    const supported: unknown = entry.supported_parameters;
    if (Array.isArray(supported)) {
      const catalogueReasoning = supported.includes('reasoning');
      // A user-defined model keeps the owner's explicit choice.
      const reasoning = fillOnly && typeof model.supportsThinking === 'boolean'
        ? model.supportsThinking
        : catalogueReasoning;
      if (reasoning !== !!model.supportsThinking) {
        enriched.supportsThinking = reasoning;
        changes.push(`supportsThinking ${!!model.supportsThinking} → ${reasoning}`);
      }
      if (reasoning) {
        if (!enriched.thinkingApi) {
          // Reasoning-only families cannot switch thinking off; mark them
          // always-on so it defaults to enabled and the toggle is hidden.
          enriched.thinkingApi = REASONING_ONLY_MODEL.test(model.providerModelId) ? 'always-on' : 'adaptive';
          changes.push(`thinkingApi ${enriched.thinkingApi}`);
        }
        if (!enriched.effortLevels?.length) {
          enriched.effortLevels = OPENROUTER_EFFORT_LEVELS;
          enriched.effortDefault = enriched.effortDefault ?? 'medium';
          changes.push('effortLevels from catalogue');
        }
      }
    }

    if (changes.length && !this.enrichmentLogged.has(model.id)) {
      this.enrichmentLogged.add(model.id);
      console.log(`[ModelLoader] OpenRouter catalogue updated ${model.id}: ${changes.join(', ')}`);
    }
    return changes.length ? enriched : model;
  }

  /**
   * Get all available models, including user-defined models if userId provided
   */
  async getAllModels(userId?: string): Promise<Model[]> {
    const rawSystemModels = await this.loadModels();
    const cache = getOpenRouterModelsCache();
    if (!this.enrichedSystemModels || this.enrichedFromCacheTime !== cache.cacheTime) {
      this.enrichedSystemModels = rawSystemModels.map(m => this.enrichFromOpenRouter(m));
      this.enrichedFromCacheTime = cache.cacheTime;
    }
    const systemModels = this.enrichedSystemModels;
    
    if (!userId || !this.db) {
      return systemModels;
    }

    // Get user's custom models and convert to Model format
    const userModels = await this.db.getUserModels(userId);
    const userModelsAsModels: Model[] = userModels.map((um: UserDefinedModel) => ({
      id: um.id,
      providerModelId: um.providerModelId,
      displayName: um.displayName,
      shortName: um.shortName,
      provider: um.provider,
      hidden: um.hidden,
      contextWindow: um.contextWindow,
      outputTokenLimit: um.outputTokenLimit,
      supportsThinking: um.supportsThinking,
      // User-defined models always accept general credits
      currencies: { credit: true },
      // Include auto-detected capabilities
      capabilities: um.capabilities,
      settings: {
        temperature: {
          min: 0,
          max: 2,
          default: um.settings.temperature,
          step: 0.1
        },
        maxTokens: {
          min: 1,
          max: um.outputTokenLimit,
          default: um.settings.maxTokens
        },
        topP: um.settings.topP ? {
          min: 0,
          max: 1,
          default: um.settings.topP,
          step: 0.01
        } : undefined,
        topK: um.settings.topK ? {
          min: 1,
          max: 500,
          default: um.settings.topK,
          step: 1
        } : undefined
      },
      // Preserve customEndpoint for OpenAI-compatible models
      ...(um.customEndpoint ? { customEndpoint: um.customEndpoint } : {})
    } as Model)).map(m => this.enrichFromOpenRouter(m, 'fill'));

    return [...systemModels, ...userModelsAsModels];
  }

  /**
   * Get models for a specific provider
   */
  async getModelsByProvider(provider: string): Promise<Model[]> {
    const models = await this.loadModels();
    return models.filter(m => m.provider === provider);
  }

  /**
   * Get a specific model by ID (checks both system and user models)
   */
  async getModelById(modelId: string, userId?: string): Promise<Model | null> {
    const models = await this.getAllModels(userId);
    return models.find(m => m.id === modelId) || null;
  }

  /**
   * Check if a model exists and get its provider
   */
  async getModelProvider(modelId: string): Promise<string | null> {
    const model = await this.getModelById(modelId);
    return model?.provider || null;
  }

  /**
   * Reload models from disk
   */
  async reloadModels(): Promise<void> {
    this.models = null;
    this.enrichedSystemModels = null;
    await this.loadModels();
  }
}
