import { readFile } from 'fs/promises';
import { join } from 'path';

interface ModelAccessConfig {
  modelAccess: {
    [modelId: string]: {
      allowedEmails: string[];
      denyMessage?: string;
    };
  };
  defaultAccess: 'allow' | 'deny';
  globalAdmins: string[];
}

export class ModelAccessService {
  private static instance: ModelAccessService;
  private config: ModelAccessConfig | null = null;
  private configPath: string;

  private constructor() {
    // Look for model-access config in the same location as other configs
    this.configPath = process.env.MODEL_ACCESS_CONFIG_PATH || 
      (process.env.NODE_ENV === 'production' 
        ? '/etc/claude-app/model-access.json'
        : join(process.cwd(), 'config', 'model-access.json'));
  }

  static getInstance(): ModelAccessService {
    if (!ModelAccessService.instance) {
      ModelAccessService.instance = new ModelAccessService();
    }
    return ModelAccessService.instance;
  }

  async loadConfig(): Promise<ModelAccessConfig> {
    if (this.config) {
      return this.config;
    }

    try {
      const configData = await readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(configData);
      console.log(`Loaded model access config from ${this.configPath}`);
      return this.config!;
    } catch (error) {
      console.warn(`Failed to load model access config from ${this.configPath}, using defaults:`, error);
      // Return default config if file doesn't exist
      this.config = {
        modelAccess: {},
        defaultAccess: 'allow',
        globalAdmins: []
      };
      return this.config;
    }
  }

  async checkModelAccess(modelId: string, userEmail: string): Promise<{ allowed: boolean; message?: string }> {
    const config = await this.loadConfig();

    // Global admins have access to all models
    if (config.globalAdmins.includes(userEmail)) {
      return { allowed: true };
    }

    // Check if model has specific access rules
    const modelRules = config.modelAccess[modelId];
    if (modelRules) {
      const allowed = modelRules.allowedEmails.includes(userEmail);
      if (!allowed) {
        return {
          allowed: false,
          message: modelRules.denyMessage || `Access to model ${modelId} is restricted.`
        };
      }
      return { allowed: true };
    }

    // No specific rules for this model, use default access
    return { allowed: config.defaultAccess === 'allow' };
  }

  async getAccessibleModels(userEmail: string, allModelIds: string[]): Promise<string[]> {
    const config = await this.loadConfig();

    // Global admins have access to all models
    if (config.globalAdmins.includes(userEmail)) {
      return allModelIds;
    }

    // Filter models based on access rules
    const accessibleModels: string[] = [];
    
    for (const modelId of allModelIds) {
      const access = await this.checkModelAccess(modelId, userEmail);
      if (access.allowed) {
        accessibleModels.push(modelId);
      }
    }

    return accessibleModels;
  }

  // Reload config from disk
  async reloadConfig(): Promise<void> {
    this.config = null;
    await this.loadConfig();
  }
}

