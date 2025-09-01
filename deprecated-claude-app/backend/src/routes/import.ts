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

      // Special handling for Arc Chat format - restore participants with settings
      if (importRequest.format === 'arc_chat' && preview.metadata?.participants) {
        console.log('Arc Chat import - exported participants:', preview.metadata.participants);
        
        // Get fresh list of default participants
        const defaultParticipants = await db.getConversationParticipants(conversation.id);
        
        // Remove default assistant participants
        for (const p of defaultParticipants) {
          if (p.type === 'assistant') {
            await db.deleteParticipant(p.id);
          }
        }
        
        // Recreate participants from export
        for (const exportedParticipant of preview.metadata.participants) {
          if (exportedParticipant.type === 'user') {
            // Map to existing user participant
            const userParticipant = defaultParticipants.find(p => p.type === 'user');
            if (userParticipant) {
              // Update the user participant's name if needed
              if (exportedParticipant.name !== userParticipant.name) {
                await db.updateParticipant(userParticipant.id, {
                  name: exportedParticipant.name
                });
              }
              participantMap.set(exportedParticipant.name, userParticipant.id);
              console.log(`Mapped user participant: ${exportedParticipant.name} -> ${userParticipant.id}`);
            }
          } else {
            // Create assistant participant with settings
            const newParticipant = await db.createParticipant(
              conversation.id,
              exportedParticipant.name,
              exportedParticipant.type,
              exportedParticipant.model
            );
            
            // Update with settings if present
            if (exportedParticipant.settings) {
              await db.updateParticipant(newParticipant.id, {
                settings: exportedParticipant.settings
              });
            }
            
            participantMap.set(exportedParticipant.name, newParticipant.id);
            console.log(`Created assistant participant: ${exportedParticipant.name} -> ${newParticipant.id}`);
          }
        }
      }
      // If mappings provided, create/update participants
      else if (importRequest.participantMappings && importRequest.participantMappings.length > 0) {
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
      const messageIdMap = new Map<string, string>(); // originalUuid -> createdMessageId  
      const branchIdMap = new Map<string, string>(); // originalUuid -> createdBranchId
      // Track messages by their parent and role to group branches correctly
      const messagesByParentAndRole = new Map<string, string>(); // "parentUuid:role" -> messageId
      
      console.log(`Importing ${preview.messages.length} messages to conversation ${conversation.id}`);
      
      // Special handling for Arc Chat format - recreate full branch structure
      if (importRequest.format === 'arc_chat' && preview.metadata?.conversation) {
        const exportedMessages = JSON.parse(importRequest.content).messages || [];
        const branchIdMapping = new Map<string, string>(); // old branch ID -> new branch ID
        
        console.log('Arc Chat import - participants map:', Array.from(participantMap.entries()));
        console.log(`Arc Chat import - processing ${exportedMessages.length} messages`);
        
        // Process messages in order to maintain parent-child relationships
        for (let msgIndex = 0; msgIndex < exportedMessages.length; msgIndex++) {
          const exportedMsg = exportedMessages[msgIndex];
          
          // Create message with all branches
          const firstBranch = exportedMsg.branches?.[0];
          if (!firstBranch) {
            console.log(`Message ${msgIndex} has no branches, skipping`);
            continue;
          }
          
          // Determine participant for first branch
          let sourceName = firstBranch.participantName;
          
          // If no participant name in branch, try to find from participant ID
          if (!sourceName && firstBranch.participantId) {
            const participant = preview.metadata.participants?.find((p: any) => p.id === firstBranch.participantId);
            if (participant) {
              sourceName = participant.name;
            }
          }
          
          // Fallback to default names
          if (!sourceName) {
            sourceName = firstBranch.role === 'user' ? 'User' : 'Assistant';
          }
          
          const participantId = participantMap.get(sourceName);
          console.log(`Message ${msgIndex}: role=${firstBranch.role}, participant=${sourceName}, participantId=${participantId}`);
          
          // Map parent branch ID from previous message
          let mappedParentBranchId = undefined;
          if (firstBranch.parentBranchId && branchIdMapping.has(firstBranch.parentBranchId)) {
            mappedParentBranchId = branchIdMapping.get(firstBranch.parentBranchId);
          }
          
          // Create the message with first branch
          const message = await db.createMessage(
            conversation.id,
            firstBranch.content,
            firstBranch.role, // Use role from the branch
            firstBranch.model,
            mappedParentBranchId,
            participantId,
            firstBranch.attachments
          );
          
          // Map the first branch ID
          if (firstBranch.id && message.branches[0]) {
            branchIdMapping.set(firstBranch.id, message.branches[0].id);
          }
          
          // Track which branch index corresponds to the active branch
          let activeBranchIndex = 0;
          
          // Add remaining branches
          for (let i = 1; i < exportedMsg.branches.length; i++) {
            const branch = exportedMsg.branches[i];
            
            // Determine participant for this branch
            let branchParticipantName = branch.participantName;
            
            // If no participant name in branch, try to find from participant ID
            if (!branchParticipantName && branch.participantId) {
              const participant = preview.metadata.participants?.find((p: any) => p.id === branch.participantId);
              if (participant) {
                branchParticipantName = participant.name;
              }
            }
            
            // Fallback to default names
            if (!branchParticipantName) {
              branchParticipantName = branch.role === 'user' ? 'User' : 'Assistant';
            }
            
            const branchParticipantId = participantMap.get(branchParticipantName);
            
            // Map parent branch ID for this branch
            let branchParentId = undefined;
            if (branch.parentBranchId && branchIdMapping.has(branch.parentBranchId)) {
              branchParentId = branchIdMapping.get(branch.parentBranchId);
            } else if (mappedParentBranchId) {
              // Use the same parent as the first branch if not specified
              branchParentId = mappedParentBranchId;
            }
            
            const updatedMessage = await db.addMessageBranch(
              message.id,
              branch.content,
              branch.role, // Use role from the branch
              branchParentId,
              branch.model,
              branchParticipantId,
              branch.attachments
            );
            
            // Map this branch ID
            if (branch.id && updatedMessage) {
              const newBranch = updatedMessage.branches[updatedMessage.branches.length - 1];
              if (newBranch) {
                branchIdMapping.set(branch.id, newBranch.id);
                
                // Check if this is the active branch
                if (branch.id === exportedMsg.activeBranchId) {
                  activeBranchIndex = i;
                }
              }
            }
          }
          
          // Set active branch if different from default
          if (exportedMsg.activeBranchId && activeBranchIndex > 0) {
            const refetchedMessage = await db.getMessageById(message.id);
            if (refetchedMessage && refetchedMessage.branches[activeBranchIndex]) {
              await db.setActiveBranch(message.id, refetchedMessage.branches[activeBranchIndex].id);
            }
          }
        }
        
        res.json({ conversationId: conversation.id });
        return;
      }
      
      console.log('Messages with branch info:', preview.messages.map((m: any) => ({
        uuid: m.__uuid,
        parent: m.__parentUuid,
        isBranch: !!m.__branchInfo?.isAlternative,
        role: m.role,
        content: m.content.substring(0, 30) + '...'
      })));
      
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
                }
              }
            }
          }
        } else {
          // Regular message - determine its parent based on the previous message's UUID
          let parentBranchId: string | undefined;
          
          if (parentUuid && parentUuid !== '00000000-0000-4000-8000-000000000000') {
            // Look up the parent branch ID from our mappings
            parentBranchId = branchIdMap.get(parentUuid);
            if (!parentBranchId) {
              // If parent UUID is not in branch map, it might be a message ID
              const parentMessageId = messageIdMap.get(parentUuid);
              if (parentMessageId) {
                // Get the active branch of that message
                const parentMessage = await db.getMessageById(parentMessageId);
                if (parentMessage) {
                  const activeBranch = parentMessage.branches.find(b => b.id === parentMessage.activeBranchId);
                  if (activeBranch) {
                    parentBranchId = activeBranch.id;
                  }
                }
              }
            }
          }
          
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
          
          // Store the branch ID of the created message for children to reference
          const createdBranch = createdMessage.branches.find(b => b.id === createdMessage.activeBranchId);
          if (createdBranch && originalUuid) {
            branchIdMap.set(originalUuid, createdBranch.id);
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

  // Import raw messages format (as returned by the messages API)
  router.post('/messages-raw', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { conversationId, messages } = req.body;
      if (!conversationId || !messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Invalid data format. Expected conversationId and messages array.' });
      }

      // Check if conversation exists and belongs to user
      const conversation = await db.getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      if (conversation.userId !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Clear existing messages for this conversation
      const existingMessages = await db.getConversationMessages(conversationId);
      console.log(`[Raw Import] Clearing ${existingMessages.length} existing messages`);
      for (const msg of existingMessages) {
        await db.deleteMessage(msg.id);
      }

      // Import the new messages directly
      let importedCount = 0;
      for (const message of messages) {
        try {
          // Directly save the message with all its branches
          await db.importRawMessage(conversationId, message);
          importedCount++;
        } catch (error) {
          console.error(`Failed to import message ${message.id}:`, error);
        }
      }

      console.log(`[Raw Import] Imported ${importedCount} messages`);

      res.json({ 
        success: true, 
        importedMessages: importedCount,
        conversationId 
      });
    } catch (error) {
      console.error('Raw messages import error:', error);
      res.status(500).json({ error: 'Failed to import messages' });
    }
  });

  return router;
}
