import type { Participant, MessageBranch, Model } from '@deprecated-claude/shared';
import { getModelColor } from './modelColors';
import { getAvatarColor } from './avatars';

/**
 * Get the display name for a participant based on branch data.
 * Handles empty names (continuation participants), missing participants, and fallbacks.
 * 
 * @param branch - The message branch containing participantId and role
 * @param participants - List of conversation participants
 * @param options - Configuration options
 * @returns The display name to show in the UI
 */
export function getParticipantDisplayName(
  branch: MessageBranch | null | undefined,
  participants: Participant[] | null | undefined,
  options: {
    userFallback?: string;
    assistantFallback?: string;
    continuationLabel?: string;
    includeModelInContinuation?: boolean;
  } = {}
): string {
  const {
    userFallback = 'User',
    assistantFallback = 'Assistant',
    continuationLabel = '(continue)',
    includeModelInContinuation = false
  } = options;

  if (!branch) {
    return assistantFallback;
  }

  // If no participants list or no participantId, use role-based fallback
  if (!participants || !branch.participantId) {
    return branch.role === 'user' ? userFallback : (branch.model || assistantFallback);
  }

  // Find the participant by ID
  const participant = participants.find(p => p.id === branch.participantId);
  
  if (!participant) {
    // Participant not found - use role-based fallback
    return branch.role === 'user' ? userFallback : (branch.model || assistantFallback);
  }

  // Handle empty-name "continuation" participants
  if (participant.name === '') {
    if (includeModelInContinuation && participant.type === 'assistant' && participant.model) {
      return `${participant.model} ${continuationLabel}`;
    }
    return continuationLabel;
  }

  return participant.name;
}

/**
 * Resolve the color to use for a participant.
 * Priority: avatar pack color > model color > default
 * 
 * @param branch - The message branch
 * @param participants - List of conversation participants  
 * @param models - List of available models (for canonicalId lookup)
 * @param userColor - Color to use for user participants
 * @returns Hex color string
 */
export function resolveParticipantColor(
  branch: MessageBranch | null | undefined,
  participants: Participant[] | null | undefined,
  models: Model[] | null | undefined,
  userColor: string = '#bb86fc'
): string {
  if (!branch) {
    return getModelColor(undefined);
  }

  // Users get a fixed color
  if (branch.role === 'user') {
    return userColor;
  }

  // Determine the model ID
  let modelId: string | undefined;
  
  if (participants && branch.participantId) {
    const participant = participants.find(p => p.id === branch.participantId);
    modelId = participant?.model;
  }
  
  // Fallback to branch model
  if (!modelId) {
    modelId = branch.model;
  }

  // Try to get avatar pack color via canonicalId
  if (modelId && models) {
    const modelObj = models.find(m => m.id === modelId);
    if (modelObj?.canonicalId) {
      const avatarColor = getAvatarColor(modelObj.canonicalId);
      if (avatarColor) {
        return avatarColor;
      }
    }
  }

  // Fall back to default model colors
  return getModelColor(modelId);
}

