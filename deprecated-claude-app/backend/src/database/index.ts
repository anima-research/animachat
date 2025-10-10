import { User, Conversation, Message, Participant, ApiKey, Bookmark } from '@deprecated-claude/shared';
import { TotalsMetrics, TotalsMetricsSchema, ModelConversationMetrics, ModelConversationMetricsSchema } from '@deprecated-claude/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import { promises as fsAsync } from 'fs';
import { migrateDatabase } from './migration.js'
import { EventStore, Event } from './persistence.js';
import { BulkEventStore } from './bulk-event-store.js';
import { ModelLoader } from '../config/model-loader.js';
import { SharesStore, SharedConversation } from './shares.js';

// Metrics interface for tracking token usage
export interface MetricsData {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost: number;
  cacheSavings: number;
  model: string;
  timestamp: string;
  responseTime: number;
}

export class Database {
  private users: Map<string, User> = new Map();
  private usersByEmail: Map<string, string> = new Map(); // email -> userId
  private conversations: Map<string, Conversation> = new Map();
  private messages: Map<string, Message> = new Map();
  private apiKeys: Map<string, ApiKey> = new Map();
  private userConversations: Map<string, Set<string>> = new Map(); // userId -> conversationIds
  private conversationMessages: Map<string, string[]> = new Map(); // conversationId -> messageIds (ordered)
  private passwordHashes: Map<string, string> = new Map(); // email -> passwordHash
  private participants: Map<string, Participant> = new Map(); // participantId -> Participant
  private conversationParticipants: Map<string, string[]> = new Map(); // conversationId -> participantIds
  private conversationMetrics: Map<string, MetricsData[]> = new Map(); // conversationId -> metrics

  private userLastAccessedTimes: Map<string, Date> = new Map(); // userId -> last accessed time
  private conversationsLastAccessedTimes: Map<string, Date> = new Map(); // conversationId -> last accessed time

  private bookmarks: Map<string, Bookmark> = new Map(); // bookmarkId -> Bookmark
  private branchBookmarks: Map<string, string> = new Map(); // `${messageId}-${branchId}` -> bookmarkId

  private eventStore: EventStore;
  // per user, contains conversation metadata events and participant events
  private userEventStore: BulkEventStore;
  // per conversation, contains message and branch events
  private conversationEventStore: BulkEventStore; // per conversation event store
  private sharesStore: SharesStore;
  private initialized: boolean = false;

  constructor(rootPath: string = './data') {
    this.eventStore = new EventStore(rootPath, 'mainEvents.jsonl');
    this.userEventStore = new BulkEventStore(path.join(rootPath, "users"));
    this.conversationEventStore = new BulkEventStore(path.join(rootPath, "conversations"));

    this.sharesStore = new SharesStore();
  }
  
  async init(): Promise<void> {
    if (this.initialized) return;


    await this.eventStore.init();
    await this.conversationEventStore.init();
    await this.userEventStore.init();

    // if needed
    await this.migrateDatabase();
    
    // Load all events and rebuild state
    var allEvents = await this.eventStore.loadEvents();

    // Replay events
    console.log(`Loading ${allEvents.length} events from disk...`);

    for (const event of allEvents) {
      await this.replayEvent(event);
    }

    // Replay user events (TODO: make these load as needed. For now, it's so little data that this is fine)
    for await (const {id, events} of this.userEventStore.loadAllEvents()) {
      for (const event of events) {
        await this.replayEvent(event);
      }
      // add that user to list of loaded users
      this.userLastAccessedTimes.set(id, new Date());
    }
    
    // Create test user if no users exist
    if (this.users.size === 0) {
      await this.createTestUser();
    }
    
    this.initialized = true;
  }

  private async migrateDatabase(): Promise<void> {
    const oldDatabasePath = path.join('./data', 'events.jsonl');
    if (fs.existsSync(oldDatabasePath)) {
      console.log(`Migrating database at ${oldDatabasePath} and moving to ${oldDatabasePath}.bkp...`)
      const oldEventStore = new EventStore('./data', 'events.jsonl');
      await oldEventStore.init();
      // reply them all back to gather metadata needed for migration (needed to lookup userId and conversationId of events)
      const oldEvents = await oldEventStore.loadEvents();
      console.log(`Migration: Loading ${oldEvents.length} events from disk...`);
      for (var event of oldEvents) {
        await this.replayEvent(event);
      }
      await oldEventStore.close();

      // backup old data
      const oldConversations = this.conversations;
      const oldMessages = this.messages;
      const oldParticipants = this.participants;

      // reset back to blank state
      this.conversations = new Map();
      this.users = new Map();
      this.usersByEmail = new Map();
      this.conversations = new Map();
      this.messages = new Map();
      this.apiKeys = new Map();
      this.userConversations = new Map();
      this.conversationMessages = new Map();
      this.passwordHashes = new Map();
      this.participants = new Map();
      this.conversationParticipants = new Map();
      this.conversationMetrics = new Map();

      await migrateDatabase(oldEvents, oldConversations, oldParticipants, oldMessages,
          this.eventStore, this.userEventStore, this.conversationEventStore
      );
      // move old database to backup file so we don't do this again, but it's not deleted in case something goes wrong
      await fsAsync.rename(oldDatabasePath, oldDatabasePath + ".bkp");
      console.log(`Migration: Completed database migration`);
    }
  }

  private async loadUser(userId: string) {
    if (!this.userLastAccessedTimes.has(userId)) {
      for (const event of await this.userEventStore.loadEvents(userId)) {
        await this.replayEvent(event);
      }
    }
    this.userLastAccessedTimes.set(userId, new Date());
  }

  private async loadConversation(conversationId: string, conversationOwnerUserId: string) {
    await this.loadUser(conversationOwnerUserId); // user contains conversation metadata, need to do this first
    // if we haven't loaded this conversation
    // and this conversation exists (loading the user will populate that metadata)
    if (!this.conversationsLastAccessedTimes.has(conversationId) && this.conversations.has(conversationId)) {
      // then load its messages and metrics
      for (const event of await this.conversationEventStore.loadEvents(conversationId)) {
        await this.replayEvent(event);
      }
    }
    this.conversationsLastAccessedTimes.set(conversationId, new Date());
  }

  private unloadConversation(conversationId: string) {
    // we only remove messages and metrics, since conversation metadata is managed via load/unload user
    this.conversationMessages.get(conversationId)?.forEach((messageId) => {
      this.messages.delete(messageId);
    });
    this.conversationMessages.delete(conversationId);;
    this.conversationMetrics.delete(conversationId);

    this.conversationsLastAccessedTimes.delete(conversationId);
  }

  private unloadUser(userId: string) {
    this.userConversations.get(userId)?.forEach((conversationId) => {
      // remove metadata (this is stored in the per-user event files)
      this.conversations.delete(conversationId);
      this.conversationParticipants.get(conversationId)?.forEach((participantId) => {
        this.participants.delete(participantId);
      });
      this.conversationParticipants.delete(conversationId)
      // remove messages and metrics (this is stored in per-conversation event files)
      this.unloadConversation(conversationId);
    });
    this.userConversations.delete(userId);
    this.userLastAccessedTimes.delete(userId);
  }

  private async createTestUser() {
    // Create test user with known credentials
    const testUser: User = {
      id: 'test-user-id-12345',
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date(),
      apiKeys: []
    };
    
    // Use a simple password: "password123"
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    this.users.set(testUser.id, testUser);
    this.usersByEmail.set(testUser.email, testUser.id);
    this.userConversations.set(testUser.id, new Set());
    this.passwordHashes.set(testUser.email, hashedPassword);
    
    this.logEvent('user_created', { user: testUser, passwordHash: hashedPassword });
    
    console.log('🧪 Test user created:');
    console.log('   Email: test@example.com');
    console.log('   Password: password123');
  }

  private async createDemoUser() {
    const demoUser: User = {
      id: uuidv4(),
      email: 'demo@example.com',
      name: 'Demo User',
      createdAt: new Date(),
      apiKeys: []
    };
    
    this.users.set(demoUser.id, demoUser);
    this.usersByEmail.set(demoUser.email, demoUser.id);
    
    await this.logEvent('user_created', { user: demoUser });
  }

  private async logEvent(type: string, data: any): Promise<void> {
    const event: Event = {
      timestamp: new Date(),
      type,
      data: JSON.parse(JSON.stringify(data)) // Deep clone to avoid mutations
    };
    
    await this.eventStore.appendEvent(event);
  }

  private async logConversationEvent(conversationId: string, type: string, data: any): Promise<void> {
    const event: Event = {
      timestamp: new Date(),
      type,
      data: JSON.parse(JSON.stringify(data)) // Deep clone to avoid mutations
    };
    
    await this.conversationEventStore.appendEvent(conversationId, event);
  }

  private async logUserEvent(userId: string, type: string, data: any): Promise<void> {
    const event: Event = {
      timestamp: new Date(),
      type,
      data: JSON.parse(JSON.stringify(data)) // Deep clone to avoid mutations
    };
    
    await this.userEventStore.appendEvent(userId, event);
  }
  
  
  private async replayEvent(event: Event): Promise<void> {
    try {
      switch (event.type) {
        case 'user_created': {
          const { user, passwordHash } = event.data;
          if (!user) {
            console.error('Skipping corrupted user_created event - missing user data');
            return;
          }
          const userWithDates = {
            ...user,
            createdAt: new Date(user.createdAt)
          };
          this.users.set(user.id, userWithDates);
          this.usersByEmail.set(user.email, user.id);
          this.userConversations.set(user.id, new Set());
          if (passwordHash) {
            this.passwordHashes.set(user.email, passwordHash);
          }
          break;
        }
      
      case 'api_key_created': {
        // Handle old event format (just apiKeyId, userId, provider)
        // These events don't contain enough data to reconstruct the API key
        // So we'll just skip them - the API keys will need to be re-added
        if ('apiKeyId' in event.data && !('apiKey' in event.data)) {
          console.warn(`Skipping old format api_key_created event for key ${event.data.apiKeyId} - API keys need to be re-added`);
          break;
        }
        
        // Handle new format (if we ever change to store full apiKey object)
        const { apiKey, userId, masked } = event.data;
        if (!apiKey) {
          console.error('Skipping corrupted api_key_created event - missing apiKey data');
          break;
        }
        
        const apiKeyWithDates = {
          ...apiKey,
          createdAt: new Date(apiKey.createdAt)
        };
        this.apiKeys.set(apiKey.id, apiKeyWithDates);
        
        const user = this.users.get(userId);
        if (user) {
          const updatedUser = {
            ...user,
            apiKeys: [
              ...(user.apiKeys || []),
              {
                id: apiKey.id,
                name: apiKey.name,
                provider: apiKey.provider,
                masked: masked,
                createdAt: new Date(apiKey.createdAt)
              }
            ]
          };
          this.users.set(userId, updatedUser);
        }
        break;
      }
      
      case 'conversation_created': {
        const conversation = {
          ...event.data,
          createdAt: new Date(event.data.createdAt),
          updatedAt: new Date(event.data.updatedAt)
        };
        this.conversations.set(conversation.id, conversation);
        const userConvs = this.userConversations.get(conversation.userId) || new Set();
        userConvs.add(conversation.id);
        this.userConversations.set(conversation.userId, userConvs);
        
        // Only initialize message list if it doesn't exist yet
        // This prevents wiping out messages if events are replayed out of order
        if (!this.conversationMessages.has(conversation.id)) {
          this.conversationMessages.set(conversation.id, []);
        }
        break;
      }
      
      case 'conversation_updated': {
        const { id, updates } = event.data;
        const conversation = this.conversations.get(id);
        if (conversation) {
          // Create new object instead of mutating
          const updatesWithDates = { ...updates };
          if (updates.updatedAt) {
            updatesWithDates.updatedAt = new Date(updates.updatedAt);
          }
          const updated = { ...conversation, ...updatesWithDates };
          this.conversations.set(id, updated);
        }
        break;
      }
      
      case 'conversation_archived': {
        const { id } = event.data;
        const conversation = this.conversations.get(id);
        if (conversation) {
          // Create new object instead of mutating
          const updated = { ...conversation, archived: true, updatedAt: event.timestamp };
          this.conversations.set(id, updated);
        }
        break;
      }
      
      case 'message_created': {
        const message = {
          ...event.data,
          branches: event.data.branches.map((branch: any) => ({
            ...branch,
            createdAt: new Date(branch.createdAt)
          }))
        };
        this.messages.set(message.id, message);
        const convMessages = this.conversationMessages.get(message.conversationId) || [];
        convMessages.push(message.id);
        this.conversationMessages.set(message.conversationId, convMessages);
        
        // Update conversation timestamp
        const conversation = this.conversations.get(message.conversationId);
        if (conversation) {
          const updated = { ...conversation, updatedAt: event.timestamp };
          this.conversations.set(message.conversationId, updated);
        }
        break;
      }
      
      case 'message_branch_added': {
        const { messageId, branch } = event.data;
        const message = this.messages.get(messageId);
        if (message) {
          // Create new message object with added branch
          const branchWithDate = {
            ...branch,
            createdAt: new Date(branch.createdAt)
          };
          const updated = {
            ...message,
            branches: [...message.branches, branchWithDate],
            activeBranchId: branch.id
          };
          this.messages.set(messageId, updated);
          
          // Update conversation timestamp
          const conversation = this.conversations.get(message.conversationId);
          if (conversation) {
            const updatedConv = { ...conversation, updatedAt: event.timestamp };
            this.conversations.set(message.conversationId, updatedConv);
          }
        }
        break;
      }
      
      case 'active_branch_changed': {
        const { messageId, branchId } = event.data;
        const message = this.messages.get(messageId);
        if (message) {
          // Create new message object with updated active branch
          const updated = { ...message, activeBranchId: branchId };
          this.messages.set(messageId, updated);
        }
        break;
      }
      
      case 'message_content_updated': {
        const { messageId, branchId, content } = event.data;
        const message = this.messages.get(messageId);
        if (message) {
          // Create new message object with updated content
          const updatedBranches = message.branches.map(branch => 
            branch.id === branchId 
              ? { ...branch, content }
              : branch
          );
          const updated = { ...message, branches: updatedBranches };
          this.messages.set(messageId, updated);
        }
        break;
      }
      
      case 'message_deleted': {
        const { messageId, conversationId } = event.data;
        this.messages.delete(messageId);
        const convMessages = this.conversationMessages.get(conversationId);
        if (convMessages) {
          const index = convMessages.indexOf(messageId);
          if (index > -1) {
            convMessages.splice(index, 1);
          }
        }
        break;
      }
      
      case 'message_imported_raw': {
        // This event is logged when importing raw messages
        // The problem: we only store messageId and conversationId, not the full message
        // So during replay, we can't recreate the messages!
        const { messageId, conversationId } = event.data;
        console.warn(`[Event Replay] Skipping message_imported_raw for message ${messageId}`);
        // This is why imported messages disappear after restart!
        break;
      }
      
      case 'message_branch_deleted': {
        const { messageId, branchId, conversationId } = event.data;
        const message = this.messages.get(messageId);
        if (message) {
          const updatedBranches = message.branches.filter(b => b.id !== branchId);
          if (updatedBranches.length > 0) {
            const updated = {
              ...message,
              branches: updatedBranches,
              activeBranchId: message.activeBranchId === branchId ? updatedBranches[0].id : message.activeBranchId
            };
            this.messages.set(messageId, updated);
          } else {
            // Should not happen, but handle gracefully
            this.messages.delete(messageId);
            const convMessages = this.conversationMessages.get(conversationId);
            if (convMessages) {
              const index = convMessages.indexOf(messageId);
              if (index > -1) {
                convMessages.splice(index, 1);
              }
            }
          }
        }
        break;
      }
      
      case 'participant_created': {
        const { participant } = event.data;
        this.participants.set(participant.id, participant);
        const convParticipants = this.conversationParticipants.get(participant.conversationId) || [];
        convParticipants.push(participant.id);
        this.conversationParticipants.set(participant.conversationId, convParticipants);
        break;
      }
      
      case 'participant_updated': {
        const { participantId, updates } = event.data;
        const participant = this.participants.get(participantId);
        if (participant) {
          const updated = { ...participant, ...updates };
          this.participants.set(participantId, updated);
        }
        break;
      }
      
      case 'participant_deleted': {
        const { participantId, conversationId } = event.data;
        this.participants.delete(participantId);
        const convParticipants = this.conversationParticipants.get(conversationId);
        if (convParticipants) {
          const index = convParticipants.indexOf(participantId);
          if (index > -1) {
            convParticipants.splice(index, 1);
          }
        }
        break;
      }
      
      case 'metrics_added': {
        const { conversationId, metrics } = event.data;
        if (!this.conversationMetrics.has(conversationId)) {
          this.conversationMetrics.set(conversationId, []);
        }
        const convMetrics = this.conversationMetrics.get(conversationId)!;
        convMetrics.push(metrics);
        break;
      }
      
      // Share events
      case 'share_created':
      case 'share_deleted':
      case 'share_viewed':
        this.sharesStore.replayEvent(event);
        break;

      // Bookmark events
      case 'bookmark_created': {
        const { bookmark } = event.data;
        const bookmarkWithDate = {
          ...bookmark,
          createdAt: new Date(bookmark.createdAt)
        };
        this.bookmarks.set(bookmark.id, bookmarkWithDate);
        const key = `${bookmark.messageId}-${bookmark.branchId}`;
        this.branchBookmarks.set(key, bookmark.id);
        break;
      }

      case 'bookmark_updated': {
        const { bookmarkId, label } = event.data;
        const bookmark = this.bookmarks.get(bookmarkId);
        if (bookmark) {
          const updated = { ...bookmark, label };
          this.bookmarks.set(bookmarkId, updated);
        }
        break;
      }

      case 'bookmark_deleted': {
        const { bookmarkId, messageId, branchId } = event.data;
        this.bookmarks.delete(bookmarkId);
        const key = `${messageId}-${branchId}`;
        this.branchBookmarks.delete(key);
        break;
      }

      // Add more cases as needed
      }
    } catch (error) {
      console.error(`Error replaying event ${event.type}:`, error);
      console.error('Event data:', JSON.stringify(event.data, null, 2));
      // Continue processing other events instead of crashing
    }
  }

  // User methods
  async createUser(email: string, password: string, name: string): Promise<User> {
    if (this.usersByEmail.has(email)) {
      throw new Error('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user: User = {
      id: uuidv4(),
      email,
      name,
      createdAt: new Date(),
      apiKeys: []
    };

    this.users.set(user.id, user);
    this.usersByEmail.set(email, user.id);
    this.userConversations.set(user.id, new Set());
    this.passwordHashes.set(email, hashedPassword);

    // Set user as loaded to avoid duplicate loading
    this.userLastAccessedTimes.set(user.id, new Date());
    
    // Store password separately (not in User object)
    this.logEvent('user_created', { user, passwordHash: hashedPassword });

    return user;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const userId = this.usersByEmail.get(email);
    if (!userId) return null;
    return this.users.get(userId) || null;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async validatePassword(email: string, password: string): Promise<boolean> {
    const passwordHash = this.passwordHashes.get(email);
    if (!passwordHash) return false;
    
    return bcrypt.compare(password, passwordHash);
  }

  // API Key methods
  async createApiKey(userId: string, data: import('@deprecated-claude/shared').CreateApiKey): Promise<import('@deprecated-claude/shared').ApiKey> {
    const apiKey = {
      id: uuidv4(),
      userId,
      name: data.name,
      provider: data.provider,
      credentials: data.credentials,
      createdAt: new Date(),
      updatedAt: new Date()
    } as import('@deprecated-claude/shared').ApiKey;

    this.apiKeys.set(apiKey.id, apiKey);
    
    const user = await this.getUserById(userId);
    if (user) {
      // Create masked version for display
      let masked = '****';
      if ('apiKey' in apiKey.credentials) {
        masked = '****' + (apiKey.credentials.apiKey as string).slice(-4);
      } else if ('accessKeyId' in apiKey.credentials) {
        masked = '****' + (apiKey.credentials.accessKeyId as string).slice(-4);
      }
      
      // Create new user object with updated apiKeys
      const updatedUser = {
        ...user,
        apiKeys: [
          ...(user.apiKeys || []),
          {
            id: apiKey.id,
            name: apiKey.name,
            provider: apiKey.provider,
            masked,
            createdAt: apiKey.createdAt
          }
        ]
      };
      this.users.set(userId, updatedUser);
    }

    await this.logEvent('api_key_created', { 
      apiKeyId: apiKey.id,
      userId,
      provider: apiKey.provider
    });
    
    return apiKey;
  }

  async getApiKey(keyId: string): Promise<ApiKey | null> {
    return this.apiKeys.get(keyId) || null;
  }

  async getUserApiKeys(userId: string): Promise<ApiKey[]> {
    return Array.from(this.apiKeys.values()).filter(key => key.userId === userId);
  }
  
  async deleteApiKey(keyId: string): Promise<boolean> {
    return this.apiKeys.delete(keyId);
  }

  // Conversation methods
  async createConversation(userId: string, title: string, model: string, systemPrompt?: string, settings?: any, format?: 'standard' | 'prefill', contextManagement?: any): Promise<Conversation> {
    const conversation: Conversation = {
      id: uuidv4(),
      userId,
      title: title || 'New Conversation',
      model,
      systemPrompt,
      format: format || 'standard',
      createdAt: new Date(),
      updatedAt: new Date(),
      archived: false,
      settings: settings || {
        temperature: 1.0,
        maxTokens: 1024
        // topP and topK are intentionally omitted to use API defaults
      },
      contextManagement
    };

    // Load this user's current conversations if not already loaded
    await this.loadUser(userId);

    this.conversations.set(conversation.id, conversation);
    
    const userConvs = this.userConversations.get(userId) || new Set();
    userConvs.add(conversation.id);
    this.userConversations.set(userId, userConvs);
    
    this.conversationMessages.set(conversation.id, []);

    // manually set as loaded to avoid duplicate loading
    this.conversationsLastAccessedTimes.set(conversation.id, new Date());

    await this.logUserEvent(conversation.userId, 'conversation_created', conversation);
    
    // Create default participants
    if (format === 'standard' || !format) {
      // Standard format: fixed User and Assistant
      await this.createParticipant(conversation.id, userId, 'H', 'user');
      await this.createParticipant(conversation.id, userId, 'A', 'assistant', model, systemPrompt, settings);
    } else {
      // Prefill format: starts with default participants but can add more
      // Get model display name for assistant participant
      const modelLoader = ModelLoader.getInstance();
      const modelConfig = await modelLoader.getModelById(model);
      const assistantName = modelConfig?.displayName || 'A';
      
      await this.createParticipant(conversation.id, userId, 'H', 'user');
      await this.createParticipant(conversation.id, userId, assistantName, 'assistant', model, systemPrompt, settings);
    }

    return conversation;
  }

  private async tryLoadAndVerifyConversation(conversationId: string, conversationOwnerUserId: string) : Promise<Conversation | null> {
    await this.loadUser(conversationOwnerUserId); // load user if not already loaded, which contains conversation metadata
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return null;
    if (conversation.userId !== conversationOwnerUserId) {
      console.warn(`Conversation owner mismatch for conversation ${conversationId}: Actual conversation.userId is ${conversation.userId} but given conversationOwnerUserId ${conversationOwnerUserId}`);
      return null;
    }
    return conversation;
  }

  async getConversation(conversationId: string, conversationOwnerUserId: string): Promise<Conversation | null> {
    return await this.tryLoadAndVerifyConversation(conversationId, conversationOwnerUserId);
  }

  async getUserConversations(userId: string): Promise<Conversation[]> {
    await this.loadUser(userId); // load user if not already loaded
    const convIds = this.userConversations.get(userId) || new Set();
    return Array.from(convIds)
      .map(id => this.conversations.get(id))
      .filter((conv): conv is Conversation => conv !== undefined && !conv.archived)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async updateConversation(conversationId: string, conversationOwnerUserId: string, updates: Partial<Conversation>): Promise<Conversation | null> {
    const conversation = await this.tryLoadAndVerifyConversation(conversationId, conversationOwnerUserId);
    if (!conversation) return null;

    // also update updatedAt to now
    updates = {
      ...updates,
      updatedAt: new Date()
    };

    const updated = {
      ...conversation,
      ...updates,
    };

    this.conversations.set(conversationId, updated);

    await this.logUserEvent(conversationOwnerUserId, 'conversation_updated', { id: conversationId, updates });

    // If the model was updated and this is a standard conversation, 
    // update the assistant participant's model (but NOT the name)
    if (updates.model && conversation.format === 'standard') {
      const participants = await this.getConversationParticipants(conversationId, conversationOwnerUserId);
      const defaultAssistant = participants.find(p => p.type === 'assistant');
      if (defaultAssistant) {
        // Only update the model, keep the name as "Assistant"
        await this.updateParticipant(defaultAssistant.id, conversationOwnerUserId, { 
          model: updates.model
        });
      }
    }

    return updated;
  }

  async updateConversationTimestamp(conversationId: string, conversationOwnerUserId: string) {
      await this.updateConversation(conversationId, conversationOwnerUserId, { updatedAt: new Date() });
  }

  async archiveConversation(conversationId: string, conversationOwnerUserId: string): Promise<boolean> {
    const conversation = await this.tryLoadAndVerifyConversation(conversationId, conversationOwnerUserId);
    if (!conversation) return false;

    // Create new object instead of mutating
    const updated = {
      ...conversation,
      archived: true,
      updatedAt: new Date()
    };
    
    this.conversations.set(conversationId, updated);
    await this.logUserEvent(conversation.userId, 'conversation_archived', { id: conversationId });
    
    return true;
  }

  async duplicateConversation(conversationId: string, originalOwnerUserId: string, duplicateOwnerUserId: string): Promise<Conversation | null> {
    const original = await this.tryLoadAndVerifyConversation(conversationId, originalOwnerUserId);
    if (!original) return null;
    await this.loadUser(duplicateOwnerUserId);

    // This will log the relevant user events for conversation metadata
    const duplicate = await this.createConversation(
      duplicateOwnerUserId,
      `${original.title} (Copy)`,
      original.model,
      original.systemPrompt,
      original.settings,
      original.format,
      original.contextManagement ? JSON.parse(JSON.stringify(original.contextManagement)) : undefined
    );
    
    // carry over prefill user message
    if (original.prefillUserMessage) {
      await this.updateConversation(duplicate.id, duplicate.userId, { prefillUserMessage: original.prefillUserMessage });
    }

    const originalParticipants = await this.getConversationParticipants(
      conversationId,
      originalOwnerUserId
    );
    const duplicateDefaults = await this.getConversationParticipants(
      duplicate.id,
      duplicateOwnerUserId
    );

    // Drop the auto-created defaults so we can mirror the original exactly.
    for (const participant of duplicateDefaults) {
      await this.deleteParticipant(participant.id, duplicateOwnerUserId);
    }

    const participantIdMap = new Map<string, string>();
    for (const participant of originalParticipants) {
      // this will also send the events to the conversation logs
      const cloned = await this.createParticipant(
        duplicate.id,
        duplicateOwnerUserId,
        participant.name,
        participant.type,
        participant.model,
        participant.systemPrompt,
        participant.settings ? JSON.parse(JSON.stringify(participant.settings)) : undefined,
        participant.contextManagement ? JSON.parse(JSON.stringify(participant.contextManagement)) : undefined
      );
      // We need to mirror this flag as well, by default they are active
      if (!participant.isActive) {
        await this.updateParticipant(cloned.id, duplicateOwnerUserId, { isActive: false});
      }
      participantIdMap.set(participant.id, cloned.id);
    }

    // Copy messages
    const messages = await this.getConversationMessages(conversationId, originalOwnerUserId);
    const oldMessageBranchIdToNewMessageBranchId : Map<string, string> = new Map();
    var newMessages : Array<Message> = [];
    for (const message of messages) {
      const newMessage: Message = {
        ...message,
        id: uuidv4(),
        conversationId: duplicate.id
      };
      
      // remap any branches to new ids
      newMessage.branches = newMessage.branches.map((branch) => {
        const newBranchId: string = uuidv4();
        oldMessageBranchIdToNewMessageBranchId.set(branch.id, newBranchId);
        return {
          ...branch,
          id: newBranchId,
          // remap participant id to the new participants
          participantId: branch.participantId ? participantIdMap.get(branch.participantId) : undefined
        };
      });

      var mappedActiveBranchId = oldMessageBranchIdToNewMessageBranchId.get(newMessage.activeBranchId);

      // If can't map, just use first branch
      newMessage.activeBranchId = mappedActiveBranchId ? mappedActiveBranchId : newMessage.branches[0]?.id;

      newMessages.push(newMessage);
    }

    // map the parent branch ids to the new ones
    newMessages = newMessages.map(message => ({
      ...message,
      branches: message.branches.map(branch => ({
        ...branch,
        parentBranchId: branch.parentBranchId ? oldMessageBranchIdToNewMessageBranchId.get(branch.parentBranchId) : undefined
      }))
    }));

    this.conversationMessages.set(duplicate.id, newMessages.map(message => message.id));

    for (const newMessage of newMessages) {
      this.messages.set(newMessage.id, newMessage);
      // log full message creation events so they can be recreated
      await this.logConversationEvent(duplicate.id, 'message_created', newMessage);
    }
    
    return duplicate;
  }

  // Message methods
  async createMessage(conversationId: string, conversationOwnerUserId: string, content: string, role: 'user' | 'assistant' | 'system', model?: string, explicitParentBranchId?: string, participantId?: string, attachments?: any[]): Promise<Message> {
    const conversation = await this.tryLoadAndVerifyConversation(conversationId, conversationOwnerUserId);
    if (!conversation) throw new Error("Conversation not found");
    // Get conversation messages to determine parent
    const existingMessages = await this.getConversationMessages(conversationId, conversationOwnerUserId);
    
    console.log(`createMessage called with explicitParentBranchId: ${explicitParentBranchId} (type: ${typeof explicitParentBranchId})`);
    
    // Determine parent branch ID
    let parentBranchId: string;
    if (explicitParentBranchId !== undefined && explicitParentBranchId !== null) {
      // Use explicitly provided parent
      parentBranchId = explicitParentBranchId;
      console.log(`Using explicit parent: ${parentBranchId}`);
    } else {
      // Auto-determine parent
      parentBranchId = 'root'; // Default for first message
      if (existingMessages.length > 0) {
        // Get the active branch of the last message
        const lastMessage = existingMessages[existingMessages.length - 1];
        const lastActiveBranch = lastMessage.branches.find(b => b.id === lastMessage.activeBranchId);
        if (lastActiveBranch) {
          parentBranchId = lastActiveBranch.id;
        }
      }
      console.log(`Auto-determined parent: ${parentBranchId}`);
    }
    
    const message: Message = {
      id: uuidv4(),
      conversationId,
      branches: [{
        id: uuidv4(),
        content,
        role,
        participantId,
        createdAt: new Date(),
        model,
        // isActive removed - deprecated field not used
        parentBranchId,
        attachments: attachments ? attachments.map(att => ({
          id: uuidv4(),
          fileName: att.fileName,
          fileSize: att.fileSize || att.content.length,
          fileType: att.fileType,
          content: att.content,
          createdAt: new Date()
        })) : undefined
      }],
      activeBranchId: '',
      order: 0
    };
    
    message.activeBranchId = message.branches[0].id;
    
    console.log(`Created message with branch parentBranchId: ${message.branches[0].parentBranchId}`);
    if (message.branches[0].attachments) {
      console.log(`Message has ${message.branches[0].attachments.length} attachments`);
    }
    
    // Get current message count for ordering
    // IMPORTANT: Always get or create a fresh array to avoid reference issues
    let convMessages = this.conversationMessages.get(conversationId);
    if (!convMessages) {
      convMessages = [];
      this.conversationMessages.set(conversationId, convMessages);
    }
    message.order = convMessages.length;
    
    this.messages.set(message.id, message);
    convMessages.push(message.id);
    
    console.log(`Stored message ${message.id} for conversation ${conversationId}. Total messages: ${convMessages.length}`);
    
    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    await this.logConversationEvent(conversationId, 'message_created', message);

    return message;
  }

  private async tryLoadAndVerifyMessage(messageId: string, conversationId: string, conversationOwnerUserId: string) : Promise<Message | null> {
    await this.loadUser(conversationOwnerUserId);
    await this.loadConversation(conversationId, conversationOwnerUserId);
    const message = this.messages.get(messageId);
    if (!message) return null;
    if (message.conversationId !== conversationId) {
      console.warn(`Mismatched message.conversationId ${message.conversationId} does not match given conversationId ${conversationId}`);
      return null;
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) return null;
    if (conversation.userId !== conversationOwnerUserId) {
      console.warn(`Mismatched conversation.userId ${message.conversationId} does not match given conversationOwnerUserId ${conversationOwnerUserId}`);
      return null;
    }
    return message;
  }

  async addMessageBranch(messageId: string, conversationId: string, conversationOwnerUserId: string, content: string, role: 'user' | 'assistant' | 'system', parentBranchId?: string, model?: string, participantId?: string, attachments?: any[]): Promise<Message | null> {
    const message = await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
    if (!message) return null;
    
    const newBranch = {
      id: uuidv4(),
      content,
      role,
      participantId,
      createdAt: new Date(),
      model,
      parentBranchId,
      // isActive removed - deprecated field not used
      attachments: attachments ? attachments.map(att => ({
        id: uuidv4(),
        fileName: att.fileName,
        fileSize: att.fileSize || att.content.length,
        fileType: att.fileType,
        content: att.content,
        createdAt: new Date()
      })) : undefined
    };

    // Create new message object with added branch
    const updatedMessage = {
      ...message,
      branches: [...message.branches, newBranch],
      activeBranchId: newBranch.id
    };
    
    this.messages.set(messageId, updatedMessage);

    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    await this.logConversationEvent(conversationId, 'message_branch_added', { messageId, branch: newBranch });

    return updatedMessage;
  }

  async setActiveBranch(messageId: string, conversationId: string, conversationOwnerUserId: string, branchId: string): Promise<boolean> {
    const message = await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
    if (!message) return false;
    
    const branch = message.branches.find(b => b.id === branchId);
    if (!branch) return false;

    // Create new message object with updated active branch
    const updated = { ...message, activeBranchId: branchId };
    this.messages.set(messageId, updated);

    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    await this.logConversationEvent(conversationId, 'active_branch_changed', { messageId, branchId });

    return true;
  }
  
  async updateMessage(messageId: string, conversationId: string, conversationOwnerUserId: string, message: Message): Promise<boolean> {
    const oldMessage = await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
    if (!oldMessage) return false;
    
    this.messages.set(messageId, message);
    
    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    await this.logConversationEvent(conversationId, 'message_updated', { messageId, message });
    
    return true;
  }
  
  async deleteMessage(messageId: string, conversationId: string, conversationOwnerUserId: string): Promise<boolean> {
    const message = await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
    if (!message) return false;
    
    // Remove from messages map
    this.messages.delete(messageId);
    
    // Remove from conversation's message list
    const messageIds = this.conversationMessages.get(message.conversationId);
    if (messageIds) {
      const index = messageIds.indexOf(messageId);
      if (index > -1) {
        messageIds.splice(index, 1);
      }
    }
    
    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    await this.logConversationEvent(conversationId, 'message_deleted', { messageId, conversationId });

    return true;
  }
  
  async importRawMessage(conversationId: string, conversationOwnerUserId: string, messageData: any): Promise<void> {
    await this.loadUser(conversationOwnerUserId);
    await this.loadConversation(conversationId, conversationOwnerUserId);
    
    const conversation = this.conversations.get(conversationId);
    // Validate the conversation exists and we have correct user owner
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    if (conversation.userId !== conversationOwnerUserId) {
      throw new Error(`Mismatched given owner id ${conversationOwnerUserId} and actual conversation.userId ${conversation.userId}`);
    }
    
    // Create the message object with all branches
    const message: Message = {
      id: messageData.id,
      conversationId: conversationId,
      branches: messageData.branches.map((branch: any) => ({
        id: branch.id,
        content: branch.content,
        role: branch.role,
        participantId: branch.participantId,
        createdAt: new Date(branch.createdAt),
        model: branch.model,
        // isActive: branch.isActive, // Deprecated field - ignored on import
        parentBranchId: branch.parentBranchId,
        attachments: branch.attachments
      })),
      activeBranchId: messageData.activeBranchId,
      order: messageData.order
    };
    
    // Store the message
    this.messages.set(message.id, message);
    
    // Add to conversation's message list in order
    let messageIds = this.conversationMessages.get(conversationId);
    if (!messageIds) {
      messageIds = [];
      this.conversationMessages.set(conversationId, messageIds);
    }
    
    // Insert at the correct position based on order
    const insertIndex = messageIds.findIndex(id => {
      const msg = this.messages.get(id);
      return msg && msg.order > message.order;
    });
    
    if (insertIndex === -1) {
      messageIds.push(message.id);
    } else {
      messageIds.splice(insertIndex, 0, message.id);
    }
    
    // Instead of logging a minimal import event, log a full message_created event
    // This ensures the message can be recreated during event replay
    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    await this.logConversationEvent(conversationId, 'message_created', message);
  }
  
  async updateMessageContent(messageId: string, conversationId: string, conversationOwnerUserId: string, branchId: string, content: string): Promise<boolean> {
    const message = await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
    if (!message) return false;
    
    const branch = message.branches.find(b => b.id === branchId);
    if (!branch) return false;
    
    // Create new message object with updated content
    const updatedBranches = message.branches.map(b => 
      b.id === branchId 
        ? { ...b, content }
        : b
    );
    const updated = { ...message, branches: updatedBranches };
    this.messages.set(messageId, updated);
    
    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    await this.logConversationEvent(conversationId, 'message_content_updated', { messageId, branchId, content });

    return true;
  }
  
  async deleteMessageBranch(messageId: string, conversationId: string, conversationOwnerUserId: string, branchId: string): Promise<string[] | null> {
    const message = await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
    if (!message) return null;
    
    const branch = message.branches.find(b => b.id === branchId);
    if (!branch) return null;

    const deletedMessageIds: string[] = [];
    
    // If this is the only branch, delete the entire message and cascade
    if (message.branches.length === 1) {
      // Find all messages that need to be deleted (cascade)
      const messagesToDelete = this.findDescendantMessages(messageId, branchId);
      deletedMessageIds.push(messageId, ...messagesToDelete);
      
      // Delete messages in reverse order (children first)
      for (const msgId of [...messagesToDelete].reverse()) {
        const msg = this.messages.get(msgId);
        if (msg) {
          this.messages.delete(msgId);
          const convMessages = this.conversationMessages.get(msg.conversationId);
          if (convMessages) {
            const index = convMessages.indexOf(msgId);
            if (index > -1) {
              convMessages.splice(index, 1);
            }
          }
          
          await this.logConversationEvent(conversationId, 'message_deleted', { 
            messageId: msgId,
            conversationId
          });
        }
      }
      
      // Delete the original message
      this.messages.delete(messageId);
      const convMessages = this.conversationMessages.get(message.conversationId);
      if (convMessages) {
        const index = convMessages.indexOf(messageId);
        if (index > -1) {
          convMessages.splice(index, 1);
        }
      }
      
      await this.logConversationEvent(conversationId, 'message_deleted', { 
        messageId,
        conversationId
      });
    } else {
      // Just remove this branch
      const updatedBranches = message.branches.filter(b => b.id !== branchId);
      const updatedMessage = {
        ...message,
        branches: updatedBranches,
        updatedAt: new Date(),
        // If we're deleting the active branch, switch to another branch
        activeBranchId: message.activeBranchId === branchId ? updatedBranches[0].id : message.activeBranchId
      };
      
      this.messages.set(messageId, updatedMessage);
      
      await this.logConversationEvent(conversationId, 'message_branch_deleted', { 
        messageId,
        branchId,
        conversationId
      });
      
      // Still need to cascade delete messages that reply to this specific branch
      const descendantMessages = this.findDescendantMessages(messageId, branchId);
      deletedMessageIds.push(...descendantMessages);
      
      for (const msgId of [...descendantMessages].reverse()) {
        const msg = this.messages.get(msgId);
        if (msg) {
          this.messages.delete(msgId);
          const convMessages = this.conversationMessages.get(msg.conversationId);
          if (convMessages) {
            const index = convMessages.indexOf(msgId);
            if (index > -1) {
              convMessages.splice(index, 1);
            }
          }
          
          await this.logConversationEvent(conversationId, 'message_deleted', { 
            messageId: msgId,
            conversationId
          });
        }
      }
    }

    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    
    return deletedMessageIds;
  }
  
  private findDescendantMessages(messageId: string, branchId: string): string[] {
    const descendants: string[] = [];
    const conversation = Array.from(this.messages.values()).find(m => m.id === messageId)?.conversationId;
    
    if (!conversation) return descendants;
    
    const allMessages = Array.from(this.messages.values())
      .filter(m => m.conversationId === conversation)
      .sort((a, b) => a.order - b.order);
    
    // Find the index of the current message
    const currentIndex = allMessages.findIndex(m => m.id === messageId);
    if (currentIndex === -1) return descendants;
    
    // Track which branch path we're following
    let currentBranchId = branchId;
    
    // Look at all messages after this one
    for (let i = currentIndex + 1; i < allMessages.length; i++) {
      const msg = allMessages[i];
      
      // Check if any branch of this message has parentBranchId matching our current branch
      const matchingBranch = msg.branches.find(b => b.parentBranchId === currentBranchId);
      
      if (matchingBranch) {
        descendants.push(msg.id);
        // Update the branch we're following to this message's active branch
        currentBranchId = msg.activeBranchId;
      } else {
        // If no branch continues from our current branch, stop looking
        break;
      }
    }
    
    return descendants;
  }

  async getConversationMessages(conversationId: string, conversationOwnerUserId: string): Promise<Message[]> {
    await this.loadUser(conversationOwnerUserId);
    await this.loadConversation(conversationId, conversationOwnerUserId);
    const messageIds = this.conversationMessages.get(conversationId) || [];
    const messages = messageIds
      .map(id => this.messages.get(id))
      .filter((msg): msg is Message => msg !== undefined)
      .sort((a, b) => a.order - b.order);
    
    // Only log if there's a potential issue
    if (messageIds.length !== messages.length) {
      console.warn(`Message mismatch for conversation ${conversationId}: ${messageIds.length} IDs but only ${messages.length} messages found`);
    }
    
    return messages;
  }

  async getMessage(messageId: string, conversationId: string, conversationOwnerUserId: string): Promise<Message | null> {
    return await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
  }

  async tryLoadAndVerifyParticipant(participantId: string, conversationOwnerUserId: string) : Promise<Participant | null> {
    await this.loadUser(conversationOwnerUserId); // participant data is stored in user files
    const participant = this.participants.get(participantId);
    if (!participant) return null;
    const conversation = this.conversations.get(participant.conversationId);
    if (!conversation) return null;
    if (conversation.userId != conversationOwnerUserId) {
      console.warn(`Mismatched participant.conversation.userId ${conversation.userId} and provided conversationOwnerUserId ${conversationOwnerUserId}`);
      return null;
    }
    return participant;
  }
  
  // Participant methods
  async createParticipant(
    conversationId: string, 
    conversationOwnerUserId: string,
    name: string, 
    type: 'user' | 'assistant', 
    model?: string,
    systemPrompt?: string,
    settings?: any,
    contextManagement?: any
  ): Promise<Participant> {
    await this.loadUser(conversationOwnerUserId);
    const participant: Participant = {
      id: uuidv4(),
      conversationId,
      name,
      type,
      model,
      systemPrompt,
      settings,
      contextManagement,
      isActive: true
    };
    
    this.participants.set(participant.id, participant);
    
    const convParticipants = this.conversationParticipants.get(conversationId) || [];
    convParticipants.push(participant.id);
    this.conversationParticipants.set(conversationId, convParticipants);

    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      await this.logUserEvent(conversation.userId, 'participant_created', { participant });
    }
    
    return participant;
  }
  
  async getConversationParticipants(conversationId: string, conversationOwnerUserId: string): Promise<Participant[]> {
    await this.loadUser(conversationOwnerUserId);
    const participantIds = this.conversationParticipants.get(conversationId) || [];
    const participants = participantIds
      .map(id => this.participants.get(id))
      .filter((p): p is Participant => p !== undefined);
    

    return participants;
  }
  
  async getParticipant(participantId: string, conversationOwnerUserId: string): Promise<Participant | null> {
    return await this.tryLoadAndVerifyParticipant(participantId, conversationOwnerUserId);
  }
  
  async updateParticipant(participantId: string, conversationOwnerUserId: string, updates: Partial<Participant>): Promise<Participant | null> {
    const participant = await this.tryLoadAndVerifyParticipant(participantId, conversationOwnerUserId);
    if (!participant) return null;
    
    const updated = {
      ...participant,
      ...updates
    };
    
    this.participants.set(participantId, updated);
  
    await this.logUserEvent(conversationOwnerUserId, 'participant_updated', { participantId, updates });
    
    return updated;
  }
  
  async deleteParticipant(participantId: string, conversationOwnerUserId: string): Promise<boolean> {
    const participant = await this.tryLoadAndVerifyParticipant(participantId, conversationOwnerUserId);
    if (!participant) return false;
    
    this.participants.delete(participantId);
    
    const convParticipants = this.conversationParticipants.get(participant.conversationId);
    if (convParticipants) {
      const index = convParticipants.indexOf(participantId);
      if (index > -1) {
        convParticipants.splice(index, 1);
      }
    }
    
    await this.logUserEvent(conversationOwnerUserId, 'participant_deleted', { participantId, conversationId: participant.conversationId });

    return true;
  }

  // Export/Import functionality
  async exportConversation(conversationId: string, conversationOwnerUserId: string): Promise<any> {
    const conversation = await this.tryLoadAndVerifyConversation(conversationId, conversationOwnerUserId);
    if (!conversation) return null;

    const messages = await this.getConversationMessages(conversationId, conversationOwnerUserId);
    const participants = await this.getConversationParticipants(conversationId, conversationOwnerUserId);

    return {
      conversation,
      messages,
      participants,
      exportedAt: new Date(),
      version: '1.0' // Version for future compatibility
    };
  }

  // Metrics methods
  async addMetrics(conversationId: string, conversationOwnerUserId: string, metrics: MetricsData): Promise<void> {

    const conversation = await this.tryLoadAndVerifyConversation(conversationId, conversationOwnerUserId);
    if (!conversation) return;

    if (!this.conversationMetrics.has(conversationId)) {
      this.conversationMetrics.set(conversationId, []);
    }
    
    const convMetrics = this.conversationMetrics.get(conversationId)!;
    convMetrics.push(metrics);
    
    // Store event
    await this.logUserEvent(conversationOwnerUserId, 'metrics_added', { conversationId, metrics });
  }
  
  async getConversationMetrics(conversationId: string, conversationOwnerUserId: string): Promise<MetricsData[]> {
    const conversation = await this.tryLoadAndVerifyConversation(conversationId, conversationOwnerUserId);
    if (!conversation) return [];
    return this.conversationMetrics.get(conversationId) || [];
  }
  
  async getConversationMetricsSummary(conversationId: string, conversationOwnerUserId: string): Promise<{
    messageCount: number;
    perModelMetrics: Map<string, ModelConversationMetrics>;
    lastCompletion?: MetricsData;
    totals: TotalsMetrics;
  } | null> {
    const metrics = await this.getConversationMetrics(conversationId, conversationOwnerUserId);
    const messages = await this.getConversationMessages(conversationId, conversationOwnerUserId);
    const participants = await this.getConversationParticipants(conversationId, conversationOwnerUserId);
    
    const perModelMetrics = new Map<string, ModelConversationMetrics>(
      participants
        .filter(p => typeof p.model === 'string' && p.model.length > 0 && p.type == "assistant")  // only the ones with a model
        .map(p => [
          p.model as string,
          ModelConversationMetricsSchema.parse({
            participant: p,
            contextManagement: p.contextManagement
          })
        ])
    );
    const totals = TotalsMetricsSchema.parse({
      completionCount: metrics.length
    });
    
    for (const metric of metrics) {
      totals.inputTokens += metric.inputTokens;
      totals.outputTokens += metric.outputTokens;
      totals.cachedTokens += metric.cachedTokens;
      totals.totalCost += metric.cost;
      totals.totalSavings += metric.cacheSavings;
      const modelMetrics = perModelMetrics.get(metric.model);
      if (modelMetrics) {
        modelMetrics.lastCompletion = metric;
        modelMetrics.totals.inputTokens += metric.inputTokens;
        modelMetrics.totals.outputTokens += metric.outputTokens;
        modelMetrics.totals.cachedTokens += metric.cachedTokens;
        modelMetrics.totals.totalCost += metric.cost;
        modelMetrics.totals.completionCount += 1;
      }
    }
    
    return {
      messageCount: messages.length,
      perModelMetrics: perModelMetrics,
      lastCompletion: metrics[metrics.length-1],
      totals: totals
    }
  }

  // Share management methods
  async createShare(
    conversationId: string,
    conversationOwnerUserId: string,
    shareType: 'branch' | 'tree',
    branchId?: string,
    settings?: Partial<SharedConversation['settings']>,
    expiresAt?: Date
  ): Promise<SharedConversation> {
    // Verify the user owns the conversation
    const conversation = await this.tryLoadAndVerifyConversation(conversationId, conversationOwnerUserId);
    if (!conversation) {
      throw new Error('Conversation not found or unauthorized');
    }
    
    const share = await this.sharesStore.createShare(
      conversationId,
      conversationOwnerUserId,
      shareType,
      branchId,
      settings,
      expiresAt
    );
    
    // Persist the share creation event
    const event: Event = {
      timestamp: new Date(),
      type: 'share_created',
      data: share
    };
    await this.eventStore.appendEvent(event);
    
    return share;
  }
  
  async getShareByToken(token: string): Promise<SharedConversation | null> {
    return this.sharesStore.getShareByToken(token);
  }
  
  async getSharesByUser(userId: string): Promise<SharedConversation[]> {
    return this.sharesStore.getSharesByUser(userId);
  }
  
  async deleteShare(id: string, userId: string): Promise<boolean> {
    const deleted = await this.sharesStore.deleteShare(id, userId);
    
    if (deleted) {
      // Persist the share deletion event
      const event: Event = {
        timestamp: new Date(),
        type: 'share_deleted',
        data: { id }
      };
      await this.eventStore.appendEvent(event);
    }
    
    return deleted;
  }

  // Bookmark methods
  async createOrUpdateBookmark(
    conversationId: string,
    messageId: string,
    branchId: string,
    label: string
  ): Promise<Bookmark> {
    const key = `${messageId}-${branchId}`;
    const existingBookmarkId = this.branchBookmarks.get(key);

    if (existingBookmarkId) {
      // Update existing bookmark
      const existingBookmark = this.bookmarks.get(existingBookmarkId);
      if (existingBookmark) {
        const updated = { ...existingBookmark, label };
        this.bookmarks.set(existingBookmarkId, updated);

        this.logEvent('bookmark_updated', {
          bookmarkId: existingBookmarkId,
          label
        });

        return updated;
      }
    }

    // Create new bookmark
    const bookmark: Bookmark = {
      id: uuidv4(),
      conversationId,
      messageId,
      branchId,
      label,
      createdAt: new Date()
    };

    this.bookmarks.set(bookmark.id, bookmark);
    this.branchBookmarks.set(key, bookmark.id);

    this.logEvent('bookmark_created', { bookmark });

    return bookmark;
  }

  async deleteBookmark(messageId: string, branchId: string): Promise<boolean> {
    const key = `${messageId}-${branchId}`;
    const bookmarkId = this.branchBookmarks.get(key);

    if (!bookmarkId) {
      return false;
    }

    this.bookmarks.delete(bookmarkId);
    this.branchBookmarks.delete(key);

    this.logEvent('bookmark_deleted', {
      bookmarkId,
      messageId,
      branchId
    });

    return true;
  }

  async getConversationBookmarks(conversationId: string): Promise<Bookmark[]> {
    return Array.from(this.bookmarks.values())
      .filter(bookmark => bookmark.conversationId === conversationId);
  }

  async getBookmarkForBranch(messageId: string, branchId: string): Promise<Bookmark | null> {
    const key = `${messageId}-${branchId}`;
    const bookmarkId = this.branchBookmarks.get(key);
    return bookmarkId ? this.bookmarks.get(bookmarkId) || null : null;
  }

  // Close database connection
  async close(): Promise<void> {
    await this.eventStore.close();
    await this.userEventStore.close();
    await this.conversationEventStore.close();
  }
}
