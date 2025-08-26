import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.js';
import { Database } from '../database/index.js';
import { ImportParser } from '../services/importParser.js';
import { 
  ImportRequestSchema, 
  ImportPreviewSchema,
  ImportFormat
} from '@deprecated-claude/shared';

export function importRouter(db: Database): Router {
  const router = Router();
  const parser = new ImportParser();

  // Preview import
  router.post('/preview', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { format, content } = req.body;
      
      if (!format || !content) {
        return res.status(400).json({ error: 'Format and content are required' });
      }

      const preview = await parser.parse(format as ImportFormat, content);
      res.json(preview);
    } catch (error) {
      console.error('Import preview error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid data format', details: error.errors });
      }
      if (error instanceof SyntaxError) {
        return res.status(400).json({ error: 'Invalid JSON format' });
      }
      res.status(500).json({ error: error instanceof Error ? error.message : 'Import preview failed' });
    }
  });

  // Execute import
  router.post('/execute', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const importRequest = ImportRequestSchema.parse(req.body);
      
      // First, parse the content
      const preview = await parser.parse(importRequest.format, importRequest.content);
      
      // Create the conversation
      const conversation = await db.createConversation(
        req.userId,
        importRequest.title || preview.title || 'Imported Conversation',
        importRequest.model,
        undefined, // System prompt will be set on participants
        undefined, // Settings will be set on participants
        importRequest.conversationFormat
      );

      // Get default participants
      const participants = await db.getConversationParticipants(conversation.id);
      const participantMap = new Map<string, string>(); // sourceName -> participantId

      // If mappings provided, create/update participants
      if (importRequest.participantMappings && importRequest.participantMappings.length > 0) {
        for (const mapping of importRequest.participantMappings) {
          // Find existing participant or create new one
          let participant = participants.find(p => 
            p.name === mapping.targetName && p.type === mapping.type
          );
          
          if (!participant) {
            // Create new participant
            participant = await db.createParticipant(
              conversation.id,
              mapping.targetName,
              mapping.type,
              mapping.type === 'assistant' ? importRequest.model : undefined
            );
          }
          
          participantMap.set(mapping.sourceName, participant.id);
        }
      } else if (importRequest.conversationFormat === 'standard') {
        // For standard format, use default User and Assistant
        const userParticipant = participants.find(p => p.type === 'user');
        const assistantParticipant = participants.find(p => p.type === 'assistant');
        
        if (userParticipant) participantMap.set('User', userParticipant.id);
        if (assistantParticipant) participantMap.set('Assistant', assistantParticipant.id);
      }

      // Import messages with branch support
      let parentBranchId: string | undefined;
      const messageIdMap = new Map<string, string>(); // originalUuid -> createdMessageId  
      const branchIdMap = new Map<string, string>(); // originalUuid -> createdBranchId
      // Track messages by their parent and role to group branches correctly
      const messagesByParentAndRole = new Map<string, string>(); // "parentUuid:role" -> messageId
      
      console.log(`Importing ${preview.messages.length} messages to conversation ${conversation.id}`);
      
      for (const parsedMsg of preview.messages) {
        // Skip system messages for now
        if (parsedMsg.role === 'system') continue;
        
        // Determine participant
        const sourceName = parsedMsg.participantName || (parsedMsg.role === 'user' ? 'User' : 'Assistant');
        let participantId = participantMap.get(sourceName);
        
        // If no mapping found, try to find by role
        if (!participantId) {
          const participant = participants.find(p => p.type === parsedMsg.role);
          if (participant) {
            participantId = participant.id;
          }
        }
        
        // Check if this is a branch (alternative response)
        const branchInfo = (parsedMsg as any).__branchInfo;
        const originalUuid = (parsedMsg as any).__uuid;
        const parentUuid = (parsedMsg as any).__parentUuid;
        const isActive = (parsedMsg as any).__isActive;
        
        // Key to identify messages that should be branches of each other
        const messageKey = `${parentUuid}:${parsedMsg.role}`;
        const existingMessageId = messagesByParentAndRole.get(messageKey);
        
        if (branchInfo && branchInfo.isAlternative && existingMessageId) {
          // This is an alternative branch - add it to the existing message with the same parent and role
          console.log(`Adding branch to existing message ${existingMessageId}`);
          
          const existingMessage = await db.getMessageById(existingMessageId);
          if (existingMessage) {
            // Find the parent branch from the previous message
            const parentBranch = existingMessage.branches[0]; // Use the first branch's parent
            const updatedMessage = await db.addMessageBranch(
              existingMessageId,
              parsedMsg.content,
              parsedMsg.role,
              parentBranch?.parentBranchId,  // Use same parent as the first branch
              parsedMsg.model,
              participantId
            );
            
            if (updatedMessage) {
              // Find the newly added branch (it's the last one and the active one)
              const newBranch = updatedMessage.branches.find(b => b.id === updatedMessage.activeBranchId);
              
              if (newBranch) {
                // Store the branch ID for future reference
                if (originalUuid) {
                  branchIdMap.set(originalUuid, newBranch.id);
                }
                
                // If this branch is marked as active, set it
                if (isActive) {
                  await db.setActiveBranch(existingMessageId, newBranch.id);
                  // Don't update parentBranchId here - we're on a sibling branch
                }
              }
            }
          }
        } else {
          // Regular message or first of its siblings
          console.log(`Creating message: role=${parsedMsg.role}, parentBranchId=${parentBranchId}, participantId=${participantId}`);
          const createdMessage = await db.createMessage(
            conversation.id,
            parsedMsg.content,
            parsedMsg.role,
            parsedMsg.model,
            parentBranchId,
            participantId
          );
          
          console.log(`Created message ${createdMessage.id} with ${createdMessage.branches.length} branches`);
          
          // Store the message ID for future branch references
          if (originalUuid) {
            messageIdMap.set(originalUuid, createdMessage.id);
          }
          
          // Store this message as the target for future branches with same parent and role
          messagesByParentAndRole.set(messageKey, createdMessage.id);
          
          // Update parent for next message (use the created message's branch ID)
          const createdBranch = createdMessage.branches.find(b => b.id === createdMessage.activeBranchId);
          if (createdBranch) {
            parentBranchId = createdBranch.id;
            if (originalUuid) {
              branchIdMap.set(originalUuid, createdBranch.id);
            }
          }
        }
      }

      res.json({
        conversationId: conversation.id,
        messageCount: preview.messages.length
      });
    } catch (error) {
      console.error('Import execute error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: error.errors });
      }
      res.status(500).json({ error: error instanceof Error ? error.message : 'Import failed' });
    }
  });

  return router;
}
