import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/**
 * Metadata stored alongside each blob
 */
export interface BlobMetadata {
  mimeType: string;
  size: number;
  createdAt: string;
  hash: string; // SHA-256 of content for deduplication
}

/**
 * BlobStore - stores large binary data (images, etc.) as files
 * 
 * Storage structure:
 *   ./data/blobs/{aa}/{bb}/{uuid}.bin     - the actual blob data
 *   ./data/blobs/{aa}/{bb}/{uuid}.meta    - JSON metadata (mimeType, size, etc.)
 * 
 * Sharding by first 4 chars of UUID prevents single-directory slowdowns.
 */
export class BlobStore {
  private baseDir: string;
  private hashToId: Map<string, string> = new Map(); // For deduplication

  constructor(baseDir: string = './data/blobs') {
    this.baseDir = baseDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    // Note: We don't pre-load hash index on startup for performance
    // Deduplication is best-effort during runtime
  }

  /**
   * Get the sharded directory path for a blob ID
   */
  private async getShardedDir(id: string): Promise<string> {
    let dir = this.baseDir;
    // Shard into subdirectories to avoid filesystem slowdowns
    if (id.length >= 2) {
      dir = path.join(dir, id.substring(0, 2));
    }
    if (id.length >= 4) {
      dir = path.join(dir, id.substring(2, 4));
    }
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Generate a unique blob ID
   */
  private generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * Compute SHA-256 hash of data for deduplication
   */
  private computeHash(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Save a blob from base64 data
   * Returns the blob ID (UUID)
   * 
   * If the same content already exists (by hash), returns the existing ID
   */
  async saveBlob(base64Data: string, mimeType: string): Promise<string> {
    const buffer = Buffer.from(base64Data, 'base64');
    const hash = this.computeHash(buffer);

    // Check for existing blob with same hash (deduplication)
    const existingId = this.hashToId.get(hash);
    if (existingId) {
      const exists = await this.blobExists(existingId);
      if (exists) {
        console.log(`[BlobStore] Deduplicated blob, reusing ${existingId.substring(0, 8)}...`);
        return existingId;
      }
    }

    const id = this.generateId();
    const dir = await this.getShardedDir(id);
    const blobPath = path.join(dir, `${id}.bin`);
    const metaPath = path.join(dir, `${id}.meta`);

    const metadata: BlobMetadata = {
      mimeType,
      size: buffer.length,
      createdAt: new Date().toISOString(),
      hash
    };

    // Write blob and metadata
    await Promise.all([
      fs.writeFile(blobPath, buffer),
      fs.writeFile(metaPath, JSON.stringify(metadata, null, 2))
    ]);

    // Track hash for deduplication
    this.hashToId.set(hash, id);

    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
    console.log(`[BlobStore] Saved blob ${id.substring(0, 8)}... (${sizeMB} MB, ${mimeType})`);

    return id;
  }

  /**
   * Load a blob by ID
   * Returns the raw buffer and metadata
   */
  async loadBlob(id: string): Promise<{ data: Buffer; metadata: BlobMetadata } | null> {
    try {
      const dir = await this.getShardedDir(id);
      const blobPath = path.join(dir, `${id}.bin`);
      const metaPath = path.join(dir, `${id}.meta`);

      const [data, metaJson] = await Promise.all([
        fs.readFile(blobPath),
        fs.readFile(metaPath, 'utf-8')
      ]);

      const metadata = JSON.parse(metaJson) as BlobMetadata;
      return { data, metadata };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get just the metadata without loading the full blob
   */
  async getMetadata(id: string): Promise<BlobMetadata | null> {
    try {
      const dir = await this.getShardedDir(id);
      const metaPath = path.join(dir, `${id}.meta`);
      const metaJson = await fs.readFile(metaPath, 'utf-8');
      return JSON.parse(metaJson) as BlobMetadata;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Check if a blob exists
   */
  async blobExists(id: string): Promise<boolean> {
    try {
      const dir = await this.getShardedDir(id);
      const blobPath = path.join(dir, `${id}.bin`);
      await fs.access(blobPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a blob
   */
  async deleteBlob(id: string): Promise<boolean> {
    try {
      const dir = await this.getShardedDir(id);
      const blobPath = path.join(dir, `${id}.bin`);
      const metaPath = path.join(dir, `${id}.meta`);

      // Get hash before deleting (for dedup cleanup)
      const metadata = await this.getMetadata(id);
      if (metadata?.hash) {
        this.hashToId.delete(metadata.hash);
      }

      await Promise.all([
        fs.unlink(blobPath).catch(() => {}),
        fs.unlink(metaPath).catch(() => {})
      ]);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file extension from MIME type
   */
  static getExtensionFromMime(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'application/pdf': 'pdf',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'video/mp4': 'mp4',
    };
    return mimeToExt[mimeType] || 'bin';
  }

  /**
   * Save JSON data as a blob (for debug data, etc.)
   * Returns the blob ID (UUID)
   */
  async saveJsonBlob(data: any): Promise<string> {
    const jsonString = JSON.stringify(data);
    const base64 = Buffer.from(jsonString, 'utf-8').toString('base64');
    return this.saveBlob(base64, 'application/json');
  }

  /**
   * Load JSON data from a blob
   */
  async loadJsonBlob(id: string): Promise<any | null> {
    const result = await this.loadBlob(id);
    if (!result) return null;
    return JSON.parse(result.data.toString('utf-8'));
  }
}

// Singleton instance
let blobStoreInstance: BlobStore | null = null;

export function getBlobStore(): BlobStore {
  if (!blobStoreInstance) {
    blobStoreInstance = new BlobStore();
  }
  return blobStoreInstance;
}

export async function initBlobStore(): Promise<BlobStore> {
  const store = getBlobStore();
  await store.init();
  return store;
}
