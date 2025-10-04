import fs from 'fs/promises';
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
      const content = await fs.readFile(this.filePath, 'utf-8');
      if (!content.trim()) return [];
      
      return content
        .trim()
        .split('\n')
        .map(line => {
          const event = JSON.parse(line);
          return {
            ...event,
            timestamp: new Date(event.timestamp)
          };
        });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet
        return [];
      }
      throw error;
    }
  }
  
  async close(): Promise<void> {
    if (this.writeStream) {
      await this.writeStream.close();
      this.writeStream = null;
    }
  }
}
