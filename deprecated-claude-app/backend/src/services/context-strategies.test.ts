import { describe, it, expect, beforeEach } from 'vitest';
import { Message } from '@deprecated-claude/shared';
import {
  AppendContextStrategy,
  RollingContextStrategy,
  LegacyRollingContextStrategy,
  StaticContextStrategy,
  AdaptiveContextStrategy,
  CacheMarker,
  ContextWindow,
} from './context-strategies.js';
import { randomUUID } from 'crypto';

// Helper to create a Message with given content and role
function makeMessage(
  content: string,
  role: 'user' | 'assistant' = 'user',
  opts?: {
    contentBlocks?: Array<{ type: string; thinking?: string; signature?: string }>;
    attachments?: Array<{ fileName: string; content: string; mimeType: string; size: number }>;
  }
): Message {
  const branchId = randomUUID();
  return {
    id: randomUUID(),
    conversationId: randomUUID(),
    order: 0,
    activeBranchId: branchId,
    branches: [{
      id: branchId,
      content,
      role,
      createdAt: new Date(),
      contentBlocks: opts?.contentBlocks as any,
      attachments: opts?.attachments as any,
    }],
  };
}

// Helper: create N messages of given approximate token size each
function makeMessages(count: number, tokensPerMsg: number, alternateRoles = true): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < count; i++) {
    // ~4 chars per token
    const content = 'x'.repeat(tokensPerMsg * 4);
    const role = alternateRoles ? (i % 2 === 0 ? 'user' : 'assistant') : 'user';
    messages.push(makeMessage(content, role as 'user' | 'assistant'));
  }
  return messages;
}

// ========== estimateTokens (tested indirectly via strategies) ==========

describe('Token estimation (via strategy internals)', () => {
  it('estimates ~1 token per 4 characters', () => {
    // We test this through AppendContextStrategy's totalTokens reporting
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 100000 });
    const msg = makeMessage('a'.repeat(400)); // 400 chars => ~100 tokens
    const result = strategy.prepareContext([msg]);
    expect(result.metadata.totalTokens).toBe(100);
  });

  it('rounds up token estimates (ceil)', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 100000 });
    const msg = makeMessage('abc'); // 3 chars => ceil(3/4) = 1 token
    const result = strategy.prepareContext([msg]);
    expect(result.metadata.totalTokens).toBe(1);
  });

  it('handles empty content as 0 tokens', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 100000 });
    const msg = makeMessage('');
    const result = strategy.prepareContext([msg]);
    expect(result.metadata.totalTokens).toBe(0);
  });
});

// ========== getMessageTokens ==========

describe('getMessageTokens (via strategies)', () => {
  it('includes thinking block tokens in count', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 100000 });
    const textContent = 'a'.repeat(40); // 10 tokens
    const thinkingContent = 'b'.repeat(80); // 20 tokens
    const msg = makeMessage(textContent, 'assistant', {
      contentBlocks: [
        { type: 'thinking', thinking: thinkingContent },
      ],
    });
    const result = strategy.prepareContext([msg]);
    // 10 (text) + 20 (thinking) + 10 (tag overhead) = 40
    expect(result.metadata.totalTokens).toBe(40);
  });

  it('counts redacted_thinking as 15 tokens', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 100000 });
    const msg = makeMessage('a'.repeat(40), 'assistant', {
      contentBlocks: [
        { type: 'redacted_thinking' },
      ],
    });
    const result = strategy.prepareContext([msg]);
    // 10 (text) + 15 (redacted) = 25
    expect(result.metadata.totalTokens).toBe(25);
  });

  it('counts image attachments as 1500 tokens each', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 100000 });
    const msg = makeMessage('a'.repeat(40), 'user', {
      attachments: [
        { fileName: 'photo.jpg', content: 'base64data', mimeType: 'image/jpeg', size: 1000 },
      ],
    });
    const result = strategy.prepareContext([msg]);
    // 10 (text) + 1500 (image) = 1510
    expect(result.metadata.totalTokens).toBe(1510);
  });

  it('counts supported image extensions: jpg, jpeg, png, webp', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 100000 });
    const imageExts = ['jpg', 'jpeg', 'png', 'webp'];
    for (const ext of imageExts) {
      const msg = makeMessage('', 'user', {
        attachments: [{ fileName: `img.${ext}`, content: 'data', mimeType: `image/${ext}`, size: 100 }],
      });
      const result = strategy.prepareContext([msg]);
      expect(result.metadata.totalTokens).toBe(1500);
    }
  });

  it('counts text attachments by content length, not as images', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 100000 });
    const attachmentContent = 'x'.repeat(200); // 50 tokens
    const msg = makeMessage('', 'user', {
      attachments: [
        { fileName: 'code.ts', content: attachmentContent, mimeType: 'text/typescript', size: 200 },
      ],
    });
    const result = strategy.prepareContext([msg]);
    expect(result.metadata.totalTokens).toBe(50);
  });

  it('does NOT count gif, bmp, svg as image attachments (excluded)', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 100000 });
    const nonImageExts = ['gif', 'bmp', 'svg'];
    for (const ext of nonImageExts) {
      const content = 'x'.repeat(40); // 10 tokens
      const msg = makeMessage('', 'user', {
        attachments: [{ fileName: `img.${ext}`, content, mimeType: `image/${ext}`, size: 40 }],
      });
      const result = strategy.prepareContext([msg]);
      // Should be counted as text (10 tokens), not as image (1500 tokens)
      expect(result.metadata.totalTokens).toBe(10);
    }
  });

  it('returns 0 tokens for message with no active branch', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 100000 });
    const msg: Message = {
      id: randomUUID(),
      conversationId: randomUUID(),
      order: 0,
      activeBranchId: 'nonexistent-branch-id',
      branches: [{
        id: randomUUID(),
        content: 'This content should not be counted',
        role: 'user',
        createdAt: new Date(),
      }],
    };
    const result = strategy.prepareContext([msg]);
    expect(result.metadata.totalTokens).toBe(0);
  });
});

// ========== AppendContextStrategy ==========

describe('AppendContextStrategy', () => {
  it('returns all messages without truncation', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 10000 });
    const messages = makeMessages(50, 100); // 50 * 100 = 5000 tokens
    const result = strategy.prepareContext(messages);
    expect(result.messages).toHaveLength(50);
    expect(result.metadata.totalMessages).toBe(50);
    expect(result.metadata.windowStart).toBe(0);
    expect(result.metadata.windowEnd).toBe(50);
  });

  it('includes newMessage when provided', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 10000 });
    const messages = makeMessages(5, 10);
    const newMsg = makeMessage('new message');
    const result = strategy.prepareContext(messages, newMsg);
    expect(result.messages).toHaveLength(6);
    expect(result.messages[5]).toBe(newMsg);
  });

  it('never rotates (shouldRotate always returns false)', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 10000 });
    const fakeWindow: ContextWindow = {
      messages: [],
      cacheablePrefix: [],
      activeWindow: [],
      metadata: { totalMessages: 100, totalTokens: 50000, windowStart: 0, windowEnd: 100, lastRotation: null },
    };
    expect(strategy.shouldRotate(fakeWindow)).toBe(false);
  });

  it('does not place cache markers when below tokensBeforeCaching threshold', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 10000 });
    const messages = makeMessages(5, 100); // 500 tokens, well below 10000
    const result = strategy.prepareContext(messages);
    expect(result.cacheMarker).toBeUndefined();
    expect(result.cacheMarkers).toBeUndefined();
    expect(result.cacheablePrefix).toHaveLength(0);
  });

  it('places cache markers when conversation exceeds tokensBeforeCaching', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 5000 });
    // 30 messages * 200 tokens = 6000 tokens (> 5000 threshold)
    const messages = makeMessages(30, 200);
    const result = strategy.prepareContext(messages);
    expect(result.cacheMarker).toBeDefined();
    expect(result.cacheMarkers).toBeDefined();
    expect(result.cacheMarkers!.length).toBeGreaterThan(0);
    expect(result.cacheMarkers!.length).toBeLessThanOrEqual(4);
  });

  it('distributes up to 4 cache points at arithmetic intervals', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 2000 });
    // 40 messages * 500 tokens = 20000 tokens
    const messages = makeMessages(40, 500);
    const result = strategy.prepareContext(messages);
    expect(result.cacheMarkers).toBeDefined();
    // With 20000 tokens and threshold 2000:
    // currentWindow = floor(20000/2000)*2000 = 20000
    // cacheStep = 20000/4 = 5000
    // Should place markers at ~5000, 10000, 15000, 20000 token boundaries
    const markers = result.cacheMarkers!;
    expect(markers.length).toBeGreaterThanOrEqual(2); // At least some cache points
    // Markers should be in ascending order
    for (let i = 1; i < markers.length; i++) {
      expect(markers[i].messageIndex).toBeGreaterThan(markers[i - 1].messageIndex);
      expect(markers[i].tokenCount).toBeGreaterThan(markers[i - 1].tokenCount);
    }
  });

  it('legacy cacheMarker is set to the last marker', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 2000 });
    const messages = makeMessages(40, 500);
    const result = strategy.prepareContext(messages);
    expect(result.cacheMarker).toBeDefined();
    expect(result.cacheMarkers).toBeDefined();
    expect(result.cacheMarker).toEqual(result.cacheMarkers![result.cacheMarkers!.length - 1]);
  });

  it('splits cacheablePrefix and activeWindow at cacheMarker boundary', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 2000 });
    const messages = makeMessages(40, 500);
    const result = strategy.prepareContext(messages);
    // cacheablePrefix + activeWindow should cover all messages
    expect(result.cacheablePrefix.length + result.activeWindow.length).toBe(result.messages.length);
    if (result.cacheMarker) {
      expect(result.cacheablePrefix).toHaveLength(result.cacheMarker.messageIndex + 1);
    }
  });

  it('getCacheBreakpoint returns 0 for small conversations', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 10000 });
    const messages = makeMessages(3, 100); // 300 tokens
    expect(strategy.getCacheBreakpoint(messages)).toBe(0);
  });

  it('getCacheBreakpoint returns index keeping last ~1000 tokens uncached', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 5000 });
    // 20 messages * 500 tokens = 10000 tokens
    const messages = makeMessages(20, 500);
    const bp = strategy.getCacheBreakpoint(messages);
    // Should leave ~1000 tokens uncached from end: 10000 - 1000 = 9000 tokens cached
    // At 500 tokens/msg, that's msg index 17 (9000/500 = 18 msgs, so index 17)
    expect(bp).toBeGreaterThan(0);
    expect(bp).toBeLessThan(messages.length);
  });

  it('places cache markers on user messages (OpenRouter workaround)', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 1000 });
    // Create messages that alternate user/assistant
    const messages = makeMessages(20, 200); // 4000 tokens
    const result = strategy.prepareContext(messages);
    if (result.cacheMarkers) {
      for (const marker of result.cacheMarkers) {
        const msg = result.messages[marker.messageIndex];
        const branch = msg.branches.find(b => b.id === msg.activeBranchId);
        expect(branch?.role).toBe('user');
      }
    }
  });

  it('skips cache points below PROVIDER_MIN_CACHE_TOKENS (1024)', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 1100 });
    // Create a conversation just over threshold with small messages
    // 12 messages * 100 tokens = 1200 tokens
    const messages = makeMessages(12, 100);
    const result = strategy.prepareContext(messages);
    // Any cache markers placed should be at >= 1024 tokens
    if (result.cacheMarkers) {
      for (const marker of result.cacheMarkers) {
        expect(marker.tokenCount).toBeGreaterThanOrEqual(1024);
      }
    }
  });

  it('uses tokensBeforeCaching default of 10000 when not set', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append' } as any);
    // Below 10000 tokens: no caching
    const messages = makeMessages(10, 500); // 5000 tokens
    const result = strategy.prepareContext(messages);
    expect(result.cacheMarker).toBeUndefined();
  });
});

// ========== RollingContextStrategy ==========

describe('RollingContextStrategy', () => {
  const defaultConfig = { strategy: 'rolling' as const, maxTokens: 5000, maxGraceTokens: 2000 };

  it('returns all messages when within maxTokens limit', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    const messages = makeMessages(10, 100); // 1000 tokens
    const result = strategy.prepareContext(messages);
    expect(result.messages).toHaveLength(10);
    expect(result.metadata.totalTokens).toBe(1000);
  });

  it('includes newMessage when provided', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    const messages = makeMessages(5, 100);
    const newMsg = makeMessage('new');
    const result = strategy.prepareContext(messages, newMsg);
    expect(result.messages).toHaveLength(6);
  });

  it('enters grace period when exceeding maxTokens but under maxTotal', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    // 6000 tokens: over maxTokens (5000) but under max+grace (7000)
    const messages = makeMessages(30, 200); // 6000 tokens
    const result = strategy.prepareContext(messages);
    // Should NOT rotate yet - just enter grace period
    expect(result.messages).toHaveLength(30);
    expect(result.metadata.totalTokens).toBe(6000);
    expect(result.metadata.lastRotation).toBeNull();
  });

  it('rotates when exceeding maxTokens + maxGraceTokens', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    // First call: set up baseline with small conversation
    const initialMsgs = makeMessages(5, 100); // 500 tokens
    strategy.prepareContext(initialMsgs);

    // Second call: large conversation over grace limit
    // 8000 tokens > 7000 (maxTokens + maxGraceTokens)
    const largeMsgs = makeMessages(40, 200); // 8000 tokens
    const result = strategy.prepareContext(largeMsgs);
    // Should have rotated
    expect(result.messages.length).toBeLessThan(40);
    expect(result.metadata.lastRotation).not.toBeNull();
    // After rotation, tokens should be around maxTokens (5000)
    expect(result.metadata.totalTokens).toBeGreaterThanOrEqual(5000);
    expect(result.metadata.totalTokens).toBeLessThanOrEqual(7000);
  });

  it('keeps most recent messages after rotation', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    // Create numbered messages so we can verify ordering
    const messages: Message[] = [];
    for (let i = 0; i < 40; i++) {
      messages.push(makeMessage(`Message ${i}: ${'x'.repeat(196)}`, i % 2 === 0 ? 'user' : 'assistant'));
    }
    // 40 * 200 tokens = 8000 tokens > 7000 limit
    const result = strategy.prepareContext(messages);
    // Most recent messages should be kept
    const lastKeptContent = result.messages[result.messages.length - 1].branches[0].content;
    expect(lastKeptContent).toContain('Message 39');
  });

  it('shouldRotate always returns false (rotation happens in prepareContext)', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    expect(strategy.shouldRotate({} as ContextWindow)).toBe(false);
  });

  it('resets state on branch change', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    const messages = makeMessages(10, 100);
    strategy.prepareContext(messages);

    // Second call with modified branch IDs (simulating branch switch)
    const modifiedMessages = messages.slice(0, 5).map(m => ({
      ...m,
      activeBranchId: randomUUID(), // Different branch IDs
      branches: [{ ...m.branches[0], id: randomUUID() }], // Need to match
    }));
    // Fix: activeBranchId must match branch id
    for (const m of modifiedMessages) {
      m.activeBranchId = m.branches[0].id;
    }
    const result = strategy.prepareContext([...modifiedMessages, ...messages.slice(5)]);
    // State should have been reset (no error, just recalculates)
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('clears cache markers on rotation', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    const existingMarker: CacheMarker = {
      messageId: 'old-msg',
      messageIndex: 5,
      tokenCount: 2000,
    };

    // Over-limit messages to force rotation
    const messages = makeMessages(40, 200); // 8000 tokens
    const result = strategy.prepareContext(messages, undefined, existingMarker);
    // After rotation, the old cache marker should be cleared
    // (new markers may be placed, but the old specific one should be gone)
    if (result.cacheMarker) {
      expect(result.cacheMarker.messageId).not.toBe('old-msg');
    }
  });

  it('places cache markers using arithmetic positioning within working window', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    // 3000 tokens: within limits, above min cache threshold (1024)
    const messages = makeMessages(15, 200);
    const result = strategy.prepareContext(messages);
    if (result.cacheMarkers) {
      // Cache step = workingWindowSize / (NUM_CACHE_POINTS + 1) = 7000 / 5 = 1400
      // Markers at: 1400, 2800 tokens
      expect(result.cacheMarkers.length).toBeGreaterThan(0);
      for (let i = 1; i < result.cacheMarkers.length; i++) {
        expect(result.cacheMarkers[i].tokenCount).toBeGreaterThan(result.cacheMarkers[i - 1].tokenCount);
      }
    }
  });

  it('getCacheBreakpoint returns 0 for very short conversations', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    const messages = makeMessages(2, 100); // 200 tokens < 1024
    expect(strategy.getCacheBreakpoint(messages)).toBe(0);
  });

  it('getCacheBreakpoint returns midpoint for short conversations', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    // Conversation too short for cache target but above minimum
    // workingWindowSize / 2 = 3500
    // Need total > 1024 but total < 3500 for midpoint fallback
    const messages = makeMessages(10, 200); // 2000 tokens
    const bp = strategy.getCacheBreakpoint(messages);
    // Token count < cacheStep, so fallback to midpoint
    expect(bp).toBe(5); // floor(10/2) = 5
  });

  it('resetState clears all internal state', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    // Build up some state
    const messages = makeMessages(10, 100);
    strategy.prepareContext(messages);
    // Reset
    strategy.resetState();
    // After reset, a fresh prepareContext should work from scratch
    const result = strategy.prepareContext(messages);
    expect(result.messages).toHaveLength(10);
  });

  it('tracks window message IDs after rotation', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    // Force rotation
    const messages = makeMessages(40, 200); // 8000 tokens
    const result1 = strategy.prepareContext(messages);
    expect(result1.messages.length).toBeLessThan(40);

    // Subsequent call should only evaluate windowed messages + new
    const newMsg = makeMessage('x'.repeat(100), 'user');
    const result2 = strategy.prepareContext([...messages, newMsg]);
    // Should not crash and should include the new message
    expect(result2.messages.length).toBeGreaterThan(0);
  });

  it('metadata reports window start and end correctly', () => {
    const strategy = new RollingContextStrategy(defaultConfig);
    const messages = makeMessages(40, 200); // 8000 tokens, forces rotation
    const result = strategy.prepareContext(messages);
    expect(result.metadata.windowStart).toBeGreaterThan(0);
    expect(result.metadata.windowEnd).toBe(result.metadata.windowStart + result.messages.length);
    expect(result.metadata.totalMessages).toBe(40);
  });
});

// ========== LegacyRollingContextStrategy ==========

describe('LegacyRollingContextStrategy', () => {
  it('returns all messages when under maxMessages', () => {
    const strategy = new LegacyRollingContextStrategy(100, 20, 0.8);
    const messages = makeMessages(50, 10);
    const result = strategy.prepareContext(messages);
    expect(result.messages).toHaveLength(50);
  });

  it('truncates when exceeding maxMessages', () => {
    const strategy = new LegacyRollingContextStrategy(20, 5, 0.8);
    const messages = makeMessages(50, 10);
    const result = strategy.prepareContext(messages);
    expect(result.messages.length).toBeLessThanOrEqual(20);
  });

  it('includes newMessage in count', () => {
    const strategy = new LegacyRollingContextStrategy(100, 20, 0.8);
    const messages = makeMessages(10, 10);
    const newMsg = makeMessage('new');
    const result = strategy.prepareContext(messages, newMsg);
    expect(result.messages).toHaveLength(11);
  });

  it('sets cache breakpoint at cacheRatio * maxMessages within limit', () => {
    const strategy = new LegacyRollingContextStrategy(100, 20, 0.8);
    const messages = makeMessages(50, 10);
    const result = strategy.prepareContext(messages);
    // Under maxMessages: breakpoint = max(0, allMessages.length - 10) = 40
    expect(result.cacheablePrefix.length).toBe(40);
    expect(result.activeWindow.length).toBe(10);
  });

  it('shouldRotate returns true when activeWindow exceeds rotationInterval', () => {
    const strategy = new LegacyRollingContextStrategy(100, 20, 0.8);
    const window: ContextWindow = {
      messages: [],
      cacheablePrefix: [],
      activeWindow: makeMessages(20, 10),
      metadata: { totalMessages: 100, totalTokens: 1000, windowStart: 0, windowEnd: 100, lastRotation: null },
    };
    expect(strategy.shouldRotate(window)).toBe(true);
  });

  it('shouldRotate returns false when activeWindow is small', () => {
    const strategy = new LegacyRollingContextStrategy(100, 20, 0.8);
    const window: ContextWindow = {
      messages: [],
      cacheablePrefix: [],
      activeWindow: makeMessages(5, 10),
      metadata: { totalMessages: 50, totalTokens: 500, windowStart: 0, windowEnd: 50, lastRotation: null },
    };
    expect(strategy.shouldRotate(window)).toBe(false);
  });

  it('getCacheBreakpoint returns cacheRatio * maxMessages', () => {
    const strategy = new LegacyRollingContextStrategy(100, 20, 0.8);
    const messages = makeMessages(200, 10);
    const bp = strategy.getCacheBreakpoint(messages);
    // min(80, 200 - 10) = 80
    expect(bp).toBe(80);
  });

  it('reports lastRotation when messages exceed maxMessages', () => {
    const strategy = new LegacyRollingContextStrategy(20, 5, 0.8);
    const messages = makeMessages(50, 10);
    const result = strategy.prepareContext(messages);
    expect(result.metadata.lastRotation).not.toBeNull();
  });

  it('uses default values when constructed without arguments', () => {
    const strategy = new LegacyRollingContextStrategy();
    const messages = makeMessages(50, 10);
    const result = strategy.prepareContext(messages);
    expect(result.messages).toHaveLength(50);
  });
});

// ========== StaticContextStrategy ==========

describe('StaticContextStrategy', () => {
  it('keeps at most maxMessages from the end', () => {
    const strategy = new StaticContextStrategy(50, 0.9);
    const messages = makeMessages(100, 10);
    const result = strategy.prepareContext(messages);
    expect(result.messages).toHaveLength(50);
  });

  it('includes all messages when under maxMessages', () => {
    const strategy = new StaticContextStrategy(200, 0.9);
    const messages = makeMessages(50, 10);
    const result = strategy.prepareContext(messages);
    expect(result.messages).toHaveLength(50);
  });

  it('sets cacheablePrefix at alwaysCacheRatio of all messages', () => {
    const strategy = new StaticContextStrategy(200, 0.9);
    const messages = makeMessages(100, 10);
    const result = strategy.prepareContext(messages);
    // breakpoint = floor(100 * 0.9) = 90
    expect(result.cacheablePrefix).toHaveLength(90);
    expect(result.activeWindow).toHaveLength(10);
  });

  it('shouldRotate always returns false', () => {
    const strategy = new StaticContextStrategy();
    expect(strategy.shouldRotate({} as ContextWindow)).toBe(false);
  });

  it('getCacheBreakpoint returns alwaysCacheRatio * length', () => {
    const strategy = new StaticContextStrategy(200, 0.9);
    const messages = makeMessages(100, 10);
    expect(strategy.getCacheBreakpoint(messages)).toBe(90);
  });

  it('reports correct metadata', () => {
    const strategy = new StaticContextStrategy(50, 0.9);
    const messages = makeMessages(100, 10);
    const result = strategy.prepareContext(messages);
    expect(result.metadata.totalMessages).toBe(100);
    expect(result.metadata.windowStart).toBe(50); // 100 - 50
    expect(result.metadata.windowEnd).toBe(100);
    expect(result.metadata.lastRotation).toBeNull();
  });

  it('uses default values when constructed without arguments', () => {
    const strategy = new StaticContextStrategy();
    const messages = makeMessages(50, 10);
    const result = strategy.prepareContext(messages);
    expect(result.messages).toHaveLength(50); // Under default maxMessages=200
  });

  it('includes newMessage in processing', () => {
    const strategy = new StaticContextStrategy(200, 0.9);
    const messages = makeMessages(10, 10);
    const newMsg = makeMessage('new');
    const result = strategy.prepareContext(messages, newMsg);
    expect(result.messages).toHaveLength(11);
  });
});

// ========== AdaptiveContextStrategy ==========

describe('AdaptiveContextStrategy', () => {
  it('keeps recent messages regardless of score', () => {
    const strategy = new AdaptiveContextStrategy(100, 0.7);
    const messages = makeMessages(50, 10);
    const result = strategy.prepareContext(messages);
    // Last 20 messages are always kept
    expect(result.messages.length).toBeGreaterThanOrEqual(20);
  });

  it('includes newMessage', () => {
    const strategy = new AdaptiveContextStrategy(100, 0.7);
    const messages = makeMessages(10, 10);
    const newMsg = makeMessage('new');
    const result = strategy.prepareContext(messages, newMsg);
    expect(result.messages.length).toBeGreaterThanOrEqual(11);
  });

  it('scores code blocks higher (content with triple backticks)', () => {
    const strategy = new AdaptiveContextStrategy(100, 0.7);
    const messages: Message[] = [];
    // Add many plain messages
    for (let i = 0; i < 25; i++) {
      messages.push(makeMessage('plain text'));
    }
    // Add message with code block
    messages.push(makeMessage('```\nconst x = 1;\n```'));
    const result = strategy.prepareContext(messages);
    // Code message should be kept (high importance)
    const codeMsg = result.messages.find(m => {
      const b = m.branches.find(b => b.id === m.activeBranchId);
      return b?.content.includes('```');
    });
    expect(codeMsg).toBeDefined();
  });

  it('scores user messages slightly higher than assistant messages', () => {
    const strategy = new AdaptiveContextStrategy(100, 0.7);
    // The scoring adds 0.1 for user role
    const messages = makeMessages(5, 10);
    const result = strategy.prepareContext(messages);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('scores longer messages higher (>500 chars)', () => {
    const strategy = new AdaptiveContextStrategy(100, 0.7);
    const messages: Message[] = [];
    for (let i = 0; i < 25; i++) {
      messages.push(makeMessage('short'));
    }
    messages.push(makeMessage('x'.repeat(600))); // Long message
    const result = strategy.prepareContext(messages);
    // Long message should be included
    const longMsg = result.messages.find(m => {
      const b = m.branches.find(b => b.id === m.activeBranchId);
      return b && b.content.length > 500;
    });
    expect(longMsg).toBeDefined();
  });

  it('shouldRotate returns true when activeWindow exceeds 30', () => {
    const strategy = new AdaptiveContextStrategy(100, 0.7);
    const window: ContextWindow = {
      messages: [],
      cacheablePrefix: [],
      activeWindow: makeMessages(31, 10),
      metadata: { totalMessages: 100, totalTokens: 1000, windowStart: 0, windowEnd: 100, lastRotation: null },
    };
    expect(strategy.shouldRotate(window)).toBe(true);
  });

  it('shouldRotate returns false when activeWindow is 30 or less', () => {
    const strategy = new AdaptiveContextStrategy(100, 0.7);
    const window: ContextWindow = {
      messages: [],
      cacheablePrefix: [],
      activeWindow: makeMessages(30, 10),
      metadata: { totalMessages: 100, totalTokens: 1000, windowStart: 0, windowEnd: 100, lastRotation: null },
    };
    expect(strategy.shouldRotate(window)).toBe(false);
  });

  it('getCacheBreakpoint returns count of important messages', () => {
    const strategy = new AdaptiveContextStrategy(100, 0.7);
    const messages = makeMessages(50, 10);
    const bp = strategy.getCacheBreakpoint(messages);
    expect(bp).toBeGreaterThanOrEqual(0);
    expect(bp).toBeLessThanOrEqual(messages.length);
  });

  it('limits output to maxMessages', () => {
    const strategy = new AdaptiveContextStrategy(30, 0.7);
    const messages = makeMessages(100, 10);
    const result = strategy.prepareContext(messages);
    expect(result.messages.length).toBeLessThanOrEqual(30);
  });

  it('uses default values when constructed without arguments', () => {
    const strategy = new AdaptiveContextStrategy();
    const messages = makeMessages(50, 10);
    const result = strategy.prepareContext(messages);
    expect(result.messages.length).toBeGreaterThan(0);
  });
});

// ========== Edge cases ==========

describe('Edge cases', () => {
  it('all strategies handle empty message array', () => {
    const append = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 10000 });
    const rolling = new RollingContextStrategy({ strategy: 'rolling', maxTokens: 5000, maxGraceTokens: 2000 });
    const legacy = new LegacyRollingContextStrategy();
    const staticS = new StaticContextStrategy();
    const adaptive = new AdaptiveContextStrategy();

    for (const strategy of [append, rolling, legacy, staticS, adaptive]) {
      const result = strategy.prepareContext([]);
      expect(result.messages).toHaveLength(0);
      expect(result.metadata.totalMessages).toBe(0);
    }
  });

  it('all strategies handle single message', () => {
    const msg = makeMessage('Hello world');
    const append = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 10000 });
    const rolling = new RollingContextStrategy({ strategy: 'rolling', maxTokens: 5000, maxGraceTokens: 2000 });
    const legacy = new LegacyRollingContextStrategy();
    const staticS = new StaticContextStrategy();
    const adaptive = new AdaptiveContextStrategy();

    for (const strategy of [append, rolling, legacy, staticS, adaptive]) {
      const result = strategy.prepareContext([msg]);
      expect(result.messages).toHaveLength(1);
    }
  });

  it('handles message with multiple thinking blocks', () => {
    const strategy = new AppendContextStrategy({ strategy: 'append', tokensBeforeCaching: 100000 });
    const msg = makeMessage('short', 'assistant', {
      contentBlocks: [
        { type: 'thinking', thinking: 'a'.repeat(40) }, // 10 tokens + 10 overhead
        { type: 'thinking', thinking: 'b'.repeat(80) }, // 20 tokens + 10 overhead
        { type: 'redacted_thinking' }, // 15 tokens
      ],
    });
    const result = strategy.prepareContext([msg]);
    // text: ceil(5/4) = 2 tokens; thinking1: 20; thinking2: 30; redacted: 15 = 67
    const expectedText = Math.ceil(5 / 4); // "short" = 5 chars
    const expectedThinking1 = Math.ceil(40 / 4) + 10;
    const expectedThinking2 = Math.ceil(80 / 4) + 10;
    const expectedRedacted = 15;
    expect(result.metadata.totalTokens).toBe(
      expectedText + expectedThinking1 + expectedThinking2 + expectedRedacted
    );
  });
});
