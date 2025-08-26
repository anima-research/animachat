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
      // Always include these common stop sequences
      const baseStopSequences = ['User:', 'A:', "Claude:"];
      // Add participant names as stop sequences
      const participantStopSequences = participants.map(p => `${p.name}:`);
      // Combine and deduplicate
      stopSequences = [...new Set([...baseStopSequences, ...participantStopSequences])];
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
      // Standard format - just log for debugging
      console.log('\n========== STANDARD FORMAT MESSAGES ==========');
      for (const message of messages) {
        const activeBranch = message.branches.find(b => b.id === message.activeBranchId);
        if (activeBranch) {
          const attachmentCount = activeBranch.attachments?.length || 0;
          console.log(`${activeBranch.role}: ${activeBranch.content.substring(0, 50)}... (${attachmentCount} attachments)`);
          if (attachmentCount > 0) {
            activeBranch.attachments?.forEach(att => {
              console.log(`  - ${att.fileName} (${att.content?.length || 0} chars)`);
            });
          }
        }
      }
      console.log('========== END STANDARD FORMAT ==========\n');
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
      let lastMessageWasEmptyAssistant = false;
      let lastAssistantName = 'Assistant';
      
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
        
        // Track if this is an empty assistant message
        if (activeBranch.role === 'assistant' && activeBranch.content === '') {
          lastMessageWasEmptyAssistant = true;
          lastAssistantName = participantName;
          continue; // Skip empty assistant messages
        }
        
        // Build the message content with attachments
        let messageContent = activeBranch.content;
        
        // Append attachments for user messages
        if (activeBranch.role === 'user' && activeBranch.attachments && activeBranch.attachments.length > 0) {
          console.log(`[PREFILL] Appending ${activeBranch.attachments.length} attachments to ${participantName}'s message`);
          for (const attachment of activeBranch.attachments) {
            // Check if it's an image
            const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
            const fileExtension = attachment.fileName?.split('.').pop()?.toLowerCase() || '';
            const isImage = imageExtensions.includes(fileExtension);
            
            if (isImage) {
              // For prefill format, we can't use image blocks, so describe it
              messageContent += `\n\n[Image attachment: ${attachment.fileName}]`;
              console.log(`[PREFILL] Added image reference: ${attachment.fileName}`);
            } else {
              // Add text attachments inline
              messageContent += `\n\n<attachment filename="${attachment.fileName}">\n${attachment.content}\n</attachment>`;
              console.log(`[PREFILL] Added text attachment: ${attachment.fileName} (${attachment.content.length} chars)`);
            }
          }
        }
        
        // Always use participant name format: "Name: content"
        conversationContent += `${participantName}: ${messageContent}\n\n`;
      }
      
      // If the last message was an empty assistant, append that assistant's name
      if (lastMessageWasEmptyAssistant) {
        conversationContent = conversationContent.trim() + `\n\n${lastAssistantName}:`;
      } else if (responderId && participants.length > 0) {
        // Otherwise, if we have a responder, append their name with a colon (no newline)
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
      
      // Debug log the full prefill prompt
      console.log('\n========== PREFILL PROMPT BEING SENT TO API ==========');
      console.log('User message:', cmdMessage.branches[0].content);
      console.log('Assistant prefill:');
      console.log(conversationContent);
      console.log('========== END PREFILL PROMPT ==========\n');
      
      return prefillMessages;
    }
    
    return messages;
  }
}
