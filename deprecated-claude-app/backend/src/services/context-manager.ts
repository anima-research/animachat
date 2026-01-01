import { Message, Conversation, ContextManagement, DEFAULT_CONTEXT_MANAGEMENT, Participant } from '@deprecated-claude/shared';
import {
  ContextStrategy,
  ContextWindow,
  CacheMarker,
  AppendContextStrategy,
  RollingContextStrategy
} from './context-strategies.js';
import { Logger } from '../utils/logger.js';
import { PersonaContextBuilder } from './persona-context-builder.js';
import type { Database } from '../database/index.js';

interface ContextState {
  conversationId: string;
  participantId?: string;
  strategy: string;
  lastWindow?: ContextWindow;
  cacheMarker?: CacheMarker;
  cacheKeys: Map<string, string>; // message ID -> cache key
  lastCacheTime?: Date; // When cache was last written
  statistics: {
    cacheHits: number;
    cacheMisses: number;
    cacheExpired: number;
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
  private personaContextBuilder?: PersonaContextBuilder;

  constructor(config: Partial<ContextManagerConfig> = {}, db?: Database) {
    this.config = {
      defaultStrategy: 'rolling',
      enableCaching: true,
      cachePrefix: 'arc-cache',
      ...config
    };

    // Initialize empty - strategies will be created on demand with proper config
    this.strategies = new Map<string, ContextStrategy>();

    this.states = new Map();

    // Initialize PersonaContextBuilder if database provided
    if (db) {
      this.personaContextBuilder = new PersonaContextBuilder(db);
    }
  }
  
  async prepareContext(
    conversation: Conversation,
    messages: Message[],
    newMessage?: Message,
    participant?: Participant,
    modelMaxContext?: number
  ): Promise<{
    formattedMessages: any[]; // Provider-specific format
    cacheKey?: string;
    window: ContextWindow;
  }> {
    // Determine context management settings (participant overrides conversation)
    const contextManagement = participant?.contextManagement || 
                             conversation.contextManagement || 
                             DEFAULT_CONTEXT_MANAGEMENT;
    
    // Compute stateKey BEFORE getting strategy - this ensures each conversation/participant
    // gets its own strategy instance (important for stateful strategies like rolling window)
    const stateKey = participant ? `${conversation.id}:${participant.id}` : conversation.id;

    // Log for debugging
    Logger.debug('[ContextManager] Using context management:', JSON.stringify(contextManagement), 'for', stateKey);

    // Check if this is a persona-linked participant - if so, build accumulated context
    let contextMessages = messages;
    if (participant?.personaId && this.personaContextBuilder) {
      Logger.debug('[ContextManager] Detected persona participant:', participant.personaId);

      // Get the persona from the database (PersonaContextBuilder has db access)
      // We'll need to get the persona through the builder
      try {
        const personaMessages = await this.buildPersonaContextForParticipant(
          participant.personaId,
          conversation.id,
          messages
        );

        if (personaMessages.length > 0) {
          Logger.debug(`[ContextManager] Using ${personaMessages.length} messages from persona context (includes ${messages.length} backscroll)`);
          contextMessages = personaMessages;
        }
      } catch (error) {
        Logger.error('[ContextManager] Failed to build persona context:', error);
        // Fallback to regular messages if persona context build fails
      }
    }

    // Get or create appropriate strategy - pass stateKey to ensure per-context instances
    const strategy = this.getOrCreateStrategy(contextManagement, stateKey);

    // Get or create state
    const state = this.getOrCreateState(stateKey, contextManagement.strategy);

    // Prepare context window using persona-enhanced messages if available
    const window = strategy.prepareContext(contextMessages, newMessage, state.cacheMarker, modelMaxContext);
    
    // Update cache marker if changed
    if (window.cacheMarker?.messageId !== state.cacheMarker?.messageId) {
      state.cacheMarker = window.cacheMarker;
    }
    
    // Check if we should rotate
    if (state.lastWindow && strategy.shouldRotate(window)) {
      state.statistics.rotationCount++;
      Logger.context(`Context rotation triggered for ${stateKey}`);
    }
    
    // Generate cache key for the cacheable prefix
    const cacheKey = this.generateCacheKey(window.cacheablePrefix);
    
    // Check if this is a cache hit or expiration
    if (state.lastWindow?.metadata.cacheKey === cacheKey && cacheKey) {
      // Check if cache might have expired
      if (state.lastCacheTime) {
        const now = new Date();
        const elapsed = (now.getTime() - state.lastCacheTime.getTime()) / 1000 / 60; // minutes
        const expectedTTL = 60; // All caches are 1-hour now
        
        if (elapsed > expectedTTL) {
          Logger.cache(`⏰ Cache likely expired: ${elapsed.toFixed(1)} minutes since last cache (TTL: ${expectedTTL} min)`);
          state.statistics.cacheExpired++;
          state.lastCacheTime = now; // Reset timer
        } else {
          state.statistics.cacheHits++;
        }
      } else {
      state.statistics.cacheHits++;
      }
    } else {
      state.statistics.cacheMisses++;
      if (cacheKey) {
        state.lastCacheTime = new Date(); // New cache being created
      }
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
      cacheCreated?: number;
      cacheRead?: number;
    },
    participantId?: string
  ): void {
    const stateKey = participantId ? `${conversationId}:${participantId}` : conversationId;
    const state = this.states.get(stateKey);
    if (!state) return;
    
    // Track different cache events
    if (response.cacheRead && response.cacheCreated) {
      Logger.debug(`[ContextManager] Cache partial hit + rebuild`);
    } else if (response.cacheCreated && !response.cacheRead) {
      Logger.debug(`[ContextManager] Cache created/rebuilt`);
      state.lastCacheTime = new Date();
    } else if (response.cacheRead && !response.cacheCreated) {
      Logger.debug(`[ContextManager] Cache full hit`);
    }
    
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
    const strategy = this.getOrCreateStrategy(contextManagement, stateKey);
    
    const state = this.getOrCreateState(stateKey, contextManagement.strategy);
    state.strategy = contextManagement.strategy;
    // Reset window and cache marker to force recalculation
    state.lastWindow = undefined;
    state.cacheMarker = undefined;
    
    // Clear strategy's internal state if it has a reset method
    if ((strategy as any).resetState) {
      (strategy as any).resetState();
      Logger.context(`[ContextManager] Reset strategy state due to config change for ${stateKey}`);
    }
  }
  
  private getOrCreateStrategy(contextManagement: ContextManagement, stateKey?: string): ContextStrategy {
    // IMPORTANT: Include stateKey in cache key for stateful strategies like rolling window
    // This ensures each conversation/participant gets its own strategy instance
    // Without this, multiple participants sharing the same config would corrupt each other's state
    const configKey = JSON.stringify(contextManagement);
    const key = stateKey ? `${configKey}:${stateKey}` : configKey;
    
    if (!this.strategies.has(key)) {
      let strategy: ContextStrategy;
      
      switch (contextManagement.strategy) {
        case 'append':
          strategy = new AppendContextStrategy(contextManagement as Extract<ContextManagement, { strategy: 'append' }>);
          break;
        case 'rolling':
          strategy = new RollingContextStrategy(contextManagement as Extract<ContextManagement, { strategy: 'rolling' }>);
          break;
        default:
          throw new Error(`Unknown context strategy: ${(contextManagement as any).strategy}`);
      }
      
      Logger.debug(`[ContextManager] Created new ${contextManagement.strategy} strategy for ${stateKey || 'default'} with config:`, contextManagement);
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
          cacheExpired: 0,
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
        cacheControl: branch.role === 'system' ? { type: 'ephemeral', ttl: '1h' } : undefined,
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

  private async buildPersonaContextForParticipant(
    personaId: string,
    conversationId: string,
    currentMessages: Message[]
  ): Promise<Message[]> {
    if (!this.personaContextBuilder) {
      return currentMessages;
    }

    // Use PersonaContextBuilder to assemble accumulated context
    return await this.personaContextBuilder.buildPersonaContextById(
      personaId,
      conversationId,
      currentMessages
    );
  }
}