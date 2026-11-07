// Run: node --import tsx --test splitPosition.test.ts   (from frontend)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceSplitIndex } from '../src/utils/splitPosition.js';

function at(source: string, rendered: string, clickAfter: string, occurrence = 1): number {
  // rendered prefix = rendered text up to and including the Nth occurrence of clickAfter
  let idx = -1;
  for (let n = 0; n < occurrence; n++) idx = rendered.indexOf(clickAfter, idx + 1);
  assert.notEqual(idx, -1, `test setup: "${clickAfter}" #${occurrence} not in rendered`);
  return sourceSplitIndex(source, rendered.slice(0, idx + clickAfter.length), rendered);
}

test('repeated phrase: the second click lands in the second occurrence, not the first', () => {
  const s = 'The cat sat on the mat. The cat sat on the mat again. The cat sat down.';
  assert.equal(at(s, s, 'The cat sat', 1), 'The cat sat'.length);
  assert.equal(at(s, s, 'The cat sat', 2), s.indexOf('The cat sat', 1) + 'The cat sat'.length);
  assert.equal(at(s, s, 'The cat sat', 3), s.lastIndexOf('The cat sat') + 'The cat sat'.length);
});

test('markdown markup between rendered and source: nearest occurrence wins', () => {
  const src = 'Some **bold text** here and **bold text** there, and plain bold text last.';
  const rendered = 'Some bold text here and bold text there, and plain bold text last.';
  const second = src.indexOf('bold text', src.indexOf('bold text') + 1) + 'bold text'.length;
  assert.equal(at(src, rendered, 'bold text', 2), second);
  const third = src.lastIndexOf('bold text') + 'bold text'.length;
  assert.equal(at(src, rendered, 'bold text', 3), third);
});

test('nbsp from the renderer does not push the split earlier', () => {
  const src = 'alpha  beta  gamma  delta  beta  gamma  omega';
  const rendered = src.replace(/ {2}/g, '  ');
  const want = src.indexOf('gamma', src.indexOf('gamma') + 1) + 'gamma'.length;
  assert.equal(at(src, rendered, 'gamma', 2), want);
});

test('short context at a paragraph start resolves to the clicked paragraph', () => {
  const src = 'Intro line.\n\nThe end is near.\n\nThe end.';
  const rendered = 'Intro line.The end is near.The end.'; // text nodes concatenated, no newlines
  const want = src.lastIndexOf('The') + 'The'.length;
  assert.equal(at(src, rendered, 'The', 2), want);
});

test('empty or whitespace prefix is refused', () => {
  assert.equal(sourceSplitIndex('abc def', '', 'abc def'), -1);
  assert.equal(sourceSplitIndex('abc def', '   ', 'abc def'), -1);
});

test('long unique tail is found exactly once even when the phrase appears earlier', () => {
  const para = 'word '.repeat(30);
  const src = para + 'unique marker here. ' + para + 'unique marker here, second time.';
  const rendered = src;
  const want = src.lastIndexOf('unique marker here') + 'unique marker here'.length;
  assert.equal(at(src, rendered, 'unique marker here', 2), want);
});
