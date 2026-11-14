// Run: npm test -w frontend   (= node --import tsx --test tests/*.test.ts, from deprecated-claude-app)
//
// The bookmark list is asked for by every message on screen at once; these
// pin down that it is fetched once per conversation and refetched only after
// an invalidation or a failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSharedRequest } from '../src/utils/sharedRequest.js';

function counting<T>(result: (key: string, n: number) => Promise<T>) {
  const calls: string[] = [];
  const shared = createSharedRequest<T>((key) => {
    calls.push(key);
    return result(key, calls.length);
  });
  return { shared, calls };
}

test('many concurrent callers share one fetch', async () => {
  const { shared, calls } = counting(async (key) => [`bookmarks of ${key}`]);
  const results = await Promise.all(Array.from({ length: 500 }, () => shared.get('conv-a')));
  assert.equal(calls.length, 1);
  assert.ok(results.every(r => r === results[0]));
});

test('keys are independent', async () => {
  const { shared, calls } = counting(async (key) => key);
  assert.equal(await shared.get('a'), 'a');
  assert.equal(await shared.get('b'), 'b');
  assert.equal(await shared.get('a'), 'a');
  assert.deepEqual(calls, ['a', 'b']);
});

test('invalidate(key) refetches that key only', async () => {
  const { shared, calls } = counting(async (key, n) => `${key}#${n}`);
  await shared.get('a');
  await shared.get('b');
  shared.invalidate('a');
  assert.equal(await shared.get('a'), 'a#3');
  assert.equal(await shared.get('b'), 'b#2');
});

test('invalidate() with no key clears everything', async () => {
  const { shared, calls } = counting(async (key, n) => `${key}#${n}`);
  await shared.get('a');
  await shared.get('b');
  shared.invalidate();
  await shared.get('a');
  await shared.get('b');
  assert.equal(calls.length, 4);
});

test('a failed fetch is not cached', async () => {
  const { shared, calls } = counting(async (_key, n) => {
    if (n === 1) throw new Error('network');
    return 'ok';
  });
  await assert.rejects(shared.get('a'), /network/);
  assert.equal(await shared.get('a'), 'ok');
  assert.equal(calls.length, 2);
});

test('a failure of a superseded fetch does not evict the newer one', async () => {
  let rejectFirst!: (e: Error) => void;
  const { shared, calls } = counting((_key, n) =>
    n === 1 ? new Promise<string>((_, reject) => { rejectFirst = reject; }) : Promise.resolve('fresh'));
  const first = shared.get('a');
  shared.invalidate('a');
  assert.equal(await shared.get('a'), 'fresh');
  rejectFirst(new Error('late'));
  await assert.rejects(first, /late/);
  assert.equal(await shared.get('a'), 'fresh');
  assert.equal(calls.length, 2);
});
