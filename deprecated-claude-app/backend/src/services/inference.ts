import { Message, MODELS, ConversationFormat, ModelSettings, Participant, ApiKey, TokenUsage } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { BedrockService } from './bedrock.js';
import { AnthropicService } from './anthropic.js';
import { OpenRouterService } from './openrouter.js';
import { OpenAICompatibleService } from './openai-compatible.js';

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
    onChunk: (chunk: string, isComplete: boolean) => Promise<void>,
    format: ConversationFormat = 'standard',
    participants: Participant[] = [],
    responderId?: string
  ): Promise<void> {
    
    // Find the model configuration
    const model = MODELS.find(m => m.id === modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }
    
    // Format messages based on conversation format
    const formattedMessages = this.formatMessagesForConversation(messages, format, participants, responderId);

    // Build stop sequences for prefill/colon formats
    let stopSequences: string[] | undefined;
    if (format === 'prefill') {
      stopSequences = participants.map(p => `${p.name}:`);
    }

    // Route to appropriate service based on provider
    if (model.provider === 'anthropic') {
      // Try to get user's Anthropic API key
      const apiKey = await this.getUserApiKey(userId, 'anthropic');
      const apiKeyStr = apiKey && 'apiKey' in apiKey.credentials ? apiKey.credentials.apiKey : undefined;
      const anthropicService = new AnthropicService(this.db, apiKeyStr);
      
      await anthropicService.streamCompletion(
        modelId,
        formattedMessages,
        systemPrompt,
        settings,
        onChunk,
        stopSequences
      );
    } else if (model.provider === 'bedrock') {
      // Try to get user's Bedrock credentials
      const apiKey = await this.getUserApiKey(userId, 'bedrock');
      if (apiKey && 'accessKeyId' in apiKey.credentials) {
        // Use user credentials
        const bedrockService = new BedrockService(this.db, apiKey.credentials);
        await bedrockService.streamCompletion(
          modelId,
          formattedMessages,
          systemPrompt,
          settings,
          onChunk,
          stopSequences
        );
      } else {
        // Fall back to system credentials
        await this.bedrockService.streamCompletion(
          modelId,
          formattedMessages,
          systemPrompt,
          settings,
          onChunk,
          stopSequences
        );
      }
    } else if (model.provider === 'openrouter') {
      // Try to get user's OpenRouter API key
      const apiKey = await this.getUserApiKey(userId, 'openrouter');
      const apiKeyStr = apiKey && 'apiKey' in apiKey.credentials ? apiKey.credentials.apiKey : undefined;
      const openRouterService = new OpenRouterService(this.db, apiKeyStr);
      
      await openRouterService.streamCompletion(
        modelId,
        formattedMessages,
        systemPrompt,
        settings,
        onChunk,
        stopSequences
      );
    } else if (model.provider === 'openai-compatible') {
      // OpenAI-compatible APIs require user credentials
      const apiKey = await this.getUserApiKey(userId, 'openai-compatible');
      if (!apiKey || !('apiKey' in apiKey.credentials) || !('baseUrl' in apiKey.credentials)) {
        throw new Error('OpenAI-compatible API requires API key and base URL');
      }
      
      const openAIService = new OpenAICompatibleService(
        this.db,
        apiKey.credentials.apiKey,
        apiKey.credentials.baseUrl,
        apiKey.credentials.modelPrefix
      );
      
      await openAIService.streamCompletion(
        modelId,
        formattedMessages,
        systemPrompt,
        settings,
        onChunk,
        stopSequences
      );
    } else {
      throw new Error(`Unsupported provider: ${model.provider}`);
    }
  }

  private async getUserApiKey(userId: string, provider: string): Promise<ApiKey | undefined> {
    try {
      const apiKeys = await this.db.getUserApiKeys(userId);
      const key = apiKeys.find(k => k.provider === provider);
      return key;
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
  
  private formatMessagesForConversation(
    messages: Message[],
    format: ConversationFormat,
    participants: Participant[],
    responderId?: string
  ): Message[] {
    if (format === 'standard') {
      // Standard format - no changes needed
      return messages;
    }
    
    if (format === 'prefill') {
      // Convert to prefill format with participant names
      const prefillMessages: Message[] = [];
      
      // Add the hardcoded user message for prefill
      const cmdMessage: Message = {
        id: 'prefill-cmd',
        conversationId: messages[0]?.conversationId || '',
        branches: [{
          id: 'prefill-cmd-branch',
          content: '<cmd>cat untitled.log</cmd>',
          role: 'user',
          createdAt: new Date(),
          isActive: true,
          parentBranchId: 'root'
        }],
        activeBranchId: 'prefill-cmd-branch',
        order: 0
      };
      prefillMessages.push(cmdMessage);
      
      // Build the conversation content with participant names
      let conversationContent = '';
      
      for (const message of messages) {
        const activeBranch = message.branches.find(b => b.id === message.activeBranchId);
        if (!activeBranch) continue;
        
        // Find participant name
        let participantName = activeBranch.role === 'user' ? 'User' : 'Assistant';
        if (activeBranch.participantId) {
          const participant = participants.find(p => p.id === activeBranch.participantId);
          if (participant) {
            participantName = participant.name;
          }
        }
        
        // Always use participant name format: "Name: content"
        conversationContent += `${participantName}: ${activeBranch.content}\n\n`;
      }
      
      // If we have a responder, append their name with a colon (no newline)
      if (responderId && participants.length > 0) {
        const responder = participants.find(p => p.id === responderId);
        if (responder) {
          conversationContent = conversationContent.trim() + `\n\n${responder.name}:`;
        }
      }
      
      
      // Create assistant message with the conversation content
      const assistantMessage: Message = {
        id: 'prefill-assistant',
        conversationId: messages[0]?.conversationId || '',
        branches: [{
          id: 'prefill-assistant-branch',
          content: conversationContent,
          role: 'assistant',
          createdAt: new Date(),
          isActive: true,
          parentBranchId: 'prefill-cmd-branch'
        }],
        activeBranchId: 'prefill-assistant-branch',
        order: 1
      };
      prefillMessages.push(assistantMessage);
      
      return prefillMessages;
    }
    
    return messages;
  }
}
