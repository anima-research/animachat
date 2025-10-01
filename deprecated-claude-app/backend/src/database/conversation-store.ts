import fs from 'fs/promises';
import path from 'path';
import { Event, EventStore } from './persistence.js';

export interface ConversationEvents {
  conversationId: string;
  events: Event[];
}

export class ConversationEventStore {
    baseDir : string;
    mostRecentConversationIds: string[] = [];
    mostRecentConversationEventStores: Map<string, EventStore> = new Map();
    // We hold handles only for most recently accessed conversations
    // this is necessary because os can limit number of open files to 1024 or less
    // (type ulimit -n to see the limit on your machine)
    maxFilesOpened : number;
    
    constructor(baseDir = './data/conversations', maxFilesOpened = 100) {
        this.baseDir = baseDir;
        this.maxFilesOpened = maxFilesOpened;
    }

    async init() {
        await fs.mkdir(this.baseDir, { recursive: true });
    }

    async getConversationFileName(conversationId: string) : Promise<string> {
        var conversationDir : string = this.baseDir;
        // shard into subdirectories so we don't fill a single directory
        // (because typical file systems can get slowdowns when a single directory contains hundreds of thousands of files)
        if (conversationId.length >= 2) {
            conversationDir = path.posix.join(conversationDir, conversationId.substring(0,2));
        }
        if (conversationId.length >= 4) {
            conversationDir = path.posix.join(conversationDir, conversationId.substring(2,4));
        }
        // create directory containing if not exists
        await fs.mkdir(conversationDir, { recursive: true});
        return path.posix.join(conversationDir, `${conversationId}.jsonl`);
    }

    async getWritableConversationEventStore(conversationId: string) : Promise<EventStore> {
        const existing = this.mostRecentConversationEventStores.get(conversationId);
        if (existing) {
            const posOfConversationId = this.mostRecentConversationIds.indexOf(conversationId);
            if (posOfConversationId != -1) {
                // move conversation to end of queue
                this.mostRecentConversationIds.splice(posOfConversationId, 1);
                this.mostRecentConversationIds.push(conversationId);
            }
            return existing;
        }
        const conversationEventStore = new EventStore(this.baseDir, await this.getConversationFileName(conversationId));
        await conversationEventStore.init();
        this.mostRecentConversationEventStores.set(conversationId, conversationEventStore);
        this.mostRecentConversationIds.push(conversationId);
        await this.purgeOldConversations();
        return conversationEventStore;
    }

    async purgeOldConversations() : Promise<void> {
        // greater than or equal to so we have space for new opened in caller
        while (this.mostRecentConversationIds.length >= this.maxFilesOpened) {
            const purgedConversationId = this.mostRecentConversationIds.shift();
            if (purgedConversationId) {
              const purgedConversationEventStore : EventStore | undefined = this.mostRecentConversationEventStores.get(purgedConversationId);
              await purgedConversationEventStore?.close();
              this.mostRecentConversationEventStores.delete(purgedConversationId);
            }
            else {
              break;
            }
        }
    }

    async appendEvent(conversationId: string, event: Event) : Promise<void> {
        const conversationEventStore : EventStore = await this.getWritableConversationEventStore(conversationId);
        await conversationEventStore.appendEvent(event);
    }

    async loadConversationEvents(conversationId: string) : Promise<Event[]> {
        const conversationEventStore : EventStore = new EventStore(this.baseDir, await this.getConversationFileName(conversationId)); // doesn't require init for just calling loadEvents
        return await conversationEventStore.loadEvents();
    }

    async *loadAllEvents() : AsyncGenerator<ConversationEvents, void, void> {
        const events = new Array<ConversationEvents>();
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
            const conversationId = path.basename(fileName, '.jsonl');
            const conversationEventStore = new EventStore(this.baseDir, fileName); // doesn't require init for just calling loadEvents
            yield { conversationId: conversationId, events: await conversationEventStore.loadEvents() };
        }
    }

    async close() {
        for (var closingConversationId of this.mostRecentConversationIds) {
            var closingConversationEventStore = this.mostRecentConversationEventStores.get(closingConversationId);
            await closingConversationEventStore?.close();
            this.mostRecentConversationEventStores.delete(closingConversationId);
        }
        this.mostRecentConversationIds = [];
    }
}
