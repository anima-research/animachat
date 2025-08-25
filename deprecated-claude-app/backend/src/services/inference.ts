import { Message, MODELS } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { BedrockService } from './bedrock.js';
import { AnthropicService } from './anthropic.js';

interface ModelSettings {
  temperature: number;
  maxTokens: number;
  topP?: number;
  topK?: number;
}

export class InferenceService {
  private bedrockService: BedrockService;
  private anthropicService: AnthropicService;
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.bedrockService = new BedrockService(db);
    this.anthropicService = new AnthropicService(db);
  }

  async streamCompletion(
    modelId: string,
    messages: Message[],
    systemPrompt: string | undefined,
    settings: ModelSettings,
    userId: string,
    onChunk: (chunk: string, isComplete: boolean) => Promise<void>
  ): Promise<void> {
    // Find the model configuration
    const model = MODELS.find(m => m.id === modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    // Route to appropriate service based on provider
    if (model.provider === 'anthropic') {
      // Try to get user's Anthropic API key
      const apiKey = await this.getUserApiKey(userId, 'anthropic');
      const anthropicService = new AnthropicService(this.db, apiKey);
      
      await anthropicService.streamCompletion(
        modelId,
        messages,
        systemPrompt,
        settings,
        onChunk
      );
    } else if (model.provider === 'bedrock') {
      // Use Bedrock service (can use user's AWS keys or default)
      await this.bedrockService.streamCompletion(
        modelId,
        messages,
        systemPrompt,
        settings,
        onChunk
      );
    } else {
      throw new Error(`Unsupported provider: ${model.provider}`);
    }
  }

  private async getUserApiKey(userId: string, provider: string): Promise<string | undefined> {
    try {
      const apiKeys = await this.db.getUserApiKeys(userId);
      const key = apiKeys.find(k => k.provider === provider);
      return key?.key;
    } catch (error) {
      console.error('Error getting user API key:', error);
      return undefined;
    }
  }

  async validateApiKey(provider: string, apiKey: string): Promise<boolean> {
    if (provider === 'anthropic') {
      const anthropicService = new AnthropicService(this.db, apiKey);
      return anthropicService.validateApiKey(apiKey);
    } else if (provider === 'bedrock') {
      return this.bedrockService.validateApiKey(provider, apiKey);
    }
    
    return false;
  }
}
