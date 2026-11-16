// Search inside one conversation, across every branch of every message.
// Pure functions so the matcher can be tested without a DOM (tests/conversationSearch.test.ts).

export interface SearchQuery {
  /** A branch matches when every term occurs (AND), case-insensitively. */
  terms: string[];
}

export const MIN_QUERY_LENGTH = 2;
export const SNIPPET_LENGTH = 160;

/**
 * `"exact phrase"` is one term; bare words are separate terms; all must occur.
 * Returns null when the query is too short to search.
 */
export function parseQuery(raw: string): SearchQuery | null {
  const terms: string[] = [];
  const quoted = /"([^"]*)"/g;
  let rest = raw;
  for (const m of raw.matchAll(quoted)) {
    const phrase = m[1].trim();
    if (phrase) terms.push(phrase);
    rest = rest.replace(m[0], ' ');
  }
  // An unclosed quote is just a character the user is still typing.
  for (const word of rest.replace(/"/g, ' ').split(/\s+/)) {
    if (word) terms.push(word);
  }
  const total = terms.reduce((n, t) => n + t.length, 0);
  if (terms.length === 0 || total < MIN_QUERY_LENGTH) return null;
  return { terms };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termRegExp(term: string): RegExp {
  // Case-insensitive via the regex rather than toLowerCase(), so indices stay
  // valid for characters whose lower case has a different length.
  return new RegExp(escapeRegExp(term), 'giu');
}

/** Index of the earliest occurrence of any term, or -1 if some term is missing. */
export function matchIndex(text: string, query: SearchQuery): number {
  let first = -1;
  for (const term of query.terms) {
    const re = termRegExp(term);
    const m = re.exec(text);
    if (!m) return -1;
    if (first === -1 || m.index < first) first = m.index;
  }
  return first;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * ~`length` chars of `text` around the first hit (a third before, the rest
 * after), whitespace collapsed, HTML-escaped, with every occurrence of every
 * term wrapped in <mark>.
 */
export function buildSnippet(text: string, query: SearchQuery, length = SNIPPET_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ');
  const hit = Math.max(0, matchIndex(flat, query));

  let start = Math.max(0, hit - Math.floor(length / 3));
  let end = Math.min(flat.length, start + length);
  start = Math.max(0, end - length);
  const window = flat.slice(start, end);

  const ranges: [number, number][] = [];
  for (const term of query.terms) {
    for (const m of window.matchAll(termRegExp(term))) {
      ranges.push([m.index!, m.index! + m[0].length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  let out = '';
  let pos = 0;
  for (const [a, b] of merged) {
    out += escapeHtml(window.slice(pos, a)) + '<mark>' + escapeHtml(window.slice(a, b)) + '</mark>';
    pos = b;
  }
  out += escapeHtml(window.slice(pos));
  return (start > 0 ? '…' : '') + out + (end < flat.length ? '…' : '');
}

interface SearchableBranch {
  content?: string;
  contentBlocks?: Array<{ type: string; text?: string; thinking?: string }>;
}

/**
 * The text a reader can see in a branch: `content` (which also carries any
 * inline <thinking> tags) plus structured thinking blocks. Text blocks mirror
 * `content`, so they are only used when `content` is empty.
 */
export function branchSearchText(branch: SearchableBranch): string {
  const parts: string[] = [];
  const blocks = branch.contentBlocks || [];
  if (branch.content) parts.push(branch.content);
  else for (const b of blocks) if (b.type === 'text' && b.text) parts.push(b.text);
  for (const b of blocks) if (b.type === 'thinking' && b.thinking) parts.push(b.thinking);
  return parts.join('\n\n');
}
