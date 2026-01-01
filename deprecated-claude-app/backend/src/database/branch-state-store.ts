import fs from 'fs/promises';
import path from 'path';

/**
 * BranchStateStore - Mutable store for active branch selections
 * 
 * Unlike the event log which is append-only, this store is overwritten
 * on each update. This prevents branch navigation from bloating the event log.
 * 
 * Storage: ./data/branch-state/{conversationId}.json
 * Format: { [messageId]: activeBranchId }
 */
export class BranchStateStore {
  private baseDir: string;
  private cache: Map<string, Map<string, string>> = new Map(); // conversationId -> (messageId -> branchId)

  constructor(baseDir: string = './data/branch-state') {
    this.baseDir = baseDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  private getFilePath(conversationId: string): string {
    // Shard by first 2 chars of conversation ID to prevent too many files in one dir
    const shard = conversationId.substring(0, 2);
    return path.join(this.baseDir, shard, `${conversationId}.json`);
  }

  /**
   * Load branch state for a conversation
   */
  async load(conversationId: string): Promise<Map<string, string>> {
    // Check cache first
    const cached = this.cache.get(conversationId);
    if (cached) {
      return cached;
    }

    try {
      const filePath = this.getFilePath(conversationId);
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data) as Record<string, string>;
      const state = new Map(Object.entries(parsed));
      this.cache.set(conversationId, state);
      return state;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // No state file yet - return empty map
        const empty = new Map<string, string>();
        this.cache.set(conversationId, empty);
        return empty;
      }
      throw error;
    }
  }

  /**
   * Set the active branch for a message
   */
  async setActiveBranch(conversationId: string, messageId: string, branchId: string): Promise<void> {
    const state = await this.load(conversationId);
    state.set(messageId, branchId);
    await this.save(conversationId, state);
  }

  /**
   * Get the active branch for a message (if explicitly set)
   */
  async getActiveBranch(conversationId: string, messageId: string): Promise<string | undefined> {
    const state = await this.load(conversationId);
    return state.get(messageId);
  }

  /**
   * Save branch state for a conversation
   */
  private async save(conversationId: string, state: Map<string, string>): Promise<void> {
    const filePath = this.getFilePath(conversationId);
    const dir = path.dirname(filePath);
    
    // Ensure shard directory exists
    await fs.mkdir(dir, { recursive: true });
    
    // Convert Map to object for JSON
    const data = Object.fromEntries(state);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    
    // Update cache
    this.cache.set(conversationId, state);
  }

  /**
   * Delete branch state for a conversation (e.g., when conversation is deleted)
   */
  async delete(conversationId: string): Promise<void> {
    this.cache.delete(conversationId);
    try {
      const filePath = this.getFilePath(conversationId);
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Clear cache for a conversation (useful when conversation is unloaded)
   */
  clearCache(conversationId: string): void {
    this.cache.delete(conversationId);
  }
}

// Singleton instance
let branchStateStoreInstance: BranchStateStore | null = null;

export function getBranchStateStore(): BranchStateStore {
  if (!branchStateStoreInstance) {
    branchStateStoreInstance = new BranchStateStore();
  }
  return branchStateStoreInstance;
}

export async function initBranchStateStore(): Promise<BranchStateStore> {
  const store = getBranchStateStore();
  await store.init();
  return store;
}

