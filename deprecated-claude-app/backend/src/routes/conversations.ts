import { Router } from 'express';
import { z } from 'zod';
import { Database } from '../database/index.js';
import { getBlobStore } from '../database/blob-store.js';
import { compactConversation, getConversationFilePath, formatCompactionResult } from '../database/compaction.js';
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
 * 
 * When images are converted, the change is PERSISTED to the database to avoid:
 * - Duplicate blobs after server restarts (hashToId map is in-memory only)
 * - Repeated conversion work on every fetch
 */
async function prepareMessagesForClient(messages: Message[], db: Database, conversationOwnerUserId: string): Promise<Message[]> {
  const blobStore = getBlobStore();
  const result: Message[] = [];
  
  for (const message of messages) {
    // Clone the message and its branches array
    const clonedMessage = { ...message, branches: [] as typeof message.branches };
    
    for (const branch of message.branches) {
      // Clone the branch, explicitly omitting debug data
      const { debugRequest, debugResponse, ...branchWithoutDebug } = branch as any;
      const clonedBranch = { ...branchWithoutDebug };
      
      // Track if we need to persist changes for this branch
      let needsPersist = false;
      const updatedContentBlocks: any[] = [];
      
      // Process content blocks for images (clone the array too)
      if (branch.contentBlocks && branch.contentBlocks.length > 0) {
        for (const block of branch.contentBlocks) {
          const typedBlock = block as any;
          
          if (typedBlock.type === 'image' && typedBlock.data && !typedBlock.blobId) {
            // OLD FORMAT: Convert inline base64 to blob
            try {
              const blobId = await blobStore.saveBlob(typedBlock.data, typedBlock.mimeType || 'image/png');
              console.log(`[prepareMessages] Converted inline image to blob ${blobId.substring(0, 8)}...`);
              
              // Create new block with blobId instead of data
              const newBlock = {
                type: 'image',
                mimeType: typedBlock.mimeType || 'image/png',
                blobId,
                // Preserve other fields like revisedPrompt, width, height
                ...(typedBlock.revisedPrompt && { revisedPrompt: typedBlock.revisedPrompt }),
                ...(typedBlock.width && { width: typedBlock.width }),
                ...(typedBlock.height && { height: typedBlock.height }),
              };
              updatedContentBlocks.push(newBlock);
              needsPersist = true;
            } catch (error) {
              console.error(`[prepareMessages] Failed to convert image to blob:`, error);
              // Keep original block if conversion fails
              updatedContentBlocks.push({ ...typedBlock });
            }
          } else {
            // Clone other blocks as-is
            updatedContentBlocks.push({ ...typedBlock });
          }
        }
        
        clonedBranch.contentBlocks = updatedContentBlocks;
        
        // Persist the conversion to the database so it's not repeated
        if (needsPersist) {
          try {
            await db.updateMessageBranch(message.id, conversationOwnerUserId, branch.id, {
              contentBlocks: updatedContentBlocks
            });
            console.log(`[prepareMessages] Persisted image conversion for message ${message.id.substring(0, 8)}... branch ${branch.id.substring(0, 8)}...`);
          } catch (error) {
            console.error(`[prepareMessages] Failed to persist image conversion:`, error);
            // Continue anyway - the client will still get the converted data
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

  // Get unread counts for all user's conversations (owned AND shared)
  //
  // STUBBED: Returns empty object until proper implementation.
  // See .workshop/proposal-realtime-notifications.md for architecture discussion.
  // See .workshop/unread-frontend-contract.md for frontend expectations.
  //
  // Issues with current implementation:
  // 1. Migration problem: existing users see all historical messages as "unread"
  // 2. No real-time updates: sidebar doesn't refresh until user clicks conversation
  //
  // Frontend UI components are ready and will light up when this returns real data.
  router.get('/unread-counts', async (req: AuthRequest, res) => {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    // Stub: return empty counts until proper implementation
    res.json({});
  });

  // Backfill totalBranchCount for existing conversations (run once after migration)
  // This loads each conversation's events and saves the computed count to state file
  router.post('/backfill-branch-counts', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Get owned conversations
      const ownedConversations = await db.getUserConversationsWithSummary(req.userId);

      // Get shared conversations
      const shares = db.getConversationsSharedWithUser(req.userId);

      const results: Record<string, number> = {};

      // Process owned conversations
      for (const conv of ownedConversations) {
        // Load conversation events (computes totalBranchCount via event replay)
        await db.ensureConversationLoaded(conv.id, conv.userId);

        // Get the computed count from the in-memory conversation
        const updatedConv = await db.getConversation(conv.id, conv.userId);
        const count = updatedConv?.totalBranchCount ?? 0;

        // Save to state file for future fast access
        if (count > 0) {
          await db.backfillBranchCount(conv.id, count);
        }

        results[conv.id] = count;
      }

      // Process shared conversations (use owner's ID from share)
      for (const share of shares) {
        // Skip if already processed (user might own and be shared the same conversation somehow)
        if (results[share.conversationId] !== undefined) continue;

        // Load conversation using the owner's ID (sharedByUserId)
        await db.ensureConversationLoaded(share.conversationId, share.sharedByUserId);

        const conv = await db.getConversation(share.conversationId, share.sharedByUserId);
        const count = conv?.totalBranchCount ?? 0;

        if (count > 0) {
          await db.backfillBranchCount(share.conversationId, count);
        }

        results[share.conversationId] = count;
      }

      res.json({ message: 'Backfill complete', counts: results });
    } catch (error) {
      console.error('Backfill branch counts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

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
      // Pass requesting user to filter private branches
      const messages = await db.getConversationMessages(req.params.id, conversation.userId, req.userId);

      // Prepare messages for client: strip debug data, convert old images to blob refs
      // Pass db and userId so conversions can be persisted (avoiding duplicate blobs after restart)
      const preparedMessages = await prepareMessagesForClient(messages, db, conversation.userId);

      res.json(preparedMessages);
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get debug data for a specific message branch
  // This endpoint returns the full debugRequest and debugResponse
  // Debug data is stored on disk as blobs - loaded here on demand, never kept in memory
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

      const branchAny = branch as any;
      const blobStore = getBlobStore();
      
      // Load debug data from blobs if blob IDs exist
      let debugRequest = null;
      let debugResponse = null;
      
      if (branchAny.debugRequestBlobId) {
        try {
          debugRequest = await blobStore.loadJsonBlob(branchAny.debugRequestBlobId);
        } catch (err) {
          console.warn(`[Debug] Failed to load debugRequest blob ${branchAny.debugRequestBlobId}:`, err);
        }
      } else if (branchAny.debugRequest) {
        // Fallback for old inline data (pre-blob migration)
        debugRequest = branchAny.debugRequest;
      }
      
      if (branchAny.debugResponseBlobId) {
        try {
          debugResponse = await blobStore.loadJsonBlob(branchAny.debugResponseBlobId);
        } catch (err) {
          console.warn(`[Debug] Failed to load debugResponse blob ${branchAny.debugResponseBlobId}:`, err);
        }
      } else if (branchAny.debugResponse) {
        // Fallback for old inline data (pre-blob migration)
        debugResponse = branchAny.debugResponse;
      }

      res.json({ debugRequest, debugResponse });
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

  // ==================== PER-USER UI STATE ====================
  // These are user-specific settings (speaking as, selected responder, detached mode)
  // They are NEVER synced to other users in multi-user conversations

  // Get user's UI state for a conversation
  router.get('/:id/ui-state', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const conversation = await db.getConversation(req.params.id, req.userId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const state = await db.getUserConversationState(req.params.id, req.userId);
      res.json(state);
    } catch (error) {
      console.error('Get UI state error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Update user's UI state for a conversation
  router.patch('/:id/ui-state', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const conversation = await db.getConversation(req.params.id, req.userId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const { speakingAs, selectedResponder, isDetached, detachedBranch } = req.body;

      // Update each field if provided
      if (speakingAs !== undefined) {
        await db.setUserSpeakingAs(req.params.id, req.userId, speakingAs || undefined);
      }
      if (selectedResponder !== undefined) {
        await db.setUserSelectedResponder(req.params.id, req.userId, selectedResponder || undefined);
      }
      if (isDetached !== undefined) {
        await db.setUserDetached(req.params.id, req.userId, isDetached);
      }
      if (detachedBranch) {
        const { messageId, branchId } = detachedBranch;
        if (messageId && branchId) {
          await db.setUserDetachedBranch(req.params.id, req.userId, messageId, branchId);
        }
      }

      // Return updated state
      const state = await db.getUserConversationState(req.params.id, req.userId);
      res.json(state);
    } catch (error) {
      console.error('Update UI state error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Mark branches as read for the current user
  router.post('/:id/mark-read', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const conversation = await db.getConversation(req.params.id, req.userId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const { branchIds } = req.body;
      if (!Array.isArray(branchIds)) {
        return res.status(400).json({ error: 'branchIds must be an array' });
      }

      await db.markBranchesAsRead(req.params.id, req.userId, branchIds);
      res.json({ success: true });
    } catch (error) {
      console.error('Mark branches read error:', error);
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

  // Set branch privacy - make a branch visible only to a specific user
  // Owner and editors can set privacy on any branch
  router.post('/:id/messages/:messageId/branches/:branchId/privacy', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { privateToUserId } = req.body; // null/undefined to make public, userId to make private

      // Check access (owner or editor)
      const canChat = await db.canUserChatInConversation(req.params.id, req.userId);
      if (!canChat) {
        return res.status(403).json({ error: 'Only owner or editors can set branch privacy' });
      }

      // Get the conversation to find owner
      const conversation = await db.getConversation(req.params.id, req.userId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Update the branch
      const updated = await db.updateMessageBranch(
        req.params.messageId,
        conversation.userId,
        req.params.branchId,
        { privateToUserId: privateToUserId || undefined }
      );

      if (!updated) {
        return res.status(404).json({ error: 'Branch not found' });
      }

      // Broadcast visibility change to all users in the room
      roomManager.broadcastToRoom(req.params.id, {
        type: 'branch_visibility_changed',
        conversationId: req.params.id,
        messageId: req.params.messageId,
        branchId: req.params.branchId,
        privateToUserId: privateToUserId || null,
        changedByUserId: req.userId
      });

      res.json({ success: true, privateToUserId: privateToUserId || null });
    } catch (error) {
      console.error('Set branch privacy error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get subtree from a specific branch (used after unhiding to fetch newly visible content)
  router.get('/:id/subtree/:branchId', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Check access
      const canAccess = await db.canUserAccessConversation(req.params.id, req.userId);
      if (!canAccess) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const conversation = await db.getConversation(req.params.id, req.userId);
      
      // Get all messages (filtered by privacy for this user)
      const allMessages = await db.getConversationMessages(
        req.params.id, 
        conversation?.userId || req.userId,
        req.userId
      );

      // Build subtree from the specified branch using BFS
      const childrenMap = new Map<string, Array<{ message: Message; branchId: string }>>();
      for (const msg of allMessages) {
        for (const branch of msg.branches) {
          if (branch.parentBranchId && branch.parentBranchId !== 'root') {
            const children = childrenMap.get(branch.parentBranchId) || [];
            children.push({ message: msg, branchId: branch.id });
            childrenMap.set(branch.parentBranchId, children);
          }
        }
      }

      // Find the message containing the target branch
      let targetMessage: Message | null = null;
      for (const msg of allMessages) {
        if (msg.branches.some(b => b.id === req.params.branchId)) {
          targetMessage = msg;
          break;
        }
      }

      if (!targetMessage) {
        return res.status(404).json({ error: 'Branch not found' });
      }

      // BFS to collect subtree
      const subtreeMessages: Message[] = [targetMessage];
      const visitedMessages = new Set<string>([targetMessage.id]);
      const branchQueue: string[] = [];

      // Add all branches of target to queue
      for (const branch of targetMessage.branches) {
        branchQueue.push(branch.id);
      }

      while (branchQueue.length > 0) {
        const currentBranchId = branchQueue.shift()!;
        const children = childrenMap.get(currentBranchId);
        if (!children) continue;

        for (const child of children) {
          if (visitedMessages.has(child.message.id)) continue;
          subtreeMessages.push(child.message);
          visitedMessages.add(child.message.id);

          for (const branch of child.message.branches) {
            branchQueue.push(branch.id);
          }
        }
      }

      // Sort by order
      subtreeMessages.sort((a, b) => a.order - b.order);

      res.json({ messages: subtreeMessages });
    } catch (error) {
      console.error('Get subtree error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Fork conversation at a specific message - creates new conversation with subtree from that point
  // Options:
  //   mode: 'full' | 'compressed' | 'truncated'
  //     - 'full': Copy all prior messages (active branch) + full subtree with all branches
  //     - 'compressed': Embed prior messages as prefixHistory + full subtree
  //     - 'truncated': No prior context, just the subtree (clean break)
  router.post('/:id/fork', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Support both old (compressHistory) and new (mode) API
      const { messageId, branchId, mode: rawMode, compressHistory, includePrivateBranches = true } = req.body;
      const mode: 'full' | 'compressed' | 'truncated' = 
        rawMode || (compressHistory ? 'compressed' : 'full');
      
      if (!messageId || !branchId) {
        return res.status(400).json({ error: 'messageId and branchId are required' });
      }

      // Check access
      const conversation = await db.getConversation(req.params.id, req.userId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Get all messages (include requester's private branches for forking)
      const messages = await db.getConversationMessages(req.params.id, conversation.userId, req.userId);
      if (!messages.length) {
        return res.status(400).json({ error: 'No messages to fork' });
      }

      // Build message index and parent map
      const messageById = new Map(messages.map(m => [m.id, m]));
      const parentMap = new Map<string, { messageId: string; branchId: string }>();
      
      for (const msg of messages) {
        for (const branch of msg.branches) {
          if (branch.parentBranchId) {
            // Find parent message by its branch
            for (const parentMsg of messages) {
              const parentBranch = parentMsg.branches.find(b => b.id === branch.parentBranchId);
              if (parentBranch) {
                // CRITICAL: Key by BRANCH ID, not message ID!
                // A message can have multiple branches with different parents.
                // If keyed by message ID, only the last branch's parent would be recorded.
                parentMap.set(branch.id, { messageId: parentMsg.id, branchId: parentBranch.id });
                break;
              }
            }
          }
        }
      }

      // Walk path from target message to root
      const targetMessage = messageById.get(messageId);
      if (!targetMessage) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const targetBranch = targetMessage.branches.find(b => b.id === branchId);
      if (!targetBranch) {
        return res.status(404).json({ error: 'Branch not found' });
      }

      // Collect path from root to target (the HISTORY before the fork point)
      const historyPath: Array<{ message: Message; branchId: string }> = [];
      let currentMsgId: string | undefined = messageId;
      let currentBranchId: string | undefined = branchId;

      while (currentMsgId) {
        const msg = messageById.get(currentMsgId);
        if (!msg) break;
        historyPath.unshift({ message: msg, branchId: currentBranchId! });
        
        // Look up parent by BRANCH ID to follow the correct path through the tree
        const parent = parentMap.get(currentBranchId!);
        if (parent) {
          currentMsgId = parent.messageId;
          currentBranchId = parent.branchId;
        } else {
          break;
        }
      }

      // Build child map for traversing descendants
      const childrenMap = new Map<string, Array<{ message: Message; branchId: string }>>();
      for (const msg of messages) {
        for (const branch of msg.branches) {
          if (branch.parentBranchId && branch.parentBranchId !== 'root') {
            const children = childrenMap.get(branch.parentBranchId) || [];
            children.push({ message: msg, branchId: branch.id });
            childrenMap.set(branch.parentBranchId, children);
          }
        }
      }

      // Collect ALL descendants from target onwards using BFS
      // We need the entire subtree, not just one path
      const subtreeMessages: Array<{ message: Message; branchId: string }> = [];
      const visitedMessages = new Set<string>();
      
      // Start from target message with the specified branch
      subtreeMessages.push({ message: targetMessage, branchId });
      visitedMessages.add(targetMessage.id);
      console.log(`[Fork] Starting subtree collection from message ${messageId.substring(0, 8)}... branch ${branchId.substring(0, 8)}...`);
      console.log(`[Fork] childrenMap has ${childrenMap.size} entries`);
      
      // BFS to collect all descendants
      // Queue contains branch IDs to explore
      const branchQueue: string[] = [];
      
      // Add all branches of the target message to the queue
      for (const branch of targetMessage.branches) {
        branchQueue.push(branch.id);
      }
      
      while (branchQueue.length > 0) {
        const currentBranchId = branchQueue.shift()!;
        const children = childrenMap.get(currentBranchId);
        
        if (!children || children.length === 0) continue;
        
        for (const child of children) {
          if (visitedMessages.has(child.message.id)) continue;
          
          console.log(`[Fork] Adding descendant message ${child.message.id.substring(0, 8)}... branch ${child.branchId.substring(0, 8)}...`);
          subtreeMessages.push(child);
          visitedMessages.add(child.message.id);
          
          // Add ALL branches of this message to explore their children too
          for (const branch of child.message.branches) {
            branchQueue.push(branch.id);
          }
        }
      }
      
      // Sort by order to maintain message sequence
      subtreeMessages.sort((a, b) => a.message.order - b.message.order);
      const subtreePath = subtreeMessages;
      
      console.log(`[Fork] Subtree has ${subtreePath.length} messages`);
      console.log(`[Fork] History before target has ${historyPath.length - 1} messages`);

      // History = everything before the target (excluding target itself)
      const historyBeforeTarget = historyPath.slice(0, -1);

      // Create new conversation with same settings
      const newConversation = await db.createConversation(
        req.userId,
        `Fork: ${conversation.title}`,
        conversation.model,
        conversation.systemPrompt
      );

      // Apply additional settings
      await db.updateConversation(newConversation.id, req.userId, {
        format: conversation.format,
        combineConsecutiveMessages: conversation.combineConsecutiveMessages,
        cliModePrompt: conversation.cliModePrompt,
        contextManagement: conversation.contextManagement,
        settings: conversation.settings,
        prefillUserMessage: conversation.prefillUserMessage,
      });

      // Get participants for name resolution
      const originalParticipants = await db.getConversationParticipants(req.params.id, conversation.userId);
      const participantNameMap = new Map(originalParticipants.map(p => [p.id, p.name]));

      // Copy participants for group chats (do this first so we have participant IDs)
      const newParticipantMap = new Map<string, string>(); // old ID -> new ID
      if (conversation.format === 'prefill') {
        for (const p of originalParticipants) {
          const newParticipant = await db.createParticipant(
            newConversation.id,
            req.userId,
            p.name,
            p.type,
            p.model,
            p.personaId,
            p.isActive,
            p.systemPrompt
          );
          if (newParticipant) {
            newParticipantMap.set(p.id, newParticipant.id);
          }
        }
      }

      // Build mapping from old IDs to new IDs
      // Special value '__ROOT__' means the parent should be undefined (for branches whose parent is in history)
      const branchIdMap = new Map<string, string>(); // old branchId -> new branchId (or '__ROOT__')
      const messageIdMap = new Map<string, string>(); // old messageId -> new messageId
      const userId = req.userId!;
      let messagesCopied = 0;

      // Helper to copy a message with ALL its branches, preserving tree structure
      const copyMessageWithBranches = async (
        message: Message,
        prefixHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string; participantName?: string; model?: string }>
      ) => {
        let newMessage: Message | null = null;
        
        for (let i = 0; i < message.branches.length; i++) {
          const branch = message.branches[i];
          
          // Skip private branches if not including them
          if (branch.privateToUserId && !includePrivateBranches) {
            console.log(`[Fork] Skipping private branch ${branch.id.substring(0, 8)}...`);
            // Mark as skipped so descendants know to skip themselves
            branchIdMap.set(branch.id, '__SKIPPED__');
            continue;
          }
          
          // Look up the mapped parent branch ID
          let mappedParentBranchId: string | undefined = undefined;
          if (branch.parentBranchId && branch.parentBranchId !== 'root') {
            const mapped = branchIdMap.get(branch.parentBranchId);
            if (mapped === '__ROOT__') {
              // Parent is in history which was compressed - treat as root
              mappedParentBranchId = undefined;
            } else if (mapped === '__SKIPPED__') {
              // Parent was skipped (private or descendant of private) - skip this too
              console.log(`[Fork] Skipping branch ${branch.id.substring(0, 8)}... (parent was skipped)`);
              branchIdMap.set(branch.id, '__SKIPPED__');
              continue;
            } else if (mapped) {
              mappedParentBranchId = mapped;
            } else {
              // Parent not in map - might be from outside the fork or a bug
              console.log(`[Fork] Warning: parent ${branch.parentBranchId.substring(0, 8)}... not found in map, skipping branch ${branch.id.substring(0, 8)}...`);
              branchIdMap.set(branch.id, '__SKIPPED__');
              continue;
            }
          }
          
          if (i === 0) {
            // First branch: create the message
            newMessage = await db.createMessage(
              newConversation.id,
              userId,
              branch.content,
              branch.role,
              branch.model,
              mappedParentBranchId,
              branch.participantId ? newParticipantMap.get(branch.participantId) || branch.participantId : undefined,
              undefined,
              branch.sentByUserId,
              branch.hiddenFromAi,
              'fork'
            );
            
            if (newMessage) {
              // Map old IDs to new IDs
              branchIdMap.set(branch.id, newMessage.branches[0].id);
              messageIdMap.set(message.id, newMessage.id);
              
              // Add content blocks and optionally prefixHistory
              const updates: any = {};
              if (branch.contentBlocks && branch.contentBlocks.length > 0) {
                updates.contentBlocks = branch.contentBlocks;
              }
              if (prefixHistory && prefixHistory.length > 0) {
                updates.prefixHistory = prefixHistory;
              }
              if (Object.keys(updates).length > 0) {
                await db.updateMessageBranch(
                  newMessage.id,
                  userId,
                  newMessage.branches[0].id,
                  updates
                );
              }
            }
          } else {
            // Additional branches: add as regenerations
            if (newMessage) {
              const updatedMessage = await db.addMessageBranch(
                newMessage.id,
                newConversation.id,
                userId,
                branch.content,
                branch.role,
                mappedParentBranchId,
                branch.model,
                branch.participantId ? newParticipantMap.get(branch.participantId) || branch.participantId : undefined,
                undefined, // attachments
                branch.sentByUserId,
                branch.hiddenFromAi,
                false, // preserveActiveBranch
                'fork'
              );
              
              if (updatedMessage) {
                // Map the new branch ID
                const newBranch = updatedMessage.branches[updatedMessage.branches.length - 1];
                branchIdMap.set(branch.id, newBranch.id);
                
                // Update content blocks if present
                if (branch.contentBlocks && branch.contentBlocks.length > 0) {
                  await db.updateMessageBranch(
                    updatedMessage.id,
                    userId,
                    newBranch.id,
                    { contentBlocks: branch.contentBlocks }
                  );
                }
                
                newMessage = updatedMessage;
              }
            }
          }
        }
        
        return newMessage;
      };

      // Helper to copy bookmarks from original conversation to new conversation
      const copyBookmarks = async () => {
        const originalBookmarks = await db.getConversationBookmarks(req.params.id);
        let bookmarksCopied = 0;
        
        for (const bookmark of originalBookmarks) {
          const newMessageId = messageIdMap.get(bookmark.messageId);
          const newBranchId = branchIdMap.get(bookmark.branchId);
          
          if (newMessageId && newBranchId && newBranchId !== '__ROOT__') {
            await db.createOrUpdateBookmark(
              newConversation.id,
              newMessageId,
              newBranchId,
              bookmark.label
            );
            bookmarksCopied++;
          }
        }
        
        if (bookmarksCopied > 0) {
          console.log(`[Fork] Copied ${bookmarksCopied} bookmarks`);
        }
        return bookmarksCopied;
      };

      // Helper to mark all history branches as root (for compressed/truncated modes)
      const markHistoryAsRoot = () => {
        const historyBranchIds = new Set<string>();
        for (const { message } of historyBeforeTarget) {
          for (const branch of message.branches) {
            historyBranchIds.add(branch.id);
          }
        }
        for (const histBranchId of historyBranchIds) {
          branchIdMap.set(histBranchId, '__ROOT__');
        }
        console.log(`[Fork] Marked ${historyBranchIds.size} history branches as root`);
      };

      if (mode === 'truncated') {
        // TRUNCATED MODE: No prior context, just the subtree (clean break)
        console.log(`[Fork] Truncated mode: discarding ${historyBeforeTarget.length} history messages`);
        
        // Mark history branches as root so subtree can resolve parents
        markHistoryAsRoot();
        
        // Copy only subtree
        for (const entry of subtreePath) {
          const newMessage = await copyMessageWithBranches(entry.message);
          if (newMessage) {
            messagesCopied++;
          }
        }
        
        // Copy bookmarks
        const bookmarksCopied = await copyBookmarks();
        
        res.json({ 
          success: true, 
          conversation: newConversation,
          messageCount: messagesCopied,
          bookmarksCopied,
          mode: 'truncated'
        });
        
      } else if (mode === 'compressed' && historyBeforeTarget.length > 0) {
        // COMPRESSED MODE: Embed history before target as prefixHistory
        // Then copy target + subtree as normal messages
        console.log(`[Fork] Compressed mode: embedding ${historyBeforeTarget.length} history messages as prefixHistory`);
        
        const prefixHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string; participantId?: string; model?: string }> = [];
        
        // Mark history branches as root
        markHistoryAsRoot();
        
        // Build prefixHistory from active branches only
        // Use NEW participant IDs (participants are copied during fork) so name lookup works properly
        for (const { message, branchId: activeBranchId } of historyBeforeTarget) {
          const activeBranch = message.branches.find(b => b.id === activeBranchId);
          if (activeBranch) {
            prefixHistory.push({
              role: activeBranch.role,
              content: activeBranch.content,
              participantId: activeBranch.participantId ? newParticipantMap.get(activeBranch.participantId) : undefined,
              model: activeBranch.model,
            });
          }
        }
        
        // Copy subtree with prefixHistory on first message
        for (let i = 0; i < subtreePath.length; i++) {
          const entry = subtreePath[i];
          const isFirst = i === 0;
          
          const newMessage = await copyMessageWithBranches(
            entry.message,
            isFirst ? prefixHistory : undefined
          );
          
          if (newMessage) {
            messagesCopied++;
          }
        }
        
        // Copy bookmarks
        const bookmarksCopied = await copyBookmarks();
        
        res.json({ 
          success: true, 
          conversation: newConversation,
          messageCount: messagesCopied,
          prefixHistoryCount: prefixHistory.length,
          bookmarksCopied,
          mode: 'compressed'
        });
        
      } else {
        // FULL MODE (default): Copy history before target, then subtree
        console.log(`[Fork] Full mode: copying ${historyBeforeTarget.length} history messages + ${subtreePath.length} subtree messages`);
        
        // First, copy history before target (linear chain, active branch only)
        for (const { message, branchId } of historyBeforeTarget) {
          const branch = message.branches.find(b => b.id === branchId);
          if (!branch) continue;
          
          let mappedParentBranchId: string | undefined = undefined;
          if (branch.parentBranchId && branch.parentBranchId !== 'root') {
            mappedParentBranchId = branchIdMap.get(branch.parentBranchId);
          }
          
          const newMessage = await db.createMessage(
            newConversation.id,
            userId,
            branch.content,
            branch.role,
            branch.model,
            mappedParentBranchId,
            branch.participantId ? newParticipantMap.get(branch.participantId) || branch.participantId : undefined,
            undefined,
            branch.sentByUserId,
            branch.hiddenFromAi,
            'fork'
          );
          
          if (newMessage) {
            branchIdMap.set(branch.id, newMessage.branches[0].id);
            messageIdMap.set(message.id, newMessage.id);
            
            if (branch.contentBlocks && branch.contentBlocks.length > 0) {
              await db.updateMessageBranch(
                newMessage.id,
                userId,
                newMessage.branches[0].id,
                { contentBlocks: branch.contentBlocks }
              );
            }
            
            messagesCopied++;
          }
        }
        
        // Then copy subtree (target + descendants) with ALL branches preserved
        for (const entry of subtreePath) {
          const newMessage = await copyMessageWithBranches(entry.message);
          if (newMessage) {
            messagesCopied++;
          }
        }

        // Copy bookmarks
        const bookmarksCopied = await copyBookmarks();
        
        res.json({ 
          success: true, 
          conversation: newConversation,
          messageCount: messagesCopied,
          bookmarksCopied,
          mode: 'full'
        });
      }
    } catch (error) {
      console.error('Fork conversation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Compact a conversation's event log (admin only for now)
  // This removes redundant events (branch changes, order changes) and strips/moves debug data to blobs
  router.post('/:id/compact', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { id: conversationId } = req.params;
      const { stripDebugData = true, moveDebugToBlobs = false } = req.body;

      // Verify conversation access - must be owner
      const conversation = await db.getConversation(conversationId, req.userId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Only owner can compact (this modifies the underlying file)
      if (conversation.userId !== req.userId) {
        // Check if user is admin
        const isAdmin = await db.userHasActiveGrantCapability(req.userId, 'admin');
        if (!isAdmin) {
          return res.status(403).json({ error: 'Only the conversation owner or an admin can compact' });
        }
      }

      const filePath = getConversationFilePath(conversationId);
      console.log(`[Compaction] Starting compaction for conversation ${conversationId}`);
      console.log(`[Compaction] File path: ${filePath}`);

      const result = await compactConversation(filePath, {
        removeActiveBranchChanged: true,
        removeMessageOrderChanged: true,
        stripDebugData,
        moveDebugToBlobs,
        createBackup: true,
      });

      console.log(formatCompactionResult(result));

      // The conversation data is now stale in memory - need to reload
      // For now, just notify the client that a reload is needed
      res.json({
        success: true,
        result: {
          originalSizeMB: (result.originalSize / 1024 / 1024).toFixed(2),
          compactedSizeMB: (result.compactedSize / 1024 / 1024).toFixed(2),
          reductionPercent: ((1 - result.compactedSize / result.originalSize) * 100).toFixed(1),
          originalEventCount: result.originalEventCount,
          compactedEventCount: result.compactedEventCount,
          removedEvents: result.removedEvents,
          strippedDebugData: result.strippedDebugData,
          movedToBlobs: result.movedToBlobs,
          backupPath: result.backupPath,
        },
        reloadRequired: true,
        message: 'Conversation compacted. Server restart may be required to reload the compacted data.',
      });
    } catch (error) {
      console.error('Compact conversation error:', error);
      res.status(500).json({ error: 'Failed to compact conversation', details: String(error) });
    }
  });

  return router;
}
