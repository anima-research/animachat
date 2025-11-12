import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Database } from '../database/index.js';
import { InferenceService } from '../services/inference.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Schema for the request
const GetPromptSchema = z.object({
  conversationId: z.string(),
  branchId: z.string(),
  includeSystemPrompt: z.boolean().optional().default(true)
});

export function createPromptRouter(db: Database): Router {
  const inferenceService = new InferenceService(db);

  // Get prompt for a specific message/branch
  router.post('/build', authenticateToken, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId; // authenticateToken sets userId directly on req
      const params = GetPromptSchema.parse(req.body);

      // Get the conversation
      const conversation = await db.getConversation(params.conversationId, userId);
      if (!conversation || conversation.userId !== userId) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Get all messages
      const allMessages = await db.getConversationMessages(params.conversationId, conversation.userId);
      
      // Build conversation history from the specified branch
      const history = buildConversationHistory(allMessages, params.branchId);
      
      // Get participants if in prefill mode
      let participants: any[] = [];
      let responderId: string | undefined;
      
      if (conversation.format === 'prefill') {
        participants = await db.getConversationParticipants(conversation.id, conversation.userId);
        
        // Find the next responder (assistant participant)
        const activeAssistants = participants.filter(p => p.type === 'assistant' && p.isActive);
        if (activeAssistants.length > 0) {
          // Use the first active assistant as responder
          responderId = activeAssistants[0].id;
        }
      }
      
      // Determine the model to use
      let modelId = conversation.model;
      if (responderId) {
        const responder = participants.find(p => p.id === responderId);
        if (responder?.model) {
          modelId = responder.model;
        }
      }
      
      // Build the prompt
      const promptData = await inferenceService.buildPrompt(
        modelId,
        history,
        params.includeSystemPrompt ? conversation.systemPrompt : undefined,
        conversation.format || 'standard',
        participants,
        responderId,
        conversation,
        userId
      );
      
      res.json({
        messages: promptData.messages,
        systemPrompt: promptData.systemPrompt,
        provider: promptData.provider,
        modelId: promptData.modelId,
        conversationFormat: conversation.format || 'standard',
        branchId: params.branchId,
        messageCount: history.length
      });
    } catch (error) {
      console.error('Error building prompt:', error);
      res.status(500).json({ error: 'Failed to build prompt' });
    }
  });

  return router;
}

/**
 * Build conversation history by following the active branch path backwards
 * (Same function as in websocket handler - could be moved to a shared utility)
 */
function buildConversationHistory(
  allMessages: any[],
  fromBranchId: string | undefined
): any[] {
  const history: any[] = [];
  
  // Build a map for quick lookup
  const messagesByBranchId = new Map<string, any>();
  for (const msg of allMessages) {
    for (const branch of msg.branches) {
      messagesByBranchId.set(branch.id, msg);
    }
  }
  
  // Start from the specified branch and work backwards
  let currentBranchId = fromBranchId;
  
  while (currentBranchId && currentBranchId !== 'root') {
    const message = messagesByBranchId.get(currentBranchId);
    if (!message) {
      console.log('[buildConversationHistory] Could not find message for branch:', currentBranchId);
      break;
    }
    
    // Add to beginning of history (we're building backwards)
    history.unshift(message);
    
    // Find the branch and get its parent
    const branch = message.branches.find((b: any) => b.id === currentBranchId);
    if (!branch) {
      console.log('[buildConversationHistory] Could not find branch:', currentBranchId);
      break;
    }
    
    currentBranchId = branch.parentBranchId;
  }
  
  return history;
}
