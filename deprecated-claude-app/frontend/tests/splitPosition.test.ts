// Run: npm test -w frontend   (= node --import tsx --test tests/*.test.ts, from deprecated-claude-app)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceSplitIndex, maskMarkup, alignPrefix, isTap, selectionEndIn } from '../src/utils/splitPosition.js';

/** rendered prefix = rendered text up to and including the Nth occurrence of clickAfter */
function at(source: string, rendered: string, clickAfter: string, occurrence = 1): number {
  let idx = -1;
  for (let n = 0; n < occurrence; n++) idx = rendered.indexOf(clickAfter, idx + 1);
  assert.notEqual(idx, -1, `test setup: "${clickAfter}" #${occurrence} not in rendered`);
  return sourceSplitIndex(source, rendered.slice(0, idx + clickAfter.length), rendered);
}
/** source index just after the Nth occurrence of `s` in `src` */
function after(src: string, s: string, occurrence = 1): number {
  let idx = -1;
  for (let n = 0; n < occurrence; n++) idx = src.indexOf(s, idx + 1);
  return idx + s.length;
}

test('repeated phrase: the Nth click lands in the Nth occurrence', () => {
  const s = 'The cat sat on the mat. The cat sat on the mat again. The cat sat down.';
  assert.equal(at(s, s, 'The cat sat', 1), after(s, 'The cat sat', 1));
  assert.equal(at(s, s, 'The cat sat', 2), after(s, 'The cat sat', 2));
  assert.equal(at(s, s, 'The cat sat', 3), after(s, 'The cat sat', 3));
});

test('markdown markup between rendered and source', () => {
  const src = 'Some **bold text** here and **bold text** there, and plain bold text last.';
  const rendered = 'Some bold text here and bold text there, and plain bold text last.';
  assert.equal(at(src, rendered, 'bold text', 1), after(src, 'bold text', 1));
  assert.equal(at(src, rendered, 'bold text', 2), after(src, 'bold text', 2));
  assert.equal(at(src, rendered, 'bold text', 3), after(src, 'bold text', 3));
});

test('greptile 1: a formatted phrase is not confused with its later plain copy', () => {
  const src = 'This **is great** news. This is great news yet again.';
  const rendered = 'This is great news. This is great news yet again.';
  assert.equal(at(src, rendered, 'great', 1), after(src, 'great', 1)); // 15, not 37
  assert.equal(at(src, rendered, 'great', 2), after(src, 'great', 2));
});

test('greptile 2: a long link target does not pull the cut to the next repeat', () => {
  const src = 'The cat sat on the mat. The cat sat on the mat. [link](https://example.com/a/very/long/url/that/is/not/rendered/anywhere/at/all)';
  const rendered = 'The cat sat on the mat. The cat sat on the mat. link';
  assert.equal(at(src, rendered, 'The cat sat', 1), after(src, 'The cat sat', 1)); // 11, not 35
  assert.equal(at(src, rendered, 'The cat sat', 2), after(src, 'The cat sat', 2));
  assert.equal(at(src, rendered, 'link', 1), after(src, 'link', 1));
});

test('greptile 4: a click right after the first word of a paragraph still resolves', () => {
  const src = 'Hello\n\nThere is more text';
  const rendered = 'HelloThere is more text'; // adjacent blocks: text nodes concatenate without a separator
  assert.equal(at(src, rendered, 'The', 1), after(src, 'The', 1));
  assert.equal(at(src, rendered, 'Hello', 1), after(src, 'Hello', 1));
});

test('nbsp from the renderer does not move the split', () => {
  const src = 'alpha  beta  gamma  delta  beta  gamma  omega';
  const rendered = src.replace(/ {2}/g, '  ');
  assert.equal(at(src, rendered, 'gamma', 2), after(src, 'gamma', 2));
});

test('short context at a paragraph start resolves to the clicked paragraph', () => {
  const src = 'Intro line.\n\nThe end is near.\n\nThe end.';
  const rendered = 'Intro line.The end is near.The end.';
  assert.equal(at(src, rendered, 'The', 2), after(src, 'The', 2));
});

test('lists, headings, quotes, code and html are skipped by the mask', () => {
  const src = '# Title\n\n- first item\n- second item\n\n> quoted `code` here\n\n```js\nconst x = 1;\n```\n\n<b>bold</b> end';
  const rendered = 'Titlefirst itemsecond itemquoted code hereconst x = 1;bold end';
  assert.equal(at(src, rendered, 'second item', 1), after(src, 'second item', 1));
  assert.equal(at(src, rendered, 'code', 1), after(src, 'code', 1));
  assert.equal(at(src, rendered, 'x = 1;', 1), after(src, 'x = 1;', 1));
  assert.equal(at(src, rendered, 'bold', 1), after(src, 'bold', 1));
  assert.equal(maskMarkup(src).length, src.length);
});

test('alignment loses the thread on rendered math and the fallback still answers', () => {
  const src = 'Energy is $E = mc^2$ and that is all. Energy is the point.';
  const rendered = 'Energy is E=mc2 and that is all. Energy is the point.'; // KaTeX text differs from source
  const pos = at(src, rendered, 'Energy is the', 1);
  assert.equal(pos, after(src, 'Energy is the', 1));
});

test('alignPrefix returns -1 when a rendered character has no source within the window', () => {
  assert.equal(alignPrefix('abc', 'abz'), -1);
  assert.equal(alignPrefix('a  b  c', 'abc'), 7);
});

test('empty or whitespace prefix is refused', () => {
  assert.equal(sourceSplitIndex('abc def', '', 'abc def'), -1);
  assert.equal(sourceSplitIndex('abc def', '   ', 'abc def'), -1);
});

test('isTap: a still, short touch is a tap; a scroll or a long-press is not', () => {
  const p = (x: number, y: number, t = 0) => ({ x, y, t });
  assert.equal(isTap(p(100, 200), p(100, 200, 120)), true);
  assert.equal(isTap(p(100, 200), p(105, 204, 120)), true); // ~6.4 px jitter
  assert.equal(isTap(p(100, 200), p(100, 208, 120)), false); // 8 px: the slop is exclusive
  assert.equal(isTap(p(100, 200), p(100, 120, 120)), false); // a scroll
  assert.equal(isTap(p(0, 0), p(3, 0)), true);
  assert.equal(isTap(p(0, 0), p(3, 0), 2), false); // custom slop
  assert.equal(isTap(p(0, 0, 1000), p(0, 0, 1500)), true); // 500 ms: the limit is inclusive
  assert.equal(isTap(p(0, 0, 1000), p(0, 0, 1501)), false); // a long-press
  assert.equal(isTap(p(0, 0), p(0, 0, 900), 8, 1000), true); // custom duration
});

test('selectionEndIn: only a non-empty selection that ends inside the container', () => {
  const inside = {}, outside = {};
  const container = { contains: (n: unknown) => n === inside } as unknown as Node;
  const range = (endContainer: unknown, collapsed = false) => ({
    endContainer, collapsed,
    cloneRange() { return { endContainer, collapsed: false, collapse(toStart: boolean) { this.collapsed = !toStart; } }; }
  });
  const doc = (r: ReturnType<typeof range> | null, isCollapsed = false) => ({
    getSelection: () => (r ? { rangeCount: 1, isCollapsed, getRangeAt: () => r } : null)
  }) as unknown as Pick<Document, 'getSelection'>;

  const end = selectionEndIn(container, doc(range(inside)));
  assert.ok(end);
  assert.equal(end.endContainer, inside);
  assert.equal(end.collapsed, true); // collapsed to its end, a copy
  assert.equal(selectionEndIn(container, doc(range(outside))), null); // another message
  assert.equal(selectionEndIn(container, doc(range(inside), true)), null); // just a caret
  assert.equal(selectionEndIn(container, doc(null)), null);
});
