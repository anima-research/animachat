import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { WsMessageSchema, WsMessage, Message } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { verifyToken } from '../middleware/auth.js';
import { InferenceService } from '../services/inference.js';
import { llmLogger } from '../utils/llmLogger.js';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  isAlive?: boolean;
}

export function websocketHandler(ws: AuthenticatedWebSocket, req: IncomingMessage, db: Database) {
  // Extract token from query params
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.send(JSON.stringify({ type: 'error', error: 'Authentication required' }));
    ws.close(1008, 'Authentication required');
    return;
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    ws.send(JSON.stringify({ type: 'error', error: 'Invalid token' }));
    ws.close(1008, 'Invalid token');
    return;
  }

  ws.userId = decoded.userId;
  ws.isAlive = true;

  // Setup heartbeat
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const inferenceService = new InferenceService(db);

  ws.on('message', async (data) => {
    try {
      const message = WsMessageSchema.parse(JSON.parse(data.toString()));
      
      if (!ws.userId) {
        ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
        return;
      }

      switch (message.type) {
        case 'chat':
          await handleChatMessage(ws, message, db, inferenceService);
          break;
          
        case 'regenerate':
          await handleRegenerate(ws, message, db, inferenceService);
          break;
          
        case 'edit':
          await handleEdit(ws, message, db, inferenceService);
          break;
          
        case 'delete':
          await handleDelete(ws, message, db);
          break;
          
        default:
          ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }));
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: error instanceof Error ? error.message : 'Internal server error' 
      }));
    }
  });

  ws.on('close', () => {
    console.log(`WebSocket closed for user ${ws.userId}`);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // Send initial connection success
  ws.send(JSON.stringify({ type: 'connected', userId: ws.userId }));
}

async function handleChatMessage(
  ws: AuthenticatedWebSocket,
  message: Extract<WsMessage, { type: 'chat' }>,
  db: Database,
  inferenceService: InferenceService
) {
  if (!ws.userId) return;

  // Verify conversation ownership
  const conversation = await db.getConversation(message.conversationId);
  if (!conversation || conversation.userId !== ws.userId) {
    ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found or access denied' }));
    return;
  }

  // Create user message with specified parent if provided
  console.log('Creating user message with parentBranchId:', message.parentBranchId);
  
  const userMessage = await db.createMessage(
    message.conversationId,
    message.content,
    'user',
    undefined, // model
    message.parentBranchId, // explicit parent
    message.participantId // participant ID
  );
  
  console.log('Created user message:', userMessage.id, 'with branch:', userMessage.branches[0]?.id, 'parent:', userMessage.branches[0]?.parentBranchId);

  // Send confirmation
  ws.send(JSON.stringify({
    type: 'message_created',
    message: userMessage
  }));

  // Get participants for the conversation
  const participants = await db.getConversationParticipants(message.conversationId);
  
  // Handle response generation based on conversation format
  let responder: typeof participants[0] | undefined;
  
  if (conversation.format === 'standard') {
    // For standard format, always use the default assistant
    responder = participants.find(p => p.type === 'assistant' && p.name === 'Assistant');
    if (!responder) {
      ws.send(JSON.stringify({ type: 'error', error: 'No assistant participant found' }));
      return;
    }
  } else {
    // For other formats, check if a responder was specified
    if (!message.responderId) {
      // No responder selected, just return
      return;
    }
    
    responder = participants.find(p => p.id === message.responderId);
    if (!responder || responder.type !== 'assistant') {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid responder' }));
      return;
    }
  }

  // Create assistant message placeholder with correct parent
  const userBranch = userMessage.branches[0];
  const assistantMessage = await db.createMessage(
    message.conversationId,
    '',
    'assistant',
    responder.model || conversation.model,
    userBranch?.id, // Parent is the user message branch we just created
    responder.id // Responder's participant ID
  );
  
  console.log('Created assistant message:', assistantMessage.id, 'with parent:', assistantMessage.branches[0]?.parentBranchId);

  // Send assistant message to frontend
  ws.send(JSON.stringify({
    type: 'message_created',
    message: assistantMessage
  }));

  // Get conversation history - build backwards from the user message
  const allMessages = await db.getConversationMessages(message.conversationId);
  const visibleHistory: Message[] = [];
  
  console.log('Building visible history backwards from parentBranchId:', message.parentBranchId);
  
  // Build a map for quick lookup
  const messagesByBranchId = new Map<string, Message>();
  for (const msg of allMessages) {
    for (const branch of msg.branches) {
      messagesByBranchId.set(branch.id, msg);
    }
  }
  
  // Start from the parent of the new user message and work backwards
  let currentParentBranchId = message.parentBranchId;
  
  while (currentParentBranchId && currentParentBranchId !== 'root') {
    const parentMessage = messagesByBranchId.get(currentParentBranchId);
    if (!parentMessage) {
      console.log('Could not find message for branch:', currentParentBranchId);
      break;
    }
    
    // Add to beginning of history (we're building backwards)
    visibleHistory.unshift(parentMessage);
    const role = parentMessage.branches.find(b => b.id === currentParentBranchId)?.role || 'unknown';
    console.log('Added to visible history:', parentMessage.id, 'role:', role);
    
    // Find the branch and get its parent
    const branch = parentMessage.branches.find(b => b.id === currentParentBranchId);
    if (!branch) {
      console.log('Could not find branch:', currentParentBranchId, 'in message:', parentMessage.id);
      break;
    }
    
    currentParentBranchId = branch.parentBranchId;
  }
  
  // Add the new user message at the end
  visibleHistory.push(userMessage);
  console.log('Final visible history length:', visibleHistory.length);
  
  // Stream response from appropriate service
  try {
    const inferenceModel = responder.model || conversation.model;
    const inferenceSystemPrompt = responder.systemPrompt || conversation.systemPrompt;
    const inferenceSettings = responder.settings || conversation.settings;
    
    // Log WebSocket event
    await llmLogger.logWebSocketEvent({
      event: 'chat_message',
      conversationId: conversation.id,
      messageId: message.messageId,
      participantId: message.participantId,
      responderId: responder.id,
      model: inferenceModel,
      settings: inferenceSettings,
      format: conversation.format
    });
    
    await inferenceService.streamCompletion(
      inferenceModel,
      visibleHistory,
      inferenceSystemPrompt,
      inferenceSettings,
      ws.userId,
      async (chunk: string, isComplete: boolean) => {
        // Update message content in memory (mutation is OK during streaming)
        const currentBranch = assistantMessage.branches.find(b => b.id === assistantMessage.activeBranchId);
        if (currentBranch) {
          currentBranch.content += chunk;
        }

        // Send stream update
        ws.send(JSON.stringify({
          type: 'stream',
          messageId: assistantMessage.id,
          branchId: assistantMessage.activeBranchId,
          content: chunk,
          isComplete
        }));

        if (isComplete && currentBranch) {
          // Persist the complete content to disk only when done
          await db.updateMessageContent(
            assistantMessage.id,
            assistantMessage.activeBranchId,
            currentBranch.content
          );
          
          // Update conversation timestamp
          await db.updateConversation(conversation.id, { updatedAt: new Date() });
        }
      },
      conversation.format || 'standard',
      participants,
      responder.id
    );
  } catch (error) {
    console.error('Inference streaming error:', error);
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Failed to generate response'
    }));
  }
}

async function handleRegenerate(
  ws: AuthenticatedWebSocket,
  message: Extract<WsMessage, { type: 'regenerate' }>,
  db: Database,
  inferenceService: InferenceService
) {
  if (!ws.userId) return;

  const msg = await db.getMessage(message.messageId);
  if (!msg) {
    ws.send(JSON.stringify({ type: 'error', error: 'Message not found' }));
    return;
  }

  const conversation = await db.getConversation(msg.conversationId);
  if (!conversation || conversation.userId !== ws.userId) {
    ws.send(JSON.stringify({ type: 'error', error: 'Access denied' }));
    return;
  }

  // Find the parent branch (the user message branch that this is responding to)
  const allMessages = await db.getConversationMessages(msg.conversationId);
  const targetMessageIndex = allMessages.findIndex(m => m.id === message.messageId);
  const parentUserMessage = targetMessageIndex > 0 ? allMessages[targetMessageIndex - 1] : null;
  const parentUserBranch = parentUserMessage ? parentUserMessage.branches.find(b => b.id === parentUserMessage.activeBranchId) : null;

  // Get the participant ID from the branch we're regenerating
  const originalBranch = msg.branches.find(b => b.id === message.branchId);
  const participantId = originalBranch?.participantId;
  
  // Create new branch
  const updatedMessage = await db.addMessageBranch(
    message.messageId,
    '',
    'assistant',
    parentUserBranch?.id || message.branchId,
    conversation.model,
    participantId
  );

  if (!updatedMessage) {
    ws.send(JSON.stringify({ type: 'error', error: 'Failed to create branch' }));
    return;
  }

  // Send the updated message with the new branch to the frontend
  ws.send(JSON.stringify({
    type: 'message_edited',
    message: updatedMessage
  }));

  // Get conversation history up to this message
  const historyMessages = allMessages.slice(0, targetMessageIndex);

  // Get participants for the conversation
  const participants = await db.getConversationParticipants(conversation.id);
  
  // Determine the responder ID for streaming
  let responderId = participantId;
  if (conversation.format === 'standard') {
    // For standard format, always use the default assistant
    const defaultAssistant = participants.find(p => p.type === 'assistant' && p.name === 'Assistant');
    responderId = defaultAssistant?.id;
  }
  
  // Get the participant who should respond
  let responderSettings = conversation.settings;
  let responderSystemPrompt = conversation.systemPrompt;
  let responderModel = conversation.model;
  
  if (participantId && participants.length > 0) {
    const participant = participants.find(p => p.id === participantId);
    if (participant) {
      responderModel = participant.model || conversation.model;
      responderSystemPrompt = participant.systemPrompt || conversation.systemPrompt;
      responderSettings = participant.settings || conversation.settings;
    }
  }
  
  // Stream new response
  try {
    // Log WebSocket event
    await llmLogger.logWebSocketEvent({
      event: 'regenerate_message',
      conversationId: conversation.id,
      messageId: message.messageId,
      responderId: responderId,
      model: responderModel,
      settings: responderSettings,
      format: conversation.format
    });
    
    await inferenceService.streamCompletion(
      responderModel,
      historyMessages,
      responderSystemPrompt,
      responderSettings,
      ws.userId,
      async (chunk: string, isComplete: boolean) => {
        const currentBranch = updatedMessage.branches.find(b => b.id === updatedMessage.activeBranchId);
        if (currentBranch) {
          currentBranch.content += chunk;
        }

        ws.send(JSON.stringify({
          type: 'stream',
          messageId: updatedMessage.id,
          branchId: updatedMessage.activeBranchId,
          content: chunk,
          isComplete
        }));

        if (isComplete && currentBranch) {
          // Persist the complete content to disk only when done
          await db.updateMessageContent(
            updatedMessage.id,
            updatedMessage.activeBranchId,
            currentBranch.content
          );
        }
      },
      conversation.format || 'standard',
      participants,
      responderId
    );
  } catch (error) {
    console.error('Regeneration error:', error);
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Failed to regenerate response'
    }));
  }
}

async function handleEdit(
  ws: AuthenticatedWebSocket,
  message: Extract<WsMessage, { type: 'edit' }>,
  db: Database,
  inferenceService: InferenceService
) {
  if (!ws.userId) return;

  const msg = await db.getMessage(message.messageId);
  if (!msg) {
    ws.send(JSON.stringify({ type: 'error', error: 'Message not found' }));
    return;
  }

  const conversation = await db.getConversation(msg.conversationId);
  if (!conversation || conversation.userId !== ws.userId) {
    ws.send(JSON.stringify({ type: 'error', error: 'Access denied' }));
    return;
  }

  // Find the branch to determine role
  const branch = msg.branches.find(b => b.id === message.branchId);
  if (!branch) {
    ws.send(JSON.stringify({ type: 'error', error: 'Branch not found' }));
    return;
  }

  // Create new branch with edited content
  // The parent should be the same as the original branch's parent (the previous message)
  const updatedMessage = await db.addMessageBranch(
    message.messageId,
    message.content,
    branch.role,
    branch.parentBranchId, // Use the same parent as the original branch
    branch.model,
    branch.participantId // Keep the same participant
  );

  if (!updatedMessage) {
    ws.send(JSON.stringify({ type: 'error', error: 'Failed to create edited branch' }));
    return;
  }

  ws.send(JSON.stringify({
    type: 'message_edited',
    message: updatedMessage
  }));

  // If this was a user message, automatically generate an assistant response
  if (branch.role === 'user') {
    // Get all messages to find the position of the edited message
    const allMessages = await db.getConversationMessages(msg.conversationId);
    const editedMessageIndex = allMessages.findIndex(m => m.id === msg.id);
    
    // Get participants early to determine responderId
    const participants = await db.getConversationParticipants(conversation.id);
    
    // Determine which assistant should respond
    let responderId: string | undefined;
    if (conversation.format === 'standard') {
      // For standard format, always use the default assistant
      const defaultAssistant = participants.find(p => p.type === 'assistant' && p.name === 'Assistant');
      responderId = defaultAssistant?.id;
    } else {
      // For other formats, use the first active assistant
      const defaultAssistant = participants.find(p => p.type === 'assistant' && p.isActive);
      responderId = defaultAssistant?.id;
    }
    
    // Check if there's already an assistant message after this user message
    const nextMessage = editedMessageIndex + 1 < allMessages.length ? allMessages[editedMessageIndex + 1] : null;
    
    let assistantMessage: Message;
    
    if (nextMessage && nextMessage.branches.some(b => b.role === 'assistant')) {
      // Add a new branch to the existing assistant message
      const newBranch = await db.addMessageBranch(
        nextMessage.id,
        '',
        'assistant',
        updatedMessage.activeBranchId, // Parent is the edited user message's active branch
        conversation.model,
        responderId // Assistant participant ID
      );
      
      if (!newBranch) {
        ws.send(JSON.stringify({ type: 'error', error: 'Failed to create assistant branch' }));
        return;
      }
      
      assistantMessage = newBranch;
      
      // Send the updated message with new branch
      ws.send(JSON.stringify({
        type: 'message_edited',
        message: assistantMessage
      }));
    } else {
      // No assistant message exists after this user message, create a new one
      // But we need to manually set the parentBranchId
      assistantMessage = await db.createMessage(
        msg.conversationId,
        '',
        'assistant',
        conversation.model,
        updatedMessage.activeBranchId, // Parent is the edited user message's active branch
        responderId // Assistant participant ID
      );
      
      // Send assistant message to frontend
      ws.send(JSON.stringify({
        type: 'message_created',
        message: assistantMessage
      }));
    }
    
    // Get conversation history up to and including the edited message
    const historyMessages = allMessages.slice(0, editedMessageIndex + 1);
    
    // Make sure we're using the edited branch for the user message in history
    if (historyMessages[editedMessageIndex]) {
      historyMessages[editedMessageIndex] = updatedMessage;
    }
    
    // Get the responder's settings
    let responderSettings = conversation.settings;
    let responderSystemPrompt = conversation.systemPrompt;
    let responderModel = conversation.model;
    
    if (responderId && participants.length > 0) {
      const responder = participants.find(p => p.id === responderId);
      if (responder) {
        responderModel = responder.model || conversation.model;
        responderSystemPrompt = responder.systemPrompt || conversation.systemPrompt;
        responderSettings = responder.settings || conversation.settings;
      }
    }
    
    // Stream response
    try {
      const targetMessage = assistantMessage;
      const targetBranchId = targetMessage.activeBranchId;
      
      // Log WebSocket event
      await llmLogger.logWebSocketEvent({
        event: 'edit_message',
        conversationId: conversation.id,
        messageId: message.messageId,
        responderId: responderId,
        model: responderModel,
        settings: responderSettings,
        format: conversation.format
      });
      
      await inferenceService.streamCompletion(
        responderModel,
        historyMessages,
        responderSystemPrompt,
        responderSettings,
        ws.userId,
        async (chunk: string, isComplete: boolean) => {
          const currentBranch = targetMessage.branches.find(b => b.id === targetBranchId);
          if (currentBranch) {
            currentBranch.content += chunk;
          }

          ws.send(JSON.stringify({
            type: 'stream',
            messageId: targetMessage.id,
            branchId: targetBranchId,
            content: chunk,
            isComplete
          }));

          if (isComplete && currentBranch) {
            // Persist the complete content to disk only when done
            await db.updateMessageContent(
              targetMessage.id,
              targetBranchId,
              currentBranch.content
            );
          }
        },
        conversation.format || 'standard',
        participants,
        responderId
      );
    } catch (error) {
      console.error('Error generating response to edited message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Failed to generate response'
      }));
    }
  }
}

async function handleDelete(
  ws: AuthenticatedWebSocket,
  message: Extract<WsMessage, { type: 'delete' }>,
  db: Database
) {
  try {
    const { conversationId, messageId, branchId } = message;
    
    // Get the message to verify ownership
    const conversation = await db.getConversation(conversationId);
    if (!conversation || conversation.userId !== ws.userId) {
      ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found or access denied' }));
      return;
    }
    
    // Delete the message branch and all its descendants
    const deleted = await db.deleteMessageBranch(messageId, branchId);
    
    if (deleted) {
      ws.send(JSON.stringify({
        type: 'message_deleted',
        messageId,
        branchId,
        deletedMessages: deleted
      }));
    } else {
      ws.send(JSON.stringify({ type: 'error', error: 'Failed to delete message' }));
    }
  } catch (error) {
    console.error('Delete message error:', error);
    ws.send(JSON.stringify({ type: 'error', error: 'Failed to delete message' }));
  }
}

// Heartbeat interval to keep connections alive
setInterval(() => {
  // This would need to be implemented with a WebSocket server instance
  // to track all connections
}, 30000);
