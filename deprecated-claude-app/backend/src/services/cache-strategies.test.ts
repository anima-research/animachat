import { describe, it, expect } from 'vitest';
import {
  CacheAction,
  CacheEvent,
  DefaultCacheStrategy,
  AggressiveCacheStrategy,
  CostOptimizedCacheStrategy,
} from './cache-strategies.js';
import type { Message } from '@deprecated-claude/shared';

// Helper: create a minimal Message with given content length
function makeMessage(content: string, overrides: Partial<Message> = {}): Message {
  const branchId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    activeBranchId: branchId,
    order: 0,
    branches: [
      {
        id: branchId,
        content,
        role: 'user' as const,
        createdAt: new Date(),
      },
    ],
    ...overrides,
  };
}

// Helper: build array of messages with total approx token count
function makeMessages(approxTotalTokens: number): Message[] {
  // Each character ~0.25 tokens, so chars = tokens * 4
  const totalChars = approxTotalTokens * 4;
  const perMessage = Math.ceil(totalChars / 5);
  return Array.from({ length: 5 }, () => makeMessage('x'.repeat(perMessage)));
}

describe('CacheEvent enum', () => {
  it('has expected event types', () => {
    expect(CacheEvent.MISS).toBe('miss');
    expect(CacheEvent.HIT).toBe('hit');
    expect(CacheEvent.PARTIAL).toBe('partial');
    expect(CacheEvent.EXPIRED).toBe('expired');
    expect(CacheEvent.REBUILD).toBe('rebuild');
    expect(CacheEvent.REFRESH).toBe('refresh');
    expect(CacheEvent.SKIP).toBe('skip');
  });
});

describe('CacheAction enum', () => {
  it('has expected action types', () => {
    expect(CacheAction.CREATE).toBe('create');
    expect(CacheAction.REBUILD).toBe('rebuild');
    expect(CacheAction.REFRESH).toBe('refresh');
    expect(CacheAction.SKIP).toBe('skip');
    expect(CacheAction.USE).toBe('use');
  });
});

describe('DefaultCacheStrategy', () => {
  const strategy = new DefaultCacheStrategy();

  describe('onCacheExpired', () => {
    it('returns REFRESH for Opus models when cache expired less than 65 minutes ago', () => {
      const messages = makeMessages(1000);
      const lastCacheTime = new Date(Date.now() - 62 * 60 * 1000); // 62 min ago
      const decision = strategy.onCacheExpired(messages, lastCacheTime, 'claude-3-opus-20240229');

      expect(decision.action).toBe(CacheAction.REFRESH);
      expect(decision.reason).toContain('recently expired');
      expect(decision.metadata?.refreshTokens).toBe(100);
      expect(decision.metadata?.expectedTTL).toBe(60);
    });

    it('returns REBUILD for Opus models when cache expired more than 65 minutes ago', () => {
      const messages = makeMessages(1000);
      const lastCacheTime = new Date(Date.now() - 120 * 60 * 1000); // 120 min ago
      const decision = strategy.onCacheExpired(messages, lastCacheTime, 'claude-3-opus-20240229');

      expect(decision.action).toBe(CacheAction.REBUILD);
      expect(decision.reason).toContain('expired');
      expect(decision.metadata?.expectedTTL).toBe(60);
    });

    it('returns REBUILD for non-Opus models regardless of expiry time', () => {
      const messages = makeMessages(1000);
      const lastCacheTime = new Date(Date.now() - 62 * 60 * 1000); // 62 min ago
      const decision = strategy.onCacheExpired(messages, lastCacheTime, 'claude-3-sonnet-20240229');

      expect(decision.action).toBe(CacheAction.REBUILD);
      expect(decision.metadata?.expectedTTL).toBe(5);
    });

    it('includes minutes since last cache in reason for REBUILD', () => {
      const messages = makeMessages(1000);
      const lastCacheTime = new Date(Date.now() - 90 * 60 * 1000); // 90 min ago
      const decision = strategy.onCacheExpired(messages, lastCacheTime, 'gpt-4');

      expect(decision.action).toBe(CacheAction.REBUILD);
      expect(decision.reason).toContain('90');
    });

    it('is case-insensitive when checking for Opus', () => {
      const messages = makeMessages(1000);
      const lastCacheTime = new Date(Date.now() - 62 * 60 * 1000);
      const decision = strategy.onCacheExpired(messages, lastCacheTime, 'Claude-3-OPUS');

      expect(decision.action).toBe(CacheAction.REFRESH);
    });
  });

  describe('onFirstRequest', () => {
    it('returns SKIP for conversations with fewer than 500 estimated tokens', () => {
      // 500 tokens = ~2000 chars; use less
      const messages = [makeMessage('short')]; // ~2 tokens
      const decision = strategy.onFirstRequest(messages, 'claude-3-sonnet');

      expect(decision.action).toBe(CacheAction.SKIP);
      expect(decision.reason).toContain('too small');
    });

    it('returns CREATE for conversations with 500+ estimated tokens', () => {
      const messages = makeMessages(600);
      const decision = strategy.onFirstRequest(messages, 'claude-3-sonnet');

      expect(decision.action).toBe(CacheAction.CREATE);
      expect(decision.reason).toContain('initial cache');
      expect(decision.metadata?.tokensToCache).toBeGreaterThan(0);
    });

    it('sets expectedTTL to 60 for Opus models', () => {
      const messages = makeMessages(600);
      const decision = strategy.onFirstRequest(messages, 'claude-3-opus');

      expect(decision.metadata?.expectedTTL).toBe(60);
    });

    it('sets expectedTTL to 5 for non-Opus models', () => {
      const messages = makeMessages(600);
      const decision = strategy.onFirstRequest(messages, 'claude-3-sonnet');

      expect(decision.metadata?.expectedTTL).toBe(5);
    });

    it('estimates tokens as ceil(content.length / 4)', () => {
      // One message with 2000 chars => 500 tokens (the boundary)
      const msg = makeMessage('a'.repeat(2000));
      const decision = strategy.onFirstRequest([msg], 'sonnet');

      expect(decision.action).toBe(CacheAction.CREATE);
      expect(decision.metadata?.tokensToCache).toBe(500);
    });

    it('returns SKIP for exactly 499 estimated tokens', () => {
      // 499 tokens = 1996 chars
      const msg = makeMessage('a'.repeat(1996));
      const decision = strategy.onFirstRequest([msg], 'sonnet');

      expect(decision.action).toBe(CacheAction.SKIP);
    });

    it('handles messages with no matching active branch', () => {
      const msg: Message = {
        id: crypto.randomUUID(),
        conversationId: crypto.randomUUID(),
        activeBranchId: 'nonexistent-branch-id',
        order: 0,
        branches: [
          {
            id: crypto.randomUUID(),
            content: 'x'.repeat(10000),
            role: 'user',
            createdAt: new Date(),
          },
        ],
      };
      // With no matching branch, content falls back to '' => 0 tokens
      const decision = strategy.onFirstRequest([msg], 'sonnet');
      expect(decision.action).toBe(CacheAction.SKIP);
    });
  });

  describe('onContextRotation', () => {
    it('returns REBUILD with dropped message count in reason', () => {
      const kept = makeMessages(500);
      const decision = strategy.onContextRotation(10, kept, 'claude-3-sonnet');

      expect(decision.action).toBe(CacheAction.REBUILD);
      expect(decision.reason).toContain('10');
      expect(decision.reason).toContain('dropped');
    });

    it('sets expectedTTL to 60 for Opus models', () => {
      const decision = strategy.onContextRotation(5, [], 'claude-3-opus');
      expect(decision.metadata?.expectedTTL).toBe(60);
    });

    it('sets expectedTTL to 5 for non-Opus models', () => {
      const decision = strategy.onContextRotation(5, [], 'gpt-4');
      expect(decision.metadata?.expectedTTL).toBe(5);
    });
  });

  describe('analyzeCachePerformance', () => {
    it('returns "No cache data yet" when total is zero', () => {
      const result = strategy.analyzeCachePerformance({
        hits: 0,
        misses: 0,
        expired: 0,
        totalSaved: 0,
      });

      expect(result).toEqual(['No cache data yet']);
    });

    it('suggests longer conversations when hit rate is below 50%', () => {
      const result = strategy.analyzeCachePerformance({
        hits: 2,
        misses: 5,
        expired: 3,
        totalSaved: 0,
      });

      expect(result.some(s => s.includes('Low cache hit rate'))).toBe(true);
    });

    it('does not suggest longer conversations when hit rate is 50% or above', () => {
      const result = strategy.analyzeCachePerformance({
        hits: 5,
        misses: 3,
        expired: 2,
        totalSaved: 0,
      });

      expect(result.some(s => s.includes('Low cache hit rate'))).toBe(false);
    });

    it('suggests Opus models when expire rate exceeds 30%', () => {
      const result = strategy.analyzeCachePerformance({
        hits: 3,
        misses: 3,
        expired: 4,
        totalSaved: 0,
      });

      expect(result.some(s => s.includes('Opus'))).toBe(true);
    });

    it('does not suggest Opus models when expire rate is 30% or below', () => {
      const result = strategy.analyzeCachePerformance({
        hits: 5,
        misses: 3,
        expired: 2,
        totalSaved: 0,
      });

      expect(result.some(s => s.includes('Opus'))).toBe(false);
    });

    it('includes total tokens saved when totalSaved is positive', () => {
      const result = strategy.analyzeCachePerformance({
        hits: 8,
        misses: 1,
        expired: 1,
        totalSaved: 50000,
      });

      expect(result.some(s => s.includes('50,000'))).toBe(true);
    });

    it('does not include tokens saved when totalSaved is zero', () => {
      const result = strategy.analyzeCachePerformance({
        hits: 8,
        misses: 1,
        expired: 1,
        totalSaved: 0,
      });

      expect(result.some(s => s.includes('tokens saved'))).toBe(false);
    });

    it('can produce multiple suggestions simultaneously', () => {
      const result = strategy.analyzeCachePerformance({
        hits: 1,        // hit rate = 10% < 50%
        misses: 2,
        expired: 7,     // expire rate = 70% > 30%
        totalSaved: 1000,
      });

      expect(result.length).toBe(3);
    });
  });
});

describe('AggressiveCacheStrategy', () => {
  const strategy = new AggressiveCacheStrategy();

  describe('onCacheExpired', () => {
    it('always returns REFRESH regardless of how long ago cache expired', () => {
      const messages = makeMessages(1000);
      const lastCacheTime = new Date(Date.now() - 300 * 60 * 1000); // 5 hours ago
      const decision = strategy.onCacheExpired(messages, lastCacheTime, 'claude-3-sonnet');

      expect(decision.action).toBe(CacheAction.REFRESH);
      expect(decision.reason).toContain('refresh');
      expect(decision.metadata?.refreshTokens).toBe(50);
    });

    it('sets expectedTTL based on model type', () => {
      const messages = makeMessages(1000);
      const lastCacheTime = new Date(Date.now() - 120 * 60 * 1000);

      const opusDecision = strategy.onCacheExpired(messages, lastCacheTime, 'opus-model');
      expect(opusDecision.metadata?.expectedTTL).toBe(60);

      const sonnetDecision = strategy.onCacheExpired(messages, lastCacheTime, 'sonnet-model');
      expect(sonnetDecision.metadata?.expectedTTL).toBe(5);
    });
  });

  it('inherits onFirstRequest from DefaultCacheStrategy', () => {
    const messages = makeMessages(600);
    const decision = strategy.onFirstRequest(messages, 'claude-3-sonnet');
    expect(decision.action).toBe(CacheAction.CREATE);
  });

  it('inherits onContextRotation from DefaultCacheStrategy', () => {
    const decision = strategy.onContextRotation(3, [], 'claude-3-opus');
    expect(decision.action).toBe(CacheAction.REBUILD);
  });

  it('inherits analyzeCachePerformance from DefaultCacheStrategy', () => {
    const result = strategy.analyzeCachePerformance({
      hits: 0,
      misses: 0,
      expired: 0,
      totalSaved: 0,
    });
    expect(result).toEqual(['No cache data yet']);
  });
});

describe('CostOptimizedCacheStrategy', () => {
  const strategy = new CostOptimizedCacheStrategy();

  describe('onFirstRequest', () => {
    it('skips caching for Opus models below 2000 token threshold', () => {
      const messages = makeMessages(1500);
      const decision = strategy.onFirstRequest(messages, 'claude-3-opus');

      expect(decision.action).toBe(CacheAction.SKIP);
      expect(decision.reason).toContain('1');
    });

    it('creates cache for Opus models at or above 2000 token threshold', () => {
      const messages = makeMessages(2100);
      const decision = strategy.onFirstRequest(messages, 'claude-3-opus');

      expect(decision.action).toBe(CacheAction.CREATE);
    });

    it('skips caching for non-Opus models below 5000 token threshold', () => {
      const messages = makeMessages(3000);
      const decision = strategy.onFirstRequest(messages, 'claude-3-sonnet');

      expect(decision.action).toBe(CacheAction.SKIP);
    });

    it('creates cache for non-Opus models at or above 5000 token threshold', () => {
      const messages = makeMessages(5500);
      const decision = strategy.onFirstRequest(messages, 'claude-3-sonnet');

      expect(decision.action).toBe(CacheAction.CREATE);
    });

    it('still skips very small conversations (inherited from DefaultCacheStrategy via super)', () => {
      // Even below 500 tokens, the cost-optimized check happens first
      const messages = [makeMessage('tiny')];
      const decision = strategy.onFirstRequest(messages, 'claude-3-opus');

      expect(decision.action).toBe(CacheAction.SKIP);
    });
  });

  it('inherits onCacheExpired from DefaultCacheStrategy', () => {
    const messages = makeMessages(1000);
    const lastCacheTime = new Date(Date.now() - 120 * 60 * 1000);
    const decision = strategy.onCacheExpired(messages, lastCacheTime, 'gpt-4');

    expect(decision.action).toBe(CacheAction.REBUILD);
  });

  it('inherits onContextRotation from DefaultCacheStrategy', () => {
    const decision = strategy.onContextRotation(5, [], 'claude-3-sonnet');
    expect(decision.action).toBe(CacheAction.REBUILD);
  });
});
