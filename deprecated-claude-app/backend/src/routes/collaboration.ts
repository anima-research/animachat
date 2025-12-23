import { Router } from 'express';
import { Database } from '../database/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { SharePermission } from '@deprecated-claude/shared';

export function collaborationRouter(db: Database): Router {
  const router = Router();

  // ==========================================
  // Public routes (no authentication required)
  // ==========================================

  /**
   * Get invite details by token (public - for redemption page)
   * GET /api/collaboration/invites/token/:token
   */
  router.get('/invites/token/:token', async (req, res) => {
    try {
      const { token } = req.params;
      
      const invite = await db.getCollaborationInviteByToken(token);
      if (!invite) {
        return res.status(404).json({ error: 'Invite not found or expired' });
      }

      // Get conversation details (limited info for public view)
      const conversation = await db.getConversationPublicInfo(invite.conversationId);

      res.json({
        permission: invite.permission,
        label: invite.label,
        conversationTitle: conversation?.title || 'Untitled Conversation',
        createdByName: await db.getUserDisplayName(invite.createdByUserId)
      });
    } catch (error) {
      console.error('Error getting invite:', error);
      res.status(500).json({ error: 'Failed to get invite' });
    }
  });

  // ==========================================
  // Authenticated routes
  // ==========================================
  router.use(authenticateToken);

  /**
   * Share a conversation with another user
   * POST /api/collaboration/share
   * Body: { conversationId, email, permission }
   */
  router.post('/share', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { conversationId, email, permission } = req.body;

      if (!conversationId || !email || !permission) {
        return res.status(400).json({ error: 'Missing required fields: conversationId, email, permission' });
      }

      // Validate permission
      if (!['viewer', 'collaborator', 'editor'].includes(permission)) {
        return res.status(400).json({ error: 'Invalid permission. Must be viewer, collaborator, or editor' });
      }

      // Can't share with yourself
      const currentUser = await db.getUserById(userId);
      if (currentUser && currentUser.email === email) {
        return res.status(400).json({ error: 'Cannot share with yourself' });
      }

      const share = await db.createCollaborationShare(
        conversationId,
        email,
        userId,
        permission as SharePermission
      );

      if (!share) {
        return res.status(400).json({ 
          error: 'Failed to create share. User may not exist or already has access.' 
        });
      }

      res.json({ share });
    } catch (error) {
      console.error('Error creating collaboration share:', error);
      res.status(500).json({ error: 'Failed to create share' });
    }
  });

  /**
   * Update share permission
   * PATCH /api/collaboration/shares/:shareId
   * Body: { permission }
   */
  router.patch('/shares/:shareId', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { shareId } = req.params;
      const { permission } = req.body;

      if (!permission) {
        return res.status(400).json({ error: 'Missing required field: permission' });
      }

      if (!['viewer', 'collaborator', 'editor'].includes(permission)) {
        return res.status(400).json({ error: 'Invalid permission' });
      }

      const share = await db.updateCollaborationShare(
        shareId,
        permission as SharePermission,
        userId
      );

      if (!share) {
        return res.status(404).json({ error: 'Share not found' });
      }

      res.json({ share });
    } catch (error) {
      console.error('Error updating collaboration share:', error);
      res.status(500).json({ error: 'Failed to update share' });
    }
  });

  /**
   * Revoke a share
   * DELETE /api/collaboration/shares/:shareId
   */
  router.delete('/shares/:shareId', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { shareId } = req.params;

      const success = await db.revokeCollaborationShare(shareId, userId);

      if (!success) {
        return res.status(404).json({ error: 'Share not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error revoking collaboration share:', error);
      res.status(500).json({ error: 'Failed to revoke share' });
    }
  });

  /**
   * Get shares for a conversation (who has access)
   * GET /api/collaboration/conversation/:conversationId/shares
   */
  router.get('/conversation/:conversationId/shares', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { conversationId } = req.params;

      // Verify user has access to this conversation
      const access = await db.canUserAccessConversation(conversationId, userId);
      if (!access.canAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const shares = db.getCollaborationSharesForConversation(conversationId);
      res.json({ shares });
    } catch (error) {
      console.error('Error getting conversation shares:', error);
      res.status(500).json({ error: 'Failed to get shares' });
    }
  });

  /**
   * Get conversations shared with current user
   * GET /api/collaboration/shared-with-me
   */
  router.get('/shared-with-me', async (req, res) => {
    try {
      const userId = (req as any).userId;

      const shares = db.getConversationsSharedWithUser(userId);
      
      // Enrich with conversation details
      const enrichedShares = await Promise.all(
        shares.map(async (share) => {
          // Get conversation details (we can access it because we have a share)
          const conversation = await db.getConversation(share.conversationId, userId);
          
          // Get owner info
          const owner = await db.getUserById(share.sharedByUserId);
          
          return {
            ...share,
            conversation: conversation ? {
              id: conversation.id,
              title: conversation.title,
              model: conversation.model,
              format: conversation.format,
              updatedAt: conversation.updatedAt
            } : null,
            sharedBy: owner ? {
              id: owner.id,
              email: owner.email,
              name: owner.name
            } : null
          };
        })
      );

      res.json({ shares: enrichedShares.filter(s => s.conversation !== null) });
    } catch (error) {
      console.error('Error getting shared conversations:', error);
      res.status(500).json({ error: 'Failed to get shared conversations' });
    }
  });

  /**
   * Check current user's permission for a conversation
   * GET /api/collaboration/conversation/:conversationId/my-permission
   */
  router.get('/conversation/:conversationId/my-permission', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { conversationId } = req.params;

      const access = await db.canUserAccessConversation(conversationId, userId);
      
      res.json({
        canAccess: access.canAccess,
        isOwner: access.isOwner,
        permission: access.permission,
        canChat: access.isOwner || (access.permission === 'collaborator' || access.permission === 'editor'),
        canDelete: access.isOwner || access.permission === 'editor'
      });
    } catch (error) {
      console.error('Error checking permission:', error);
      res.status(500).json({ error: 'Failed to check permission' });
    }
  });

  // ==========================================
  // Invite Link Routes
  // ==========================================

  /**
   * Create an invite link for a conversation
   * POST /api/collaboration/invites
   * Body: { conversationId, permission, label?, expiresInHours?, maxUses? }
   */
  router.post('/invites', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { conversationId, permission, label, expiresInHours, maxUses } = req.body;

      if (!conversationId || !permission) {
        return res.status(400).json({ error: 'Missing required fields: conversationId, permission' });
      }

      if (!['viewer', 'collaborator', 'editor'].includes(permission)) {
        return res.status(400).json({ error: 'Invalid permission' });
      }

      // Verify user has access to this conversation (must be owner or editor)
      const access = await db.canUserAccessConversation(conversationId, userId);
      if (!access.isOwner && access.permission !== 'editor') {
        return res.status(403).json({ error: 'Only owners and editors can create invite links' });
      }

      const invite = await db.createCollaborationInvite(
        conversationId,
        userId,
        permission as SharePermission,
        { label, expiresInHours, maxUses }
      );

      // Build the full invite URL
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const inviteUrl = `${baseUrl}/invite/${invite.inviteToken}`;

      res.json({
        ...invite,
        inviteUrl
      });
    } catch (error) {
      console.error('Error creating invite:', error);
      res.status(500).json({ error: 'Failed to create invite' });
    }
  });

  /**
   * Claim an invite (join the conversation)
   * POST /api/collaboration/invites/token/:token/claim
   * Requires authentication
   */
  router.post('/invites/token/:token/claim', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { token } = req.params;

      const result = await db.claimCollaborationInvite(token, userId);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        conversationId: result.conversationId,
        permission: result.permission
      });
    } catch (error) {
      console.error('Error claiming invite:', error);
      res.status(500).json({ error: 'Failed to claim invite' });
    }
  });

  /**
   * Get invites for a conversation
   * GET /api/collaboration/conversation/:conversationId/invites
   */
  router.get('/conversation/:conversationId/invites', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { conversationId } = req.params;

      // Verify user has access
      const access = await db.canUserAccessConversation(conversationId, userId);
      if (!access.isOwner && access.permission !== 'editor') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const invites = await db.getCollaborationInvitesForConversation(conversationId);
      
      // Add full URLs
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const invitesWithUrls = invites.map(invite => ({
        ...invite,
        inviteUrl: `${baseUrl}/invite/${invite.inviteToken}`
      }));

      res.json({ invites: invitesWithUrls });
    } catch (error) {
      console.error('Error getting invites:', error);
      res.status(500).json({ error: 'Failed to get invites' });
    }
  });

  /**
   * Delete an invite
   * DELETE /api/collaboration/invites/:inviteId
   */
  router.delete('/invites/:inviteId', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { inviteId } = req.params;

      const success = await db.deleteCollaborationInvite(inviteId, userId);
      
      if (!success) {
        return res.status(404).json({ error: 'Invite not found or unauthorized' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting invite:', error);
      res.status(500).json({ error: 'Failed to delete invite' });
    }
  });

  return router;
}

