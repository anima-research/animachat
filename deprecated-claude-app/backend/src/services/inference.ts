import { Message, ConversationFormat, ConversationMode, ModelSettings, Participant, ApiKey, Conversation, Model, PostHocOperation, MessageBranch, ContentBlock } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { BedrockService } from './bedrock.js';
import { AnthropicService } from './anthropic.js';
import { OpenRouterService } from './openrouter.js';
import { OpenAICompatibleService } from './openai-compatible.js';
import { GeminiService } from './gemini.js';
import { ApiKeyManager } from './api-key-manager.js';
import { ModelLoader } from '../config/model-loader.js';
import { Logger } from '../utils/logger.js';
import { ContextManager } from './context-manager.js';

// Internal format type that includes 'messages' and 'completion' modes
// - 'standard': Traditional alternating user/assistant (no participant names)
// - 'prefill': Conversation log format with participant names
// - 'messages': Like prefill but without actual prefill support (fallback)
// - 'completion': OpenRouter completion mode (prompt field instead of messages)
type InternalConversationFormat = ConversationFormat | 'messages' | 'completion';

export class InferenceService {
  private bedrockService: BedrockService;
  private anthropicService: AnthropicService;
  private apiKeyManager: ApiKeyManager;
  private modelLoader: ModelLoader;
  private db: Database;
  private contextManager: ContextManager;
  public lastRawRequest?: any; // Store the last raw API request for debugging

  constructor(db: Database) {
    this.db = db;
    this.apiKeyManager = new ApiKeyManager(db);
    this.modelLoader = ModelLoader.getInstance();
    this.bedrockService = new BedrockService(db);
    this.anthropicService = new AnthropicService(db);
    this.contextManager = new ContextManager({}, db);
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
    const responderForFormat = participants.find(p => p.id === responderId);
    let actualFormat: InternalConversationFormat = this.determineActualFormat(format, model, responderForFormat?.conversationMode);

    // Check if responder is a persona-linked participant and build accumulated context
    let contextMessages = messages;
    if (responderId && conversation) {
      const responder = participants.find(p => p.id === responderId);
      if (responder?.personaId) {
        Logger.debug(`[InferenceService.buildPrompt] Responder is persona-linked (${responder.personaId}), building accumulated context`);
        try {
          const result = await this.contextManager.prepareContext(
            conversation,
            messages,
            undefined,
            responder,
            model.contextWindow
          );
          contextMessages = result.window.messages;
          Logger.debug(`[InferenceService.buildPrompt] Using ${contextMessages.length} messages from persona context (original: ${messages.length})`);
        } catch (error) {
          Logger.error('[InferenceService.buildPrompt] Failed to build persona context, using original messages:', error);
        }
      }
    }

    // Apply post-hoc operations (hide, edit, etc.)
    const processedMessages = this.applyPostHocOperations(contextMessages);
    
    // Format messages based on conversation format
    const formattedMessages = this.formatMessagesForConversation(processedMessages, actualFormat, participants, responderId, model.provider, conversation);
    
    // Now format for the specific provider
    let apiMessages: any[];
    let apiSystemPrompt: string | undefined = systemPrompt;
    
    switch (model.provider) {
      case 'anthropic':
        apiMessages = await this.anthropicService.formatMessagesForAnthropic(formattedMessages);
        break;
      case 'bedrock':
        apiMessages = await this.bedrockService.formatMessagesForClaude(formattedMessages);
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
    
    // Determine the actual format to use based on:
    // 1. Participant's conversationMode override (if specified)
    // 2. Conversation format (prefill vs standard)
    // 3. Model's prefill support
    const responder = participants.find(p => p.id === responderId);
    let actualFormat: InternalConversationFormat = this.determineActualFormat(format, model, responder?.conversationMode);
    Logger.inference(`[InferenceService] Format: conversation=${format}, participant=${responder?.conversationMode || 'auto'}, actual=${actualFormat}`);

    // Check if responder is a persona-linked participant and build accumulated context
    let contextMessages = messages;
    if (responderId && conversation) {
      const responder = participants.find(p => p.id === responderId);
      if (responder?.personaId) {
        Logger.inference(`[InferenceService] Responder is persona-linked (${responder.personaId}), building accumulated context`);
        try {
          const result = await this.contextManager.prepareContext(
            conversation,
            messages,
            undefined, // newMessage - not needed for inference
            responder,
            model.contextWindow
          );
          contextMessages = result.window.messages;
          Logger.inference(`[InferenceService] Using ${contextMessages.length} messages from persona context (original: ${messages.length})`);
        } catch (error) {
          Logger.error('[InferenceService] Failed to build persona context, using original messages:', error);
        }
      }
    }

    // Apply post-hoc operations (hide, edit, etc.)
    const processedMessages = this.applyPostHocOperations(contextMessages);
    
    // Format messages based on conversation format
    // For prefill format with Anthropic direct, pass cache marker indices to insert breakpoints
    const shouldInsertCacheBreakpoints = actualFormat === 'prefill' && model.provider === 'anthropic';
    // Trigger thinking via <think> tag in prefill mode if thinking was enabled AND model supports it
    // NOTE: In prefill mode, native thinking APIs don't work well (model is continuing a pre-filled response)
    // So we use <think> tags to trigger pseudo-reasoning for all providers that support prefill
    const supportsPrefillThinkingTags = model.provider === 'anthropic' || model.provider === 'bedrock' || (model.provider as string) === 'google';
    const shouldTriggerPrefillThinking = actualFormat === 'prefill' && settings.thinking?.enabled && model.supportsThinking && supportsPrefillThinkingTags;
    const formattedMessages = this.formatMessagesForConversation(
      processedMessages,
      actualFormat,
      participants,
      responderId,
      model.provider,
      conversation,
      shouldInsertCacheBreakpoints ? cacheMarkerIndices : undefined,
      shouldTriggerPrefillThinking
    );

    // For messages mode, provide a default system prompt if none is provided
    // This helps the model understand its role in a multi-participant chat
    // If user provides a custom prompt, use it as-is (full override)
    let effectiveSystemPrompt = systemPrompt;
    if (actualFormat === 'messages' && responderId) {
      const responder = participants.find(p => p.id === responderId);
      if (responder && (!effectiveSystemPrompt || effectiveSystemPrompt.trim() === '')) {
        const responderName = responder.name || 'Assistant';
        // Check if this provider supports prefill (we'll be prefilling with the name)
        const supportsPrefill = this.providerSupportsPrefill(model.provider);
        if (supportsPrefill && responderName !== 'Assistant') {
          // With prefill: the response is already prefilled with "Name: ", so just continue
          effectiveSystemPrompt = `You are ${responderName}, a participant in a multi-user chat.`;
        } else {
          // Without prefill: model should not add its name
          effectiveSystemPrompt = `You are ${responderName}, a participant in a multi-user chat. Other participants' messages are shown with their names prefixed. Don't prefix your responses with your name.`;
        }
        Logger.inference(`[InferenceService] Using default messages-mode system prompt for ${responderName} (prefill: ${supportsPrefill})`);
      }
    }

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
      
      if (shouldTriggerPrefillThinking) {
        // For prefill+thinking, use newline-prefixed stop sequences
        // This prevents false matches in thinking blocks while still stopping the API
        // when a new turn starts (which is always after \n\n in prefill format)
        stopSequences = [...new Set([
          ...baseStopSequences.map(s => `\n\n${s}`),
          ...participantStopSequences.map(s => `\n\n${s}`)
        ])];
        console.log(`[InferenceService] Using newline-prefixed stop sequences for prefill+thinking: ${stopSequences.slice(0, 3).join(', ')}...`);
      } else {
        // Standard prefill - use exact stop sequences
        stopSequences = [...new Set([...baseStopSequences, ...participantStopSequences])];
      }
    }
    
    // Build post-facto stop sequences for prefill thinking mode
    // Since this is applied in our code, not the API, we can check for ALL participants
    const postFactoStopSequences = shouldTriggerPrefillThinking ? (() => {
      const baseStopSequences = ['User:', 'A:', "Claude:"];
      const participantStopSequences = participants
        .filter(p => p.name !== '' && p.id !== responderId)
        .map(p => `${p.name}:`);
      const allSequences = [...new Set([...baseStopSequences, ...participantStopSequences])];
      console.log(`[InferenceService] Post-facto stop sequences (${allSequences.length}): ${allSequences.slice(0, 5).join(', ')}${allSequences.length > 5 ? '...' : ''}`);
      return allSequences;
    })() : [];

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

    // In prefill mode, disable native API thinking - it's incompatible with prefill format
    // (the model is continuing a pre-filled response, not generating fresh)
    // Thinking is triggered via <think> tags in formatMessagesForConversation instead
    const effectiveSettings = { ...settings };
    if (shouldTriggerPrefillThinking) {
      console.log('[InferenceService] Disabling API thinking for prefill format (using <think> tags instead)');
      effectiveSettings.thinking = { 
        enabled: false, 
        budgetTokens: effectiveSettings.thinking?.budgetTokens ?? 0 
      };
    }
    
    // Disable thinking if the model doesn't support it
    if (effectiveSettings.thinking?.enabled && !model.supportsThinking) {
      console.log(`[InferenceService] Disabling thinking for model ${model.id} (doesn't support thinking)`);
      effectiveSettings.thinking = undefined;
    }
    
    // Cap maxTokens to the model's output limit
    if (model.outputTokenLimit && effectiveSettings.maxTokens > model.outputTokenLimit) {
      console.log(`[InferenceService] Capping maxTokens from ${effectiveSettings.maxTokens} to ${model.outputTokenLimit} for model ${model.id}`);
      effectiveSettings.maxTokens = model.outputTokenLimit;
    }
    
    // For prefill thinking mode, handle thinking tags during streaming:
    // - Buffer thinking content until </think> is seen (don't add to content)
    // - Stream thinking updates via contentBlocks only
    // - After </think>, stream actual response text as normal content
    // - Apply stop sequences post-facto on response content (not during thinking)
    let inThinkingMode = false;
    let thinkingBuffer = '';
    let thinkingComplete = false;
    let responseHitStopSequence = false;
    let earlyCompletionSent = false; // Track if we sent early completion due to stop sequence
    let responseBuffer = ''; // Buffer to detect stop sequences across chunk boundaries
    const currentContentBlocks: any[] = [];
    
    // Helper to find stop sequences in text
    // Stop sequences should only match at the start of a new turn (after \n\n) or at position 0
    // This prevents false matches like "Dear aster: I want to help" from triggering
    const findStopSequence = (text: string): { index: number; sequence: string } | null => {
      for (const seq of postFactoStopSequences) {
        // Check if sequence is at position 0 (start of response after </think>)
        if (text.startsWith(seq)) {
          return { index: 0, sequence: seq };
        }
        // Check for sequence after double newline (new turn indicator)
        const turnIdx = text.indexOf('\n\n' + seq);
        if (turnIdx !== -1) {
          return { index: turnIdx + 2, sequence: seq }; // +2 to skip the \n\n
        }
      }
      return null;
    };
    
    const finalOnChunk = shouldTriggerPrefillThinking 
      ? async (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => {
          // If we already hit a stop sequence, ignore further chunks (except completion)
          if (responseHitStopSequence && !isComplete) return;
          
          if (isComplete) {
            // Skip if we already sent early completion due to stop sequence
            if (earlyCompletionSent) {
              console.log(`[InferenceService] Skipping duplicate completion (early completion already sent)`);
              return;
            }
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
                // Check for stop sequence in initial response
                const stopMatch = findStopSequence(trimmedAfterTag);
                if (stopMatch) {
                  responseHitStopSequence = true;
                  const truncated = trimmedAfterTag.substring(0, stopMatch.index).trimEnd();
                  if (stopMatch.index === 0) {
                    // Stop sequence at position 0 means model tried to write as another participant
                    console.log(`[InferenceService] ⚠️ Model attempted to write as "${stopMatch.sequence.replace(':', '')}" - response truncated`);
                    console.log(`[InferenceService] Response preview: "${trimmedAfterTag.substring(0, 100)}..."`);
                    // Send immediate completion - don't wait for API stream to finish
                    // This clears the loading indicator on the client immediately
                    console.log(`[InferenceService] Sending early completion (stop sequence at start)`);
                    earlyCompletionSent = true;
                    await baseOnChunk('', true, currentContentBlocks);
                  } else {
                    console.log(`[InferenceService] Stop sequence "${stopMatch.sequence}" found at position ${stopMatch.index}, truncating`);
                  }
                  if (truncated) {
                    await baseOnChunk(truncated, false, currentContentBlocks);
                  }
                  // Send early completion to avoid waiting for API stream to finish
                  // This prevents the loading indicator from staying on indefinitely
                  if (!earlyCompletionSent) {
                    console.log(`[InferenceService] Sending early completion (stop sequence found)`);
                    earlyCompletionSent = true;
                    await baseOnChunk('', true, currentContentBlocks);
                  }
                } else {
                  responseBuffer = trimmedAfterTag;
                  await baseOnChunk(trimmedAfterTag, false, currentContentBlocks);
                }
              }
            } else {
              // Still in thinking mode - buffer thinking, send empty chunk with contentBlocks update
              thinkingBuffer += chunk;
              currentContentBlocks[0] = { type: 'thinking', thinking: thinkingBuffer };
              // Send empty string as chunk (so content stays empty) but with updated contentBlocks
              await baseOnChunk('', false, currentContentBlocks);
            }
          } else {
            // After thinking, stream normal response content with stop sequence checking
            responseBuffer += chunk;
            
            // Check for stop sequence in accumulated response
            const stopMatch = findStopSequence(responseBuffer);
            if (stopMatch) {
              responseHitStopSequence = true;
              console.log(`[InferenceService] Stop sequence "${stopMatch.sequence}" found at position ${stopMatch.index}, truncating response`);
              // Calculate how much of this chunk to send
              const totalBefore = responseBuffer.length - chunk.length;
              const cutPoint = stopMatch.index - totalBefore;
              if (cutPoint > 0) {
                await baseOnChunk(chunk.substring(0, cutPoint).trimEnd(), false, currentContentBlocks);
              }
              // Send early completion to avoid waiting for API stream to finish
              if (!earlyCompletionSent) {
                console.log(`[InferenceService] Sending early completion (stop sequence in response)`);
                earlyCompletionSent = true;
                await baseOnChunk('', true, currentContentBlocks);
              }
            } else {
              await baseOnChunk(chunk, false, currentContentBlocks);
            }
          }
        }
      : baseOnChunk;

    let usageResult: { usage?: any; rawRequest?: any } = {};

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
        effectiveSystemPrompt,
        effectiveSettings,
        finalOnChunk,
        stopSequences
      );
    } else if (model.provider === 'bedrock') {
      if (!selectedKey) {
        throw new Error('No API key available for Bedrock');
      }
      const bedrockService = new BedrockService(this.db, selectedKey.credentials);
      usageResult = await bedrockService.streamCompletion(
        model.providerModelId,
        formattedMessages,
        effectiveSystemPrompt,
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
          effectiveSystemPrompt,
          effectiveSettings,
          finalOnChunk,
          stopSequences
        );
      } else {
        usageResult = await openRouterService.streamCompletion(
        model.providerModelId,
        formattedMessages,
        effectiveSystemPrompt,
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
      
      usageResult = await openAIService.streamCompletion(
        model.providerModelId,
        formattedMessages,
        effectiveSystemPrompt,
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
      
      // DEBUG: Log what was passed in vs defaults
      console.log(`[Gemini] User modelSpecific from settings:`, JSON.stringify(userModelSpecific, null, 2));
      
      // Apply defaults from model's configurableSettings if not set by user
      const modelDefaults: Record<string, any> = {};
      if ((model as any).configurableSettings) {
        for (const setting of (model as any).configurableSettings) {
          if (userModelSpecific[setting.key] === undefined) {
            modelDefaults[setting.key] = setting.default;
            console.log(`[Gemini] Using default for ${setting.key}: ${setting.default}`);
          }
        }
      }
      
      const geminiSettings = {
        ...effectiveSettings,
        modelSpecific: { ...modelDefaults, ...userModelSpecific },
      };
      
      console.log(`[Gemini] Final model-specific settings:`, JSON.stringify(geminiSettings.modelSpecific, null, 2));
      
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
        messagesToSend = this.truncateMessagesToFit(formattedMessages, model.contextWindow, effectiveSystemPrompt);
        console.log(`[Gemini] After truncation: ${messagesToSend.length} messages (was ${formattedMessages.length})`);
      }
      
      usageResult = await geminiService.streamCompletion(
        model.providerModelId,
        messagesToSend,
        effectiveSystemPrompt,
        geminiSettings,
        finalOnChunk,
        stopSequences
      );
    } else {
      throw new Error(`Unsupported provider: ${model.provider}`);
    }

    // Store raw request for debugging if provider returned it
    if (usageResult.rawRequest) {
      this.lastRawRequest = usageResult.rawRequest;
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
    // Expand prefixHistory from the first message into synthetic messages
    // This handles forked conversations with compressed history
    let expandedMessages = messages;
    if (messages.length > 0) {
      const firstMessage = messages[0];
      const firstBranch = firstMessage.branches.find(b => b.id === firstMessage.activeBranchId);
      const prefixHistory = (firstBranch as any)?.prefixHistory as Array<{ role: 'user' | 'assistant' | 'system'; content: string; participantId?: string; model?: string }> | undefined;
      
      if (prefixHistory && prefixHistory.length > 0) {
        console.log(`[InferenceService] Expanding ${prefixHistory.length} prefixHistory entries for fork context`);
        
        // Create synthetic messages from prefixHistory
        // Use participantId for proper name lookup (participants are copied during fork)
        const syntheticMessages: Message[] = prefixHistory.map((entry, index) => ({
          id: `prefix-history-${index}`,
          conversationId: firstMessage.conversationId,
          branches: [{
            id: `prefix-history-branch-${index}`,
            content: entry.content,
            role: entry.role,
            createdAt: new Date(0), // Epoch - these are historical
            model: entry.model,
            participantId: entry.participantId, // Use ID for proper lookup
          } as any],
          activeBranchId: `prefix-history-branch-${index}`,
          order: index
        }));
        
        // Prepend synthetic messages, then the actual messages (with adjusted orders)
        expandedMessages = [
          ...syntheticMessages,
          ...messages.map((m, i) => ({ ...m, order: prefixHistory.length + i }))
        ];
      }
    }
    
    if (format === 'standard') {
      // Standard format - pass through (with expanded prefixHistory if present)
      return expandedMessages;
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
      // Note: Anthropic API accepts assistant-only messages for prefill, so this is optional
      const prefillSettings = conversation?.prefillUserMessage || { enabled: true, content: '<cmd>cat untitled.log</cmd>' };
      
      if (prefillSettings.enabled) {
        const cmdMessage: Message = {
          id: 'prefill-cmd',
          conversationId: expandedMessages[0]?.conversationId || '',
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
      // When we encounter images, we need to:
      // 1. Close the current assistant message with content so far
      // 2. Insert a user message with the image and its text
      // 3. Start a new assistant segment for content after
      
      let conversationContent = '';
      let lastMessageWasEmptyAssistant = false;
      let lastAssistantName = 'Assistant';
      let lastParticipantName = ''; // Track previous participant for continuity
      let messageIndex = 0;  // Track index for cache breakpoints
      let messageOrder = 1;  // For ordering output messages
      
      // Helper to check if an attachment is an image
      const isImageAttachment = (attachment: any): boolean => {
        // Note: GIF excluded - Anthropic API has issues with some GIF formats
        const imageExtensions = ['jpg', 'jpeg', 'png', 'webp'];
        const fileExtension = attachment.fileName?.split('.').pop()?.toLowerCase() || '';
        return imageExtensions.includes(fileExtension) && !!attachment.content;
      };
      
      // Helper to flush current conversation content as an assistant message
      const flushAssistantContent = () => {
        if (conversationContent.trim()) {
          const assistantBranch: any = {
            id: `prefill-assistant-branch-${messageOrder}`,
            content: conversationContent.trim(),
            role: 'assistant',
            createdAt: new Date(),
            isActive: true,
            parentBranchId: 'prefill-cmd-branch'
          };
          
          // Flag cache breakpoints if present
          if (hasCacheMarkers && conversationContent.includes('<|cache_breakpoint|>')) {
            assistantBranch._hasCacheBreakpoints = true;
          }
          
          prefillMessages.push({
            id: `prefill-assistant-${messageOrder}`,
            conversationId: messages[0]?.conversationId || '',
            branches: [assistantBranch],
            activeBranchId: `prefill-assistant-branch-${messageOrder}`,
            order: messageOrder++
          });
          conversationContent = '';
        }
      };
      
      for (const message of expandedMessages) {
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
        
        // Check if this message has image attachments
        const imageAttachments = (activeBranch.attachments || []).filter(isImageAttachment);
        const hasImages = imageAttachments.length > 0;
        
        // Build the message content with text attachments
        let messageContent = activeBranch.content;
        
        // Handle non-image attachments (add inline)
        if (activeBranch.attachments && activeBranch.attachments.length > 0) {
          for (const attachment of activeBranch.attachments) {
            if (!isImageAttachment(attachment)) {
              // Add text/PDF attachments inline
              messageContent += `\n\n<attachment filename="${attachment.fileName}">\n${attachment.content}\n</attachment>`;
              console.log(`[PREFILL] Added text attachment: ${attachment.fileName}`);
            }
          }
        }
        
        if (hasImages) {
          // Message has images - we need to insert it as a real user message
          console.log(`[PREFILL] Message has ${imageAttachments.length} images, inserting as user message`);
          
          // First, flush any accumulated assistant content
          flushAssistantContent();
          
          // Format the message text with participant name
          const formattedText = participantName === '' 
            ? messageContent 
            : `${participantName}: ${messageContent}`;
          
          // Create user message with the text and actual image attachments
          const userBranch: any = {
            id: `prefill-image-user-branch-${messageOrder}`,
            content: formattedText,
            role: 'user',
            createdAt: new Date(),
            isActive: true,
            parentBranchId: 'root',
            attachments: imageAttachments
          };
          
          prefillMessages.push({
            id: `prefill-image-user-${messageOrder}`,
            conversationId: messages[0]?.conversationId || '',
            branches: [userBranch],
            activeBranchId: `prefill-image-user-branch-${messageOrder}`,
            order: messageOrder++
          });
          
          console.log(`[PREFILL] Inserted user message with ${imageAttachments.length} image(s) at order ${messageOrder - 1}`);
          // Reset participant tracking after image insertion
          lastParticipantName = participantName;
          // Reset empty assistant tracking - this is a non-empty message
          lastMessageWasEmptyAssistant = false;
        } else {
          // No images - add to conversation content as usual
          if (participantName === '') {
            conversationContent += `${messageContent}`;
          } else if (participantName === lastParticipantName && lastParticipantName !== '') {
            // Same participant as before - continue without prefix, just trim and append
            conversationContent = conversationContent.trimEnd() + ' ' + messageContent.trimStart() + '\n\n';
          } else {
            conversationContent += `${participantName}: ${messageContent}\n\n`;
          }
          lastParticipantName = participantName;
          // Reset empty assistant tracking - this is a non-empty message
          lastMessageWasEmptyAssistant = false;
        }
        
        // Insert cache breakpoint marker if needed
        if (cacheBreakpointIndices.has(messageIndex)) {
          conversationContent += '<|cache_breakpoint|>';
          console.log(`[PREFILL] 📍 Inserted cache breakpoint after message ${messageIndex} (${participantName})`);
        }
        
        messageIndex++;
      }
      
      // Add final assistant segment with responder name
      const thinkingPrefix = triggerThinking ? ' <think>' : '';
      
      if (lastMessageWasEmptyAssistant) {
        if (lastAssistantName === '') {
          conversationContent = conversationContent.trim() + thinkingPrefix;
        } else if (lastAssistantName === lastParticipantName) {
          // Same participant - just continue without name
          conversationContent = conversationContent.trim() + thinkingPrefix;
        } else {
          conversationContent = conversationContent.trim() + `\n\n${lastAssistantName}:${thinkingPrefix}`;
        }
      } else if (responderId && participants.length > 0) {
        const responder = participants.find(p => p.id === responderId);
        if (responder) {
          if (responder.name === '') {
            conversationContent = conversationContent.trim() + thinkingPrefix;
          } else if (responder.name === lastParticipantName) {
            // Same participant as last message - continue without name prefix
            conversationContent = conversationContent.trim() + thinkingPrefix;
          } else {
            conversationContent = conversationContent.trim() + `\n\n${responder.name}:${thinkingPrefix}`;
          }
        }
      }
      
      // Flush final assistant content
      if (conversationContent.trim()) {
        const assistantBranch: any = {
          id: `prefill-assistant-branch-${messageOrder}`,
          content: conversationContent.trim(),
          role: 'assistant',
          createdAt: new Date(),
          isActive: true,
          parentBranchId: 'prefill-cmd-branch'
        };
        
        if (hasCacheMarkers && conversationContent.includes('<|cache_breakpoint|>')) {
          assistantBranch._hasCacheBreakpoints = true;
          console.log(`[PREFILL] 📦 Final content has cache breakpoints (${conversationContent.length} chars total)`);
        }
        
        prefillMessages.push({
          id: `prefill-assistant-${messageOrder}`,
          conversationId: messages[0]?.conversationId || '',
          branches: [assistantBranch],
          activeBranchId: `prefill-assistant-branch-${messageOrder}`,
          order: messageOrder
        });
      }
      
      console.log(`[PREFILL] Generated ${prefillMessages.length} messages (with ${prefillMessages.filter(m => (m.branches[0] as any)?.attachments?.length > 0).length} containing images)`);
      
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
      
      for (const message of expandedMessages) {
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
        // Note: We add text references AND preserve the actual attachments
        // Text references go in the transcript, but actual image/PDF data is preserved
        // on the branch for providers (like Anthropic) that support multimodal inputs
        if (role === 'user' && activeBranch.attachments && activeBranch.attachments.length > 0) {
          for (const attachment of activeBranch.attachments) {
            // Note: GIF excluded - Anthropic API has issues with some GIF formats
            const imageExtensions = ['jpg', 'jpeg', 'png', 'webp'];
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
        
        // Preserve attachments for providers that support multimodal inputs
        if (role === 'user' && activeBranch.attachments && activeBranch.attachments.length > 0) {
          formattedBranch.attachments = activeBranch.attachments;
        }
        
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
      
      // Consolidate consecutive same-role messages if enabled or required for provider
      // Bedrock always requires alternating turns
      const shouldCombine = conversation?.combineConsecutiveMessages ?? true;
      if (provider === 'bedrock' || shouldCombine) {
        return this.consolidateConsecutiveMessages(messagesFormatted);
      }
      
      // For providers that support prefill, add a prefilled assistant message with the responder's name
      // This helps guide the model to respond as the correct participant
      if (provider && this.providerSupportsPrefill(provider) && responderName && responderName !== '' && responderName !== 'Assistant') {
        const prefillBranchId = `prefill-name-branch-${Date.now()}`;
        const prefillMessage: Message = {
          id: `prefill-name-${Date.now()}`,
          conversationId: messages[0]?.conversationId || '',
          branches: [{
            id: prefillBranchId,
            content: `${responderName}: `,
            role: 'assistant',
            createdAt: new Date(),
            isActive: true,
            parentBranchId: messagesFormatted[messagesFormatted.length - 1]?.branches[0]?.id
          }],
          activeBranchId: prefillBranchId,
          order: messagesFormatted.length
        };
        messagesFormatted.push(prefillMessage);
        console.log(`[Messages Mode] Added prefill with responder name: "${responderName}: "`);
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
  
  /**
   * Check if a model supports prefill mode.
   * - If model has explicit supportsPrefill flag, use that (allows opt-out for image gen models)
   * - Anthropic, Bedrock, and Google (Gemini) default to supporting prefill
   * - Other providers: check model.supportsPrefill flag (for custom models)
   */
  private modelSupportsPrefill(model: Model): boolean {
    // If the model has an explicit supportsPrefill flag set to false, respect that
    // This allows image generation models to opt out of prefill
    if (model.supportsPrefill === false) {
      return false;
    }
    
    // Anthropic, Bedrock (Claude models), and Google (Gemini) support prefill by default
    if (model.provider === 'anthropic' || model.provider === 'bedrock' || model.provider === 'google') {
      return true;
    }
    // For other providers, check the model's explicit supportsPrefill flag
    // This allows custom OpenRouter models to opt-in to prefill
    return model.supportsPrefill === true;
  }
  
  /**
   * @deprecated Use modelSupportsPrefill instead
   */
  private providerSupportsPrefill(provider: string): boolean {
    // Anthropic, Bedrock (Claude models), and Google (Gemini) support prefill
    return provider === 'anthropic' || provider === 'bedrock' || provider === 'google';
  }
  
  /**
   * Determine the actual format to use for inference based on:
   * 1. Participant's conversationMode override (if specified and not 'auto')
   * 2. Conversation format (prefill vs standard)
   * 3. Model's prefill support
   */
  private determineActualFormat(
    conversationFormat: ConversationFormat,
    model: Model,
    participantMode?: ConversationMode
  ): InternalConversationFormat {
    // If conversation is standard, always use standard (no group chat)
    if (conversationFormat === 'standard') {
      return 'standard';
    }
    
    // For prefill conversations, check participant override
    if (participantMode && participantMode !== 'auto') {
      // Participant has an explicit preference
      switch (participantMode) {
        case 'prefill':
          // Force prefill - but only if model supports it
          if (this.modelSupportsPrefill(model)) {
            return 'prefill';
          }
          Logger.warn(`[InferenceService] Participant requested prefill but model ${model.id} doesn't support it, using messages`);
          return 'messages';
          
        case 'messages':
          // Force messages mode (no prefill)
          return 'messages';
          
        case 'completion':
          // OpenRouter completion mode - only valid for openrouter provider
          if (model.provider === 'openrouter') {
            return 'completion';
          }
          Logger.warn(`[InferenceService] Completion mode only works with OpenRouter, using messages`);
          return 'messages';
      }
    }
    
    // Default behavior: use prefill if model supports it, otherwise messages
    if (this.modelSupportsPrefill(model)) {
      return 'prefill';
    }
    
    Logger.inference(`[InferenceService] Model ${model.id} doesn't support prefill, using messages mode`);
    return 'messages';
  }
  
  /**
   * Apply post-hoc operations to messages for context building.
   * Operations are processed in message order - later operations override earlier ones.
   * 
   * Post-hoc operations allow retroactively modifying how previous messages appear
   * in context without actually changing the original data:
   * - 'hide': Exclude a specific message from context
   * - 'hide_before': Exclude all messages before a target message
   * - 'edit': Replace the content of a target message
   * - 'hide_attachment': Remove specific attachments from a target message
   */
  private applyPostHocOperations(messages: Message[]): Message[] {
    // First pass: collect all operations with their message order
    const operations: Array<{ order: number; op: PostHocOperation }> = [];
    
    Logger.info(`[PostHoc] Processing ${messages.length} messages for post-hoc operations`);
    
    for (const msg of messages) {
      const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
      if (activeBranch?.postHocOperation) {
        operations.push({ order: msg.order, op: activeBranch.postHocOperation });
        Logger.info(`[PostHoc] Found operation: ${activeBranch.postHocOperation.type} targeting ${activeBranch.postHocOperation.targetMessageId}`);
      }
    }
    
    if (operations.length === 0) {
      Logger.info(`[PostHoc] No operations found in message history`);
      return messages; // No operations to apply
    }
    
    Logger.inference(`[InferenceService] Applying ${operations.length} post-hoc operation(s)`);
    
    // Build lookup maps for quick access
    const messageById = new Map<string, Message>();
    const messageOrderById = new Map<string, number>();
    for (const msg of messages) {
      messageById.set(msg.id, msg);
      messageOrderById.set(msg.id, msg.order);
    }
    
    // Track which messages are hidden and which have edits/attachment hides
    const hiddenMessageIds = new Set<string>();
    const messageEdits = new Map<string, ContentBlock[]>(); // messageId -> replacement content
    const attachmentHides = new Map<string, Set<number>>(); // messageId -> set of hidden indices
    
    // Process operations in order
    for (const { order, op } of operations.sort((a, b) => a.order - b.order)) {
      switch (op.type) {
        case 'hide':
          hiddenMessageIds.add(op.targetMessageId);
          Logger.inference(`[PostHoc] Hiding message ${op.targetMessageId}`);
          break;
          
        case 'hide_before': {
          const targetOrder = messageOrderById.get(op.targetMessageId);
          if (targetOrder !== undefined) {
            for (const msg of messages) {
              if (msg.order < targetOrder) {
                hiddenMessageIds.add(msg.id);
              }
            }
            Logger.inference(`[PostHoc] Hiding all messages before order ${targetOrder}`);
          }
          break;
        }
          
        case 'edit':
          if (op.replacementContent) {
            messageEdits.set(op.targetMessageId, op.replacementContent);
            Logger.inference(`[PostHoc] Editing message ${op.targetMessageId}`);
          }
          break;
          
        case 'hide_attachment':
          if (op.attachmentIndices && op.attachmentIndices.length > 0) {
            const existing = attachmentHides.get(op.targetMessageId) || new Set();
            for (const idx of op.attachmentIndices) {
              existing.add(idx);
            }
            attachmentHides.set(op.targetMessageId, existing);
            Logger.inference(`[PostHoc] Hiding attachments ${op.attachmentIndices.join(', ')} from message ${op.targetMessageId}`);
          }
          break;
          
        case 'unhide':
          // Remove message from hidden set (reverses a previous hide)
          hiddenMessageIds.delete(op.targetMessageId);
          Logger.inference(`[PostHoc] Unhiding message ${op.targetMessageId}`);
          break;
      }
    }
    
    // Second pass: build the modified messages list
    const result: Message[] = [];
    
    for (const msg of messages) {
      const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
      
      // Skip operation messages themselves (they're meta, not content)
      if (activeBranch?.postHocOperation) {
        continue;
      }
      
      // Skip hidden messages
      if (hiddenMessageIds.has(msg.id)) {
        continue;
      }
      
      // Apply edits and attachment hides if needed
      const edit = messageEdits.get(msg.id);
      const hiddenAttachments = attachmentHides.get(msg.id);
      
      if (edit || hiddenAttachments) {
        // Need to modify this message
        const modifiedBranches = msg.branches.map(branch => {
          if (branch.id !== msg.activeBranchId) {
            return branch; // Only modify active branch
          }
          
          const modifiedBranch: MessageBranch = { ...branch };
          
          // Apply content edit
          if (edit) {
            modifiedBranch.contentBlocks = edit;
            // Also update plain content for compatibility
            const textBlocks = edit.filter(b => b.type === 'text');
            modifiedBranch.content = textBlocks.map(b => (b as any).text).join('\n\n');
          }
          
          // Apply attachment hides
          if (hiddenAttachments && modifiedBranch.attachments) {
            modifiedBranch.attachments = modifiedBranch.attachments.filter(
              (_, idx) => !hiddenAttachments.has(idx)
            );
          }
          
          return modifiedBranch;
        });
        
        result.push({
          ...msg,
          branches: modifiedBranches
        });
      } else {
        result.push(msg);
      }
    }
    
    Logger.inference(`[PostHoc] Result: ${result.length} messages (original: ${messages.length})`);
    return result;
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
