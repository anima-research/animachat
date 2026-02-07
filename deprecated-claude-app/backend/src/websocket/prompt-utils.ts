import { Logger } from '../utils/logger.js';

/**
 * CLI simulation backroom prompt applied to early group chats.
 */
export const BACKROOM_PROMPT = 'The assistant is in CLI simulation mode, and responds to the user\'s CLI commands only with the output of the command.';

export interface BackroomPromptParams {
  conversationFormat: 'standard' | 'prefill';
  messageCount: number;
  modelProvider: string;
  modelSupportsPrefill?: boolean;
  participantConversationMode?: string;
  existingSystemPrompt: string;
  cliModePrompt?: { enabled: boolean; messageThreshold: number };
}

/**
 * Apply backroom CLI prompt for early group chats.
 * Only applies when:
 * 1. Conversation is in group chat (prefill) format
 * 2. Less than threshold messages in the conversation
 * 3. Model supports prefill
 * 4. Participant's mode is NOT explicitly set to 'messages' or 'completion'
 * 5. CLI mode is not disabled
 */
export function applyBackroomPromptIfNeeded(params: BackroomPromptParams): string {
  const {
    conversationFormat,
    messageCount,
    modelProvider,
    modelSupportsPrefill,
    participantConversationMode,
    existingSystemPrompt,
    cliModePrompt
  } = params;

  // Check if CLI mode prompt is disabled by toggle
  const cliEnabled = cliModePrompt?.enabled ?? true;
  const threshold = cliModePrompt?.messageThreshold ?? 10;

  if (!cliEnabled) {
    return existingSystemPrompt;
  }

  // Only for group chats with fewer than threshold messages
  if (conversationFormat !== 'prefill' || messageCount >= threshold) {
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

  // CLI mode is enabled and conditions are met - apply the backroom prompt
  // If there's an existing system prompt, prepend the CLI prompt to it
  if (existingSystemPrompt) {
    Logger.websocket(`[WebSocket] Applied backroom prompt + custom prompt (${messageCount} messages, provider: ${modelProvider})`);
    return `${BACKROOM_PROMPT}\n\n${existingSystemPrompt}`;
  }

  Logger.websocket(`[WebSocket] Applied backroom prompt (${messageCount} messages, provider: ${modelProvider})`);
  return BACKROOM_PROMPT;
}

export interface IdentityPromptParams {
  conversationFormat: 'standard' | 'prefill';
  participantName: string;
  participantConversationMode?: string;
  modelProvider: string;
  modelSupportsPrefill?: boolean;
  existingSystemPrompt: string;
  hasCustomSystemPrompt: boolean;
}

/**
 * Apply identity prompt for participants in 'messages' mode.
 * In 'messages' mode, the model only sees alternating user/assistant messages
 * and doesn't know its identity from the conversation format.
 *
 * This adds a default identity prompt like "You are {name}." which can be
 * overridden by the participant's custom system prompt.
 */
export function applyIdentityPromptIfNeeded(params: IdentityPromptParams): string {
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
