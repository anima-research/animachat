import { z } from 'zod';
import crypto from 'crypto';

// Schema for shared conversations
export const SharedConversationSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  userId: z.string().uuid(),
  shareToken: z.string(),
  shareType: z.enum(['branch', 'tree']),
  branchId: z.string().uuid().optional(),
  createdAt: z.date(),
  expiresAt: z.date().optional(),
  viewCount: z.number().default(0),
  settings: z.object({
    allowDownload: z.boolean().default(true),
    showModelInfo: z.boolean().default(true),
    showTimestamps: z.boolean().default(true),
    title: z.string().optional(),
    description: z.string().optional()
  }).default({
    allowDownload: true,
    showModelInfo: true,
    showTimestamps: true
  })
});

export type SharedConversation = z.infer<typeof SharedConversationSchema>;

export interface SharesDatabase {
  shares: Map<string, SharedConversation>;
  sharesByToken: Map<string, string>; // token -> id mapping
}

export class SharesStore {
  private shares: Map<string, SharedConversation> = new Map();
  private sharesByToken: Map<string, string> = new Map();
  
  /**
   * Replay an event to rebuild state (called from Database during init)
   */
  replayEvent(event: any): void {
    switch (event.type) {
      case 'share_created':
        const share = {
          ...event.data,
          createdAt: new Date(event.data.createdAt),
          expiresAt: event.data.expiresAt ? new Date(event.data.expiresAt) : undefined
        } as SharedConversation;
        this.shares.set(share.id, share);
        this.sharesByToken.set(share.shareToken, share.id);
        break;
      case 'share_deleted':
        const { id, shareToken } = event.data;
        this.shares.delete(id);
        if (shareToken) {
          this.sharesByToken.delete(shareToken);
        }
        break;
      case 'share_viewed':
        const { id: viewedId, viewCount } = event.data;
        const viewedShare = this.shares.get(viewedId);
        if (viewedShare) {
          viewedShare.viewCount = viewCount;
        }
        break;
    }
  }

  /**
   * Generate a unique share token
   */
  private generateToken(): string {
    let token: string;
    do {
      // Generate 10 character alphanumeric token
      token = crypto.randomBytes(5).toString('hex');
    } while (this.sharesByToken.has(token));
    return token;
  }

  /**
   * Create a new share
   */
  async createShare(
    conversationId: string,
    userId: string,
    shareType: 'branch' | 'tree',
    branchId?: string,
    settings?: Partial<SharedConversation['settings']>,
    expiresAt?: Date
  ): Promise<SharedConversation> {
    const id = crypto.randomUUID();
    const shareToken = this.generateToken();
    
    const share: SharedConversation = {
      id,
      conversationId,
      userId,
      shareToken,
      shareType,
      branchId,
      createdAt: new Date(),
      expiresAt,
      viewCount: 0,
      settings: {
        allowDownload: true,
        showModelInfo: true,
        showTimestamps: true,
        ...settings
      }
    };

    this.shares.set(id, share);
    this.sharesByToken.set(shareToken, id);

    return share;
  }

  /**
   * Get a share by token
   */
  async getShareByToken(token: string): Promise<SharedConversation | null> {
    const id = this.sharesByToken.get(token);
    if (!id) return null;
    
    const share = this.shares.get(id);
    if (!share) return null;
    
    // Check if expired
    if (share.expiresAt && share.expiresAt < new Date()) {
      return null;
    }
    
    // Increment view count
    share.viewCount++;
    
    return share;
  }

  /**
   * Get shares by user
   */
  async getSharesByUser(userId: string): Promise<SharedConversation[]> {
    const userShares: SharedConversation[] = [];
    
    for (const share of this.shares.values()) {
      if (share.userId === userId) {
        // Don't return expired shares
        if (!share.expiresAt || share.expiresAt > new Date()) {
          userShares.push(share);
        }
      }
    }
    
    return userShares;
  }

  /**
   * Delete a share
   */
  async deleteShare(id: string, userId: string): Promise<boolean> {
    const share = this.shares.get(id);
    if (!share || share.userId !== userId) {
      return false;
    }
    
    this.shares.delete(id);
    this.sharesByToken.delete(share.shareToken);
    
    return true;
  }

  /**
   * Delete shares for a conversation
   */
  async deleteSharesForConversation(conversationId: string, userId: string): Promise<number> {
    let deleted = 0;
    
    for (const [id, share] of this.shares.entries()) {
      if (share.conversationId === conversationId && share.userId === userId) {
        this.shares.delete(id);
        this.sharesByToken.delete(share.shareToken);
        deleted++;
      }
    }
    
    return deleted;
  }
}
