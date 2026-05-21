import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConversationUIStateStore } from './conversation-ui-state.js';
import fs from 'fs/promises';
import path from 'path';

const TEMP_BASE = '/tmp/claude-1000/-home-quiterion-Projects-animachat/b5033edf-f70b-4576-94e3-550fce4fbf90/scratchpad';
let tempDir: string;
let store: ConversationUIStateStore;

function makeTempDir(): string {
  return path.join(TEMP_BASE, `ui-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('ConversationUIStateStore', () => {
  beforeEach(async () => {
    tempDir = makeTempDir();
    const sharedDir = path.join(tempDir, 'shared');
    const userDir = path.join(tempDir, 'user');
    store = new ConversationUIStateStore(sharedDir, userDir);
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('creates both base directories', async () => {
      const sharedStat = await fs.stat(path.join(tempDir, 'shared'));
      const userStat = await fs.stat(path.join(tempDir, 'user'));
      expect(sharedStat.isDirectory()).toBe(true);
      expect(userStat.isDirectory()).toBe(true);
    });
  });

  describe('shared state', () => {
    it('returns default empty state for new conversation', async () => {
      const state = await store.loadShared('conv-1');
      expect(state).toEqual({ activeBranches: {} });
    });

    it('saves and loads shared state', async () => {
      const state = { activeBranches: { 'msg-1': 'branch-a' }, totalBranchCount: 5 };
      await store.saveShared('conv-1', state);

      // Clear cache and reload from disk
      store.clearCache('conv-1');
      const loaded = await store.loadShared('conv-1');
      expect(loaded.activeBranches['msg-1']).toBe('branch-a');
      expect(loaded.totalBranchCount).toBe(5);
    });

    it('caches shared state after first load', async () => {
      await store.saveShared('conv-1', { activeBranches: { 'msg-1': 'b-1' } });

      // First load
      const state1 = await store.loadShared('conv-1');
      // Mutate directly (this should affect the cached reference)
      state1.activeBranches['msg-2'] = 'b-2';

      // Second load should return the same cached reference
      const state2 = await store.loadShared('conv-1');
      expect(state2.activeBranches['msg-2']).toBe('b-2');
    });

    it('setSharedActiveBranch updates and persists', async () => {
      await store.setSharedActiveBranch('conv-1', 'msg-1', 'branch-x');

      store.clearCache('conv-1');
      const branch = await store.getSharedActiveBranch('conv-1', 'msg-1');
      expect(branch).toBe('branch-x');
    });

    it('getSharedActiveBranch returns undefined for unset message', async () => {
      const branch = await store.getSharedActiveBranch('conv-1', 'unknown-msg');
      expect(branch).toBeUndefined();
    });
  });

  describe('branch count tracking', () => {
    it('returns 0 for new conversation', async () => {
      const count = await store.getTotalBranchCount('conv-1');
      expect(count).toBe(0);
    });

    it('increments branch count', async () => {
      const count = await store.incrementBranchCount('conv-1');
      expect(count).toBe(1);

      const count2 = await store.incrementBranchCount('conv-1');
      expect(count2).toBe(2);
    });

    it('increments by custom delta', async () => {
      const count = await store.incrementBranchCount('conv-1', 5);
      expect(count).toBe(5);
    });

    it('decrements branch count', async () => {
      await store.incrementBranchCount('conv-1', 10);
      const count = await store.decrementBranchCount('conv-1', 3);
      expect(count).toBe(7);
    });

    it('does not go below zero on decrement', async () => {
      await store.incrementBranchCount('conv-1', 2);
      const count = await store.decrementBranchCount('conv-1', 5);
      expect(count).toBe(0);
    });
  });

  describe('per-user state', () => {
    it('returns empty state for new user', async () => {
      const state = await store.loadUser('conv-1', 'user-1');
      expect(state).toEqual({});
    });

    it('saves and loads user state', async () => {
      const state = { speakingAs: 'participant-1', selectedResponder: 'ai-1' };
      await store.saveUser('conv-1', 'user-1', state);

      store.clearUserCache('conv-1', 'user-1');
      const loaded = await store.loadUser('conv-1', 'user-1');
      expect(loaded.speakingAs).toBe('participant-1');
      expect(loaded.selectedResponder).toBe('ai-1');
    });

    it('updates user state partially', async () => {
      await store.saveUser('conv-1', 'user-1', {
        speakingAs: 'part-1',
        selectedResponder: 'ai-1'
      });

      const updated = await store.updateUser('conv-1', 'user-1', {
        speakingAs: 'part-2'
      });

      expect(updated.speakingAs).toBe('part-2');
      expect(updated.selectedResponder).toBe('ai-1'); // preserved
    });

    it('setSpeakingAs updates correctly', async () => {
      await store.setSpeakingAs('conv-1', 'user-1', 'part-1');
      const state = await store.loadUser('conv-1', 'user-1');
      expect(state.speakingAs).toBe('part-1');
    });

    it('setSelectedResponder updates correctly', async () => {
      await store.setSelectedResponder('conv-1', 'user-1', 'ai-responder');
      const state = await store.loadUser('conv-1', 'user-1');
      expect(state.selectedResponder).toBe('ai-responder');
    });
  });

  describe('detached state', () => {
    it('sets detached mode with branches', async () => {
      await store.setDetached('conv-1', 'user-1', true);
      const state = await store.loadUser('conv-1', 'user-1');
      expect(state.isDetached).toBe(true);
    });

    it('clears detached branches when re-attaching', async () => {
      await store.setDetached('conv-1', 'user-1', true);
      await store.setDetachedBranch('conv-1', 'user-1', 'msg-1', 'branch-x');

      await store.setDetached('conv-1', 'user-1', false);
      const state = await store.loadUser('conv-1', 'user-1');
      expect(state.isDetached).toBe(false);
      expect(state.detachedBranches).toEqual({});
    });

    it('sets detached branch for a message', async () => {
      await store.setDetachedBranch('conv-1', 'user-1', 'msg-1', 'branch-a');
      const state = await store.loadUser('conv-1', 'user-1');
      expect(state.detachedBranches!['msg-1']).toBe('branch-a');
    });
  });

  describe('read tracking', () => {
    it('marks branches as read', async () => {
      await store.markBranchesAsRead('conv-1', 'user-1', ['b-1', 'b-2']);
      const readIds = await store.getReadBranchIds('conv-1', 'user-1');
      expect(readIds).toContain('b-1');
      expect(readIds).toContain('b-2');
    });

    it('deduplicates already-read branches', async () => {
      await store.markBranchesAsRead('conv-1', 'user-1', ['b-1', 'b-2']);
      await store.markBranchesAsRead('conv-1', 'user-1', ['b-2', 'b-3']);

      const readIds = await store.getReadBranchIds('conv-1', 'user-1');
      expect(readIds).toHaveLength(3); // b-1, b-2, b-3 (no duplicate)
    });

    it('sets lastReadAt timestamp', async () => {
      await store.markBranchesAsRead('conv-1', 'user-1', ['b-1']);
      const state = await store.loadUser('conv-1', 'user-1');
      expect(state.lastReadAt).toBeTruthy();
      // Verify it's a valid ISO timestamp
      expect(new Date(state.lastReadAt!).toISOString()).toBe(state.lastReadAt);
    });

    it('returns empty array for no reads', async () => {
      const readIds = await store.getReadBranchIds('conv-1', 'user-1');
      expect(readIds).toEqual([]);
    });
  });

  describe('cache management', () => {
    it('clearCache removes shared and user caches for a conversation', async () => {
      await store.saveShared('conv-1', { activeBranches: { 'msg-1': 'b-1' } });
      await store.saveUser('conv-1', 'user-1', { speakingAs: 'p-1' });

      // Modify files on disk after caching
      const sharedPath = path.join(tempDir, 'shared', 'co', 'conv-1.json');
      await fs.writeFile(sharedPath, JSON.stringify({ activeBranches: { 'msg-1': 'b-changed' } }));

      // Before clear, still returns cached value
      const cached = await store.loadShared('conv-1');
      expect(cached.activeBranches['msg-1']).toBe('b-1');

      // After clear, reloads from disk
      store.clearCache('conv-1');
      const reloaded = await store.loadShared('conv-1');
      expect(reloaded.activeBranches['msg-1']).toBe('b-changed');
    });

    it('clearUserCache only clears specific user cache', async () => {
      await store.saveUser('conv-1', 'user-1', { speakingAs: 'p-1' });
      await store.saveUser('conv-1', 'user-2', { speakingAs: 'p-2' });

      store.clearUserCache('conv-1', 'user-1');

      // user-2's cache should still be intact (returns cached value)
      const state2 = await store.loadUser('conv-1', 'user-2');
      expect(state2.speakingAs).toBe('p-2');
    });
  });

  describe('deleteConversation', () => {
    it('removes all state files and clears cache', async () => {
      await store.saveShared('conv-1', { activeBranches: { 'msg-1': 'b-1' } });
      await store.saveUser('conv-1', 'user-1', { speakingAs: 'p-1' });

      await store.deleteConversation('conv-1');

      // Loading after deletion should return defaults
      const shared = await store.loadShared('conv-1');
      expect(shared).toEqual({ activeBranches: {} });

      const user = await store.loadUser('conv-1', 'user-1');
      expect(user).toEqual({});
    });

    it('does not throw for nonexistent conversation', async () => {
      await store.deleteConversation('nonexistent-conv');
      // Should not throw
    });
  });
});
