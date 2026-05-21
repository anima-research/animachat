import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, readFile, mkdir, rm, stat } from 'fs/promises';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

// Mock blob-store for moveDebugToBlobs tests
const mockSaveJsonBlob = vi.fn().mockResolvedValue('blob-uuid-1');
vi.mock('./blob-store.js', () => ({
  getBlobStore: () => ({
    saveJsonBlob: mockSaveJsonBlob,
  }),
  initBlobStore: vi.fn(),
}));

import { compactConversation, formatCompactionResult, getConversationFilePath, CompactionResult } from './compaction.js';

/**
 * Compaction characterization tests.
 *
 * We create real JSONL event log files in a temp directory and run
 * compactConversation() against them, verifying that:
 * - removable event types are stripped
 * - debug data is stripped from message_branch_updated events
 * - backup files are created
 * - size/event count reporting is correct
 */

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'compaction-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Write a JSONL event log file */
async function writeEventLog(filename: string, events: object[]): Promise<string> {
  const filePath = path.join(tmpDir, filename);
  const content = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

/** Read a JSONL file back as parsed events */
async function readEventLog(filePath: string): Promise<any[]> {
  const content = await readFile(filePath, 'utf-8');
  return content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

// Sample events
function makeEvent(type: string, data: any = {}) {
  return { timestamp: new Date().toISOString(), type, data };
}

describe('compactConversation', () => {
  it('removes active_branch_changed events by default', async () => {
    const events = [
      makeEvent('message_created', { id: 'm1', content: 'hello' }),
      makeEvent('active_branch_changed', { messageId: 'm1', branchId: 'b1' }),
      makeEvent('message_created', { id: 'm2', content: 'world' }),
      makeEvent('active_branch_changed', { messageId: 'm2', branchId: 'b2' }),
    ];
    const filePath = await writeEventLog('convo.jsonl', events);

    const result = await compactConversation(filePath);

    expect(result.removedEvents.active_branch_changed).toBe(2);
    expect(result.originalEventCount).toBe(4);
    expect(result.compactedEventCount).toBe(2);

    const remaining = await readEventLog(filePath);
    expect(remaining).toHaveLength(2);
    expect(remaining.every((e: any) => e.type === 'message_created')).toBe(true);
  });

  it('removes message_order_changed events by default', async () => {
    const events = [
      makeEvent('message_created', { id: 'm1' }),
      makeEvent('message_order_changed', { order: [1, 2, 3] }),
    ];
    const filePath = await writeEventLog('convo.jsonl', events);

    const result = await compactConversation(filePath);

    expect(result.removedEvents.message_order_changed).toBe(1);
    expect(result.compactedEventCount).toBe(1);
  });

  it('strips debugRequest and debugResponse from message_branch_updated', async () => {
    const events = [
      makeEvent('message_branch_updated', {
        updates: {
          content: 'updated text',
          debugRequest: { model: 'claude', messages: ['large data'] },
          debugResponse: { id: 'resp-1', usage: { input: 100 } },
        },
      }),
    ];
    const filePath = await writeEventLog('convo.jsonl', events);

    const result = await compactConversation(filePath);

    expect(result.strippedDebugData).toBe(2); // debugRequest + debugResponse
    expect(result.compactedEventCount).toBe(1);

    const remaining = await readEventLog(filePath);
    expect(remaining[0].data.updates.content).toBe('updated text');
    expect(remaining[0].data.updates.debugRequest).toBeUndefined();
    expect(remaining[0].data.updates.debugResponse).toBeUndefined();
  });

  it('creates a backup file by default', async () => {
    const events = [makeEvent('message_created', { id: 'm1' })];
    const filePath = await writeEventLog('convo.jsonl', events);

    const result = await compactConversation(filePath);

    expect(result.backupPath).toBeDefined();
    expect(result.backupPath).toContain('.pre-compact.bak');

    // Backup should contain the original data
    const backup = await readFile(result.backupPath!, 'utf-8');
    expect(backup.trim()).toBeTruthy();
    const backupEvents = backup.trim().split('\n').map(l => JSON.parse(l));
    expect(backupEvents[0].type).toBe('message_created');
  });

  it('does not create a backup when createBackup is false', async () => {
    const events = [makeEvent('message_created', { id: 'm1' })];
    const filePath = await writeEventLog('convo.jsonl', events);

    const result = await compactConversation(filePath, { createBackup: false });

    expect(result.backupPath).toBeUndefined();
  });

  it('reports correct size metrics', async () => {
    const events = [
      makeEvent('message_created', { id: 'm1', content: 'some data' }),
      makeEvent('active_branch_changed', { messageId: 'm1', branchId: 'b1' }),
    ];
    const filePath = await writeEventLog('convo.jsonl', events);

    const originalStat = await stat(filePath);
    const result = await compactConversation(filePath);

    expect(result.originalSize).toBe(originalStat.size);
    expect(result.compactedSize).toBeLessThan(result.originalSize);
    expect(result.compactedSize).toBeGreaterThan(0);
  });

  it('handles event log with no removable events', async () => {
    const events = [
      makeEvent('message_created', { id: 'm1' }),
      makeEvent('message_created', { id: 'm2' }),
    ];
    const filePath = await writeEventLog('convo.jsonl', events);

    const result = await compactConversation(filePath);

    expect(result.removedEvents.active_branch_changed).toBe(0);
    expect(result.removedEvents.message_order_changed).toBe(0);
    expect(result.originalEventCount).toBe(2);
    expect(result.compactedEventCount).toBe(2);
  });

  it('handles event log where all events are removable', async () => {
    const events = [
      makeEvent('active_branch_changed', { messageId: 'm1', branchId: 'b1' }),
      makeEvent('message_order_changed', { order: [1] }),
    ];
    const filePath = await writeEventLog('convo.jsonl', events);

    const result = await compactConversation(filePath);

    expect(result.compactedEventCount).toBe(0);
    expect(result.removedEvents.active_branch_changed).toBe(1);
    expect(result.removedEvents.message_order_changed).toBe(1);
  });

  it('preserves unparseable lines as-is', async () => {
    const filePath = path.join(tmpDir, 'convo.jsonl');
    const content = [
      JSON.stringify(makeEvent('message_created', { id: 'm1' })),
      'this is not valid JSON!!!',
    ].join('\n') + '\n';
    await writeFile(filePath, content, 'utf-8');

    const result = await compactConversation(filePath);

    expect(result.compactedEventCount).toBe(2); // both lines kept
    const remaining = await readFile(filePath, 'utf-8');
    expect(remaining).toContain('this is not valid JSON!!!');
  });

  it('respects removeActiveBranchChanged=false option', async () => {
    const events = [
      makeEvent('active_branch_changed', { messageId: 'm1', branchId: 'b1' }),
      makeEvent('message_created', { id: 'm1' }),
    ];
    const filePath = await writeEventLog('convo.jsonl', events);

    const result = await compactConversation(filePath, {
      removeActiveBranchChanged: false,
    });

    expect(result.removedEvents.active_branch_changed).toBe(0);
    expect(result.compactedEventCount).toBe(2);
  });

  it('moves debug data to blob store when moveDebugToBlobs is true', async () => {
    mockSaveJsonBlob.mockResolvedValue('blob-uuid-123');

    const events = [
      makeEvent('message_branch_updated', {
        updates: {
          content: 'text',
          debugRequest: { model: 'test', messages: ['hi'] },
          debugResponse: { id: 'resp', usage: { input: 100 } },
        },
      }),
    ];
    const filePath = await writeEventLog('convo.jsonl', events);

    const result = await compactConversation(filePath, {
      moveDebugToBlobs: true,
    });

    expect(result.movedToBlobs).toBe(2); // debugRequest + debugResponse
    expect(mockSaveJsonBlob).toHaveBeenCalledTimes(2);

    // The event should have blobIds instead of raw data
    const remaining = await readEventLog(filePath);
    expect(remaining[0].data.updates.debugRequest).toBeUndefined();
    expect(remaining[0].data.updates.debugResponse).toBeUndefined();
    expect(remaining[0].data.updates.debugRequestBlobId).toBe('blob-uuid-123');
    expect(remaining[0].data.updates.debugResponseBlobId).toBe('blob-uuid-123');
  });

  it('handles blob store save failure gracefully', async () => {
    mockSaveJsonBlob.mockRejectedValue(new Error('blob store failure'));

    const events = [
      makeEvent('message_branch_updated', {
        updates: {
          content: 'text',
          debugRequest: { model: 'test' },
        },
      }),
    ];
    const filePath = await writeEventLog('convo.jsonl', events);

    const result = await compactConversation(filePath, {
      moveDebugToBlobs: true,
    });

    // movedToBlobs should be 0 since save failed
    expect(result.movedToBlobs).toBe(0);

    // debugRequest should still be stripped (fallback behavior)
    const remaining = await readEventLog(filePath);
    expect(remaining[0].data.updates.debugRequest).toBeUndefined();
  });

  it('respects stripDebugData=false option', async () => {
    const events = [
      makeEvent('message_branch_updated', {
        updates: {
          content: 'text',
          debugRequest: { model: 'test' },
        },
      }),
    ];
    const filePath = await writeEventLog('convo.jsonl', events);

    const result = await compactConversation(filePath, {
      stripDebugData: false,
    });

    expect(result.strippedDebugData).toBe(0);
    const remaining = await readEventLog(filePath);
    expect(remaining[0].data.updates.debugRequest).toBeDefined();
  });
});

describe('formatCompactionResult', () => {
  it('produces readable output with all metrics', () => {
    const result: CompactionResult = {
      originalSize: 10 * 1024 * 1024,
      compactedSize: 5 * 1024 * 1024,
      originalEventCount: 1000,
      compactedEventCount: 500,
      removedEvents: {
        active_branch_changed: 300,
        message_order_changed: 100,
        other: 0,
      },
      strippedDebugData: 50,
      movedToBlobs: 10,
      backupPath: '/tmp/backup.bak',
    };

    const output = formatCompactionResult(result);

    expect(output).toContain('COMPACTION COMPLETE');
    expect(output).toContain('10.00 MB');
    expect(output).toContain('5.00 MB');
    expect(output).toContain('50.0%');
    expect(output).toContain('1,000');
    expect(output).toContain('500');
    expect(output).toContain('300');
    expect(output).toContain('100');
    expect(output).toContain('50');
    expect(output).toContain('10');
    expect(output).toContain('/tmp/backup.bak');
  });

  it('omits "other" when zero', () => {
    const result: CompactionResult = {
      originalSize: 1000,
      compactedSize: 500,
      originalEventCount: 10,
      compactedEventCount: 5,
      removedEvents: { active_branch_changed: 3, message_order_changed: 2, other: 0 },
      strippedDebugData: 0,
      movedToBlobs: 0,
    };

    const output = formatCompactionResult(result);
    expect(output).not.toContain('other:');
  });
});

describe('getConversationFilePath', () => {
  it('shards by first 4 characters of conversation ID', () => {
    const result = getConversationFilePath('abcdef12-3456-4789-abcd-ef0123456789');
    expect(result).toContain(path.join('ab', 'cd'));
    expect(result).toMatch(/\.jsonl$/);
  });

  it('uses custom base directory', () => {
    const result = getConversationFilePath('abcdef12', '/data/convos');
    expect(result).toContain('/data/convos');
  });
});
