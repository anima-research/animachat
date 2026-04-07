/**
 * Search Index Service
 * 
 * Maintains lightweight search indexes for conversations to enable fast full-text search
 * without loading full conversation data.
 * 
 * Index Structure:
 * - One .idx.json file per conversation, stored alongside the .jsonl event log
 * - Each entry contains: messageId, branchId, role, lowercased text, timestamp
 * - Indexes are built when conversations are loaded and updated incrementally
 * - Dirty indexes are flushed to disk after a debounce period
 */

import fs from 'fs/promises';
import path from 'path';
import { Message, MessageBranch } from '@deprecated-claude/shared';

// Index entry - minimal data needed for search
export interface SearchIndexEntry {
  m: string;      // messageId
  b: string;      // branchId
  r: 'user' | 'assistant' | 'system';  // role
  t: string;      // lowercased searchable text
  ts: number;     // timestamp (ms since epoch)
}

// Full index structure
export interface SearchIndex {
  v: number;      // version
  entries: SearchIndexEntry[];
}

// Search result before hydration with conversation data
export interface SearchMatch {
  conversationId: string;
  messageId: string;
  branchId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  matchIndex: number;  // Position of match in text
}

const INDEX_VERSION = 1;
const FLUSH_DEBOUNCE_MS = 5000;  // 5 seconds

export class SearchIndexService {
  private loadedIndexes: Map<string, SearchIndex> = new Map();
  private dirtyIndexes: Set<string> = new Set();
  private flushTimers: Map<string, NodeJS.Timeout> = new Map();
  private baseDir: string;
  
  constructor(baseDir: string = './data/conversations') {
    this.baseDir = baseDir;
  }

  /**
   * Get the file path for a conversation's search index
   */
  private getIndexPath(conversationId: string): string {
    const prefix1 = conversationId.substring(0, 2);
    const prefix2 = conversationId.substring(2, 4);
    return path.join(this.baseDir, prefix1, prefix2, `${conversationId}.idx.json`);
  }

  /**
   * Build index entries from messages
   */
  private buildEntriesFromMessages(messages: Message[]): SearchIndexEntry[] {
    const entries: SearchIndexEntry[] = [];
    
    for (const message of messages) {
      for (const branch of message.branches) {
        // Skip system messages if desired, but include them for now for completeness
        entries.push({
          m: message.id,
          b: branch.id,
          r: branch.role,
          t: branch.content.toLowerCase(),
          ts: new Date(branch.createdAt).getTime()
        });
      }
    }
    
    return entries;
  }

  /**
   * Build and cache index from messages (called when conversation is loaded)
   */
  buildIndexFromMessages(conversationId: string, messages: Message[]): void {
    const index: SearchIndex = {
      v: INDEX_VERSION,
      entries: this.buildEntriesFromMessages(messages)
    };
    
    this.loadedIndexes.set(conversationId, index);
    this.markDirty(conversationId);
  }

  /**
   * Add a new branch to the index
   */
  addBranchToIndex(conversationId: string, messageId: string, branch: MessageBranch): void {
    let index = this.loadedIndexes.get(conversationId);
    
    if (!index) {
      // If index isn't loaded, we can't update it - it will be rebuilt on next load
      return;
    }
    
    index.entries.push({
      m: messageId,
      b: branch.id,
      r: branch.role,
      t: branch.content.toLowerCase(),
      ts: new Date(branch.createdAt).getTime()
    });
    
    this.markDirty(conversationId);
  }

  /**
   * Update a branch's content in the index
   */
  updateBranchInIndex(conversationId: string, messageId: string, branchId: string, newContent: string): void {
    const index = this.loadedIndexes.get(conversationId);
    if (!index) return;
    
    const entry = index.entries.find(e => e.m === messageId && e.b === branchId);
    if (entry) {
      entry.t = newContent.toLowerCase();
      this.markDirty(conversationId);
    }
  }

  /**
   * Remove a branch from the index
   */
  removeBranchFromIndex(conversationId: string, messageId: string, branchId: string): void {
    const index = this.loadedIndexes.get(conversationId);
    if (!index) return;
    
    index.entries = index.entries.filter(e => !(e.m === messageId && e.b === branchId));
    this.markDirty(conversationId);
  }

  /**
   * Remove all branches for a message from the index
   */
  removeMessageFromIndex(conversationId: string, messageId: string): void {
    const index = this.loadedIndexes.get(conversationId);
    if (!index) return;
    
    index.entries = index.entries.filter(e => e.m !== messageId);
    this.markDirty(conversationId);
  }

  /**
   * Mark an index as dirty and schedule flush
   */
  private markDirty(conversationId: string): void {
    this.dirtyIndexes.add(conversationId);
    
    // Cancel existing timer
    const existingTimer = this.flushTimers.get(conversationId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Schedule new flush
    const timer = setTimeout(() => {
      this.flushIndex(conversationId);
    }, FLUSH_DEBOUNCE_MS);
    
    this.flushTimers.set(conversationId, timer);
  }

  /**
   * Flush a single index to disk
   */
  async flushIndex(conversationId: string): Promise<void> {
    if (!this.dirtyIndexes.has(conversationId)) return;
    
    const index = this.loadedIndexes.get(conversationId);
    if (!index) return;
    
    const indexPath = this.getIndexPath(conversationId);
    
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(indexPath), { recursive: true });
      
      // Write index
      await fs.writeFile(indexPath, JSON.stringify(index), 'utf-8');
      
      this.dirtyIndexes.delete(conversationId);
      this.flushTimers.delete(conversationId);
    } catch (error) {
      console.error(`Failed to flush search index for ${conversationId}:`, error);
    }
  }

  /**
   * Flush all dirty indexes (called on shutdown)
   */
  async flushAllDirty(): Promise<void> {
    // Cancel all timers
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer);
    }
    this.flushTimers.clear();
    
    // Flush all dirty indexes
    const flushPromises = Array.from(this.dirtyIndexes).map(id => this.flushIndex(id));
    await Promise.all(flushPromises);
  }

  /**
   * Read index from disk (for conversations not loaded in memory)
   */
  async readIndexFromDisk(conversationId: string): Promise<SearchIndex | null> {
    // Check if already loaded
    const loaded = this.loadedIndexes.get(conversationId);
    if (loaded) return loaded;
    
    const indexPath = this.getIndexPath(conversationId);
    
    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(data) as SearchIndex;
      
      // Version check - if outdated, return null to trigger rebuild
      if (index.v !== INDEX_VERSION) {
        return null;
      }
      
      return index;
    } catch (error) {
      // File doesn't exist or is corrupted - will need to rebuild
      return null;
    }
  }

  /**
   * Search a single index
   */
  searchIndex(index: SearchIndex, query: string): SearchIndexEntry[] {
    const q = query.toLowerCase();
    const matches: SearchIndexEntry[] = [];
    
    for (const entry of index.entries) {
      if (entry.t.includes(q)) {
        matches.push(entry);
      }
    }
    
    return matches;
  }

  /**
   * Search across all conversations for a user
   * Returns matches sorted by timestamp (most recent first)
   * 
   * @param conversationIds - IDs of conversations to search
   * @param query - Search query
   * @param limit - Maximum results to return
   * @param getConversationTitle - Function to get conversation title by ID
   * @returns Array of search matches
   */
  async searchAllConversations(
    conversationIds: string[],
    query: string,
    limit: number,
    getConversationTitle: (id: string) => string
  ): Promise<SearchMatch[]> {
    const results: SearchMatch[] = [];
    const q = query.toLowerCase();
    
    for (const convId of conversationIds) {
      if (results.length >= limit) break;
      
      // Try in-memory index first, then disk
      let index: SearchIndex | null | undefined = this.loadedIndexes.get(convId);
      
      if (!index) {
        index = await this.readIndexFromDisk(convId);
      }
      
      if (!index) {
        // No index available - this conversation needs to be indexed
        // For now, skip it; it will be indexed when loaded
        continue;
      }
      
      for (const entry of index.entries) {
        if (results.length >= limit) break;
        
        const matchIndex = entry.t.indexOf(q);
        if (matchIndex !== -1) {
          results.push({
            conversationId: convId,
            messageId: entry.m,
            branchId: entry.b,
            role: entry.r,
            text: entry.t,  // This is lowercased; we'll need original for snippets
            timestamp: entry.ts,
            matchIndex
          });
        }
      }
    }
    
    // Sort by timestamp descending (most recent first)
    results.sort((a, b) => b.timestamp - a.timestamp);
    
    return results.slice(0, limit);
  }

  /**
   * Unload an index from memory (when conversation is unloaded)
   */
  async unloadIndex(conversationId: string): Promise<void> {
    // Flush if dirty before unloading
    if (this.dirtyIndexes.has(conversationId)) {
      await this.flushIndex(conversationId);
    }
    
    this.loadedIndexes.delete(conversationId);
    
    // Cancel any pending flush timer
    const timer = this.flushTimers.get(conversationId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(conversationId);
    }
  }

  /**
   * Check if an index exists on disk
   */
  async indexExists(conversationId: string): Promise<boolean> {
    if (this.loadedIndexes.has(conversationId)) return true;
    
    try {
      await fs.access(this.getIndexPath(conversationId));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete an index (when conversation is deleted)
   */
  async deleteIndex(conversationId: string): Promise<void> {
    // Remove from memory
    this.loadedIndexes.delete(conversationId);
    this.dirtyIndexes.delete(conversationId);
    
    const timer = this.flushTimers.get(conversationId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(conversationId);
    }
    
    // Delete from disk
    try {
      await fs.unlink(this.getIndexPath(conversationId));
    } catch {
      // File might not exist, that's fine
    }
  }
}
