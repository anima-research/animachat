import { readFile } from 'fs/promises';
import { join } from 'path';
import { AppConfig, ProviderProfile } from './types.js';

export class ConfigLoader {
  private static instance: ConfigLoader;
  private config: AppConfig | null = null;
  private configPath: string;
  private roundRobinIndexes: Map<string, number> = new Map();
  private usageCounts: Map<string, number> = new Map();

  private constructor() {
    // Look for config in these locations (in order):
    // 1. Environment variable CONFIG_PATH
    // 2. /etc/claude-app/config.json (production)
    // 3. ./config/config.json (development)
    this.configPath = process.env.CONFIG_PATH || 
      (process.env.NODE_ENV === 'production' 
        ? '/etc/claude-app/config.json'
        : join(process.cwd(), 'config', 'config.json'));
  }

  static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  async loadConfig(): Promise<AppConfig> {
    if (this.config) {
      return this.config;
    }

    try {
      const configData = await readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(configData) as AppConfig;
      console.log(`Loaded configuration from ${this.configPath}`);
      return this.config;
    } catch (error) {
      // Only warn in debug mode - config.json is optional
      if (process.env.LOG_DEBUG === 'true') {
        console.warn(`Failed to load config from ${this.configPath}:`, error);
      }
      // Return default config
      return this.getDefaultConfig();
    }
  }

  private getDefaultConfig(): AppConfig {
    return {
      providers: {},
      features: {
        allowUserApiKeys: true,
        enforceRateLimits: false,
        trackUsage: false,
        billUsers: false
      }
    };
  }

  /**
   * Get the best available profile for a provider and model
   * Considers user group, model compatibility, priority, and load balancing
   */
  async getBestProfile(
    provider: string,
    modelId: string,
    userGroup?: string
  ): Promise<ProviderProfile | null> {
    console.log(`[ConfigLoader] getBestProfile called with provider=${provider}, modelId=${modelId}, userGroup=${userGroup}`);
    
    const config = await this.loadConfig();
    const profiles = config.providers[provider as keyof typeof config.providers];
    
    if (!profiles || profiles.length === 0) {
      console.log(`[ConfigLoader] No profiles found for provider ${provider}`);
      return null;
    }
    
    console.log(`[ConfigLoader] Found ${profiles.length} profiles for provider ${provider}`);

    // Filter eligible profiles - need to use async filter
    const eligibleProfiles = [];
    for (const profile of profiles) {
      console.log(`[ConfigLoader] Checking profile ${profile.id}:`);
      
      // Check model compatibility
      // If allowedModels is specified, use it as explicit allow list
      if (profile.allowedModels && !profile.allowedModels.includes(modelId)) {
        console.log(`[ConfigLoader]   - Rejected: model ${modelId} not in allowedModels`);
        continue;
      }
      
      // If no allowedModels but modelCosts exists, check if model has cost configuration
      if (!profile.allowedModels && profile.modelCosts) {
        // Need to get the actual provider model ID for this model to check costs
        // The modelId passed here is the configuration ID, but costs are keyed by provider model ID
        const { ModelLoader } = await import('../config/model-loader.js');
        const modelLoader = ModelLoader.getInstance();
        const modelConfig = await modelLoader.getModelById(modelId);
        const providerModelId = modelConfig?.providerModelId || modelId;
        
        const hasModelCost = profile.modelCosts.some(mc => mc.modelId === providerModelId);
        if (!hasModelCost) {
          console.log(`[ConfigLoader]   - Rejected: no cost configuration for model ${modelId} (provider model ID: ${providerModelId})`);
          console.log(`[ConfigLoader]     Available model costs: ${profile.modelCosts.map(mc => mc.modelId).join(', ')}`);
          // No cost configuration for this model = not supported
          continue;
        }
      }
      
      // If neither allowedModels nor modelCosts specified, allow all models for this provider
      
      // Check user group
      if (profile.allowedUserGroups && userGroup && !profile.allowedUserGroups.includes(userGroup)) {
        console.log(`[ConfigLoader]   - Rejected: user group ${userGroup} not in allowedUserGroups`);
        continue;
      }
      
      console.log(`[ConfigLoader]   - Accepted`);
      eligibleProfiles.push(profile);
    }

    if (eligibleProfiles.length === 0) {
      console.log(`[ConfigLoader] No eligible profiles found`);
      return null;
    }

    // Sort by priority (lower number = higher priority)
    eligibleProfiles.sort((a, b) => a.priority - b.priority);

    // Find all profiles with the highest priority (lowest number)
    const highestPriority = eligibleProfiles[0].priority;
    const samePriorityProfiles = eligibleProfiles.filter(p => p.priority === highestPriority);

    // If only one profile with highest priority, return it
    if (samePriorityProfiles.length === 1) {
      return samePriorityProfiles[0];
    }

    // Apply load balancing strategy
    const strategy = config.loadBalancing?.strategy || 'random';
    return this.selectProfileByStrategy(provider, samePriorityProfiles, strategy);
  }

  private selectProfileByStrategy(
    provider: string,
    profiles: ProviderProfile[],
    strategy: string
  ): ProviderProfile {
    switch (strategy) {
      case 'first':
        // Always return the first profile
        return profiles[0];

      case 'round-robin':
        // Get current index for this provider
        const currentIndex = this.roundRobinIndexes.get(provider) || 0;
        const selectedProfile = profiles[currentIndex % profiles.length];
        
        // Update index for next time
        this.roundRobinIndexes.set(provider, (currentIndex + 1) % profiles.length);
        
        return selectedProfile;

      case 'least-used':
        // Find the profile with the least usage count
        let leastUsedProfile = profiles[0];
        let minUsage = this.usageCounts.get(profiles[0].id) || 0;
        
        for (const profile of profiles) {
          const usage = this.usageCounts.get(profile.id) || 0;
          if (usage < minUsage) {
            minUsage = usage;
            leastUsedProfile = profile;
          }
        }
        
        // Increment usage count
        this.usageCounts.set(leastUsedProfile.id, minUsage + 1);
        
        return leastUsedProfile;

      case 'random':
      default:
        // Random selection
        const randomIndex = Math.floor(Math.random() * profiles.length);
        return profiles[randomIndex];
    }
  }

  /**
   * Get all profiles for a provider
   */
  async getProviderProfiles(provider: string): Promise<ProviderProfile[]> {
    const config = await this.loadConfig();
    return config.providers[provider as keyof typeof config.providers] || [];
  }

  /**
   * Reload configuration from disk
   */
  async reloadConfig(): Promise<void> {
    this.config = null;
    await this.loadConfig();
  }
  
  /**
   * Get the default model for new conversations
   */
  async getDefaultModel(): Promise<string> {
    const config = await this.loadConfig();
    return config.defaultModel || 'claude-3-5-sonnet-20241022';
  }
}
