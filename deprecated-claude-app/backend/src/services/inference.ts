import { Message, ConversationFormat, ModelSettings, Participant, ApiKey, TokenUsage, Conversation } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { BedrockService } from './bedrock.js';
import { AnthropicService } from './anthropic.js';
import { OpenRouterService } from './openrouter.js';
import { OpenAICompatibleService } from './openai-compatible.js';
import { GeminiService } from './gemini.js';
import { ApiKeyManager } from './api-key-manager.js';
import { ModelLoader } from '../config/model-loader.js';
import { Logger } from '../utils/logger.js';

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
    conversation?: Conversation,
    userId?: string
  ): Promise<{ messages: any[], systemPrompt?: string, provider: string, modelId: string }> {
    // Find the model configuration
    const model = await this.modelLoader.getModelById(modelId, userId);
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
        // Use dummy values - the actual endpoint/key don't matter for formatting
        const openAIService = new OpenAICompatibleService(
          this.db,
          'dummy-key',
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
        // Handle 'google' and any other providers
        if ((model.provider as string) === 'google') {
          // For prompt building, we don't need actual API keys
          // Gemini format is handled internally by the service
          apiMessages = formattedMessages.map(m => ({
            role: m.branches?.[0]?.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.branches?.[0]?.content || '' }]
          }));
        } else {
        throw new Error(`Unknown provider: ${model.provider}`);
        }
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
    onChunk: (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => Promise<void>,
    format: ConversationFormat = 'standard',
    participants: Participant[] = [],
    responderId?: string,
    conversation?: Conversation,
    cacheMarkerIndices?: number[]  // Message indices where to insert cache breakpoints (for prefill)
  ): Promise<{
    usage?: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
    }
  }> {
    
    // Find the model configuration
    Logger.inference(`[InferenceService] streamCompletion called with modelId: "${modelId}", type: ${typeof modelId}, userId: ${userId}`);
    
    if (!modelId) {
      Logger.error(`[InferenceService] ERROR: modelId is ${modelId}!`);
      throw new Error(`Model ${modelId} not found`);
    }
    
    const model = await this.modelLoader.getModelById(modelId, userId);
    if (!model) {
      Logger.error(`[InferenceService] Model lookup failed for ID: "${modelId}", userId: ${userId}`);
      throw new Error(`Model ${modelId} not found`);
    }
    Logger.inference(`[InferenceService] Found model: provider=${model.provider}, providerModelId=${model.providerModelId}`)
    
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
    // For prefill format with Anthropic direct, pass cache marker indices to insert breakpoints
    const shouldInsertCacheBreakpoints = actualFormat === 'prefill' && model.provider === 'anthropic';
    // Trigger thinking via <think> tag in prefill mode if thinking was enabled in settings
    const shouldTriggerPrefillThinking = actualFormat === 'prefill' && settings.thinking?.enabled;
    const formattedMessages = this.formatMessagesForConversation(
      messages, 
      actualFormat, 
      participants, 
      responderId, 
      model.provider, 
      conversation,
      shouldInsertCacheBreakpoints ? cacheMarkerIndices : undefined,
      shouldTriggerPrefillThinking
    );

    // Build stop sequences for prefill/messages formats
    let stopSequences: string[] | undefined;
    if (actualFormat === 'prefill' || actualFormat === 'messages') {
      // Always include these common stop sequences
      const baseStopSequences = ['User:', 'A:', "Claude:"];
      // Add participant names as stop sequences (excluding empty names and the current responder)
      // The responder must be excluded because the model will prefix its response with its own name
      const participantStopSequences = participants
        .filter(p => p.name !== '' && p.id !== responderId) // Exclude empty names and responder
        .map(p => `${p.name}:`);
      // Combine and deduplicate
      stopSequences = [...new Set([...baseStopSequences, ...participantStopSequences])];
    }

    // Route to appropriate service based on provider
    // For custom models with embedded endpoints, skip API key manager
    const isCustomModelWithEndpoint = (model as any).customEndpoint !== undefined;
    
    let selectedKey = null;
    if (!isCustomModelWithEndpoint) {
      // Get API key configuration from API key manager
      selectedKey = await this.apiKeyManager.getApiKeyForRequest(userId, model.provider, modelId);
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
    } else {
      console.log(`[InferenceService] Using custom model with embedded endpoint: ${(model as any).customEndpoint.baseUrl}`);
    }

    // Track token usage
    let inputTokens = 0;
    let outputTokens = 0;
    const trackingOnChunk = async (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => {
      await onChunk(chunk, isComplete, contentBlocks, usage);
      // TODO: Implement accurate token counting
      outputTokens += chunk.length / 4; // Rough estimate
    };
    
    // Wrap chunk handler for messages mode to strip participant names
    let baseOnChunk = actualFormat === 'messages' 
      ? this.createMessagesModeChunkHandler(trackingOnChunk, participants, responderId)
      : trackingOnChunk;

    // In prefill mode, disable API thinking - it's incompatible with prefill format
    // Thinking blocks are converted to <think> tags in formatMessagesForConversation instead
    const effectiveSettings = { ...settings };
    if (actualFormat === 'prefill' && effectiveSettings.thinking?.enabled) {
      console.log('[InferenceService] Disabling API thinking for prefill format (using <think> tags instead)');
      effectiveSettings.thinking = { ...effectiveSettings.thinking, enabled: false };
    }
    
    // For prefill thinking mode, handle thinking tags during streaming:
    // - Buffer thinking content until </think> is seen (don't add to content)
    // - Stream thinking updates via contentBlocks only
    // - After </think>, stream actual response text as normal content
    let inThinkingMode = false;
    let thinkingBuffer = '';
    let thinkingComplete = false;
    const currentContentBlocks: any[] = [];
    
    const finalOnChunk = shouldTriggerPrefillThinking 
      ? async (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => {
          if (isComplete) {
            // Finalize contentBlocks
            if (thinkingBuffer) {
              currentContentBlocks[0] = { type: 'thinking', thinking: thinkingBuffer.trimEnd() };
            }
            console.log(`[InferenceService] Prefill thinking complete: ${thinkingBuffer.length} chars thinking`);
            // Send final with contentBlocks
            await baseOnChunk('', true, currentContentBlocks.length > 0 ? currentContentBlocks : contentBlocks, usage);
            return;
          }
          
          if (!chunk) return;
          
          // Start thinking mode on first chunk
          if (!inThinkingMode && !thinkingComplete) {
            inThinkingMode = true;
            currentContentBlocks.push({ type: 'thinking', thinking: '' });
            console.log('[InferenceService] Starting prefill thinking mode');
          }
          
          if (inThinkingMode) {
            // Check if this chunk contains </think>
            const closeTagIndex = (thinkingBuffer + chunk).indexOf('</think>');
            if (closeTagIndex !== -1) {
              // Split at the close tag
              const combined = thinkingBuffer + chunk;
              thinkingBuffer = combined.substring(0, closeTagIndex);
              const afterTag = combined.substring(closeTagIndex + '</think>'.length);
              
              inThinkingMode = false;
              thinkingComplete = true;
              // Trim trailing whitespace from thinking content
              currentContentBlocks[0] = { type: 'thinking', thinking: thinkingBuffer.trimEnd() };
              
              console.log('[InferenceService] Thinking block closed, streaming response');
              
              // Send thinking complete update (empty chunk, just contentBlocks)
              await baseOnChunk('', false, currentContentBlocks);
              
              // Start streaming response content (without the tags, trim leading newlines)
              const trimmedAfterTag = afterTag.replace(/^[\n\r]+/, '');
              if (trimmedAfterTag) {
                await baseOnChunk(trimmedAfterTag, false, currentContentBlocks);
              }
            } else {
              // Still in thinking mode - buffer thinking, send empty chunk with contentBlocks update
              thinkingBuffer += chunk;
              currentContentBlocks[0] = { type: 'thinking', thinking: thinkingBuffer };
              // Send empty string as chunk (so content stays empty) but with updated contentBlocks
              await baseOnChunk('', false, currentContentBlocks);
            }
          } else {
            // After thinking, stream normal response content
            await baseOnChunk(chunk, false, currentContentBlocks);
          }
        }
      : baseOnChunk;

    let usageResult: { usage?: any } = {};

    if (model.provider === 'anthropic') {
      if (!selectedKey) {
        throw new Error('No API key available for Anthropic');
      }
      const anthropicService = new AnthropicService(
        this.db, 
        selectedKey.credentials.apiKey
      );
      
      usageResult = await anthropicService.streamCompletion(
        model.providerModelId,
        formattedMessages,
        systemPrompt,
        effectiveSettings,
        finalOnChunk,
        stopSequences
      );
    } else if (model.provider === 'bedrock') {
      if (!selectedKey) {
        throw new Error('No API key available for Bedrock');
      }
      const bedrockService = new BedrockService(this.db, selectedKey.credentials);
      await bedrockService.streamCompletion(
        model.providerModelId,
        formattedMessages,
        systemPrompt,
        effectiveSettings,
        finalOnChunk,
        stopSequences
      );
    } else if (model.provider === 'openrouter') {
      if (!selectedKey) {
        throw new Error('No API key available for OpenRouter');
      }
      const openRouterService = new OpenRouterService(
        this.db, 
        selectedKey.credentials.apiKey
      );
      
      // Use exact test script reproduction if enabled (for debugging)
      const useExactTest = process.env.OPENROUTER_EXACT_TEST === 'true';
      
      if (useExactTest) {
        Logger.info('[InferenceService] 🧪 Using EXACT test script reproduction for OpenRouter');
        usageResult = await openRouterService.streamCompletionExactTest(
          model.providerModelId,
          formattedMessages,
          systemPrompt,
          effectiveSettings,
          finalOnChunk,
          stopSequences
        );
      } else {
        usageResult = await openRouterService.streamCompletion(
        model.providerModelId,
        formattedMessages,
        systemPrompt,
        effectiveSettings,
        finalOnChunk,
        stopSequences
      );
      }
    } else if (model.provider === 'openai-compatible') {
      // Check if this is a custom user model with its own endpoint
      const isCustomModel = (model as any).customEndpoint !== undefined;
      const baseUrl = isCustomModel 
        ? (model as any).customEndpoint.baseUrl
        : (selectedKey?.credentials.baseUrl || 'http://localhost:11434');
      const apiKey = isCustomModel
        ? ((model as any).customEndpoint.apiKey || '')
        : (selectedKey?.credentials.apiKey || '');
      const modelPrefix = isCustomModel
        ? undefined
        : selectedKey?.credentials.modelPrefix;
      
      console.log(`[InferenceService] OpenAI-compatible model config: isCustomModel=${isCustomModel}, baseUrl=${baseUrl}`);
      
      const openAIService = new OpenAICompatibleService(
        this.db,
        apiKey,
        baseUrl,
        modelPrefix
      );
      
      await openAIService.streamCompletion(
        model.providerModelId,
        formattedMessages,
        systemPrompt,
        effectiveSettings,
        finalOnChunk,
        stopSequences
      );
    } else if ((model.provider as string) === 'google') {
      if (!selectedKey) {
        throw new Error('No API key available for Google');
      }
      const geminiService = new GeminiService(
        this.db,
        selectedKey.credentials.apiKey
      );
      
      // Pass model-specific settings - merge with model defaults
      const userModelSpecific = (effectiveSettings as any).modelSpecific || {};
      
      // Apply defaults from model's configurableSettings if not set by user
      const modelDefaults: Record<string, any> = {};
      if ((model as any).configurableSettings) {
        for (const setting of (model as any).configurableSettings) {
          if (userModelSpecific[setting.key] === undefined) {
            modelDefaults[setting.key] = setting.default;
          }
        }
      }
      
      const geminiSettings = {
        ...effectiveSettings,
        modelSpecific: { ...modelDefaults, ...userModelSpecific },
      };
      
      console.log(`[Gemini] Model-specific settings:`, JSON.stringify(geminiSettings.modelSpecific, null, 2));
      
      // Auto-truncate context if enabled (check user setting first, then model capability)
      let messagesToSend = formattedMessages;
      // User can override via modelSpecific.autoTruncateContext setting
      const userAutoTruncate = geminiSettings.modelSpecific?.autoTruncateContext;
      const modelAutoTruncate = (model as any).capabilities?.autoTruncateContext;
      // Default to true if user hasn't set it but model capability is true
      const shouldAutoTruncate = userAutoTruncate !== undefined ? userAutoTruncate : modelAutoTruncate;
      console.log(`[Gemini] autoTruncateContext: user=${userAutoTruncate}, model=${modelAutoTruncate}, effective=${shouldAutoTruncate}, contextWindow: ${model.contextWindow}`);
      if (shouldAutoTruncate && model.contextWindow) {
        console.log(`[Gemini] Truncating context to fit ${model.contextWindow} tokens...`);
        messagesToSend = this.truncateMessagesToFit(formattedMessages, model.contextWindow, systemPrompt);
        console.log(`[Gemini] After truncation: ${messagesToSend.length} messages (was ${formattedMessages.length})`);
      }
      
      usageResult = await geminiService.streamCompletion(
        model.providerModelId,
        messagesToSend,
        systemPrompt,
        geminiSettings,
        finalOnChunk,
        stopSequences
      );
    } else {
      throw new Error(`Unsupported provider: ${model.provider}`);
    }

    // Use actual usage from provider if available, otherwise estimate
    if (usageResult.usage) {
      inputTokens = usageResult.usage.inputTokens;
      outputTokens = usageResult.usage.outputTokens;
    } else {
    inputTokens = this.estimateTokens(formattedMessages);
    }

    // Track usage after completion
    if (selectedKey && selectedKey.source === 'config' && selectedKey.profile) {
      await this.apiKeyManager.trackUsage(
        userId,
        model.provider,
        modelId,
        inputTokens,
        outputTokens,
        selectedKey.profile
      );
    }
    
    return usageResult;
  }

  private estimateTokens(messages: Message[]): number {
    // Rough token estimation
    const text = messages.map(m => {
      const activeBranch = m.branches.find(b => b.id === m.activeBranchId);
      return activeBranch?.content || '';
    }).join(' ');
    return Math.ceil(text.length / 4);
  }

  /**
   * Truncate messages to fit within context window, keeping messages from the tail
   * Uses message boundaries as separators (doesn't split messages)
   */
  private truncateMessagesToFit(messages: any[], maxContextTokens: number, systemPrompt?: string): any[] {
    // Reserve some tokens for system prompt and output
    const systemPromptTokens = systemPrompt ? Math.ceil(systemPrompt.length / 4) : 0;
    const outputReserve = 8192; // Reserve some for output
    const availableTokens = maxContextTokens - systemPromptTokens - outputReserve;
    
    console.log(`[Truncate] maxContext=${maxContextTokens}, systemPrompt=${systemPromptTokens}, outputReserve=${outputReserve}, available=${availableTokens}`);
    
    if (availableTokens <= 0) {
      console.log(`[Truncate] Context too tight, returning last message only`);
      return messages.slice(-1); // Return at least the last message
    }
    
    // Estimate tokens for each message (rough estimate: 4 chars per token)
    const messageTokens = messages.map((msg, idx) => {
      let content = '';
      let hasMedia = false;
      
      // Handle our internal Message format (with branches)
      if (msg.branches && msg.activeBranchId) {
        const activeBranch = msg.branches.find((b: any) => b.id === msg.activeBranchId);
        if (activeBranch) {
          content = activeBranch.content || '';
          // Check for attachments in the branch
          if (activeBranch.attachments && activeBranch.attachments.length > 0) {
            for (const att of activeBranch.attachments) {
              if (att.isImage || att.mimeType?.startsWith('image/')) {
                hasMedia = true;
                content += 'x'.repeat(400000); // ~100k tokens per image
              } else if (att.isAudio || att.mimeType?.startsWith('audio/')) {
                hasMedia = true;
                content += 'x'.repeat(200000); // ~50k tokens for audio
              } else if (att.isVideo || att.mimeType?.startsWith('video/')) {
                hasMedia = true;
                content += 'x'.repeat(400000); // ~100k tokens for video
              } else if (att.isPdf || att.mimeType === 'application/pdf') {
                hasMedia = true;
                content += 'x'.repeat(100000); // ~25k tokens for PDF
              }
            }
          }
          // Check for contentBlocks with images
          if (activeBranch.contentBlocks) {
            for (const block of activeBranch.contentBlocks) {
              if (block.type === 'image') {
                hasMedia = true;
                content += 'x'.repeat(400000);
              }
            }
          }
        }
      } else if (typeof msg.content === 'string') {
        // OpenAI/Anthropic format - simple string content
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // OpenAI/Anthropic format - multimodal content array
        for (const part of msg.content) {
          if (part.type === 'text') {
            content += part.text || '';
          } else if (part.type === 'image_url' || part.type === 'image' || part.inlineData) {
            hasMedia = true;
            content += 'x'.repeat(400000); // ~100k tokens per image
          } else if (part.type === 'audio' || part.type === 'video') {
            hasMedia = true;
            content += 'x'.repeat(200000);
          }
        }
      } else if (msg.parts) {
        // Gemini format
        for (const part of msg.parts) {
          if (part.text) {
            content += part.text;
          } else if (part.inlineData) {
            hasMedia = true;
            content += 'x'.repeat(400000);
          }
        }
      }
      
      const tokens = Math.ceil(content.length / 4);
      if (hasMedia || tokens > 10000) {
        console.log(`[Truncate] Message ${idx}: ~${tokens} tokens${hasMedia ? ' (has media)' : ''}`);
      }
      return tokens;
    });
    
    const totalTokens = messageTokens.reduce((a, b) => a + b, 0);
    console.log(`[Truncate] Total estimated tokens: ${totalTokens}`);
    
    if (totalTokens <= availableTokens) {
      console.log(`[Truncate] Context fits: ${totalTokens} tokens <= ${availableTokens} available`);
      return messages;
    }
    
    // Truncate from the head (keep messages from tail)
    let keptTokens = 0;
    let startIdx = messages.length;
    
    for (let i = messages.length - 1; i >= 0; i--) {
      if (keptTokens + messageTokens[i] > availableTokens) {
        break;
      }
      keptTokens += messageTokens[i];
      startIdx = i;
    }
    
    // Ensure we keep at least one message
    if (startIdx >= messages.length) {
      startIdx = messages.length - 1;
    }
    
    const truncatedMessages = messages.slice(startIdx);
    const droppedCount = startIdx;
    
    console.log(`[Truncate] 🔄 Auto-truncated: dropped ${droppedCount} messages, kept ${truncatedMessages.length} (~${keptTokens} tokens)`);
    
    return truncatedMessages;
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
    conversation?: Conversation,
    cacheMarkerIndices?: number[],  // Message indices where to insert cache breakpoints
    triggerThinking?: boolean  // Add opening <think> tag for prefill thinking mode
  ): Message[] {
    if (format === 'standard') {
      // Standard format - pass through as-is
      return messages;
    }
    
    if (format === 'prefill') {
      // Convert to prefill format with participant names
      const prefillMessages: Message[] = [];
      
      // Convert cache marker indices to a Set for fast lookup
      const cacheBreakpointIndices = new Set(cacheMarkerIndices || []);
      const hasCacheMarkers = cacheBreakpointIndices.size > 0;
      
      if (hasCacheMarkers) {
        console.log(`[PREFILL] 📦 Will insert ${cacheBreakpointIndices.size} cache breakpoints at message indices:`, 
          Array.from(cacheBreakpointIndices).sort((a, b) => a - b));
      }
      
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
      let messageIndex = 0;  // Track index for cache breakpoints
      
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
          messageIndex++;
          continue; // Skip empty assistant messages
        }
        
        // Build the message content with attachments
        let messageContent = '';
        
        // For assistant messages with thinking blocks, convert to <think> tags (prefill format)
        if (activeBranch.role === 'assistant' && activeBranch.contentBlocks && activeBranch.contentBlocks.length > 0) {
          for (const block of activeBranch.contentBlocks) {
            if (block.type === 'thinking') {
              messageContent += `<think>\n${block.thinking}\n</think>\n\n`;
            } else if (block.type === 'redacted_thinking') {
              messageContent += `<think>[Redacted for safety]</think>\n\n`;
            }
          }
        }
        
        // Add the main content
        messageContent += activeBranch.content;
        
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
        
        // Insert cache breakpoint marker AFTER this message if it's a cache boundary
        // Cache breakpoints go after the message at that index (so content before is cached)
        if (cacheBreakpointIndices.has(messageIndex)) {
          conversationContent += '<|cache_breakpoint|>';
          console.log(`[PREFILL] 📍 Inserted cache breakpoint after message ${messageIndex} (${participantName})`);
        }
        
        messageIndex++;
      }
      
      // If the last message was an empty assistant, append that assistant's name
      // Add opening <think> tag if thinking is triggered in prefill mode
      // Note: No trailing whitespace allowed by Anthropic API
      const thinkingPrefix = triggerThinking ? ' <think>' : '';
      
      if (lastMessageWasEmptyAssistant) {
        // If the assistant has no name (raw continuation), don't add any prefix
        if (lastAssistantName === '') {
          conversationContent = conversationContent.trim() + thinkingPrefix;
        } else {
          conversationContent = conversationContent.trim() + `\n\n${lastAssistantName}:${thinkingPrefix}`;
        }
      } else if (responderId && participants.length > 0) {
        // Otherwise, if we have a responder, append their name with a colon (no newline)
        const responder = participants.find(p => p.id === responderId);
        if (responder) {
          // If responder has no name (raw continuation), don't add any prefix
          if (responder.name === '') {
            conversationContent = conversationContent.trim() + thinkingPrefix;
          } else {
            conversationContent = conversationContent.trim() + `\n\n${responder.name}:${thinkingPrefix}`;
          }
        }
      }
      
      
      // Create assistant message with the conversation content
      const assistantBranch: any = {
        id: 'prefill-assistant-branch',
        content: conversationContent,
        role: 'assistant',
        createdAt: new Date(),
        isActive: true,
        parentBranchId: 'prefill-cmd-branch'
      };
      
      // Flag that this content has cache breakpoint markers for Anthropic to process
      // This uses the Chapter II approach: markers in text, converted to cache_control blocks
      if (hasCacheMarkers && conversationContent.includes('<|cache_breakpoint|>')) {
        assistantBranch._hasCacheBreakpoints = true;
        console.log(`[PREFILL] 📦 Content has ${cacheBreakpointIndices.size} cache breakpoints (${conversationContent.length} chars total)`);
      }
      
      const assistantMessage: Message = {
        id: 'prefill-assistant',
        conversationId: messages[0]?.conversationId || '',
        branches: [assistantBranch],
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
        
        // Format content with participant name prefix
        // For openai-compatible providers: don't add name prefix to assistant's own messages
        // This prevents the model from learning it should output its name
        let formattedContent: string;
        if (participantName === '') {
          // Raw continuation - no prefix
          formattedContent = activeBranch.content;
        } else if (role === 'assistant' && provider === 'openai-compatible') {
          // OpenAI-compatible model's own messages - no prefix (prevents name echoing)
          formattedContent = activeBranch.content;
        } else {
          // All other messages - add name prefix
          formattedContent = `${participantName}: ${activeBranch.content}`;
        }
        
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
        
        // Create formatted message, preserving cache control metadata if present
        const formattedBranch: any = {
          id: activeBranch.id,
          content: formattedContent,
          role: role,
          createdAt: activeBranch.createdAt,
          isActive: true,
          parentBranchId: activeBranch.parentBranchId,
          participantId: activeBranch.participantId
        };
        
        // Preserve cache control metadata for providers that support it
        if ((activeBranch as any)._cacheControl) {
          formattedBranch._cacheControl = (activeBranch as any)._cacheControl;
        }
        
        const formattedMessage: Message = {
          id: message.id,
          conversationId: message.conversationId,
          branches: [formattedBranch],
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
  
  /**
   * Parse <think>...</think> tags from content and create contentBlocks
   * Used for prefill mode thinking where API thinking is not available
   */
  private parseThinkingTags(content: string): any[] {
    const contentBlocks: any[] = [];
    
    // Match all <think>...</think> blocks (non-greedy, handles multiple)
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    let match;
    let textContent = content;
    
    while ((match = thinkRegex.exec(content)) !== null) {
      const thinkingContent = match[1].trim();
      if (thinkingContent) {
        contentBlocks.push({
          type: 'thinking',
          thinking: thinkingContent
        });
      }
    }
    
    // Remove thinking tags from content to get the text part
    textContent = content.replace(thinkRegex, '').trim();
    
    // Add text block if there's remaining content
    if (textContent && contentBlocks.length > 0) {
      contentBlocks.push({
        type: 'text',
        text: textContent
      });
    }
    
    return contentBlocks;
  }
  
  private createMessagesModeChunkHandler(
    originalOnChunk: (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => Promise<void>,
    participants: Participant[],
    responderId?: string
  ): (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => Promise<void> {
    let buffer = '';
    let nameStripped = false;
    
    return async (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => {
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
        await originalOnChunk(buffer, true, contentBlocks, usage);
      } else if (isComplete) {
        await originalOnChunk('', true, contentBlocks, usage);
      }
    };
  }
}
