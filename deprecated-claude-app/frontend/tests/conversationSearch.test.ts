// Run: npm test -w frontend   (= node --import tsx --test tests/*.test.ts, from deprecated-claude-app)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, matchIndex, buildSnippet, branchSearchText, flattenText, searchConversation } from '../src/utils/conversationSearch.js';

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

test('a phrase matches across a line break or a double space', () => {
  const text = flattenText(branchSearchText({ content: 'the quick\nbrown fox,  quick   brown again' }));
  assert.equal(matchIndex(text, q('"quick brown"')), text.indexOf('quick'));
  assert.deepEqual(q('"quick   brown"').terms, ['quick brown']);
  assert.equal(buildSnippet('quick\n\nbrown', q('"quick brown"')), '<mark>quick brown</mark>');
});

test('phrase and word together at match level', () => {
  assert.equal(matchIndex('fox brown quick', q('"quick brown" fox')), -1);
  assert.equal(matchIndex('quick brown fox', q('"quick brown" fox')), 0);
});

test('snippet: no leading ellipsis at offset 0, no trailing one near the end', () => {
  const head = buildSnippet('needle ' + 'x'.repeat(300), q('needle'), 160);
  assert.ok(head.startsWith('<mark>needle</mark>') && head.endsWith('…'));
  const tail = buildSnippet('x'.repeat(300) + ' needle end', q('needle'), 160);
  assert.ok(tail.startsWith('…') && tail.endsWith('<mark>needle</mark> end'));
});

test('snippet: a mark next to an escaped entity', () => {
  assert.equal(buildSnippet('a&b', q('&b')), 'a<mark>&amp;b</mark>');
});

test('snippet: an emoji at the cut is not split', () => {
  for (const pad of [0, 52]) {
    const snippet = buildSnippet('x'.repeat(pad) + '😀'.repeat(40) + 'z needle ' + '😀'.repeat(80) + ' ' + 'y'.repeat(300), q('needle'), 160);
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(snippet), `pad ${pad}`);
  }
});

const day = (d: number) => new Date(Date.UTC(2026, 10, d));
function conversation() {
  return [
    { id: 'm1', branches: [
      { id: 'a1', role: 'user', content: 'apple one', createdAt: day(1) },
      { id: 'a2', role: 'user', content: 'apple two', createdAt: day(2) },
    ] },
    { id: 'm2', branches: [
      { id: 'b1', role: 'assistant', content: 'apple three', createdAt: day(3) },
      { id: 'b2', role: 'assistant', content: 'apple four', createdAt: undefined },
      { id: 'b3', role: 'assistant', content: 'apple five', createdAt: day(4) },
    ] },
  ];
}

test('order: path first in document order, then others oldest first, undated last', () => {
  const hits = searchConversation(conversation(), q('apple'), ['a1', 'b1']);
  assert.deepEqual(hits.map(h => h.branchId), ['a1', 'b1', 'a2', 'b3', 'b2']);
  assert.equal(hits.find(h => h.branchId === 'b2')!.sortKey, Number.MAX_SAFE_INTEGER);
  assert.equal(hits.find(h => h.branchId === 'b2')!.created, null);
});

test('order is frozen to the path the query ran on, not the displayed one', () => {
  const messages = conversation();
  const orderPath = ['a1', 'b1'];
  const before = searchConversation(messages, q('apple'), orderPath).map(h => h.branchId);
  // A jump to b3 makes it the displayed path; the list keeps its order.
  const displayed = ['a1', 'b3'];
  const after = searchConversation(messages, q('apple'), orderPath).map(h => h.branchId);
  assert.deepEqual(after, before);
  assert.notDeepEqual(searchConversation(messages, q('apple'), displayed).map(h => h.branchId), before);
});
