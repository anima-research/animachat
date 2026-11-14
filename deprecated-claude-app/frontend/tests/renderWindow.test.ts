// Run: npm test -w frontend   (= node --import tsx --test tests/*.test.ts, from deprecated-claude-app)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RENDER_WINDOW_GROUPS as N,
  initialAnchor,
  windowStart,
  earlierAnchor,
  anchorToReveal,
  hiddenMessageCount,
} from '../src/utils/renderWindow.js';

type Group = { messages: { id: string }[] };

/** `count` one-message groups with ids "m<offset>", "m<offset+1>", ... */
function groups(count: number, offset = 0): Group[] {
  return Array.from({ length: count }, (_, i) => ({ messages: [{ id: `m${offset + i}` }] }));
}

/** Ids of the messages mounted for this anchor */
function mounted(gs: Group[], anchor: ReturnType<typeof initialAnchor>): string[] {
  return gs.slice(windowStart(gs, anchor)).flatMap(g => g.messages.map(m => m.id));
}

test('short and empty conversations are mounted whole', () => {
  assert.equal(windowStart(groups(5), initialAnchor(groups(5))), 0);
  assert.equal(windowStart(groups(N), initialAnchor(groups(N))), 0);
  assert.equal(initialAnchor([]), 'start');
});

test('a long conversation opens on its newest groups', () => {
  const gs = groups(100);
  assert.equal(windowStart(gs, initialAnchor(gs)), 100 - N);
  assert.equal(windowStart(gs, null), 100 - N);
  assert.equal(hiddenMessageCount(gs, 100 - N), 100 - N);
});

test('never unmounts a mounted group while the conversation is open: new groups only add', () => {
  let gs = groups(100);
  const anchor = initialAnchor(gs);
  const before = mounted(gs, anchor);
  for (let added = 1; added <= 3 * N; added++) {
    gs = groups(100 + added);
    const now = mounted(gs, anchor);
    assert.deepEqual(now.slice(0, before.length), before, `a mounted message left after ${added} new groups`);
  }
});

test('a conversation that opened empty keeps everything mounted as it grows', () => {
  const anchor = initialAnchor([]);
  assert.equal(windowStart(groups(3 * N), anchor), 0);
});

test('regrouping into finer groups (participants loaded) keeps the same first mounted message', () => {
  // before participants load: the same 100 messages merged into pairs
  const paired: Group[] = [];
  for (let i = 0; i < 100; i += 2) paired.push({ messages: [{ id: `m${i}` }, { id: `m${i + 1}` }] });
  const anchor = initialAnchor(paired);
  const firstMounted = mounted(paired, anchor)[0];
  assert.equal(mounted(groups(100), anchor)[0], firstMounted);
});

test('regrouping into coarser groups still mounts at least the newest groups', () => {
  const anchor = initialAnchor(groups(100)); // m70
  const paired: Group[] = [];
  for (let i = 0; i < 100; i += 2) paired.push({ messages: [{ id: `m${i}` }, { id: `m${i + 1}` }] });
  assert.equal(windowStart(paired, anchor), 50 - N);
});

test('anchor message gone from the path (branch switch): fall back to the newest groups', () => {
  const anchor = initialAnchor(groups(100));
  const otherPath = groups(100, 1000);
  assert.equal(windowStart(otherPath, anchor), 100 - N);
});

test('a shorter path still mounts the newest groups', () => {
  const anchor = initialAnchor(groups(100)); // m70
  assert.equal(windowStart(groups(75), anchor), 75 - N);
});

test('show earlier moves the start back one step, not below 0', () => {
  const gs = groups(100);
  assert.equal(windowStart(gs, earlierAnchor(gs, 70)), 70 - N);
  assert.equal(windowStart(gs, earlierAnchor(gs, 10)), 0);
  assert.equal(earlierAnchor(gs, 0), 'start');
});

test('hidden count sums messages of groups before the start', () => {
  const gs = [{ messages: [1, 2] }, { messages: [3, 4, 5] }, { messages: [6] }];
  assert.equal(hiddenMessageCount(gs, 2), 5);
  assert.equal(hiddenMessageCount(gs, 10), 6);
});

test('revealing a hidden message mounts from its group', () => {
  const gs = groups(100);
  assert.deepEqual(anchorToReveal(gs, 'm42', 70), { messageId: 'm42' });
  assert.equal(windowStart(gs, anchorToReveal(gs, 'm42', 70)), 42);
  assert.equal(anchorToReveal(gs, 'm0', 70), 'start');
});

test('revealing a mounted or unknown message changes nothing', () => {
  const gs = groups(100);
  assert.equal(anchorToReveal(gs, 'm70', 70), null);
  assert.equal(anchorToReveal(gs, 'm99', 70), null);
  assert.equal(anchorToReveal(gs, 'not-on-path', 70), null);
});
