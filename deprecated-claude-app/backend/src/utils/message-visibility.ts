import { Message } from '@deprecated-claude/shared';

/**
 * Check if a single message should be visible to a user in blind mode.
 */
function isMessageVisibleToUser(
  message: Message,
  userId: string,
  visibility: 'normal' | 'blind' | undefined
): boolean {
  // Normal mode - always visible
  if (!visibility || visibility === 'normal') {
    return true;
  }

  const activeBranch = message.branches.find(b => b.id === message.activeBranchId);
  if (!activeBranch) return false;

  // Assistant messages always visible
  if (activeBranch.role === 'assistant') {
    return true;
  }

  // User's own messages visible
  return activeBranch.sentByUserId === userId;
}

/**
 * Create a redacted version of a message for blind mode.
 */
function redactMessage(message: Message): Message & { blindModeRedacted: boolean } {
  const redactedBranches = message.branches.map(branch => ({
    ...branch,
    content: '',
    contentBlocks: [],
    blindModeRedacted: true,
  }));

  return {
    ...message,
    branches: redactedBranches,
    blindModeRedacted: true,
  } as Message & { blindModeRedacted: boolean };
}

/**
 * Transform a message for a specific user in blind mode.
 * Returns the full message if visible, or a redacted version if hidden.
 * Used for both REST API and WebSocket broadcasts.
 */
export function transformMessageForUser(
  message: Message,
  userId: string,
  visibility: 'normal' | 'blind' | undefined
): Message {
  if (isMessageVisibleToUser(message, userId, visibility)) {
    return message;
  }
  return redactMessage(message);
}

/**
 * Apply blind mode redactions to an array of messages.
 * Used for REST API responses (GET /messages).
 *
 * In 'blind' mode, users can only see:
 * - Their own messages (sentByUserId matches)
 * - All assistant messages (Claude sees everything, users see all responses)
 *
 * Hidden messages are replaced with redacted placeholders so users know
 * something exists there, and the tree structure remains intact.
 */
export function applyBlindModeRedactions(
  messages: Message[],
  userId: string,
  visibility: 'normal' | 'blind' | undefined
): Message[] {
  // Normal mode or undefined - no filtering
  if (!visibility || visibility === 'normal') {
    return messages;
  }

  // Blind mode - transform each message
  return messages.map(message => transformMessageForUser(message, userId, visibility));
}
