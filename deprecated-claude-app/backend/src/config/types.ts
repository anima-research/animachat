/**
 * Configuration types for API provider profiles
 */

export interface ModelCost {
  modelId: string;
  // What we pay to the provider
  providerCost: {
    inputTokensPerMillion: number;
    outputTokensPerMillion: number;
  };
  // What we charge users (optional, defaults to providerCost if not specified)
  billedCost?: {
    inputTokensPerMillion: number;
    outputTokensPerMillion: number;
  };
}

export interface ApiKeyProfile {
  id: string;
  name: string;
  description?: string;
  priority: number; // Lower number = higher priority
  
  // Usage limits (optional)
  limits?: {
    requestsPerMinute?: number;
    requestsPerDay?: number;
    tokensPerMinute?: number;
    tokensPerDay?: number;
  };
  
  // Which models this profile can be used for
  allowedModels?: string[]; // If not specified, can be used for all models
  
  // Which user groups can use this profile
  allowedUserGroups?: string[]; // e.g., ['free', 'premium', 'enterprise']
  
  // Cost configuration per model
  modelCosts?: ModelCost[];
}

export interface AnthropicProfile extends ApiKeyProfile {
  provider: 'anthropic';
  credentials: {
    apiKey: string;
    baseUrl?: string; // For custom endpoints
  };
}

export interface BedrockProfile extends ApiKeyProfile {
  provider: 'bedrock';
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region: string;
  };
}

export interface OpenRouterProfile extends ApiKeyProfile {
  provider: 'openrouter';
  credentials: {
    apiKey: string;
    siteUrl?: string;
    siteName?: string;
  };
}

export interface OpenAICompatibleProfile extends ApiKeyProfile {
  provider: 'openai-compatible';
  credentials: {
    apiKey: string;
    baseUrl: string;
    modelPrefix?: string;
  };
}

export interface GoogleProfile extends ApiKeyProfile {
  provider: 'google';
  credentials: {
    apiKey: string;
    // Optional: for Vertex AI instead of Gemini API
    projectId?: string;
    location?: string;
  };
}

export type ProviderProfile = 
  | AnthropicProfile 
  | BedrockProfile 
  | OpenRouterProfile 
  | OpenAICompatibleProfile
  | GoogleProfile;

export interface ProvidersConfig {
  anthropic?: AnthropicProfile[];
  bedrock?: BedrockProfile[];
  openrouter?: OpenRouterProfile[];
  'openai-compatible'?: OpenAICompatibleProfile[];
  google?: GoogleProfile[];
}

export interface AppConfig {
  providers: ProvidersConfig;
  
  // Default profiles to use when user has no API key
  defaultProfiles?: {
    anthropic?: string; // profile ID
    bedrock?: string;
    openrouter?: string;
    'openai-compatible'?: string;
    google?: string;
  };
  
  // Default model for new conversations
  defaultModel?: string;
  
  // Feature flags
  features?: {
    allowUserApiKeys: boolean;
    enforceRateLimits: boolean;
    trackUsage: boolean;
    billUsers: boolean;
  };
  
  // Load balancing strategy for same-priority profiles
  loadBalancing?: {
    strategy: 'first' | 'random' | 'round-robin' | 'least-used';
    // For round-robin: tracks last used index per provider
    // For least-used: would need to track usage counts
  };
  
  // Suggested models for group chat quick access
  groupChatSuggestedModels?: string[]; // Model IDs to show in quick access bar
  
  // Currency definitions for credit grants
  currencies?: {
    [key: string]: {
      name: string;
      description: string;
    };
  };
}
