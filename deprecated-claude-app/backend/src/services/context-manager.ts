import { Message, Conversation, ContextManagement, DEFAULT_CONTEXT_MANAGEMENT, Participant } from '@deprecated-claude/shared';
import { 
  ContextStrategy, 
  ContextWindow,
  CacheMarker,
  AppendContextStrategy,
  RollingContextStrategy,
  LegacyRollingContextStrategy,
  StaticContextStrategy,
  AdaptiveContextStrategy 
} from './context-strategies.js';

interface ContextState {
  conversationId: string;
  participantId?: string;
  strategy: string;
  lastWindow?: ContextWindow;
  cacheMarker?: CacheMarker;
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
  private states: Map<string, ContextState>; // key is conversationId or conversationId:participantId
  private config: ContextManagerConfig;
  
  constructor(config: Partial<ContextManagerConfig> = {}) {
    this.config = {
      defaultStrategy: 'rolling',
      enableCaching: true,
      cachePrefix: 'arc-cache',
      ...config
    };
    
    // Initialize with legacy strategies for backward compatibility
    this.strategies = new Map<string, ContextStrategy>([
      ['rolling', new LegacyRollingContextStrategy()],
      ['static', new StaticContextStrategy()],
      ['adaptive', new AdaptiveContextStrategy()],
    ]);
    
    this.states = new Map();
  }
  
  async prepareContext(
    conversation: Conversation,
    messages: Message[],
    newMessage?: Message,
    participant?: Participant
  ): Promise<{
    formattedMessages: any[]; // Provider-specific format
    cacheKey?: string;
    window: ContextWindow;
  }> {
    // Determine context management settings (participant overrides conversation)
    const contextManagement = participant?.contextManagement || 
                             conversation.contextManagement || 
                             DEFAULT_CONTEXT_MANAGEMENT;
    
    // Get or create appropriate strategy
    const strategy = this.getOrCreateStrategy(contextManagement);
    
    // Get or create state
    const stateKey = participant ? `${conversation.id}:${participant.id}` : conversation.id;
    const state = this.getOrCreateState(stateKey, contextManagement.strategy);
    
    // Prepare context window
    const window = strategy.prepareContext(messages, newMessage, state.cacheMarker);
    
    // Update cache marker if changed
    if (window.cacheMarker?.messageId !== state.cacheMarker?.messageId) {
      state.cacheMarker = window.cacheMarker;
    }
    
    // Check if we should rotate
    if (state.lastWindow && strategy.shouldRotate(window)) {
      state.statistics.rotationCount++;
      console.log(`Context rotation triggered for ${stateKey}`);
    }
    
    // Generate cache key for the cacheable prefix
    const cacheKey = this.generateCacheKey(window.cacheablePrefix);
    
    // Check if this is a cache hit
    if (state.lastWindow?.metadata.cacheKey === cacheKey && cacheKey) {
      state.statistics.cacheHits++;
    } else {
      state.statistics.cacheMisses++;
    }
    
    // Update state
    state.lastWindow = window;
    window.metadata.cacheKey = cacheKey;
    
    // Format messages for the provider
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
    },
    participantId?: string
  ): void {
    const stateKey = participantId ? `${conversationId}:${participantId}` : conversationId;
    const state = this.states.get(stateKey);
    if (!state) return;
    
    if (response.cachedTokens) {
      state.statistics.totalTokensSaved += response.cachedTokens;
    }
  }
  
  getStatistics(conversationId: string, participantId?: string): ContextState['statistics'] | null {
    const stateKey = participantId ? `${conversationId}:${participantId}` : conversationId;
    const state = this.states.get(stateKey);
    return state?.statistics || null;
  }
  
  getCacheMarker(conversationId: string, participantId?: string): CacheMarker | undefined {
    const stateKey = participantId ? `${conversationId}:${participantId}` : conversationId;
    const state = this.states.get(stateKey);
    return state?.cacheMarker;
  }
  
  setContextManagement(conversationId: string, contextManagement: ContextManagement, participantId?: string): void {
    const stateKey = participantId ? `${conversationId}:${participantId}` : conversationId;
    const strategy = this.getOrCreateStrategy(contextManagement);
    
    const state = this.getOrCreateState(stateKey, contextManagement.strategy);
    state.strategy = contextManagement.strategy;
    // Reset window and cache marker to force recalculation
    state.lastWindow = undefined;
    state.cacheMarker = undefined;
  }
  
  private getOrCreateStrategy(contextManagement: ContextManagement): ContextStrategy {
    const key = JSON.stringify(contextManagement);
    
    if (!this.strategies.has(key)) {
      let strategy: ContextStrategy;
      
      switch (contextManagement.strategy) {
        case 'append':
          strategy = new AppendContextStrategy(contextManagement);
          break;
        case 'rolling':
          strategy = new RollingContextStrategy(contextManagement);
          break;
        default:
          throw new Error(`Unknown context strategy: ${(contextManagement as any).strategy}`);
      }
      
      this.strategies.set(key, strategy);
    }
    
    return this.strategies.get(key)!;
  }
  
  private getOrCreateState(stateKey: string, strategy: string): ContextState {
    if (!this.states.has(stateKey)) {
      const [conversationId, participantId] = stateKey.split(':');
      this.states.set(stateKey, {
        conversationId,
        participantId,
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
    return this.states.get(stateKey)!;
  }
  
  private generateCacheKey(messages: Message[]): string {
    if (messages.length === 0) return '';
    
    // Simple cache key generation - in production this would be more sophisticated
    const content = messages.map(m => {
      const branch = m.branches.find(b => b.id === m.activeBranchId);
      return branch ? `${branch.role}:${branch.content}` : '';
    }).join('|');
    
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
    return messages.map(msg => {
      const branch = msg.branches.find(b => b.id === msg.activeBranchId);
      if (!branch) return null;
      
      return {
        role: branch.role,
        content: branch.content,
        cacheControl: branch.role === 'system' ? { type: 'ephemeral' } : undefined,
      };
    }).filter(Boolean);
  }
  
  // For testing and debugging
  exportState(): Record<string, any> {
    const result: Record<string, any> = {};
    this.states.forEach((state, key) => {
      result[key] = {
        ...state,
        cacheKeys: Array.from(state.cacheKeys.entries()),
        cacheMarker: state.cacheMarker,
      };
    });
    return result;
  }
  
  clearState(conversationId?: string, participantId?: string): void {
    if (conversationId) {
      const stateKey = participantId ? `${conversationId}:${participantId}` : conversationId;
      this.states.delete(stateKey);
      
      // Also clear any participant-specific states if clearing conversation state
      if (!participantId) {
        const prefix = `${conversationId}:`;
        Array.from(this.states.keys())
          .filter(key => key.startsWith(prefix))
          .forEach(key => this.states.delete(key));
      }
    } else {
      this.states.clear();
    }
  }
}