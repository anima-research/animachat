import { Message, Conversation, Model, ModelSettings, Participant } from '@deprecated-claude/shared';
import { ContextManager } from './context-manager.js';
import { InferenceService } from './inference.js';

interface CacheMetrics {
  conversationId: string;
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
    responderId?: string
  ): Promise<void> {
    // If no conversation provided, fall back to original behavior
    if (!conversation) {
      return this.inferenceService.streamCompletion(
        model,
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
      messages
    );
    
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
          timestamp: new Date(),
          provider: model.provider,
          model: model.name,
          cacheHit,
          inputTokens,
          cachedTokens,
          outputTokens,
          estimatedCostSaved: this.calculateCostSaved(model, cachedTokens),
        };
        
        this.metricsLog.push(metric);
        
        // Update context manager statistics
        this.contextManager.updateAfterInference(conversation.id, {
          cacheHit,
          tokensUsed: inputTokens + outputTokens,
          cachedTokens,
        });
      }
    };
    
    // For Anthropic models, add cache control
    if (model.provider === 'anthropic' && cacheKey) {
      // Enhance messages with cache control for Anthropic
      const anthropicMessages = this.addAnthropicCacheControl(formattedMessages, window);
      
      // Track approximate input tokens
      inputTokens = this.estimateTokens(formattedMessages);
      cachedTokens = this.estimateTokens(window.cacheablePrefix);
      cacheHit = window.metadata.cacheKey === cacheKey;
      
      // Call original service with enhanced messages
      return this.inferenceService.streamCompletion(
        model,
        anthropicMessages as Message[],
        systemPrompt,
        settings,
        userId,
        enhancedCallback
      );
    }
    
    // For other providers, use formatted messages as-is
    return this.inferenceService.streamCompletion(
      model,
      formattedMessages as Message[],
      systemPrompt,
      settings,
      userId,
      enhancedCallback
    );
  }
  
  private addAnthropicCacheControl(messages: any[], window: ContextWindow): any[] {
    // Add cache_control to the last message in the cacheable prefix
    const cacheBreakpoint = window.cacheablePrefix.length;
    
    return messages.map((msg, idx) => {
      if (idx === cacheBreakpoint - 1 && cacheBreakpoint > 0) {
        // This is the last cacheable message
        return {
          ...msg,
          cache_control: { type: 'ephemeral' }
        };
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
  getCacheMetrics(conversationId?: string): CacheMetrics[] {
    if (conversationId) {
      return this.metricsLog.filter(m => m.conversationId === conversationId);
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
  
  // Context strategy management
  setContextStrategy(conversationId: string, strategy: 'rolling' | 'static' | 'adaptive'): void {
    this.contextManager.setStrategy(conversationId, strategy);
  }
  
  getContextStatistics(conversationId: string) {
    return this.contextManager.getStatistics(conversationId);
  }
}

