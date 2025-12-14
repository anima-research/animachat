import { Router } from 'express';
import { z } from 'zod';
import { Database } from '../database/index.js';
import { AuthRequest } from '../middleware/auth.js';
import { ContextManagementSchema, UpdateParticipantSchema } from '@deprecated-claude/shared';

const CreateParticipantSchema = z.object({
  conversationId: z.string().uuid(),
  name: z.string(), // Allow empty string for raw continuation mode
  type: z.enum(['user', 'assistant']),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  settings: z.object({
    temperature: z.number(),
    maxTokens: z.number(),
    topP: z.number().optional(),
    topK: z.number().optional()
  }).optional(),
  contextManagement: ContextManagementSchema.optional()
});

export function participantRouter(db: Database): Router {
  const router = Router();

  // Get participants for a conversation
  router.get('/conversation/:conversationId', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Verify conversation access (ownership or collaboration)
      const conversation = await db.getConversation(req.params.conversationId, req.userId);
      if (!conversation) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const participants = await db.getConversationParticipants(req.params.conversationId, conversation.userId);
      res.json(participants);
    } catch (error) {
      console.error('Get participants error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Create participant
  router.post('/', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = CreateParticipantSchema.parse(req.body);

      // Verify conversation ownership
      const conversation = await db.getConversation(data.conversationId, req.userId);
      if (!conversation || conversation.userId !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const participant = await db.createParticipant(
        data.conversationId,
        conversation.userId,
        data.name,
        data.type,
        data.model,
        data.systemPrompt,
        data.settings,
        data.contextManagement
      );

      res.json(participant);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Create participant error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Update participant
  router.patch('/:id', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = UpdateParticipantSchema.parse(req.body);

      // Get participant to verify conversation ownership
      const participant = await db.getParticipant(req.params.id, req.userId);
      if (!participant) {
        return res.status(404).json({ error: 'Participant not found' });
      }

      // Verify conversation ownership
      const conversation = await db.getConversation(participant.conversationId, req.userId);
      if (!conversation || conversation.userId !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const updated = await db.updateParticipant(req.params.id, conversation.userId, data);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Update participant error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Delete participant
  router.delete('/:id', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // For now, we'll need to implement a getParticipant method in the database
      // This is a temporary workaround - we should add getParticipant to Database class
      const success = await db.deleteParticipant(req.params.id, req.userId);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Participant not found or access denied' });
      }
    } catch (error) {
      console.error('Delete participant error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Assign participants to existing messages that don't have a participantId
  // Used when converting from standard format to group chat
  router.post('/conversation/:conversationId/assign-to-messages', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const conversation = await db.getConversation(req.params.conversationId, req.userId);
      if (!conversation) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get participants
      const participants = await db.getConversationParticipants(req.params.conversationId, conversation.userId);
      const userParticipant = participants.find(p => p.type === 'user');
      const assistantParticipant = participants.find(p => p.type === 'assistant');

      if (!userParticipant || !assistantParticipant) {
        return res.status(400).json({ error: 'Conversation needs at least one user and one assistant participant' });
      }

      // Get all messages
      const messages = await db.getConversationMessages(req.params.conversationId, conversation.userId);
      
      let updatedCount = 0;
      for (const message of messages) {
        for (const branch of message.branches) {
          // Only update branches that don't have a participantId
          if (!branch.participantId) {
            const targetParticipant = branch.role === 'user' ? userParticipant : assistantParticipant;
            await db.updateMessageBranch(message.id, conversation.userId, branch.id, { 
              participantId: targetParticipant.id 
            });
            updatedCount++;
          }
        }
      }

      console.log(`[assign-to-messages] Updated ${updatedCount} branches in conversation ${req.params.conversationId}`);
      res.json({ success: true, updatedCount });
    } catch (error) {
      console.error('Assign participants to messages error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
