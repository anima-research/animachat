import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { WsMessageSchema, WsMessage, Message, Participant } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { verifyToken } from '../middleware/auth.js';
import { InferenceService } from '../services/inference.js';
import { EnhancedInferenceService } from '../services/enhanced-inference.js';
import { ContextManager } from '../services/context-manager.js';
import { llmLogger } from '../utils/llmLogger.js';
import { ModelLoader } from '../config/model-loader.js';

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

  const baseInferenceService = new InferenceService(db);
  const contextManager = new ContextManager();
  const inferenceService = new EnhancedInferenceService(baseInferenceService, contextManager);

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
          
        case 'continue':
          await handleContinue(ws, message, db, inferenceService);
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

  ws.on('close', async () => {
    console.log(`WebSocket closed for user ${ws.userId}`);
    
    // Clean up any incomplete streaming messages
    // This is handled by the streaming service, but we should log it
    if (ws.userId) {
      console.log(`User ${ws.userId} disconnected - any in-progress streams will be saved`);
    }
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
  inferenceService: EnhancedInferenceService
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
  console.log('Received attachments:', message.attachments?.length || 0);
  console.log('Message object keys:', Object.keys(message));
  
  // Process attachments if provided
  const attachments = message.attachments?.map(att => ({
    fileName: att.fileName,
    fileType: att.fileType,
    content: att.content,
    fileSize: att.content.length
  }));
  
  if (attachments && attachments.length > 0) {
    console.log('Processing attachments:', attachments.map(a => ({ fileName: a.fileName, size: a.fileSize })));
  }
  
  // Check if we should add to an existing message or create a new one
  let userMessage: any;
  
  if (message.parentBranchId) {
    // Check if this parent branch has siblings (i.e., we're branching from within history)
    const allMessages = await db.getConversationMessages(message.conversationId);
    const messageWithSiblings = allMessages.find(msg => 
      msg.branches.some(b => b.parentBranchId === message.parentBranchId)
    );
    
    if (messageWithSiblings) {
      // Add as a new branch to the existing message that contains siblings
      console.log('Adding branch to existing message:', messageWithSiblings.id);
      userMessage = await db.addMessageBranch(
        messageWithSiblings.id,
        message.content,
        'user',
        message.parentBranchId,
        undefined, // model
        message.participantId,
        attachments
      );
    } else {
      // No siblings exist yet, create a new message
      console.log('Creating new message (no siblings found)');
      userMessage = await db.createMessage(
        message.conversationId,
        message.content,
        'user',
        undefined, // model
        message.parentBranchId,
        message.participantId,
        attachments
      );
    }
  } else {
    // No parent specified, create new message as usual
    userMessage = await db.createMessage(
      message.conversationId,
      message.content,
      'user',
      undefined, // model
      message.parentBranchId,
      message.participantId,
      attachments
    );
  }
  
  console.log('Created/updated user message:', userMessage.id, 'with branch:', userMessage.branches[userMessage.branches.length - 1]?.id);
  console.log('User message has attachments?', userMessage.branches[userMessage.branches.length - 1]?.attachments?.length || 0);

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
    // For standard format, use the assistant participant (there should only be one)
    responder = participants.find(p => p.type === 'assistant');
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
  const userBranch = userMessage.branches[userMessage.branches.length - 1]; // Get the last branch (the one we just added)
  
  // Check if we should add to an existing message or create a new one
  let assistantMessage: Message | null;
  const allMessagesForAssistant = await db.getConversationMessages(message.conversationId);
  const messageWithAssistantSiblings = allMessagesForAssistant.find(msg => 
    msg.branches.some(b => b.parentBranchId === userBranch?.id)
  );
  
  if (messageWithAssistantSiblings) {
    // Add as a new branch to the existing message
    console.log('Adding assistant branch to existing message:', messageWithAssistantSiblings.id);
    assistantMessage = await db.addMessageBranch(
      messageWithAssistantSiblings.id,
      '',
      'assistant',
      userBranch?.id,
      responder.model || conversation.model,
      responder.id,
      undefined // no attachments for assistant
    );
  } else {
    // No siblings exist yet, create a new message
    assistantMessage = await db.createMessage(
      message.conversationId,
      '',
      'assistant',
      responder.model || conversation.model,
      userBranch?.id,
      responder.id
    );
  }
  
  if (!assistantMessage) {
    console.error('Failed to create assistant message');
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Failed to create assistant message'
    }));
    return;
  }
  
  const assistantBranch = assistantMessage.branches[assistantMessage.branches.length - 1]; // Get the last branch we added
  console.log('Created/updated assistant message:', assistantMessage.id, 'with branch:', assistantBranch?.id);

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
    // console.log('Added to visible history:', parentMessage.id, 'role:', role);
    
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
  
  // For prefill format, we need to include the empty assistant message too
  // so that formatMessagesForConversation knows to append the assistant's name
  const messagesForInference = conversation.format === 'prefill' 
    ? [...visibleHistory, assistantMessage]
    : visibleHistory;
  
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
    
    const modelLoader = ModelLoader.getInstance();
    const modelConfig = await modelLoader.getModelById(inferenceModel);
    if (!modelConfig) {
      throw new Error(`Model ${inferenceModel} not found`);
    }
    
    await inferenceService.streamCompletion(
      modelConfig,
      messagesForInference,
      inferenceSystemPrompt || '',
      inferenceSettings,
      ws.userId,
      async (chunk: string, isComplete: boolean) => {
        // Update message content in memory (mutation is OK during streaming)
        const currentBranch = assistantMessage.branches.find((b: any) => b.id === assistantMessage.activeBranchId);
        if (currentBranch) {
          currentBranch.content += chunk;
          
          // Save partial content every 500 characters to prevent data loss on interruption
          if (currentBranch.content.length % 500 === 0 || isComplete) {
            await db.updateMessageContent(
              assistantMessage.id,
              assistantMessage.activeBranchId,
              currentBranch.content
            );
          }
        }

        // Send stream update
        ws.send(JSON.stringify({
          type: 'stream',
          messageId: assistantMessage.id,
          branchId: assistantMessage.activeBranchId,
          content: chunk,
          isComplete
        }));

        if (isComplete) {
          // Final save and update conversation timestamp
          if (currentBranch) {
            await db.updateMessageContent(
              assistantMessage.id,
              assistantMessage.activeBranchId,
              currentBranch.content
            );
          }
          
          // Update conversation timestamp
          await db.updateConversation(conversation.id, { updatedAt: new Date() });
        }
      },
      conversation,
      responder,
      async (metrics) => {
        // Store metrics in database
        await db.addMetrics(conversation.id, metrics);
        
        // Send metrics update to client
        ws.send(JSON.stringify({
          type: 'metrics_update',
          conversationId: conversation.id,
          metrics
        }));
      },
      participants
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
  inferenceService: EnhancedInferenceService
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

  // Get the participant ID and parent branch from the branch we're regenerating
  const originalBranch = msg.branches.find(b => b.id === message.branchId);
  const participantId = originalBranch?.participantId;
  
  // IMPORTANT: Use the original branch's parentBranchId, not the branch itself
  // This ensures all regenerated branches have the same parent (the user message branch)
  const correctParentBranchId = originalBranch?.parentBranchId || parentUserBranch?.id || 'root';
  
  console.log('[Regenerate] Message:', message.messageId, 'Branch:', message.branchId);
  console.log('[Regenerate] Original branch parent:', originalBranch?.parentBranchId);
  console.log('[Regenerate] Using parent branch:', correctParentBranchId);
  
  // Get the participant's model if in prefill mode
  let regenerateModel = conversation.model;
  if (conversation.format === 'prefill' && participantId) {
    const participants = await db.getConversationParticipants(conversation.id);
    const participant = participants.find(p => p.id === participantId);
    if (participant && participant.model) {
      regenerateModel = participant.model;
    }
  }
  
  // Create new branch with correct parent and model
  const updatedMessage = await db.addMessageBranch(
    message.messageId,
    '',
    'assistant',
    correctParentBranchId,
    regenerateModel,
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

  // Get conversation history - build backwards from the parent branch
  const visibleHistory: Message[] = [];
  
  // Build a map for quick lookup
  const messagesByBranchId = new Map<string, Message>();
  for (const msg of allMessages) {
    for (const branch of msg.branches) {
      messagesByBranchId.set(branch.id, msg);
    }
  }
  
  // Start from the parent of the message being regenerated and work backwards
  let currentParentBranchId: string | undefined = correctParentBranchId;
  
  while (currentParentBranchId && currentParentBranchId !== 'root') {
    const parentMessage = messagesByBranchId.get(currentParentBranchId);
    if (!parentMessage) {
      console.log('Regenerate: Could not find message for branch:', currentParentBranchId);
      break;
    }
    
    // Add to beginning of history (we're building backwards)
    visibleHistory.unshift(parentMessage);
    
    // Find the branch and get its parent
    const branch = parentMessage.branches.find(b => b.id === currentParentBranchId);
    if (!branch) {
      console.log('Regenerate: Could not find branch:', currentParentBranchId);
      break;
    }
    
    currentParentBranchId = branch.parentBranchId;
  }
  
  const historyMessages = visibleHistory;

  // Get participants for the conversation
  const participants = await db.getConversationParticipants(conversation.id);
  
  // Determine the responder ID for streaming
  let responderId = participantId;
  if (conversation.format === 'standard') {
    // For standard format, use the assistant participant (there should only be one)
    const defaultAssistant = participants.find(p => p.type === 'assistant');
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
    
    const modelLoader = ModelLoader.getInstance();
    const modelConfig = await modelLoader.getModelById(responderModel);
    if (!modelConfig) {
      throw new Error(`Model ${responderModel} not found`);
    }
    
    // Get the responder participant object
    const responderParticipant = responderId ? participants.find(p => p.id === responderId) : undefined;
    
    await inferenceService.streamCompletion(
      modelConfig,
      historyMessages,
      responderSystemPrompt || '',
      responderSettings,
      ws.userId,
      async (chunk: string, isComplete: boolean) => {
        const currentBranch = updatedMessage.branches.find(b => b.id === updatedMessage.activeBranchId);
        if (currentBranch) {
          currentBranch.content += chunk;
          
          // Save partial content periodically to prevent data loss
          if (currentBranch.content.length % 500 === 0 || isComplete) {
            await db.updateMessageContent(
              updatedMessage.id,
              updatedMessage.activeBranchId,
              currentBranch.content
            );
          }
        }

        ws.send(JSON.stringify({
          type: 'stream',
          messageId: updatedMessage.id,
          branchId: updatedMessage.activeBranchId,
          content: chunk,
          isComplete
        }));
      },
      conversation,
      responderParticipant,
      async (metrics) => {
        // Store metrics in database
        await db.addMetrics(conversation.id, metrics);
        
        // Send metrics update to client
        ws.send(JSON.stringify({
          type: 'metrics_update',
          conversationId: conversation.id,
          metrics
        }));
      },
      participants
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
  inferenceService: EnhancedInferenceService
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
    
    // Use the responderId from the message if provided (from frontend)
    if (message.responderId) {
      responderId = message.responderId;
    } else if (conversation.format === 'standard') {
      // For standard format, use the assistant participant (there should only be one)
      const defaultAssistant = participants.find(p => p.type === 'assistant');
      responderId = defaultAssistant?.id;
    } else {
      // For other formats, use the first active assistant as fallback
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
    let responderParticipant: Participant | undefined;
    
    if (responderId && participants.length > 0) {
      responderParticipant = participants.find(p => p.id === responderId);
      if (responderParticipant) {
        responderModel = responderParticipant.model || conversation.model;
        responderSystemPrompt = responderParticipant.systemPrompt || conversation.systemPrompt;
        responderSettings = responderParticipant.settings || conversation.settings;
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
      
      const modelLoader = ModelLoader.getInstance();
    const modelConfig = await modelLoader.getModelById(responderModel);
      if (!modelConfig) {
        throw new Error(`Model ${responderModel} not found`);
      }
      
      await inferenceService.streamCompletion(
        modelConfig,
        historyMessages,
        responderSystemPrompt || '',
        responderSettings,
        ws.userId,
        async (chunk: string, isComplete: boolean) => {
          const currentBranch = targetMessage.branches.find(b => b.id === targetBranchId);
          if (currentBranch) {
            currentBranch.content += chunk;
            
            // Save partial content periodically
            if (currentBranch.content.length % 500 === 0 || isComplete) {
              await db.updateMessageContent(
                targetMessage.id,
                targetBranchId,
                currentBranch.content
              );
            }
          }

          ws.send(JSON.stringify({
            type: 'stream',
            messageId: targetMessage.id,
            branchId: targetBranchId,
            content: chunk,
            isComplete
          }));
        },
        conversation,
        responderParticipant,
        async (metrics) => {
          // Store metrics in database
          await db.addMetrics(conversation.id, metrics);
          
          // Send metrics update to client
          ws.send(JSON.stringify({
            type: 'metrics_update',
            conversationId: conversation.id,
            metrics
          }));
        },
        participants
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

async function handleContinue(
  ws: AuthenticatedWebSocket,
  message: Extract<WsMessage, { type: 'continue' }>,
  db: Database,
  inferenceService: EnhancedInferenceService
) {
  if (!ws.userId) return;

  const { conversationId, messageId, parentBranchId, responderId } = message;
  
  try {
    // Verify conversation ownership
    const conversation = await db.getConversation(conversationId);
    if (!conversation || conversation.userId !== ws.userId) {
      ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found or access denied' }));
      return;
    }

    // Get participants
    const participants = await db.getConversationParticipants(conversationId);
    
    // Determine the responder
    let responder: Participant | undefined;
    if (conversation.format === 'standard') {
      // For standard format, use the assistant participant (there should only be one)
      responder = participants.find(p => p.type === 'assistant');
    } else {
      // For other formats, use the specified responder
      responder = participants.find(p => p.id === responderId);
      if (!responder || responder.type !== 'assistant') {
        // If no valid responder specified, use first active assistant
        responder = participants.find(p => p.type === 'assistant' && p.isActive);
      }
    }

    if (!responder) {
      ws.send(JSON.stringify({ type: 'error', error: 'No assistant participant found' }));
      return;
    }

    // Get messages and determine parent
    const messages = await db.getConversationMessages(conversationId);
    
    // Check if we should add to an existing message or create a new one
    let assistantMessage: Message | null;
    
    if (parentBranchId) {
      // Check if this parent branch has siblings
      const messageWithSiblings = messages.find(msg => 
        msg.branches.some(b => b.parentBranchId === parentBranchId)
      );
      
      if (messageWithSiblings) {
        // Add as a new branch to the existing message
        console.log('Continue: Adding branch to existing message:', messageWithSiblings.id);
        assistantMessage = await db.addMessageBranch(
          messageWithSiblings.id,
          '', // empty content initially
          'assistant',
          parentBranchId,
          responder.model || conversation.model,
          responder.id,
          undefined // no attachments
        );
      } else {
        // No siblings exist yet, create a new message
        console.log('Continue: Creating new message (no siblings found)');
        assistantMessage = await db.createMessage(
          conversationId,
          '', // empty content initially
          'assistant',
          responder.model || conversation.model,
          parentBranchId,
          responder.id
        );
      }
    } else {
      // No parent specified, create new message as usual
      assistantMessage = await db.createMessage(
        conversationId,
        '', // empty content initially
        'assistant',
        responder.model || conversation.model,
        undefined,
        responder.id
      );
    }

    if (!assistantMessage) {
      console.error('Failed to create assistant message for continue');
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Failed to create assistant message'
      }));
      return;
    }

    const assistantBranch = assistantMessage.branches[assistantMessage.branches.length - 1];

    // Send initial empty message
    ws.send(JSON.stringify({
      type: 'message_created',
      message: assistantMessage
    }));

    // Log WebSocket event
    await llmLogger.logWebSocketEvent({
      event: 'continue',
      conversationId,
      messageId,
      participantId: responder.id,
      model: responder.model || conversation.model
    });

    // Build visible history backwards from the parent branch (same as in handleChatMessage)
    const visibleHistory: Message[] = [];
    
    if (parentBranchId) {
      console.log('Continue: Building visible history backwards from parentBranchId:', parentBranchId);
      
      // Build a map for quick lookup
      const messagesByBranchId = new Map<string, Message>();
      for (const msg of messages) {
        for (const branch of msg.branches) {
          messagesByBranchId.set(branch.id, msg);
        }
      }
      
      // Start from the specified parent and work backwards
      let currentParentBranchId: string | undefined = parentBranchId;
      
      while (currentParentBranchId && currentParentBranchId !== 'root') {
        const parentMessage = messagesByBranchId.get(currentParentBranchId);
        if (!parentMessage) {
          console.log('Could not find message for branch:', currentParentBranchId);
          break;
        }
        
        // Add to beginning of history (we're building backwards)
        visibleHistory.unshift(parentMessage);
        
        // Find the branch and get its parent
        const branch = parentMessage.branches.find(b => b.id === currentParentBranchId);
        if (!branch) {
          console.log('Could not find branch:', currentParentBranchId, 'in message:', parentMessage.id);
          break;
        }
        
        currentParentBranchId = branch.parentBranchId;
      }
      
      console.log('Continue: Final visible history length:', visibleHistory.length);
    } else {
      // No parent specified, use all messages (default behavior)
      visibleHistory.push(...messages);
    }
    
    // Include the new assistant message in the messages array for prefill formatting
    const messagesWithNewAssistant = [...visibleHistory, assistantMessage];

    // Stream the completion
    const modelId = responder.model || conversation.model;
    const modelLoader = ModelLoader.getInstance();
    const modelConfig = await modelLoader.getModelById(modelId);
    if (!modelConfig) {
      throw new Error(`Model ${modelId} not found`);
    }
    
    await inferenceService.streamCompletion(
      modelConfig,
      messagesWithNewAssistant,
      responder.systemPrompt || conversation.systemPrompt || '',
      responder.settings || conversation.settings || {
        temperature: 1.0,
        maxTokens: 1024
      },
      ws.userId!,
      async (chunk: string, isComplete: boolean) => {
        assistantBranch.content += chunk;
        
        // Save partial content periodically
        if (assistantBranch.content.length % 500 === 0 || isComplete) {
          await db.updateMessageContent(assistantMessage.id, assistantBranch.id, assistantBranch.content);
        }
        
        ws.send(JSON.stringify({
          type: 'stream',
          messageId: assistantMessage.id,
          branchId: assistantBranch.id,
          content: chunk,
          isComplete
        }));

        if (isComplete) {
          // Final save
          await db.updateMessageContent(assistantMessage.id, assistantBranch.id, assistantBranch.content);
          
          // Send updated conversation
          const updatedConversation = await db.getConversation(conversationId);
          if (updatedConversation) {
            ws.send(JSON.stringify({
              type: 'conversation_updated',
              conversation: updatedConversation
            }));
          }
        }
      },
      conversation,
      responder,
      async (metrics) => {
        // Store metrics in database
        await db.addMetrics(conversation.id, metrics);
        
        // Send metrics update to client
        ws.send(JSON.stringify({
          type: 'metrics_update',
          conversationId: conversation.id,
          metrics
        }));
      },
      participants
    );

  } catch (error) {
    console.error('Continue generation error:', error);
    ws.send(JSON.stringify({ 
      type: 'error', 
      error: error instanceof Error ? error.message : 'Failed to continue generation'
    }));
  }
}

// Heartbeat interval to keep connections alive
setInterval(() => {
  // This would need to be implemented with a WebSocket server instance
  // to track all connections
}, 30000);
