import fs from 'fs/promises';
import path from 'path';
import { Event, EventStore } from './persistence.js';

export interface IdEvents {
  id: string;
  events: Event[];
}

export class BulkEventStore {
    baseDir : string;
    mostRecentIds: string[] = [];
    mostRecentEventStores: Map<string, EventStore> = new Map();
    // We hold handles only for most recently accessed data files
    // this is necessary because os can limit number of open files to 1024 or less
    // (type ulimit -n to see the limit on your machine)
    maxFilesOpened : number;
    
    // base dir might be like './data/conversations' or './data/users'
    constructor(baseDir: string, maxFilesOpened: number = 100) {
        this.baseDir = baseDir;
        this.maxFilesOpened = maxFilesOpened;
    }

    async init() {
        await fs.mkdir(this.baseDir, { recursive: true });
    }

    async getBaseDirForId(id: string): Promise<string> {
        var idDir : string = this.baseDir;
        // shard into subdirectories so we don't fill a single directory
        // (because typical file systems can get slowdowns when a single directory contains hundreds of thousands of files)
        if (id.length >= 2) {
            idDir = path.posix.join(idDir, id.substring(0,2));
        }
        if (id.length >= 4) {
            idDir = path.posix.join(idDir, id.substring(2,4));
        }
        // create directory containing if not exists
        await fs.mkdir(idDir, { recursive: true});
        return idDir;
    }

    getFileForId(id: string) : string {
        return `${id}.jsonl`;
    }

    async getWritableEventStore(id: string) : Promise<EventStore> {
        const existing = this.mostRecentEventStores.get(id);
        if (existing) {
            const posOfId = this.mostRecentIds.indexOf(id);
            if (posOfId != -1) {
                // move conversation to end of queue
                this.mostRecentIds.splice(posOfId, 1);
                this.mostRecentIds.push(id);
            }
            return existing;
        }
        const idEventStore = new EventStore(await this.getBaseDirForId(id), this.getFileForId(id));
        await idEventStore.init();
        this.mostRecentEventStores.set(id, idEventStore);
        this.mostRecentIds.push(id);
        await this.purgeOldFileHandles();
        return idEventStore;
    }

    async purgeOldFileHandles() : Promise<void> {
        // greater than or equal to so we have space for new opened in caller
        while (this.mostRecentIds.length >= this.maxFilesOpened) {
            const purgedId = this.mostRecentIds.shift();
            if (purgedId) {
              const purgedEventStore : EventStore | undefined = this.mostRecentEventStores.get(purgedId);
              await purgedEventStore?.close();
              this.mostRecentEventStores.delete(purgedId);
            }
            else {
              break;
            }
        }
    }

    async appendEvent(id: string, event: Event) : Promise<void> {
        const eventStore : EventStore = await this.getWritableEventStore(id);
        await eventStore.appendEvent(event);
    }

    async loadEvents(id: string) : Promise<Event[]> {
        const eventStore : EventStore = new EventStore(await this.getBaseDirForId(id), this.getFileForId(id)); // doesn't require init for just calling loadEvents
        return await eventStore.loadEvents();
    }

    async *loadAllEvents() : AsyncGenerator<IdEvents, void, void> {
        const events = new Array<IdEvents>();
        let files = [];
        try {
            files = await fs.readdir(this.baseDir, { recursive: true} );
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
              return; // none populated yet, that's okay, return empty array
            }
            throw error;
        }
        for (const fileName of files) {
            if (!fileName.endsWith('.jsonl')) {
                continue;
            }
            const id = path.basename(fileName, '.jsonl');
            const eventStore = new EventStore(await this.getBaseDirForId(id), this.getFileForId(id)); // doesn't require init for just calling loadEvents
            yield { id: id, events: await eventStore.loadEvents() };
        }
    }

    async close() {
        for (var closingId of this.mostRecentIds) {
            var closingEventStore = this.mostRecentEventStores.get(closingId);
            await closingEventStore?.close();
            this.mostRecentEventStores.delete(closingId);
        }
        this.mostRecentIds = [];
    }
}
