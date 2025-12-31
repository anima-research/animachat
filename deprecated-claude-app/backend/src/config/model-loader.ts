import { readFile } from 'fs/promises';
import { join } from 'path';
import { Model, UserDefinedModel } from '@deprecated-claude/shared';
import type { Database } from '../database/index.js';

export class ModelLoader {
  private static instance: ModelLoader;
  private models: Model[] | null = null;
  private modelConfigPath: string;
  private db: Database | null = null;

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
   * Get all available models, including user-defined models if userId provided
   */
  async getAllModels(userId?: string): Promise<Model[]> {
    const systemModels = await this.loadModels();
    
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
    } as Model));

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
    await this.loadModels();
  }
}
