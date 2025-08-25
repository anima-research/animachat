import { Message, MODELS, ConversationFormat, ModelSettings, Participant } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { BedrockService } from './bedrock.js';
import { AnthropicService } from './anthropic.js';

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
      const anthropicService = new AnthropicService(this.db, apiKey);
      
      await anthropicService.streamCompletion(
        modelId,
        formattedMessages,
        systemPrompt,
        settings,
        onChunk,
        stopSequences
      );
    } else if (model.provider === 'bedrock') {
      // Use Bedrock service (can use user's AWS keys or default)
      await this.bedrockService.streamCompletion(
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
