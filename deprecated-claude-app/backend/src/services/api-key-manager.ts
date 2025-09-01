import { Database } from '../database/index.js';
import { ConfigLoader } from '../config/loader.js';
import { ProviderProfile, ModelCost } from '../config/types.js';
import { ApiKey } from '@deprecated-claude/shared';

export interface SelectedApiKey {
  source: 'user' | 'config';
  credentials: any;
  profile?: ProviderProfile;
  userKey?: ApiKey;
}

export class ApiKeyManager {
  private configLoader: ConfigLoader;
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.configLoader = ConfigLoader.getInstance();
  }

  /**
   * Get the best available API key for a request
   * Priority:
   * 1. User's personal API key (if allowed and available)
   * 2. System API key from config based on user tier and model
   * 3. Environment variable fallback
   */
  async getApiKeyForRequest(
    userId: string,
    provider: string,
    modelId: string
  ): Promise<SelectedApiKey | null> {
    console.log(`[ApiKeyManager] Getting API key for: provider=${provider}, modelId=${modelId}, userId=${userId}`);
    
    const config = await this.configLoader.loadConfig();
    
    // Check if user API keys are allowed
    if (config.features?.allowUserApiKeys) {
      console.log('[ApiKeyManager] Checking for user API key (allowUserApiKeys=true)');
      const userKey = await this.getUserApiKey(userId, provider);
      if (userKey) {
        console.log('[ApiKeyManager] Found user API key, using it');
        return {
          source: 'user',
          credentials: userKey.credentials,
          userKey
        };
      }
      console.log('[ApiKeyManager] No user API key found');
    } else {
      console.log('[ApiKeyManager] User API keys not allowed (allowUserApiKeys=false or not set)');
    }

    // Get user info to determine tier/groups
    const user = await this.db.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // TODO: When we have the PostgreSQL database, we'll get the user's groups
    // For now, we'll use a simple mapping based on some user property
    const userGroup = this.getUserGroup(user);
    console.log(`[ApiKeyManager] User group: ${userGroup}`);

    // Try to find a suitable system API key profile
    const profile = await this.configLoader.getBestProfile(provider, modelId, userGroup);
    if (profile) {
      const keyInfo = 'apiKey' in profile.credentials 
        ? `API key ending in ...${profile.credentials.apiKey?.slice(-8)}`
        : `AWS credentials`;
      console.log(`[ApiKeyManager] Found config profile: ${profile.id} with ${keyInfo}`);
      return {
        source: 'config',
        credentials: profile.credentials,
        profile
      };
    }
    console.log('[ApiKeyManager] No suitable config profile found');

    // Fallback to environment variables
    console.log('[ApiKeyManager] Falling back to environment variables');
    const envKey = this.getEnvApiKey(provider);
    if (envKey) {
      const keyInfo = 'apiKey' in envKey.credentials 
        ? `API key ending in ...${envKey.credentials.apiKey?.slice(-8)}`
        : `AWS credentials`;
      console.log(`[ApiKeyManager] Using environment variable ${keyInfo}`);
    } else {
      console.log('[ApiKeyManager] No environment variable API key found');
    }
    return envKey;
  }

  private async getUserApiKey(userId: string, provider: string): Promise<ApiKey | null> {
    try {
      const apiKeys = await this.db.getUserApiKeys(userId);
      return apiKeys.find(k => k.provider === provider) || null;
    } catch (error) {
      console.error('Error getting user API key:', error);
      return null;
    }
  }

  private getUserGroup(user: any): string {
    // TODO: Replace with actual user tier/group lookup from PostgreSQL
    // For now, return a default group
    return 'free';
  }

  private getEnvApiKey(provider: string): SelectedApiKey | null {
    switch (provider) {
      case 'anthropic':
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        return anthropicKey ? {
          source: 'config',
          credentials: { apiKey: anthropicKey }
        } : null;

      case 'bedrock':
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
          return {
            source: 'config',
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
              sessionToken: process.env.AWS_SESSION_TOKEN,
              region: process.env.AWS_REGION || 'us-east-1'
            }
          };
        }
        return null;

      case 'openrouter':
        const openrouterKey = process.env.OPENROUTER_API_KEY;
        return openrouterKey ? {
          source: 'config',
          credentials: { apiKey: openrouterKey }
        } : null;

      case 'openai-compatible':
        const openaiKey = process.env.OPENAI_API_KEY;
        return openaiKey ? {
          source: 'config',
          credentials: {
            apiKey: openaiKey,
            baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
          }
        } : null;

      default:
        return null;
    }
  }

  /**
   * Check if rate limits allow this request
   * Returns true if allowed, false if rate limited
   */
  async checkRateLimits(
    userId: string,
    provider: string,
    profile?: ProviderProfile
  ): Promise<{ allowed: boolean; retryAfter?: number }> {
    const config = await this.configLoader.loadConfig();
    
    if (!config.features?.enforceRateLimits || !profile?.limits) {
      return { allowed: true };
    }

    // TODO: Implement actual rate limit checking against PostgreSQL
    // For now, always allow
    return { allowed: true };
  }

  /**
   * Track usage for billing and rate limiting
   */
  async trackUsage(
    userId: string,
    provider: string,
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    profile?: ProviderProfile,
    conversationId?: string,
    messageId?: string
  ): Promise<void> {
    const config = await this.configLoader.loadConfig();
    
    if (!config.features?.trackUsage) {
      return;
    }

    // Calculate costs
    let providerInputCost = 0;
    let providerOutputCost = 0;
    let billedInputCost = 0;
    let billedOutputCost = 0;
    
    if (profile?.modelCosts) {
      const modelCost = profile.modelCosts.find(mc => mc.modelId === modelId);
      
      if (modelCost) {
        // Provider cost (what we pay)
        providerInputCost = (inputTokens / 1_000_000) * modelCost.providerCost.inputTokensPerMillion;
        providerOutputCost = (outputTokens / 1_000_000) * modelCost.providerCost.outputTokensPerMillion;
        
        // Billed cost (what user pays) - defaults to provider cost if not specified
        const billedRates = modelCost.billedCost || modelCost.providerCost;
        billedInputCost = (inputTokens / 1_000_000) * billedRates.inputTokensPerMillion;
        billedOutputCost = (outputTokens / 1_000_000) * billedRates.outputTokensPerMillion;
      }
    }

    // TODO: Write to PostgreSQL usage_logs table
    console.log('Usage tracked:', {
      userId,
      provider,
      modelId,
      profileId: profile?.id,
      inputTokens,
      outputTokens,
      costs: {
        provider: {
          input: providerInputCost,
          output: providerOutputCost,
          total: providerInputCost + providerOutputCost
        },
        billed: {
          input: billedInputCost,
          output: billedOutputCost,
          total: billedInputCost + billedOutputCost
        },
        margin: (billedInputCost + billedOutputCost) - (providerInputCost + providerOutputCost)
      }
    });
  }

  /**
   * Get cost information for a specific model and profile
   */
  getCostForModel(profile: ProviderProfile, modelId: string): ModelCost | null {
    if (!profile.modelCosts) {
      return null;
    }
    
    return profile.modelCosts.find(mc => mc.modelId === modelId) || null;
  }
}
