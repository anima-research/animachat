import { Router } from 'express';
import { z } from 'zod';
import { Database } from '../database/index.js';
import { AuthRequest } from '../middleware/auth.js';
import { CreateConversationRequestSchema, ImportConversationRequestSchema, ConversationMetrics, DEFAULT_CONTEXT_MANAGEMENT } from '@deprecated-claude/shared';

export function conversationRouter(db: Database): Router {
  const router = Router();

  // Get all conversations for user
  router.get('/', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Use the new method that includes participant summaries
      const conversations = await db.getUserConversationsWithSummary(req.userId);
      res.json(conversations);
    } catch (error) {
      console.error('Get conversations error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Create conversation
  router.post('/', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = CreateConversationRequestSchema.parse(req.body);
      
      const conversation = await db.createConversation(
        req.userId,
        data.title || 'New Conversation',
        data.model,
        data.systemPrompt,
        data.settings,
        data.format,
        data.contextManagement
      );

      res.json(conversation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Create conversation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get conversation details
  router.get('/:id', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const conversation = await db.getConversation(req.params.id, req.userId);
      
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (conversation.userId !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json(conversation);
    } catch (error) {
      console.error('Get conversation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Update conversation
  router.patch('/:id', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const conversation = await db.getConversation(req.params.id, req.userId);
      
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (conversation.userId !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      console.log('[API] Updating conversation with:', JSON.stringify(req.body, null, 2));
      const updated = await db.updateConversation(req.params.id, conversation.userId, req.body);
      console.log('[API] Updated conversation settings:', JSON.stringify(updated?.settings, null, 2));
      res.json(updated);
    } catch (error) {
      console.error('Update conversation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Archive conversation
  router.post('/:id/archive', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const conversation = await db.getConversation(req.params.id, req.userId);
      
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (conversation.userId !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await db.archiveConversation(req.params.id, conversation.userId);
      res.json({ success: true });
    } catch (error) {
      console.error('Archive conversation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Duplicate conversation
  router.post('/:id/duplicate', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Parse options from request body
      const options = {
        newTitle: req.body.newTitle as string | undefined,
        lastMessages: req.body.lastMessages as number | undefined,
        includeSystemPrompt: req.body.includeSystemPrompt as boolean | undefined,
        includeSettings: req.body.includeSettings as boolean | undefined,
      };

      const duplicate = await db.duplicateConversation(req.params.id, req.userId, req.userId, options);
      
      if (!duplicate) {
        return res.status(404).json({ error: 'Conversation not found or access denied' });
      }

      res.json(duplicate);
    } catch (error) {
      console.error('Duplicate conversation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get messages for conversation
  router.get('/:id/messages', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const conversation = await db.getConversation(req.params.id, req.userId);
      
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (conversation.userId !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const messages = await db.getConversationMessages(req.params.id, conversation.userId);
      res.json(messages);
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Import conversation
  router.post('/import', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = ImportConversationRequestSchema.parse(req.body);
      
      // Create conversation
      const conversation = await db.createConversation(
        req.userId,
        data.title,
        data.model,
        data.systemPrompt
      );

      // Import messages
      for (const msg of data.messages) {
        const message = await db.createMessage(
          conversation.id,
          conversation.userId,
          msg.content,
          msg.role,
          msg.role === 'assistant' ? data.model : undefined
        );

        // Add branches if provided
        if (message && msg.branches && msg.branches.length > 0) {
          for (const branch of msg.branches) {
            await db.addMessageBranch(
              message.id,
              conversation.id,
              conversation.userId,
              branch.content,
              msg.role,
              message.branches[0].id,
              msg.role === 'assistant' ? data.model : undefined
            );
          }
        }
      }

      res.json(conversation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Import conversation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Set active branch for a message
  router.post('/:id/set-active-branch', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      const { messageId, branchId } = req.body;
      if (!messageId || !branchId) {
        return res.status(400).json({ error: 'messageId and branchId are required' });
      }
      
      const conversation = await db.getConversation(req.params.id, req.userId);
      if (!conversation || conversation.userId !== req.userId) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      
      // Set the active branch
      const success = await db.setActiveBranch(messageId, conversation.id, conversation.userId, branchId);
      
      if (success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: 'Failed to set active branch' });
      }
    } catch (error) {
      console.error('Set active branch error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get cache metrics for conversation
  router.get('/:id/cache-metrics', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const conversation = await db.getConversation(req.params.id, req.userId);
      
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (conversation.userId !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get cache metrics from the enhanced inference service if available
      // For now, return a placeholder
      const contextManagement = conversation.contextManagement ?? DEFAULT_CONTEXT_MANAGEMENT;
      const metrics = {
        conversationId: req.params.id,
        cacheHits: 0,
        cacheMisses: 0,
        totalTokensSaved: 0,
        totalCostSaved: 0,
        contextStrategy: contextManagement.strategy
      };

      res.json(metrics);
    } catch (error) {
      console.error('Get cache metrics error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  // Get conversation metrics
  router.get('/:id/metrics', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const conversation = await db.getConversation(req.params.id, req.userId);
      
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (conversation.userId !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get metrics summary from database
      const summary = await db.getConversationMetricsSummary(req.params.id, conversation.userId);
      
      if (!summary) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const metrics: ConversationMetrics = {
        conversationId: req.params.id,
        messageCount: summary.messageCount,
        perModelMetrics: Object.fromEntries(summary.perModelMetrics),
        lastCompletion: summary.lastCompletion,
        totals: summary.totals,
        contextManagement: conversation.contextManagement ?? DEFAULT_CONTEXT_MANAGEMENT,
        totalTreeTokens: summary.totalTreeTokens
      };

      res.json(metrics);
    } catch (error) {
      console.error('Get metrics error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Export conversation
  router.get('/:id/export', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const conversation = await db.getConversation(req.params.id, req.userId);
      
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (conversation.userId !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const exportData = await db.exportConversation(req.params.id, conversation.userId);
      res.json(exportData);
    } catch (error) {
      console.error('Export conversation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
