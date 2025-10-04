import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Database } from '../database/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Schema for creating a share
const CreateShareSchema = z.object({
  conversationId: z.string().uuid(),
  shareType: z.enum(['branch', 'tree']),
  branchId: z.string().uuid().optional(),
  settings: z.object({
    allowDownload: z.boolean().optional(),
    showModelInfo: z.boolean().optional(),
    showTimestamps: z.boolean().optional(),
    title: z.string().optional(),
    description: z.string().optional()
  }).optional(),
  expiresIn: z.number().optional() // Hours until expiration
});

export function createShareRouter(db: Database): Router {
  
  // Create a new share (requires auth)
  router.post('/create', authenticateToken, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const params = CreateShareSchema.parse(req.body);
      
      // Calculate expiration date if specified
      let expiresAt: Date | undefined;
      if (params.expiresIn) {
        expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + params.expiresIn);
      }
      
      const share = await db.createShare(
        params.conversationId,
        userId,
        params.shareType,
        params.branchId,
        params.settings,
        expiresAt
      );
      
      // Build the full share URL
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const shareUrl = `${baseUrl}/share/${share.shareToken}`;
      
      res.json({
        ...share,
        shareUrl
      });
    } catch (error: any) {
      console.error('Error creating share:', error);
      if (error.message === 'Conversation not found or unauthorized') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to create share' });
      }
    }
  });
  
  // Get user's shares (requires auth)
  router.get('/my-shares', authenticateToken, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const shares = await db.getSharesByUser(userId);
      
      // Add full URLs to each share
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const sharesWithUrls = shares.map(share => ({
        ...share,
        shareUrl: `${baseUrl}/share/${share.shareToken}`
      }));
      
      res.json(sharesWithUrls);
    } catch (error) {
      console.error('Error fetching shares:', error);
      res.status(500).json({ error: 'Failed to fetch shares' });
    }
  });
  
  // Delete a share (requires auth)
  router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { id } = req.params;
      
      const deleted = await db.deleteShare(id, userId);
      if (!deleted) {
        return res.status(404).json({ error: 'Share not found or unauthorized' });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting share:', error);
      res.status(500).json({ error: 'Failed to delete share' });
    }
  });
  
  // Get shared conversation data (no auth required - public endpoint)
  router.get('/:token', async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      
      // Get the share info
      const share = await db.getShareByToken(token);
      if (!share) {
        return res.status(404).json({ error: 'Share not found or expired' });
      }
      
      // Get the conversation
      const conversation = await db.getConversation(share.conversationId, share.userId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      
      // Get messages
      const messages = await db.getConversationMessages(share.conversationId, conversation.userId);
      
      // Get participants if it's a multi-participant conversation
      let participants: any[] = [];
      if (conversation.format === 'prefill') {
        participants = await db.getConversationParticipants(share.conversationId, conversation.userId);
      }
      
      // Filter messages if sharing only a branch
      let filteredMessages = messages;
      if (share.shareType === 'branch' && share.branchId) {
        // Build the path from the branch to root
        const branchPath = new Set<string>();
        let currentBranchId: string | undefined = share.branchId;
        
        // Build a map for quick lookup
        const messagesByBranchId = new Map<string, any>();
        for (const msg of messages) {
          for (const branch of msg.branches) {
            messagesByBranchId.set(branch.id, msg);
          }
        }
        
        // Follow the path backwards
        while (currentBranchId && currentBranchId !== 'root') {
          branchPath.add(currentBranchId);
          
          const message = messagesByBranchId.get(currentBranchId);
          if (!message) break;
          
          const branch = message.branches.find((b: any) => b.id === currentBranchId);
          if (!branch) break;
          
          currentBranchId = branch.parentBranchId;
        }
        
        // Filter messages to only include those in the branch path
        filteredMessages = messages.filter(msg => {
          return msg.branches.some((branch: any) => branchPath.has(branch.id));
        });
        
        // For each message, only keep the branches that are in the path
        filteredMessages = filteredMessages.map(msg => ({
          ...msg,
          branches: msg.branches.filter((branch: any) => branchPath.has(branch.id))
        }));
      }
      
      // Sanitize the response - remove sensitive data
      const sanitizedConversation = {
        id: conversation.id,
        title: share.settings.title || conversation.title,
        description: share.settings.description,
        format: conversation.format,
        model: share.settings.showModelInfo ? conversation.model : undefined,
        createdAt: conversation.createdAt,
        settings: share.settings.showModelInfo ? conversation.settings : undefined
      };
      
      // Sanitize participants - remove IDs and other sensitive data
      const sanitizedParticipants = participants.map(p => ({
        name: p.name,
        type: p.type,
        model: share.settings.showModelInfo ? p.model : undefined,
        isActive: p.isActive
      }));
      
      // Sanitize messages - optionally remove timestamps
      const sanitizedMessages = filteredMessages.map(msg => ({
        ...msg,
        conversationId: undefined,
        branches: msg.branches.map((branch: any) => ({
          ...branch,
          createdAt: share.settings.showTimestamps ? branch.createdAt : undefined,
          model: share.settings.showModelInfo ? branch.model : undefined
        }))
      }));
      
      res.json({
        share: {
          ...share,
          userId: undefined // Don't expose user ID
        },
        conversation: sanitizedConversation,
        messages: sanitizedMessages,
        participants: sanitizedParticipants
      });
    } catch (error) {
      console.error('Error fetching shared conversation:', error);
      res.status(500).json({ error: 'Failed to fetch shared conversation' });
    }
  });
  
  return router;
}
