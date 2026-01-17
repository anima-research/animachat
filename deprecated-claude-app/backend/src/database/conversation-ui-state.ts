import fs from 'fs/promises';
import path from 'path';

/**
 * Shared conversation state - synced to all attached users
 */
export interface SharedConversationState {
  activeBranches: Record<string, string>; // messageId -> branchId
  totalBranchCount?: number; // cached count of non-system branches (for unread calculation)
}

/**
 * Per-user conversation state - never synced
 */
export interface UserConversationState {
  speakingAs?: string;          // participantId the user is speaking as
  selectedResponder?: string;   // participantId of AI that will respond
  isDetached?: boolean;         // if true, user navigates independently
  detachedBranches?: Record<string, string>; // messageId -> branchId (only used if isDetached)
  readBranchIds?: string[];     // branch IDs this user has seen (for unread tracking)
  lastReadAt?: string;          // ISO timestamp of last read action
}

/**
 * ConversationUIStateStore - Mutable store for UI state that shouldn't bloat the event log
 * 
 * Shared state: ./data/conversation-state/{shard}/{conversationId}.json
 * Per-user state: ./data/user-conversation-state/{shard}/{conversationId}/{userId}.json
 */
export class ConversationUIStateStore {
  private sharedBaseDir: string;
  private userBaseDir: string;
  
  // Caches
  private sharedCache: Map<string, SharedConversationState> = new Map();
  private userCache: Map<string, UserConversationState> = new Map(); // key: `${conversationId}:${userId}`

  constructor(
    sharedBaseDir: string = './data/conversation-state',
    userBaseDir: string = './data/user-conversation-state'
  ) {
    this.sharedBaseDir = sharedBaseDir;
    this.userBaseDir = userBaseDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.sharedBaseDir, { recursive: true });
    await fs.mkdir(this.userBaseDir, { recursive: true });
  }

  private getShard(id: string): string {
    return id.substring(0, 2);
  }

  private getSharedFilePath(conversationId: string): string {
    const shard = this.getShard(conversationId);
    return path.join(this.sharedBaseDir, shard, `${conversationId}.json`);
  }

  private getUserFilePath(conversationId: string, userId: string): string {
    const shard = this.getShard(conversationId);
    return path.join(this.userBaseDir, shard, conversationId, `${userId}.json`);
  }

  // ==================== SHARED STATE ====================

  async loadShared(conversationId: string): Promise<SharedConversationState> {
    const cached = this.sharedCache.get(conversationId);
    if (cached) return cached;

    try {
      const filePath = this.getSharedFilePath(conversationId);
      const data = await fs.readFile(filePath, 'utf-8');
      const state = JSON.parse(data) as SharedConversationState;
      this.sharedCache.set(conversationId, state);
      return state;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        const empty: SharedConversationState = { activeBranches: {} };
        this.sharedCache.set(conversationId, empty);
        return empty;
      }
      throw error;
    }
  }

  async saveShared(conversationId: string, state: SharedConversationState): Promise<void> {
    const filePath = this.getSharedFilePath(conversationId);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(state, null, 2));
    this.sharedCache.set(conversationId, state);
  }

  async setSharedActiveBranch(conversationId: string, messageId: string, branchId: string): Promise<void> {
    const state = await this.loadShared(conversationId);
    state.activeBranches[messageId] = branchId;
    await this.saveShared(conversationId, state);
  }

  async getSharedActiveBranch(conversationId: string, messageId: string): Promise<string | undefined> {
    const state = await this.loadShared(conversationId);
    return state.activeBranches[messageId];
  }

  // Branch count methods (for unread tracking without loading full conversation)

  async getTotalBranchCount(conversationId: string): Promise<number> {
    const state = await this.loadShared(conversationId);
    return state.totalBranchCount ?? 0;
  }

  async incrementBranchCount(conversationId: string, delta: number = 1): Promise<number> {
    const state = await this.loadShared(conversationId);
    const newCount = Math.max(0, (state.totalBranchCount ?? 0) + delta);
    state.totalBranchCount = newCount;
    await this.saveShared(conversationId, state);
    return newCount;
  }

  async decrementBranchCount(conversationId: string, delta: number = 1): Promise<number> {
    return this.incrementBranchCount(conversationId, -delta);
  }

  // ==================== PER-USER STATE ====================

  private getUserCacheKey(conversationId: string, userId: string): string {
    return `${conversationId}:${userId}`;
  }

  async loadUser(conversationId: string, userId: string): Promise<UserConversationState> {
    const cacheKey = this.getUserCacheKey(conversationId, userId);
    const cached = this.userCache.get(cacheKey);
    if (cached) return cached;

    try {
      const filePath = this.getUserFilePath(conversationId, userId);
      const data = await fs.readFile(filePath, 'utf-8');
      const state = JSON.parse(data) as UserConversationState;
      this.userCache.set(cacheKey, state);
      return state;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        const empty: UserConversationState = {};
        this.userCache.set(cacheKey, empty);
        return empty;
      }
      throw error;
    }
  }

  async saveUser(conversationId: string, userId: string, state: UserConversationState): Promise<void> {
    const filePath = this.getUserFilePath(conversationId, userId);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(state, null, 2));
    this.userCache.set(this.getUserCacheKey(conversationId, userId), state);
  }

  async updateUser(
    conversationId: string, 
    userId: string, 
    updates: Partial<UserConversationState>
  ): Promise<UserConversationState> {
    const state = await this.loadUser(conversationId, userId);
    const updated = { ...state, ...updates };
    await this.saveUser(conversationId, userId, updated);
    return updated;
  }

  async setSpeakingAs(conversationId: string, userId: string, participantId: string | undefined): Promise<void> {
    await this.updateUser(conversationId, userId, { speakingAs: participantId });
  }

  async setSelectedResponder(conversationId: string, userId: string, participantId: string | undefined): Promise<void> {
    await this.updateUser(conversationId, userId, { selectedResponder: participantId });
  }

  async setDetached(conversationId: string, userId: string, isDetached: boolean): Promise<void> {
    const updates: Partial<UserConversationState> = { isDetached };
    if (!isDetached) {
      // Clear detached branches when re-attaching
      updates.detachedBranches = {};
    }
    await this.updateUser(conversationId, userId, updates);
  }

  async setDetachedBranch(conversationId: string, userId: string, messageId: string, branchId: string): Promise<void> {
    const state = await this.loadUser(conversationId, userId);
    const detachedBranches = state.detachedBranches || {};
    detachedBranches[messageId] = branchId;
    await this.updateUser(conversationId, userId, { detachedBranches });
  }

  // ==================== READ TRACKING ====================

  async markBranchesAsRead(conversationId: string, userId: string, branchIds: string[]): Promise<void> {
    const state = await this.loadUser(conversationId, userId);
    const existing = new Set(state.readBranchIds || []);
    for (const id of branchIds) {
      existing.add(id);
    }
    await this.updateUser(conversationId, userId, {
      readBranchIds: Array.from(existing),
      lastReadAt: new Date().toISOString()
    });
  }

  async getReadBranchIds(conversationId: string, userId: string): Promise<string[]> {
    const state = await this.loadUser(conversationId, userId);
    return state.readBranchIds || [];
  }

  // ==================== CACHE MANAGEMENT ====================

  clearCache(conversationId: string): void {
    this.sharedCache.delete(conversationId);
    // Clear all user caches for this conversation
    for (const key of this.userCache.keys()) {
      if (key.startsWith(`${conversationId}:`)) {
        this.userCache.delete(key);
      }
    }
  }

  clearUserCache(conversationId: string, userId: string): void {
    this.userCache.delete(this.getUserCacheKey(conversationId, userId));
  }

  // ==================== CLEANUP ====================

  async deleteConversation(conversationId: string): Promise<void> {
    this.clearCache(conversationId);
    
    // Delete shared state
    try {
      await fs.unlink(this.getSharedFilePath(conversationId));
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }

    // Delete user state directory
    try {
      const shard = this.getShard(conversationId);
      const userDir = path.join(this.userBaseDir, shard, conversationId);
      await fs.rm(userDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

// Singleton
let instance: ConversationUIStateStore | null = null;

export function getConversationUIStateStore(): ConversationUIStateStore {
  if (!instance) {
    instance = new ConversationUIStateStore();
  }
  return instance;
}

export async function initConversationUIStateStore(): Promise<ConversationUIStateStore> {
  const store = getConversationUIStateStore();
  await store.init();
  return store;
}

