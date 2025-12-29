/**
 * Authenticity verification for messages
 * 
 * Computes authenticity status for each message in a conversation path.
 * This is computed in a single O(N) pass over the visible messages.
 */

import type { Message, Participant } from '@deprecated-claude/shared';

export interface AuthenticityStatus {
  /** This specific message/branch has not been edited by a human */
  isUnaltered: boolean;
  
  /** 
   * Unaltered AND no splits with regenerated parts above AND no post-hoc operations
   */
  isSplitAuthentic: boolean;
  
  /**
   * Unaltered AND all previous messages unaltered AND no name collisions AND no post-hoc
   */
  isTraceAuthentic: boolean;
  
  /** Both split-authentic and trace-authentic */
  isFullyAuthentic: boolean;
  
  /** Fully authentic AND no branches above (single path) */
  isHardModeAuthentic: boolean;
  
  /** This is an AI message that was written/edited by a human (not generated) */
  isHumanWrittenAI: boolean;
  
  /** Legacy message with unknown authenticity (no creationSource) */
  isLegacy: boolean;
}

export type AuthenticityLevel = 
  | 'hard_mode'      // Highest - single path, fully authentic
  | 'full'           // Both split and trace authentic
  | 'split_only'     // Split authentic but not trace
  | 'trace_only'     // Trace authentic but not split
  | 'unaltered'      // Only this message is unaltered
  | 'altered'        // This message was edited
  | 'legacy'         // Unknown (no creationSource)
  | 'human_written'; // Human wrote an AI message

/**
 * Get the highest authenticity level from a status
 */
export function getAuthenticityLevel(status: AuthenticityStatus): AuthenticityLevel {
  if (status.isHumanWrittenAI) return 'human_written';
  if (status.isLegacy) return 'legacy';
  if (!status.isUnaltered) return 'altered';
  if (status.isHardModeAuthentic) return 'hard_mode';
  if (status.isFullyAuthentic) return 'full';
  if (status.isSplitAuthentic && !status.isTraceAuthentic) return 'split_only';
  if (status.isTraceAuthentic && !status.isSplitAuthentic) return 'trace_only';
  return 'unaltered';
}

/**
 * Compute authenticity for all messages in a visible path
 * 
 * @param messages - Visible messages in order
 * @param participants - All participants in the conversation
 * @returns Map of message ID to authenticity status
 */
export function computeAuthenticity(
  messages: Message[],
  participants: Participant[]
): Map<string, AuthenticityStatus> {
  const result = new Map<string, AuthenticityStatus>();
  
  if (!messages || messages.length === 0) {
    return result;
  }
  
  // Pre-compute: Check for name collisions between human and AI participants
  const humanNames = new Set<string>();
  const aiNames = new Set<string>();
  
  for (const p of participants) {
    if (p.type === 'user') {
      humanNames.add(p.name.toLowerCase());
    } else if (p.type === 'assistant') {
      aiNames.add(p.name.toLowerCase());
    }
  }
  
  const hasNameCollision = [...humanNames].some(name => aiNames.has(name));
  
  // Running state - once broken, stays broken for subsequent messages
  let editOccurredAbove = false;
  let splitRegeneratedAbove = false;
  let postHocUsedAbove = false;
  let branchesAbove = false;
  
  for (const msg of messages) {
    const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
    if (!activeBranch) {
      // No active branch found, skip
      continue;
    }
    
    const creationSource = (activeBranch as any).creationSource as string | undefined;
    
    // Check if this is a legacy message (no creationSource)
    const isLegacy = creationSource === undefined;
    
    // Determine if this branch was human-edited
    // For user messages: creationSource is always 'human_edit', that's expected
    // For assistant messages: 'human_edit' means a human wrote/edited the AI's response
    const isHumanWrittenAI = 
      activeBranch.role === 'assistant' && 
      creationSource === 'human_edit';
    
    // A message is "altered" if:
    // - It's an AI message with human_edit creationSource
    // - It's not the original branch (index > 0) for non-AI messages
    // For now, we consider creationSource to determine this
    const isThisAltered = isHumanWrittenAI;
    
    // Check for post-hoc operations on this message
    const hasPostHoc = !!(activeBranch as any).postHocOperation;
    
    // Check if this message resulted from a split that was then regenerated
    // A split message has creationSource === 'split'
    // If it has multiple branches, one of them might be a regeneration
    const isSplitMessage = creationSource === 'split';
    const hasSplitRegeneration = isSplitMessage && msg.branches.length > 1 &&
      msg.branches.some(b => (b as any).creationSource === 'regeneration');
    
    // Compute status
    const isUnaltered = !isThisAltered && !isLegacy;
    
    const isSplitAuthentic = 
      isUnaltered && 
      !splitRegeneratedAbove && 
      !postHocUsedAbove && 
      !hasPostHoc;
    
    const isTraceAuthentic = 
      isUnaltered && 
      !editOccurredAbove && 
      !hasNameCollision && 
      !postHocUsedAbove && 
      !hasPostHoc;
    
    const isFullyAuthentic = isSplitAuthentic && isTraceAuthentic;
    const isHardModeAuthentic = isFullyAuthentic && !branchesAbove;
    
    result.set(msg.id, {
      isUnaltered,
      isSplitAuthentic,
      isTraceAuthentic,
      isFullyAuthentic,
      isHardModeAuthentic,
      isHumanWrittenAI,
      isLegacy
    });
    
    // Update running state for next message
    if (isThisAltered) editOccurredAbove = true;
    if (hasSplitRegeneration) splitRegeneratedAbove = true;
    if (hasPostHoc) postHocUsedAbove = true;
    if (msg.branches.length > 1) branchesAbove = true;
  }
  
  return result;
}

/**
 * Get color for authenticity level
 */
export function getAuthenticityColor(level: AuthenticityLevel): string {
  switch (level) {
    case 'hard_mode': return '#2196F3';      // Bright blue
    case 'full': return '#42A5F5';           // Blue
    case 'split_only': return '#64B5F6';     // Medium blue
    case 'trace_only': return '#78909C';     // Blue-grey
    case 'unaltered': return '#81C784';      // Light green
    case 'altered': return '#FF9800';        // Orange/warning
    case 'legacy': return '#B0BEC5';         // Light blue-grey (more visible)
    case 'human_written': return '#E91E63';  // Pink/magenta
  }
}

/**
 * Get tooltip text for authenticity level
 */
export function getAuthenticityTooltip(level: AuthenticityLevel): string {
  switch (level) {
    case 'hard_mode':
      return 'Hard Mode Authentic: This message and all above are unaltered, with no branches or splits in the entire path.';
    case 'full':
      return 'Fully Authentic: This message is unaltered, with no splits or edits in the conversation history.';
    case 'split_only':
      return 'Split Authentic: No splits in history, but trace authenticity is broken (edits or name collisions above).';
    case 'trace_only':
      return 'Trace Authentic: Full trace integrity, but split authenticity is compromised.';
    case 'unaltered':
      return 'Unaltered: This specific message has not been edited, but the conversation history has alterations.';
    case 'altered':
      return 'Altered: This message has been edited by a human.';
    case 'legacy':
      return 'Legacy: This message predates authenticity tracking. Its origin cannot be verified.';
    case 'human_written':
      return 'Human-Written AI: This AI message was written or edited by a human, not generated.';
  }
}

