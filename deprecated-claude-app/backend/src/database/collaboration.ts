import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { 
  SharePermission, 
  ConversationShare
} from '@deprecated-claude/shared';

/**
 * Invite link for collaboration - can be shared with anyone
 */
export interface CollaborationInvite {
  id: string;
  conversationId: string;
  createdByUserId: string;
  inviteToken: string;
  permission: SharePermission;
  label?: string; // Optional label for the invite (e.g., "Team invite")
  expiresAt?: string; // ISO date string
  maxUses?: number; // Optional max uses (undefined = unlimited)
  useCount: number;
  createdAt: string;
}

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
  
  // Invite links
  // inviteId -> CollaborationInvite
  private invites: Map<string, CollaborationInvite> = new Map();
  
  // inviteToken -> inviteId
  private invitesByToken: Map<string, string> = new Map();
  
  // conversationId -> Set of inviteIds
  private invitesByConversation: Map<string, Set<string>> = new Map();

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
      case 'collaboration_invite_created':
        this.applyInviteCreated(event.data);
        break;
      case 'collaboration_invite_used':
        this.applyInviteUsed(event.data);
        break;
      case 'collaboration_invite_deleted':
        this.applyInviteDeleted(event.data);
        break;
    }
  }
  
  private applyInviteCreated(data: any): void {
    const invite: CollaborationInvite = {
      id: data.id,
      conversationId: data.conversationId,
      createdByUserId: data.createdByUserId,
      inviteToken: data.inviteToken,
      permission: data.permission,
      label: data.label,
      expiresAt: data.expiresAt,
      maxUses: data.maxUses,
      useCount: data.useCount || 0,
      createdAt: data.createdAt
    };
    
    this.invites.set(invite.id, invite);
    this.invitesByToken.set(invite.inviteToken, invite.id);
    
    if (!this.invitesByConversation.has(invite.conversationId)) {
      this.invitesByConversation.set(invite.conversationId, new Set());
    }
    this.invitesByConversation.get(invite.conversationId)!.add(invite.id);
  }
  
  private applyInviteUsed(data: any): void {
    const invite = this.invites.get(data.inviteId);
    if (invite) {
      invite.useCount = data.useCount;
    }
  }
  
  private applyInviteDeleted(data: any): void {
    const invite = this.invites.get(data.inviteId);
    if (invite) {
      this.invitesByToken.delete(invite.inviteToken);
      this.invitesByConversation.get(invite.conversationId)?.delete(invite.id);
      this.invites.delete(data.inviteId);
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

  // ==========================================
  // Invite Link Methods
  // ==========================================

  /**
   * Generate a unique invite token
   */
  private generateInviteToken(): string {
    let token: string;
    do {
      // Generate 12 character alphanumeric token (more secure than share tokens)
      token = crypto.randomBytes(6).toString('hex');
    } while (this.invitesByToken.has(token));
    return token;
  }

  /**
   * Create an invite link
   */
  createInvite(
    conversationId: string,
    createdByUserId: string,
    permission: SharePermission,
    options?: {
      label?: string;
      expiresInHours?: number;
      maxUses?: number;
    }
  ): { invite: CollaborationInvite; eventData: any } {
    const id = uuidv4();
    const inviteToken = this.generateInviteToken();
    const now = new Date().toISOString();
    
    let expiresAt: string | undefined;
    if (options?.expiresInHours) {
      const expDate = new Date();
      expDate.setHours(expDate.getHours() + options.expiresInHours);
      expiresAt = expDate.toISOString();
    }
    
    const invite: CollaborationInvite = {
      id,
      conversationId,
      createdByUserId,
      inviteToken,
      permission,
      label: options?.label,
      expiresAt,
      maxUses: options?.maxUses,
      useCount: 0,
      createdAt: now
    };
    
    this.applyInviteCreated(invite);
    
    return {
      invite,
      eventData: {
        type: 'collaboration_invite_created',
        data: invite
      }
    };
  }

  /**
   * Get an invite by token (for claiming)
   */
  getInviteByToken(token: string): CollaborationInvite | null {
    const id = this.invitesByToken.get(token);
    if (!id) return null;
    
    const invite = this.invites.get(id);
    if (!invite) return null;
    
    // Check if expired
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return null;
    }
    
    // Check if max uses reached
    if (invite.maxUses !== undefined && invite.useCount >= invite.maxUses) {
      return null;
    }
    
    return invite;
  }

  /**
   * Get an invite by ID
   */
  getInviteById(inviteId: string): CollaborationInvite | undefined {
    return this.invites.get(inviteId);
  }

  /**
   * Get all invites for a conversation
   */
  getInvitesForConversation(conversationId: string): CollaborationInvite[] {
    const inviteIds = this.invitesByConversation.get(conversationId);
    if (!inviteIds) return [];
    
    const now = new Date();
    return Array.from(inviteIds)
      .map(id => this.invites.get(id))
      .filter((invite): invite is CollaborationInvite => {
        if (!invite) return false;
        // Filter out expired invites
        if (invite.expiresAt && new Date(invite.expiresAt) < now) return false;
        // Filter out maxed-out invites
        if (invite.maxUses !== undefined && invite.useCount >= invite.maxUses) return false;
        return true;
      });
  }

  /**
   * Use an invite (increment use count)
   * Returns event data for logging
   */
  useInvite(inviteId: string): { success: boolean; eventData: any | null } {
    const invite = this.invites.get(inviteId);
    if (!invite) {
      return { success: false, eventData: null };
    }
    
    const newUseCount = invite.useCount + 1;
    
    const eventData = {
      type: 'collaboration_invite_used',
      data: {
        inviteId,
        conversationId: invite.conversationId,
        useCount: newUseCount,
        time: new Date().toISOString()
      }
    };
    
    this.applyInviteUsed(eventData.data);
    
    return { success: true, eventData };
  }

  /**
   * Delete an invite
   */
  deleteInvite(inviteId: string, deletedByUserId: string): { success: boolean; eventData: any | null } {
    const invite = this.invites.get(inviteId);
    if (!invite) {
      return { success: false, eventData: null };
    }
    
    // Only creator can delete
    if (invite.createdByUserId !== deletedByUserId) {
      return { success: false, eventData: null };
    }
    
    const eventData = {
      type: 'collaboration_invite_deleted',
      data: {
        inviteId,
        conversationId: invite.conversationId,
        deletedByUserId,
        time: new Date().toISOString()
      }
    };
    
    this.applyInviteDeleted(eventData.data);
    
    return { success: true, eventData };
  }
}

