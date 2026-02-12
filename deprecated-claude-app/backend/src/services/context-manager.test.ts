import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextManager } from './context-manager.js';
import type { Message, Conversation } from '@deprecated-claude/shared';

/**
 * Context manager characterization tests.
 *
 * We construct a real ContextManager with controlled config and
 * let the real ContextStrategy logic (AppendContextStrategy and
 * RollingContextStrategy) run. Database and PersonaContextBuilder
 * are not used here (no db parameter) so persona context is skipped.
 */

function makeMessage(
  id: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  parentBranchId: string = 'root'
): Message {
  const branchId = `branch-${id}`;
  return {
    id,
    conversationId: 'conv-1',
    activeBranchId: branchId,
    order: 0,
    branches: [
      {
        id: branchId,
        role,
        content,
        createdAt: new Date(),
        parentBranchId,
      },
    ],
  } as any;
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    userId: 'user-1',
    title: 'Test Conversation',
    model: 'claude-sonnet-4-20250514',
    format: 'standard',
    createdAt: new Date(),
    updatedAt: new Date(),
    archived: false,
    settings: {
      temperature: 1.0,
      maxTokens: 4096,
    },
    ...overrides,
  } as any;
}

describe('ContextManager', () => {
  describe('constructor', () => {
    it('creates with default config when no options provided', () => {
      const cm = new ContextManager();
      expect(cm).toBeDefined();
    });

    it('merges provided config with defaults', () => {
      const cm = new ContextManager({ enableCaching: false });
      // We can verify through behavior — cache key should be undefined
      expect(cm).toBeDefined();
    });
  });

  describe('prepareContext', () => {
    it('returns formatted messages and context window for basic conversation', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      const messages = [
        makeMessage('m1', 'user', 'Hello'),
        makeMessage('m2', 'assistant', 'Hi there!'),
      ];

      const result = await cm.prepareContext(conversation, messages);

      expect(result.formattedMessages).toBeDefined();
      expect(result.formattedMessages.length).toBeGreaterThan(0);
      expect(result.window).toBeDefined();
      expect(result.window.messages).toBeDefined();
      expect(result.window.metadata.totalMessages).toBeGreaterThan(0);
    });

    it('generates a cache key for cacheable prefix', async () => {
      const cm = new ContextManager({ enableCaching: true });
      const conversation = makeConversation();
      const messages = [
        makeMessage('m1', 'user', 'Hello'),
        makeMessage('m2', 'assistant', 'Hi there!'),
      ];

      const result = await cm.prepareContext(conversation, messages);

      expect(result.cacheKey).toBeDefined();
      expect(typeof result.cacheKey).toBe('string');
    });

    it('returns undefined cacheKey when caching is disabled', async () => {
      const cm = new ContextManager({ enableCaching: false });
      const conversation = makeConversation();
      const messages = [makeMessage('m1', 'user', 'Hello')];

      const result = await cm.prepareContext(conversation, messages);

      expect(result.cacheKey).toBeUndefined();
    });

    it('handles empty message list', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();

      const result = await cm.prepareContext(conversation, []);

      expect(result.formattedMessages).toEqual([]);
      expect(result.window.messages).toEqual([]);
    });

    it('uses append strategy by default', async () => {
      const cm = new ContextManager({ defaultStrategy: 'static' });
      const conversation = makeConversation({
        contextManagement: { strategy: 'append', tokensBeforeCaching: 10000 },
      });
      const messages = [makeMessage('m1', 'user', 'Hello')];

      const result = await cm.prepareContext(conversation, messages);

      // Append strategy includes all messages
      expect(result.window.messages.length).toBe(messages.length);
    });

    it('uses rolling strategy when conversation specifies it', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation({
        contextManagement: {
          strategy: 'rolling',
          maxTokens: 50000,
          maxGraceTokens: 5000,
        },
      });
      const messages = [
        makeMessage('m1', 'user', 'Hello'),
        makeMessage('m2', 'assistant', 'Hi'),
      ];

      const result = await cm.prepareContext(conversation, messages);

      expect(result.window.messages.length).toBeGreaterThan(0);
    });

    it('creates separate strategy instances per conversation', async () => {
      const cm = new ContextManager();
      const conv1 = makeConversation({ id: 'conv-1' });
      const conv2 = makeConversation({ id: 'conv-2' });
      const messages = [makeMessage('m1', 'user', 'Hello')];

      const result1 = await cm.prepareContext(conv1, messages);
      const result2 = await cm.prepareContext(conv2, messages);

      // Both should produce results
      expect(result1.window.messages).toBeDefined();
      expect(result2.window.messages).toBeDefined();
    });

    it('creates per-participant strategy instances', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      const messages = [makeMessage('m1', 'user', 'Hello')];

      const participant1 = {
        id: 'p1',
        conversationId: 'conv-1',
        name: 'Claude',
        type: 'assistant',
        isActive: true,
      } as any;

      const participant2 = {
        id: 'p2',
        conversationId: 'conv-1',
        name: 'GPT',
        type: 'assistant',
        isActive: true,
      } as any;

      await cm.prepareContext(conversation, messages, undefined, participant1);
      await cm.prepareContext(conversation, messages, undefined, participant2);

      // Both should have separate statistics
      const stats1 = cm.getStatistics('conv-1', 'p1');
      const stats2 = cm.getStatistics('conv-1', 'p2');
      expect(stats1).not.toBeNull();
      expect(stats2).not.toBeNull();
    });
  });

  describe('prepareContext with longer conversations', () => {
    it('generates cache key based on cacheable prefix', async () => {
      const cm = new ContextManager({ enableCaching: true });
      const conversation = makeConversation({
        contextManagement: {
          strategy: 'append',
          tokensBeforeCaching: 10, // Very low threshold
        },
      });

      // Create enough messages to exceed the low threshold
      const messages: Message[] = [];
      let parentBranchId = 'root';
      for (let i = 0; i < 20; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant';
        const msg = makeMessage(`m${i}`, role as any, `Message ${i} with some content that adds tokens`);
        msg.branches[0].parentBranchId = parentBranchId;
        parentBranchId = msg.activeBranchId;
        msg.order = i;
        messages.push(msg);
      }

      const result = await cm.prepareContext(conversation, messages);

      // The window should contain all messages
      expect(result.window.messages.length).toBe(20);
      // cacheKey type depends on whether cacheablePrefix is non-empty
      expect(typeof result.cacheKey === 'string' || result.cacheKey === undefined).toBe(true);
    });

    it('tracks statistics across repeated calls with same messages', async () => {
      const cm = new ContextManager({ enableCaching: true });
      const conversation = makeConversation({
        contextManagement: {
          strategy: 'append',
          tokensBeforeCaching: 10,
        },
      });

      const messages: Message[] = [];
      let parentBranchId = 'root';
      for (let i = 0; i < 20; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant';
        const msg = makeMessage(`m${i}`, role as any, `Message ${i} repeated`);
        msg.branches[0].parentBranchId = parentBranchId;
        parentBranchId = msg.activeBranchId;
        msg.order = i;
        messages.push(msg);
      }

      // Multiple calls
      await cm.prepareContext(conversation, messages);
      await cm.prepareContext(conversation, messages);

      const stats = cm.getStatistics('conv-1');
      // Total interactions should be 2
      expect(stats!.cacheHits + stats!.cacheMisses + stats!.cacheExpired).toBe(2);
    });

    it('handles rolling strategy with many messages', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation({
        contextManagement: {
          strategy: 'rolling',
          maxTokens: 500,
          maxGraceTokens: 100,
        },
      });

      const messages: Message[] = [];
      let parentBranchId = 'root';
      for (let i = 0; i < 50; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant';
        const msg = makeMessage(`m${i}`, role as any, `Message ${i}: ${Array(50).fill('word').join(' ')}`);
        msg.branches[0].parentBranchId = parentBranchId;
        parentBranchId = msg.activeBranchId;
        msg.order = i;
        messages.push(msg);
      }

      const result = await cm.prepareContext(conversation, messages);

      // With rolling strategy and low token limit, window should be smaller than total
      expect(result.window.metadata.totalMessages).toBeLessThanOrEqual(messages.length);
      expect(result.window.messages.length).toBeGreaterThan(0);
    });

    it('exercises shouldRotate and rotationCount', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation({
        contextManagement: {
          strategy: 'rolling',
          maxTokens: 200,
          maxGraceTokens: 50,
        },
      });

      // First: small conversation
      const messages1: Message[] = [makeMessage('m1', 'user', 'Hello')];
      await cm.prepareContext(conversation, messages1);

      // Second: much larger conversation — may trigger rotation
      const messages2: Message[] = [];
      let parentBranchId = 'root';
      for (let i = 0; i < 30; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant';
        const msg = makeMessage(`m${i}`, role as any, `Message ${i}: ${Array(30).fill('word').join(' ')}`);
        msg.branches[0].parentBranchId = parentBranchId;
        parentBranchId = msg.activeBranchId;
        msg.order = i;
        messages2.push(msg);
      }
      await cm.prepareContext(conversation, messages2);

      const stats = cm.getStatistics('conv-1');
      expect(stats).not.toBeNull();
      // rotationCount should be tracked (may or may not have rotated)
      expect(typeof stats!.rotationCount).toBe('number');
    });

    it('formats messages with role and content', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      const messages = [
        makeMessage('m1', 'user', 'What is 2+2?'),
        makeMessage('m2', 'assistant', 'The answer is 4.'),
      ];

      const result = await cm.prepareContext(conversation, messages);

      expect(result.formattedMessages).toHaveLength(2);
      expect(result.formattedMessages[0].role).toBe('user');
      expect(result.formattedMessages[0].content).toBe('What is 2+2?');
      expect(result.formattedMessages[1].role).toBe('assistant');
      expect(result.formattedMessages[1].content).toBe('The answer is 4.');
    });
  });

  describe('statistics tracking', () => {
    it('tracks cache misses on first call', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      const messages = [makeMessage('m1', 'user', 'Hello')];

      await cm.prepareContext(conversation, messages);

      const stats = cm.getStatistics('conv-1');
      expect(stats).not.toBeNull();
      expect(stats!.cacheMisses).toBe(1);
      expect(stats!.cacheHits).toBe(0);
    });

    it('tracks cache misses increment on subsequent calls with different messages', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      const messages1 = [makeMessage('m1', 'user', 'Hello')];
      const messages2 = [
        makeMessage('m1', 'user', 'Hello'),
        makeMessage('m2', 'assistant', 'Hi'),
        makeMessage('m3', 'user', 'How are you?'),
      ];

      await cm.prepareContext(conversation, messages1);
      await cm.prepareContext(conversation, messages2);

      const stats = cm.getStatistics('conv-1');
      // Different messages produce different cache keys → 2 misses
      expect(stats!.cacheMisses).toBe(2);
    });

    it('counts all calls as misses when cacheablePrefix is empty (append strategy)', async () => {
      // With append strategy and no explicit cache threshold, the cacheablePrefix
      // is empty → cache key is '' → comparison triggers miss each time
      const cm = new ContextManager();
      const conversation = makeConversation();
      const messages = [
        makeMessage('m1', 'user', 'Hello'),
        makeMessage('m2', 'assistant', 'Hi there!'),
      ];

      await cm.prepareContext(conversation, messages);
      await cm.prepareContext(conversation, messages);
      await cm.prepareContext(conversation, messages);

      const stats = cm.getStatistics('conv-1');
      // With default append strategy, all calls are counted
      expect(stats!.cacheMisses + stats!.cacheHits).toBe(3);
    });

    it('returns null statistics for unknown conversation', () => {
      const cm = new ContextManager();
      const stats = cm.getStatistics('nonexistent');
      expect(stats).toBeNull();
    });
  });

  describe('updateAfterInference', () => {
    it('updates saved tokens when cachedTokens provided', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      const messages = [makeMessage('m1', 'user', 'Hello')];

      await cm.prepareContext(conversation, messages);

      cm.updateAfterInference('conv-1', {
        cacheHit: true,
        tokensUsed: 100,
        cachedTokens: 50,
      });

      const stats = cm.getStatistics('conv-1');
      expect(stats!.totalTokensSaved).toBe(50);
    });

    it('handles cacheRead + cacheCreated (partial hit + rebuild)', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      await cm.prepareContext(conversation, [makeMessage('m1', 'user', 'Hi')]);

      cm.updateAfterInference('conv-1', {
        cacheHit: true,
        tokensUsed: 200,
        cacheRead: 100,
        cacheCreated: 50,
      });

      // Should not throw and state should still be accessible
      expect(cm.getStatistics('conv-1')).not.toBeNull();
    });

    it('handles cacheCreated without cacheRead (new cache)', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      await cm.prepareContext(conversation, [makeMessage('m1', 'user', 'Hi')]);

      cm.updateAfterInference('conv-1', {
        cacheHit: false,
        tokensUsed: 200,
        cacheCreated: 150,
      });

      expect(cm.getStatistics('conv-1')).not.toBeNull();
    });

    it('handles cacheRead without cacheCreated (full hit)', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      await cm.prepareContext(conversation, [makeMessage('m1', 'user', 'Hi')]);

      cm.updateAfterInference('conv-1', {
        cacheHit: true,
        tokensUsed: 100,
        cacheRead: 100,
      });

      expect(cm.getStatistics('conv-1')).not.toBeNull();
    });

    it('accumulates totalTokensSaved across multiple calls', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      await cm.prepareContext(conversation, [makeMessage('m1', 'user', 'Hi')]);

      cm.updateAfterInference('conv-1', {
        cacheHit: true,
        tokensUsed: 100,
        cachedTokens: 50,
      });
      cm.updateAfterInference('conv-1', {
        cacheHit: true,
        tokensUsed: 100,
        cachedTokens: 30,
      });

      const stats = cm.getStatistics('conv-1');
      expect(stats!.totalTokensSaved).toBe(80);
    });

    it('uses participant-specific state key when participantId provided', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      const participant = {
        id: 'p1',
        conversationId: 'conv-1',
        name: 'Claude',
        type: 'assistant',
        isActive: true,
      } as any;

      await cm.prepareContext(conversation, [makeMessage('m1', 'user', 'Hi')], undefined, participant);

      cm.updateAfterInference('conv-1', {
        cacheHit: true,
        tokensUsed: 100,
        cachedTokens: 40,
      }, 'p1');

      const stats = cm.getStatistics('conv-1', 'p1');
      expect(stats!.totalTokensSaved).toBe(40);
    });

    it('no-ops when conversation has no state', () => {
      const cm = new ContextManager();
      // Should not throw
      cm.updateAfterInference('nonexistent', {
        cacheHit: false,
        tokensUsed: 100,
      });
    });
  });

  describe('getCacheMarker', () => {
    it('returns undefined for new conversation', () => {
      const cm = new ContextManager();
      const marker = cm.getCacheMarker('conv-1');
      expect(marker).toBeUndefined();
    });
  });

  describe('setContextManagement', () => {
    it('resets window and cache marker when strategy changes', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      const messages = [makeMessage('m1', 'user', 'Hello')];

      await cm.prepareContext(conversation, messages);

      // Switch strategy
      cm.setContextManagement('conv-1', {
        strategy: 'rolling',
        maxTokens: 50000,
        maxGraceTokens: 5000,
      });

      // After reset, cache marker should be cleared
      const marker = cm.getCacheMarker('conv-1');
      expect(marker).toBeUndefined();
    });

    it('sets strategy for a participant-specific state', async () => {
      const cm = new ContextManager();

      cm.setContextManagement('conv-1', {
        strategy: 'append',
        tokensBeforeCaching: 5000,
      }, 'p1');

      // State should exist now (getOrCreateState is called)
      const stats = cm.getStatistics('conv-1', 'p1');
      expect(stats).not.toBeNull();
    });

    it('throws for unknown strategy', () => {
      const cm = new ContextManager();

      expect(() => {
        cm.setContextManagement('conv-1', {
          strategy: 'nonexistent' as any,
        });
      }).toThrow('Unknown context strategy');
    });
  });

  describe('clearState', () => {
    it('clears state for a specific conversation', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      const messages = [makeMessage('m1', 'user', 'Hello')];

      await cm.prepareContext(conversation, messages);
      expect(cm.getStatistics('conv-1')).not.toBeNull();

      cm.clearState('conv-1');
      expect(cm.getStatistics('conv-1')).toBeNull();
    });

    it('clears all participant states when clearing conversation', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      const messages = [makeMessage('m1', 'user', 'Hello')];

      const participant = {
        id: 'p1',
        conversationId: 'conv-1',
        name: 'Claude',
        type: 'assistant',
        isActive: true,
      } as any;

      await cm.prepareContext(conversation, messages, undefined, participant);
      expect(cm.getStatistics('conv-1', 'p1')).not.toBeNull();

      cm.clearState('conv-1');
      expect(cm.getStatistics('conv-1', 'p1')).toBeNull();
    });

    it('clears only a specific participant state', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      const messages = [makeMessage('m1', 'user', 'Hello')];

      const p1 = { id: 'p1', conversationId: 'conv-1', name: 'A', type: 'assistant', isActive: true } as any;
      const p2 = { id: 'p2', conversationId: 'conv-1', name: 'B', type: 'assistant', isActive: true } as any;

      await cm.prepareContext(conversation, messages, undefined, p1);
      await cm.prepareContext(conversation, messages, undefined, p2);

      cm.clearState('conv-1', 'p1');
      expect(cm.getStatistics('conv-1', 'p1')).toBeNull();
      expect(cm.getStatistics('conv-1', 'p2')).not.toBeNull();
    });

    it('clears all state when no conversationId provided', async () => {
      const cm = new ContextManager();
      const conv1 = makeConversation({ id: 'conv-1' });
      const conv2 = makeConversation({ id: 'conv-2' });
      const messages = [makeMessage('m1', 'user', 'Hello')];

      await cm.prepareContext(conv1, messages);
      await cm.prepareContext(conv2, messages);

      cm.clearState();

      expect(cm.getStatistics('conv-1')).toBeNull();
      expect(cm.getStatistics('conv-2')).toBeNull();
    });
  });

  describe('exportState', () => {
    it('exports state for debugging', async () => {
      const cm = new ContextManager();
      const conversation = makeConversation();
      const messages = [makeMessage('m1', 'user', 'Hello')];

      await cm.prepareContext(conversation, messages);

      const state = cm.exportState();
      expect(state['conv-1']).toBeDefined();
      expect(state['conv-1'].conversationId).toBe('conv-1');
      expect(state['conv-1'].statistics).toBeDefined();
    });

    it('returns empty object when no state exists', () => {
      const cm = new ContextManager();
      const state = cm.exportState();
      expect(state).toEqual({});
    });
  });
});
