// Run: npm test -w frontend   (= node --import tsx --test tests/*.test.ts, from deprecated-claude-app)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, matchIndex, buildSnippet, branchSearchText } from '../src/utils/conversationSearch.js';

function q(raw: string) {
  const parsed = parseQuery(raw);
  assert.ok(parsed, `query "${raw}" should parse`);
  return parsed;
}

test('too-short queries do not search', () => {
  assert.equal(parseQuery(''), null);
  assert.equal(parseQuery(' a '), null);
  assert.equal(parseQuery('""'), null);
  assert.ok(parseQuery('ab'));
});

test('bare words are ANDed, in any order', () => {
  const text = 'The quick brown fox jumps over the lazy dog';
  assert.notEqual(matchIndex(text, q('dog quick')), -1);
  assert.equal(matchIndex(text, q('dog cat')), -1);
  assert.equal(matchIndex(text, q('quick dog')), text.indexOf('quick'));
});

test('a quoted query is an exact phrase', () => {
  const text = 'The quick brown fox';
  assert.notEqual(matchIndex(text, q('"quick brown"')), -1);
  assert.equal(matchIndex(text, q('"brown quick"')), -1);
  assert.notEqual(matchIndex(text, q('brown quick')), -1);
  assert.deepEqual(q('"quick brown" fox').terms, ['quick brown', 'fox']);
});

test('an unclosed quote is ignored, not an error', () => {
  assert.deepEqual(q('"quick brown').terms, ['quick', 'brown']);
});

test('matching is case-insensitive, including non-Latin text', () => {
  assert.notEqual(matchIndex('Hello World', q('WORLD hello')), -1);
  assert.notEqual(matchIndex('Привет, Мир', q('мир')), -1);
});

test('regex metacharacters are literal', () => {
  assert.notEqual(matchIndex('cost is $3.50 (approx)', q('"$3.50 (approx)"')), -1);
  assert.equal(matchIndex('cost is 3x50', q('3.50')), -1);
});

test('snippet: a window around the first hit, with ellipses', () => {
  const text = 'a'.repeat(500) + ' needle ' + 'b'.repeat(500);
  const snippet = buildSnippet(text, q('needle'), 160);
  assert.ok(snippet.startsWith('…') && snippet.endsWith('…'));
  assert.ok(snippet.includes('<mark>needle</mark>'));
  const plain = snippet.replace(/<\/?mark>/g, '').replace(/…/g, '');
  assert.equal(plain.length, 160);
  // the hit sits in the first half, so context after it is visible
  assert.ok(plain.indexOf('needle') < 80);
});

test('snippet: short text is whole, every term marked, case preserved', () => {
  const snippet = buildSnippet('Cats and DOGS and cats', q('cats dogs'));
  assert.equal(snippet, '<mark>Cats</mark> and <mark>DOGS</mark> and <mark>cats</mark>');
});

test('snippet: HTML is escaped and overlapping marks merge', () => {
  assert.equal(buildSnippet('<b>abc</b>', q('abc')), '&lt;b&gt;<mark>abc</mark>&lt;/b&gt;');
  assert.equal(buildSnippet('xabcdx', q('abc bcd')), 'x<mark>abcd</mark>x');
});

test('snippet: newlines collapse to spaces', () => {
  assert.equal(buildSnippet('one\n\n  two', q('two')), 'one <mark>two</mark>');
});

test('branch text: content plus thinking; text blocks only as fallback', () => {
  assert.equal(
    branchSearchText({ content: 'shown', contentBlocks: [{ type: 'text', text: 'shown' }, { type: 'thinking', thinking: 'mused' }] }),
    'shown\n\nmused'
  );
  assert.equal(branchSearchText({ content: '', contentBlocks: [{ type: 'text', text: 'only here' }] }), 'only here');
});
