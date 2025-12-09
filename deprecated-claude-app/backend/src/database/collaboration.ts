import { v4 as uuidv4 } from 'uuid';
import { 
  SharePermission, 
  ConversationShare,
  ShareCreatedEvent,
  ShareUpdatedEvent,
  ShareRevokedEvent 
} from '@deprecated-claude/shared';

/**
 * Manages user-to-user conversation collaboration (sharing with permissions).
 * Separate from SharesStore which handles public share links.
 */
export class CollaborationStore {
  // shareId -> ConversationShare
  private shares: Map<string, ConversationShare> = new Map();
  
  // conversationId -> Set of shareIds
  private sharesByConversation: Map<string, Set<string>> = new Map();
  
  // sharedWithUserId -> Set of shareIds
  private sharesByUser: Map<string, Set<string>> = new Map();

  /**
   * Replay an event to rebuild state (called from Database during init)
   */
  replayEvent(event: any): void {
    switch (event.type) {
      case 'collaboration_share_created':
        this.applyShareCreated(event.data);
        break;
      case 'collaboration_share_updated':
        this.applyShareUpdated(event.data);
        break;
      case 'collaboration_share_revoked':
        this.applyShareRevoked(event.data);
        break;
    }
  }

  private applyShareCreated(data: any): void {
    const share: ConversationShare = {
      id: data.id,
      conversationId: data.conversationId,
      sharedWithUserId: data.sharedWithUserId,
      sharedWithEmail: data.sharedWithEmail,
      sharedByUserId: data.sharedByUserId,
      permission: data.permission,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    };
    
    this.shares.set(share.id, share);
    
    // Index by conversation
    if (!this.sharesByConversation.has(share.conversationId)) {
      this.sharesByConversation.set(share.conversationId, new Set());
    }
    this.sharesByConversation.get(share.conversationId)!.add(share.id);
    
    // Index by user
    if (!this.sharesByUser.has(share.sharedWithUserId)) {
      this.sharesByUser.set(share.sharedWithUserId, new Set());
    }
    this.sharesByUser.get(share.sharedWithUserId)!.add(share.id);
  }

  private applyShareUpdated(data: any): void {
    const share = this.shares.get(data.shareId);
    if (share) {
      share.permission = data.permission;
      share.updatedAt = data.time;
    }
  }

  private applyShareRevoked(data: any): void {
    const share = this.shares.get(data.shareId);
    if (share) {
      // Remove from indexes
      this.sharesByConversation.get(share.conversationId)?.delete(share.id);
      this.sharesByUser.get(share.sharedWithUserId)?.delete(share.id);
      
      // Remove the share
      this.shares.delete(data.shareId);
    }
  }

  /**
   * Create a collaboration share (returns event data for logging)
   */
  createShare(
    conversationId: string,
    sharedWithUserId: string,
    sharedWithEmail: string,
    sharedByUserId: string,
    permission: SharePermission
  ): { share: ConversationShare; eventData: any } {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    const share: ConversationShare = {
      id,
      conversationId,
      sharedWithUserId,
      sharedWithEmail,
      sharedByUserId,
      permission,
      createdAt: now
    };
    
    // Apply immediately
    this.applyShareCreated(share);
    
    return {
      share,
      eventData: {
        type: 'collaboration_share_created',
        data: share
      }
    };
  }

  /**
   * Update share permission (returns event data for logging)
   */
  updateSharePermission(
    shareId: string,
    permission: SharePermission,
    updatedByUserId: string
  ): { share: ConversationShare | null; eventData: any | null } {
    const share = this.shares.get(shareId);
    if (!share) {
      return { share: null, eventData: null };
    }
    
    const eventData = {
      type: 'collaboration_share_updated',
      data: {
        shareId,
        conversationId: share.conversationId,
        permission,
        updatedByUserId,
        time: new Date().toISOString()
      }
    };
    
    // Apply immediately
    this.applyShareUpdated(eventData.data);
    
    return { share, eventData };
  }

  /**
   * Revoke a share (returns event data for logging)
   */
  revokeShare(
    shareId: string,
    revokedByUserId: string
  ): { success: boolean; eventData: any | null } {
    const share = this.shares.get(shareId);
    if (!share) {
      return { success: false, eventData: null };
    }
    
    const eventData = {
      type: 'collaboration_share_revoked',
      data: {
        shareId,
        conversationId: share.conversationId,
        revokedByUserId,
        time: new Date().toISOString()
      }
    };
    
    // Apply immediately
    this.applyShareRevoked(eventData.data);
    
    return { success: true, eventData };
  }

  /**
   * Get all shares for a conversation
   */
  getSharesForConversation(conversationId: string): ConversationShare[] {
    const shareIds = this.sharesByConversation.get(conversationId);
    if (!shareIds) return [];
    
    return Array.from(shareIds)
      .map(id => this.shares.get(id))
      .filter((s): s is ConversationShare => s !== undefined);
  }

  /**
   * Get all conversations shared with a user
   */
  getSharesForUser(userId: string): ConversationShare[] {
    const shareIds = this.sharesByUser.get(userId);
    if (!shareIds) return [];
    
    return Array.from(shareIds)
      .map(id => this.shares.get(id))
      .filter((s): s is ConversationShare => s !== undefined);
  }

  /**
   * Get a specific share by ID
   */
  getShare(shareId: string): ConversationShare | undefined {
    return this.shares.get(shareId);
  }

  /**
   * Check if a user has access to a conversation and get their permission level
   */
  getUserPermission(conversationId: string, userId: string): SharePermission | null {
    const shareIds = this.sharesByConversation.get(conversationId);
    if (!shareIds) return null;
    
    for (const shareId of shareIds) {
      const share = this.shares.get(shareId);
      if (share && share.sharedWithUserId === userId) {
        return share.permission;
      }
    }
    
    return null;
  }

  /**
   * Check if user already has a share for this conversation
   */
  hasExistingShare(conversationId: string, userId: string): boolean {
    return this.getUserPermission(conversationId, userId) !== null;
  }
}

