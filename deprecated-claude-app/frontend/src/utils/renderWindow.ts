/**
 * Which message groups of a long conversation are mounted.
 *
 * The view mounts only the newest `count` groups of the active path; earlier
 * ones are added on demand (scrolling to the top, the "show earlier" button,
 * or navigating to a message). Counting from the end keeps the newest groups
 * mounted while new messages arrive.
 */

/** Number of groups added per "show earlier" step, and mounted on first load. */
export const RENDER_WINDOW_GROUPS = 30;

/** Index of the first mounted group. */
export function windowStart(totalGroups: number, count: number): number {
  return Math.max(0, totalGroups - count);
}

/**
 * The window size needed to mount the group that contains `messageId`, or
 * null if it is already mounted or not on the active path.
 */
export function countToReveal(
  groups: ReadonlyArray<{ messages: ReadonlyArray<{ id: string }> }>,
  messageId: string,
  count: number,
): number | null {
  const index = groups.findIndex(g => g.messages.some(m => m.id === messageId));
  if (index === -1 || index >= windowStart(groups.length, count)) return null;
  return groups.length - index;
}

/** Number of messages in the groups that are not mounted. */
export function hiddenMessageCount(
  groups: ReadonlyArray<{ messages: ReadonlyArray<unknown> }>,
  count: number,
): number {
  let hidden = 0;
  const start = windowStart(groups.length, count);
  for (let i = 0; i < start; i++) hidden += groups[i].messages.length;
  return hidden;
}
