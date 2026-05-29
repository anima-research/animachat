/**
 * Regression check for issue #121 — JSONL corruption where two events written
 * far apart in time were fused onto one unparseable line.
 *
 * Root cause: a *torn write* — an event written without its terminating newline
 * (process interrupted mid-write / partial write error) — so the NEXT append
 * concatenated onto the partial line, fusing two events.
 *
 * This verifies the newline-boundary guard: after a torn prior write, the next
 * appended event must land on its OWN clean, parseable line (the torn fragment
 * isolated, not fused). Also sanity-checks concurrent appends.
 *
 * Run:  npx tsx scripts/verify-append-concurrency.ts   (exits non-zero on failure)
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { EventStore } from '../src/database/persistence.js';

function ev(seq: number, content = `event-${seq}`) {
  return { timestamp: new Date(0), type: 'message_content_updated', data: { seq, content } };
}

async function testTornWriteRecovery(): Promise<boolean> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'evstore-torn-'));
  const file = path.join(dir, 'events.jsonl');

  // 1) Two clean events via the normal path.
  let store = new EventStore(dir, 'events.jsonl');
  await store.init();
  await store.appendEvent(ev(1));
  await store.appendEvent(ev(2));
  await store.close();

  // 2) Simulate a torn write: a partial event line with NO terminating newline,
  //    exactly like a process killed mid-write.
  await fs.appendFile(file, '{"timestamp":"1970-01-01T00:00:00.000Z","type":"message_branch_added","data":{"seq":3,"partial":true');

  // 3) Next process/append: a fresh EventStore (init heals) then append event 4.
  store = new EventStore(dir, 'events.jsonl');
  await store.init();
  await store.appendEvent(ev(4, 'after-the-torn-write'));
  await store.close();

  // 4) Validate: event 4 must be parseable on its own line; it must NOT be fused
  //    with the torn fragment. The torn fragment is allowed to be its own
  //    (single) unparseable line — the loader skips exactly that one.
  const raw = await fs.readFile(file, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());
  let parseable = 0, corrupt = 0, found4 = false, fused = false;
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      parseable++;
      if (e.data?.seq === 4 && e.data?.content === 'after-the-torn-write') found4 = true;
    } catch {
      corrupt++;
      // If the unparseable line also contains event 4's marker, it was fused.
      if (l.includes('after-the-torn-write')) fused = true;
    }
  }
  await fs.rm(dir, { recursive: true, force: true });

  const ok = found4 && !fused && corrupt === 1 && parseable === 3; // events 1,2,4 parse; fragment 3 isolated
  console.log(`[torn-write] parseable=${parseable} corrupt=${corrupt} event4Recovered=${found4} fused=${fused}`);
  if (!ok) console.error('[torn-write] FAIL: torn write fused with the next event (issue #121 regression)');
  return ok;
}

async function testConcurrentAppends(): Promise<boolean> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'evstore-conc-'));
  const store = new EventStore(dir, 'events.jsonl');
  await store.init();
  const N = 300;
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      store.appendEvent(ev(i, 'x'.repeat(2000 + (i % 40) * 300)))
    )
  );
  await store.close();
  const raw = await fs.readFile(path.join(dir, 'events.jsonl'), 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());
  let corrupt = 0; const seqs = new Set<number>();
  for (const l of lines) { try { seqs.add(JSON.parse(l).data.seq); } catch { corrupt++; } }
  await fs.rm(dir, { recursive: true, force: true });
  const ok = corrupt === 0 && lines.length === N && seqs.size === N;
  console.log(`[concurrent] appended=${N} lines=${lines.length} unique=${seqs.size} corrupt=${corrupt}`);
  if (!ok) console.error('[concurrent] FAIL');
  return ok;
}

async function main() {
  const a = await testTornWriteRecovery();
  const b = await testConcurrentAppends();
  if (a && b) { console.log('PASS'); process.exit(0); }
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
