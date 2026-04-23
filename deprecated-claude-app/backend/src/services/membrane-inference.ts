/**
 * Membrane Inference Service
 *
 * Интеграция membrane middleware с animachat.
 * Заменяет сложную логику InferenceService на простой вызов membrane.
 *
 * Что делает membrane за нас:
 * - Prefill formatting (participant names, conversation log)
 * - Stop sequences (автоматически для participant names)
 * - Cache control markers
 * - Tool injection (XML or native)
 * - Streaming with tool execution
 * - Response parsing
 *
 * Что остаётся в animachat:
 * - Message storage (JSONL)
 * - User authentication
 * - API key management
 * - Model configuration
 *
 * Что делает EnhancedInferenceService (вызывает нас):
 * - Context window management (prepareContext)
 * - Cache marker calculation
 * - Metrics tracking
 *
 * CACHE STRATEGY (UPDATED):
 * - Anthropic API limit: 4 cache_control blocks total
 * - System prompt auto-cached by Membrane (if present) = 1 block
 * - Remaining slots for messages: 3 (with system) or 4 (without)
 * - EnhancedInference calculates markers, we enforce the limit
 * - Stable markers = cacheRead on subsequent requests = huge cost savings
 *
 * FORMATTER STRATEGY:
 * - anthropic + standard (1-on-1): NativeFormatter - uses API native tools
 * - anthropic + prefill (group chat): AnthropicXmlFormatter - prefill mode with XML tools
 * - openrouter: NativeFormatter - standard chat format, API handles tools
 * - openai-compatible: NativeFormatter - standard chat format
 */

import crypto from 'crypto';
import {
  Message,
  Participant,
  Conversation,
  ModelSettings,
  MessageBranch,
  ContentBlock as AnimachatContentBlock
} from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { ApiKeyManager, SelectedApiKey } from './api-key-manager.js';
import { ModelLoader } from '../config/model-loader.js';
import { getBlobStore } from '../database/blob-store.js';
import { Logger } from '../utils/logger.js';
import { InferenceService } from './inference.js';

// Membrane imports
// CHANGED: Added NativeFormatter for OpenRouter and OpenAI-compatible providers
import {
  Membrane,
  isAbortedResponse,
  AnthropicAdapter,
  OpenRouterAdapter,
  OpenAICompatibleAdapter,
  NativeFormatter              // ← NEW: For OpenRouter and OpenAI-compatible
} from '@animalabs/membrane';
import type {
  NormalizedRequest,
  ContentBlock,
  StreamOptions
} from '@animalabs/membrane';

// Local converter
import { convertToNormalizedMessages } from './message-converter.js';

// Tool registry types
import type { ToolDefinition, ToolCall, ToolResult } from '../tools/tool-registry.js';

// ============================================================================
// Debug Helper
// ============================================================================

// Helper for debug logging - finds messages with _cacheControl
function idsWithCacheControl(msgs: Message[]): string[] {
  return msgs
    .filter(m => {
      const b = m.branches.find(x => x.id === m.activeBranchId) as any;
      return !!b?._cacheControl;
    })
    .map(m => m.id.substring(0, 8)); // Short IDs for readability
}

// ============================================================================
// Membrane Inference Service
// ============================================================================

export class MembraneInferenceService extends InferenceService {
  private memDb: Database;
  private memApiKeyManager: ApiKeyManager;
  private memModelLoader: ModelLoader;
  public declare lastRawRequest: unknown; // For debugging compatibility with InferenceService

  constructor(db: Database) {
    super(db);  // Initialize parent (its private fields are unused but harmless)
    this.memDb = db;
    this.memApiKeyManager = new ApiKeyManager(db);
    this.memModelLoader = ModelLoader.getInstance();
  }

  // ==========================================================================
  // Main API - Compatible with InferenceService signature
  // ==========================================================================

  override async streamCompletion(
    modelId: string,
    messages: Message[],
    systemPrompt: string | undefined,
    settings: ModelSettings,
    userId: string,
    onChunk: (chunk: string, isComplete: boolean, contentBlocks?: AnimachatContentBlock[], usage?: any) => Promise<void>,
    format: 'standard' | 'prefill' = 'standard',
    participants: Participant[] = [],
    responderId?: string,
    conversation?: Conversation,
    cacheMarkerIndices?: number[],
    toolOptions?: {
      tools?: ToolDefinition[];
      onToolCall?: (call: ToolCall) => void;
      onToolResult?: (result: ToolResult) => void;
      executeToolCall?: (call: ToolCall) => Promise<ToolResult>;
    }
  ): Promise<{
    usage?: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
    };
  }> {
    // DEBUG
    console.log(`\n🚀 [MembraneInference] Using MEMBRANE for model: ${modelId}`);
    console.log(`[MembraneInference] Input: ${messages.length} messages, cacheMarkerIndices: ${JSON.stringify(cacheMarkerIndices)}`);

    // 1. Get model configuration
    const model = await this.memModelLoader.getModelById(modelId, userId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    // 2. Get API key
    const selectedKey = await this.memApiKeyManager.getApiKeyForRequest(userId, model.provider, modelId);

    // 3. Extract credentials
    const { apiKey, endpoint, modelPrefix } = this.extractCredentials(model, selectedKey);

    if (!apiKey && model.provider !== 'openai-compatible') {
      throw new Error(`No API key found for provider ${model.provider}`);
    }

    // 4. Check if provider supports caching
    const supportsCaching = this.providerSupportsCaching(model);
    console.log(`[MembraneInference] Provider ${model.provider} supports caching: ${supportsCaching}`);

    console.log(`[MembraneInference] Before prepareMessages - msgs with _cacheControl: ${JSON.stringify(idsWithCacheControl(messages))}`);

    // 5. Prepare messages (expand prefixHistory, apply postHoc, resolve blobs)
    const preparedMessages = await this.prepareMessages(messages);

    // 5.1 Handle cache markers based on provider support
    // CHANGED: Now supports up to N markers instead of just first one
    // - Providers WITH caching: keep up to N markers (Anthropic limit = 4 total)
    // - Providers WITHOUT caching: strip ALL markers (avoid invalid fields in API request)
    let messagesForConversion: Message[];

    if (supportsCaching) {
      // CHANGED: Anthropic API limit: 4 cache_control blocks total
      // System prompt is auto-cached by Membrane (counts as 1 if present)
      // So we can have max 3 message breakpoints when system prompt exists
      const hasSystemPrompt = !!systemPrompt;
      const maxMessageMarkers = hasSystemPrompt ? 3 : 4;

      messagesForConversion = this.keepUpToNCacheMarkers(preparedMessages, maxMessageMarkers);

      console.log(`[MembraneInference] Cache limit: ${maxMessageMarkers} message markers (system=${hasSystemPrompt ? 'yes' : 'no'})`);
    } else {
      // Remove ALL markers to prevent invalid cache_control in API request
      messagesForConversion = this.stripAllCacheMarkers(preparedMessages);
    }

    console.log(`[MembraneInference] After processing - msgs with _cacheControl: ${JSON.stringify(idsWithCacheControl(messagesForConversion))}`);

    // 6. Find assistant name
    const assistantName = this.findAssistantName(participants, responderId);

    // 7. Determine formatter and tool mode (BEFORE converter, so we know which participant name to use)
    const useNativeFormatter = model.provider === 'openrouter'
      || model.provider === 'openai-compatible'
      || (model.provider === 'anthropic' && format === 'standard');

    // WORKAROUND: Membrane's buildNativeToolRequest() hardcodes participant === 'Claude'
    // for role detection. When using native formatter, we must use 'Claude' as the assistant
    // participant name so that Membrane correctly identifies assistant messages.
    // See: membrane.ts line 862 — `const isAssistant = msg.participant === 'Claude';`
    const membraneAssistantName = useNativeFormatter ? 'Claude' : assistantName;

    // 8. Convert to membrane format
    // Note: effectiveCacheIndices not needed - converter reads _cacheControl directly from branch
    const normalizedMessages = convertToNormalizedMessages(
      messagesForConversion,
      participants,
      undefined,  // effectiveCacheIndices not used - _cacheControl is the source of truth
      membraneAssistantName
    );

    // CHANGED: Check for cacheBreakpoint instead of metadata.cacheControl
    const normalizedWithCache = normalizedMessages.filter(m => m.cacheBreakpoint).length;
    console.log(`[MembraneInference] After converter: ${normalizedMessages.length} msgs, ${normalizedWithCache} with cacheBreakpoint`);
    if (normalizedWithCache > 0) {
      const positions = normalizedMessages.map((m, i) => m.cacheBreakpoint ? i : null).filter(x => x !== null);
      console.log(`[MembraneInference] Cache positions in normalized: ${JSON.stringify(positions)}`);
    }

    // Create membrane instance
    const membrane = this.createMembrane(model.provider, apiKey, endpoint, membraneAssistantName, useNativeFormatter);

    // 9. Build request
    let actualModelId = modelPrefix
      ? `${modelPrefix}${model.providerModelId}`
      : model.providerModelId;
    actualModelId = actualModelId.replace(/::+/g, ':').replace(/\/{2,}/g, '/');

    const maxTokens = settings?.maxTokens || model.outputTokenLimit || 4096;

    let thinking: { enabled: true; budgetTokens: number } | undefined;
    if (settings?.thinking?.enabled && model.supportsThinking) {
      const requestedBudget = settings.thinking.budgetTokens ?? 1024;
      const safeBudget = Math.min(requestedBudget, Math.max(0, maxTokens - 64));
      if (safeBudget > 0) {
        thinking = { enabled: true, budgetTokens: safeBudget };
      }
    }

    const request: NormalizedRequest = {
      messages: normalizedMessages,
      system: systemPrompt,
      config: {
        model: actualModelId,
        maxTokens,
        temperature: settings?.temperature,
        topP: settings?.topP,
        topK: settings?.topK,
        thinking,
      },
      // Include tools if provided
      ...(toolOptions?.tools && toolOptions.tools.length > 0 && {
        tools: toolOptions.tools as any,
      }),
      // Tell membrane to use native tool handling (API tool_use blocks)
      // instead of XML parsing when using NativeFormatter
      ...(useNativeFormatter && { toolMode: 'native' as const }),
    };

    console.log(`\n[MembraneInference] 📤 REQUEST TO MEMBRANE:`);
    console.log(`  Model: ${request.config.model}`);
    console.log(`  Messages: ${request.messages.length}`);
    // CHANGED: Check cacheBreakpoint instead of metadata.cacheControl
    console.log(`  Messages with cacheBreakpoint: ${request.messages.filter(m => m.cacheBreakpoint).length}`);
    console.log(`  Thinking: ${thinking ? `enabled (budget: ${thinking.budgetTokens})` : 'disabled'}`);
    console.log(`  Tools: ${request.tools ? request.tools.length : 0}`);

    // 10. Stream with callbacks
    //
    // We track two separate arrays to avoid index collisions:
    // - indexedBlocks: populated by onContentBlockUpdate (index-based, from Membrane streaming)
    // - toolBlocksFromLoop: populated by onToolCalls (appended, for real-time tool card display)
    //
    // After the tool loop, Membrane resets its internal index counter for the final text,
    // so onContentBlockUpdate(index=0, text) would overwrite tool_use at index 0 if we
    // used a single array. By separating them, tool blocks are always preserved.
    //
    // The final callback uses response.content (authoritative) which has all blocks.
    let indexedBlocks: AnimachatContentBlock[] = [];
    let toolBlocksFromLoop: AnimachatContentBlock[] = [];
    let finalUsage: any = {};

    // Helper: combine both arrays for streaming to frontend
    const getCurrentBlocks = (): AnimachatContentBlock[] => [
      ...toolBlocksFromLoop,
      ...indexedBlocks.filter(b => b.type !== 'text' || (b as any).text !== ''),
    ];

    const streamOptions: StreamOptions = {
      onChunk: (chunk: string) => {
        void onChunk(chunk, false, getCurrentBlocks());
      },
      onContentBlockUpdate: (index: number, block: any) => {
        const animachatBlock = this.convertMembraneContentBlock(block);
        if (!animachatBlock) return;

        // Fill gaps to avoid sparse array (defensive coding)
        while (indexedBlocks.length <= index) {
          indexedBlocks.push({ type: 'text', text: '' });
        }
        indexedBlocks[index] = animachatBlock;
      },
      onUsage: (usage: any) => {
        finalUsage = {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens
        };
      },
      // Tool calling support: Membrane calls this when the model emits tool_use blocks.
      // We execute the tool and return results so Membrane can continue the tool loop.
      //
      // We also push tool_use/tool_result into toolBlocksFromLoop for real-time streaming
      // to the frontend (so tool cards appear immediately with spinner → green check).
      // The final callback uses response.content as the authoritative source for DB persistence.
      ...(toolOptions?.executeToolCall && {
        onToolCalls: async (calls: any[], context: any) => {
          const results: any[] = [];
          for (const call of calls) {
            // Push tool_use for real-time frontend streaming (shows spinning card)
            toolBlocksFromLoop.push({
              type: 'tool_use',
              id: call.id,
              name: call.name,
              input: call.input,
            } as any);
            void onChunk('', false, getCurrentBlocks());

            // Notify about tool call start
            toolOptions.onToolCall?.(call as ToolCall);
            console.log(`[MembraneInference] 🔧 Tool call: ${call.name} (id: ${call.id})`);

            try {
              // Execute via the provided callback (which routes through ToolRegistry)
              const result = await toolOptions.executeToolCall!(call as ToolCall);
              result.toolUseId = call.id;

              // Push tool_result for real-time frontend streaming (shows green check)
              toolBlocksFromLoop.push({
                type: 'tool_result',
                tool_use_id: call.id,
                content: result.content,
                is_error: result.isError || false,
              } as any);
              void onChunk('', false, getCurrentBlocks());

              // Notify about tool result
              toolOptions.onToolResult?.(result);
              console.log(`[MembraneInference] 📋 Tool result for ${call.name}: ${result.isError ? 'ERROR' : 'OK'} (${typeof result.content === 'string' ? result.content.length : 'structured'} chars)`);

              results.push(result);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              console.error(`[MembraneInference] ❌ Tool execution error for ${call.name}:`, errorMsg);
              const errorResult = { toolUseId: call.id, content: `Tool error: ${errorMsg}`, isError: true };

              // Push error tool_result for real-time frontend streaming
              toolBlocksFromLoop.push({
                type: 'tool_result',
                tool_use_id: call.id,
                content: `Tool error: ${errorMsg}`,
                is_error: true,
              } as any);
              void onChunk('', false, getCurrentBlocks());

              toolOptions.onToolResult?.(errorResult);
              results.push(errorResult);
            }
          }
          return results;
        },
      }),
    };

    // 11. Execute stream
    const response = await membrane.stream(request, streamOptions);

    this.lastRawRequest = (response as any).raw?.request;

    // DEBUG: Log cache_control location in raw request
    console.log(`\n[MembraneInference] 📥 RAW API REQUEST (checking for cache_control):`);
    if (this.lastRawRequest) {
      const rawStr = JSON.stringify(this.lastRawRequest, null, 2);
      const hasCacheControl = rawStr.includes('cache_control');
      console.log(`  Has cache_control in request: ${hasCacheControl}`);

      if (hasCacheControl) {
        const raw = this.lastRawRequest as any;

        // Check system prompt
        if (raw?.system) {
          const sys = Array.isArray(raw.system) ? raw.system : [raw.system];
          sys.forEach((block: any, i: number) => {
            if (block?.cache_control) {
              console.log(`    Found at system[${i}]: ${JSON.stringify(block.cache_control)}`);
            }
          });
        }

        // Check messages
        if (raw?.messages) {
          raw.messages.forEach((msg: any, i: number) => {
            if (Array.isArray(msg.content)) {
              msg.content.forEach((block: any, j: number) => {
                if (block.cache_control) {
                  console.log(`    Found at messages[${i}].content[${j}]: ${JSON.stringify(block.cache_control)}`);
                }
              });
            }
          });
        }

        // Show first message size for context
        if (raw?.messages?.[0]) {
          const firstMsg = raw.messages[0];
          if (Array.isArray(firstMsg.content) && firstMsg.content[0]?.text) {
            const textLength = firstMsg.content[0].text.length;
            console.log(`    First message text length: ${textLength} chars (~${Math.round(textLength/4)} tokens)`);
          }
        }
      } else {
        console.log(`  ⚠️ WARNING: No cache_control found in API request!`);
      }
    } else {
      console.log(`  ⚠️ Raw request not available from adapter`);
    }

    // 12. Extract cache metrics from raw response (workaround for membrane bug)
    // Membrane's buildFinalResponse() hardcodes cache metrics to 0
    // So we read directly from raw provider response
    let cacheCreationInputTokens = 0;
    let cacheReadInputTokens = 0;

    const rawResponse = (response as any).raw?.response as any;
    if (rawResponse?.usage) {
      cacheCreationInputTokens = rawResponse.usage.cache_creation_input_tokens || 0;
      cacheReadInputTokens = rawResponse.usage.cache_read_input_tokens || 0;
      console.log(`[MembraneInference] 📥 RAW RESPONSE USAGE (for cache verification):`);
      console.log(`  input_tokens: ${rawResponse.usage.input_tokens}`);
      console.log(`  output_tokens: ${rawResponse.usage.output_tokens}`);
      console.log(`  cache_creation_input_tokens: ${cacheCreationInputTokens}`);
      console.log(`  cache_read_input_tokens: ${cacheReadInputTokens}`);
    }

    // 13. Final callback
    if (!isAbortedResponse(response)) {
      // Fix tool_use/tool_result ID mismatch from Membrane's XML parser.
      // In XML mode, parseAccumulatedIntoBlocks() generates NEW IDs for tool_use blocks
      // via generateToolId(), but tool_result blocks keep ORIGINAL IDs from XML attributes.
      // The blocks are grouped by position: [tool_use, tool_use, ..., tool_result, tool_result, ...]
      // Fix by pairing the Nth tool_use with the Nth tool_result positionally.
      const rawContent = response.content;
      const toolUseBlocks = rawContent.filter((b: any) => b.type === 'tool_use');
      const toolResultBlocks = rawContent.filter((b: any) => b.type === 'tool_result');
      for (let i = 0; i < Math.min(toolUseBlocks.length, toolResultBlocks.length); i++) {
        (toolResultBlocks[i] as any).toolUseId = (toolUseBlocks[i] as any).id;
      }

      const finalBlocks = rawContent
        .map((b: any) => this.convertMembraneContentBlock(b))
        .filter(Boolean) as AnimachatContentBlock[];

      console.log(`[MembraneInference] 📦 Final content blocks: ${finalBlocks.map((b: any) => b.type).join(', ')}`);

      const usage = {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cacheCreationInputTokens,  // From raw response (workaround)
        cacheReadInputTokens       // From raw response (workaround)
      };

      console.log(`\n[MembraneInference] 📊 CACHE RESULTS:`);
      console.log(`  cacheCreate: ${usage.cacheCreationInputTokens}`);
      console.log(`  cacheRead: ${usage.cacheReadInputTokens}`);
      if (usage.cacheCreationInputTokens > 0) {
        console.log(`  ✅ Cache CREATED - next request should get cacheRead!`);
      } else if (usage.cacheReadInputTokens > 0) {
        console.log(`  ✅ Cache READ - saving money!`);
      } else if (supportsCaching) {
        console.log(`  ⚠️ No cache activity - prefix may be < 1024 tokens or cache expired`);
      }

      await onChunk('', true, finalBlocks, usage);

      return { usage };
    }

    return {
      usage: finalUsage.inputTokens ? finalUsage : undefined
    };
  }

  // ==========================================================================
  // Cache Support Methods
  // ==========================================================================

  /**
   * Check if provider supports Anthropic-style prompt caching
   *
   * - Anthropic direct: Full support
   * - OpenRouter with Claude models: Full support (passes through to Anthropic)
   * - OpenRouter with non-Claude: No support (GPT, Llama, etc.)
   * - OpenAI-compatible: No support (Ollama, vLLM, etc.)
   */
  private providerSupportsCaching(model: any): boolean {
    if (model.provider === 'anthropic') {
      return true;
    }

    if (model.provider === 'openrouter') {
      // OpenRouter supports caching only for Claude/Anthropic models
      // Format: "anthropic/claude-3-5-sonnet" or just model name with "claude"
      const id = (model.providerModelId || '').toLowerCase();
      return id.startsWith('anthropic/') || id.includes('claude');
    }

    return false;
  }

  /**
   * Keep up to N cache markers, remove the rest
   */
  private keepUpToNCacheMarkers(messages: Message[], maxMarkers: number): Message[] {
    let markersKept = 0;
    let markersRemoved = 0;
    const keptIndices: number[] = [];
    const removedIndices: number[] = [];

    const result = messages.map((message, i) => {
      const branch = message.branches.find(b => b.id === message.activeBranchId) as any;

      // No cache marker on this message - pass through
      if (!branch?._cacheControl) {
        return message;
      }

      // Already at limit - remove this marker
      if (markersKept >= maxMarkers) {
        markersRemoved++;
        removedIndices.push(i);
        const { _cacheControl, ...cleanBranch } = branch;

        return {
          ...message,
          branches: message.branches.map(b =>
            b.id === message.activeBranchId ? cleanBranch : b
          )
        };
      }

      // Still have room - keep this marker
      markersKept++;
      keptIndices.push(i);
      return message;
    });

    // Log what we did
    if (markersKept > 0 || markersRemoved > 0) {
      console.log(`[MembraneInference] 🎯 Cache markers: kept ${markersKept} at [${keptIndices.join(', ')}], removed ${markersRemoved} at [${removedIndices.join(', ')}] (limit: ${maxMarkers})`);
    }

    return result;
  }

  /**
   * Remove ALL cache markers from messages
   */
  private stripAllCacheMarkers(messages: Message[]): Message[] {
    let removed = 0;

    const result = messages.map(msg => {
      const branch = msg.branches.find(b => b.id === msg.activeBranchId) as any;
      if (!branch?._cacheControl) return msg;

      removed++;
      const { _cacheControl, ...cleanBranch } = branch;
      return {
        ...msg,
        branches: msg.branches.map(b =>
          b.id === msg.activeBranchId ? cleanBranch : b
        )
      };
    });

    if (removed > 0) {
      console.log(`[MembraneInference] 🧹 Stripped ${removed} cache markers (provider doesn't support caching)`);
    }

    return result;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private extractCredentials(
    model: any,
    selectedKey: SelectedApiKey | null
  ): { apiKey: string; endpoint?: string; modelPrefix?: string } {
    const isCustomModel = model.customEndpoint !== undefined;

    if (model.provider === 'openai-compatible') {
      let baseUrl = isCustomModel
        ? model.customEndpoint.baseUrl
        : (selectedKey?.credentials?.baseUrl || 'http://localhost:11434');

      baseUrl = baseUrl.replace(/\/(v1\/)?chat\/completions\/?$/, '');
      baseUrl = baseUrl.replace(/\/$/, '');
      if (!baseUrl.endsWith('/v1') && !baseUrl.includes('/v1/')) {
        baseUrl = `${baseUrl}/v1`;
      }

      const apiKey = isCustomModel
        ? (model.customEndpoint.apiKey || '')
        : (selectedKey?.credentials?.apiKey || selectedKey?.credentials?.key || '');

      const modelPrefix = isCustomModel
        ? undefined
        : selectedKey?.credentials?.modelPrefix;

      return { apiKey, endpoint: baseUrl, modelPrefix };
    }

    if (!selectedKey) {
      return { apiKey: '' };
    }

    const creds = selectedKey.credentials;

    if (creds.apiKey) {
      return { apiKey: creds.apiKey };
    }

    if (creds.key) {
      return { apiKey: creds.key };
    }

    if (creds.accessKeyId && creds.secretAccessKey) {
      Logger.warn(`[MembraneInference] AWS credentials detected but Bedrock not supported.`);
      return { apiKey: '' };
    }

    return { apiKey: '' };
  }

  private async prepareMessages(messages: Message[]): Promise<Message[]> {
    console.log(`[prepareMessages] Input: ${messages.length} msgs, cache ids: ${JSON.stringify(idsWithCacheControl(messages))}`);

    let prepared = messages;

    prepared = this.expandPrefixHistory(prepared);
    console.log(`[prepareMessages] After expandPrefixHistory: ${prepared.length} msgs, cache ids: ${JSON.stringify(idsWithCacheControl(prepared))}`);

    prepared = this.applyPostHocOps(prepared);
    console.log(`[prepareMessages] After applyPostHocOps: ${prepared.length} msgs, cache ids: ${JSON.stringify(idsWithCacheControl(prepared))}`);

    prepared = await this.resolveBlobIds(prepared);
    console.log(`[prepareMessages] After resolveBlobIds: ${prepared.length} msgs, cache ids: ${JSON.stringify(idsWithCacheControl(prepared))}`);

    return prepared;
  }

  private expandPrefixHistory(messages: Message[]): Message[] {
    if (messages.length === 0) return messages;

    const firstMessage = messages[0];
    const firstBranch = firstMessage.branches.find(b => b.id === firstMessage.activeBranchId);
    const prefixHistory = (firstBranch as any)?.prefixHistory as Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
      participantId?: string;
      participantName?: string;
      model?: string;
    }> | undefined;

    if (!prefixHistory || prefixHistory.length === 0) {
      return messages;
    }

    Logger.debug(`[MembraneInference] Expanding ${prefixHistory.length} prefixHistory entries`);

    const baseTimestamp = firstBranch?.createdAt
      ? new Date(firstBranch.createdAt)
      : new Date();

    const syntheticMessages: Message[] = prefixHistory.map((entry, index) => {
      const messageId = crypto.randomUUID();
      const branchId = crypto.randomUUID();

      return {
        id: messageId,
        conversationId: firstMessage.conversationId,
        branches: [{
          id: branchId,
          content: entry.content,
          role: entry.role,
          createdAt: new Date(baseTimestamp.getTime() + index),
          model: entry.model,
          participantId: entry.participantId,
        } as MessageBranch],
        activeBranchId: branchId,
        order: index
      };
    });

    return [
      ...syntheticMessages,
      ...messages.map((m, i) => ({ ...m, order: prefixHistory.length + i }))
    ];
  }

  private async resolveBlobIds(messages: Message[]): Promise<Message[]> {
    const blobStore = getBlobStore();
    const resolved: Message[] = [];

    for (const message of messages) {
      const branch = message.branches.find(b => b.id === message.activeBranchId);
      if (!branch?.contentBlocks) {
        resolved.push(message);
        continue;
      }

      const hasUnresolvedBlobs = branch.contentBlocks.some(
        (block: any) => block.type === 'image' && block.blobId && !block.data
      );

      if (!hasUnresolvedBlobs) {
        resolved.push(message);
        continue;
      }

      const resolvedBlocks = await Promise.all(
        branch.contentBlocks.map(async (block: any) => {
          if (block.type === 'image' && block.blobId && !block.data) {
            try {
              const blobResult = await blobStore.loadBlob(block.blobId);
              if (blobResult) {
                return { ...block, data: blobResult.data.toString('base64') };
              }
            } catch (error) {
              Logger.warn(`[MembraneInference] Failed to resolve blobId ${block.blobId}:`, error);
            }
          }
          return block;
        })
      );

      resolved.push({
        ...message,
        branches: message.branches.map(b =>
          b.id === message.activeBranchId
            ? { ...b, contentBlocks: resolvedBlocks }
            : b
        )
      });
    }

    return resolved;
  }

  private findAssistantName(participants: Participant[], responderId?: string): string {
    if (responderId) {
      const responder = participants.find(p => p.id === responderId);
      if (responder?.type === 'assistant') {
        return responder.name;
      }
    }
    return 'Claude';
  }

  /**
   * Create Membrane instance with appropriate formatter for provider
   *
   * FORMATTER SELECTION:
   * - anthropic + standard (1-on-1): NativeFormatter - uses API native tools
   * - anthropic + prefill (group chat): AnthropicXmlFormatter - prefill mode with XML tools
   * - openrouter: NativeFormatter - standard chat format, handles Claude/GPT/etc
   * - openai-compatible: NativeFormatter - standard chat format for local models
   */
  private createMembrane(
    provider: string,
    apiKey: string,
    endpoint?: string,
    assistantParticipant?: string,
    useNativeFormatter: boolean = false
  ): Membrane {
    let adapter;

    switch (provider) {
      case 'anthropic':
        adapter = new AnthropicAdapter({ apiKey });
        break;

      case 'openrouter':
        adapter = new OpenRouterAdapter({
          apiKey,
          httpReferer: 'https://animachat.local',
          xTitle: 'Animachat'
        });
        break;

      case 'openai-compatible':
        if (!endpoint) {
          throw new Error('OpenAI-compatible provider requires endpoint URL');
        }
        adapter = new OpenAICompatibleAdapter({
          baseURL: endpoint,
          apiKey,
          providerName: 'openai-compatible'
        });
        break;

      case 'bedrock':
      case 'google':
        throw new Error(
          `Provider "${provider}" not supported directly. ` +
          `Use OpenRouter to access ${provider} models.`
        );

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    console.log(`[MembraneInference] Creating Membrane for ${provider} with ${useNativeFormatter ? 'NativeFormatter' : 'AnthropicXmlFormatter (prefill)'}`);

    return new Membrane(adapter, {
      assistantParticipant: assistantParticipant || 'Claude',
      formatter: useNativeFormatter ? new NativeFormatter() : undefined,
    });
  }

  private applyPostHocOps(messages: Message[]): Message[] {
    const operations: Array<{ order: number; op: any }> = [];

    for (const msg of messages) {
      const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
      if (activeBranch?.postHocOperation) {
        operations.push({ order: msg.order, op: activeBranch.postHocOperation });
      }
    }

    if (operations.length === 0) {
      return messages;
    }

    const messageOrderById = new Map<string, number>();
    for (const msg of messages) {
      messageOrderById.set(msg.id, msg.order);
    }

    const hiddenMessageIds = new Set<string>();
    const messageEdits = new Map<string, AnimachatContentBlock[]>();
    const attachmentHides = new Map<string, Set<number>>();

    for (const { order, op } of operations.sort((a, b) => a.order - b.order)) {
      switch (op.type) {
        case 'hide':
          hiddenMessageIds.add(op.targetMessageId);
          break;

        case 'hide_before': {
          const targetOrder = messageOrderById.get(op.targetMessageId);
          if (targetOrder !== undefined) {
            for (const msg of messages) {
              if (msg.order < targetOrder) {
                hiddenMessageIds.add(msg.id);
              }
            }
          }
          break;
        }

        case 'edit':
          if (op.replacementContent) {
            messageEdits.set(op.targetMessageId, op.replacementContent);
          }
          break;

        case 'hide_attachment':
          if (op.attachmentIndices?.length > 0) {
            const existing = attachmentHides.get(op.targetMessageId) || new Set();
            for (const idx of op.attachmentIndices) {
              existing.add(idx);
            }
            attachmentHides.set(op.targetMessageId, existing);
          }
          break;

        case 'unhide':
          hiddenMessageIds.delete(op.targetMessageId);
          break;
      }
    }

    const result: Message[] = [];

    for (const msg of messages) {
      const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);

      if (activeBranch?.postHocOperation) continue;
      if (hiddenMessageIds.has(msg.id)) continue;

      const edit = messageEdits.get(msg.id);
      const hiddenAttachments = attachmentHides.get(msg.id);

      if (edit || hiddenAttachments) {
        const modifiedBranches = msg.branches.map(branch => {
          if (branch.id !== msg.activeBranchId) return branch;

          const modifiedBranch: MessageBranch = { ...branch };

          if (edit) {
            modifiedBranch.contentBlocks = edit;
            const textBlocks = edit.filter(b => b.type === 'text');
            modifiedBranch.content = textBlocks.map(b => (b as any).text).join('\n\n');
          }

          if (hiddenAttachments && modifiedBranch.attachments) {
            modifiedBranch.attachments = modifiedBranch.attachments.filter(
              (_, idx) => !hiddenAttachments.has(idx)
            );
          }

          return modifiedBranch;
        });

        result.push({ ...msg, branches: modifiedBranches });
      } else {
        result.push(msg);
      }
    }

    return result;
  }

  private convertMembraneContentBlock(block: ContentBlock): AnimachatContentBlock | null {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text || '' };

      case 'thinking':
        return {
          type: 'thinking',
          thinking: block.thinking,
          signature: block.signature
        };

      case 'redacted_thinking':
        return { type: 'redacted_thinking', data: '' };

      case 'generated_image':
        return {
          type: 'image',
          mimeType: block.mimeType,
          data: block.data
        };

      case 'tool_use':
        return {
          type: 'tool_use',
          id: (block as any).id || '',
          name: (block as any).name || '',
          input: (block as any).input || {},
        };

      case 'tool_result':
        return {
          type: 'tool_result',
          // Membrane uses camelCase (toolUseId), API uses snake_case (tool_use_id) — check both
          tool_use_id: (block as any).toolUseId || (block as any).tool_use_id || '',
          content: (block as any).content || '',
          is_error: (block as any).isError || (block as any).is_error || false,
        };

      default:
        return null;
    }
  }
}

export { MembraneInferenceService as default };
