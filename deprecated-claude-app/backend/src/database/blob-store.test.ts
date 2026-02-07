import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BlobStore, getBlobStore, initBlobStore } from './blob-store.js';
import fs from 'fs/promises';
import path from 'path';

const TEMP_BASE = '/tmp/claude-1000/-home-quiterion-Projects-animachat/b5033edf-f70b-4576-94e3-550fce4fbf90/scratchpad';
let tempDir: string;
let store: BlobStore;

function makeTempDir(): string {
  return path.join(TEMP_BASE, `blob-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function toBase64(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64');
}

describe('BlobStore', () => {
  beforeEach(async () => {
    tempDir = makeTempDir();
    store = new BlobStore(tempDir);
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('creates the base directory', async () => {
      const stat = await fs.stat(tempDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('creates nested base directory if it does not exist', async () => {
      const nested = path.join(tempDir, 'a', 'b', 'c');
      const s = new BlobStore(nested);
      await s.init();
      const stat = await fs.stat(nested);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('saveBlob and loadBlob', () => {
    it('saves and retrieves blob data correctly', async () => {
      const content = 'Hello, world!';
      const base64 = toBase64(content);
      const id = await store.saveBlob(base64, 'text/plain');

      const result = await store.loadBlob(id);
      expect(result).not.toBeNull();
      expect(result!.data.toString('utf-8')).toBe(content);
      expect(result!.metadata.mimeType).toBe('text/plain');
    });

    it('stores correct metadata', async () => {
      const content = 'test data 12345';
      const base64 = toBase64(content);
      const id = await store.saveBlob(base64, 'application/octet-stream');

      const result = await store.loadBlob(id);
      expect(result!.metadata.size).toBe(Buffer.from(content).length);
      expect(result!.metadata.mimeType).toBe('application/octet-stream');
      expect(result!.metadata.hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
      expect(result!.metadata.createdAt).toBeTruthy();
      // Verify createdAt is a valid ISO date string
      expect(new Date(result!.metadata.createdAt).toISOString()).toBe(result!.metadata.createdAt);
    });

    it('returns null for nonexistent blob', async () => {
      const result = await store.loadBlob('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });

    it('stores blob in sharded directory structure', async () => {
      const id = await store.saveBlob(toBase64('shard test'), 'text/plain');
      // UUID format: xxxxxxxx-xxxx-... first 4 chars form shard dirs
      const first2 = id.substring(0, 2);
      const next2 = id.substring(2, 4);
      const blobPath = path.join(tempDir, first2, next2, `${id}.bin`);
      const stat = await fs.stat(blobPath);
      expect(stat.isFile()).toBe(true);
    });
  });

  describe('deduplication', () => {
    it('returns the same ID for identical content', async () => {
      const base64 = toBase64('duplicate content');
      const id1 = await store.saveBlob(base64, 'text/plain');
      const id2 = await store.saveBlob(base64, 'text/plain');
      expect(id1).toBe(id2);
    });

    it('returns different IDs for different content', async () => {
      const id1 = await store.saveBlob(toBase64('content A'), 'text/plain');
      const id2 = await store.saveBlob(toBase64('content B'), 'text/plain');
      expect(id1).not.toBe(id2);
    });

    it('creates new blob if deduplicated original was deleted', async () => {
      const base64 = toBase64('will be deleted');
      const id1 = await store.saveBlob(base64, 'text/plain');
      await store.deleteBlob(id1);

      const id2 = await store.saveBlob(base64, 'text/plain');
      // After deletion, a new blob should be created with a new ID
      expect(id2).not.toBe(id1);
      const result = await store.loadBlob(id2);
      expect(result).not.toBeNull();
      expect(result!.data.toString('utf-8')).toBe('will be deleted');
    });
  });

  describe('getMetadata', () => {
    it('returns metadata without loading blob data', async () => {
      const id = await store.saveBlob(toBase64('meta test'), 'image/png');
      const meta = await store.getMetadata(id);
      expect(meta).not.toBeNull();
      expect(meta!.mimeType).toBe('image/png');
      expect(meta!.size).toBe(Buffer.from('meta test').length);
    });

    it('returns null for nonexistent blob', async () => {
      const meta = await store.getMetadata('nonexistent-id-0000');
      expect(meta).toBeNull();
    });
  });

  describe('blobExists', () => {
    it('returns true for existing blob', async () => {
      const id = await store.saveBlob(toBase64('exists'), 'text/plain');
      expect(await store.blobExists(id)).toBe(true);
    });

    it('returns false for nonexistent blob', async () => {
      expect(await store.blobExists('does-not-exist-00000')).toBe(false);
    });
  });

  describe('deleteBlob', () => {
    it('removes blob and metadata files', async () => {
      const id = await store.saveBlob(toBase64('to delete'), 'text/plain');
      expect(await store.blobExists(id)).toBe(true);

      const deleted = await store.deleteBlob(id);
      expect(deleted).toBe(true);
      expect(await store.blobExists(id)).toBe(false);
      expect(await store.loadBlob(id)).toBeNull();
    });

    it('clears hash dedup entry after deletion', async () => {
      const base64 = toBase64('dedup clear test');
      const id1 = await store.saveBlob(base64, 'text/plain');
      await store.deleteBlob(id1);

      // Should create a new blob (not reuse deleted one)
      const id2 = await store.saveBlob(base64, 'text/plain');
      expect(id2).not.toBe(id1);
    });
  });

  describe('getExtensionFromMime', () => {
    it('returns correct extensions for known MIME types', () => {
      expect(BlobStore.getExtensionFromMime('image/png')).toBe('png');
      expect(BlobStore.getExtensionFromMime('image/jpeg')).toBe('jpg');
      expect(BlobStore.getExtensionFromMime('image/jpg')).toBe('jpg');
      expect(BlobStore.getExtensionFromMime('image/gif')).toBe('gif');
      expect(BlobStore.getExtensionFromMime('image/webp')).toBe('webp');
      expect(BlobStore.getExtensionFromMime('image/svg+xml')).toBe('svg');
      expect(BlobStore.getExtensionFromMime('application/pdf')).toBe('pdf');
      expect(BlobStore.getExtensionFromMime('audio/mpeg')).toBe('mp3');
      expect(BlobStore.getExtensionFromMime('audio/wav')).toBe('wav');
      expect(BlobStore.getExtensionFromMime('video/mp4')).toBe('mp4');
    });

    it('returns bin for unknown MIME types', () => {
      expect(BlobStore.getExtensionFromMime('application/x-custom')).toBe('bin');
      expect(BlobStore.getExtensionFromMime('')).toBe('bin');
    });
  });

  describe('short ID sharding edge cases', () => {
    it('handles a 1-character ID without sharding', async () => {
      // loadBlob with a very short ID — the sharding logic has branches for id.length < 2 and < 4
      const result = await store.loadBlob('x');
      expect(result).toBeNull(); // File doesn't exist, but code path should not throw
    });

    it('handles a 3-character ID with single-level sharding', async () => {
      const result = await store.loadBlob('abc');
      expect(result).toBeNull();
    });
  });

  describe('loadBlob error handling', () => {
    it('rethrows non-ENOENT errors from loadBlob', async () => {
      const id = await store.saveBlob(toBase64('test'), 'text/plain');
      // Corrupt the meta file to trigger a JSON parse error
      const first2 = id.substring(0, 2);
      const next2 = id.substring(2, 4);
      const metaPath = path.join(tempDir, first2, next2, `${id}.meta`);
      await fs.writeFile(metaPath, 'not json');

      // loadBlob reads both .bin and .meta — the meta parse error will throw
      // and it's not an ENOENT, so it should be rethrown
      await expect(store.loadBlob(id)).rejects.toThrow();
    });
  });

  describe('getMetadata error handling', () => {
    it('rethrows non-ENOENT errors from getMetadata', async () => {
      const id = await store.saveBlob(toBase64('test'), 'text/plain');
      // Make the meta file a directory to cause a non-ENOENT error
      const first2 = id.substring(0, 2);
      const next2 = id.substring(2, 4);
      const metaPath = path.join(tempDir, first2, next2, `${id}.meta`);
      await fs.unlink(metaPath);
      await fs.mkdir(metaPath); // reading a directory as file causes EISDIR

      await expect(store.getMetadata(id)).rejects.toThrow();
    });
  });

  describe('saveJsonBlob and loadJsonBlob', () => {
    it('roundtrips JSON data through blob storage', async () => {
      const data = { key: 'value', nested: { arr: [1, 2, 3] }, flag: true };
      const id = await store.saveJsonBlob(data);

      const loaded = await store.loadJsonBlob(id);
      expect(loaded).toEqual(data);
    });

    it('returns null for nonexistent JSON blob', async () => {
      const result = await store.loadJsonBlob('nonexistent-json-blob');
      expect(result).toBeNull();
    });

    it('stores JSON blob with application/json MIME type', async () => {
      const id = await store.saveJsonBlob({ test: true });
      const meta = await store.getMetadata(id);
      expect(meta!.mimeType).toBe('application/json');
    });
  });
});
