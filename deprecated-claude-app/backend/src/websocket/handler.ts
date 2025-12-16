import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { WsMessageSchema, WsMessage, Message, Participant } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { verifyToken } from '../middleware/auth.js';
import { InferenceService } from '../services/inference.js';
import { EnhancedInferenceService, validatePricingAvailable, PricingNotConfiguredError } from '../services/enhanced-inference.js';
import { ContextManager } from '../services/context-manager.js';
import { Logger } from '../utils/logger.js';
import { llmLogger } from '../utils/llmLogger.js';
import { ModelLoader } from '../config/model-loader.js';
import { roomManager } from './room-manager.js';
import { USER_FACING_ERRORS } from '../utils/error-messages.js';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  isAlive?: boolean;
}

// Track active generations for abort support
// Key: `${userId}:${conversationId}`, Value: AbortController
const activeGenerations = new Map<string, AbortController>();

function getGenerationKey(userId: string, conversationId: string): string {
  return `${userId}:${conversationId}`;
}

function startGeneration(userId: string, conversationId: string): AbortController {
  const key = getGenerationKey(userId, conversationId);
  // Abort any existing generation for this conversation
  const existing = activeGenerations.get(key);
  if (existing) {
    existing.abort();
  }
  const controller = new AbortController();
  activeGenerations.set(key, controller);
  return controller;
}

function endGeneration(userId: string, conversationId: string): void {
  const key = getGenerationKey(userId, conversationId);
  activeGenerations.delete(key);
}

function abortGeneration(userId: string, conversationId: string): boolean {
  const key = getGenerationKey(userId, conversationId);
  const controller = activeGenerations.get(key);
  if (controller) {
    controller.abort();
    activeGenerations.delete(key);
    return true;
  }
  return false;
}

/**
 * Apply backroom CLI prompt for early group chats.
 * Only applies when:
 * 1. Conversation is in group chat (prefill) format
 * 2. Less than 10 messages in the conversation
 * 3. Model supports prefill
 * 4. Participant's mode is NOT explicitly set to 'messages'
 */
const BACKROOM_PROMPT = 'The assistant is in CLI simulation mode, and responds to the user\'s CLI commands only with the output of the command.';

interface BackroomPromptParams {
  conversationFormat: 'standard' | 'prefill';
  messageCount: number;
  modelProvider: string;
  modelSupportsPrefill?: boolean;
  participantConversationMode?: string;
  existingSystemPrompt: string;
}

function applyBackroomPromptIfNeeded(params: BackroomPromptParams): string {
  const {
    conversationFormat,
    messageCount,
    modelProvider,
    modelSupportsPrefill,
    participantConversationMode,
    existingSystemPrompt
  } = params;
  
  // Only for group chats with fewer than 10 messages
  if (conversationFormat !== 'prefill' || messageCount >= 10) {
    return existingSystemPrompt;
  }
  
  // Check if model supports prefill
  const supportsPrefill = modelProvider === 'anthropic' || modelProvider === 'bedrock' || modelSupportsPrefill === true;
  if (!supportsPrefill) {
    return existingSystemPrompt;
  }
  
  // Check if participant wants prefill mode (not explicitly 'messages' or 'completion')
  const wantsPrefill = !participantConversationMode || 
                       participantConversationMode === 'auto' || 
                       participantConversationMode === 'prefill';
  if (!wantsPrefill) {
    return existingSystemPrompt;
  }
  
  Logger.websocket(`[WebSocket] Applied backroom prompt (${messageCount} messages, provider: ${modelProvider})`);
  return existingSystemPrompt 
    ? `${BACKROOM_PROMPT}\n\n${existingSystemPrompt}`
    : BACKROOM_PROMPT;
}

/**
 * Apply identity prompt for participants in 'messages' mode.
 * In 'messages' mode, the model only sees alternating user/assistant messages
 * and doesn't know its identity from the conversation format.
 * 
 * This adds a default identity prompt like "You are {name}." which can be
 * overridden by the participant's custom system prompt.
 */
interface IdentityPromptParams {
  conversationFormat: 'standard' | 'prefill';
  participantName: string;
  participantConversationMode?: string;
  modelProvider: string;
  modelSupportsPrefill?: boolean;
  existingSystemPrompt: string;
  hasCustomSystemPrompt: boolean; // Whether participant has their own system prompt
}

function applyIdentityPromptIfNeeded(params: IdentityPromptParams): string {
  const {
    conversationFormat,
    participantName,
    participantConversationMode,
    modelProvider,
    modelSupportsPrefill,
    existingSystemPrompt,
    hasCustomSystemPrompt
  } = params;
  
  // Only for group chats (prefill format) - standard conversations use different flow
  if (conversationFormat !== 'prefill') {
    return existingSystemPrompt;
  }
  
  // If participant has a custom system prompt, they've already defined their identity
  if (hasCustomSystemPrompt) {
    return existingSystemPrompt;
  }
  
  // Check if model supports prefill
  const supportsPrefill = modelProvider === 'anthropic' || modelProvider === 'bedrock' || modelSupportsPrefill === true;
  
  // Determine if we're actually using messages mode
  // (either explicitly set to 'messages', or 'auto'/undefined with a model that doesn't support prefill)
  const explicitMessagesMode = participantConversationMode === 'messages' || participantConversationMode === 'completion';
  const autoFallbackToMessages = (!participantConversationMode || participantConversationMode === 'auto') && !supportsPrefill;
  
  const usingMessagesMode = explicitMessagesMode || autoFallbackToMessages;
  
  if (!usingMessagesMode) {
    // Using prefill mode - participant name is in the message format, no identity prompt needed
    return existingSystemPrompt;
  }
  
  // Build identity prompt
  const identityPrompt = `You are ${participantName}. You are connected to a multi-participant chat system. Please respond in character.`;
  
  Logger.websocket(`[WebSocket] Applied identity prompt for "${participantName}" (messages mode)`);
  
  return existingSystemPrompt 
    ? `${identityPrompt}\n\n${existingSystemPrompt}`
    : identityPrompt;
}

/**
 * Build conversation history by following the active branch path backwards
 * from a given branch ID to the root.
 * 
 * @param allMessages - All messages in the conversation
 * @param fromBranchId - The branch ID to start from (going backwards)
 * @param includeMessage - Optional message to include/replace in the history
 * @returns Array of messages in chronological order (oldest first)
 */
function buildConversationHistory(
  allMessages: Message[],
  fromBranchId: string | undefined,
  includeMessage?: { messageId: string; message: Message }
): Message[] {
  const history: Message[] = [];
  
  // Build a map for quick lookup
  const messagesByBranchId = new Map<string, Message>();
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
      Logger.debug('[buildConversationHistory] Could not find message for branch:', currentBranchId);
      break;
    }
    
    // Use the provided message if this is the one to replace
    const messageToAdd = includeMessage && message.id === includeMessage.messageId 
      ? includeMessage.message 
      : message;
    
    // Add to beginning of history (we're building backwards)
    history.unshift(messageToAdd);
    
    // Find the branch and get its parent
    const branch = messageToAdd.branches.find(b => b.id === currentBranchId);
    if (!branch) {
      console.log('[buildConversationHistory] Could not find branch:', currentBranchId);
      break;
    }
    
    currentBranchId = branch.parentBranchId;
  }
  
  return history;
}

/**
 * Filter out messages that are marked as hidden from AI.
 * These messages are visible to humans but should not be included in the AI context.
 * 
 * @param messages - Array of messages to filter
 * @returns Array of messages with hiddenFromAi branches removed
 */
function filterHiddenFromAiMessages(messages: Message[]): Message[] {
  return messages
    .map(msg => {
      // Get the active branch
      const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
      
      // If the active branch is hidden from AI, skip this message entirely
      if (activeBranch?.hiddenFromAi) {
        return null;
      }
      
      return msg;
    })
    .filter((msg): msg is Message => msg !== null);
}

async function userHasSufficientCredits(db: Database, userId: string, modelId?: string): Promise<boolean> {
  // Check if the user has their own API key for the model's provider
  if (modelId) {
    const modelLoader = ModelLoader.getInstance();
    const model = await modelLoader.getModelById(modelId, userId);
    if (model) {
      // Check if user has their own API key for this provider
      const userApiKeys = await db.getUserApiKeys(userId);
      const hasProviderKey = userApiKeys.some(key => key.provider === model.provider);
      if (hasProviderKey) {
        console.log(`[Credits] User ${userId} has custom ${model.provider} API key, skipping credit check`);
        return true;
      }
    }
  }

  const summary = await db.getUserGrantSummary(userId);
  const currencies = await db.getApplicableGrantCurrencies(modelId, userId);
  for (const currency of currencies) {
    const balance = Number(summary.totals[currency] ?? 0);
    if (balance > 0) return true;
  }
  return await db.userHasActiveGrantCapability(userId, 'overspend');
}

function sendInsufficientCreditsError(ws: AuthenticatedWebSocket): void {
  ws.send(JSON.stringify({
    type: 'error',
    error: 'Insufficient credits. Please add credits before generating more responses.'
  }));
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

  // Register this connection with the room manager
  roomManager.registerConnection(ws, decoded.userId);

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
          await handleChatMessage(ws, message, db, inferenceService, baseInferenceService);
          break;
          
        case 'regenerate':
          await handleRegenerate(ws, message, db, inferenceService, baseInferenceService);
          break;
          
        case 'edit':
          await handleEdit(ws, message, db, inferenceService, baseInferenceService);
          break;
          
        case 'delete':
          await handleDelete(ws, message, db);
          break;
          
        case 'continue':
          await handleContinue(ws, message, db, inferenceService, baseInferenceService);
          break;
          
        case 'abort':
          handleAbort(ws, message);
          break;
        
        case 'join_room':
          handleJoinRoom(ws, message);
          break;
        
        case 'leave_room':
          handleLeaveRoom(ws, message);
          break;
        
        case 'typing':
          handleTyping(ws, message, db);
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
    Logger.websocket(`WebSocket closed for user ${ws.userId}`);
    
    // Unregister from room manager (removes from all rooms)
    roomManager.unregisterConnection(ws);
    
    // Clean up any incomplete streaming messages
    // This is handled by the streaming service, but we should log it
    if (ws.userId) {
      Logger.websocket(`User ${ws.userId} disconnected - any in-progress streams will be saved`);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // Send initial connection success
  ws.send(JSON.stringify({ type: 'connected', userId: ws.userId }));
}

function handleAbort(
  ws: AuthenticatedWebSocket,
  message: { type: 'abort'; conversationId: string }
) {
  if (!ws.userId) return;
  
  const aborted = abortGeneration(ws.userId, message.conversationId);
  console.log(`[Abort] User ${ws.userId} aborted generation for conversation ${message.conversationId}: ${aborted ? 'success' : 'no active generation'}`);
  
  ws.send(JSON.stringify({
    type: 'generation_aborted',
    conversationId: message.conversationId,
    success: aborted
  }));
}

// Multi-user room handlers
function handleJoinRoom(
  ws: AuthenticatedWebSocket,
  message: { type: 'join_room'; conversationId: string }
) {
  if (!ws.userId) return;
  
  roomManager.joinRoom(message.conversationId, ws);
  
  // Send back room state
  ws.send(JSON.stringify({
    type: 'room_joined',
    conversationId: message.conversationId,
    activeUsers: roomManager.getActiveUsers(message.conversationId),
    activeAiRequest: roomManager.getActiveAiRequest(message.conversationId)
  }));
}

function handleLeaveRoom(
  ws: AuthenticatedWebSocket,
  message: { type: 'leave_room'; conversationId: string }
) {
  if (!ws.userId) return;
  
  roomManager.leaveRoom(message.conversationId, ws);
  
  ws.send(JSON.stringify({
    type: 'room_left',
    conversationId: message.conversationId
  }));
}

async function handleTyping(
  ws: AuthenticatedWebSocket,
  message: { type: 'typing'; conversationId: string; isTyping: boolean },
  db: Database
) {
  if (!ws.userId) return;
  
  // Get user info for display
  const user = await db.getUserById(ws.userId);
  const userDisplayName = user?.email?.split('@')[0] || 'Someone'; // Use username part of email
  
  // Broadcast typing status to others in the room
  roomManager.broadcastToRoom(message.conversationId, {
    type: 'user_typing',
    conversationId: message.conversationId,
    userId: ws.userId,
    userName: userDisplayName,
    isTyping: message.isTyping
  }, ws); // Exclude sender
}

async function handleChatMessage(
  ws: AuthenticatedWebSocket,
  message: Extract<WsMessage, { type: 'chat' }>,
  db: Database,
  inferenceService: EnhancedInferenceService,
  baseInferenceService: InferenceService
) {
  if (!ws.userId) return;

  // Verify conversation access and chat permission
  const conversation = await db.getConversation(message.conversationId, ws.userId);
  if (!conversation) {
    ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found or access denied' }));
    return;
  }
  
  // Check if user can chat (owner or collaborator/editor)
  const canChat = await db.canUserChatInConversation(message.conversationId, ws.userId);
  if (!canChat) {
    ws.send(JSON.stringify({ type: 'error', error: 'You do not have permission to send messages in this conversation' }));
    return;
  }

  // Create user message with specified parent if provided
  Logger.debug('Creating user message with parentBranchId:', message.parentBranchId);
  Logger.debug('Received attachments:', message.attachments?.length || 0);
  Logger.debug('Message object keys:', Object.keys(message));
  
  // Process attachments if provided
  const attachments = message.attachments?.map(att => ({
    fileName: att.fileName,
    fileType: att.fileType,
    content: att.content,
    fileSize: att.content.length
  }));
  
  if (attachments && attachments.length > 0) {
    Logger.debug('Processing attachments:', attachments.map(a => ({ fileName: a.fileName, size: a.fileSize })));
  }
  
  // Check if we should add to an existing message or create a new one
  let userMessage: any;
  
  if (message.parentBranchId) {
    // Check if this parent branch has siblings (i.e., we're branching from within history)
    const allMessages = await db.getConversationMessages(message.conversationId, conversation.userId);
    const messageWithSiblings = allMessages.find(msg => 
      msg.branches.some(b => b.parentBranchId === message.parentBranchId)
    );
    
    if (messageWithSiblings) {
      // Add as a new branch to the existing message that contains siblings
      Logger.debug('Adding branch to existing message:', messageWithSiblings.id);
      userMessage = await db.addMessageBranch(
        messageWithSiblings.id,
        messageWithSiblings.conversationId,
        conversation.userId,
        message.content,
        'user',
        message.parentBranchId,
        undefined, // model
        message.participantId,
        attachments,
        ws.userId, // sentByUserId - actual user who sent this
        message.hiddenFromAi // whether message is hidden from AI
      );
    } else {
      // No siblings exist yet, create a new message
      Logger.debug('Creating new message (no siblings found)');
      userMessage = await db.createMessage(
        message.conversationId,
        conversation.userId,
        message.content,
        'user',
        undefined, // model
        message.parentBranchId,
        message.participantId,
        attachments,
        ws.userId, // sentByUserId - actual user who sent this
        message.hiddenFromAi // whether message is hidden from AI
      );
    }
  } else {
    // No parent specified, create new message as usual
    userMessage = await db.createMessage(
      message.conversationId,
      conversation.userId,
      message.content,
      'user',
      undefined, // model
      message.parentBranchId,
      message.participantId,
      attachments,
      ws.userId, // sentByUserId - actual user who sent this
      message.hiddenFromAi // whether message is hidden from AI
    );
  }
  
  Logger.debug('Created/updated user message:', userMessage.id, 'with branch:', userMessage.branches[userMessage.branches.length - 1]?.id);
  Logger.debug('User message has attachments?', userMessage.branches[userMessage.branches.length - 1]?.attachments?.length || 0);

  // Send confirmation to sender
  ws.send(JSON.stringify({
    type: 'message_created',
    message: userMessage
  }));
  
  // Broadcast user message to all other users in the room
  roomManager.broadcastToRoom(message.conversationId, {
    type: 'message_created',
    message: userMessage,
    fromUserId: ws.userId
  }, ws); // Exclude sender

  // If message is hidden from AI, don't trigger AI generation
  if (message.hiddenFromAi) {
    console.log('[Chat] Message is hidden from AI, skipping AI generation');
    return;
  }
  
  // Get sampling branches count (default 1)
  const samplingBranchCount = (message as any).samplingBranches || 1;
  if (samplingBranchCount > 1) {
    console.log(`[Chat] Sampling ${samplingBranchCount} response branches in parallel`);
  }

  // Get participants for the conversation
  const participants = await db.getConversationParticipants(message.conversationId, conversation.userId);
  
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

  const inferenceModel = responder.model || conversation.model;

  if (!(await userHasSufficientCredits(db, conversation.userId, inferenceModel))) {
    sendInsufficientCreditsError(ws);
    return;
  }
  
  // Check if there's already an active AI request for this conversation
  const existingAiRequest = roomManager.getActiveAiRequest(message.conversationId);
  if (existingAiRequest) {
    console.log(`[Chat] AI already generating for conversation ${message.conversationId} (requested by ${existingAiRequest.userId}), skipping new request`);
    ws.send(JSON.stringify({
      type: 'ai_request_queued',
      conversationId: message.conversationId,
      reason: 'AI is already generating a response',
      requestedBy: existingAiRequest.userId
    }));
    return;
  }

  // Create assistant message placeholder with correct parent
  const userBranch = userMessage.branches[userMessage.branches.length - 1]; // Get the last branch (the one we just added)
  
  // Check if we should add to an existing message or create a new one
  let assistantMessage: Message | null;
  const allMessagesForAssistant = await db.getConversationMessages(message.conversationId, conversation.userId);
  const messageWithAssistantSiblings = allMessagesForAssistant.find(msg => 
    msg.branches.some(b => b.parentBranchId === userBranch?.id)
  );
  
  if (messageWithAssistantSiblings) {
    // Add as a new branch to the existing message
    console.log('Adding assistant branch to existing message:', messageWithAssistantSiblings.id);
    assistantMessage = await db.addMessageBranch(
      messageWithAssistantSiblings.id,
      messageWithAssistantSiblings.conversationId,
      conversation.userId,
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
      conversation.userId,
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
  Logger.debug('Created/updated assistant message:', assistantMessage.id, 'with branch:', assistantBranch?.id);

  // Send assistant message to frontend
  ws.send(JSON.stringify({
    type: 'message_created',
    message: assistantMessage
  }));
  
  // Broadcast assistant message placeholder to other users
  roomManager.broadcastToRoom(message.conversationId, {
    type: 'message_created',
    message: assistantMessage,
    fromUserId: ws.userId
  }, ws);

  // Get conversation history using the utility function
  const allMessages = await db.getConversationMessages(message.conversationId, conversation.userId);
  
  // Build history from the parent branch and add the new user message
  const visibleHistory = buildConversationHistory(allMessages, message.parentBranchId);
  visibleHistory.push(userMessage);
  console.log('Final visible history length:', visibleHistory.length);
  
  // Filter out messages marked as hidden from AI (keep them in history for UI, but don't send to AI)
  const filteredHistory = filterHiddenFromAiMessages(visibleHistory);
  console.log('Filtered history length (excluding hiddenFromAi):', filteredHistory.length);
  
  // For prefill format, we need to include the empty assistant message too
  // so that formatMessagesForConversation knows to append the assistant's name
  const messagesForInference = conversation.format === 'prefill' 
    ? [...filteredHistory, assistantMessage]
    : filteredHistory;
  
  // Stream response from appropriate service
  try {
    Logger.websocket(`[WebSocket] Responder:`, JSON.stringify(responder, null, 2));
    Logger.websocket(`[WebSocket] Conversation model: "${conversation.model}"`);
    Logger.websocket(`[WebSocket] Determined inferenceModel: "${inferenceModel}"`);
    
    let inferenceSystemPrompt = responder.systemPrompt || conversation.systemPrompt;
    
    // For standard conversations, always use conversation settings
    // For prefill/group chat, merge participant and conversation settings
    const inferenceSettings = conversation.format === 'standard' 
      ? conversation.settings
      : {
          temperature: responder.settings?.temperature ?? conversation.settings.temperature,
          maxTokens: responder.settings?.maxTokens ?? conversation.settings.maxTokens,
          topP: responder.settings?.topP ?? conversation.settings.topP,
          topK: responder.settings?.topK ?? conversation.settings.topK,
          // Always use conversation-level thinking settings
          thinking: conversation.settings.thinking,
          // Include model-specific settings (e.g., image resolution)
          modelSpecific: responder.settings?.modelSpecific ?? conversation.settings.modelSpecific
        };
    
    // Debug: Log the settings being used
    Logger.websocket('[WebSocket] Conversation settings:', JSON.stringify(conversation.settings, null, 2));
    Logger.websocket('[WebSocket] Responder settings:', JSON.stringify(responder.settings, null, 2));
    Logger.websocket('[WebSocket] Final inference settings:', JSON.stringify(inferenceSettings, null, 2));
    
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
    const modelConfig = await modelLoader.getModelById(inferenceModel, conversation.userId);
    if (!modelConfig) {
      throw new Error(`Model ${inferenceModel} not found`);
    }
    
    // Validate pricing is configured BEFORE making inference call
    const pricingCheck = await validatePricingAvailable(modelConfig);
    if (!pricingCheck.valid) {
      console.error(`[Chat] Pricing validation failed for model ${inferenceModel}:`, pricingCheck.error);
      ws.send(JSON.stringify({
        type: 'error',
        error: USER_FACING_ERRORS.PRICING_NOT_CONFIGURED.message,
        details: pricingCheck.error
      }));
      // Delete the empty assistant message we created
      await db.deleteMessage(assistantMessage.id, message.conversationId, conversation.userId);
      return;
    }
    
    // Apply backroom prompt for early group chats if conditions are met
    inferenceSystemPrompt = applyBackroomPromptIfNeeded({
      conversationFormat: conversation.format,
      messageCount: filteredHistory.length,
      modelProvider: modelConfig.provider,
      modelSupportsPrefill: modelConfig.supportsPrefill,
      participantConversationMode: responder.conversationMode,
      existingSystemPrompt: inferenceSystemPrompt || ''
    });
    
    // Create abort controller for this generation
    const abortController = startGeneration(conversation.userId, conversation.id);
    
    // Track AI request in room manager for multi-user sync
    roomManager.startAiRequest(message.conversationId, ws.userId!, assistantMessage.id);
    
    try {
    // Prepare all branches for parallel sampling
    const branchesToGenerate: Array<{ branchId: string; branchContent: string }> = [
      { branchId: assistantMessage.activeBranchId, branchContent: '' }
    ];
    
    // Create additional branches if sampling multiple responses
    if (samplingBranchCount > 1) {
      for (let i = 1; i < samplingBranchCount; i++) {
        // Add a new branch to the same assistant message
        const newBranchMessage = await db.addMessageBranch(
          assistantMessage.id,
          assistantMessage.conversationId,
          conversation.userId,
          '', // empty content
          'assistant',
          userBranch?.id, // same parent as first branch
          responder.model || conversation.model,
          responder.id,
          undefined // no attachments
        );
        
        if (newBranchMessage) {
          const newBranch = newBranchMessage.branches[newBranchMessage.branches.length - 1];
          branchesToGenerate.push({ branchId: newBranch.id, branchContent: '' });
          
          // Update our local assistantMessage with the new branch
          assistantMessage.branches.push(newBranch);
          
          // Send branch created notification
          ws.send(JSON.stringify({
            type: 'message_edited',
            message: assistantMessage
          }));
          
          // Broadcast to other users
          roomManager.broadcastToRoom(message.conversationId, {
            type: 'message_edited',
            message: assistantMessage,
            fromUserId: ws.userId
          }, ws);
        }
      }
      
      console.log(`[Chat] Created ${branchesToGenerate.length} branches for parallel sampling`);
    }
    
    // Helper function to run inference for a single branch
    const runBranchInference = async (branchId: string, branchIndex: number) => {
      let branchContent = '';
    
    await inferenceService.streamCompletion(
      modelConfig,
      messagesForInference,
      inferenceSystemPrompt || '',
      inferenceSettings,
      conversation.userId,
      async (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => {
          // Update branch content
          branchContent += chunk;
          
          // Find the branch in our message
          const currentBranch = assistantMessage.branches.find((b: any) => b.id === branchId);
        if (currentBranch) {
            currentBranch.content = branchContent;
          
          // Store content blocks if provided
          if (contentBlocks && contentBlocks.length > 0) {
            currentBranch.contentBlocks = contentBlocks;
          }
          
          // Save partial content every 500 characters to prevent data loss on interruption
            if (branchContent.length % 500 === 0 || isComplete) {
            await db.updateMessageContent(
              assistantMessage.id,
              assistantMessage.conversationId,
              conversation.userId,
                branchId,
                branchContent,
              currentBranch.contentBlocks
            );
          }
        }

        // Send stream update
        const streamData = {
          type: 'stream',
          messageId: assistantMessage.id,
            branchId: branchId,
          content: chunk,
          contentBlocks: contentBlocks,
            isComplete,
            branchIndex: branchIndex // Let client know which branch this is for
        };
        
          // Log content blocks being sent (only when there are blocks and no text chunk)
        if (contentBlocks && contentBlocks.length > 0 && !chunk) {
            console.log(`[WebSocket] Branch ${branchIndex}: Sending content blocks:`, contentBlocks.length, 'types:', contentBlocks.map((b: any) => b.type));
        }
        
          // Send to original requester
        ws.send(JSON.stringify(streamData));
          
          // Broadcast to all other users in the room
          roomManager.broadcastToRoom(message.conversationId, streamData, ws);

        if (isComplete) {
            // Final save
            const finalBranch = assistantMessage.branches.find((b: any) => b.id === branchId);
            if (finalBranch) {
              // Trim leading/trailing whitespace from final content
              finalBranch.content = branchContent.trim();
              
            await db.updateMessageContent(
              assistantMessage.id,
              assistantMessage.conversationId,
              conversation.userId,
                branchId,
                finalBranch.content,
                finalBranch.contentBlocks
              );
            }
        }
      },
      conversation,
      responder,
      async (metrics) => {
          // Store metrics in database (only for first branch to avoid duplicate counting)
          if (branchIndex === 0) {
        await db.addMetrics(conversation.id, conversation.userId, metrics);
        
        // Send metrics update to client
        ws.send(JSON.stringify({
          type: 'metrics_update',
          conversationId: conversation.id,
              metrics,
              branchIndex
            }));
          }
        },
        participants,
        abortController.signal
      );
    };
    
    // Run all branches in parallel
    await Promise.all(
      branchesToGenerate.map((branch, index) =>
        runBranchInference(branch.branchId, index)
      )
    );

    // Capture debug request/response for researchers
    console.log('[DEBUG CAPTURE] Starting debug data capture...');
    try {
      // Get the raw API request that was just sent
      const rawRequest = baseInferenceService.lastRawRequest;
      console.log(`[DEBUG CAPTURE] Raw request available: ${!!rawRequest}`);

      if (rawRequest) {
        // Store debug data on each generated branch
        console.log(`[DEBUG CAPTURE] Processing ${branchesToGenerate.length} branches`);
        // Compute actual format used (same logic as applyBackroomPromptIfNeeded)
        const modelSupportsPrefill = modelConfig.provider === 'anthropic' || modelConfig.provider === 'bedrock' || modelConfig.supportsPrefill === true;
        const participantMode = responder.conversationMode;
        const wantsPrefill = !participantMode || participantMode === 'auto' || participantMode === 'prefill';
        const actualFormat = (conversation.format === 'prefill' && modelSupportsPrefill && wantsPrefill) ? 'prefill' : 'messages';
        
        for (const branch of branchesToGenerate) {
          const branchObj = assistantMessage.branches.find((b: any) => b.id === branch.branchId);
          console.log(`[DEBUG CAPTURE] Branch ${branch.branchId}: branchObj found = ${!!branchObj}`);
          if (branchObj) {
            // Store the raw API request with inference metadata
            const debugRequest = {
              ...rawRequest,
              provider: modelConfig.provider,
              settings: inferenceSettings,
              // Inference format metadata
              conversationFormat: conversation.format,
              participantConversationMode: participantMode || 'auto',
              actualFormatUsed: actualFormat
            };

            // Store the response (content is already in the branch)
            const debugResponse = {
              content: branchObj.content,
              contentBlocks: branchObj.contentBlocks,
              model: branchObj.model
            };

            console.log(`[DEBUG CAPTURE] Updating message branch ${branch.branchId}...`);
            await db.updateMessageBranch(
              assistantMessage.id,
              conversation.userId,
              branch.branchId,
              {
                debugRequest,
                debugResponse
              }
            );
            console.log(`[DEBUG CAPTURE] Branch ${branch.branchId} updated successfully`);

            // Send update to frontend so bug icon appears immediately
            const updatedMessage = await db.getMessage(assistantMessage.id, conversation.id, conversation.userId);
            if (updatedMessage) {
              const updateEvent = {
                type: 'message_edited',
                message: updatedMessage
              };
              ws.send(JSON.stringify(updateEvent));
              roomManager.broadcastToRoom(conversation.id, updateEvent, ws);
            }
          }
        }
        console.log('[DEBUG CAPTURE] Debug data capture complete');
      } else {
        console.log('[DEBUG CAPTURE] No raw request available (non-Anthropic provider?)');
      }
    } catch (debugError) {
      console.error('[DEBUG CAPTURE] Failed to capture debug data:', debugError);
      // Don't fail the whole request if debug capture fails
    }

    // Update conversation timestamp after all branches complete
    await db.updateConversation(conversation.id, conversation.userId, { updatedAt: new Date() });
    
    } finally {
      endGeneration(conversation.userId, conversation.id);
      roomManager.endAiRequest(message.conversationId);
    }
  } catch (error) {
    // Clean up generation tracking on error
    endGeneration(conversation.userId, conversation.id);
    roomManager.endAiRequest(message.conversationId);
    
    // Check if this was an abort
    if (error instanceof Error && error.message === 'Generation aborted') {
      console.log(`[Abort] Generation was aborted for conversation ${message.conversationId}`);
      ws.send(JSON.stringify({
        type: 'stream',
        messageId: assistantMessage.id,
        branchId: assistantMessage.activeBranchId,
        content: '',
        isComplete: true,
        aborted: true
      }));
      return;
    }
    
    console.error('Inference streaming error:', error);
    
    // Parse error for user-friendly messages (using centralized error messages)
    const errorMsg = error instanceof Error ? error.message : String(error);
    let friendlyError = USER_FACING_ERRORS.GENERIC_ERROR.message;
    let suggestion = USER_FACING_ERRORS.GENERIC_ERROR.suggestion;
    
    if (errorMsg.includes('Model') && errorMsg.includes('not found')) {
      friendlyError = USER_FACING_ERRORS.MODEL_NOT_FOUND.message;
      suggestion = USER_FACING_ERRORS.MODEL_NOT_FOUND.suggestion;
    } else if (errorMsg.includes('No API key')) {
      friendlyError = USER_FACING_ERRORS.NO_API_KEY.message;
      suggestion = USER_FACING_ERRORS.NO_API_KEY.suggestion;
    } else if (errorMsg.includes('Rate limit') || errorMsg.includes('rate_limit') || errorMsg.includes('429')) {
      friendlyError = USER_FACING_ERRORS.RATE_LIMIT.message;
      suggestion = USER_FACING_ERRORS.RATE_LIMIT.suggestion;
    } else if (errorMsg.includes('overloaded') || errorMsg.includes('503')) {
      friendlyError = USER_FACING_ERRORS.OVERLOADED.message;
      suggestion = USER_FACING_ERRORS.OVERLOADED.suggestion;
    } else if (errorMsg.includes('Insufficient credits')) {
      friendlyError = USER_FACING_ERRORS.INSUFFICIENT_CREDITS.message;
      suggestion = USER_FACING_ERRORS.INSUFFICIENT_CREDITS.suggestion;
    } else if (errorMsg.includes('401') || errorMsg.includes('403') || errorMsg.includes('Authentication')) {
      friendlyError = USER_FACING_ERRORS.AUTHENTICATION_FAILED.message;
      suggestion = USER_FACING_ERRORS.AUTHENTICATION_FAILED.suggestion;
    } else if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('fetch failed')) {
      friendlyError = USER_FACING_ERRORS.CONNECTION_ERROR.message;
      suggestion = USER_FACING_ERRORS.CONNECTION_ERROR.suggestion;
    } else if (errorMsg.includes('context') || errorMsg.includes('too long') || errorMsg.includes('maximum')) {
      friendlyError = USER_FACING_ERRORS.CONTEXT_TOO_LONG.message;
      suggestion = USER_FACING_ERRORS.CONTEXT_TOO_LONG.suggestion;
    } else if (errorMsg.includes('content') && (errorMsg.includes('filter') || errorMsg.includes('flag') || errorMsg.includes('policy'))) {
      friendlyError = USER_FACING_ERRORS.CONTENT_FILTERED.message;
      suggestion = USER_FACING_ERRORS.CONTENT_FILTERED.suggestion;
    } else if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
      friendlyError = USER_FACING_ERRORS.REQUEST_TIMEOUT.message;
      suggestion = USER_FACING_ERRORS.REQUEST_TIMEOUT.suggestion;
    } else if (errorMsg.includes('500') || errorMsg.includes('Internal')) {
      friendlyError = USER_FACING_ERRORS.SERVER_ERROR.message;
      suggestion = USER_FACING_ERRORS.SERVER_ERROR.suggestion;
    } else if (errorMsg.includes('404')) {
      friendlyError = USER_FACING_ERRORS.ENDPOINT_NOT_FOUND.message;
      suggestion = USER_FACING_ERRORS.ENDPOINT_NOT_FOUND.suggestion;
    } else if (errorMsg.length < 100) {
      // Short error messages are usually informative, pass them through
      friendlyError = errorMsg;
      suggestion = USER_FACING_ERRORS.GENERIC_ERROR.suggestion;
    }
    
    ws.send(JSON.stringify({
      type: 'error',
      error: friendlyError,
      suggestion: suggestion || undefined
    }));
  }
}

async function handleRegenerate(
  ws: AuthenticatedWebSocket,
  message: Extract<WsMessage, { type: 'regenerate' }>,
  db: Database,
  inferenceService: EnhancedInferenceService,
  baseInferenceService: InferenceService
) {
  if (!ws.userId) return;

  // First verify conversation access (handles both owner and collaboration)
  const conversation = await db.getConversation(message.conversationId, ws.userId);
  if (!conversation) {
    ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found or access denied' }));
    return;
  }
  
  // Check if user can chat (owner or collaborator/editor)
  const canChat = await db.canUserChatInConversation(message.conversationId, ws.userId);
  if (!canChat) {
    ws.send(JSON.stringify({ type: 'error', error: 'You do not have permission to regenerate in this conversation' }));
    return;
  }

  // Use conversation.userId (the owner) to fetch message
  const msg = await db.getMessage(message.messageId, message.conversationId, conversation.userId);
  if (!msg) {
    ws.send(JSON.stringify({ type: 'error', error: 'Message not found' }));
    return;
  }

  // Find the parent branch (the user message branch that this is responding to)
  const allMessages = await db.getConversationMessages(msg.conversationId, conversation.userId);
  const targetMessageIndex = allMessages.findIndex(m => m.id === message.messageId);
  const parentUserMessage = targetMessageIndex > 0 ? allMessages[targetMessageIndex - 1] : null;
  const parentUserBranch = parentUserMessage ? parentUserMessage.branches.find(b => b.id === parentUserMessage.activeBranchId) : null;

  // Get the participant ID and parent branch from the branch we're regenerating
  const originalBranch = msg.branches.find(b => b.id === message.branchId);
  const participantId = originalBranch?.participantId;
  
  // Use the frontend-provided parentBranchId if available (reflects current visible path after branch switches)
  // Fall back to original branch's parent, then to the parent user message's active branch
  const correctParentBranchId = message.parentBranchId || originalBranch?.parentBranchId || parentUserBranch?.id || 'root';
  
  console.log('=== REGENERATE HANDLER ===');
  console.log('Frontend parentBranchId:', message.parentBranchId?.slice(0, 8) || 'not provided');
  console.log('Original branch parent:', originalBranch?.parentBranchId?.slice(0, 8) || 'none');
  console.log('Using parentBranchId:', correctParentBranchId.slice(0, 8));
  
  Logger.debug('[Regenerate] Message:', message.messageId, 'Branch:', message.branchId);
  Logger.debug('[Regenerate] Original branch parent:', originalBranch?.parentBranchId);
  console.log('[Regenerate] Using parent branch:', correctParentBranchId);
  
  // Get the participant's model if in prefill mode
  let regenerateModel = conversation.model;
  if (conversation.format === 'prefill' && participantId) {
    const participants = await db.getConversationParticipants(conversation.id, conversation.userId);
    const participant = participants.find(p => p.id === participantId);
    if (participant && participant.model) {
      regenerateModel = participant.model;
    }
  }

  if (!(await userHasSufficientCredits(db, conversation.userId, regenerateModel))) {
    sendInsufficientCreditsError(ws);
    return;
  }

  // Create new branch with correct parent and model
  const updatedMessage = await db.addMessageBranch(
    message.messageId,
    message.conversationId,
    conversation.userId,
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
  const editEvent = {
    type: 'message_edited',
    message: updatedMessage
  };
  ws.send(JSON.stringify(editEvent));
  
  // Broadcast to other users in the room
  roomManager.broadcastToRoom(message.conversationId, editEvent, ws);

  // Get conversation history using the utility function
  const historyMessages = buildConversationHistory(allMessages, correctParentBranchId);
  
  // Filter out messages hidden from AI
  const filteredHistoryMessages = filterHiddenFromAiMessages(historyMessages);

  // Get participants for the conversation
  const participants = await db.getConversationParticipants(conversation.id, conversation.userId);
  
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
      
      // For standard conversations, always use conversation settings
      // For prefill/group chat, merge participant and conversation settings
      if (conversation.format === 'standard') {
        responderSettings = conversation.settings;
      } else {
        responderSettings = {
          temperature: participant.settings?.temperature ?? conversation.settings.temperature,
          maxTokens: participant.settings?.maxTokens ?? conversation.settings.maxTokens,
          topP: participant.settings?.topP ?? conversation.settings.topP,
          topK: participant.settings?.topK ?? conversation.settings.topK,
          // Always use conversation-level thinking settings
          thinking: conversation.settings.thinking,
          // Include model-specific settings (e.g., image resolution)
          modelSpecific: participant.settings?.modelSpecific ?? conversation.settings.modelSpecific
        };
      }
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
    
    // Get the responder participant object
    const responderParticipant = responderId ? participants.find(p => p.id === responderId) : undefined;
    
    const modelLoader = ModelLoader.getInstance();
    const modelConfig = await modelLoader.getModelById(responderModel, conversation.userId);
    if (!modelConfig) {
      throw new Error(`Model ${responderModel} not found`);
    }
    
    // Validate pricing is configured BEFORE making inference call
    const pricingCheck = await validatePricingAvailable(modelConfig);
    if (!pricingCheck.valid) {
      console.error(`[Regenerate] Pricing validation failed for model ${responderModel}:`, pricingCheck.error);
      ws.send(JSON.stringify({
        type: 'error',
        error: USER_FACING_ERRORS.PRICING_NOT_CONFIGURED.message,
        details: pricingCheck.error
      }));
      return;
    }
    
    // Apply backroom prompt for early group chats if conditions are met
    responderSystemPrompt = applyBackroomPromptIfNeeded({
      conversationFormat: conversation.format,
      messageCount: filteredHistoryMessages.length,
      modelProvider: modelConfig.provider,
      modelSupportsPrefill: modelConfig.supportsPrefill,
      participantConversationMode: responderParticipant?.conversationMode,
      existingSystemPrompt: responderSystemPrompt || ''
    });
    
    // Create abort controller for this generation
    const abortController = startGeneration(conversation.userId, conversation.id);
    
    // Track AI request in room manager for multi-user sync
    roomManager.startAiRequest(message.conversationId, ws.userId!, updatedMessage.id);
    
    try {
    await inferenceService.streamCompletion(
      modelConfig,
      filteredHistoryMessages,
      responderSystemPrompt || '',
      responderSettings,
      conversation.userId,
      async (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => {
        const currentBranch = updatedMessage.branches.find(b => b.id === updatedMessage.activeBranchId);
        if (currentBranch) {
          currentBranch.content += chunk;
          
          // Store content blocks if provided
          if (contentBlocks && contentBlocks.length > 0) {
            currentBranch.contentBlocks = contentBlocks;
          }
            
            // Trim whitespace on completion
            if (isComplete) {
              currentBranch.content = currentBranch.content.trim();
          }
          
          // Save partial content periodically to prevent data loss
          if (currentBranch.content.length % 500 === 0 || isComplete) {
            await db.updateMessageContent(
              updatedMessage.id,
              updatedMessage.conversationId,
              conversation.userId,
              updatedMessage.activeBranchId,
              currentBranch.content,
              currentBranch.contentBlocks
            );
          }
        }

        const streamData = {
          type: 'stream',
          messageId: updatedMessage.id,
          branchId: updatedMessage.activeBranchId,
          content: chunk,
          contentBlocks: contentBlocks,
          isComplete
        };
        ws.send(JSON.stringify(streamData));
        
        // Broadcast to other users in the room
        roomManager.broadcastToRoom(message.conversationId, streamData, ws);
      },
      conversation,
      responderParticipant,
      async (metrics) => {
        // Store metrics in database
        await db.addMetrics(conversation.id, conversation.userId, metrics);
        
        // Send metrics update to client
        ws.send(JSON.stringify({
          type: 'metrics_update',
          conversationId: conversation.id,
          metrics
        }));
      },
        participants,
        abortController.signal
    );
    } finally {
      endGeneration(conversation.userId, conversation.id);
      roomManager.endAiRequest(message.conversationId);
    }

    // Capture debug request/response for researchers
    console.log('[DEBUG CAPTURE] Starting debug data capture for regenerate...');
    try {
      // Get the raw API request that was just sent
      const rawRequest = baseInferenceService.lastRawRequest;
      console.log(`[DEBUG CAPTURE] Raw request available: ${!!rawRequest}`);

      if (rawRequest) {
        // Store debug data on the regenerated branch
        const currentBranch = updatedMessage.branches.find(b => b.id === updatedMessage.activeBranchId);
        console.log(`[DEBUG CAPTURE] Branch ${updatedMessage.activeBranchId}: branchObj found = ${!!currentBranch}`);

        if (currentBranch) {
          // Get the participant for mode info
          const responderParticipant = participants.find(p => p.id === participantId);
          
          // Compute actual format used (same logic as applyBackroomPromptIfNeeded)
          const modelSupportsPrefill = modelConfig.provider === 'anthropic' || modelConfig.provider === 'bedrock' || modelConfig.supportsPrefill === true;
          const participantMode = responderParticipant?.conversationMode;
          const wantsPrefill = !participantMode || participantMode === 'auto' || participantMode === 'prefill';
          const actualFormat = (conversation.format === 'prefill' && modelSupportsPrefill && wantsPrefill) ? 'prefill' : 'messages';
          
          // Store the raw API request with inference metadata
          const debugRequest = {
            ...rawRequest,
            provider: modelConfig.provider,
            settings: responderSettings,
            // Inference format metadata
            conversationFormat: conversation.format,
            participantConversationMode: participantMode || 'auto',
            actualFormatUsed: actualFormat
          };

          // Store the response (content is already in the branch)
          const debugResponse = {
            content: currentBranch.content,
            contentBlocks: currentBranch.contentBlocks,
            model: currentBranch.model
          };

          console.log(`[DEBUG CAPTURE] Updating message branch ${updatedMessage.activeBranchId}...`);
          await db.updateMessageBranch(
            updatedMessage.id,
            conversation.userId,
            updatedMessage.activeBranchId,
            {
              debugRequest,
              debugResponse
            }
          );
          console.log(`[DEBUG CAPTURE] Branch ${updatedMessage.activeBranchId} updated successfully`);

          // Send update to frontend so bug icon appears immediately
          const refreshedMessage = await db.getMessage(updatedMessage.id, conversation.id, conversation.userId);
          if (refreshedMessage) {
            const updateEvent = {
              type: 'message_edited',
              message: refreshedMessage
            };
            ws.send(JSON.stringify(updateEvent));
            roomManager.broadcastToRoom(conversation.id, updateEvent, ws);
          }
        }
        console.log('[DEBUG CAPTURE] Debug data capture complete for regenerate');
      } else {
        console.log('[DEBUG CAPTURE] No raw request available (non-Anthropic provider?)');
      }
    } catch (debugError) {
      console.error('[DEBUG CAPTURE] Failed to capture debug data:', debugError);
      // Don't fail the whole request if debug capture fails
    }
  } catch (error) {
    endGeneration(conversation.userId, conversation.id);
    roomManager.endAiRequest(message.conversationId);

    // Check if this was an abort
    if (error instanceof Error && error.message === 'Generation aborted') {
      console.log(`[Abort] Regeneration was aborted for conversation ${message.conversationId}`);
      ws.send(JSON.stringify({
        type: 'stream',
        messageId: updatedMessage.id,
        branchId: updatedMessage.activeBranchId,
        content: '',
        isComplete: true,
        aborted: true
      }));
      return;
    }
    
    console.error('Regeneration error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    ws.send(JSON.stringify({
      type: 'error',
      error: errorMsg.length < 150 ? errorMsg : 'Failed to regenerate response'
    }));
  }
}

async function handleEdit(
  ws: AuthenticatedWebSocket,
  message: Extract<WsMessage, { type: 'edit' }>,
  db: Database,
  inferenceService: EnhancedInferenceService,
  baseInferenceService: InferenceService
) {
  if (!ws.userId) return;

  // First verify conversation access (handles both owner and collaboration)
  const conversation = await db.getConversation(message.conversationId, ws.userId);
  if (!conversation) {
    ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found or access denied' }));
    return;
  }
  
  // Check if user can chat (owner or collaborator/editor)
  const canChat = await db.canUserChatInConversation(message.conversationId, ws.userId);
  if (!canChat) {
    ws.send(JSON.stringify({ type: 'error', error: 'You do not have permission to edit in this conversation' }));
    return;
  }

  // Use conversation.userId (the owner) to fetch message
  const msg = await db.getMessage(message.messageId, message.conversationId, conversation.userId);
  if (!msg) {
    ws.send(JSON.stringify({ type: 'error', error: 'Message not found' }));
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
    message.conversationId,
    conversation.userId,
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

  const userEditEvent = {
    type: 'message_edited',
    message: updatedMessage
  };
  ws.send(JSON.stringify(userEditEvent));
  
  // Broadcast to other users in the room
  roomManager.broadcastToRoom(message.conversationId, userEditEvent, ws);

  // If this was a user message, automatically generate an assistant response
  if (branch.role === 'user') {
    // Get all messages to find the position of the edited message
    const allMessages = await db.getConversationMessages(msg.conversationId, ws.userId);
    const editedMessageIndex = allMessages.findIndex(m => m.id === msg.id);
    
    // Get participants early to determine responderId
    const participants = await db.getConversationParticipants(conversation.id, ws.userId);
    
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
    
    // Get the responder's model early for branch creation
    let responderModel = conversation.model;
    if (responderId && participants.length > 0) {
      const responderParticipant = participants.find(p => p.id === responderId);
      if (responderParticipant && responderParticipant.model) {
        responderModel = responderParticipant.model;
      }
    }

    if (!(await userHasSufficientCredits(db, conversation.userId, responderModel))) {
      sendInsufficientCreditsError(ws);
      return;
    }

    // Check if there's already an assistant message after this user message
    const nextMessage = editedMessageIndex + 1 < allMessages.length ? allMessages[editedMessageIndex + 1] : null;
    
    let assistantMessage: Message | null;
    
    if (nextMessage && nextMessage.branches.some(b => b.role === 'assistant')) {
      // Add a new branch to the existing assistant message
      const newBranch = await db.addMessageBranch(
        nextMessage.id,
        nextMessage.conversationId,
        conversation.userId,
        '',
        'assistant',
        updatedMessage.activeBranchId, // Parent is the edited user message's active branch
        responderModel,  // Use responder's model, not conversation model
        responderId // Assistant participant ID
      );
      
      if (!newBranch) {
        ws.send(JSON.stringify({ type: 'error', error: 'Failed to create assistant branch' }));
        return;
      }
      
      assistantMessage = newBranch;
      
      // Send the updated message with new branch
      const assistantEditEvent = {
        type: 'message_edited',
        message: assistantMessage
      };
      ws.send(JSON.stringify(assistantEditEvent));
      
      // Broadcast to other users
      roomManager.broadcastToRoom(message.conversationId, assistantEditEvent, ws);
    } else {
      // No assistant message exists after this user message, create a new one
      // But we need to manually set the parentBranchId
      assistantMessage = await db.createMessage(
        msg.conversationId,
        conversation.userId,
        '',
        'assistant',
        responderModel,  // Use responder's model, not conversation model
        updatedMessage.activeBranchId, // Parent is the edited user message's active branch
        responderId // Assistant participant ID
      );
      
      // Send assistant message to frontend
      const createEvent = {
        type: 'message_created',
        message: assistantMessage
      };
      ws.send(JSON.stringify(createEvent));
      
      // Broadcast to other users
      roomManager.broadcastToRoom(message.conversationId, createEvent, ws);
    }
    
    // Build conversation history using the utility function
    // We need to include the edited message in place of the original
    const historyMessages = buildConversationHistory(
      allMessages, 
      updatedMessage.activeBranchId,
      { messageId: updatedMessage.id, message: updatedMessage }
    );
    
    // Filter out messages hidden from AI
    const filteredHistoryMessages = filterHiddenFromAiMessages(historyMessages);
    
    // Get the responder's settings (we already have responderModel from earlier)
    let responderSettings = conversation.settings;
    let responderSystemPrompt = conversation.systemPrompt;
    let responderParticipant: Participant | undefined;
    
    if (responderId && participants.length > 0) {
      responderParticipant = participants.find(p => p.id === responderId);
      if (responderParticipant) {
        responderSystemPrompt = responderParticipant.systemPrompt || conversation.systemPrompt;
        
        // For standard conversations, always use conversation settings
        // For prefill/group chat, merge participant and conversation settings
        if (conversation.format === 'standard') {
          responderSettings = conversation.settings;
        } else {
          responderSettings = {
            temperature: responderParticipant.settings?.temperature ?? conversation.settings.temperature,
            maxTokens: responderParticipant.settings?.maxTokens ?? conversation.settings.maxTokens,
            topP: responderParticipant.settings?.topP ?? conversation.settings.topP,
            topK: responderParticipant.settings?.topK ?? conversation.settings.topK,
            // Always use conversation-level thinking settings
            thinking: conversation.settings.thinking,
            // Include model-specific settings (e.g., image resolution)
            modelSpecific: responderParticipant.settings?.modelSpecific ?? conversation.settings.modelSpecific
          };
        }
      }
    }
    
    // Stream response
    try {
      const targetMessage = assistantMessage!;
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
      const modelConfig = await modelLoader.getModelById(responderModel, conversation.userId);
      if (!modelConfig) {
        throw new Error(`Model ${responderModel} not found`);
      }
      
      // Validate pricing is configured BEFORE making inference call
      const pricingCheck = await validatePricingAvailable(modelConfig);
      if (!pricingCheck.valid) {
        console.error(`[Edit] Pricing validation failed for model ${responderModel}:`, pricingCheck.error);
        ws.send(JSON.stringify({
          type: 'error',
          error: USER_FACING_ERRORS.PRICING_NOT_CONFIGURED.message,
          details: pricingCheck.error
        }));
        return;
      }
      
      // Apply backroom prompt for early group chats if conditions are met
      const responderParticipantEdit = responderId ? participants.find(p => p.id === responderId) : undefined;
      responderSystemPrompt = applyBackroomPromptIfNeeded({
        conversationFormat: conversation.format,
        messageCount: filteredHistoryMessages.length,
        modelProvider: modelConfig.provider,
        modelSupportsPrefill: modelConfig.supportsPrefill,
        participantConversationMode: responderParticipantEdit?.conversationMode,
        existingSystemPrompt: responderSystemPrompt || ''
      });
      
      await inferenceService.streamCompletion(
        modelConfig,
        filteredHistoryMessages,
        responderSystemPrompt || '',
        responderSettings,
        conversation.userId,
        async (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => {
          const currentBranch = targetMessage.branches.find(b => b.id === targetBranchId);
          if (currentBranch) {
            currentBranch.content += chunk;
            
            // Store content blocks if provided
            if (contentBlocks && contentBlocks.length > 0) {
              currentBranch.contentBlocks = contentBlocks;
            }
            
            // Trim whitespace on completion
            if (isComplete) {
              currentBranch.content = currentBranch.content.trim();
            }
            
            // Save partial content periodically
            if (currentBranch.content.length % 500 === 0 || isComplete) {
              await db.updateMessageContent(
                targetMessage.id,
                targetMessage.conversationId,
                conversation.userId!,
                targetBranchId,
                currentBranch.content,
                currentBranch.contentBlocks
              );
            }
          }

          const streamData = {
            type: 'stream',
            messageId: targetMessage.id,
            branchId: targetBranchId,
            content: chunk,
            contentBlocks: contentBlocks,
            isComplete
          };
          ws.send(JSON.stringify(streamData));
          
          // Broadcast to other users
          roomManager.broadcastToRoom(message.conversationId, streamData, ws);
        },
        conversation,
        responderParticipant,
        async (metrics) => {
          // Store metrics in database
          await db.addMetrics(conversation.id, conversation.userId, metrics);
          
          // Send metrics update to client
          ws.send(JSON.stringify({
            type: 'metrics_update',
            conversationId: conversation.id,
            metrics
          }));
        },
        participants
      );
      
      // Capture debug request/response for researchers
      console.log('[DEBUG CAPTURE] Starting debug data capture for edit...');
      try {
        const rawRequest = baseInferenceService.lastRawRequest;
        console.log(`[DEBUG CAPTURE] Raw request available for edit: ${!!rawRequest}`);

        if (rawRequest && targetMessage) {
          const currentBranch = targetMessage.branches.find(b => b.id === targetBranchId);
          if (currentBranch) {
            // Compute actual format used
            const modelSupportsPrefill = modelConfig.provider === 'anthropic' || modelConfig.provider === 'bedrock' || modelConfig.supportsPrefill === true;
            const participantMode = responderParticipantEdit?.conversationMode;
            const wantsPrefill = !participantMode || participantMode === 'auto' || participantMode === 'prefill';
            const actualFormat = (conversation.format === 'prefill' && modelSupportsPrefill && wantsPrefill) ? 'prefill' : 'messages';
            
            const debugRequest = {
              ...rawRequest,
              provider: modelConfig.provider,
              settings: responderSettings,
              conversationFormat: conversation.format,
              participantConversationMode: participantMode || 'auto',
              actualFormatUsed: actualFormat
            };

            const debugResponse = {
              content: currentBranch.content,
              contentBlocks: currentBranch.contentBlocks,
              model: currentBranch.model
            };

            await db.updateMessageBranch(
              targetMessage.id,
              conversation.userId,
              targetBranchId,
              { debugRequest, debugResponse }
            );
            console.log(`[DEBUG CAPTURE] Edit branch ${targetBranchId} updated successfully`);

            // Send update to frontend
            const refreshedMessage = await db.getMessage(targetMessage.id, conversation.id, conversation.userId);
            if (refreshedMessage) {
              ws.send(JSON.stringify({ type: 'message_edited', message: refreshedMessage }));
              roomManager.broadcastToRoom(conversation.id, { type: 'message_edited', message: refreshedMessage }, ws);
            }
          }
        }
      } catch (debugError) {
        console.error('[DEBUG CAPTURE] Failed to capture debug data for edit:', debugError);
      }
    } catch (error) {
      console.error('Error generating response to edited message:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      ws.send(JSON.stringify({
        type: 'error',
        error: errorMsg.length < 150 ? errorMsg : 'Failed to generate response'
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
    
    // Get the conversation to verify access
    const conversation = await db.getConversation(conversationId, ws.userId!);
    if (!conversation) {
      ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found or access denied' }));
      return;
    }
    
    // Check if user can delete (owner or editor)
    const canDelete = await db.canUserDeleteInConversation(conversationId, ws.userId!);
    if (!canDelete) {
      ws.send(JSON.stringify({ type: 'error', error: 'You do not have permission to delete messages in this conversation' }));
      return;
    }
    
    // Delete the message branch and all its descendants
    const deleted = await db.deleteMessageBranch(messageId, conversationId, conversation.userId, branchId);
    
    if (deleted) {
      const deleteEvent = {
        type: 'message_deleted',
        messageId,
        branchId,
        deletedMessages: deleted
      };
      
      // Send to requester
      ws.send(JSON.stringify(deleteEvent));
      
      // Broadcast to all other users in the room
      roomManager.broadcastToRoom(conversationId, deleteEvent, ws);
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
  inferenceService: EnhancedInferenceService,
  baseInferenceService: InferenceService
) {
  if (!ws.userId) return;

  const { conversationId, messageId, parentBranchId, responderId } = message;
  const samplingBranchCount = (message as any).samplingBranches || 1;
  
  if (samplingBranchCount > 1) {
    console.log(`[Continue] Sampling ${samplingBranchCount} response branches in parallel`);
  }
  
  try {
    // Verify conversation access
    const conversation = await db.getConversation(conversationId, ws.userId);
    if (!conversation) {
      ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found or access denied' }));
      return;
    }
    
    // Check if user can chat (owner or collaborator/editor)
    const canChat = await db.canUserChatInConversation(conversationId, ws.userId);
    if (!canChat) {
      ws.send(JSON.stringify({ type: 'error', error: 'You do not have permission to continue generation in this conversation' }));
      return;
    }

    // Get participants
    const participants = await db.getConversationParticipants(conversationId, conversation.userId);
    
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

    const responderModelId = responder.model || conversation.model;

    if (!(await userHasSufficientCredits(db, conversation.userId, responderModelId))) {
      sendInsufficientCreditsError(ws);
      return;
    }

    // Get messages and determine parent
    const messages = await db.getConversationMessages(conversationId, conversation.userId);
    
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
          messageWithSiblings.conversationId,
          conversation.userId,
          '', // empty content initially
          'assistant',
          parentBranchId,
          responderModelId,
          responder.id,
          undefined // no attachments
        );
      } else {
        // No siblings exist yet, create a new message
        console.log('Continue: Creating new message (no siblings found)');
        assistantMessage = await db.createMessage(
          conversationId,
          conversation.userId,
          '', // empty content initially
          'assistant',
          responderModelId,
          parentBranchId,
          responder.id
        );
      }
    } else {
      // No parent specified, create new message as usual
      assistantMessage = await db.createMessage(
        conversationId,
        conversation.userId,
        '', // empty content initially
        'assistant',
        responderModelId,
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
    const continueEvent = {
      type: 'message_created',
      message: assistantMessage
    };
    ws.send(JSON.stringify(continueEvent));
    
    // Broadcast to other users
    roomManager.broadcastToRoom(conversationId, continueEvent, ws);

    // Log WebSocket event
    await llmLogger.logWebSocketEvent({
      event: 'continue',
      conversationId,
      messageId,
      participantId: responder.id,
      model: responderModelId
    });

    // Build conversation history using the utility function
    const visibleHistory = parentBranchId 
      ? buildConversationHistory(messages, parentBranchId)
      : messages; // No parent specified, use all messages (default behavior)
    
    // Filter out messages hidden from AI
    const filteredHistory = filterHiddenFromAiMessages(visibleHistory);
    
    // Include the new assistant message in the messages array for prefill formatting
    const messagesWithNewAssistant = [...filteredHistory, assistantMessage];

    // Stream the completion
    const modelId = responder.model || conversation.model;
    
    if (!modelId) {
      throw new Error('No model specified for responder or conversation');
    }
    
    const modelLoader = ModelLoader.getInstance();
    const modelConfig = await modelLoader.getModelById(modelId, conversation.userId);
    if (!modelConfig) {
      throw new Error(`Model ${modelId} not found`);
    }
    
    // Validate pricing is configured BEFORE making inference call
    const pricingCheck = await validatePricingAvailable(modelConfig);
    if (!pricingCheck.valid) {
      console.error(`[Continue] Pricing validation failed for model ${modelId}:`, pricingCheck.error);
      ws.send(JSON.stringify({
        type: 'error',
        error: USER_FACING_ERRORS.PRICING_NOT_CONFIGURED.message,
        details: pricingCheck.error
      }));
      // Delete the empty assistant message we created
      await db.deleteMessage(assistantMessage.id, conversationId, conversation.userId);
      return;
    }
    
    // Create abort controller for this generation
    const abortController = startGeneration(conversation.userId, conversationId);
    
    // Track AI request in room manager
    roomManager.startAiRequest(conversationId, ws.userId!, assistantMessage.id);
    
    // Inference settings
    const inferenceSettings = conversation.format === 'standard'
      ? conversation.settings || { temperature: 1.0, maxTokens: 4096 }
        : {
            temperature: responder.settings?.temperature ?? conversation.settings?.temperature ?? 1.0,
            maxTokens: responder.settings?.maxTokens ?? conversation.settings?.maxTokens ?? 4096,
            topP: responder.settings?.topP ?? conversation.settings?.topP,
            topK: responder.settings?.topK ?? conversation.settings?.topK,
            thinking: conversation.settings?.thinking,
            // Include model-specific settings (e.g., image resolution, response modalities)
            modelSpecific: responder.settings?.modelSpecific ?? conversation.settings?.modelSpecific
        };
    
    try {
    // Prepare all branches for parallel sampling
    const branchesToGenerate: Array<{ branchId: string; branchContent: string }> = [
      { branchId: assistantBranch.id, branchContent: '' }
    ];
    
    // Create additional branches if sampling multiple responses
    if (samplingBranchCount > 1) {
      for (let i = 1; i < samplingBranchCount; i++) {
        const newBranchMessage = await db.addMessageBranch(
          assistantMessage.id,
          assistantMessage.conversationId,
          conversation.userId,
          '',
          'assistant',
          parentBranchId,
          responder.model || conversation.model,
          responder.id,
          undefined
        );
        
        if (newBranchMessage) {
          const newBranch = newBranchMessage.branches[newBranchMessage.branches.length - 1];
          branchesToGenerate.push({ branchId: newBranch.id, branchContent: '' });
          assistantMessage.branches.push(newBranch);
          
          ws.send(JSON.stringify({ type: 'message_edited', message: assistantMessage }));
          roomManager.broadcastToRoom(conversationId, { type: 'message_edited', message: assistantMessage, fromUserId: ws.userId }, ws);
        }
      }
      console.log(`[Continue] Created ${branchesToGenerate.length} branches for parallel sampling`);
    }
    
    // Determine system prompt with backroom logic for early group chats
    const continueSystemPrompt = applyBackroomPromptIfNeeded({
      conversationFormat: conversation.format,
      messageCount: filteredHistory.length,
      modelProvider: modelConfig.provider,
      modelSupportsPrefill: modelConfig.supportsPrefill,
      participantConversationMode: responder.conversationMode,
      existingSystemPrompt: responder.systemPrompt || conversation.systemPrompt || ''
    });
    
    // Helper function to run inference for a single branch
    const runBranchInference = async (branchId: string, branchIndex: number) => {
      let branchContent = '';
      
      await inferenceService.streamCompletion(
        modelConfig,
        messagesWithNewAssistant,
        continueSystemPrompt,
        inferenceSettings,
      ws.userId!,
      async (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => {
          branchContent += chunk;
        
          const currentBranch = assistantMessage.branches.find((b: any) => b.id === branchId);
          if (currentBranch) {
            currentBranch.content = branchContent;
        if (contentBlocks && contentBlocks.length > 0) {
              currentBranch.contentBlocks = contentBlocks;
            }
            if (isComplete) {
              currentBranch.content = branchContent.trim();
            }
            if (branchContent.length % 500 === 0 || isComplete) {
              await db.updateMessageContent(assistantMessage.id, conversationId, conversation.userId, branchId, currentBranch.content, currentBranch.contentBlocks);
            }
          }
          
          const streamData = {
          type: 'stream',
          messageId: assistantMessage.id,
            branchId: branchId,
          content: chunk,
          contentBlocks: contentBlocks,
            isComplete,
            branchIndex
          };
          ws.send(JSON.stringify(streamData));
          roomManager.broadcastToRoom(conversationId, streamData, ws);

        if (isComplete) {
            const finalBranch = assistantMessage.branches.find((b: any) => b.id === branchId);
            if (finalBranch) {
              await db.updateMessageContent(assistantMessage.id, conversationId, conversation.userId, branchId, finalBranch.content, finalBranch.contentBlocks);
          }
        }
      },
      conversation,
      responder,
      async (metrics) => {
          if (branchIndex === 0) {
        await db.addMetrics(conversation.id, conversation.userId, metrics);
            ws.send(JSON.stringify({ type: 'metrics_update', conversationId: conversation.id, metrics, branchIndex }));
          }
        },
        participants,
        abortController.signal
      );
    };
    
    // Run all branches in parallel
    await Promise.all(
      branchesToGenerate.map((branch, index) => runBranchInference(branch.branchId, index))
    );
    
    // Capture debug request/response for researchers
    console.log('[DEBUG CAPTURE] Starting debug data capture for continue...');
    try {
      const rawRequest = baseInferenceService.lastRawRequest;
      console.log(`[DEBUG CAPTURE] Raw request available: ${!!rawRequest}`);
      
      if (rawRequest) {
        // Compute actual format used (same logic as applyBackroomPromptIfNeeded)
        const modelSupportsPrefill = modelConfig.provider === 'anthropic' || modelConfig.provider === 'bedrock' || modelConfig.supportsPrefill === true;
        const participantMode = responder.conversationMode;
        const wantsPrefill = !participantMode || participantMode === 'auto' || participantMode === 'prefill';
        const actualFormat = (conversation.format === 'prefill' && modelSupportsPrefill && wantsPrefill) ? 'prefill' : 'messages';
        
        for (const branch of branchesToGenerate) {
          const branchObj = assistantMessage.branches.find((b: any) => b.id === branch.branchId);
          if (branchObj) {
            const debugRequest = {
              ...rawRequest,
              provider: modelConfig.provider,
              settings: inferenceSettings,
              // Inference format metadata
              conversationFormat: conversation.format,
              participantConversationMode: participantMode || 'auto',
              actualFormatUsed: actualFormat
            };
            
            const debugResponse = {
              content: branchObj.content,
              contentBlocks: branchObj.contentBlocks,
              model: branchObj.model
            };
            
            await db.updateMessageBranch(
              assistantMessage.id,
              conversation.userId,
              branch.branchId,
              { debugRequest, debugResponse }
            );
            console.log(`[DEBUG CAPTURE] Continue branch ${branch.branchId} updated`);
            
            // Send update to frontend so bug icon appears immediately
            const refreshedMessage = await db.getMessage(assistantMessage.id, conversationId, conversation.userId);
            if (refreshedMessage) {
              ws.send(JSON.stringify({ type: 'message_edited', message: refreshedMessage }));
              roomManager.broadcastToRoom(conversationId, { type: 'message_edited', message: refreshedMessage }, ws);
            }
          }
        }
        console.log('[DEBUG CAPTURE] Debug data capture complete for continue');
      }
    } catch (debugError) {
      console.error('[DEBUG CAPTURE] Failed to capture debug data for continue:', debugError);
    }
    
    // Send updated conversation after all complete
    const updatedConversation = await db.getConversation(conversationId, conversation.userId);
    if (updatedConversation) {
      ws.send(JSON.stringify({ type: 'conversation_updated', conversation: updatedConversation }));
    }
    
    } finally {
      endGeneration(conversation.userId, conversationId);
      roomManager.endAiRequest(conversationId);
    }

  } catch (error) {
    if (ws.userId) {
      endGeneration(ws.userId, conversationId);
    }
    roomManager.endAiRequest(conversationId);
    
    // Check if this was an abort
    if (error instanceof Error && error.message === 'Generation aborted') {
      console.log(`[Abort] Continue generation was aborted for conversation ${conversationId}`);
      // Note: assistantMessage/assistantBranch may not be defined if error happened early
      ws.send(JSON.stringify({
        type: 'generation_aborted',
        conversationId: conversationId,
        aborted: true
      }));
      return;
    }
    
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
