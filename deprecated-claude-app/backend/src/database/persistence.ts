import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from 'path';

export interface Event {
  timestamp: Date;
  type: string;
  data: any;
}

export class EventStore {
  private filePath: string;
  private writeStream: fs.FileHandle | null = null;
  // Serializes appends to this file (defense in depth): chaining each write
  // after the previous prevents concurrent appendEvent() calls from interleaving
  // write()/sync() syscalls. See issue #121.
  private writeChain: Promise<void> = Promise.resolve();
  // PRIMARY corruption guard. The observed corruption (issue #121) fused events
  // written HOURS or DAYS apart onto a single line — i.e. not a concurrency
  // race but a *torn write*: an event was written without its terminating
  // newline (process interrupted mid-write, or a partial write error), so the
  // next append concatenated onto that partial line. When the current file does
  // not end in a newline, a prior write was torn; we prepend a newline to the
  // next event so it starts on its own clean line, bounding the damage to the
  // single torn fragment (which the skip-tolerant loader drops) instead of
  // fusing two events into one unparseable line.
  private needsLeadingNewline: boolean = false;

  constructor(dataDir: string = './data', fileName: string = 'events.jsonl') {
    this.filePath = path.join(dataDir, fileName);
  }
  
  async init(): Promise<void> {
    // Ensure data directory exists
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    // Detect a torn prior write left by a previous process: if the file is
    // non-empty and doesn't end in a newline, the last write didn't finish.
    // Flag it so the next append starts on a fresh line instead of fusing.
    try {
      const st = await fs.stat(this.filePath);
      if (st.size > 0) {
        const fh = await fs.open(this.filePath, 'r');
        try {
          const buf = Buffer.alloc(1);
          await fh.read(buf, 0, 1, st.size - 1);
          if (buf[0] !== 0x0a /* '\n' */) {
            this.needsLeadingNewline = true;
          }
        } finally {
          await fh.close();
        }
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }

    // Open file for appending
    this.writeStream = await fs.open(this.filePath, 'a');
  }
  
  async appendEvent(event: Event): Promise<void> {
    if (!this.writeStream) {
      throw new Error('Event store not initialized');
    }

    const line = JSON.stringify({
      ...event,
      timestamp: event.timestamp.toISOString()
    }) + '\n';

    // Append only after any in-flight write to the same file has completed
    // (see `writeChain` above) so concurrent writers can't interleave a
    // partial line. A single line per write, fully flushed, before the next.
    const write = this.writeChain.then(async () => {
      if (!this.writeStream) {
        throw new Error('Event store closed before write completed');
      }
      // If a previous write was torn (file not newline-terminated), start this
      // event on a clean line so we don't fuse onto the partial fragment.
      const payload = (this.needsLeadingNewline ? '\n' : '') + line;
      // Pessimistically assume torn until this write fully lands; cleared below.
      this.needsLeadingNewline = true;
      await this.writeStream.write(payload);
      await this.writeStream.sync(); // Ensure it's written to disk
      // Full line (terminated by '\n') is now on disk: boundary is clean.
      this.needsLeadingNewline = false;
    });
    // Keep the chain alive even if this write rejects, so one failed write
    // doesn't wedge every subsequent append. The caller still sees the error.
    this.writeChain = write.catch(() => {});
    return write;
  }
  
  async loadEvents(): Promise<Event[]> {
    try {
      // Check if file exists
      await fs.access(this.filePath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet
        return [];
      }
      throw error;
    }
    
    // Use streaming to handle large files (> 2GB)
    // fs.readFile() fails for files larger than 2GB due to Node.js string size limits
    return new Promise((resolve, reject) => {
      const events: Event[] = [];
      let lineNum = 0;
      let skipped = 0;
      const stream = createReadStream(this.filePath, { encoding: 'utf-8' });
      const rl = createInterface({
        input: stream,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        lineNum++;
        if (line.trim()) {
          try {
            const event = JSON.parse(line);
            events.push({
              ...event,
              timestamp: new Date(event.timestamp)
            });
          } catch (parseError) {
            skipped++;
            // Include file + line so corruption is diagnosable from logs/metrics
            // instead of surfacing only as a user-reported "lost data" report.
            console.warn(`[EventStore] Skipping malformed line ${lineNum} in ${this.filePath}: ${parseError}`);
          }
        }
      });

      rl.on('close', () => {
        if (skipped > 0) {
          console.error(`[EventStore] CORRUPTION: skipped ${skipped} malformed line(s) while loading ${this.filePath} — investigate (see issue #121)`);
        }
        resolve(events);
      });
      
      rl.on('error', (error) => {
        reject(error);
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
    });
  }
  
  async close(): Promise<void> {
    // Let any queued/in-flight writes drain before closing the handle, so an
    // LRU eviction (BulkEventStore.purgeOldFileHandles) can't close the fd
    // mid-write and lose or corrupt a pending event.
    try {
      await this.writeChain;
    } catch {
      /* a failed write must not block close */
    }
    if (this.writeStream) {
      await this.writeStream.close();
      this.writeStream = null;
    }
  }
}
