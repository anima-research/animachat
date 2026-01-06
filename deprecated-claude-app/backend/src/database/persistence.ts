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
  
  constructor(dataDir: string = './data', fileName: string = 'events.jsonl') {
    this.filePath = path.join(dataDir, fileName);
  }
  
  async init(): Promise<void> {
    // Ensure data directory exists
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    
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
    
    await this.writeStream.write(line);
    await this.writeStream.sync(); // Ensure it's written to disk
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
      const stream = createReadStream(this.filePath, { encoding: 'utf-8' });
      const rl = createInterface({
        input: stream,
        crlfDelay: Infinity
      });
      
      rl.on('line', (line) => {
        if (line.trim()) {
          try {
            const event = JSON.parse(line);
            events.push({
              ...event,
              timestamp: new Date(event.timestamp)
            });
          } catch (parseError) {
            console.warn(`[EventStore] Skipping malformed line: ${parseError}`);
          }
        }
      });
      
      rl.on('close', () => {
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
    if (this.writeStream) {
      await this.writeStream.close();
      this.writeStream = null;
    }
  }
}
