/**
 * Which message groups of a long conversation are mounted.
 *
 * The view mounts the active path from an anchor to the end. The anchor is
 * set when a conversation finishes loading (so the newest
 * RENDER_WINDOW_GROUPS groups are mounted) and after that only moves earlier:
 * scrolling to the top, the "show earlier" button, or navigating to a
 * message. New messages are appended to the mounted set and never push a
 * mounted group out, so a message being edited is not unmounted under the
 * user.
 *
 * The anchor is the id of the first mounted message, not a group index:
 * groups are re-formed when participants load (consecutive messages of one
 * speaker are merged), and an index would then point at different messages.
 */

/** Number of groups mounted on load, and added per "show earlier" step. */
export const RENDER_WINDOW_GROUPS = 30;

type Groups = ReadonlyArray<{ messages: ReadonlyArray<{ id: string }> }>;

/**
 * - `null`: not loaded yet; the newest groups are mounted.
 * - `'start'`: everything is mounted (a conversation that loaded short or empty).
 * - `{ messageId }`: mounted from the group holding that message.
 */
export type WindowAnchor = null | 'start' | { messageId: string };

function anchorAtGroup(groups: Groups, index: number): WindowAnchor {
  return index <= 0 ? 'start' : { messageId: groups[index].messages[0].id };
}

function newestStart(groups: Groups): number {
  return Math.max(0, groups.length - RENDER_WINDOW_GROUPS);
}

/** Anchor for a conversation that has just loaded. */
export function initialAnchor(groups: Groups): WindowAnchor {
  return anchorAtGroup(groups, newestStart(groups));
}

/**
 * Index of the first mounted group. If the anchor message is no longer on
 * the path (a branch switch, a deletion) or the path became shorter, at least
 * the newest RENDER_WINDOW_GROUPS stay mounted.
 */
export function windowStart(groups: Groups, anchor: WindowAnchor): number {
  if (anchor === 'start') return 0;
  const newest = newestStart(groups);
  if (anchor === null) return newest;
  const index = groups.findIndex(g => g.messages.some(m => m.id === anchor.messageId));
  return index === -1 ? newest : Math.min(index, newest);
}

/** Anchor after one "show earlier" step from `start`. */
export function earlierAnchor(groups: Groups, start: number): WindowAnchor {
  return anchorAtGroup(groups, start - RENDER_WINDOW_GROUPS);
}

/**
 * The anchor needed to mount the group that contains `messageId`, or null if
 * it is already mounted or not on the active path.
 */
export function anchorToReveal(groups: Groups, messageId: string, start: number): WindowAnchor | null {
  const index = groups.findIndex(g => g.messages.some(m => m.id === messageId));
  if (index === -1 || index >= start) return null;
  return anchorAtGroup(groups, index);
}

/** Number of messages in the groups before `start` (not mounted). */
export function hiddenMessageCount(groups: ReadonlyArray<{ messages: ReadonlyArray<unknown> }>, start: number): number {
  let hidden = 0;
  for (let i = 0; i < start && i < groups.length; i++) hidden += groups[i].messages.length;
  return hidden;
}
