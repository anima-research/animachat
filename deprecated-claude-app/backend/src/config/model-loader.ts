import { readFile } from 'fs/promises';
import { join } from 'path';
import { Model } from '@deprecated-claude/shared';

export class ModelLoader {
  private static instance: ModelLoader;
  private models: Model[] | null = null;
  private modelConfigPath: string;

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

  async loadModels(): Promise<Model[]> {
    if (this.models) {
      return this.models;
    }

    try {
      const modelsData = await readFile(this.modelConfigPath, 'utf-8');
      const parsed = JSON.parse(modelsData);
      this.models = parsed.models || [];
      console.log(`Loaded ${this.models.length} models from ${this.modelConfigPath}`);
      return this.models;
    } catch (error) {
      console.error(`Failed to load models from ${this.modelConfigPath}:`, error);
      // Return empty array as fallback
      return [];
    }
  }

  /**
   * Get all available models
   */
  async getAllModels(): Promise<Model[]> {
    return this.loadModels();
  }

  /**
   * Get models for a specific provider
   */
  async getModelsByProvider(provider: string): Promise<Model[]> {
    const models = await this.loadModels();
    return models.filter(m => m.provider === provider);
  }

  /**
   * Get a specific model by ID
   */
  async getModelById(modelId: string): Promise<Model | null> {
    const models = await this.loadModels();
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
   * Get only active (non-deprecated) models
   */
  async getActiveModels(): Promise<Model[]> {
    const models = await this.loadModels();
    return models.filter(m => !m.deprecated);
  }

  /**
   * Reload models from disk
   */
  async reloadModels(): Promise<void> {
    this.models = null;
    await this.loadModels();
  }
}
