import { createReadStream, createWriteStream } from 'fs';
import { stat, rename, unlink } from 'fs/promises';
import { createInterface } from 'readline';
import path from 'path';
import { getBlobStore, initBlobStore } from './blob-store.js';

export interface CompactionOptions {
  /** Remove active_branch_changed events (default: true) */
  removeActiveBranchChanged?: boolean;
  /** Remove message_order_changed events (default: true) */
  removeMessageOrderChanged?: boolean;
  /** Strip debugRequest/debugResponse from message_branch_updated events (default: true) */
  stripDebugData?: boolean;
  /** Move stripped debug data to blobs instead of discarding (default: false) */
  moveDebugToBlobs?: boolean;
  /** Create a backup of the original file (default: true) */
  createBackup?: boolean;
}

export interface CompactionResult {
  originalSize: number;
  compactedSize: number;
  originalEventCount: number;
  compactedEventCount: number;
  removedEvents: {
    active_branch_changed: number;
    message_order_changed: number;
    other: number;
  };
  strippedDebugData: number;
  movedToBlobs: number;
  backupPath?: string;
}

/**
 * Event types that can be safely removed during compaction
 * because they can be reconstructed from current state
 */
const REMOVABLE_EVENT_TYPES = new Set([
  'active_branch_changed',
  'message_order_changed',
]);

/**
 * Compact a conversation's event log file
 * 
 * This reduces file size by:
 * 1. Removing reconstructable events (branch switches, order changes)
 * 2. Stripping large debug data from message_branch_updated events
 * 3. Optionally moving debug data to the blob store
 */
export async function compactConversation(
  conversationFilePath: string,
  options: CompactionOptions = {}
): Promise<CompactionResult> {
  const {
    removeActiveBranchChanged = true,
    removeMessageOrderChanged = true,
    stripDebugData = true,
    moveDebugToBlobs = false,
    createBackup = true,
  } = options;

  // Initialize blob store if we're moving debug data to blobs
  if (moveDebugToBlobs) {
    await initBlobStore();
  }

  const fileStats = await stat(conversationFilePath);
  const originalSize = fileStats.size;
  
  const result: CompactionResult = {
    originalSize,
    compactedSize: 0,
    originalEventCount: 0,
    compactedEventCount: 0,
    removedEvents: {
      active_branch_changed: 0,
      message_order_changed: 0,
      other: 0,
    },
    strippedDebugData: 0,
    movedToBlobs: 0,
  };

  // Create temp file for compacted output
  const tempPath = conversationFilePath + '.compacting';
  const outputStream = createWriteStream(tempPath, { encoding: 'utf-8' });

  await new Promise<void>((resolve, reject) => {
    const inputStream = createReadStream(conversationFilePath, { encoding: 'utf-8' });
    const rl = createInterface({
      input: inputStream,
      crlfDelay: Infinity
    });

    const pendingWrites: Promise<void>[] = [];

    rl.on('line', (line) => {
      if (!line.trim()) return;
      result.originalEventCount++;

      try {
        const event = JSON.parse(line);
        
        // Check if this event should be removed
        if (removeActiveBranchChanged && event.type === 'active_branch_changed') {
          result.removedEvents.active_branch_changed++;
          return;
        }
        
        if (removeMessageOrderChanged && event.type === 'message_order_changed') {
          result.removedEvents.message_order_changed++;
          return;
        }

        // Process message_branch_updated events
        if (stripDebugData && event.type === 'message_branch_updated' && event.data?.updates) {
          const updates = event.data.updates;
          
          if (updates.debugRequest || updates.debugResponse) {
            if (moveDebugToBlobs) {
              // Move to blobs asynchronously
              const blobStore = getBlobStore();
              const blobPromises: Promise<void>[] = [];
              
              if (updates.debugRequest) {
                const promise = blobStore.saveJsonBlob(updates.debugRequest).then(blobId => {
                  updates.debugRequestBlobId = blobId;
                  delete updates.debugRequest;
                  result.movedToBlobs++;
                }).catch(err => {
                  console.warn(`[Compaction] Failed to save debugRequest to blob:`, err);
                  delete updates.debugRequest; // Still strip it
                });
                blobPromises.push(promise);
              }
              
              if (updates.debugResponse) {
                const promise = blobStore.saveJsonBlob(updates.debugResponse).then(blobId => {
                  updates.debugResponseBlobId = blobId;
                  delete updates.debugResponse;
                  result.movedToBlobs++;
                }).catch(err => {
                  console.warn(`[Compaction] Failed to save debugResponse to blob:`, err);
                  delete updates.debugResponse; // Still strip it
                });
                blobPromises.push(promise);
              }
              
              // Wait for blobs to be saved before writing
              const writePromise = Promise.all(blobPromises).then(() => {
                const compactedLine = JSON.stringify(event) + '\n';
                result.compactedSize += Buffer.byteLength(compactedLine, 'utf-8');
                result.compactedEventCount++;
                outputStream.write(compactedLine);
              });
              pendingWrites.push(writePromise);
              return;
            } else {
              // Just strip the debug data entirely
              if (updates.debugRequest) {
                delete updates.debugRequest;
                result.strippedDebugData++;
              }
              if (updates.debugResponse) {
                delete updates.debugResponse;
                result.strippedDebugData++;
              }
            }
          }
        }

        // Write the (possibly modified) event
        const compactedLine = JSON.stringify(event) + '\n';
        result.compactedSize += Buffer.byteLength(compactedLine, 'utf-8');
        result.compactedEventCount++;
        outputStream.write(compactedLine);
        
      } catch (err) {
        console.warn(`[Compaction] Failed to parse line, keeping as-is:`, err);
        // Keep unparseable lines as-is
        const lineWithNewline = line + '\n';
        result.compactedSize += Buffer.byteLength(lineWithNewline, 'utf-8');
        result.compactedEventCount++;
        outputStream.write(lineWithNewline);
      }
    });

    rl.on('close', async () => {
      // Wait for any pending blob writes
      await Promise.all(pendingWrites);
      outputStream.end();
      resolve();
    });

    rl.on('error', reject);
    inputStream.on('error', reject);
    outputStream.on('error', reject);
  });

  // Wait for output stream to finish
  await new Promise<void>((resolve, reject) => {
    outputStream.on('finish', resolve);
    outputStream.on('error', reject);
  });

  // Create backup if requested
  if (createBackup) {
    const backupPath = conversationFilePath + '.pre-compact.bak';
    await rename(conversationFilePath, backupPath);
    result.backupPath = backupPath;
  } else {
    await unlink(conversationFilePath);
  }

  // Move compacted file to original location
  await rename(tempPath, conversationFilePath);

  // Update final size
  const finalStats = await stat(conversationFilePath);
  result.compactedSize = finalStats.size;

  return result;
}

/**
 * Format compaction result for display
 */
export function formatCompactionResult(result: CompactionResult): string {
  const sizeMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);
  const reduction = ((1 - result.compactedSize / result.originalSize) * 100).toFixed(1);
  
  let output = `\n📦 COMPACTION COMPLETE\n`;
  output += `${'='.repeat(50)}\n`;
  output += `📊 Size: ${sizeMB(result.originalSize)} MB → ${sizeMB(result.compactedSize)} MB (${reduction}% reduction)\n`;
  output += `📝 Events: ${result.originalEventCount.toLocaleString()} → ${result.compactedEventCount.toLocaleString()}\n`;
  output += `\n🗑️  Removed events:\n`;
  output += `   - active_branch_changed: ${result.removedEvents.active_branch_changed.toLocaleString()}\n`;
  output += `   - message_order_changed: ${result.removedEvents.message_order_changed.toLocaleString()}\n`;
  if (result.removedEvents.other > 0) {
    output += `   - other: ${result.removedEvents.other.toLocaleString()}\n`;
  }
  output += `\n🔧 Debug data processed:\n`;
  output += `   - Stripped: ${result.strippedDebugData.toLocaleString()}\n`;
  output += `   - Moved to blobs: ${result.movedToBlobs.toLocaleString()}\n`;
  if (result.backupPath) {
    output += `\n💾 Backup: ${result.backupPath}\n`;
  }
  output += `${'='.repeat(50)}\n`;
  
  return output;
}

/**
 * Get the file path for a conversation's event log
 */
export function getConversationFilePath(conversationId: string, baseDir: string = './data/conversations'): string {
  const prefix1 = conversationId.substring(0, 2);
  const prefix2 = conversationId.substring(2, 4);
  return path.join(baseDir, prefix1, prefix2, `${conversationId}.jsonl`);
}

