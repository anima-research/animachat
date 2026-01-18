import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../middleware/auth.js';
import { Database } from '../database/index.js';
import { ImportParser } from '../services/importParser.js';
import { 
  ImportRequestSchema, 
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

      const { format, content, allowedParticipants } = req.body;
      
      if (!format || !content) {
        return res.status(400).json({ error: 'Format and content are required' });
      }

      // Pass allowedParticipants to parser for re-parsing with filtered participants
      const preview = await parser.parse(format as ImportFormat, content, {
        allowedParticipants: allowedParticipants as string[] | undefined
      });
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
      
      // Extract allowedParticipants from request body (not in schema, but passed for re-parsing)
      const allowedParticipants = req.body.allowedParticipants as string[] | undefined;
      
      // First, parse the content with participant filter if provided
      const preview = await parser.parse(importRequest.format, importRequest.content, {
        allowedParticipants
      });
      
      // Determine the model to use for the conversation
      // Priority: 1. Explicit model in request, 2. First assistant from arc_chat participants, 3. Default
      let conversationModel = importRequest.model;
      if (!conversationModel && importRequest.format === 'arc_chat' && preview.metadata?.participants) {
        const firstAssistant = preview.metadata.participants.find((p: any) => p.type === 'assistant');
        conversationModel = firstAssistant?.model;
      }
      // Fallback to a sensible default
      conversationModel = conversationModel || 'anthropic/claude-sonnet-4-20250514';
      
      // Create the conversation
      const conversation = await db.createConversation(
        req.userId,
        importRequest.title || preview.title || 'Imported Conversation',
        conversationModel,
        undefined, // System prompt will be set on participants
        undefined, // Settings will be set on participants
        importRequest.conversationFormat
      );

      // Get default participants
      const participants = await db.getConversationParticipants(conversation.id, conversation.userId);
      const participantMap = new Map<string, string>(); // sourceName -> participantId

      // Special handling for Arc Chat format - restore participants with settings
      if (importRequest.format === 'arc_chat' && preview.metadata?.participants) {
        console.log('Arc Chat import - exported participants:', preview.metadata.participants);
        
        // Get fresh list of default participants
        const defaultParticipants = await db.getConversationParticipants(conversation.id, conversation.userId);
        
        // Remove default assistant participants
        for (const p of defaultParticipants) {
          if (p.type === 'assistant') {
            await db.deleteParticipant(p.id, conversation.userId);
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
                await db.updateParticipant(userParticipant.id, conversation.userId, {
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
              conversation.userId,
              exportedParticipant.name,
              exportedParticipant.type,
              exportedParticipant.model
            );
            
            // Update with settings if present
            if (exportedParticipant.settings) {
              await db.updateParticipant(newParticipant.id, conversation.userId, {
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
              conversation.userId,
              mapping.targetName,
              mapping.type,
              mapping.type === 'assistant' ? conversationModel : undefined
            );
          }
          
          participantMap.set(mapping.sourceName, participant.id);
        }
      } else if (importRequest.conversationFormat === 'standard') {
        // For standard format, map common names to the actual participants
        const userParticipant = participants.find(p => p.type === 'user');
        const assistantParticipant = participants.find(p => p.type === 'assistant');
        
        if (userParticipant) {
          participantMap.set('User', userParticipant.id);
          participantMap.set('user', userParticipant.id);
        }
        if (assistantParticipant) {
          // Map common assistant names to the actual assistant participant
          participantMap.set('Assistant', assistantParticipant.id);
          participantMap.set('assistant', assistantParticipant.id);
          participantMap.set(assistantParticipant.name, assistantParticipant.id);
          // Also map common Claude variations
          participantMap.set('Claude', assistantParticipant.id);
          participantMap.set('claude', assistantParticipant.id);
        }
      }

      // Import messages with branch support
      const messageIdMap = new Map<string, string>(); // originalUuid -> createdMessageId  
      const branchIdMap = new Map<string, string>(); // originalUuid -> createdBranchId
      // Track messages by their parent and role to group branches correctly
      const messagesByParentAndRole = new Map<string, string>(); // "parentUuid:role" -> messageId
      
      console.log(`Importing ${preview.messages.length} messages to conversation ${conversation.id}`);
      
      // Special handling for Arc Chat format - filter out orphaned messages, import all legitimate content
      if (importRequest.format === 'arc_chat' && preview.metadata?.conversation) {
        const allExportedMessages = JSON.parse(importRequest.content).messages || [];
        const branchIdMapping = new Map<string, string>(); // old branch ID -> new branch ID
        
        console.log('Arc Chat import - participants map:', Array.from(participantMap.entries()));
        console.log(`Arc Chat import - total messages in export: ${allExportedMessages.length}`);
        
        // === FILTER OUT ORPHANED MESSAGES ===
        // An orphaned message is one whose activeBranch.parentBranchId points to a branch
        // that is NOT the activeBranchId of any message (i.e., was deleted but cascade failed)
        
        // Step 1: Build set of all "active" branch IDs
        const activeBranchIds = new Set<string>();
        for (const msg of allExportedMessages) {
          if (msg.activeBranchId) {
            activeBranchIds.add(msg.activeBranchId);
          }
        }
        console.log(`Arc Chat import - found ${activeBranchIds.size} active branch IDs`);
        
        // Step 2: Filter messages - keep only those whose parent is active (or is a root)
        const legitimateMessages = allExportedMessages.filter((msg: any) => {
          const activeBranch = msg.branches?.find((b: any) => b.id === msg.activeBranchId) || msg.branches?.[0];
          if (!activeBranch) {
            console.log(`Arc Chat import - ORPHAN (no active branch): ${msg.id?.slice(0, 8)}`);
            return false;
          }
          
          const parentBranchId = activeBranch.parentBranchId;
          
          // Root messages (no parent) are always legitimate
          if (!parentBranchId || parentBranchId === 'root') {
            return true;
          }
          
          // Check if parent branch is active in some message
          if (activeBranchIds.has(parentBranchId)) {
            return true;
          }
          
          // Parent exists but is not active - this is an orphan from failed cascade delete
          console.log(`Arc Chat import - ORPHAN (parent not active): ${msg.id?.slice(0, 8)}, parent: ${parentBranchId?.slice(0, 8)}`);
          return false;
        });
        
        const orphanCount = allExportedMessages.length - legitimateMessages.length;
        console.log(`Arc Chat import - filtered out ${orphanCount} orphaned messages, keeping ${legitimateMessages.length} legitimate`);
        
        // Use legitimate messages for import
        const exportedMessages = legitimateMessages;
        
        // Build a map of branch ID -> message index for dependency resolution
        const branchToMsgIndex = new Map<string, number>();
        for (let i = 0; i < exportedMessages.length; i++) {
          const msg = exportedMessages[i];
          for (const branch of (msg.branches || [])) {
            branchToMsgIndex.set(branch.id, i);
          }
        }
        
        // Topologically sort messages so parents are processed before children
        // This ensures branchIdMapping has parent IDs before children need them
        const sortedIndices: number[] = [];
        const visited = new Set<number>();
        const visiting = new Set<number>(); // For cycle detection
        
        function visit(msgIndex: number): void {
          if (visited.has(msgIndex)) return;
          if (visiting.has(msgIndex)) {
            console.warn(`Cycle detected at message index ${msgIndex}, breaking cycle`);
            return;
          }
          
          visiting.add(msgIndex);
          const msg = exportedMessages[msgIndex];
          
          // Visit all parents first
          for (const branch of (msg.branches || [])) {
            if (branch.parentBranchId && branch.parentBranchId !== 'root') {
              const parentMsgIndex = branchToMsgIndex.get(branch.parentBranchId);
              if (parentMsgIndex !== undefined && parentMsgIndex !== msgIndex) {
                visit(parentMsgIndex);
              }
            }
          }
          
          visiting.delete(msgIndex);
          visited.add(msgIndex);
          sortedIndices.push(msgIndex);
        }
        
        // Visit all messages
        for (let i = 0; i < exportedMessages.length; i++) {
          visit(i);
        }
        
        console.log(`Arc Chat import - sorted ${sortedIndices.length} messages for processing`);
        console.log(`First 5 original indices: ${[0,1,2,3,4].map(i => exportedMessages[i]?.order || 'N/A').join(', ')}`);
        console.log(`First 5 sorted indices: ${sortedIndices.slice(0,5).map(i => exportedMessages[i]?.order || 'N/A').join(', ')}`);
        
        // Process messages in topologically sorted order
        // Import ALL branches of each legitimate message (orphans were already filtered out)
        for (const msgIndex of sortedIndices) {
          const exportedMsg = exportedMessages[msgIndex];
          
          // Get the first branch to create the message
          const firstBranch = exportedMsg.branches?.[0];
          if (!firstBranch) {
            console.log(`Message ${msgIndex} has no branches, skipping`);
            continue;
          }
          
          // Determine participant for first branch
          let sourceName = firstBranch.participantName;
          if (!sourceName && firstBranch.participantId) {
            const participant = preview.metadata.participants?.find((p: any) => p.id === firstBranch.participantId);
            if (participant) {
              sourceName = participant.name;
            }
          }
          if (!sourceName) {
            sourceName = firstBranch.role === 'user' ? 'User' : 'Assistant';
          }
          
          const participantId = participantMap.get(sourceName);
          
          // Map parent branch ID from previous message
          let mappedParentBranchId = undefined;
          if (firstBranch.parentBranchId && branchIdMapping.has(firstBranch.parentBranchId)) {
            mappedParentBranchId = branchIdMapping.get(firstBranch.parentBranchId);
          }
          
          // Create the message with first branch
          const message = await db.createMessage(
            conversation.id,
            conversation.userId,
            firstBranch.content,
            firstBranch.role,
            firstBranch.model,
            mappedParentBranchId,
            participantId,
            firstBranch.attachments,
            undefined, // sentByUserId
            undefined, // hiddenFromAi
            'import'   // creationSource
          );
          
          // Map the first branch ID
          if (firstBranch.id && message.branches[0]) {
            branchIdMapping.set(firstBranch.id, message.branches[0].id);
          }
          
          // Track which branch is the active one
          let activeBranchIndex = 0;
          if (firstBranch.id === exportedMsg.activeBranchId) {
            activeBranchIndex = 0;
          }
          
          // Add remaining branches
          for (let i = 1; i < exportedMsg.branches.length; i++) {
            const branch = exportedMsg.branches[i];
            
            // Determine participant for this branch
            let branchParticipantName = branch.participantName;
            if (!branchParticipantName && branch.participantId) {
              const participant = preview.metadata.participants?.find((p: any) => p.id === branch.participantId);
              if (participant) {
                branchParticipantName = participant.name;
              }
            }
            if (!branchParticipantName) {
              branchParticipantName = branch.role === 'user' ? 'User' : 'Assistant';
            }
            
            const branchParticipantId = participantMap.get(branchParticipantName);
            
            // Map parent branch ID for this branch
            // Only map if parent is in our mapping - otherwise leave undefined (orphan within message)
            let branchParentId = undefined;
            if (branch.parentBranchId && branchIdMapping.has(branch.parentBranchId)) {
              branchParentId = branchIdMapping.get(branch.parentBranchId);
            }
            
            const updatedMessage = await db.addMessageBranch(
              message.id,
              message.conversationId,
              conversation.userId,
              branch.content,
              branch.role,
              branchParentId,
              branch.model,
              branchParticipantId,
              branch.attachments,
              undefined, // sentByUserId
              undefined, // hiddenFromAi
              false,     // preserveActiveBranch
              'import'   // creationSource
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
          
          // Set active branch if it's not the first one
          if (exportedMsg.activeBranchId && activeBranchIndex > 0) {
            const refetchedMessage = await db.getMessage(message.id, message.conversationId, conversation.userId);
            if (refetchedMessage && refetchedMessage.branches[activeBranchIndex]) {
              await db.setActiveBranch(message.id, message.conversationId, conversation.userId, refetchedMessage.branches[activeBranchIndex].id);
            }
          }
        }
        
        // Align active branch path for multi-root conversations
        // This ensures getVisibleMessages will find the canonical path correctly
        await db.alignActiveBranchPath(conversation.id, conversation.userId);
        
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
          
          const existingMessage = await db.getMessage(existingMessageId, conversation.id, conversation.userId);
          if (existingMessage) {
            // Find the parent branch from the previous message
            const parentBranch = existingMessage.branches[0]; // Use the first branch's parent
            const updatedMessage = await db.addMessageBranch(
              existingMessageId,
              existingMessage.conversationId,
              conversation.userId,
              parsedMsg.content,
              parsedMsg.role,
              parentBranch?.parentBranchId,  // Use same parent as the first branch
              parsedMsg.model,
              participantId,
              undefined, // attachments
              undefined, // sentByUserId
              undefined, // hiddenFromAi
              false,     // preserveActiveBranch
              'import'   // creationSource - imported data
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
                  await db.setActiveBranch(existingMessageId, conversation.id, conversation.userId, newBranch.id);
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
                const parentMessage = await db.getMessage(parentMessageId, conversation.id, conversation.userId);
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
            conversation.userId,
            parsedMsg.content,
            parsedMsg.role,
            parsedMsg.model,
            parentBranchId,
            participantId,
            undefined, // attachments
            undefined, // sentByUserId
            undefined, // hiddenFromAi
            'import'   // creationSource - imported data
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
          
          // Apply contentBlocks for extended thinking support
          // This allows imported conversations to have proper chain-of-thought
          const msgMetadata = (parsedMsg as any).metadata;
          if (createdBranch && msgMetadata?.contentBlocks && msgMetadata.contentBlocks.length > 0) {
            await db.updateMessageBranch(createdMessage.id, conversation.userId, createdBranch.id, {
              contentBlocks: msgMetadata.contentBlocks
            });
            console.log(`Applied ${msgMetadata.contentBlocks.length} contentBlocks to message ${createdMessage.id}`);
          }
          
          // Apply file attachments from metadata (e.g., from Cursor read_file)
          if (createdBranch && msgMetadata?.attachments && msgMetadata.attachments.length > 0) {
            const attachments = msgMetadata.attachments.map((att: any) => ({
              id: uuidv4(),
              fileName: att.fileName,
              fileSize: att.content?.length || 0,
              fileType: att.mimeType || 'text/plain',
              content: att.content,
              encoding: 'utf-8' as const,
              mimeType: att.mimeType || 'text/plain',
              createdAt: new Date()
            }));
            await db.updateMessageBranch(createdMessage.id, conversation.userId, createdBranch.id, {
              attachments
            });
            console.log(`Applied ${attachments.length} attachments to message ${createdMessage.id}`);
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
      const conversation = await db.getConversation(conversationId, req.userId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      if (conversation.userId !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Clear existing messages for this conversation
      const existingMessages = await db.getConversationMessages(conversationId, req.userId);
      console.log(`[Raw Import] Clearing ${existingMessages.length} existing messages`);
      for (const msg of existingMessages) {
        await db.deleteMessage(msg.id, conversation.id, conversation.userId);
      }

      // Import the new messages directly
      let importedCount = 0;
      for (const message of messages) {
        try {
          // Directly save the message with all its branches
          await db.importRawMessage(conversationId, conversation.userId, message);
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
