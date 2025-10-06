import { Router } from 'express';
import { Database } from '../database/index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';

export function createBookmarksRouter(db: Database): Router {
  const router = Router();

  // Create or update a bookmark
  router.post('/', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        conversationId: z.string().uuid(),
        messageId: z.string().uuid(),
        branchId: z.string().uuid(),
        label: z.string().min(1).max(200)
      });

      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { conversationId, messageId, branchId, label } = schema.parse(req.body);

      // Verify the user owns the conversation
      const conversation = await db.getConversation(conversationId, req.userId);
      if (!conversation || conversation.userId !== req.userId) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const bookmark = await db.createOrUpdateBookmark(
        conversationId,
        messageId,
        branchId,
        label
      );

      res.json(bookmark);
    } catch (error) {
      console.error('Error creating/updating bookmark:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to create bookmark' });
    }
  });

  // Delete a bookmark
  router.delete('/:messageId/:branchId', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { messageId, branchId } = req.params;

      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Get the bookmark to verify ownership
      const bookmark = await db.getBookmarkForBranch(messageId, branchId);
      if (!bookmark) {
        return res.status(404).json({ error: 'Bookmark not found' });
      }

      // Verify the user owns the conversation
      const conversation = await db.getConversation(bookmark.conversationId, req.userId);
      if (!conversation || conversation.userId !== req.userId) {
        return res.status(404).json({ error: 'Bookmark not found' });
      }

      const deleted = await db.deleteBookmark(messageId, branchId);

      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Bookmark not found' });
      }
    } catch (error) {
      console.error('Error deleting bookmark:', error);
      res.status(500).json({ error: 'Failed to delete bookmark' });
    }
  });

  // Get all bookmarks for a conversation
  router.get('/conversation/:conversationId', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { conversationId } = req.params;

      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Verify the user owns the conversation
      const conversation = await db.getConversation(conversationId, req.userId);
      if (!conversation || conversation.userId !== req.userId) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const bookmarks = await db.getConversationBookmarks(conversationId);
      res.json(bookmarks);
    } catch (error) {
      console.error('Error fetching bookmarks:', error);
      res.status(500).json({ error: 'Failed to fetch bookmarks' });
    }
  });

  return router;
}