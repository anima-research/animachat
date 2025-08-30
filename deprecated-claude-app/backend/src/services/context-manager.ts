import { Message, Conversation } from '@deprecated-claude/shared';
import { 
  ContextStrategy, 
  ContextWindow, 
  RollingContextStrategy, 
  StaticContextStrategy,
  AdaptiveContextStrategy 
} from './context-strategies.js';

interface ContextState {
  conversationId: string;
  strategy: string;
  lastWindow?: ContextWindow;
  cacheKeys: Map<string, string>; // message ID -> cache key
  statistics: {
    cacheHits: number;
    cacheMisses: number;
    totalTokensSaved: number;
    rotationCount: number;
  };
}

export interface ContextManagerConfig {
  defaultStrategy: 'rolling' | 'static' | 'adaptive';
  enableCaching: boolean;
  cachePrefix?: string;
}

export class ContextManager {
  private strategies: Map<string, ContextStrategy>;
  private states: Map<string, ContextState>;
  private config: ContextManagerConfig;
  
  constructor(config: Partial<ContextManagerConfig> = {}) {
    this.config = {
      defaultStrategy: 'rolling',
      enableCaching: true,
      cachePrefix: 'arc-cache',
      ...config
    };
    
    this.strategies = new Map([
      ['rolling', new RollingContextStrategy()],
      ['static', new StaticContextStrategy()],
      ['adaptive', new AdaptiveContextStrategy()],
    ]);
    
    this.states = new Map();
  }
  
  async prepareContext(
    conversation: Conversation,
    messages: Message[],
    newMessage?: Message
  ): Promise<{
    formattedMessages: any[]; // Provider-specific format
    cacheKey?: string;
    window: ContextWindow;
  }> {
    const strategyName = conversation.settings?.contextStrategy || this.config.defaultStrategy;
    const strategy = this.strategies.get(strategyName) || this.strategies.get(this.config.defaultStrategy)!;
    
    // Get or create state
    const state = this.getOrCreateState(conversation.id, strategyName);
    
    // Prepare context window
    const window = strategy.prepareContext(messages, newMessage);
    
    // Check if we should rotate
    if (state.lastWindow && strategy.shouldRotate(window)) {
      state.statistics.rotationCount++;
      console.log(`Context rotation triggered for conversation ${conversation.id}`);
    }
    
    // Generate cache key for the cacheable prefix
    const cacheKey = this.generateCacheKey(window.cacheablePrefix);
    
    // Check if this is a cache hit
    if (state.lastWindow?.metadata.cacheKey === cacheKey) {
      state.statistics.cacheHits++;
    } else {
      state.statistics.cacheMisses++;
    }
    
    // Update state
    state.lastWindow = window;
    window.metadata.cacheKey = cacheKey;
    
    // Format messages for the provider (will be enhanced later)
    const formattedMessages = this.formatMessages(window.messages, conversation);
    
    return {
      formattedMessages,
      cacheKey: this.config.enableCaching ? cacheKey : undefined,
      window,
    };
  }
  
  updateAfterInference(
    conversationId: string,
    response: {
      cacheHit: boolean;
      tokensUsed: number;
      cachedTokens?: number;
    }
  ): void {
    const state = this.states.get(conversationId);
    if (!state) return;
    
    if (response.cachedTokens) {
      state.statistics.totalTokensSaved += response.cachedTokens;
    }
  }
  
  getStatistics(conversationId: string): ContextState['statistics'] | null {
    const state = this.states.get(conversationId);
    return state?.statistics || null;
  }
  
  setStrategy(conversationId: string, strategyName: string): void {
    const strategy = this.strategies.get(strategyName);
    if (!strategy) {
      throw new Error(`Unknown strategy: ${strategyName}`);
    }
    
    const state = this.getOrCreateState(conversationId, strategyName);
    state.strategy = strategyName;
    // Reset window to force recalculation
    state.lastWindow = undefined;
  }
  
  private getOrCreateState(conversationId: string, strategy: string): ContextState {
    if (!this.states.has(conversationId)) {
      this.states.set(conversationId, {
        conversationId,
        strategy,
        cacheKeys: new Map(),
        statistics: {
          cacheHits: 0,
          cacheMisses: 0,
          totalTokensSaved: 0,
          rotationCount: 0,
        },
      });
    }
    return this.states.get(conversationId)!;
  }
  
  private generateCacheKey(messages: Message[]): string {
    if (messages.length === 0) return '';
    
    // Simple cache key generation - in production this would be more sophisticated
    const content = messages.map(m => `${m.role}:${m.content}`).join('|');
    const hash = this.simpleHash(content);
    return `${this.config.cachePrefix}-${hash}`;
  }
  
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
  
  private formatMessages(messages: Message[], conversation: Conversation): any[] {
    // This will be enhanced to handle provider-specific formatting
    // For now, return a simple format
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      cacheControl: msg.role === 'system' ? { type: 'ephemeral' } : undefined,
    }));
  }
  
  // For testing and debugging
  exportState(): Record<string, any> {
    const result: Record<string, any> = {};
    this.states.forEach((state, key) => {
      result[key] = {
        ...state,
        cacheKeys: Array.from(state.cacheKeys.entries()),
      };
    });
    return result;
  }
  
  clearState(conversationId?: string): void {
    if (conversationId) {
      this.states.delete(conversationId);
    } else {
      this.states.clear();
    }
  }
}

