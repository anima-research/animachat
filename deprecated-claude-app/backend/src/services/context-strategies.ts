import { Message, ContextManagement } from '@deprecated-claude/shared';

export interface CacheMarker {
  messageId: string;
  messageIndex: number;
  tokenCount: number;
}

export interface ContextWindow {
  messages: Message[];
  cacheablePrefix: Message[];
  activeWindow: Message[];
  cacheMarker?: CacheMarker;
  metadata: {
    totalMessages: number;
    totalTokens: number;
    windowStart: number;
    windowEnd: number;
    lastRotation: Date | null;
    cacheKey?: string;
  };
}

export interface ContextStrategy {
  name: string;
  prepareContext(
    messages: Message[], 
    newMessage?: Message,
    currentCacheMarker?: CacheMarker
  ): ContextWindow;
  shouldRotate(currentWindow: ContextWindow): boolean;
  getCacheBreakpoint(messages: Message[]): number;
}

// Simplified token counting - in production, use tiktoken or similar
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function getMessageTokens(message: Message): number {
  const branch = message.branches.find(b => b.id === message.activeBranchId);
  return branch ? estimateTokens(branch.content) : 0;
}

function getTotalTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + getMessageTokens(msg), 0);
}

export class AppendContextStrategy implements ContextStrategy {
  name = 'append';
  
  constructor(
    private config: Extract<ContextManagement, { strategy: 'append' }>
  ) {}
  
  prepareContext(
    messages: Message[], 
    newMessage?: Message,
    currentCacheMarker?: CacheMarker
  ): ContextWindow {
    const allMessages = newMessage ? [...messages, newMessage] : messages;
    const totalTokens = getTotalTokens(allMessages);
    
    // Determine cache marker position
    let cacheMarker = currentCacheMarker;
    
    if (!cacheMarker && totalTokens >= 5000) {
      // Set initial cache marker at 5k tokens
      let tokenSum = 0;
      for (let i = 0; i < allMessages.length; i++) {
        tokenSum += getMessageTokens(allMessages[i]);
        if (tokenSum >= 5000) {
          cacheMarker = {
            messageId: allMessages[i].id,
            messageIndex: i,
            tokenCount: tokenSum
          };
          break;
        }
      }
    } else if (cacheMarker && totalTokens - cacheMarker.tokenCount >= this.config.cacheInterval) {
      // Move cache marker forward by cacheInterval tokens
      let tokenSum = cacheMarker.tokenCount;
      for (let i = cacheMarker.messageIndex + 1; i < allMessages.length; i++) {
        tokenSum += getMessageTokens(allMessages[i]);
        if (tokenSum - cacheMarker.tokenCount >= this.config.cacheInterval) {
          cacheMarker = {
            messageId: allMessages[i].id,
            messageIndex: i,
            tokenCount: tokenSum
          };
          break;
        }
      }
    }
    
    const cacheBreakpoint = cacheMarker ? cacheMarker.messageIndex + 1 : 0;
    
    return {
      messages: allMessages,
      cacheablePrefix: allMessages.slice(0, cacheBreakpoint),
      activeWindow: allMessages.slice(cacheBreakpoint),
      cacheMarker,
      metadata: {
        totalMessages: allMessages.length,
        totalTokens,
        windowStart: 0,
        windowEnd: allMessages.length,
        lastRotation: null,
      },
    };
  }
  
  shouldRotate(): boolean {
    return false; // Append strategy never rotates
  }
  
  getCacheBreakpoint(messages: Message[]): number {
    // For append strategy, cache breakpoint is determined by token count
    const totalTokens = getTotalTokens(messages);
    if (totalTokens < 5000) return 0;
    
    let tokenSum = 0;
    for (let i = 0; i < messages.length; i++) {
      tokenSum += getMessageTokens(messages[i]);
      if (tokenSum >= totalTokens - 1000) { // Keep last 1k tokens uncached
        return i;
      }
    }
    return messages.length - 1;
  }
}

export class RollingContextStrategy implements ContextStrategy {
  name = 'rolling';
  
  constructor(
    private config: Extract<ContextManagement, { strategy: 'rolling' }>
  ) {}
  
  prepareContext(
    messages: Message[], 
    newMessage?: Message,
    currentCacheMarker?: CacheMarker
  ): ContextWindow {
    const allMessages = newMessage ? [...messages, newMessage] : messages;
    let totalTokens = getTotalTokens(allMessages);
    
    // Check if we need to truncate
    const maxTotal = this.config.maxTokens + this.config.maxGraceTokens;
    let keptMessages = allMessages;
    let droppedCount = 0;
    
    if (totalTokens > maxTotal) {
      // Truncate to maxTokens from the end
      let tokenSum = 0;
      let startIdx = allMessages.length - 1;
      
      // Find where to start keeping messages to stay under maxTokens
      for (let i = allMessages.length - 1; i >= 0; i--) {
        const msgTokens = getMessageTokens(allMessages[i]);
        if (tokenSum + msgTokens > this.config.maxTokens) {
          startIdx = i + 1;
          break;
        }
        tokenSum += msgTokens;
      }
      
      keptMessages = allMessages.slice(startIdx);
      droppedCount = startIdx;
      totalTokens = getTotalTokens(keptMessages);
    }
    
    // Determine cache marker
    let cacheMarker = currentCacheMarker;
    
    if (droppedCount > 0 || (currentCacheMarker && !keptMessages.find(m => m.id === currentCacheMarker.messageId))) {
      // Messages were truncated or cache marker was dropped, need to reset
      cacheMarker = undefined;
    }
    
    if (!cacheMarker && totalTokens >= this.config.cacheMinTokens) {
      // Set cache marker at cacheDepthFromEnd messages from the end
      const cacheIndex = Math.max(0, keptMessages.length - this.config.cacheDepthFromEnd - 1);
      if (cacheIndex >= 0 && cacheIndex < keptMessages.length) {
        let tokenCount = 0;
        for (let i = 0; i <= cacheIndex; i++) {
          tokenCount += getMessageTokens(keptMessages[i]);
        }
        cacheMarker = {
          messageId: keptMessages[cacheIndex].id,
          messageIndex: cacheIndex,
          tokenCount
        };
      }
    }
    
    const cacheBreakpoint = cacheMarker ? cacheMarker.messageIndex + 1 : 0;
    
    return {
      messages: keptMessages,
      cacheablePrefix: keptMessages.slice(0, cacheBreakpoint),
      activeWindow: keptMessages.slice(cacheBreakpoint),
      cacheMarker,
      metadata: {
        totalMessages: allMessages.length,
        totalTokens,
        windowStart: droppedCount,
        windowEnd: droppedCount + keptMessages.length,
        lastRotation: droppedCount > 0 ? new Date() : null,
      },
    };
  }
  
  shouldRotate(currentWindow: ContextWindow): boolean {
    // Rotation happens automatically in prepareContext when exceeding limits
    return false;
  }
  
  getCacheBreakpoint(messages: Message[]): number {
    if (messages.length <= this.config.cacheDepthFromEnd) return 0;
    return messages.length - this.config.cacheDepthFromEnd;
  }
}

// Legacy strategies for backward compatibility
export class LegacyRollingContextStrategy implements ContextStrategy {
  name = 'legacy-rolling';
  
  constructor(
    private maxMessages: number = 100,
    private rotationInterval: number = 20,
    private cacheRatio: number = 0.8
  ) {}
  
  prepareContext(messages: Message[], newMessage?: Message): ContextWindow {
    const allMessages = newMessage ? [...messages, newMessage] : messages;
    
    if (allMessages.length <= this.maxMessages) {
      const breakpoint = Math.max(0, allMessages.length - 10);
      return {
        messages: allMessages,
        cacheablePrefix: allMessages.slice(0, breakpoint),
        activeWindow: allMessages.slice(breakpoint),
        metadata: {
          totalMessages: allMessages.length,
          totalTokens: getTotalTokens(allMessages),
          windowStart: 0,
          windowEnd: allMessages.length,
          lastRotation: null,
        },
      };
    }
    
    const cacheSize = Math.floor(this.maxMessages * this.cacheRatio);
    const windowSize = this.maxMessages - cacheSize;
    
    const currentWindowSize = allMessages.length - cacheSize;
    const rotationsNeeded = Math.floor(currentWindowSize / this.rotationInterval);
    
    const startIdx = rotationsNeeded * this.rotationInterval;
    const keptMessages = allMessages.slice(startIdx);
    
    const finalMessages = keptMessages.slice(-this.maxMessages);
    const breakpoint = Math.min(cacheSize, finalMessages.length - windowSize);
    
    return {
      messages: finalMessages,
      cacheablePrefix: finalMessages.slice(0, breakpoint),
      activeWindow: finalMessages.slice(breakpoint),
      metadata: {
        totalMessages: allMessages.length,
        totalTokens: getTotalTokens(finalMessages),
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
    private alwaysCacheRatio: number = 0.9
  ) {}
  
  prepareContext(messages: Message[], newMessage?: Message): ContextWindow {
    const allMessages = newMessage ? [...messages, newMessage] : messages;
    const breakpoint = Math.floor(allMessages.length * this.alwaysCacheRatio);
    
    return {
      messages: allMessages.slice(-this.maxMessages),
      cacheablePrefix: allMessages.slice(0, breakpoint),
      activeWindow: allMessages.slice(breakpoint),
      metadata: {
        totalMessages: allMessages.length,
        totalTokens: getTotalTokens(allMessages.slice(-this.maxMessages)),
        windowStart: Math.max(0, allMessages.length - this.maxMessages),
        windowEnd: allMessages.length,
        lastRotation: null,
      },
    };
  }
  
  shouldRotate(): boolean {
    return false;
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
    const scoredMessages = this.scoreMessages(allMessages);
    
    const importantMessages = scoredMessages
      .filter(m => m.score >= this.importanceThreshold)
      .map(m => m.message);
    
    const recentMessages = allMessages.slice(-20);
    
    const messageSet = new Set([...importantMessages, ...recentMessages]
      .map(m => m.id));
    const finalMessages = allMessages
      .filter(m => messageSet.has(m.id))
      .slice(-this.maxMessages);
    
    const breakpoint = importantMessages.length;
    
    return {
      messages: finalMessages,
      cacheablePrefix: finalMessages.slice(0, breakpoint),
      activeWindow: finalMessages.slice(breakpoint),
      metadata: {
        totalMessages: allMessages.length,
        totalTokens: getTotalTokens(finalMessages),
        windowStart: 0,
        windowEnd: finalMessages.length,
        lastRotation: new Date(),
      },
    };
  }
  
  private scoreMessages(messages: Message[]): Array<{message: Message, score: number}> {
    return messages.map((message, idx) => {
      let score = 0.5;
      
      const recency = idx / messages.length;
      score += recency * 0.2;
      
      const branch = message.branches.find(b => b.id === message.activeBranchId);
      if (branch) {
        if (branch.content.length > 500) score += 0.1;
        if (branch.content.includes('```')) score += 0.2;
        if (branch.role === 'user') score += 0.1;
      }
      
      return { message, score: Math.min(1, score) };
    });
  }
  
  shouldRotate(currentWindow: ContextWindow): boolean {
    return currentWindow.activeWindow.length > 30;
  }
  
  getCacheBreakpoint(messages: Message[]): number {
    const scored = this.scoreMessages(messages);
    const important = scored.filter(m => m.score >= this.importanceThreshold);
    return important.length;
  }
}