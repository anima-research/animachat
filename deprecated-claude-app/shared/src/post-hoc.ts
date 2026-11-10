import type { Attachment, PostHocOperation } from './types.js';

/**
 * What the post-hoc operations on a conversation path do to one message's
 * attachments. The message itself is never changed; this describes what the AI
 * is shown in its place. The backend (context building) and the frontend
 * (marking attachments as hidden or added) both derive it with the functions
 * below, so they cannot disagree.
 */
export interface PostHocAttachmentState {
  /** Indices into the target branch's own attachments that the AI does not see. */
  hiddenIndices: number[];
  /** Attachments the AI sees in addition, after the own ones that remain. */
  added: Attachment[];
}

/** True for an edit that changes attachments (it may change the content too). */
export function postHocEditsAttachments(op: PostHocOperation): boolean {
  return op.type === 'edit' && (op.attachmentIndices !== undefined || op.addedAttachments !== undefined);
}

/**
 * Fold one operation into its target message's attachment state. Call it with
 * the operations in conversation order.
 *
 * - 'hide_attachment' hides more of the message's own attachments.
 * - An 'edit' that carries attachment fields states the whole attachment
 *   change again, replacing what earlier operations did to these attachments.
 *   A content-only 'edit' leaves them alone.
 */
export function applyPostHocAttachmentOp(
  state: PostHocAttachmentState | undefined,
  op: PostHocOperation
): PostHocAttachmentState | undefined {
  if (op.type === 'hide_attachment') {
    if (!op.attachmentIndices || op.attachmentIndices.length === 0) return state;
    return {
      hiddenIndices: sortedUnique([...(state?.hiddenIndices ?? []), ...op.attachmentIndices]),
      added: state?.added ?? [],
    };
  }
  if (postHocEditsAttachments(op)) {
    return {
      hiddenIndices: sortedUnique(op.attachmentIndices ?? []),
      added: op.addedAttachments ?? [],
    };
  }
  return state;
}

/**
 * The attachments the AI sees for a message: its own minus the hidden ones,
 * then the added ones. Without a state the own list is returned as is.
 */
export function resolvePostHocAttachments<T>(
  own: T[] | undefined,
  state: { hiddenIndices: number[]; added: T[] } | undefined
): T[] | undefined {
  if (!state) return own;
  const hidden = new Set(state.hiddenIndices);
  const seen = [...(own ?? []).filter((_, index) => !hidden.has(index)), ...state.added];
  return own === undefined && seen.length === 0 ? undefined : seen;
}

function sortedUnique(indices: number[]): number[] {
  return [...new Set(indices)].sort((a, b) => a - b);
}
