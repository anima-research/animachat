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
 *
 * How it works now: the rendered text before the caret is read from the DOM
 * (`renderedPrefix`), and `sourceSplitIndex` ALIGNS the whole prefix against the
 * source as a subsequence — markdown syntax, link targets and HTML tags are the
 * characters the alignment skips. Because the alignment starts at the beginning of
 * the message, a repeated phrase, a formatted phrase or a long URL cannot pull the
 * cut to another occurrence. A tail search remains only as a fallback for text the
 * alignment cannot follow (e.g. rendered math).
 */

/** Rendered text of `container` up to the DOM boundary (node, offset), and all of it. */
export function renderedPrefix(container: Node, node: Node, offset: number): { prefix: string; total: string } | null {
  if (!container.contains(node)) return null;
  const doc = container.ownerDocument || document;
  const range = doc.createRange();
  try {
    range.setStart(container, 0);
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  // Range.toString() is exactly the text before the boundary, in document order —
  // nothing after a <br> or an empty element gets pulled in.
  return { prefix: range.toString(), total: container.textContent || '' };
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

const NBSP = / /g;
const WS = /\s/;

/**
 * A copy of the source, same length, with the characters the renderer never shows
 * replaced by spaces: link/image targets, HTML tags, fence lines, emphasis and
 * code marks, heading/quote/list prefixes. Positions are preserved, so an index into
 * the mask is an index into the source.
 */
export function maskMarkup(source: string): string {
  let m = source;
  const blank = (s: string) => ' '.repeat(s.length);
  // link and image targets: keep the text in [...], blank "(...)" and the "![" / "](" marks
  m = m.replace(/\]\([^)\n]*\)/g, blank);
  m = m.replace(/!\[/g, blank).replace(/[\[\]]/g, ' ');
  // html tags and entities
  m = m.replace(/<\/?[a-zA-Z][^>\n]*>/g, blank);
  m = m.replace(/&(?:nbsp|amp|lt|gt|quot);/g, blank);
  // fenced code: the fence line itself (```lang) disappears, the code stays
  m = m.replace(/^[ \t]*(`{3,}|~{3,})[^\n]*$/gm, blank);
  // emphasis / strike / inline code marks
  m = m.replace(/\*{1,3}|_{1,3}|~~|`+/g, blank);
  // block prefixes at line start: headings, quotes, bullets, numbered lists, hr
  m = m.replace(/^[ \t]*#{1,6}[ \t]+/gm, blank);
  m = m.replace(/^[ \t]*>[ \t]?/gm, blank);
  m = m.replace(/^[ \t]*[-*+][ \t]+/gm, blank);
  m = m.replace(/^[ \t]*\d+[.)][ \t]+/gm, blank);
  m = m.replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, blank);
  // backslash escapes: show the escaped char, hide the backslash
  m = m.replace(/\\(?=[\\`*_{}\[\]()#+\-.!>])/g, ' ');
  return m;
}

/**
 * Align `rendered` (a prefix of the rendered text) against `mask` as a
 * subsequence, whitespace-insensitive on both sides. Returns the source index just
 * after the last aligned character, or -1 if the alignment loses the thread
 * (a rendered character that does not appear within `window` source characters —
 * e.g. KaTeX output, which has no source letters).
 */
export function alignPrefix(mask: string, rendered: string, window = 160): number {
  let i = 0; // source cursor
  let last = -1;
  const n = mask.length;
  for (let j = 0; j < rendered.length; j++) {
    const c = rendered[j];
    if (WS.test(c)) continue;
    // skip whitespace in the source too
    while (i < n && WS.test(mask[i])) i++;
    if (i < n && mask[i] === c) { last = i; i++; continue; }
    // look a bounded distance ahead (markup the mask did not know about)
    const k = mask.indexOf(c, i);
    if (k === -1 || k - i > window) return -1;
    last = k; i = k + 1;
  }
  return last + 1;
}

function allIndexes(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i !== -1) { out.push(i); i = hay.indexOf(needle, i + 1); }
  return out;
}

/**
 * Source index to split at, given the rendered text before the click and the
 * whole rendered text. Returns -1 when no honest answer exists.
 */
export function sourceSplitIndex(source: string, prefix: string, total: string): number {
  const src = source.replace(NBSP, ' ');
  const pre = prefix.replace(NBSP, ' ');
  const tot = total.replace(NBSP, ' ');
  if (!pre.trim()) return -1;

  // 1. alignment of the whole prefix — the normal path
  const mask = maskMarkup(src);
  const aligned = alignPrefix(mask, pre);
  if (aligned > 0) return Math.min(aligned, src.length);

  // 2. fallback: the alignment lost the thread somewhere before the click (text the
  //    mask cannot follow). Anchor on the last run of word characters of the prefix,
  //    choose the occurrence nearest to the click's proportional place.
  const estimate = tot.length > 0 ? Math.round((pre.length / tot.length) * src.length) : 0;
  const m = pre.match(/[\p{L}\p{N}_]+(?:[ .,;:!?'"-]+[\p{L}\p{N}_]+){0,4}$/u);
  const candidates = m ? [m[0], ...m[0].split(/\s+/).slice(-1)] : [];
  for (const needle of candidates) {
    const idxs = allIndexes(mask, needle);
    if (!idxs.length) continue;
    const best = idxs.reduce((b, i) => (Math.abs(i + needle.length - estimate) < Math.abs(b + needle.length - estimate) ? i : b), idxs[0]);
    return best + needle.length;
  }
  return -1;
}
