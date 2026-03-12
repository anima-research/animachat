import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStore, Event } from './persistence.js';
import fs from 'fs/promises';
import path from 'path';

const TEMP_BASE = '/tmp/claude-1000/-home-quiterion-Projects-animachat/b5033edf-f70b-4576-94e3-550fce4fbf90/scratchpad';
let tempDir: string;
let store: EventStore;

function makeTempDir(): string {
  return path.join(TEMP_BASE, `persistence-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('EventStore', () => {
  beforeEach(async () => {
    tempDir = makeTempDir();
    await fs.mkdir(tempDir, { recursive: true });
    store = new EventStore(tempDir, 'events.jsonl');
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('creates the data directory if it does not exist', async () => {
      const nestedDir = path.join(tempDir, 'deep', 'nested');
      const s = new EventStore(nestedDir, 'test.jsonl');
      await s.init();
      const stat = await fs.stat(nestedDir);
      expect(stat.isDirectory()).toBe(true);
      await s.close();
    });
  });

  describe('appendEvent', () => {
    it('throws if store is not initialized', async () => {
      const uninitStore = new EventStore(tempDir, 'uninit.jsonl');
      await expect(
        uninitStore.appendEvent({ timestamp: new Date(), type: 'test', data: {} })
      ).rejects.toThrow('Event store not initialized');
    });

    it('writes event as JSON line with ISO timestamp', async () => {
      const timestamp = new Date('2024-06-15T10:30:00Z');
      await store.appendEvent({ timestamp, type: 'user_created', data: { name: 'Alice' } });
      await store.close();

      const content = await fs.readFile(path.join(tempDir, 'events.jsonl'), 'utf-8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.timestamp).toBe('2024-06-15T10:30:00.000Z');
      expect(parsed.type).toBe('user_created');
      expect(parsed.data.name).toBe('Alice');
    });

    it('appends multiple events on separate lines', async () => {
      const ts = new Date('2024-01-01T00:00:00Z');
      await store.appendEvent({ timestamp: ts, type: 'event_a', data: { v: 1 } });
      await store.appendEvent({ timestamp: ts, type: 'event_b', data: { v: 2 } });
      await store.close();

      const content = await fs.readFile(path.join(tempDir, 'events.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).type).toBe('event_a');
      expect(JSON.parse(lines[1]).type).toBe('event_b');
    });
  });

  describe('loadEvents', () => {
    it('returns empty array when file does not exist', async () => {
      // Don't call init() — we want the file to truly not exist
      const missingDir = path.join(tempDir, 'subdir-that-exists');
      await fs.mkdir(missingDir, { recursive: true });
      const emptyStore = new EventStore(missingDir, 'nonexistent.jsonl');
      // loadEvents should handle the missing file gracefully
      const events = await emptyStore.loadEvents();
      expect(events).toEqual([]);
    });

    it('returns empty array for an empty file', async () => {
      // Close and reopen to ensure file exists but is empty
      await store.close();
      await fs.writeFile(path.join(tempDir, 'events.jsonl'), '');
      const s2 = new EventStore(tempDir, 'events.jsonl');
      await s2.init();
      const events = await s2.loadEvents();
      expect(events).toEqual([]);
      await s2.close();
    });

    it('deserializes events with Date timestamps', async () => {
      const timestamp = new Date('2024-03-20T15:45:00Z');
      await store.appendEvent({ timestamp, type: 'login', data: { user: 'bob' } });
      await store.close();

      const s2 = new EventStore(tempDir, 'events.jsonl');
      await s2.init();
      const events = await s2.loadEvents();
      expect(events).toHaveLength(1);
      expect(events[0].timestamp).toBeInstanceOf(Date);
      expect(events[0].timestamp.toISOString()).toBe('2024-03-20T15:45:00.000Z');
      expect(events[0].type).toBe('login');
      expect(events[0].data.user).toBe('bob');
      await s2.close();
    });

    it('skips malformed JSON lines without crashing', async () => {
      await store.close();
      // Write a file with one valid line, one malformed, and one valid
      const validLine1 = JSON.stringify({ timestamp: '2024-01-01T00:00:00Z', type: 'a', data: {} });
      const validLine2 = JSON.stringify({ timestamp: '2024-01-02T00:00:00Z', type: 'b', data: {} });
      await fs.writeFile(
        path.join(tempDir, 'events.jsonl'),
        `${validLine1}\n{not valid json}\n${validLine2}\n`
      );

      const s2 = new EventStore(tempDir, 'events.jsonl');
      await s2.init();
      const events = await s2.loadEvents();
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('a');
      expect(events[1].type).toBe('b');
      await s2.close();
    });

    it('skips blank lines', async () => {
      await store.close();
      const validLine = JSON.stringify({ timestamp: '2024-01-01T00:00:00Z', type: 'x', data: {} });
      await fs.writeFile(
        path.join(tempDir, 'events.jsonl'),
        `\n${validLine}\n\n\n`
      );

      const s2 = new EventStore(tempDir, 'events.jsonl');
      await s2.init();
      const events = await s2.loadEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('x');
      await s2.close();
    });

    it('roundtrips complex nested event data', async () => {
      const timestamp = new Date('2024-06-01T00:00:00Z');
      const complexData = {
        nested: { deeply: { value: [1, 2, 3] } },
        unicode: 'café ☕',
        nullVal: null,
        boolVal: false
      };
      await store.appendEvent({ timestamp, type: 'complex', data: complexData });
      await store.close();

      const s2 = new EventStore(tempDir, 'events.jsonl');
      await s2.init();
      const events = await s2.loadEvents();
      expect(events).toHaveLength(1);
      expect(events[0].data.nested.deeply.value).toEqual([1, 2, 3]);
      expect(events[0].data.unicode).toBe('café ☕');
      expect(events[0].data.nullVal).toBeNull();
      expect(events[0].data.boolVal).toBe(false);
      await s2.close();
    });

    it('handles many events efficiently', async () => {
      const ts = new Date('2024-01-01T00:00:00Z');
      for (let i = 0; i < 100; i++) {
        await store.appendEvent({ timestamp: ts, type: `event_${i}`, data: { index: i } });
      }
      await store.close();

      const s2 = new EventStore(tempDir, 'events.jsonl');
      await s2.init();
      const events = await s2.loadEvents();
      expect(events).toHaveLength(100);
      expect(events[0].data.index).toBe(0);
      expect(events[99].data.index).toBe(99);
      await s2.close();
    });
  });

  describe('close', () => {
    it('can be called multiple times without error', async () => {
      await store.close();
      await store.close(); // second close should not throw
    });

    it('prevents appending after close', async () => {
      await store.close();
      await expect(
        store.appendEvent({ timestamp: new Date(), type: 'x', data: {} })
      ).rejects.toThrow('Event store not initialized');
    });
  });
});
