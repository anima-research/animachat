import { Message, Conversation, Model, ModelSettings, Participant } from '@deprecated-claude/shared';
import { ContextManager } from './context-manager.js';
import { InferenceService } from './inference.js';
import { ContextWindow } from './context-strategies.js';

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
    streamCallback: (chunk: string, isComplete: boolean) => Promise<void>,
    conversation?: Conversation,
    participant?: Participant,
    onMetrics?: (metrics: any) => Promise<void>,
    participants?: Participant[]
  ): Promise<void> {
    // If no conversation provided, fall back to original behavior
    if (!conversation) {
      return this.inferenceService.streamCompletion(
        model.id,
        messages,
        systemPrompt,
        settings,
        userId,
        streamCallback
      );
    }
    
    // Prepare context using context manager
    const { formattedMessages, cacheKey, window } = await this.contextManager.prepareContext(
      conversation,
      messages,
      undefined, // newMessage is already included in messages
      participant
    );
    
    // Debug logging
    console.log(`Enhanced inference: ${window.messages.length} messages in window, ${window.cacheablePrefix.length} cacheable`);
    if (window.metadata.windowStart > 0) {
      console.log(`Context window: dropped ${window.metadata.windowStart} messages from beginning`);
    }
    
    // Track metrics
    const startTime = Date.now();
    let inputTokens = 0;
    let cachedTokens = 0;
    let outputTokens = 0;
    let cacheHit = false;
    
    // Create an enhanced callback to track token usage
    const enhancedCallback = async (chunk: string, isComplete: boolean) => {
      // Track output tokens (simplified - in practice would use tokenizer)
      outputTokens += Math.ceil(chunk.length / 4);
      
      await streamCallback(chunk, isComplete);
      
      if (isComplete) {
        // Log metrics
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
          estimatedCostSaved: this.calculateCostSaved(model, cachedTokens),
        };
        
        this.metricsLog.push(metric);
        
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
        
        // Log cache efficiency
        if (cachedTokens > 0) {
          const cacheEfficiency = (cachedTokens / inputTokens) * 100;
          console.log(`[Enhanced Inference] Cache efficiency: ${cacheEfficiency.toFixed(1)}% (${cachedTokens}/${inputTokens} tokens cached)`);
        }
        
        // Call metrics callback if provided
        if (onMetrics) {
          const endTime = Date.now();
          await onMetrics({
            inputTokens,
            outputTokens,
            cachedTokens,
            cost: this.calculateCost(model, inputTokens, outputTokens),
            cacheSavings: this.calculateCostSaved(model, cachedTokens),
            model: model.id,
            timestamp: new Date().toISOString(),
            responseTime: endTime - startTime
          });
        }
      }
    };
    
    // Track approximate input tokens
    inputTokens = window.metadata.totalTokens;
    cachedTokens = this.estimateTokens(window.cacheablePrefix);
    cacheHit = window.metadata.cacheKey === cacheKey;
    
    // For Anthropic models, we need to add cache control metadata
    let messagesToSend = window.messages;
    if (model.provider === 'anthropic' && window.cacheablePrefix.length > 0) {
      // Clone messages and add cache control to the last cacheable message
      messagesToSend = this.addCacheControlToMessages(window);
    }
    
    // Use the original messages from the window with cache control added if needed
    return this.inferenceService.streamCompletion(
      model.id,
      messagesToSend,
      systemPrompt,
      settings,
      userId,
      enhancedCallback,
      conversation?.format || 'standard',
      participants || [],
      participant?.id
    );
  }
  
  private addCacheControlToMessages(window: ContextWindow): Message[] {
    // Clone messages and add cache control metadata to the last cacheable message
    const cacheBreakpoint = window.cacheablePrefix.length;
    
    return window.messages.map((msg, idx) => {
      if (idx === cacheBreakpoint - 1 && cacheBreakpoint > 0) {
        // This is the last cacheable message - add cache control to its active branch
        const clonedMsg = JSON.parse(JSON.stringify(msg)); // Deep clone
        const activeBranch = clonedMsg.branches.find((b: any) => b.id === clonedMsg.activeBranchId);
        if (activeBranch) {
          // Add cache control metadata to the branch
          activeBranch._cacheControl = { type: 'ephemeral' };
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
  
  private calculateCostSaved(model: Model, cachedTokens: number): number {
    // Simplified cost calculation - in practice would use actual pricing
    const costPer1kTokens = {
      'claude-3-5-sonnet-20241022': 0.003,
      'claude-3-5-haiku-20241022': 0.00025,
      'claude-3-opus-20240229': 0.015,
    } as Record<string, number>;
    
    const rate = costPer1kTokens[model.id] || 0.001;
    // Cached tokens are 90% cheaper with Anthropic
    return (cachedTokens / 1000) * rate * 0.9;
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
  
  private calculateCost(model: Model, inputTokens: number, outputTokens: number): number {
    // Model pricing per 1M tokens
    const inputPricing: Record<string, number> = {
      'claude-3-5-sonnet-20241022': 3.00,
      'claude-3-5-haiku-20241022': 0.25,
      'claude-3-opus-20240229': 15.00,
      'claude-3-sonnet-20240229': 3.00,
      'claude-3-haiku-20240307': 0.25
    };
    
    const outputPricing: Record<string, number> = {
      'claude-3-5-sonnet-20241022': 15.00,
      'claude-3-5-haiku-20241022': 1.25,
      'claude-3-opus-20240229': 75.00,
      'claude-3-sonnet-20240229': 15.00,
      'claude-3-haiku-20240307': 1.25
    };
    
    const inputCost = (inputTokens * (inputPricing[model.id] || 3.00)) / 1_000_000;
    const outputCost = (outputTokens * (outputPricing[model.id] || 15.00)) / 1_000_000;
    
    return inputCost + outputCost;
  }
}