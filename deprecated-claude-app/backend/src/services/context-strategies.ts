import { Message } from '@deprecated-claude/shared';

export interface ContextWindow {
  messages: Message[];
  cacheablePrefix: Message[];
  activeWindow: Message[];
  metadata: {
    totalMessages: number;
    windowStart: number;
    windowEnd: number;
    lastRotation: Date | null;
    cacheKey?: string;
  };
}

export interface ContextStrategy {
  name: string;
  prepareContext(messages: Message[], newMessage?: Message): ContextWindow;
  shouldRotate(currentWindow: ContextWindow): boolean;
  getCacheBreakpoint(messages: Message[]): number;
}

export class RollingContextStrategy implements ContextStrategy {
  name = 'rolling';
  
  constructor(
    private maxMessages: number = 100,
    private rotationInterval: number = 20,
    private cacheRatio: number = 0.8 // 80% cached, 20% rolling
  ) {}
  
  prepareContext(messages: Message[], newMessage?: Message): ContextWindow {
    const allMessages = newMessage ? [...messages, newMessage] : messages;
    
    if (allMessages.length <= this.maxMessages) {
      // Haven't hit limit yet, cache everything except last few messages
      const breakpoint = Math.max(0, allMessages.length - 10);
      return {
        messages: allMessages,
        cacheablePrefix: allMessages.slice(0, breakpoint),
        activeWindow: allMessages.slice(breakpoint),
        metadata: {
          totalMessages: allMessages.length,
          windowStart: 0,
          windowEnd: allMessages.length,
          lastRotation: null,
        },
      };
    }
    
    // Need to maintain rolling window
    const cacheSize = Math.floor(this.maxMessages * this.cacheRatio);
    const windowSize = this.maxMessages - cacheSize;
    
    // Determine if we need to rotate
    const currentWindowSize = allMessages.length - cacheSize;
    const rotationsNeeded = Math.floor(currentWindowSize / this.rotationInterval);
    
    // Calculate what messages to keep
    const startIdx = rotationsNeeded * this.rotationInterval;
    const keptMessages = allMessages.slice(startIdx);
    
    // Ensure we don't exceed max
    const finalMessages = keptMessages.slice(-this.maxMessages);
    const breakpoint = Math.min(cacheSize, finalMessages.length - windowSize);
    
    return {
      messages: finalMessages,
      cacheablePrefix: finalMessages.slice(0, breakpoint),
      activeWindow: finalMessages.slice(breakpoint),
      metadata: {
        totalMessages: allMessages.length,
        windowStart: startIdx,
        windowEnd: startIdx + finalMessages.length,
        lastRotation: rotationsNeeded > 0 ? new Date() : null,
      },
    };
  }
  
  shouldRotate(currentWindow: ContextWindow): boolean {
    const activeSize = currentWindow.activeWindow.length;
    return activeSize >= this.rotationInterval;
  }
  
  getCacheBreakpoint(messages: Message[]): number {
    const cacheSize = Math.floor(this.maxMessages * this.cacheRatio);
    return Math.min(cacheSize, messages.length - 10);
  }
}

export class StaticContextStrategy implements ContextStrategy {
  name = 'static';
  
  constructor(
    private maxMessages: number = 200,
    private alwaysCacheRatio: number = 0.9 // Cache 90% of messages
  ) {}
  
  prepareContext(messages: Message[], newMessage?: Message): ContextWindow {
    const allMessages = newMessage ? [...messages, newMessage] : messages;
    
    // For static context, we cache almost everything
    const breakpoint = Math.floor(allMessages.length * this.alwaysCacheRatio);
    
    return {
      messages: allMessages.slice(-this.maxMessages),
      cacheablePrefix: allMessages.slice(0, breakpoint),
      activeWindow: allMessages.slice(breakpoint),
      metadata: {
        totalMessages: allMessages.length,
        windowStart: Math.max(0, allMessages.length - this.maxMessages),
        windowEnd: allMessages.length,
        lastRotation: null,
      },
    };
  }
  
  shouldRotate(): boolean {
    return false; // Static context never rotates
  }
  
  getCacheBreakpoint(messages: Message[]): number {
    return Math.floor(messages.length * this.alwaysCacheRatio);
  }
}

export class AdaptiveContextStrategy implements ContextStrategy {
  name = 'adaptive';
  
  constructor(
    private maxMessages: number = 100,
    private importanceThreshold: number = 0.7
  ) {}
  
  prepareContext(messages: Message[], newMessage?: Message): ContextWindow {
    const allMessages = newMessage ? [...messages, newMessage] : messages;
    
    // In a real implementation, this would score message importance
    // based on factors like: length, user mentions, code blocks, etc.
    const scoredMessages = this.scoreMessages(allMessages);
    
    // Keep high-importance messages in cache
    const importantMessages = scoredMessages
      .filter(m => m.score >= this.importanceThreshold)
      .map(m => m.message);
    
    const recentMessages = allMessages.slice(-20); // Always keep last 20
    
    // Combine important and recent, remove duplicates
    const messageSet = new Set([...importantMessages, ...recentMessages]
      .map(m => m.id));
    const finalMessages = allMessages
      .filter(m => messageSet.has(m.id))
      .slice(-this.maxMessages);
    
    // Cache the important messages
    const breakpoint = importantMessages.length;
    
    return {
      messages: finalMessages,
      cacheablePrefix: finalMessages.slice(0, breakpoint),
      activeWindow: finalMessages.slice(breakpoint),
      metadata: {
        totalMessages: allMessages.length,
        windowStart: 0,
        windowEnd: finalMessages.length,
        lastRotation: new Date(),
      },
    };
  }
  
  private scoreMessages(messages: Message[]): Array<{message: Message, score: number}> {
    // Simplified scoring - in practice this would be more sophisticated
    return messages.map((message, idx) => {
      let score = 0.5; // Base score
      
      // Recent messages get higher scores
      const recency = idx / messages.length;
      score += recency * 0.2;
      
      // Longer messages might be more important
      if (message.content.length > 500) score += 0.1;
      
      // Code blocks are important
      if (message.content.includes('```')) score += 0.2;
      
      // User messages slightly more important
      if (message.role === 'user') score += 0.1;
      
      return { message, score: Math.min(1, score) };
    });
  }
  
  shouldRotate(currentWindow: ContextWindow): boolean {
    // Adaptive strategy rotates based on content analysis
    return currentWindow.activeWindow.length > 30;
  }
  
  getCacheBreakpoint(messages: Message[]): number {
    const scored = this.scoreMessages(messages);
    const important = scored.filter(m => m.score >= this.importanceThreshold);
    return important.length;
  }
}

