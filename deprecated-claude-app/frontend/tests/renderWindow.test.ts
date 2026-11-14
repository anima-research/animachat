// Run: npm test -w frontend   (= node --import tsx --test tests/*.test.ts, from deprecated-claude-app)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RENDER_WINDOW_GROUPS, windowStart, countToReveal, hiddenMessageCount } from '../src/utils/renderWindow.js';

/** groups[i] holds `sizes[i]` messages with ids "g<i>m<j>" */
function groups(...sizes: number[]) {
  return sizes.map((n, i) => ({ messages: Array.from({ length: n }, (_, j) => ({ id: `g${i}m${j}` })) }));
}

test('short conversations are mounted whole', () => {
  assert.equal(windowStart(5, RENDER_WINDOW_GROUPS), 0);
  assert.equal(windowStart(RENDER_WINDOW_GROUPS, RENDER_WINDOW_GROUPS), 0);
  assert.equal(hiddenMessageCount(groups(1, 2, 3), RENDER_WINDOW_GROUPS), 0);
});

test('long conversations mount the newest groups', () => {
  assert.equal(windowStart(100, 30), 70);
  assert.equal(windowStart(100, 60), 40);
  assert.equal(windowStart(100, 1000), 0);
});

test('the window follows new messages', () => {
  assert.equal(windowStart(101, 30), 71);
});

test('hidden count sums messages of unmounted groups', () => {
  assert.equal(hiddenMessageCount(groups(2, 3, 1, 4), 2), 5);
  assert.equal(hiddenMessageCount(groups(2, 3, 1, 4), 1), 6);
});

test('revealing a hidden message widens the window exactly to its group', () => {
  const g = groups(1, 1, 2, 1, 1);
  assert.equal(countToReveal(g, 'g2m1', 2), 3);
  assert.equal(windowStart(g.length, 3), 2);
  assert.equal(countToReveal(g, 'g0m0', 2), 5);
});

test('revealing a mounted or unknown message changes nothing', () => {
  const g = groups(1, 1, 2, 1, 1);
  assert.equal(countToReveal(g, 'g4m0', 2), null);
  assert.equal(countToReveal(g, 'g3m0', 2), null);
  assert.equal(countToReveal(g, 'not-on-path', 2), null);
});
