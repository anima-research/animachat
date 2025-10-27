import { Message, ConversationFormat, ModelSettings, Participant, ApiKey, TokenUsage, Conversation } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { BedrockService } from './bedrock.js';
import { AnthropicService } from './anthropic.js';
import { OpenRouterService } from './openrouter.js';
import { OpenAICompatibleService } from './openai-compatible.js';
import { ApiKeyManager } from './api-key-manager.js';
import { ModelLoader } from '../config/model-loader.js';

// Internal format type that includes 'messages' mode
type InternalConversationFormat = ConversationFormat | 'messages';

export class InferenceService {
  private bedrockService: BedrockService;
  private anthropicService: AnthropicService;
  private apiKeyManager: ApiKeyManager;
  private modelLoader: ModelLoader;
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.apiKeyManager = new ApiKeyManager(db);
    this.modelLoader = ModelLoader.getInstance();
    this.bedrockService = new BedrockService(db);
    this.anthropicService = new AnthropicService(db);
  }

  /**
   * Build the prompt exactly as it would be sent to the API
   * Returns the formatted messages array that would be sent to the provider
   */
  async buildPrompt(
    modelId: string,
    messages: Message[],
    systemPrompt: string | undefined,
    format: ConversationFormat = 'standard',
    participants: Participant[] = [],
    responderId?: string,
    conversation?: Conversation
  ): Promise<{ messages: any[], systemPrompt?: string, provider: string, modelId: string }> {
    // Find the model configuration
    const model = await this.modelLoader.getModelById(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }
    
    // Determine the actual format to use
    let actualFormat: InternalConversationFormat = format;
    if (format === 'prefill') {
      if (!this.providerSupportsPrefill(model.provider)) {
        actualFormat = 'messages';
      }
    }
    
    // Format messages based on conversation format
    const formattedMessages = this.formatMessagesForConversation(messages, actualFormat, participants, responderId, model.provider, conversation);
    
    // Now format for the specific provider
    let apiMessages: any[];
    let apiSystemPrompt: string | undefined = systemPrompt;
    
    switch (model.provider) {
      case 'anthropic':
        apiMessages = this.anthropicService.formatMessagesForAnthropic(formattedMessages);
        break;
      case 'bedrock':
        apiMessages = this.bedrockService.formatMessagesForClaude(formattedMessages);
        break;
      case 'openai-compatible':
        // For prompt building, we don't need actual API keys, just format the messages
        const openAIService = new OpenAICompatibleService(
          this.db,
          'dummy-key', // Not used for formatting
          'http://localhost:11434',
          undefined
        );
        apiMessages = openAIService.formatMessagesForOpenAI(formattedMessages, systemPrompt);
        apiSystemPrompt = undefined; // System prompt is included in messages for OpenAI
        break;
      case 'openrouter':
        // For prompt building, we don't need actual API keys, just format the messages
        const openRouterService = new OpenRouterService(this.db, undefined);
        apiMessages = openRouterService.formatMessagesForOpenRouter(formattedMessages, systemPrompt);
        apiSystemPrompt = undefined; // System prompt is included in messages for OpenRouter
        break;
      default:
        throw new Error(`Unknown provider: ${model.provider}`);
    }
    
    return {
      messages: apiMessages,
      systemPrompt: apiSystemPrompt,
      provider: model.provider,
      modelId: model.providerModelId
    };
  }

  async streamCompletion(
    modelId: string,
    messages: Message[],
    systemPrompt: string | undefined,
    settings: ModelSettings,
    userId: string,
    onChunk: (chunk: string, isComplete: boolean, contentBlocks?: any[]) => Promise<void>,
    format: ConversationFormat = 'standard',
    participants: Participant[] = [],
    responderId?: string,
    conversation?: Conversation
  ): Promise<void> {
    
    // Find the model configuration
    console.log(`[InferenceService] Looking up model with ID: ${modelId}`);
    const model = await this.modelLoader.getModelById(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }
    console.log(`[InferenceService] Found model: provider=${model.provider}, providerModelId=${model.providerModelId}`)
    
    // Determine the actual format to use
    let actualFormat: InternalConversationFormat = format;
    if (format === 'prefill') {
      // Only switch to messages mode if the provider doesn't support prefill
      // Otherwise, always respect the user's choice of prefill format
      if (!this.providerSupportsPrefill(model.provider)) {
        console.log(`[InferenceService] Provider ${model.provider} doesn't support prefill, switching to messages mode`);
        actualFormat = 'messages';
      }
    }
    
    // Format messages based on conversation format
    const formattedMessages = this.formatMessagesForConversation(messages, actualFormat, participants, responderId, model.provider, conversation);

    // Build stop sequences for prefill/messages formats
    let stopSequences: string[] | undefined;
    if (actualFormat === 'prefill' || actualFormat === 'messages') {
      // Always include these common stop sequences
      const baseStopSequences = ['User:', 'A:', "Claude:"];
      // Add participant names as stop sequences (excluding empty names for raw continuation)
      const participantStopSequences = participants
        .filter(p => p.name !== '') // Exclude empty names
        .map(p => `${p.name}:`);
      // Combine and deduplicate
      stopSequences = [...new Set([...baseStopSequences, ...participantStopSequences])];
    }

    // Route to appropriate service based on provider
    // Get API key configuration
    const selectedKey = await this.apiKeyManager.getApiKeyForRequest(userId, model.provider, modelId);
    if (!selectedKey) {
      throw new Error(`No API key available for provider: ${model.provider}`);
    }

    // Check rate limits if using system key
    if (selectedKey.source === 'config' && selectedKey.profile) {
      const rateLimitCheck = await this.apiKeyManager.checkRateLimits(userId, model.provider, selectedKey.profile);
      if (!rateLimitCheck.allowed) {
        throw new Error(`Rate limit exceeded. Try again in ${rateLimitCheck.retryAfter} seconds.`);
      }
    }

    // Track token usage
    let inputTokens = 0;
    let outputTokens = 0;
    const trackingOnChunk = async (chunk: string, isComplete: boolean, contentBlocks?: any[]) => {
      await onChunk(chunk, isComplete, contentBlocks);
      // TODO: Implement accurate token counting
      outputTokens += chunk.length / 4; // Rough estimate
    };
    
    // Wrap chunk handler for messages mode to strip participant names
    const finalOnChunk = actualFormat === 'messages' 
      ? this.createMessagesModeChunkHandler(trackingOnChunk, participants, responderId)
      : trackingOnChunk;

    if (model.provider === 'anthropic') {
      const anthropicService = new AnthropicService(
        this.db, 
        selectedKey.credentials.apiKey
      );
      
      await anthropicService.streamCompletion(
        model.providerModelId,
        formattedMessages,
        systemPrompt,
        settings,
        finalOnChunk,
        stopSequences
      );
    } else if (model.provider === 'bedrock') {
      const bedrockService = new BedrockService(this.db, selectedKey.credentials);
      await bedrockService.streamCompletion(
        model.providerModelId,
        formattedMessages,
        systemPrompt,
        settings,
        finalOnChunk,
        stopSequences
      );
    } else if (model.provider === 'openrouter') {
      const openRouterService = new OpenRouterService(
        this.db, 
        selectedKey.credentials.apiKey
      );
      
      await openRouterService.streamCompletion(
        model.providerModelId,
        formattedMessages,
        systemPrompt,
        settings,
        finalOnChunk,
        stopSequences
      );
    } else if (model.provider === 'openai-compatible') {
      const openAIService = new OpenAICompatibleService(
        this.db,
        selectedKey.credentials.apiKey,
        selectedKey.credentials.baseUrl,
        selectedKey.credentials.modelPrefix
      );
      
      await openAIService.streamCompletion(
        model.providerModelId,
        formattedMessages,
        systemPrompt,
        settings,
        finalOnChunk,
        stopSequences
      );
    } else {
      throw new Error(`Unsupported provider: ${model.provider}`);
    }

    // TODO: Get accurate token counts from the service
    inputTokens = this.estimateTokens(formattedMessages);

    // Track usage after completion
    if (selectedKey.source === 'config' && selectedKey.profile) {
      await this.apiKeyManager.trackUsage(
        userId,
        model.provider,
        modelId,
        inputTokens,
        outputTokens,
        selectedKey.profile
      );
    }
  }

  private estimateTokens(messages: Message[]): number {
    // Rough token estimation
    const text = messages.map(m => {
      const activeBranch = m.branches.find(b => b.id === m.activeBranchId);
      return activeBranch?.content || '';
    }).join(' ');
    return Math.ceil(text.length / 4);
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
    format: InternalConversationFormat,
    participants: Participant[],
    responderId?: string,
    provider?: string,
    conversation?: Conversation
  ): Message[] {
    if (format === 'standard') {
      // Standard format - pass through as-is
      return messages;
    }
    
    if (format === 'prefill') {
      // Convert to prefill format with participant names
      const prefillMessages: Message[] = [];
      
      // Add initial user message if configured
      const prefillSettings = conversation?.prefillUserMessage || { enabled: true, content: '<cmd>cat untitled.log</cmd>' };
      
      if (prefillSettings.enabled) {
        const cmdMessage: Message = {
          id: 'prefill-cmd',
          conversationId: messages[0]?.conversationId || '',
          branches: [{
            id: 'prefill-cmd-branch',
            content: prefillSettings.content,
            role: 'user',
            createdAt: new Date(),
            isActive: true,
            parentBranchId: 'root'
          }],
          activeBranchId: 'prefill-cmd-branch',
          order: 0
        };
        prefillMessages.push(cmdMessage);
      }
      
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
        
        // If participant has no name (raw continuation), don't add prefix
        if (participantName === '') {
          conversationContent += `${messageContent}`;
        } else {
          // Use participant name format: "Name: content"
          conversationContent += `${participantName}: ${messageContent}\n\n`;
        }
      }
      
      // If the last message was an empty assistant, append that assistant's name
      if (lastMessageWasEmptyAssistant) {
        // If the assistant has no name (raw continuation), don't add any prefix
        if (lastAssistantName === '') {
          conversationContent = conversationContent.trim();
        } else {
          conversationContent = conversationContent.trim() + `\n\n${lastAssistantName}:`;
        }
      } else if (responderId && participants.length > 0) {
        // Otherwise, if we have a responder, append their name with a colon (no newline)
        const responder = participants.find(p => p.id === responderId);
        if (responder) {
          // If responder has no name (raw continuation), don't add any prefix
          if (responder.name === '') {
            conversationContent = conversationContent.trim();
          } else {
            conversationContent = conversationContent.trim() + `\n\n${responder.name}:`;
          }
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
    
    if (format === 'messages') {
      // Messages mode - format for providers that don't support prefill
      const messagesFormatted: Message[] = [];
      
      // Find the responder
      let responderName = 'Assistant';
      let responderParticipantId: string | undefined;
      if (responderId) {
        const responder = participants.find(p => p.id === responderId);
        if (responder) {
          responderName = responder.name;
          responderParticipantId = responder.id;
        }
      }
      
      for (const message of messages) {
        const activeBranch = message.branches.find(b => b.id === message.activeBranchId);
        if (!activeBranch || activeBranch.content === '') continue;
        
        // Find participant name
        let participantName = activeBranch.role === 'user' ? 'User' : 'Assistant';
        if (activeBranch.participantId) {
          const participant = participants.find(p => p.id === activeBranch.participantId);
          if (participant) {
            participantName = participant.name;
          }
        }
        
        // Determine role based on whether this is the responder
        const isResponder = activeBranch.participantId === responderParticipantId ||
                          (activeBranch.role === 'assistant' && !activeBranch.participantId && participantName === responderName);
        const role = isResponder ? 'assistant' : 'user';
        
        // Format content with participant name prefix (unless name is empty for raw continuation)
        let formattedContent = participantName === '' 
          ? activeBranch.content 
          : `${participantName}: ${activeBranch.content}`;
        
        // Handle attachments for non-responder messages
        if (role === 'user' && activeBranch.attachments && activeBranch.attachments.length > 0) {
          for (const attachment of activeBranch.attachments) {
            const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
            const fileExtension = attachment.fileName?.split('.').pop()?.toLowerCase() || '';
            const isImage = imageExtensions.includes(fileExtension);
            
            if (isImage) {
              formattedContent += `\n\n[Image attachment: ${attachment.fileName}]`;
            } else {
              formattedContent += `\n\n<attachment filename="${attachment.fileName}">\n${attachment.content}\n</attachment>`;
            }
          }
        }
        
        // Create formatted message
        const formattedMessage: Message = {
          id: message.id,
          conversationId: message.conversationId,
          branches: [{
            id: activeBranch.id,
            content: formattedContent,
            role: role,
            createdAt: activeBranch.createdAt,
            isActive: true,
            parentBranchId: activeBranch.parentBranchId,
            participantId: activeBranch.participantId
          }],
          activeBranchId: activeBranch.id,
          order: message.order
        };
        
        messagesFormatted.push(formattedMessage);
      }
      
      // For Bedrock, we need to consolidate consecutive user messages
      if (provider === 'bedrock') {
        return this.consolidateConsecutiveMessages(messagesFormatted);
      }
      
      return messagesFormatted;
    }
    
    return messages;
  }
  
  private consolidateConsecutiveMessages(messages: Message[]): Message[] {
    const consolidated: Message[] = [];
    let currentUserContent: string[] = [];
    let lastRole: string | null = null;
    
    for (const message of messages) {
      const activeBranch = message.branches.find(b => b.id === message.activeBranchId);
      if (!activeBranch) continue;
      
      if (activeBranch.role === 'user') {
        // Accumulate user messages
        currentUserContent.push(activeBranch.content);
        lastRole = 'user';
      } else {
        // If we have accumulated user messages, add them as a single message
        if (currentUserContent.length > 0) {
          const branchId = `consolidated-branch-${Date.now()}-${Math.random()}`;
          const consolidatedMessage: Message = {
            id: `consolidated-${Date.now()}-${Math.random()}`,
            conversationId: messages[0].conversationId,
            branches: [{
              id: branchId,
              content: currentUserContent.join('\n\n'),
              role: 'user',
              createdAt: new Date(),
              isActive: true,
              parentBranchId: messages[0].branches[0].parentBranchId,
              participantId: undefined
            }],
            activeBranchId: branchId,
            order: consolidated.length
          };
          consolidated.push(consolidatedMessage);
          currentUserContent = [];
        }
        
        // Add the assistant message
        consolidated.push(message);
        lastRole = 'assistant';
      }
    }
    
    // Don't forget any remaining user messages
    if (currentUserContent.length > 0) {
      const branchId = `consolidated-branch-${Date.now()}-${Math.random()}`;
      const consolidatedMessage: Message = {
        id: `consolidated-${Date.now()}-${Math.random()}`,
        conversationId: messages[0].conversationId,
        branches: [{
          id: branchId,
          content: currentUserContent.join('\n\n'),
          role: 'user',
          createdAt: new Date(),
          isActive: true,
          parentBranchId: messages[0].branches[0].parentBranchId,
          participantId: undefined
        }],
        activeBranchId: branchId,
        order: consolidated.length
      };
      consolidated.push(consolidatedMessage);
    }
    
    console.log(`[Messages Mode] Consolidated ${messages.length} messages into ${consolidated.length} messages for Bedrock compatibility`);
    return consolidated;
  }
  
  private providerSupportsPrefill(provider: string): boolean {
    // Only Anthropic and Bedrock (Claude models) reliably support prefill
    return provider === 'anthropic' || provider === 'bedrock';
  }
  
  private createMessagesModeChunkHandler(
    originalOnChunk: (chunk: string, isComplete: boolean, contentBlocks?: any[]) => Promise<void>,
    participants: Participant[],
    responderId?: string
  ): (chunk: string, isComplete: boolean, contentBlocks?: any[]) => Promise<void> {
    let buffer = '';
    let nameStripped = false;
    
    return async (chunk: string, isComplete: boolean, contentBlocks?: any[]) => {
      buffer += chunk;
      
      if (!nameStripped) {
        // Find the responder's name
        let responderName = 'Assistant';
        if (responderId) {
          const responder = participants.find(p => p.id === responderId);
          if (responder) {
            responderName = responder.name;
          }
        }
        
        // Check if buffer starts with "ParticipantName: "
        const namePattern = new RegExp(`^${responderName}:\\s*`);
        if (namePattern.test(buffer)) {
          // Strip the name prefix
          buffer = buffer.replace(namePattern, '');
          nameStripped = true;
          
          // If we have content after stripping, send it
          if (buffer.length > 0) {
            await originalOnChunk(buffer, false, contentBlocks);
            buffer = '';
          }
        } else if (buffer.length > responderName.length + 2) {
          // If we have enough buffer and no name match, assume no name prefix
          nameStripped = true;
          await originalOnChunk(buffer, false, contentBlocks);
          buffer = '';
        }
      } else {
        // Name already stripped, just pass through
        await originalOnChunk(chunk, false, contentBlocks);
        buffer = '';
      }
      
      // Handle completion
      if (isComplete && buffer.length > 0) {
        await originalOnChunk(buffer, true, contentBlocks);
      } else if (isComplete) {
        await originalOnChunk('', true, contentBlocks);
      }
    };
  }
}
