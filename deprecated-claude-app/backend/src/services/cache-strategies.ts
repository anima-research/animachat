/**
 * Cache management strategies for different scenarios
 * This allows for sophisticated cache handling beyond simple create/hit/miss
 */

import { Message } from '@deprecated-claude/shared';

export enum CacheEvent {
  MISS = 'miss',           // No cache available
  HIT = 'hit',             // Full cache hit
  PARTIAL = 'partial',     // Partial cache hit
  EXPIRED = 'expired',     // Cache expired
  REBUILD = 'rebuild',     // Rebuilding cache
  REFRESH = 'refresh',     // Refreshing cache with minimal tokens
  SKIP = 'skip'           // Skipping cache for this request
}

export interface CacheDecision {
  action: CacheAction;
  reason: string;
  metadata?: {
    tokensToCache?: number;
    refreshTokens?: number;
    expectedTTL?: number; // minutes
  };
}

export enum CacheAction {
  CREATE = 'create',       // Create new cache
  REBUILD = 'rebuild',     // Rebuild entire cache
  REFRESH = 'refresh',     // Send minimal update to refresh
  SKIP = 'skip',          // Don't cache this request
  USE = 'use'             // Use existing cache
}

export interface CacheStrategy {
  /**
   * Decide what to do when cache has expired
   */
  onCacheExpired(
    messages: Message[],
    lastCacheTime: Date,
    modelId: string
  ): CacheDecision;
  
  /**
   * Decide whether to create cache for first request
   */
  onFirstRequest(
    messages: Message[],
    modelId: string
  ): CacheDecision;
  
  /**
   * Decide what to do after context rotation
   */
  onContextRotation(
    droppedCount: number,
    keptMessages: Message[],
    modelId: string
  ): CacheDecision;
  
  /**
   * Analyze cache metrics and suggest optimizations
   */
  analyzeCachePerformance(metrics: {
    hits: number;
    misses: number;
    expired: number;
    totalSaved: number;
  }): string[];
}

/**
 * Default cache strategy - always cache when possible
 */
export class DefaultCacheStrategy implements CacheStrategy {
  onCacheExpired(messages: Message[], lastCacheTime: Date, modelId: string): CacheDecision {
    const isOpus = modelId.toLowerCase().includes('opus');
    const minutesSinceLast = (Date.now() - lastCacheTime.getTime()) / 1000 / 60;
    
    // For Opus, consider refresh if just barely expired
    if (isOpus && minutesSinceLast < 65) { // Just past 1 hour
      return {
        action: CacheAction.REFRESH,
        reason: 'Cache recently expired, attempting refresh',
        metadata: {
          refreshTokens: 100, // Send minimal new content to refresh
          expectedTTL: 60
        }
      };
    }
    
    return {
      action: CacheAction.REBUILD,
      reason: `Cache expired (${minutesSinceLast.toFixed(1)} minutes old)`,
      metadata: {
        expectedTTL: isOpus ? 60 : 5
      }
    };
  }
  
  onFirstRequest(messages: Message[], modelId: string): CacheDecision {
    const totalTokens = messages.reduce((sum, msg) => {
      // Simplified token estimation
      const content = msg.branches.find(b => b.id === msg.activeBranchId)?.content || '';
      return sum + Math.ceil(content.length / 4);
    }, 0);
    
    // Don't cache very small conversations
    if (totalTokens < 500) {
      return {
        action: CacheAction.SKIP,
        reason: 'Conversation too small to benefit from caching'
      };
    }
    
    return {
      action: CacheAction.CREATE,
      reason: 'Creating initial cache',
      metadata: {
        tokensToCache: totalTokens,
        expectedTTL: modelId.toLowerCase().includes('opus') ? 60 : 5
      }
    };
  }
  
  onContextRotation(droppedCount: number, keptMessages: Message[], modelId: string): CacheDecision {
    return {
      action: CacheAction.REBUILD,
      reason: `Context rotated, dropped ${droppedCount} messages`,
      metadata: {
        expectedTTL: modelId.toLowerCase().includes('opus') ? 60 : 5
      }
    };
  }
  
  analyzeCachePerformance(metrics: {
    hits: number;
    misses: number;
    expired: number;
    totalSaved: number;
  }): string[] {
    const suggestions: string[] = [];
    const total = metrics.hits + metrics.misses + metrics.expired;
    
    if (total === 0) return ['No cache data yet'];
    
    const hitRate = (metrics.hits / total) * 100;
    const expireRate = (metrics.expired / total) * 100;
    
    if (hitRate < 50) {
      suggestions.push('Low cache hit rate - consider longer conversations before breaks');
    }
    
    if (expireRate > 30) {
      suggestions.push('High expiration rate - consider using Opus models for longer cache TTL');
    }
    
    if (metrics.totalSaved > 0) {
      suggestions.push(`Total tokens saved: ${metrics.totalSaved.toLocaleString()}`);
    }
    
    return suggestions;
  }
}

/**
 * Aggressive cache strategy - tries to maintain cache at all costs
 */
export class AggressiveCacheStrategy extends DefaultCacheStrategy {
  onCacheExpired(messages: Message[], lastCacheTime: Date, modelId: string): CacheDecision {
    // Always try to refresh first
    return {
      action: CacheAction.REFRESH,
      reason: 'Attempting cache refresh to maintain continuity',
      metadata: {
        refreshTokens: 50, // Minimal tokens to refresh
        expectedTTL: modelId.toLowerCase().includes('opus') ? 60 : 5
      }
    };
  }
}

/**
 * Cost-optimized strategy - only caches when significant savings expected
 */
export class CostOptimizedCacheStrategy extends DefaultCacheStrategy {
  onFirstRequest(messages: Message[], modelId: string): CacheDecision {
    const totalTokens = messages.reduce((sum, msg) => {
      const content = msg.branches.find(b => b.id === msg.activeBranchId)?.content || '';
      return sum + Math.ceil(content.length / 4);
    }, 0);
    
    // Only cache larger conversations where savings are significant
    const threshold = modelId.toLowerCase().includes('opus') ? 2000 : 5000;
    
    if (totalTokens < threshold) {
      return {
        action: CacheAction.SKIP,
        reason: `Not enough tokens (${totalTokens}) to justify caching cost`
      };
    }
    
    return super.onFirstRequest(messages, modelId);
  }
}
