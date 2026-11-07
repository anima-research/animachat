/**
 * Map a point in the *rendered* message (what the user right-clicked) back to a
 * character index in the *source* content (what the backend splits).
 *
 * Why this exists (2026-11-06): the previous implementation read
 * `window.getSelection()` — which a right-click does not move, so after the first
 * split the stale caret from the earlier click was reused — and then located the
 * text with `indexOf`, i.e. the FIRST occurrence in the source, which lands early
 * whenever the phrase repeats, the context is short, or the rendered text carries
 * `&nbsp;` where the source has spaces. Both made every split after the first cut
 * earlier than the click.
 */

const NBSP = / /g;

/** Rendered text of a container up to a (node, offset) caret, and its total length. */
export function renderedPrefix(container: Node, node: Node, offset: number): { prefix: string; total: string } | null {
  if (!container.contains(node)) return null;
  const doc = container.ownerDocument || document;
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let prefix = '';
  let total = '';
  let reached = false;
  let current: Node | null = walker.nextNode();
  // Caret on an element node means "before its offset-th child"; resolve to the
  // first text node at/after that child so the prefix stops in the right place.
  let caretText: Node | null = null;
  let caretOffset = offset;
  if (node.nodeType === Node.TEXT_NODE) {
    caretText = node;
  } else {
    const child = node.childNodes[offset] || null;
    caretText = child ? firstTextIn(child, doc) : null;
    caretOffset = 0;
    if (!caretText) {
      // caret after the last child of the element: everything inside it is "before"
      const all = textOf(container);
      const inside = textOf(node);
      const idx = all.indexOf(inside);
      const p = (idx >= 0 ? all.slice(0, idx + inside.length) : all);
      return { prefix: p.replace(NBSP, ' '), total: all.replace(NBSP, ' ') };
    }
  }
  while (current) {
    const text = current.textContent || '';
    if (!reached) {
      if (current === caretText) {
        prefix += text.slice(0, caretOffset);
        reached = true;
      } else {
        prefix += text;
      }
    }
    total += text;
    current = walker.nextNode();
  }
  if (!reached) return null;
  return { prefix: prefix.replace(NBSP, ' '), total: total.replace(NBSP, ' ') };
}

function firstTextIn(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return node;
  const w = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  return w.nextNode();
}

function textOf(node: Node): string {
  return node.textContent || '';
}

/** The caret under a point, in the browser's dialect of the API. */
export function caretAtPoint(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const anyDoc = doc as any;
  if (typeof anyDoc.caretPositionFromPoint === 'function') {
    const pos = anyDoc.caretPositionFromPoint(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
  }
  if (typeof anyDoc.caretRangeFromPoint === 'function') {
    const range = anyDoc.caretRangeFromPoint(x, y);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

function normalize(s: string): string {
  return s.replace(NBSP, ' ');
}

function allIndexes(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

/**
 * Source index to split at, given the rendered text before the click and the
 * whole rendered text. Returns -1 when no honest answer exists.
 *
 * Strategy: the split point is "right after the text the user clicked", so the
 * tail of the rendered prefix is the anchor. Search the source for that tail,
 * growing it until it occurs exactly once; if the markup in the source breaks a
 * long tail, shrink instead. When several occurrences remain, take the one
 * nearest to where the click sits proportionally in the text — never blindly
 * the first.
 */
export function sourceSplitIndex(source: string, prefix: string, total: string): number {
  const src = normalize(source);
  const pre = normalize(prefix);
  const tot = normalize(total);
  if (!pre.trim()) return -1;
  const estimate = tot.length > 0 ? Math.round((pre.length / tot.length) * src.length) : 0;

  const nearest = (idxs: number[], len: number) =>
    idxs.reduce((best, i) => (Math.abs(i + len - estimate) < Math.abs(best + len - estimate) ? i : best), idxs[0]) + len;

  // 1. grow from a modest tail until unique
  const MIN = 12, MAX = 160;
  let lastHits: { idxs: number[]; len: number } | null = null;
  for (let len = Math.min(MIN, pre.length); len <= Math.min(MAX, pre.length); len += 8) {
    const tail = pre.slice(pre.length - len);
    const idxs = allIndexes(src, tail);
    if (idxs.length === 1) return idxs[0] + tail.length;
    if (idxs.length > 1) { lastHits = { idxs, len: tail.length }; continue; }
    break; // 0 hits: markup got in the way; stop growing
  }
  if (lastHits) return nearest(lastHits.idxs, lastHits.len);

  // 2. shrink: tails shorter than MIN. A longer tail is worth more, but a hit far
  // from where the click sits is worth less — score both, never take the first
  // length that happens to match somewhere (that is how a lone far match won).
  let best: { score: number; pos: number } | null = null;
  for (let len = Math.min(MIN - 1, pre.length); len >= 4; len--) {
    const tail = pre.slice(pre.length - len);
    for (const i of allIndexes(src, tail)) {
      const pos = i + tail.length;
      const score = Math.abs(pos - estimate) - 3 * len;
      if (!best || score < best.score) best = { score, pos };
    }
  }
  if (best) return best.pos;

  // 3. last resort: the trailing run of word characters (text nodes of adjacent
  // blocks are concatenated without a separator, so "near.The" must yield "The")
  const m = pre.match(/[\p{L}\p{N}_]+$/u);
  if (m) {
    const idxs = allIndexes(src, m[0]);
    if (idxs.length) return nearest(idxs, m[0].length);
  }
  return -1;
}
