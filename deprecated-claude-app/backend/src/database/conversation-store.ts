import fs from 'fs/promises';
import path from 'path';
import { Event, EventStore } from './persistence.js';

export interface ConversationEvents {
  userId: string;
  events: Event[];
}

export class ConversationEventStore {
    baseDir : string;
    mostRecentUserIds: string[] = [];
    mostRecentUserEventStores: Map<string, EventStore> = new Map();
    // We hold handles only for most recently accessed users
    // this is necessary because os can limit number of open files to 1024 or less
    // (type ulimit -n to see the limit on your machine)
    maxFilesOpened : number;
    
    constructor(baseDir = './data/conversationDataPerUser', maxFilesOpened = 100) {
        this.baseDir = baseDir;
        this.maxFilesOpened = maxFilesOpened;
    }

    async init() {
        await fs.mkdir(this.baseDir, { recursive: true });
    }

    getUserFileName(userId : string) : string {
        return `${userId}.jsonl`;
    }

    async getWritableUserEventStore(userId: string) : Promise<EventStore> {
        const existing = this.mostRecentUserEventStores.get(userId);
        if (existing) {
            const posOfUserId = this.mostRecentUserIds.indexOf(userId);
            if (posOfUserId != -1) {
                // move user to end of queue
                this.mostRecentUserIds.splice(posOfUserId, 1);
                this.mostRecentUserIds.push(userId);
            }
            return existing;
        }
        const userEventStore = new EventStore(this.baseDir, this.getUserFileName(userId));
        await userEventStore.init();
        this.mostRecentUserEventStores.set(userId, userEventStore);
        this.mostRecentUserIds.push(userId);
        await this.purgeOldUsers();
        return userEventStore;
    }

    async purgeOldUsers() : Promise<void> {
        // greater than or equal to so we have space for new opened in caller
        while (this.mostRecentUserIds.length >= this.maxFilesOpened) {
            const purgedUserId = this.mostRecentUserIds.shift();
            if (purgedUserId) {
              const purgedUserEventStore : EventStore | undefined = this.mostRecentUserEventStores.get(purgedUserId);
              await purgedUserEventStore?.close();
              this.mostRecentUserEventStores.delete(purgedUserId);
            }
            else {
              break;
            }
        }
    }

    async appendEvent(userId: string, event: Event) : Promise<void> {
        const userEventStore : EventStore = await this.getWritableUserEventStore(userId);
        await userEventStore.appendEvent(event);
    }

    async loadUserEvents(userId: string) : Promise<Event[]> {
        const userEventStore : EventStore = new EventStore(this.baseDir, this.getUserFileName(userId)); // doesn't require init for just calling loadEvents
        return await userEventStore.loadEvents();
    }

    async *loadAllEvents() : AsyncGenerator<ConversationEvents, void, void> {
        const events = new Array<ConversationEvents>();
        let files = [];
        try {
            files = await fs.readdir(this.baseDir);
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
            const userId = path.basename(fileName, '.jsonl');
            const userEventStore = new EventStore(this.baseDir, fileName); // doesn't require init for just calling loadEvents
            yield { userId: userId, events: await userEventStore.loadEvents() };
        }
    }

    async close() {
        for (var closingUser of this.mostRecentUserIds) {
            var closingUserEventStore = this.mostRecentUserEventStores.get(closingUser);
            await closingUserEventStore?.close();
            this.mostRecentUserEventStores.delete(closingUser);
        }
        this.mostRecentUserIds = [];
    }
}
