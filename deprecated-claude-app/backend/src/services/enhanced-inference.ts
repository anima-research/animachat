import { Message, Conversation, Model, ModelSettings, Participant, GrantUsageDetails, GrantTokenUsage } from '@deprecated-claude/shared';
import { ContextManager } from './context-manager.js';
import { InferenceService } from './inference.js';
import { ContextWindow } from './context-strategies.js';
import { Logger } from '../utils/logger.js';
import { ConfigLoader } from '../config/loader.js';
import { getOpenRouterPricing } from './pricing-cache.js';

// Custom error type for pricing issues
export class PricingNotConfiguredError extends Error {
  constructor(public modelId: string, public provider: string, public providerModelId?: string) {
    super(`Pricing not configured for model "${modelId}" (provider: ${provider}, providerModelId: ${providerModelId || 'none'})`);
    this.name = 'PricingNotConfiguredError';
  }
}

interface CacheMetrics {
  conversationId: string;
  participantId?: string;
  timestamp: Date;
  provider: string;
  model: string;
  cacheHit: boolean;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  estimatedCostSaved: number;
}

type CostBreakdown = {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  inputPrice: number;
  outputPrice: number;
};

// ============================================================================
// ⚠️ AUTHORITATIVE PRICING SOURCE - Update here when prices change!
// ============================================================================
// This is the single source of truth for Anthropic model pricing
// Used for: UI metrics, cost calculations, savings display
// 
// Note: anthropic.ts and openrouter.ts have their own pricing tables
// but those are ONLY for console logging. Update those optionally for
// accurate log messages, but UI always uses THIS table.
//
// Update when:
// - Anthropic changes pricing
// - New models are released
// - Provider model IDs change
// ============================================================================

const INPUT_PRICING_PER_MILLION: Record<string, number> = {
  // Claude 4.x models (2025) - by providerModelId
  'claude-opus-4-5-20251101': 5.00,
  'claude-opus-4-1-20250805': 15.00,
  'claude-opus-4-20250514': 15.00,
  'claude-sonnet-4-5-20250929': 3.00,
  'claude-sonnet-4-20250514': 3.00,
  'claude-haiku-4-5-20251001': 0.80,
  
  // Claude 3.x models - by providerModelId
  'claude-3-7-sonnet-20250219': 3.00,
  'claude-3-5-sonnet-20241022': 3.00,
  'claude-3-5-sonnet-20240620': 3.00,
  'claude-3-5-haiku-20241022': 0.80,
  'claude-3-opus-20240229': 15.00,
  'claude-3-sonnet-20240229': 3.00,
  'claude-3-haiku-20240307': 0.25,
  
  // Shorthand model IDs (for backwards compatibility / fallback)
  'claude-opus-4.5': 5.00,
  'claude-opus-4.1': 15.00,
  'claude-opus-4': 15.00,
  'claude-sonnet-4.5': 3.00,
  'claude-sonnet-4': 3.00,
  'claude-haiku-4.5': 0.80,
  'claude-3.7-sonnet': 3.00,
  'claude-3.5-sonnet': 3.00,
  'claude-3.5-haiku': 0.80,
  'claude-3-opus': 15.00,
  'claude-3-sonnet': 3.00,
  'claude-3-haiku': 0.25,
  
  // Bedrock model IDs (internal Arc model IDs)
  'claude-3-opus-bedrock': 15.00,
  'claude-3-sonnet-bedrock': 3.00,
  'claude-3-haiku-bedrock': 0.25,
  'claude-3.5-sonnet-bedrock': 9.00,
  'claude-3.6-sonnet-bedrock': 9.00,  // Same as 3.5 sonnet v2
  'claude-3.5-haiku-bedrock': 0.80,
  
  // Bedrock provider model IDs (AWS format)
  'anthropic.claude-3-5-sonnet-20241022-v2:0': 9.00,
  'anthropic.claude-3-5-sonnet-20240620-v1:0': 9.00,
  'anthropic.claude-3-opus-20240229-v1:0': 15.00,
  'anthropic.claude-3-sonnet-20240229-v1:0': 3.00,
  'anthropic.claude-3-haiku-20240307-v1:0': 0.25,
  
  // OpenRouter model IDs (anthropic/*)
  'anthropic/claude-opus-4.5': 5.00,
  'anthropic/claude-sonnet-4': 3.00,
  'anthropic/claude-3.5-sonnet': 3.00,
  'anthropic/claude-3.5-sonnet:beta': 3.00,
  'anthropic/claude-3-opus': 15.00,
  'anthropic/claude-3-sonnet': 3.00,
  'anthropic/claude-3-haiku': 0.25,
  
  // Google Gemini models (direct API) - pricing as of Dec 2025
  // Gemini 2.5 Flash
  'gemini-2.5-flash-preview-05-20': 0.15,
  'gemini-2.5-flash': 0.15,
  'gemini-2.5-flash-image': 0.15, // Image-capable variant
  
  // Gemini 2.5 Pro
  'gemini-2.5-pro-preview-05-06': 1.25,
  'gemini-2.5-pro': 1.25,
  
  // Gemini 3 Pro (preview pricing, may change)
  'gemini-3-pro-preview': 1.25,
  'gemini-3-pro-image-preview': 1.25,
  
  // Shorthand Gemini IDs
  'gemini-2.5-flash-imagegen': 0.15,
  'gemini-2.5-flash-image-imagegen': 0.15,
  'gemini-3-pro-imagegen': 1.25,
};

const OUTPUT_PRICING_PER_MILLION: Record<string, number> = {
  // Claude 4.x models (2025) - by providerModelId
  'claude-opus-4-5-20251101': 25.00,
  'claude-opus-4-1-20250805': 75.00,
  'claude-opus-4-20250514': 75.00,
  'claude-sonnet-4-5-20250929': 15.00,
  'claude-sonnet-4-20250514': 15.00,
  'claude-haiku-4-5-20251001': 4.00,
  
  // Claude 3.x models - by providerModelId
  'claude-3-7-sonnet-20250219': 15.00,
  'claude-3-5-sonnet-20241022': 15.00,
  'claude-3-5-sonnet-20240620': 15.00,
  'claude-3-5-haiku-20241022': 4.00,
  'claude-3-opus-20240229': 75.00,
  'claude-3-sonnet-20240229': 15.00,
  'claude-3-haiku-20240307': 1.25,
  
  // Shorthand model IDs (for backwards compatibility / fallback)
  'claude-opus-4.5': 25.00,
  'claude-opus-4.1': 75.00,
  'claude-opus-4': 75.00,
  'claude-sonnet-4.5': 15.00,
  'claude-sonnet-4': 15.00,
  'claude-haiku-4.5': 4.00,
  'claude-3.7-sonnet': 15.00,
  'claude-3.5-sonnet': 15.00,
  'claude-3.5-haiku': 4.00,
  'claude-3-opus': 75.00,
  'claude-3-sonnet': 15.00,
  'claude-3-haiku': 1.25,
  
  // Bedrock model IDs (internal Arc model IDs)
  'claude-3-opus-bedrock': 75.00,
  'claude-3-sonnet-bedrock': 45.00,
  'claude-3-haiku-bedrock': 1.25,
  'claude-3.5-sonnet-bedrock': 45.00,
  'claude-3.6-sonnet-bedrock': 45.00,  // Same as 3.5 sonnet v2
  'claude-3.5-haiku-bedrock': 4.00,
  
  // Bedrock provider model IDs (AWS format)
  'anthropic.claude-3-5-sonnet-20241022-v2:0': 45.00,
  'anthropic.claude-3-5-sonnet-20240620-v1:0': 45.00,
  'anthropic.claude-3-opus-20240229-v1:0': 75.00,
  'anthropic.claude-3-sonnet-20240229-v1:0': 45.00,
  'anthropic.claude-3-haiku-20240307-v1:0': 1.25,
  
  // OpenRouter model IDs (anthropic/*)
  'anthropic/claude-opus-4.5': 25.00,
  'anthropic/claude-sonnet-4': 15.00,
  'anthropic/claude-3.5-sonnet': 15.00,
  'anthropic/claude-3.5-sonnet:beta': 15.00,
  'anthropic/claude-3-opus': 75.00,
  'anthropic/claude-3-sonnet': 15.00,
  'anthropic/claude-3-haiku': 1.25,
  
  // Google Gemini models (direct API) - pricing as of Dec 2025
  // Gemini 2.5 Flash (text output: $0.60/M, image output: $0.0315/image)
  'gemini-2.5-flash-preview-05-20': 0.60,
  'gemini-2.5-flash': 0.60,
  'gemini-2.5-flash-image': 0.60,
  
  // Gemini 2.5 Pro (text output: $10/M for >200k context, $5/M for <200k)
  'gemini-2.5-pro-preview-05-06': 5.00,
  'gemini-2.5-pro': 5.00,
  
  // Gemini 3 Pro (preview pricing)
  'gemini-3-pro-preview': 5.00,
  'gemini-3-pro-image-preview': 5.00,
  
  // Shorthand Gemini IDs
  'gemini-2.5-flash-imagegen': 0.60,
  'gemini-2.5-flash-image-imagegen': 0.60,
  'gemini-3-pro-imagegen': 5.00,
};

const CACHE_DISCOUNT = 0.9;

/**
 * Validate that pricing is available for a model BEFORE making inference calls.
 * Call this to prevent sending requests to models without cost tracking.
 * 
 * @param model The model to check pricing for
 * @param db Database instance for admin-configured pricing lookup
 * @returns { valid: true } if pricing is available, or { valid: false, error: string } if not
 */
export async function validatePricingAvailable(
  model: Model,
  db?: { getAdminPricingConfig?: (provider: string, modelId: string, providerModelId?: string) => Promise<any> }
): Promise<{ valid: true } | { valid: false; error: string }> {
  
  // 0. User-defined custom models bypass pricing validation
  // These are models the user created themselves (identified by UUID ID or customEndpoint)
  // The user accepts responsibility for costs when they set up their own API key/endpoint
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(model.id);
  const hasCustomEndpoint = 'customEndpoint' in model && model.customEndpoint;
  if (isUUID || hasCustomEndpoint) {
    console.log(`[Pricing] Bypassing validation for user-defined model "${model.displayName}" (${model.id})`);
    return { valid: true };
  }
  
  // 1. Check admin-configured pricing
  if (db?.getAdminPricingConfig) {
    try {
      const configPricing = await db.getAdminPricingConfig(model.provider, model.id, model.providerModelId);
      if (configPricing) {
        return { valid: true };
      }
    } catch (e) {
      // Admin config lookup failed, continue to other sources
    }
  }
  
  // 2. For OpenRouter models, check the cached pricing
  if (model.provider === 'openrouter' && model.providerModelId) {
    const orPricing = getOpenRouterPricing(model.providerModelId);
    if (orPricing) {
      return { valid: true };
    }
  }
  
  // 3. Check hardcoded pricing table
  const inputPrice = INPUT_PRICING_PER_MILLION[model.providerModelId || ''] 
    ?? INPUT_PRICING_PER_MILLION[model.id];
  const outputPrice = OUTPUT_PRICING_PER_MILLION[model.providerModelId || ''] 
    ?? OUTPUT_PRICING_PER_MILLION[model.id];
  
  if (inputPrice !== undefined && outputPrice !== undefined) {
    return { valid: true };
  }
  
  // No pricing found - this is an error
  return { 
    valid: false, 
    error: `Pricing not configured for model "${model.id}" (provider: ${model.provider}). Configure in Admin panel or add to hardcoded pricing table.`
  };
}

/**
 * Enhanced inference service that integrates context management
 * This is a wrapper around the existing InferenceService that adds
 * context management capabilities while maintaining backward compatibility
 */
export class EnhancedInferenceService {
  private contextManager: ContextManager;
  private inferenceService: InferenceService;
  private metricsLog: CacheMetrics[] = [];
  
  constructor(
    inferenceService: InferenceService,
    contextManager?: ContextManager
  ) {
    this.inferenceService = inferenceService;
    this.contextManager = contextManager || new ContextManager();
  }
  
  async streamCompletion(
    model: Model,
    messages: Message[],
    systemPrompt: string,
    settings: ModelSettings,
    userId: string,
    streamCallback: (chunk: string, isComplete: boolean, contentBlocks?: any[]) => Promise<void>,
    conversation?: Conversation,
    participant?: Participant,
    onMetrics?: (metrics: any) => Promise<void>,
    participants?: Participant[],
    abortSignal?: AbortSignal
  ): Promise<void> {
    // If no conversation provided, fall back to original behavior
    if (!conversation) {
      await this.inferenceService.streamCompletion(
        model.id,
        messages,
        systemPrompt,
        settings,
        userId,
        streamCallback,
        'standard',
        participants || [],
        undefined,
        undefined
      );
      return;
    }
    
    // Prepare context using context manager
    const { formattedMessages, cacheKey, window } = await this.contextManager.prepareContext(
      conversation,
      messages,
      undefined, // newMessage is already included in messages
      participant,
      model.contextWindow // Pass model's max context for cache arithmetic
    );
    
    // Debug logging with visual indicators
    const hasCaching = window.cacheablePrefix.length > 0;
    const hasRotation = window.metadata.windowStart > 0;
    
    if (hasCaching || hasRotation) {
      Logger.context(`\n🎯 ============== CONTEXT STATUS ==============`);
      Logger.context(`📄 Messages: ${window.messages.length} in window (${window.metadata.totalMessages} total)`);
      
      if (hasCaching) {
        Logger.context(`📦 Cacheable: ${window.cacheablePrefix.length} messages marked for caching`);
        Logger.context(`🆕 Active: ${window.activeWindow.length} messages will be processed fresh`);
      }
      
      if (hasRotation) {
        Logger.context(`🔄 Rotation: Dropped ${window.metadata.windowStart} old messages`);
      }
      
      Logger.context(`📊 Tokens: ${window.metadata.totalTokens} total`);
      
      if (window.cacheMarkers && window.cacheMarkers.length > 0) {
        Logger.context(`🎯 Cache points: ${window.cacheMarkers.length} markers`);
        window.cacheMarkers.forEach((m, i) => {
          Logger.context(`🎯   Point ${i + 1}: Message ${m.messageIndex} (${m.tokenCount} tokens)`);
        });
      } else if (window.cacheMarker) {
        Logger.context(`🎯 Cache point: Message ${window.cacheMarker.messageIndex} (${window.cacheMarker.tokenCount} tokens)`);
      }
      Logger.context(`🎯 =========================================\n`);
    } else {
      Logger.debug(`[EnhancedInference] Context: ${window.messages.length} messages, ${window.metadata.totalTokens} tokens`);
    }
    
    // Track metrics
    const startTime = Date.now();
    let inputTokens = 0;
    let cachedTokens = 0;
    let outputTokens = 0;
    let cacheHit = false;
    let expectedCache = false;
    
    // Create an enhanced callback to track token usage
    const enhancedCallback = async (chunk: string, isComplete: boolean, contentBlocks?: any[], actualUsage?: any) => {
      // Check if generation was aborted
      if (abortSignal?.aborted) {
        throw new Error('Generation aborted');
      }
      
      // Track output tokens (simplified - in practice would use tokenizer)
      outputTokens += Math.ceil(chunk.length / 4);
      
      await streamCallback(chunk, isComplete, contentBlocks);
      
      if (isComplete) {
        // Update with actual usage from API if provided
        if (actualUsage) {
          // Provider semantics (both Anthropic and OpenRouter now match):
          // - inputTokens = fresh (non-cached) tokens only
          // - cacheCreationInputTokens = tokens written to cache
          // - cacheReadInputTokens = tokens read from cache
          // Total prompt = fresh + cache_creation + cache_read
          const freshTokens = actualUsage.inputTokens;
          const cacheCreation = actualUsage.cacheCreationInputTokens || 0;
          const cacheRead = actualUsage.cacheReadInputTokens || 0;
          
          inputTokens = freshTokens + cacheCreation + cacheRead; // TOTAL input
          outputTokens = actualUsage.outputTokens;
          // Cache size: creation OR read (whichever is non-zero shows current cache size)
          cachedTokens = cacheRead > 0 ? cacheRead : cacheCreation;
          cacheHit = cacheRead > 0;
          
          Logger.cache(`[EnhancedInference] ✅ Actual usage: fresh=${freshTokens}, cacheCreate=${cacheCreation}, cacheRead=${cacheRead}, output=${outputTokens}`);
          Logger.cache(`[EnhancedInference]   Total input=${inputTokens}, cache size=${cachedTokens}`);
        }
        
        // Log metrics
        const estimatedSaved = await this.calculateCostSaved(model, cachedTokens);
        const metric: CacheMetrics = {
          conversationId: conversation.id,
          participantId: participant?.id,
          timestamp: new Date(),
          provider: model.provider,
          model: model.displayName,
          cacheHit,
          inputTokens,
          cachedTokens,
          outputTokens,
          estimatedCostSaved: estimatedSaved,
        };
        
        this.metricsLog.push(metric);
        
        // Note: Cache hit/miss details are logged by the provider service (Anthropic/OpenRouter)
        // which has access to the actual API response metrics. We just track expected vs actual
        // in our context manager statistics below.
        
        // Update context manager statistics
        this.contextManager.updateAfterInference(
          conversation.id, 
          {
            cacheHit,
            tokensUsed: inputTokens + outputTokens,
            cachedTokens,
          },
          participant?.id
        );
        
        // Call metrics callback if provided
        if (onMetrics) {
          const endTime = Date.now();
          const breakdown = await this.calculateCostBreakdown(model, inputTokens, outputTokens);
          const savings = await this.calculateCostSaved(model, cachedTokens);
          await onMetrics({
            inputTokens,
            outputTokens,
            cachedTokens,
            cost: Math.max(breakdown.totalCost - savings, 0),
            cacheSavings: savings,
            model: model.id,
            timestamp: new Date().toISOString(),
            responseTime: endTime - startTime,
            details: this.buildUsageDetails(breakdown, inputTokens, outputTokens, cachedTokens),
            // Pass through failure info if present (for failed request tracking)
            ...(actualUsage?.failed && { failed: true }),
            ...(actualUsage?.error && { error: actualUsage.error })
          });
        }
      }
    };
    
    // Track approximate input tokens
    inputTokens = window.metadata.totalTokens;
    cachedTokens = this.estimateTokens(window.cacheablePrefix);
    expectedCache = window.cacheablePrefix.length > 0 && window.metadata.cacheKey === cacheKey;
    cacheHit = false; // Will be determined from actual response
    
    // For Anthropic models (direct or via OpenRouter), we need to add cache control metadata
    // 
    // CACHING APPROACHES BY PROVIDER:
    // - Anthropic direct with prefill: Use Chapter II approach - insert text breakpoints into prefill blob
    // - Anthropic direct with standard: Use message-level cache_control
    // - OpenRouter with prefill: OpenRouter converts to messages mode, use message-level cache_control
    // - OpenRouter with standard: Use message-level cache_control
    //
    const isPrefillFormat = conversation?.format === 'prefill';
    const isAnthropicDirect = model.provider === 'anthropic' || model.provider === 'bedrock';
    
    // For Anthropic direct + prefill: use Chapter II approach (text breakpoints)
    // For everything else (standard format, or OpenRouter which converts to messages): use message-level cache_control
    const useTextBreakpoints = isPrefillFormat && isAnthropicDirect;
    
    // DEBUG: Log the cache control decision factors
    console.log(`[EnhancedInference] Cache control decision:`, {
      conversationFormat: conversation?.format,
      isPrefillFormat,
      isAnthropicDirect,
      useTextBreakpoints,
      provider: model.provider,
      cacheablePrefixLength: window.cacheablePrefix.length
    });
    
    let messagesToSend = window.messages;
    let cacheMarkerIndices: number[] | undefined;
    
    if (useTextBreakpoints) {
      // Chapter II approach for Anthropic prefill: pass cache marker indices to inference
      // These will be inserted as <|cache_breakpoint|> text markers in the prefill blob
      const markers = window.cacheMarkers || (window.cacheMarker ? [window.cacheMarker] : []);
      if (markers.length > 0) {
        cacheMarkerIndices = markers.map(m => m.messageIndex);
        Logger.cache(`[EnhancedInference] 📦 Chapter II caching for Anthropic prefill: ${markers.length} breakpoints`);
        markers.forEach((m, i) => {
          Logger.cache(`[EnhancedInference]   Breakpoint ${i + 1}: after message ${m.messageIndex} (${m.tokenCount} tokens)`);
        });
      } else {
        Logger.cache(`[EnhancedInference] No cache markers for prefill (messages=${window.messages.length})`);
      }
    } else if ((model.provider === 'anthropic' || model.provider === 'openrouter') && window.cacheablePrefix.length > 0) {
      // Message-level cache_control for standard format or OpenRouter
      Logger.cache(`[EnhancedInference] Adding message-level cache control for ${model.provider} (${model.id})`);
      messagesToSend = this.addCacheControlToMessages(window, model);
    } else {
      Logger.debug(`[EnhancedInference] No cache control: provider=${model.provider}, cacheablePrefix=${window.cacheablePrefix.length}`);
    }
    
    // Call inference (actual usage will be passed through the callback)
    await this.inferenceService.streamCompletion(
      model.id,
      messagesToSend,
      systemPrompt,
      settings,
      userId,
      enhancedCallback,
      conversation?.format || 'standard',
      participants || [],
      participant?.id,
      conversation,
      cacheMarkerIndices  // Pass cache marker indices for Chapter II prefill caching
    );
  }
  
  private addCacheControlToMessages(window: ContextWindow, model?: Model): Message[] {
    // Use multiple cache markers if available (Anthropic supports 4)
    const markers = window.cacheMarkers || (window.cacheMarker ? [window.cacheMarker] : []);
    
    if (markers.length === 0) {
      return window.messages; // No caching
    }
    
    // All models get 1-hour cache - MUST specify ttl explicitly for OpenRouter!
    const cacheControl = { type: 'ephemeral' as const, ttl: '1h' as const };
    
    // Create a set of message indices that should get cache control
    const cacheIndices = new Set(markers.map(m => m.messageIndex));
    
    Logger.cache(`[EnhancedInference] 📦 Adding cache control to ${cacheIndices.size} messages (TTL: 1h):`);
    markers.forEach((m, i) => {
      Logger.cache(`[EnhancedInference]   Cache point ${i + 1}: message ${m.messageIndex} (${m.tokenCount} tokens)`);
    });
    
    return window.messages.map((msg, idx) => {
      if (cacheIndices.has(idx)) {
        // This message should get cache control
        const clonedMsg = JSON.parse(JSON.stringify(msg)); // Deep clone
        const activeBranch = clonedMsg.branches.find((b: any) => b.id === clonedMsg.activeBranchId);
        if (activeBranch) {
          activeBranch._cacheControl = cacheControl;
        }
        return clonedMsg;
      }
      return msg;
    });
  }
  
  private estimateTokens(content: any): number {
    // Simplified token estimation - in practice use tiktoken or similar
    if (Array.isArray(content)) {
      return content.reduce((sum, item) => {
        const text = typeof item === 'string' ? item : item.content || '';
        return sum + Math.ceil(text.length / 4);
      }, 0);
    }
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    return Math.ceil(text.length / 4);
  }
  
  private async calculateCostSaved(model: Model, cachedTokens: number): Promise<number> {
    const pricePerToken = await this.getInputPricePerToken(model);
    return cachedTokens * pricePerToken * CACHE_DISCOUNT;
  }

  private async calculateCostBreakdown(model: Model, inputTokens: number, outputTokens: number): Promise<CostBreakdown> {
    const inputPrice = await this.getInputPricePerToken(model);
    const outputPrice = await this.getOutputPricePerToken(model);
    const inputCost = inputTokens * inputPrice;
    const outputCost = outputTokens * outputPrice;

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      inputPrice,
      outputPrice
    };
  }

  private buildUsageDetails(
    breakdown: CostBreakdown,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number
  ): GrantUsageDetails {
    const details: GrantUsageDetails = {};

    if (inputTokens > 0) {
      details.input = this.createTokenUsage(breakdown.inputPrice, inputTokens);
    }

    if (outputTokens > 0) {
      details.output = this.createTokenUsage(breakdown.outputPrice, outputTokens);
    }

    if (cachedTokens > 0) {
      const cachedPrice = -breakdown.inputPrice * CACHE_DISCOUNT;
      details.cached_input = this.createTokenUsage(cachedPrice, cachedTokens);
    }

    return details;
  }

  private createTokenUsage(price: number, tokens: number, credits?: number): GrantTokenUsage {
    return {
      price,
      tokens,
      credits: credits === undefined ? tokens * price : credits
    };
  }

  /**
   * Look up pricing from admin config for a specific provider and model.
   * Returns { input, output } in per-million rates, or null if not configured.
   */
  private async getConfigPricing(provider: string, modelId: string, providerModelId?: string): Promise<{ input: number; output: number } | null> {
    try {
      const configLoader = ConfigLoader.getInstance();
      const config = await configLoader.loadConfig();
      const profiles = config.providers[provider as keyof typeof config.providers];
      
      if (!profiles || profiles.length === 0) return null;
      
      // Search through all profiles for this provider
      for (const profile of profiles) {
        if (profile.modelCosts) {
          // Try to find by providerModelId first, then modelId
          const modelCost = profile.modelCosts.find(mc => 
            mc.modelId === providerModelId || mc.modelId === modelId
          );
          
          if (modelCost) {
            console.log(`[Pricing] Using admin config pricing for ${modelId} (provider: ${provider})`);
            return {
              input: modelCost.providerCost.inputTokensPerMillion,
              output: modelCost.providerCost.outputTokensPerMillion
            };
          }
        }
      }
      
      return null;
    } catch (error) {
      console.warn('[Pricing] Error loading config pricing:', error);
      return null;
    }
  }

  private async getInputPricePerToken(model: Model): Promise<number> {
    // 1. Try admin-configured pricing first
    const configPricing = await this.getConfigPricing(model.provider, model.id, model.providerModelId);
    if (configPricing) {
      return configPricing.input / 1_000_000;
    }
    
    // 2. For OpenRouter models, check the cached pricing from their API
    if (model.provider === 'openrouter' && model.providerModelId) {
      const orPricing = getOpenRouterPricing(model.providerModelId);
      if (orPricing) {
        console.log(`[Pricing] Using cached OpenRouter pricing for ${model.providerModelId}`);
        return orPricing.input / 1_000_000;
      }
    }
    
    // 3. Fallback to hardcoded pricing table
    const price = INPUT_PRICING_PER_MILLION[model.providerModelId || ''] 
      ?? INPUT_PRICING_PER_MILLION[model.id];
    
    if (price === undefined) {
      // Throw error instead of silently returning $0 - prevents untracked charges
      throw new PricingNotConfiguredError(model.id, model.provider, model.providerModelId);
    }
    
    return price / 1_000_000;
  }

  private async getOutputPricePerToken(model: Model): Promise<number> {
    // 1. Try admin-configured pricing first
    const configPricing = await this.getConfigPricing(model.provider, model.id, model.providerModelId);
    if (configPricing) {
      return configPricing.output / 1_000_000;
    }
    
    // 2. For OpenRouter models, check the cached pricing from their API
    if (model.provider === 'openrouter' && model.providerModelId) {
      const orPricing = getOpenRouterPricing(model.providerModelId);
      if (orPricing) {
        return orPricing.output / 1_000_000;
      }
    }
    
    // 3. Fallback to hardcoded pricing table
    const price = OUTPUT_PRICING_PER_MILLION[model.providerModelId || ''] 
      ?? OUTPUT_PRICING_PER_MILLION[model.id];
    
    if (price === undefined) {
      // Throw error instead of silently returning $0 - prevents untracked charges
      throw new PricingNotConfiguredError(model.id, model.provider, model.providerModelId);
    }
    
    return price / 1_000_000;
  }
  
  // Analytics methods
  getCacheMetrics(conversationId?: string, participantId?: string): CacheMetrics[] {
    if (conversationId) {
      return this.metricsLog.filter(m => 
        m.conversationId === conversationId && 
        (!participantId || m.participantId === participantId)
      );
    }
    return [...this.metricsLog];
  }
  
  getCacheSavings(since?: Date): {
    totalSaved: number;
    byModel: Record<string, number>;
    cacheHitRate: number;
  } {
    const relevantMetrics = since 
      ? this.metricsLog.filter(m => m.timestamp >= since)
      : this.metricsLog;
    
    const totalSaved = relevantMetrics.reduce((sum, m) => sum + m.estimatedCostSaved, 0);
    
    const byModel = relevantMetrics.reduce((acc, m) => {
      acc[m.model] = (acc[m.model] || 0) + m.estimatedCostSaved;
      return acc;
    }, {} as Record<string, number>);
    
    const cacheHits = relevantMetrics.filter(m => m.cacheHit).length;
    const cacheHitRate = relevantMetrics.length > 0 
      ? cacheHits / relevantMetrics.length 
      : 0;
    
    return { totalSaved, byModel, cacheHitRate };
  }
  
  // Context strategy management (deprecated - use setContextManagement instead)
  setContextStrategy(conversationId: string, strategy: 'rolling' | 'static' | 'adaptive'): void {
    console.warn('setContextStrategy is deprecated. Use setContextManagement instead.');
  }
  
  setContextManagement(conversationId: string, contextManagement: any, participantId?: string): void {
    this.contextManager.setContextManagement(conversationId, contextManagement, participantId);
  }
  
  getContextStatistics(conversationId: string, participantId?: string) {
    return this.contextManager.getStatistics(conversationId, participantId);
  }
  
  getCacheMarker(conversationId: string, participantId?: string) {
    return this.contextManager.getCacheMarker(conversationId, participantId);
  }
  
}