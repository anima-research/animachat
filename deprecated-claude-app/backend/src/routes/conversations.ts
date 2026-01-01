import { Router } from 'express';
import { z } from 'zod';
import { Database } from '../database/index.js';
import { getBlobStore } from '../database/blob-store.js';
import { AuthRequest } from '../middleware/auth.js';
import { roomManager } from '../websocket/room-manager.js';
import { CreateConversationRequestSchema, ImportConversationRequestSchema, ConversationMetrics, DEFAULT_CONTEXT_MANAGEMENT, ContentBlockSchema, Message } from '@deprecated-claude/shared';

/**
 * Prepare messages for client by:
 * 1. Stripping debug data (debugRequest, debugResponse) - loaded on demand
 * 2. Converting old inline images to blob references - for memory efficiency
 * 
 * IMPORTANT: This function creates clones to avoid mutating the cached database objects.
 * The database returns objects from an in-memory cache, so mutations would be permanent.
 */
async function prepareMessagesForClient(messages: Message[]): Promise<Message[]> {
  const blobStore = getBlobStore();
  const result: Message[] = [];
  
  for (const message of messages) {
    // Clone the message and its branches array
    const clonedMessage = { ...message, branches: [] as typeof message.branches };
    
    for (const branch of message.branches) {
      // Clone the branch, explicitly omitting debug data
      const { debugRequest, debugResponse, ...branchWithoutDebug } = branch as any;
      const clonedBranch = { ...branchWithoutDebug };
      
      // Process content blocks for images (clone the array too)
      if (branch.contentBlocks && branch.contentBlocks.length > 0) {
        clonedBranch.contentBlocks = [];
        
        for (const block of branch.contentBlocks) {
          const typedBlock = block as any;
          
          if (typedBlock.type === 'image' && typedBlock.data && !typedBlock.blobId) {
            // OLD FORMAT: Convert inline base64 to blob
            try {
              const blobId = await blobStore.saveBlob(typedBlock.data, typedBlock.mimeType || 'image/png');
              console.log(`[prepareMessages] Converted inline image to blob ${blobId.substring(0, 8)}...`);
              
              // Create new block with blobId instead of data
              clonedBranch.contentBlocks.push({
                type: 'image',
                mimeType: typedBlock.mimeType || 'image/png',
                blobId,
                // Preserve other fields like revisedPrompt, width, height
                ...(typedBlock.revisedPrompt && { revisedPrompt: typedBlock.revisedPrompt }),
                ...(typedBlock.width && { width: typedBlock.width }),
                ...(typedBlock.height && { height: typedBlock.height }),
              });
            } catch (error) {
              console.error(`[prepareMessages] Failed to convert image to blob:`, error);
              // Keep original block if conversion fails
              clonedBranch.contentBlocks.push({ ...typedBlock });
            }
          } else {
            // Clone other blocks as-is
            clonedBranch.contentBlocks.push({ ...typedBlock });
          }
        }
      }
      
      clonedMessage.branches.push(clonedBranch);
    }
    
    result.push(clonedMessage);
  }
  
  return result;
}

// Schema for creating a post-hoc operation
const CreatePostHocOperationSchema = z.object({
  type: z.enum(['hide', 'hide_before', 'edit', 'hide_attachment', 'unhide']),
  targetMessageId: z.string().uuid(),
  targetBranchId: z.string().uuid(),
  replacementContent: z.array(ContentBlockSchema).optional(),
  attachmentIndices: z.array(z.number()).optional(),
  reason: z.string().optional(),
  parentBranchId: z.string().uuid().optional(), // Parent branch for proper tree integration
});

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

      // getConversation now handles both ownership and collaboration access
      const conversation = await db.getConversation(req.params.id, req.userId);
      
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Note: Access control is handled in getConversation - no need for additional userId check
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

  // Get conversation event history
  router.get('/:id/events', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Check access (owner or collaborator)
      const access = await db.canUserAccessConversation(req.params.id, req.userId);
      if (!access.canAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get the conversation to find owner
      const conversation = await db.getConversation(req.params.id, req.userId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const events = await db.getConversationEvents(req.params.id, conversation.userId);
      res.json(events);
    } catch (error) {
      console.error('Get conversation events error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get messages for conversation
  router.get('/:id/messages', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // getConversation handles both ownership and collaboration access
      const conversation = await db.getConversation(req.params.id, req.userId);
      
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Note: Access control is handled in getConversation
      const messages = await db.getConversationMessages(req.params.id, conversation.userId);
      
      // Prepare messages for client: strip debug data, convert old images to blob refs
      const preparedMessages = await prepareMessagesForClient(messages);
      
      res.json(preparedMessages);
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get debug data for a specific message branch
  // This endpoint returns the full debugRequest and debugResponse that were stripped from the messages response
  router.get('/:id/messages/:messageId/branches/:branchId/debug', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { id: conversationId, messageId, branchId } = req.params;

      // Verify conversation access
      const conversation = await db.getConversation(conversationId, req.userId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Get the message
      const message = await db.getMessage(messageId, conversationId, conversation.userId);
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Find the branch
      const branch = message.branches.find(b => b.id === branchId);
      if (!branch) {
        return res.status(404).json({ error: 'Branch not found' });
      }

      // Return debug data (may be undefined if not captured)
      res.json({
        debugRequest: (branch as any).debugRequest || null,
        debugResponse: (branch as any).debugResponse || null,
      });
    } catch (error) {
      console.error('Get debug data error:', error);
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
          msg.role === 'assistant' ? data.model : undefined,
          undefined, // parentBranchId
          undefined, // participantId
          undefined, // attachments
          undefined, // sentByUserId
          undefined, // hiddenFromAi
          'import'   // creationSource - imported data
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
              msg.role === 'assistant' ? data.model : undefined,
              undefined, // participantId
              undefined, // attachments
              undefined, // sentByUserId
              undefined, // hiddenFromAi
              false,     // preserveActiveBranch
              'import'   // creationSource - imported data
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

  // Get conversation archive - all messages with orphan/deleted status for debugging
  router.get('/:id/archive', async (req: AuthRequest, res) => {
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

      const archiveData = await db.getConversationArchive(req.params.id);
      res.json(archiveData);
    } catch (error) {
      console.error('Get conversation archive error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Create a post-hoc operation (hide, edit, etc.)
  router.post('/:id/post-hoc-operation', async (req: AuthRequest, res) => {
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

      const operation = CreatePostHocOperationSchema.parse(req.body);

      // Verify target message exists in this conversation
      const messages = await db.getConversationMessages(req.params.id, req.userId);
      const targetMessage = messages.find(m => m.id === operation.targetMessageId);
      
      if (!targetMessage) {
        return res.status(400).json({ error: 'Target message not found in this conversation' });
      }

      // Verify target branch exists
      const targetBranch = targetMessage.branches.find(b => b.id === operation.targetBranchId);
      if (!targetBranch) {
        return res.status(400).json({ error: 'Target branch not found in target message' });
      }

      // Create the operation message
      // The content describes the operation for display purposes
      let operationDescription = '';
      switch (operation.type) {
        case 'hide':
          operationDescription = `🙈 Hidden message`;
          break;
        case 'hide_before':
          operationDescription = `🙈 Hidden messages before this point`;
          break;
        case 'edit':
          operationDescription = `✏️ Edited message`;
          break;
        case 'hide_attachment':
          operationDescription = `🙈 Hidden attachment(s)`;
          break;
        case 'unhide':
          operationDescription = `👁️ Unhidden message`;
          break;
      }

      if (operation.reason) {
        operationDescription += `: ${operation.reason}`;
      }

      // Create message with the post-hoc operation
      const message = await db.createPostHocOperation(
        req.params.id,
        req.userId,
        operationDescription,
        operation
      );

      res.json(message);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Create post-hoc operation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Delete a post-hoc operation
  router.delete('/:id/post-hoc-operation/:messageId', async (req: AuthRequest, res) => {
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

      // Verify the message is a post-hoc operation
      const messages = await db.getConversationMessages(req.params.id, req.userId);
      const operationMessage = messages.find(m => m.id === req.params.messageId);
      
      if (!operationMessage) {
        return res.status(404).json({ error: 'Operation message not found' });
      }

      const activeBranch = operationMessage.branches.find(b => b.id === operationMessage.activeBranchId);
      if (!activeBranch?.postHocOperation) {
        return res.status(400).json({ error: 'Message is not a post-hoc operation' });
      }

      // Delete the operation message
      await db.deleteMessage(req.params.messageId, req.params.id, req.userId);

      res.json({ success: true });
    } catch (error) {
      console.error('Delete post-hoc operation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Restore a deleted message
  router.post('/:id/messages/restore', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: 'Message data required' });
      }

      // Check access (owner or editor)
      const canChat = await db.canUserChatInConversation(req.params.id, req.userId);
      if (!canChat) {
        return res.status(403).json({ error: 'You do not have permission to restore messages in this conversation' });
      }

      // Get the conversation owner for proper message restoration
      const conversation = await db.getConversation(req.params.id, req.userId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Restore the message
      const restoredMessage = await db.restoreMessage(req.params.id, conversation.userId, message, req.userId);
      
      // Broadcast to conversation room
      roomManager.broadcastToRoom(req.params.id, {
        type: 'message_restored',
        conversationId: req.params.id,
        message: restoredMessage
      });
      
      res.json({ success: true, message: restoredMessage });
    } catch (error) {
      console.error('Restore message error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Restore a deleted branch
  router.post('/:id/branches/restore', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { messageId, branch } = req.body;
      if (!messageId || !branch) {
        return res.status(400).json({ error: 'messageId and branch data required' });
      }

      // Check access (owner or editor)
      const canChat = await db.canUserChatInConversation(req.params.id, req.userId);
      if (!canChat) {
        return res.status(403).json({ error: 'You do not have permission to restore branches in this conversation' });
      }

      // Get the conversation owner
      const conversation = await db.getConversation(req.params.id, req.userId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Restore the branch
      const restoredMessage = await db.restoreBranch(req.params.id, conversation.userId, messageId, branch, req.userId);
      
      // Broadcast to conversation room
      roomManager.broadcastToRoom(req.params.id, {
        type: 'message_branch_restored',
        conversationId: req.params.id,
        message: restoredMessage,
        branchId: branch.id
      });
      
      res.json({ success: true, message: restoredMessage });
    } catch (error) {
      console.error('Restore branch error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Split a message at a given position
  router.post('/:id/messages/:messageId/split', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { splitPosition, branchId } = req.body;
      if (typeof splitPosition !== 'number' || !branchId) {
        return res.status(400).json({ error: 'splitPosition (number) and branchId required' });
      }

      // Check access (owner or editor)
      const canChat = await db.canUserChatInConversation(req.params.id, req.userId);
      if (!canChat) {
        return res.status(403).json({ error: 'You do not have permission to split messages in this conversation' });
      }

      // Get the conversation owner
      const conversation = await db.getConversation(req.params.id, req.userId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Split the message
      const result = await db.splitMessage(req.params.id, conversation.userId, req.params.messageId, branchId, splitPosition, req.userId);
      if (!result) {
        return res.status(404).json({ error: 'Message or branch not found' });
      }
      
      // Broadcast to conversation room
      roomManager.broadcastToRoom(req.params.id, {
        type: 'message_split',
        conversationId: req.params.id,
        originalMessage: result.originalMessage,
        newMessage: result.newMessage,
        splitByUserId: req.userId
      });
      
      res.json({ success: true, originalMessage: result.originalMessage, newMessage: result.newMessage });
    } catch (error) {
      console.error('Split message error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
