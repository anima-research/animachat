import { User, Conversation, Message, MessageBranch, Participant, ApiKey, Bookmark, UserDefinedModel, GrantInfo, GrantCapability, UserGrantSummary, GrantUsageDetails, Invite, getValidatedModelDefaults } from '@deprecated-claude/shared';
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
import { getBlobStore } from './blob-store.js';
import { CollaborationStore } from './collaboration.js';
import { PersonaStore } from './persona.js';
import { ConversationUIStateStore } from './conversation-ui-state.js';
import { SharePermission, ConversationShare, canChat, canDelete } from '@deprecated-claude/shared';
import {
  Persona,
  PersonaHistoryBranch,
  PersonaParticipation,
  PersonaShare,
  PersonaPermission,
  CreatePersonaRequest,
  UpdatePersonaRequest,
  PersonaJoinRequest,
  ForkHistoryBranchRequest
} from '@deprecated-claude/shared';
import { encryption } from '../utils/encryption.js';

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
  details?: GrantUsageDetails;
  failed?: boolean;  // True if this was a failed request (still costs input tokens)
  error?: string;    // Error message if failed
}

// Usage analytics types
export interface UsageDataPoint {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  cost: number;
  requests: number;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  cost: number;
  requests: number;
}

export interface UsageStats {
  // Credit-based usage (from burn records)
  daily: UsageDataPoint[];
  totals: UsageTotals;
  byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cost: number;
    requests: number;
  }>;
  // Total usage including personal API keys (from metrics)
  allUsage?: {
    daily: UsageDataPoint[];
    totals: UsageTotals;
    byModel: Record<string, {
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      cost: number;
      requests: number;
    }>;
  };
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
  private emailVerificationTokens: Map<string, { userId: string; expiresAt: Date }> = new Map(); // token -> { userId, expiresAt }
  private passwordResetTokens: Map<string, { userId: string; expiresAt: Date }> = new Map(); // token -> { userId, expiresAt }
  private participants: Map<string, Participant> = new Map(); // participantId -> Participant
  private conversationParticipants: Map<string, string[]> = new Map(); // conversationId -> participantIds
  private conversationMetrics: Map<string, MetricsData[]> = new Map(); // conversationId -> metrics

  private userLastAccessedTimes: Map<string, Date> = new Map(); // userId -> last accessed time
  private conversationsLastAccessedTimes: Map<string, Date> = new Map(); // conversationId -> last accessed time

  private bookmarks: Map<string, Bookmark> = new Map(); // bookmarkId -> Bookmark
  private branchBookmarks: Map<string, string> = new Map(); // `${messageId}-${branchId}` -> bookmarkId
  
  private userModels: Map<string, UserDefinedModel> = new Map(); // modelId -> UserDefinedModel
  private userModelsByUser: Map<string, Set<string>> = new Map(); // userId -> modelIds
  private userGrantInfos: Map<string, GrantInfo[]> = new Map();
  private userGrantCapabilities: Map<string, GrantCapability[]> = new Map();
  private userGrantTotals: Map<string, Map<string, number>> = new Map();
  private invites: Map<string, Invite> = new Map(); // code -> Invite

  private eventStore: EventStore;
  // per user, contains conversation metadata events and participant events
  private userEventStore: BulkEventStore;
  // per conversation, contains message and branch events
  private conversationEventStore: BulkEventStore; // per conversation event store
  private sharesStore: SharesStore;
  private collaborationStore: CollaborationStore;
  private personaStore: PersonaStore;
  private uiStateStore: ConversationUIStateStore;
  private initialized: boolean = false;

  constructor() {
    this.eventStore = new EventStore('./data', 'mainEvents.jsonl');
    this.userEventStore = new BulkEventStore("./data/users");
    this.conversationEventStore = new BulkEventStore("./data/conversations");

    this.sharesStore = new SharesStore();
    this.collaborationStore = new CollaborationStore();
    this.personaStore = new PersonaStore();
    this.uiStateStore = new ConversationUIStateStore();
  }
  
  async init(): Promise<void> {
    if (this.initialized) return;


    await this.eventStore.init();
    await this.conversationEventStore.init();
    await this.userEventStore.init();
    await this.uiStateStore.init();

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
      console.log('🧪 Creating additional test users...');
      await this.createAdditionalTestUsers();
    } else {
      // If test user exists but has no custom models, create test models
      const testUserId = 'test-user-id-12345';
      console.log(`Checking for test user ${testUserId}... exists: ${this.users.has(testUserId)}`);
      if (this.users.has(testUserId)) {
        // Ensure user is marked as loaded (in case they were created via old mainEvents)
        this.userLastAccessedTimes.set(testUserId, new Date());
        
        const testUserModels = this.userModelsByUser.get(testUserId);
        console.log(`Test user models: ${testUserModels ? testUserModels.size : 0}`);
        if (!testUserModels || testUserModels.size === 0) {
          console.log('🧪 Test user exists but has no custom models, creating them...');
          await this.createTestModels(testUserId);
        } else {
          console.log('✅ Test user already has custom models');
        }
      }
      // Also ensure additional test users exist
      console.log('🧪 Ensuring additional test users exist...');
      await this.createAdditionalTestUsers();
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
      
      // Apply saved branch selections from the shared UI state store
      // (these are NOT in the event log to avoid bloat)
      const sharedState = await this.uiStateStore.loadShared(conversationId);
      for (const [messageId, branchId] of Object.entries(sharedState.activeBranches)) {
        const message = this.messages.get(messageId);
        if (message) {
          const branch = message.branches.find(b => b.id === branchId);
          if (branch) {
            const updated = { ...message, activeBranchId: branchId };
            this.messages.set(messageId, updated);
          }
        }
      }
    }
    this.conversationsLastAccessedTimes.set(conversationId, new Date());
  }

  // Public method to ensure conversation events are loaded (for cached counts like totalBranchCount)
  async ensureConversationLoaded(conversationId: string, conversationOwnerUserId: string): Promise<void> {
    await this.loadConversation(conversationId, conversationOwnerUserId);
  }

  private unloadConversation(conversationId: string) {
    // we only remove messages and metrics, since conversation metadata is managed via load/unload user
    this.conversationMessages.get(conversationId)?.forEach((messageId) => {
      this.messages.delete(messageId);
    });
    this.conversationMessages.delete(conversationId);;
    this.conversationMetrics.delete(conversationId);

    // Clear cached UI state
    this.uiStateStore.clearCache(conversationId);

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
    this.userGrantInfos.delete(userId);
    this.userGrantCapabilities.delete(userId);
    this.userGrantTotals.delete(userId);
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
    
    // Create test custom models
    await this.createTestModels(testUser.id);
  }

  private async createTestModels(userId: string) {
    // Test OpenRouter model
    const openRouterModel: import('@deprecated-claude/shared').CreateUserModel = {
      displayName: 'Llama 3.1 70B (Test)',
      shortName: 'Llama 70B',
      provider: 'openrouter',
      providerModelId: 'meta-llama/llama-3.1-70b-instruct',
      contextWindow: 131072,
      outputTokenLimit: 4096,
      supportsThinking: false,
      settings: {
        temperature: 1.0,
        maxTokens: 2048,
        topP: 0.9
      }
    };

    // Test OpenAI-compatible model (Ollama)
    const ollamaModel: import('@deprecated-claude/shared').CreateUserModel = {
      displayName: 'Local Llama 3 (Test)',
      shortName: 'Local Llama',
      provider: 'openai-compatible',
      providerModelId: 'llama3',
      contextWindow: 8192,
      outputTokenLimit: 2048,
      supportsThinking: false,
      settings: {
        temperature: 1.0,
        maxTokens: 2048
      },
      customEndpoint: {
        baseUrl: 'http://localhost:11434'
      }
    };

    await this.createUserModel(userId, openRouterModel);
    await this.createUserModel(userId, ollamaModel);
    
    console.log('🧪 Test custom models created');
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

  private async createAdditionalTestUsers() {
    // Additional test users for multi-user testing
    const testUsers = [
      {
        id: 'test-admin-cassandra',
        email: 'cassandra@oracle.test',
        name: 'Cassandra',
        password: 'prophecy123',
        isAdmin: true
      },
      {
        id: 'test-user-bartleby',
        email: 'bartleby@scrivener.test',
        name: 'Bartleby',
        password: 'prefernot123',
        isAdmin: false
      },
      {
        id: 'test-user-scheherazade',
        email: 'scheherazade@1001nights.test',
        name: 'Scheherazade',
        password: 'story123',
        isAdmin: false
      }
    ];

    for (const userData of testUsers) {
      // Check if user already exists
      if (this.usersByEmail.has(userData.email)) {
        console.log(`   ↳ ${userData.email} already exists, skipping`);
        continue;
      }

      const user: User = {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        createdAt: new Date(),
        apiKeys: []
      };

      const hashedPassword = await bcrypt.hash(userData.password, 10);

      this.users.set(user.id, user);
      this.usersByEmail.set(user.email, user.id);
      this.userConversations.set(user.id, new Set());
      this.passwordHashes.set(user.email, hashedPassword);

      await this.logEvent('user_created', { user, passwordHash: hashedPassword });

      // Grant admin if needed
      if (userData.isAdmin) {
        await this.recordGrantCapability({
          id: uuidv4(),
          time: new Date().toISOString(),
          userId: user.id,
          action: 'granted',
          capability: 'admin',
          grantedByUserId: 'test-user-id-12345' // granted by main test user
        });
      }

      console.log(`   ↳ ${userData.email} (${userData.isAdmin ? 'admin' : 'user'})`);
    }
  }

  private async logEvent(type: string, data: any): Promise<void> {
    const event: Event = {
      timestamp: new Date(),
      type,
      data: JSON.parse(JSON.stringify(data)) // Deep clone to avoid mutations
    };
    
    await this.eventStore.appendEvent(event);
  }

  private async logConversationEvent(conversationId: string, type: string, data: any, actionUserId?: string): Promise<void> {
    // Ensure userId is always included in event data
    const eventData = JSON.parse(JSON.stringify(data)); // Deep clone to avoid mutations
    if (actionUserId && !eventData.userId && !eventData.sentByUserId && !eventData.deletedByUserId && !eventData.editedByUserId) {
      eventData.userId = actionUserId;
    }
    
    const event: Event = {
      timestamp: new Date(),
      type,
      data: eventData
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

  private ensureGrantContainers(userId: string): void {
    if (!this.userGrantInfos.has(userId)) {
      this.userGrantInfos.set(userId, []);
    }
    if (!this.userGrantCapabilities.has(userId)) {
      this.userGrantCapabilities.set(userId, []);
    }
    if (!this.userGrantTotals.has(userId)) {
      this.userGrantTotals.set(userId, new Map());
    }
  }

  // Migration map for legacy currency names
  private static readonly CURRENCY_MIGRATIONS: Record<string, string> = {
    'opus': 'claude3opus',
    'sonnets': 'old_sonnets',
  };

  private migrateCurrencyName(currency: string): string {
    return Database.CURRENCY_MIGRATIONS[currency] || currency;
  }

  private normaliseGrantInfo(grant: GrantInfo): GrantInfo {
    return {
      ...grant,
      time: new Date(grant.time).toISOString(),
      amount: Number(grant.amount),
      currency: this.migrateCurrencyName(grant.currency || 'credit'),
      details: this.normaliseGrantDetails(grant.details)
    };
  }

  private normaliseGrantDetails(details?: GrantUsageDetails): GrantUsageDetails | undefined {
    if (!details) return undefined;

    const normalized: GrantUsageDetails = {};
    for (const [tokenType, usage] of Object.entries(details)) {
      if (!usage) continue;
      normalized[tokenType] = {
        price: Number(usage.price) || 0,
        tokens: Number(usage.tokens) || 0,
        credits: Number(usage.credits) || 0
      };
    }

    return normalized;
  }

  private normaliseGrantCapability(capability: GrantCapability): GrantCapability {
    return {
      ...capability,
      time: new Date(capability.time).toISOString(),
      expiresAt: capability.expiresAt ? new Date(capability.expiresAt).toISOString() : undefined
    };
  }

  private capabilityIsActive(capability: GrantCapability): boolean {
    if (capability.action !== 'granted') return false;
    if (!capability.expiresAt) return true;
    const expiry = new Date(capability.expiresAt).getTime();
    return Number.isNaN(expiry) ? true : expiry >= Date.now();
  }

  async userHasActiveGrantCapability(userId: string, capability: GrantCapability['capability']): Promise<boolean> {
    await this.loadUser(userId);
    this.ensureGrantContainers(userId);

    const capabilities = this.userGrantCapabilities.get(userId)!;
    let latestTime = -Infinity;
    let latestCapability: GrantCapability | null = null;

    for (const record of capabilities) {
      if (record.capability !== capability) continue;
      const recordTime = new Date(record.time).getTime();
      const normalisedTime = Number.isNaN(recordTime) ? 0 : recordTime;
      if (normalisedTime > latestTime) {
        latestTime = normalisedTime;
        latestCapability = record;
      }
    }

    return latestCapability ? this.capabilityIsActive(latestCapability) : false;
  }

  private updateGrantTotals(userId: string, grant: GrantInfo): void {
    const totals = this.userGrantTotals.get(userId)!;
    const currency = grant.currency || 'credit';
    const amount = Number(grant.amount) || 0;
    let delta = 0;

    if (grant.type === 'mint') {
      if (grant.toUserId === userId) {
        delta = amount;
      }
    } else if (grant.type === 'burn') {
      if (grant.fromUserId === userId) {
        delta = -amount;
      }
    } else if (grant.type === 'send') {
      if (grant.fromUserId === userId && grant.toUserId !== userId) {
        delta = -amount;
      } else if (grant.toUserId === userId && grant.fromUserId !== userId) {
        delta = amount;
      }
    } else if (grant.type === 'tally') {
      if (grant.toUserId === userId || grant.fromUserId === userId) {
        delta = amount;
      }
    }

    if (delta === 0) {
      return;
    }

    totals.set(currency, (totals.get(currency) || 0) + delta);
  }

  private applyGrantInfo(userId: string, grant: GrantInfo): void {
    this.ensureGrantContainers(userId);
    const normalized = this.normaliseGrantInfo(grant);
    this.userGrantInfos.get(userId)!.push({ ...normalized });
    this.updateGrantTotals(userId, normalized);
  }

  private applyGrantCapability(userId: string, capability: GrantCapability): void {
    this.ensureGrantContainers(userId);
    const normalized = this.normaliseGrantCapability(capability);
    this.userGrantCapabilities.get(userId)!.push({ ...normalized });
  }

  async getApplicableGrantCurrencies(modelId?: string, userId?: string): Promise<string[]> {
    const nonCredit = new Set<string>();

    if (modelId) {
      const modelLoader = ModelLoader.getInstance();
      const modelConfig = await modelLoader.getModelById(modelId, userId);
      const currencies = modelConfig?.currencies || {};
      for (const [currency, enabled] of Object.entries(currencies)) {
        if (!enabled) continue;
        const trimmed = currency.trim();
        if (!trimmed || trimmed === 'credit') continue;
        nonCredit.add(trimmed);
      }
    }

    const ordered = Array.from(nonCredit).sort((a, b) => a.localeCompare(b));
    ordered.push('credit');
    return ordered;
  }

  async recordGrantInfo(grant: GrantInfo): Promise<void> {
    const normalized = this.normaliseGrantInfo(grant);
    const userIds = new Set<string>();

    if (normalized.type === 'send') {
      if (normalized.fromUserId) userIds.add(normalized.fromUserId);
      if (normalized.toUserId) userIds.add(normalized.toUserId);
    } else {
      if (normalized.fromUserId) userIds.add(normalized.fromUserId);
      if (normalized.toUserId) userIds.add(normalized.toUserId);
    }

    for (const userId of userIds) {
      this.applyGrantInfo(userId, normalized);
      await this.logUserEvent(userId, 'grant_info_recorded', { userId, grant: normalized });
    }
  }

  async recordGrantCapability(capability: GrantCapability): Promise<void> {
    const normalized = this.normaliseGrantCapability(capability);
    this.applyGrantCapability(normalized.userId, normalized);
    await this.logUserEvent(normalized.userId, 'grant_capability_recorded', { userId: normalized.userId, capability: normalized });
  }

  // Invite methods
  async createInvite(code: string, createdBy: string, amount: number, currency: string, expiresAt?: string, maxUses?: number): Promise<Invite> {
    if (this.invites.has(code)) {
      throw new Error('Invite code already exists');
    }

    const invite: Invite = {
      code,
      createdBy,
      createdAt: new Date().toISOString(),
      amount,
      currency,
      expiresAt,
      maxUses,
      useCount: 0
    };

    this.invites.set(code, invite);
    await this.logEvent('invite_created', { invite });

    return invite;
  }

  getInvite(code: string): Invite | null {
    return this.invites.get(code) || null;
  }

  validateInvite(code: string): { valid: boolean; error?: string; invite?: Invite } {
    const invite = this.invites.get(code);

    if (!invite) {
      return { valid: false, error: 'Invalid invite code' };
    }

    // Check if max uses reached (undefined maxUses = unlimited)
    const useCount = invite.useCount ?? 0;
    if (invite.maxUses !== undefined && useCount >= invite.maxUses) {
      return { valid: false, error: 'This invite has reached its maximum uses' };
    }

    // Legacy check for old single-use invites that predate the useCount system
    if (invite.maxUses === undefined && invite.claimedBy && invite.useCount === undefined) {
      return { valid: false, error: 'This invite has already been used' };
    }

    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return { valid: false, error: 'This invite has expired' };
    }

    return { valid: true, invite };
  }

  async claimInvite(code: string, claimedBy: string): Promise<void> {
    const validation = this.validateInvite(code);
    if (!validation.valid || !validation.invite) {
      throw new Error(validation.error || 'Invalid invite');
    }

    const invite = validation.invite;
    const claimedAt = new Date().toISOString();
    
    // Increment use count
    invite.useCount = (invite.useCount ?? 0) + 1;
    // Store last claimer info (for backwards compatibility and tracking)
    invite.claimedBy = claimedBy;
    invite.claimedAt = claimedAt;

    await this.logEvent('invite_claimed', { 
      code, 
      claimedBy, 
      claimedAt,
      useCount: invite.useCount,
      maxUses: invite.maxUses 
    });

    // Mint the credits to the user
    await this.recordGrantInfo({
      id: uuidv4(),
      time: new Date().toISOString(),
      type: 'mint',
      amount: invite.amount,
      toUserId: claimedBy,
      reason: `Invite: ${code}`,
      causeId: code,
      currency: invite.currency
    });
  }

  listInvitesByCreator(userId: string): Invite[] {
    return Array.from(this.invites.values()).filter(invite => invite.createdBy === userId);
  }

  listAllInvites(): Invite[] {
    return Array.from(this.invites.values());
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
          // Legacy users (created before email verification was added) default to verified
          // This prevents breaking existing accounts when the feature was introduced
          const emailVerified = user.emailVerified !== undefined ? user.emailVerified : true;
          const userWithDates = {
            ...user,
            createdAt: new Date(user.createdAt),
            emailVerified,
            emailVerifiedAt: user.emailVerifiedAt ? new Date(user.emailVerifiedAt) : (emailVerified ? new Date(user.createdAt) : undefined)
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
        if ('apiKeyId' in event.data && !('apiKey' in event.data)) {
          console.warn(`Skipping old format api_key_created event for key ${event.data.apiKeyId} - API keys need to be re-added`);
          break;
        }
        
        // Handle new encrypted format
        const { apiKey, userId, masked } = event.data;
        if (!apiKey) {
          console.error('Skipping corrupted api_key_created event - missing apiKey data');
          break;
        }
        
        // Decrypt credentials if they're encrypted
        let credentials = apiKey.credentials;
        if (apiKey.encryptedCredentials) {
          try {
            credentials = encryption.decrypt(apiKey.encryptedCredentials);
          } catch (error) {
            console.error(`Failed to decrypt credentials for API key ${apiKey.id}:`, error);
            break; // Skip this key if decryption fails
          }
        }
        
        const apiKeyWithDates = {
          id: apiKey.id,
          userId: apiKey.userId,
          name: apiKey.name,
          provider: apiKey.provider,
          credentials,
          createdAt: new Date(apiKey.createdAt),
          updatedAt: new Date(apiKey.updatedAt || apiKey.createdAt)
        };
        
        this.apiKeys.set(apiKey.id, apiKeyWithDates as ApiKey);
        
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
      
      case 'api_key_deleted': {
        const { apiKeyId, userId } = event.data;
        this.apiKeys.delete(apiKeyId);
        
        // Also remove from user's apiKeys array
        const user = this.users.get(userId);
        if (user && user.apiKeys) {
          const updatedUser = {
            ...user,
            apiKeys: user.apiKeys.filter((k: any) => k.id !== apiKeyId)
          };
          this.users.set(userId, updatedUser);
        }
        break;
      }
      
      case 'conversation_created': {
        const conversation = {
          ...event.data,
          createdAt: new Date(event.data.createdAt),
          updatedAt: new Date(event.data.updatedAt),
          totalBranchCount: event.data.totalBranchCount ?? 0
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
        // Only add if not already present (prevent duplicates)
        if (!convMessages.includes(message.id)) {
          convMessages.push(message.id);
        }
        this.conversationMessages.set(message.conversationId, convMessages);

        // Update conversation timestamp and totalBranchCount
        const conversation = this.conversations.get(message.conversationId);
        if (conversation) {
          // Count non-system branches being added
          const nonSystemBranchCount = message.branches.filter(
            (b: any) => b.role !== 'system'
          ).length;
          const updated = {
            ...conversation,
            updatedAt: event.timestamp,
            totalBranchCount: (conversation.totalBranchCount || 0) + nonSystemBranchCount
          };
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

          // Update conversation timestamp and totalBranchCount
          const conversation = this.conversations.get(message.conversationId);
          if (conversation) {
            const increment = branch.role !== 'system' ? 1 : 0;
            const updatedConv = {
              ...conversation,
              updatedAt: event.timestamp,
              totalBranchCount: (conversation.totalBranchCount || 0) + increment
            };
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
        const { messageId, branchId, content, contentBlocks } = event.data;
        const message = this.messages.get(messageId);
        if (message) {
          // Create new message object with updated content and contentBlocks
          const updatedBranches = message.branches.map(branch => 
            branch.id === branchId 
              ? { ...branch, content, ...(contentBlocks && Array.isArray(contentBlocks) ? { contentBlocks } : {}) }
              : branch
          );
          const updated = { ...message, branches: updatedBranches };
          this.messages.set(messageId, updated);
        }
        break;
      }

      case 'message_branch_updated': {
        const { messageId, branchId, updates } = event.data;
        const message = this.messages.get(messageId);
        if (message) {
          // DON'T load blob contents - just store blob IDs in memory
          // Debug data will be loaded on-demand from disk when requested
          // Strip any inline debug data that might exist in old events
          const updatesForMemory = { ...updates };
          delete updatesForMemory.debugRequest;
          delete updatesForMemory.debugResponse;
          // Keep blob IDs: debugRequestBlobId, debugResponseBlobId
          
          // Apply partial updates to the specified branch
          const updatedBranches = message.branches.map(branch =>
            branch.id === branchId
              ? { ...branch, ...updatesForMemory }
              : branch
          );
          const updated = { ...message, branches: updatedBranches };
          this.messages.set(messageId, updated);
        }
        break;
      }
      
      case 'message_deleted': {
        const { messageId, conversationId } = event.data;

        // Get message before deleting to count its non-system branches
        const message = this.messages.get(messageId);
        if (message && conversationId) {
          const nonSystemBranchCount = message.branches.filter(
            b => b.role !== 'system'
          ).length;

          // Decrement totalBranchCount
          const conversation = this.conversations.get(conversationId);
          if (conversation && nonSystemBranchCount > 0) {
            const updatedConv = {
              ...conversation,
              totalBranchCount: Math.max(0, (conversation.totalBranchCount || 0) - nonSystemBranchCount)
            };
            this.conversations.set(conversationId, updatedConv);
          }
        }

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
      
      case 'message_order_changed': {
        const { messageId, newOrder } = event.data;
        const message = this.messages.get(messageId);
        if (message) {
          const updated = { ...message, order: newOrder };
          this.messages.set(messageId, updated);
        }
        break;
      }
      
      case 'branch_parent_changed': {
        const { messageId, branchId, newParentBranchId } = event.data;
        const message = this.messages.get(messageId);
        if (message) {
          const updatedBranches = message.branches.map(b => {
            if (b.id === branchId) {
              return { ...b, parentBranchId: newParentBranchId };
            }
            return b;
          });
          const updated = { ...message, branches: updatedBranches };
          this.messages.set(messageId, updated);
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
          // Find the branch being deleted to check its role
          const deletedBranch = message.branches.find(b => b.id === branchId);
          const wasNonSystem = deletedBranch && deletedBranch.role !== 'system';

          const updatedBranches = message.branches.filter(b => b.id !== branchId);
          // Always keep the message - a new branch might be added later
          // If all branches are deleted, keep the message with empty branches
          // and a placeholder activeBranchId that will be fixed when a new branch is added
          const updated = {
            ...message,
            branches: updatedBranches,
            activeBranchId: message.activeBranchId === branchId
              ? (updatedBranches[0]?.id || message.activeBranchId) // Keep old ID as placeholder if no branches left
              : message.activeBranchId
          };
          this.messages.set(messageId, updated);

          // Decrement totalBranchCount if it was a non-system branch
          if (wasNonSystem && conversationId) {
            const conversation = this.conversations.get(conversationId);
            if (conversation && (conversation.totalBranchCount || 0) > 0) {
              const updatedConv = {
                ...conversation,
                totalBranchCount: (conversation.totalBranchCount || 0) - 1
              };
              this.conversations.set(conversationId, updatedConv);
            }
          }
        }
        break;
      }
      
      case 'message_split': {
        // A message was split - the original message's content was truncated
        // and a new message was created with the second part
        const { messageId, branchId, splitPosition, newMessageId, newBranchId } = event.data;
        
        // The original message should already be in memory with truncated content
        // The new message should be created from the event data
        // Note: We don't have the new message data directly in the event,
        // so we rely on the fact that message_created was also logged for the new message
        
        // Just update ordering if needed
        const convMessages = this.conversationMessages.get(event.data.conversationId);
        if (convMessages && newMessageId && !convMessages.includes(newMessageId)) {
          const originalIndex = convMessages.indexOf(messageId);
          if (originalIndex !== -1) {
            convMessages.splice(originalIndex + 1, 0, newMessageId);
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

      case 'grant_info_recorded': {
        const { userId, grant } = event.data || {};
        if (userId && grant) {
          this.applyGrantInfo(userId, grant);
        }
        break;
      }

      case 'grant_capability_recorded': {
        const { userId, capability } = event.data || {};
        if (userId && capability) {
          this.applyGrantCapability(userId, capability);
        }
        break;
      }

      case 'invite_created': {
        const { invite } = event.data || {};
        if (invite && invite.code) {
          this.invites.set(invite.code, invite);
        }
        break;
      }

      case 'invite_claimed': {
        const { code, claimedBy, claimedAt, useCount } = event.data || {};
        const invite = this.invites.get(code);
        if (invite) {
          invite.claimedBy = claimedBy;
          invite.claimedAt = claimedAt;
          // Restore useCount from event (tracks total uses across server restarts)
          if (useCount !== undefined) {
            invite.useCount = useCount;
          } else {
            // Legacy events without useCount - increment manually
            invite.useCount = (invite.useCount ?? 0) + 1;
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
      
      // Collaboration (user-to-user sharing) events
      case 'collaboration_share_created':
      case 'collaboration_share_updated':
      case 'collaboration_share_revoked':
      case 'collaboration_invite_created':
      case 'collaboration_invite_used':
      case 'collaboration_invite_deleted':
        this.collaborationStore.replayEvent(event);
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

      // User model events
      case 'user_model_created': {
        const { model } = event.data;
        const modelWithDates = {
          ...model,
          createdAt: new Date(model.createdAt),
          updatedAt: new Date(model.updatedAt)
        };
        this.userModels.set(model.id, modelWithDates);
        
        const userModelIds = this.userModelsByUser.get(model.userId) || new Set();
        userModelIds.add(model.id);
        this.userModelsByUser.set(model.userId, userModelIds);
        break;
      }

      case 'user_model_updated': {
        const { modelId, updates } = event.data;
        const model = this.userModels.get(modelId);
        if (model) {
          const updatesWithDates = { ...updates };
          if (updates.updatedAt) {
            updatesWithDates.updatedAt = new Date(updates.updatedAt);
          }
          const updated = { ...model, ...updatesWithDates };
          this.userModels.set(modelId, updated);
        }
        break;
      }

      case 'user_model_deleted': {
        const { modelId, userId } = event.data;
        this.userModels.delete(modelId);
        const userModelIds = this.userModelsByUser.get(userId);
        if (userModelIds) {
          userModelIds.delete(modelId);
        }
        break;
      }

      // Email verification events
      case 'email_verified':
      case 'email_verified_manually': {
        const { userId, verifiedAt } = event.data;
        const user = this.users.get(userId);
        if (user) {
          user.emailVerified = true;
          user.emailVerifiedAt = verifiedAt ? new Date(verifiedAt) : new Date(event.timestamp);
          this.users.set(userId, user);
          
          // Clean up any lingering verification tokens for this user
          for (const [token, data] of this.emailVerificationTokens.entries()) {
            if (data.userId === userId) {
              this.emailVerificationTokens.delete(token);
            }
          }
        }
        break;
      }

      // Email verification token events - restore tokens that haven't expired
      case 'email_verification_token_created': {
        const { token, userId, expiresAt } = event.data;
        const expiry = new Date(expiresAt);
        // Only restore if not expired
        if (expiry > new Date()) {
          this.emailVerificationTokens.set(token, { userId, expiresAt: expiry });
        }
        break;
      }
      
      case 'password_reset_token_created': {
        const { token, userId, expiresAt } = event.data;
        const expiry = new Date(expiresAt);
        // Only restore if not expired
        if (expiry > new Date()) {
          this.passwordResetTokens.set(token, { userId, expiresAt: expiry });
        }
        break;
      }
      
      case 'password_reset': {
        // Password was reset - clean up any lingering reset tokens for this user
        const { userId } = event.data;
        for (const [token, data] of this.passwordResetTokens.entries()) {
          if (data.userId === userId) {
            this.passwordResetTokens.delete(token);
          }
        }
        break;
      }

      // Persona events
      case 'persona_created':
      case 'persona_updated':
      case 'persona_archived':
      case 'persona_deleted':
      case 'persona_history_branch_created':
      case 'persona_history_branch_head_changed':
      case 'persona_participation_created':
      case 'persona_participation_ended':
      case 'persona_participation_canonical_set':
      case 'persona_participation_logical_time_updated':
      case 'persona_share_created':
      case 'persona_share_updated':
      case 'persona_share_revoked':
        this.personaStore.replayEvent(event);
        break;

      // Add more cases as needed
      }
    } catch (error) {
      console.error(`Error replaying event ${event.type}:`, error);
      console.error('Event data:', JSON.stringify(event.data, null, 2));
      // Continue processing other events instead of crashing
    }
  }

  // User methods
  async createUser(
    email: string, 
    password: string, 
    name: string, 
    emailVerified: boolean = false,
    ageVerified: boolean = false,
    tosAccepted: boolean = false
  ): Promise<User> {
    if (this.usersByEmail.has(email)) {
      throw new Error('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user: User = {
      id: uuidv4(),
      email,
      name,
      createdAt: new Date(),
      emailVerified,
      emailVerifiedAt: emailVerified ? new Date() : undefined,
      ageVerified,
      ageVerifiedAt: ageVerified ? new Date() : undefined,
      tosAccepted,
      tosAcceptedAt: tosAccepted ? new Date() : undefined,
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
  
  // Age verification methods
  async setAgeVerified(userId: string): Promise<User | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    
    user.ageVerified = true;
    user.ageVerifiedAt = new Date();
    this.users.set(userId, user);
    
    this.logEvent('user_age_verified', { userId, ageVerifiedAt: user.ageVerifiedAt });
    return user;
  }
  
  async isUserAgeVerified(userId: string): Promise<boolean> {
    const user = this.users.get(userId);
    return user?.ageVerified === true;
  }
  
  // ToS acceptance methods
  async setTosAccepted(userId: string): Promise<User | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    
    user.tosAccepted = true;
    user.tosAcceptedAt = new Date();
    this.users.set(userId, user);
    
    this.logEvent('user_tos_accepted', { userId, tosAcceptedAt: user.tosAcceptedAt });
    return user;
  }
  
  // Email verification methods
  async createEmailVerificationToken(userId: string): Promise<string> {
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    this.emailVerificationTokens.set(token, { userId, expiresAt });
    await this.logEvent('email_verification_token_created', { token, userId, expiresAt: expiresAt.toISOString() });
    
    return token;
  }
  
  async verifyEmail(token: string): Promise<User | null> {
    const tokenData = this.emailVerificationTokens.get(token);
    if (!tokenData) {
      return null;
    }
    
    if (new Date() > tokenData.expiresAt) {
      this.emailVerificationTokens.delete(token);
      return null;
    }
    
    const user = this.users.get(tokenData.userId);
    if (!user) {
      return null;
    }
    
    // Update user
    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    this.users.set(user.id, user);
    
    // Delete token
    this.emailVerificationTokens.delete(token);
    
    await this.logEvent('email_verified', { userId: user.id, verifiedAt: user.emailVerifiedAt.toISOString() });
    
    return user;
  }
  
  // Manual email verification (for admin use - migrating legacy users)
  async verifyUserManually(userId: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) {
      return false;
    }
    
    if (user.emailVerified) {
      return true; // Already verified
    }
    
    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    this.users.set(user.id, user);
    
    await this.logEvent('email_verified_manually', { 
      userId: user.id, 
      verifiedAt: user.emailVerifiedAt.toISOString() 
    });
    
    return true;
  }

  // Get all users (for admin operations)
  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }
  
  // Password reset methods  
  async createPasswordResetToken(userId: string): Promise<string> {
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    this.passwordResetTokens.set(token, { userId, expiresAt });
    await this.logEvent('password_reset_token_created', { token, userId, expiresAt: expiresAt.toISOString() });
    
    return token;
  }
  
  async resetPassword(token: string, newPassword: string): Promise<User | null> {
    const tokenData = this.passwordResetTokens.get(token);
    if (!tokenData) {
      return null;
    }
    
    if (new Date() > tokenData.expiresAt) {
      this.passwordResetTokens.delete(token);
      return null;
    }
    
    const user = this.users.get(tokenData.userId);
    if (!user) {
      return null;
    }
    
    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    this.passwordHashes.set(user.email, hashedPassword);
    
    // Delete token
    this.passwordResetTokens.delete(token);
    
    await this.logEvent('password_reset', { userId: user.id });
    
    return user;
  }
  
  getPasswordResetTokenData(token: string): { userId: string; expiresAt: Date } | null {
    const data = this.passwordResetTokens.get(token);
    if (!data) return null;
    if (new Date() > data.expiresAt) {
      this.passwordResetTokens.delete(token);
      return null;
    }
    return data;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const userId = this.usersByEmail.get(email);
    if (!userId) return null;
    await this.loadUser(userId);
    return this.users.get(userId) || null;
  }

  async getUserById(id: string): Promise<User | null> {
    await this.loadUser(id);
    return this.users.get(id) || null;
  }

  // Admin methods for user management
  async getAllUsersWithStats(): Promise<Array<{
    id: string;
    email: string;
    name: string;
    createdAt: Date;
    lastActive?: string;
    conversationCount: number;
    capabilities: string[];
    balances: Record<string, number>;
  }>> {
    const users = Array.from(this.users.values());
    const results = [];

    for (const user of users) {
      await this.loadUser(user.id);
      this.ensureGrantContainers(user.id);

      const conversationIds = this.userConversations.get(user.id) || new Set();
      const capabilities = this.getActiveCapabilities(user.id);
      const totals = this.userGrantTotals.get(user.id) || new Map();
      
      const balances: Record<string, number> = {};
      for (const [currency, amount] of totals.entries()) {
        balances[currency] = Number(amount);
      }

      // Find last activity from conversations
      let lastActive: string | undefined;
      for (const convId of conversationIds) {
        const conv = this.conversations.get(convId);
        if (conv?.updatedAt) {
          const updated = typeof conv.updatedAt === 'string' ? conv.updatedAt : conv.updatedAt.toISOString();
          if (!lastActive || updated > lastActive) {
            lastActive = updated;
          }
        }
      }

      results.push({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        lastActive,
        conversationCount: conversationIds.size,
        capabilities,
        balances
      });
    }

    return results;
  }

  async getUserStats(userId: string): Promise<{
    conversationCount: number;
    messageCount: number;
    lastActive?: string;
  }> {
    await this.loadUser(userId);
    
    const conversationIds = this.userConversations.get(userId) || new Set();
    let messageCount = 0;
    let lastActive: string | undefined;

    for (const convId of conversationIds) {
      const messageIds = this.conversationMessages.get(convId) || [];
      messageCount += messageIds.length;
      
      // Check conversation for last activity
      const conv = this.conversations.get(convId);
      if (conv?.updatedAt) {
        const updated = typeof conv.updatedAt === 'string' ? conv.updatedAt : conv.updatedAt.toISOString();
        if (!lastActive || updated > lastActive) {
          lastActive = updated;
        }
      }
    }

    return {
      conversationCount: conversationIds.size,
      messageCount,
      lastActive
    };
  }

  private getActiveCapabilities(userId: string): string[] {
    const capabilities = this.userGrantCapabilities.get(userId) || [];
    const latest = new Map<string, { action: string; time: string }>();

    for (const cap of capabilities) {
      const existing = latest.get(cap.capability);
      if (!existing || cap.time > existing.time) {
        latest.set(cap.capability, { action: cap.action, time: cap.time });
      }
    }

    const active: string[] = [];
    for (const [capability, { action }] of latest.entries()) {
      if (action === 'granted') {
        active.push(capability);
      }
    }
    return active;
  }

  async invalidateUserCache(userId: string): Promise<void> {
    // Unload the user and force reload from disk
    this.unloadUser(userId);
    await this.loadUser(userId);
  }

  async getSystemStats(): Promise<{
    totalUsers: number;
    totalConversations: number;
    activeUsersLast7Days: number;
  }> {
    const users = Array.from(this.users.values());
    let totalConversations = 0;
    let activeUsersLast7Days = 0;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    for (const user of users) {
      await this.loadUser(user.id);
      const conversationIds = this.userConversations.get(user.id) || new Set();
      totalConversations += conversationIds.size;

      // Check if user was active in last 7 days
      for (const convId of conversationIds) {
        const conv = this.conversations.get(convId);
        if (conv?.updatedAt) {
          const updated = typeof conv.updatedAt === 'string' ? conv.updatedAt : conv.updatedAt.toISOString();
          if (updated > sevenDaysAgo) {
            activeUsersLast7Days++;
            break;
          }
        }
      }
    }

    return {
      totalUsers: users.length,
      totalConversations,
      activeUsersLast7Days
    };
  }

  async getUserUsageStats(userId: string, days: number = 30): Promise<UsageStats> {
    await this.loadUser(userId);
    this.ensureGrantContainers(userId);
    
    // Get credit-based usage from burn records
    const grants = this.userGrantInfos.get(userId) || [];
    const creditUsage = this.aggregateUsageFromGrants(grants, days);
    
    // Get ALL usage from conversation metrics (includes personal API key usage)
    const allUsage = await this.aggregateUsageFromMetrics(userId, days);
    
    return {
      ...creditUsage,
      allUsage
    };
  }

  async getSystemUsageStats(days: number = 30): Promise<UsageStats> {
    // Aggregate across all users
    const allGrants: GrantInfo[] = [];
    
    for (const user of this.users.values()) {
      await this.loadUser(user.id);
      this.ensureGrantContainers(user.id);
      const userGrants = this.userGrantInfos.get(user.id) || [];
      allGrants.push(...userGrants);
    }
    
    return this.aggregateUsageFromGrants(allGrants, days);
  }

  async getModelUsageStats(modelId: string, days: number = 30): Promise<UsageStats> {
    // Aggregate across all users, filtering by model
    const allGrants: GrantInfo[] = [];
    
    for (const user of this.users.values()) {
      await this.loadUser(user.id);
      this.ensureGrantContainers(user.id);
      const userGrants = this.userGrantInfos.get(user.id) || [];
      // Filter for grants that mention this model in the reason
      const modelGrants = userGrants.filter(g => 
        g.type === 'burn' && g.reason?.includes(modelId)
      );
      allGrants.push(...modelGrants);
    }
    
    return this.aggregateUsageFromGrants(allGrants, days, false); // Don't filter by model again
  }

  private aggregateUsageFromGrants(grants: GrantInfo[], days: number, filterByBurn: boolean = true): UsageStats {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoffDate.toISOString();
    
    // Filter to burn grants within the time range
    const burnGrants = grants.filter(g => 
      (!filterByBurn || g.type === 'burn') && 
      g.time >= cutoffStr &&
      g.details
    );
    
    // Group by date
    const dailyMap = new Map<string, UsageDataPoint>();
    const modelMap = new Map<string, { inputTokens: number; outputTokens: number; cachedTokens: number; cost: number; requests: number }>();
    
    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      cost: 0,
      requests: 0
    };
    
    for (const grant of burnGrants) {
      const date = grant.time.split('T')[0]; // YYYY-MM-DD
      const details = grant.details!;
      
      const inputTokens = details.input?.tokens || 0;
      const outputTokens = details.output?.tokens || 0;
      const cachedTokens = details.cached_input?.tokens || 0;
      const cost = grant.amount;
      
      // Update daily
      if (!dailyMap.has(date)) {
        dailyMap.set(date, {
          date,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
          cost: 0,
          requests: 0
        });
      }
      const dayData = dailyMap.get(date)!;
      dayData.inputTokens += inputTokens;
      dayData.outputTokens += outputTokens;
      dayData.cachedTokens += cachedTokens;
      dayData.totalTokens += inputTokens + outputTokens;
      dayData.cost += cost;
      dayData.requests += 1;
      
      // Update totals
      totals.inputTokens += inputTokens;
      totals.outputTokens += outputTokens;
      totals.cachedTokens += cachedTokens;
      totals.totalTokens += inputTokens + outputTokens;
      totals.cost += cost;
      totals.requests += 1;
      
      // Extract model from reason (e.g., "Model usage (claude-3-opus)")
      const modelMatch = grant.reason?.match(/\(([^)]+)\)/);
      const model = modelMatch ? modelMatch[1] : 'unknown';
      
      if (!modelMap.has(model)) {
        modelMap.set(model, { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0, requests: 0 });
      }
      const modelData = modelMap.get(model)!;
      modelData.inputTokens += inputTokens;
      modelData.outputTokens += outputTokens;
      modelData.cachedTokens += cachedTokens;
      modelData.cost += cost;
      modelData.requests += 1;
    }
    
    // Sort daily data by date
    const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    
    // Convert model map to object
    const byModel: Record<string, { inputTokens: number; outputTokens: number; cachedTokens: number; cost: number; requests: number }> = {};
    for (const [model, data] of modelMap.entries()) {
      byModel[model] = data;
    }
    
    return { daily, totals, byModel };
  }

  private async aggregateUsageFromMetrics(userId: string, days: number): Promise<{
    daily: UsageDataPoint[];
    totals: UsageTotals;
    byModel: Record<string, { inputTokens: number; outputTokens: number; cachedTokens: number; cost: number; requests: number }>;
  }> {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoffDate.toISOString();
    
    // Group by date
    const dailyMap = new Map<string, UsageDataPoint>();
    const modelMap = new Map<string, { inputTokens: number; outputTokens: number; cachedTokens: number; cost: number; requests: number }>();
    
    const totals: UsageTotals = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      cost: 0,
      requests: 0
    };
    
    // Get all user's conversations and their metrics
    const conversationIds = this.userConversations.get(userId) || new Set();
    
    for (const convId of conversationIds) {
      // Make sure conversation is loaded
      await this.loadConversation(convId, userId);
      
      const metrics = this.conversationMetrics.get(convId) || [];
      
      for (const m of metrics) {
        // Filter by date
        if (m.timestamp < cutoffStr) continue;
        
        const date = m.timestamp.split('T')[0];
        const inputTokens = m.inputTokens || 0;
        const outputTokens = m.outputTokens || 0;
        const cachedTokens = m.cachedTokens || 0;
        const cost = m.cost || 0;
        
        // Update daily
        if (!dailyMap.has(date)) {
          dailyMap.set(date, {
            date,
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            totalTokens: 0,
            cost: 0,
            requests: 0
          });
        }
        const dayData = dailyMap.get(date)!;
        dayData.inputTokens += inputTokens;
        dayData.outputTokens += outputTokens;
        dayData.cachedTokens += cachedTokens;
        dayData.totalTokens += inputTokens + outputTokens;
        dayData.cost += cost;
        dayData.requests += 1;
        
        // Update totals
        totals.inputTokens += inputTokens;
        totals.outputTokens += outputTokens;
        totals.cachedTokens += cachedTokens;
        totals.totalTokens += inputTokens + outputTokens;
        totals.cost += cost;
        totals.requests += 1;
        
        // Update by model
        const model = m.model || 'unknown';
        if (!modelMap.has(model)) {
          modelMap.set(model, { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0, requests: 0 });
        }
        const modelData = modelMap.get(model)!;
        modelData.inputTokens += inputTokens;
        modelData.outputTokens += outputTokens;
        modelData.cachedTokens += cachedTokens;
        modelData.cost += cost;
        modelData.requests += 1;
      }
    }
    
    // Sort daily data by date
    const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    
    // Convert model map to object
    const byModel: Record<string, { inputTokens: number; outputTokens: number; cachedTokens: number; cost: number; requests: number }> = {};
    for (const [model, data] of modelMap.entries()) {
      byModel[model] = data;
    }
    
    return { daily, totals, byModel };
  }

  async getUserGrantSummary(userId: string): Promise<UserGrantSummary> {
    await this.loadUser(userId);
    this.ensureGrantContainers(userId);

    const totals = this.userGrantTotals.get(userId)!;
    const totalsRecord: Record<string, number> = {};
    for (const [currency, amount] of totals.entries()) {
      totalsRecord[currency] = Number(amount);
    }

    const infos = (this.userGrantInfos.get(userId) || []).map(grant => ({ ...grant }));
    const capabilities = (this.userGrantCapabilities.get(userId) || []).map(capability => ({ ...capability }));

    return {
      totals: totalsRecord,
      grantInfos: infos,
      grantCapabilities: capabilities
    };
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
    
    // Create masked version for display
    let masked = '****';
    if ('apiKey' in apiKey.credentials) {
      masked = '****' + (apiKey.credentials.apiKey as string).slice(-4);
    } else if ('accessKeyId' in apiKey.credentials) {
      masked = '****' + (apiKey.credentials.accessKeyId as string).slice(-4);
    }
    
    const user = await this.getUserById(userId);
    if (user) {
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

    // Encrypt credentials before storing in event log
    const encryptedCredentials = encryption.encrypt(apiKey.credentials);

    await this.logEvent('api_key_created', { 
      apiKey: {
        id: apiKey.id,
        userId: apiKey.userId,
        name: apiKey.name,
        provider: apiKey.provider,
        encryptedCredentials, // Store encrypted, not plain credentials
        createdAt: apiKey.createdAt,
        updatedAt: apiKey.updatedAt
      },
      userId,
      masked
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
    const apiKey = this.apiKeys.get(keyId);
    if (!apiKey) {
      return false;
    }
    
    // Log deletion event for persistence
    await this.logEvent('api_key_deleted', { 
      apiKeyId: keyId,
      userId: apiKey.userId 
    });
    
    return this.apiKeys.delete(keyId);
  }

  // Conversation methods
  async createConversation(userId: string, title: string, model: string, systemPrompt?: string, settings?: any, format?: 'standard' | 'prefill', contextManagement?: any): Promise<Conversation> {
    // If no settings provided, try to get validated defaults from model config
    let resolvedSettings = settings;
    if (!resolvedSettings) {
      const modelLoader = ModelLoader.getInstance();
      const modelConfig = await modelLoader.getModelById(model, userId);
      if (modelConfig) {
        resolvedSettings = getValidatedModelDefaults(modelConfig);
      } else {
        // Fallback for unknown models - log warning as this might indicate a problem
        console.warn(`⚠️ MODEL WARNING: Model "${model}" not found in config. Using generic defaults (temperature: 1.0, maxTokens: 4096). This may cause issues with pricing or model-specific features.`);
        resolvedSettings = { temperature: 1.0, maxTokens: 4096 };
      }
    }
    
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
      settings: resolvedSettings,
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
    
    // Get user's first name for the user participant
    const user = await this.getUserById(userId);
    const userFirstName = user?.name?.split(' ')[0] || 'User';
    
    // Create default participants
    // For standard format, use generic "A" since user might switch models during conversation
    // For prefill (group chat), use the model's actual name
    if (format === 'standard' || !format) {
      // Pass userId for user-type participant so we can identify who "owns" it in collaborative chats
      await this.createParticipant(conversation.id, userId, userFirstName, 'user', undefined, undefined, undefined, undefined, userId);
      await this.createParticipant(conversation.id, userId, 'A', 'assistant', model, systemPrompt, settings);
    } else {
      // Group chat format - use proper model name
      const modelLoader = ModelLoader.getInstance();
      const modelConfig = await modelLoader.getModelById(model);
      const assistantName = modelConfig?.shortName || modelConfig?.displayName || 'Assistant';
      
      // Pass userId for user-type participant so we can identify who "owns" it in collaborative chats
      await this.createParticipant(conversation.id, userId, userFirstName, 'user', undefined, undefined, undefined, undefined, userId);
      await this.createParticipant(conversation.id, userId, assistantName, 'assistant', model, systemPrompt, settings);
    }

    return conversation;
  }

  private async tryLoadAndVerifyConversation(conversationId: string, requestingUserId: string) : Promise<Conversation | null> {
    // First, try to load the requesting user's data
    await this.loadUser(requestingUserId);
    
    // Check if user owns the conversation
    let conversation = this.conversations.get(conversationId);
    if (conversation && conversation.userId === requestingUserId) {
      return conversation;
    }
    
    // If not owned, check if user has collaboration access
    const permission = this.collaborationStore.getUserPermission(conversationId, requestingUserId);
    if (permission) {
      // User has shared access - load the conversation owner's data to get the conversation
      // We need to find who owns this conversation
      if (!conversation) {
        // Conversation not loaded yet - we need to find the owner
        // This is a bit tricky since we need to load the owner's data
        // For now, iterate through shares to find owner
        const shares = this.collaborationStore.getSharesForUser(requestingUserId);
        const share = shares.find(s => s.conversationId === conversationId);
        if (share) {
          // Load the owner's data
          const ownerConversation = this.conversations.get(conversationId);
          if (!ownerConversation) {
            // Try to load via scanning all loaded users' conversations
            // This is a limitation - we'll need to load the actual owner
            // For now, scan loaded conversations
            for (const [userId, convIds] of this.userConversations.entries()) {
              if (convIds.has(conversationId)) {
                await this.loadUser(userId);
                break;
              }
            }
          }
          conversation = this.conversations.get(conversationId);
        }
      }
      
      if (conversation) {
        console.log(`[Database] User ${requestingUserId} accessing shared conversation ${conversationId} with permission: ${permission}`);
    return conversation;
      }
    }
    
    // No access
    if (conversation) {
      console.warn(`Conversation access denied for ${conversationId}: User ${requestingUserId} is not owner and has no share`);
    }
    return null;
  }

  async getConversation(conversationId: string, conversationOwnerUserId: string): Promise<Conversation | null> {
    return await this.tryLoadAndVerifyConversation(conversationId, conversationOwnerUserId);
  }

  // Internal method: Get conversation by ID (no access control, for internal use only)
  getConversationById(conversationId: string): Conversation | null {
    return this.conversations.get(conversationId) || null;
  }

  async getUserConversations(userId: string): Promise<Conversation[]> {
    await this.loadUser(userId); // load user if not already loaded
    const convIds = this.userConversations.get(userId) || new Set();
    return Array.from(convIds)
      .map(id => this.conversations.get(id))
      .filter((conv): conv is Conversation => conv !== undefined && !conv.archived)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async getUserConversationsWithSummary(userId: string): Promise<any[]> {
    await this.loadUser(userId); // load user if not already loaded
    const convIds = this.userConversations.get(userId) || new Set();
    
    const conversations = Array.from(convIds)
      .map(id => this.conversations.get(id))
      .filter((conv): conv is Conversation => conv !== undefined && !conv.archived)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    
    // Add participant model summaries for group chat conversations
    return conversations.map(conv => {
      const result: any = { ...conv };
      
      if (conv.format === 'prefill') {
        const participantIds = this.conversationParticipants.get(conv.id) || [];
        const participantModels = participantIds
          .map(pId => this.participants.get(pId))
          .filter(p => p && p.type === 'assistant' && p.isActive)
          .map(p => p!.model)
          .filter(Boolean);
        
        result.participantModels = participantModels;
      }
      
      return result;
    });
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
    // IMPORTANT: Only do this for standard format! Group chats manage participants separately
    if (updates.model && updated.format === 'standard') {
      console.log('[Database] Updating participant model to match conversation (standard format only)');
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

  async duplicateConversation(
    conversationId: string, 
    originalOwnerUserId: string, 
    duplicateOwnerUserId: string,
    options?: {
      newTitle?: string;
      lastMessages?: number;
      includeSystemPrompt?: boolean;
      includeSettings?: boolean;
    }
  ): Promise<Conversation | null> {
    const original = await this.tryLoadAndVerifyConversation(conversationId, originalOwnerUserId);
    if (!original) return null;
    await this.loadUser(duplicateOwnerUserId);

    // Determine what to include based on options
    const includeSystemPrompt = options?.includeSystemPrompt !== false; // Default true
    const includeSettings = options?.includeSettings !== false; // Default true

    // This will log the relevant user events for conversation metadata
    const duplicate = await this.createConversation(
      duplicateOwnerUserId,
      options?.newTitle || `${original.title} (Copy)`,
      original.model,
      includeSystemPrompt ? original.systemPrompt : undefined,
      includeSettings ? original.settings : undefined,
      original.format,
      includeSettings && original.contextManagement ? JSON.parse(JSON.stringify(original.contextManagement)) : undefined
    );
    
    // carry over prefill user message if including system prompt
    if (includeSystemPrompt && original.prefillUserMessage) {
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
        includeSystemPrompt ? participant.systemPrompt : undefined,
        includeSettings && participant.settings ? JSON.parse(JSON.stringify(participant.settings)) : undefined,
        includeSettings && participant.contextManagement ? JSON.parse(JSON.stringify(participant.contextManagement)) : undefined
      );
      // We need to mirror this flag as well, by default they are active
      if (!participant.isActive) {
        await this.updateParticipant(cloned.id, duplicateOwnerUserId, { isActive: false});
      }
      participantIdMap.set(participant.id, cloned.id);
    }

    // Copy messages
    let messages = await this.getConversationMessages(conversationId, originalOwnerUserId);
    
    // If lastMessages is specified, we need to find the active path and trim
    if (options?.lastMessages && options.lastMessages > 0) {
      // Build maps for navigation
      const branchToMessage = new Map<string, Message>();
      const parentBranchToChildMessage = new Map<string, Message>();
      
      // Build navigation maps
      for (const msg of messages) {
        for (const branch of msg.branches) {
          branchToMessage.set(branch.id, msg);
          if (branch.parentBranchId) {
            // Map parent branch -> child message that references it
            parentBranchToChildMessage.set(branch.parentBranchId, msg);
          }
        }
      }
      
      // Find the root message (first message, or message with no parentBranchId on active branch)
      const rootMessage = messages.find(msg => {
        const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
        return activeBranch && !activeBranch.parentBranchId;
      });
      
      if (!rootMessage) {
        console.log(`[Duplicate] Could not find root message, skipping trim`);
      } else {
        // Walk FORWARD from root to find the leaf of the active path
        const activePath: Message[] = [];
        let currentMessage: Message | undefined = rootMessage;
        
        while (currentMessage) {
          activePath.push(currentMessage);
          
          // Find the next message whose active branch's parent is the current message's active branch
          const currentActiveBranchId = currentMessage.activeBranchId;
          const nextMessage = parentBranchToChildMessage.get(currentActiveBranchId);
          
          if (!nextMessage) {
            break; // No child, we've reached the leaf
          }
          
          // Verify the next message's active branch actually points to our current active branch
          const nextActiveBranch = nextMessage.branches.find(b => b.id === nextMessage.activeBranchId);
          if (!nextActiveBranch || nextActiveBranch.parentBranchId !== currentActiveBranchId) {
            // The child's ACTIVE branch doesn't point to us - this means the active path ends here
            // But there might be another message that does - check all messages
            let foundNext = false;
            for (const msg of messages) {
              if (activePath.includes(msg)) continue;
              const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
              if (activeBranch && activeBranch.parentBranchId === currentActiveBranchId) {
                currentMessage = msg;
                foundNext = true;
                break;
              }
            }
            if (!foundNext) {
              break;
            }
          } else {
            currentMessage = nextMessage;
          }
        }
        
        console.log(`[Duplicate] Found active path with ${activePath.length} messages`);
        
        // Now trim to the last N messages from the active path
        if (activePath.length > options.lastMessages) {
          messages = activePath.slice(-options.lastMessages);
          console.log(`[Duplicate] Trimmed from ${activePath.length} to ${messages.length} messages`);
        } else {
          messages = activePath;
          console.log(`[Duplicate] Active path (${activePath.length}) <= requested (${options.lastMessages}), using full active path`);
        }
      }
    }
    
    const oldMessageBranchIdToNewMessageBranchId : Map<string, string> = new Map();
    var newMessages : Array<Message> = [];
    const isTrimmed = options?.lastMessages && options.lastMessages > 0;
    
    for (const message of messages) {
      const newMessage: Message = {
        ...message,
        id: uuidv4(),
        conversationId: duplicate.id
      };
      
      // When trimming, only keep the active branch to create a clean linear chain
      // Otherwise keep all branches for full duplication
      const branchesToCopy = isTrimmed 
        ? message.branches.filter(b => b.id === message.activeBranchId)
        : message.branches;
      
      // remap branches to new ids
      newMessage.branches = branchesToCopy.map((branch) => {
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
    // For trimmed conversations, clear parent branch id if parent wasn't copied
    newMessages = newMessages.map(message => ({
      ...message,
      branches: message.branches.map(branch => ({
        ...branch,
        parentBranchId: branch.parentBranchId 
          ? (oldMessageBranchIdToNewMessageBranchId.get(branch.parentBranchId) || undefined)
          : undefined
      }))
    }));

    this.conversationMessages.set(duplicate.id, newMessages.map(message => message.id));

    for (const newMessage of newMessages) {
      this.messages.set(newMessage.id, newMessage);
      // log full message creation events so they can be recreated
      await this.logConversationEvent(duplicate.id, 'message_created', newMessage);
    }
    
    // Align active branch path to ensure consistent visibility
    // This is crucial for conversations with multiple roots (e.g., from looming/branching)
    await this.alignActiveBranchPath(duplicate.id, duplicateOwnerUserId);
    
    return duplicate;
  }

  /**
   * Align activeBranchId values to form a consistent path from one root to one leaf.
   * This is needed after duplicate or import to ensure getVisibleMessages works correctly,
   * especially for conversations with multiple roots (from looming/parallel exploration).
   */
  async alignActiveBranchPath(conversationId: string, userId: string): Promise<void> {
    const messages = await this.getConversationMessages(conversationId, userId);
    if (messages.length === 0) return;
    
    // Build lookup maps
    const branchToMessage = new Map<string, Message>();
    const parentToChildren = new Map<string, Message[]>(); // parentBranchId -> child messages
    
    for (const msg of messages) {
      for (const branch of msg.branches) {
        branchToMessage.set(branch.id, msg);
        const parentId = branch.parentBranchId || 'root';
        if (!parentToChildren.has(parentId)) {
          parentToChildren.set(parentId, []);
        }
        parentToChildren.get(parentId)!.push(msg);
      }
    }
    
    // Find all root messages (branches with no parent or parent='root')
    const rootMessages = messages.filter(msg => {
      const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
      return activeBranch && (!activeBranch.parentBranchId || activeBranch.parentBranchId === 'root');
    });
    
    console.log(`[AlignActivePath] Found ${rootMessages.length} root messages`);
    
    if (rootMessages.length === 0) {
      console.warn(`[AlignActivePath] No root messages found, cannot align`);
      return;
    }
    
    // Pick the canonical root: the one whose subtree contains the most recent message
    // (by createdAt of the deepest leaf)
    let canonicalRoot: Message | undefined;
    let latestLeafTime = 0;
    
    for (const root of rootMessages) {
      // Find the deepest/latest leaf in this root's subtree
      const leafTime = this.findLatestLeafTime(root, parentToChildren, branchToMessage);
      if (leafTime > latestLeafTime) {
        latestLeafTime = leafTime;
        canonicalRoot = root;
      }
    }
    
    if (!canonicalRoot) {
      canonicalRoot = rootMessages[0]; // Fallback to first
    }
    
    console.log(`[AlignActivePath] Canonical root: ${canonicalRoot.id.slice(0, 8)}`);
    
    // Now propagate from the canonical root forward, ensuring activeBranchIds align
    const activePath: string[] = []; // Branch IDs on the active path
    const canonicalBranch = canonicalRoot.branches.find(b => b.id === canonicalRoot!.activeBranchId);
    if (canonicalBranch) {
      activePath.push(canonicalBranch.id);
    }
    
    // Walk forward through messages, updating activeBranchId to continue from our path
    const sortedMessages = this.sortMessagesByTreeOrder(messages);
    
    for (const msg of sortedMessages) {
      if (msg.id === canonicalRoot.id) continue; // Skip the root we already handled
      
      // Find a branch that continues from our active path
      const continuingBranch = msg.branches.find(branch => 
        branch.parentBranchId && activePath.includes(branch.parentBranchId)
      );
      
      if (continuingBranch) {
        // This message is on the active path
        if (msg.activeBranchId !== continuingBranch.id) {
          console.log(`[AlignActivePath] Updating message ${msg.id.slice(0, 8)} activeBranchId: ${msg.activeBranchId.slice(0, 8)} -> ${continuingBranch.id.slice(0, 8)}`);
          msg.activeBranchId = continuingBranch.id;
          this.messages.set(msg.id, msg);
        }
        
        // Extend the path
        const parentIndex = activePath.indexOf(continuingBranch.parentBranchId!);
        activePath.length = parentIndex + 1;
        activePath.push(continuingBranch.id);
      }
      // Messages not on the active path keep their activeBranchId as-is
    }
    
    console.log(`[AlignActivePath] Done, active path has ${activePath.length} branches`);
  }
  
  /**
   * Find the timestamp of the latest leaf in a subtree rooted at the given message
   */
  private findLatestLeafTime(
    root: Message, 
    parentToChildren: Map<string, Message[]>,
    branchToMessage: Map<string, Message>
  ): number {
    let latestTime = 0;
    const visited = new Set<string>();
    
    const visit = (msg: Message) => {
      if (visited.has(msg.id)) return;
      visited.add(msg.id);
      
      const activeBranch = msg.branches.find(b => b.id === msg.activeBranchId);
      if (activeBranch?.createdAt) {
        const time = new Date(activeBranch.createdAt).getTime();
        if (time > latestTime) latestTime = time;
      }
      
      // Visit children
      for (const branch of msg.branches) {
        const children = parentToChildren.get(branch.id) || [];
        for (const child of children) {
          visit(child);
        }
      }
    };
    
    visit(root);
    return latestTime;
  }

  // Message methods
  async createMessage(conversationId: string, conversationOwnerUserId: string, content: string, role: 'user' | 'assistant' | 'system', model?: string, explicitParentBranchId?: string, participantId?: string, attachments?: any[], sentByUserId?: string, hiddenFromAi?: boolean, creationSource?: 'inference' | 'human_edit' | 'regeneration' | 'split' | 'import' | 'fork'): Promise<Message> {
    const conversation = await this.tryLoadAndVerifyConversation(conversationId, conversationOwnerUserId);
    if (!conversation) throw new Error("Conversation not found");
    // Get conversation messages to determine parent
    const existingMessages = await this.getConversationMessages(conversationId, conversationOwnerUserId);
    
    // Only log in debug mode
    if (process.env.LOG_DEBUG === 'true') {
      console.log(`createMessage called with explicitParentBranchId: ${explicitParentBranchId} (type: ${typeof explicitParentBranchId})`);
    }
    
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
        sentByUserId, // Actual user who sent this message (for multi-user attribution)
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
          encoding: (att as any).encoding || 'base64' as const,
          mimeType: (att as any).mimeType,
          createdAt: new Date()
        })) : undefined,
        hiddenFromAi, // If true, message is visible to humans but excluded from AI context
        creationSource // How this branch was created (inference, human_edit, regeneration, split, import)
      }],
      activeBranchId: '',
      order: 0
    };
    
    message.activeBranchId = message.branches[0].id;
    
    // Only log in debug mode
    if (process.env.LOG_DEBUG === 'true') {
      console.log(`Created message with branch parentBranchId: ${message.branches[0].parentBranchId}`);
      if (message.branches[0].attachments) {
        console.log(`Message has ${message.branches[0].attachments.length} attachments`);
      }
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
    
    // Only log in debug mode
    if (process.env.LOG_DEBUG === 'true') {
      console.log(`Stored message ${message.id} for conversation ${conversationId}. Total messages: ${convMessages.length}`);
    }
    
    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    await this.logConversationEvent(conversationId, 'message_created', message);

    // Update cached branch count in state file (for unread tracking without loading full conversation)
    if (role !== 'system') {
      await this.uiStateStore.incrementBranchCount(conversationId, 1);
    }

    return message;
  }

  /**
   * Create a post-hoc operation message.
   * Post-hoc operations are special messages that modify how previous messages
   * appear in context without actually changing them.
   */
  async createPostHocOperation(
    conversationId: string,
    conversationOwnerUserId: string,
    content: string,
    operation: {
      type: 'hide' | 'hide_before' | 'edit' | 'hide_attachment' | 'unhide';
      targetMessageId: string;
      targetBranchId: string;
      replacementContent?: any[];
      attachmentIndices?: number[];
      reason?: string;
      parentBranchId?: string; // Parent branch passed from frontend for correct tree integration
    }
  ): Promise<Message> {
    const conversation = await this.tryLoadAndVerifyConversation(conversationId, conversationOwnerUserId);
    if (!conversation) throw new Error("Conversation not found");
    
    // Use provided parentBranchId if available, otherwise find from existing messages
    let parentBranchId = operation.parentBranchId;
    
    if (!parentBranchId) {
      // Fallback: Get existing messages to determine parent branch
      const existingMessages = await this.getConversationMessages(conversationId, conversationOwnerUserId);
      if (existingMessages.length > 0) {
        const lastMessage = existingMessages[existingMessages.length - 1];
        parentBranchId = lastMessage.activeBranchId;
      }
    }
    
    const message: Message = {
      id: uuidv4(),
      conversationId,
      branches: [{
        id: uuidv4(),
        content,
        role: 'system' as const, // Operations are system-level
        createdAt: new Date(),
        parentBranchId,
        postHocOperation: operation
      }],
      activeBranchId: '',
      order: 0
    };
    
    message.activeBranchId = message.branches[0].id;
    
    // Get current message count for ordering
    let convMessages = this.conversationMessages.get(conversationId);
    if (!convMessages) {
      convMessages = [];
      this.conversationMessages.set(conversationId, convMessages);
    }
    message.order = convMessages.length;
    
    this.messages.set(message.id, message);
    convMessages.push(message.id);
    
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

  async addMessageBranch(messageId: string, conversationId: string, conversationOwnerUserId: string, content: string, role: 'user' | 'assistant' | 'system', parentBranchId?: string, model?: string, participantId?: string, attachments?: any[], sentByUserId?: string, hiddenFromAi?: boolean, preserveActiveBranch?: boolean, creationSource?: 'inference' | 'human_edit' | 'regeneration' | 'split' | 'import' | 'fork'): Promise<Message | null> {
    const message = await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
    if (!message) return null;
    
    const newBranch = {
      id: uuidv4(),
      content,
      role,
      participantId,
      sentByUserId, // Actual user who sent this message
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
        encoding: (att as any).encoding || 'base64' as const,
        mimeType: (att as any).mimeType,
        createdAt: new Date()
      })) : undefined,
      hiddenFromAi, // If true, message is excluded from AI context
      creationSource // How this branch was created
    };

    // Create new message object with added branch
    // If preserveActiveBranch is true, don't change the active branch (used for parallel generation)
    const updatedMessage = {
      ...message,
      branches: [...message.branches, newBranch],
      activeBranchId: preserveActiveBranch ? message.activeBranchId : newBranch.id
    };
    
    this.messages.set(messageId, updatedMessage);

    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    await this.logConversationEvent(conversationId, 'message_branch_added', {
      messageId,
      branch: newBranch,
      userId: sentByUserId || conversationOwnerUserId
    });

    // Update cached branch count in state file (for unread tracking without loading full conversation)
    if (role !== 'system') {
      await this.uiStateStore.incrementBranchCount(conversationId, 1);
    }

    return updatedMessage;
  }

  async setActiveBranch(messageId: string, conversationId: string, conversationOwnerUserId: string, branchId: string, changedByUserId?: string): Promise<boolean> {
    const message = await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
    if (!message) return false;
    
    const branch = message.branches.find(b => b.id === branchId);
    if (!branch) return false;

    // Create new message object with updated active branch
    const updated = { ...message, activeBranchId: branchId };
    this.messages.set(messageId, updated);

    // Save to shared UI state store (NOT the append-only event log)
    // This prevents branch navigation from bloating the conversation history
    await this.uiStateStore.setSharedActiveBranch(conversationId, messageId, branchId);

    // Don't update conversation timestamp for branch switches - it's just navigation
    // await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    
    // NOTE: We intentionally do NOT log active_branch_changed events anymore.
    // Branch selections are stored in a separate mutable store to avoid event log bloat.

    return true;
  }

  // ==================== USER-SPECIFIC UI STATE ====================
  // These are per-user settings that are NEVER synced to other users

  async getUserConversationState(conversationId: string, userId: string) {
    return this.uiStateStore.loadUser(conversationId, userId);
  }

  async setUserSpeakingAs(conversationId: string, userId: string, participantId: string | undefined): Promise<void> {
    await this.uiStateStore.setSpeakingAs(conversationId, userId, participantId);
  }

  async setUserSelectedResponder(conversationId: string, userId: string, participantId: string | undefined): Promise<void> {
    await this.uiStateStore.setSelectedResponder(conversationId, userId, participantId);
  }

  async setUserDetached(conversationId: string, userId: string, isDetached: boolean): Promise<void> {
    await this.uiStateStore.setDetached(conversationId, userId, isDetached);
  }

  async setUserDetachedBranch(conversationId: string, userId: string, messageId: string, branchId: string): Promise<void> {
    await this.uiStateStore.setDetachedBranch(conversationId, userId, messageId, branchId);
  }

  async markBranchesAsRead(conversationId: string, userId: string, branchIds: string[]): Promise<void> {
    await this.uiStateStore.markBranchesAsRead(conversationId, userId, branchIds);
  }

  async getReadBranchIds(conversationId: string, userId: string): Promise<string[]> {
    return this.uiStateStore.getReadBranchIds(conversationId, userId);
  }

  // Get cached total branch count from state file (for unread tracking without loading full conversation)
  async getTotalBranchCount(conversationId: string): Promise<number> {
    return this.uiStateStore.getTotalBranchCount(conversationId);
  }

  // Backfill branch count to state file (for migration of existing conversations)
  async backfillBranchCount(conversationId: string, count: number): Promise<void> {
    const state = await this.uiStateStore.loadShared(conversationId);
    state.totalBranchCount = count;
    await this.uiStateStore.saveShared(conversationId, state);
  }

  async updateMessage(messageId: string, conversationId: string, conversationOwnerUserId: string, message: Message, updatedByUserId?: string): Promise<boolean> {
    const oldMessage = await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
    if (!oldMessage) return false;
    
    this.messages.set(messageId, message);
    
    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    await this.logConversationEvent(conversationId, 'message_updated', { 
      messageId, 
      message,
      userId: updatedByUserId || conversationOwnerUserId
    });
    
    return true;
  }
  
  async deleteMessage(messageId: string, conversationId: string, conversationOwnerUserId: string, deletedByUserId?: string): Promise<boolean> {
    const message = await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
    if (!message) return false;

    // Count non-system branches before deletion (for updating cached count)
    const nonSystemBranchCount = message.branches.filter(b => b.role !== 'system').length;

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
    await this.logConversationEvent(conversationId, 'message_deleted', {
      messageId,
      conversationId,
      deletedByUserId: deletedByUserId || conversationOwnerUserId
    });

    // Update cached branch count in state file
    if (nonSystemBranchCount > 0) {
      await this.uiStateStore.decrementBranchCount(conversationId, nonSystemBranchCount);
    }

    return true;
  }
  
  async restoreMessage(conversationId: string, conversationOwnerUserId: string, messageData: any, restoredByUserId?: string): Promise<any> {
    await this.loadUser(conversationOwnerUserId);
    await this.loadConversation(conversationId, conversationOwnerUserId);
    
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    
    // Ensure dates are proper Date objects
    const message = {
      ...messageData,
      createdAt: new Date(messageData.createdAt || Date.now()),
      updatedAt: new Date(),
      branches: messageData.branches.map((b: any) => ({
        ...b,
        createdAt: new Date(b.createdAt || Date.now())
      }))
    };
    
    // Add to messages map
    this.messages.set(message.id, message);
    
    // Add to conversation's message list in the correct order
    let convMessages = this.conversationMessages.get(conversationId);
    if (!convMessages) {
      convMessages = [];
      this.conversationMessages.set(conversationId, convMessages);
    }
    
    // Insert at the correct position based on order
    const insertIndex = convMessages.findIndex((id) => {
      const m = this.messages.get(id);
      return m && m.order > message.order;
    });
    
    if (insertIndex === -1) {
      convMessages.push(message.id);
    } else {
      convMessages.splice(insertIndex, 0, message.id);
    }
    
    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    await this.logConversationEvent(conversationId, 'message_restored', { 
      messageId: message.id,
      conversationId,
      restoredByUserId: restoredByUserId || conversationOwnerUserId,
      message
    });
    
    return message;
  }
  
  async restoreBranch(conversationId: string, conversationOwnerUserId: string, messageId: string, branchData: any, restoredByUserId?: string): Promise<any> {
    await this.loadUser(conversationOwnerUserId);
    await this.loadConversation(conversationId, conversationOwnerUserId);
    
    let message = this.messages.get(messageId);
    
    // Ensure dates are proper Date objects
    const branch = {
      ...branchData,
      createdAt: new Date(branchData.createdAt || Date.now())
    };
    
    let updatedMessage;
    
    if (!message) {
      // Parent message was deleted (this happens when deleting the only branch on a message)
      // We need to look up the original message from the event history
      const events = await this.conversationEventStore.loadEvents(conversationId);
      const originalCreateEvent = events.find((e: any) => 
        e.type === 'message_created' && e.data?.id === messageId
      );
      
      if (!originalCreateEvent || !originalCreateEvent.data) {
        throw new Error('Original message not found in event history - cannot restore branch');
      }
      
      // Recreate the message container with the restored branch
      const originalMessage = originalCreateEvent.data;
      updatedMessage = {
        ...originalMessage,
        branches: [branch],
        createdAt: new Date(originalMessage.createdAt || Date.now())
      };
      
      this.messages.set(messageId, updatedMessage);
      
      // Also re-add to conversation's message list
      let convMessages = this.conversationMessages.get(conversationId);
      if (!convMessages) {
        convMessages = [];
        this.conversationMessages.set(conversationId, convMessages);
      }
      if (!convMessages.includes(messageId)) {
        // Insert at original order position
        const insertIndex = originalMessage.order !== undefined && originalMessage.order < convMessages.length
          ? originalMessage.order
          : convMessages.length;
        convMessages.splice(insertIndex, 0, messageId);
      }
    } else {
      // Message exists, just add the branch
      if (message.branches.some(b => b.id === branchData.id)) {
        throw new Error('Branch already exists');
      }
      
      updatedMessage = {
        ...message,
        branches: [...message.branches, branch]
      };
      
      this.messages.set(messageId, updatedMessage);
    }
    
    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    await this.logConversationEvent(conversationId, 'message_branch_restored', { 
      messageId,
      branchId: branch.id,
      conversationId,
      restoredByUserId: restoredByUserId || conversationOwnerUserId,
      branch
    });
    
    return updatedMessage;
  }
  
  /**
   * Split a message at a given position, creating a new message with the second part
   */
  async splitMessage(
    conversationId: string, 
    conversationOwnerUserId: string, 
    messageId: string, 
    branchId: string, 
    splitPosition: number,
    splitByUserId?: string
  ): Promise<{ originalMessage: Message, newMessage: Message } | null> {
    await this.loadUser(conversationOwnerUserId);
    await this.loadConversation(conversationId, conversationOwnerUserId);
    
    const message = this.messages.get(messageId);
    if (!message) {
      console.log(`[splitMessage] Message not found: ${messageId}`);
      return null;
    }
    
    const branchIndex = message.branches.findIndex(b => b.id === branchId);
    if (branchIndex === -1) {
      console.log(`[splitMessage] Branch not found: ${branchId}`);
      return null;
    }
    
    const branch = message.branches[branchIndex];
    const content = branch.content;
    
    if (splitPosition <= 0 || splitPosition >= content.length) {
      console.log(`[splitMessage] Invalid split position: ${splitPosition} (content length: ${content.length})`);
      return null;
    }
    
    // Split the content
    const firstPart = content.substring(0, splitPosition).trim();
    const secondPart = content.substring(splitPosition).trim();
    
    if (!firstPart || !secondPart) {
      console.log(`[splitMessage] Split would result in empty message`);
      return null;
    }
    
    // Update the original branch with the first part
    const updatedBranch = { ...branch, content: firstPart };
    const updatedBranches = [...message.branches];
    updatedBranches[branchIndex] = updatedBranch;
    
    const originalMessage: Message = {
      ...message,
      branches: updatedBranches
    };
    this.messages.set(messageId, originalMessage);
    
    // Create a new message with the second part
    const newMessageId = uuidv4();
    const newBranchId = uuidv4();
    const newBranch = {
      id: newBranchId,
      content: secondPart,
      role: branch.role,
      participantId: branch.participantId,
      sentByUserId: branch.sentByUserId,
      createdAt: new Date(),
      model: branch.model,
      parentBranchId: branch.id, // Parent is the original branch
      attachments: undefined, // Attachments stay with original
      hiddenFromAi: branch.hiddenFromAi,
      creationSource: 'split' as const // Mark this as a split result
    };
    
    const newMessage: Message = {
      id: newMessageId,
      conversationId,
      branches: [newBranch],
      activeBranchId: newBranchId,
      order: message.order + 1
    };
    
    // Increment order of all messages after the original
    // IMPORTANT: We must log these order changes for proper event replay
    const convMessages = this.conversationMessages.get(conversationId) || [];
    const originalIndex = convMessages.indexOf(messageId);
    const orderChanges: { messageId: string; oldOrder: number; newOrder: number }[] = [];
    
    for (let i = originalIndex + 1; i < convMessages.length; i++) {
      const msgId = convMessages[i];
      const msg = this.messages.get(msgId);
      if (msg && msg.order !== undefined) {
        const oldOrder = msg.order;
        const newOrder = msg.order + 1;
        const updatedMsg = { ...msg, order: newOrder };
        this.messages.set(msgId, updatedMsg);
        orderChanges.push({ messageId: msgId, oldOrder, newOrder });
      }
    }
    
    // Insert new message after original
    this.messages.set(newMessageId, newMessage);
    convMessages.splice(originalIndex + 1, 0, newMessageId);
    
    // CRITICAL: Reparent any messages that were children of the original branch
    // They should now be children of the NEW message's branch (the second part)
    const reparentChanges: { messageId: string; branchId: string; oldParentBranchId: string; newParentBranchId: string }[] = [];
    
    for (const msgId of convMessages) {
      if (msgId === messageId || msgId === newMessageId) continue; // Skip original and new message
      
      const msg = this.messages.get(msgId);
      if (!msg) continue;
      
      let branchesUpdated = false;
      const updatedBranches = msg.branches.map(b => {
        if (b.parentBranchId === branchId) {
          // This branch was a child of the original branch - reparent to new branch
          reparentChanges.push({
            messageId: msgId,
            branchId: b.id,
            oldParentBranchId: branchId,
            newParentBranchId: newBranchId
          });
          branchesUpdated = true;
          return { ...b, parentBranchId: newBranchId };
        }
        return b;
      });
      
      if (branchesUpdated) {
        this.messages.set(msgId, { ...msg, branches: updatedBranches });
      }
    }
    
    // Log order changes for all affected messages (for proper replay)
    for (const change of orderChanges) {
      await this.logConversationEvent(conversationId, 'message_order_changed', {
        messageId: change.messageId,
        oldOrder: change.oldOrder,
        newOrder: change.newOrder
      }, splitByUserId || conversationOwnerUserId);
    }
    
    // Log reparent changes for all affected messages (for proper replay)
    for (const change of reparentChanges) {
      await this.logConversationEvent(conversationId, 'branch_parent_changed', {
        messageId: change.messageId,
        branchId: change.branchId,
        oldParentBranchId: change.oldParentBranchId,
        newParentBranchId: change.newParentBranchId
      }, splitByUserId || conversationOwnerUserId);
    }
    
    // Log the new message created event (for proper replay)
    await this.logConversationEvent(conversationId, 'message_created', newMessage, splitByUserId || conversationOwnerUserId);
    
    // Update the original message content in the event log
    await this.logConversationEvent(conversationId, 'message_content_updated', {
      messageId,
      branchId,
      content: firstPart
    }, splitByUserId || conversationOwnerUserId);
    
    // Log the split event (for history tracking)
    await this.logConversationEvent(conversationId, 'message_split', {
      messageId,
      branchId,
      splitPosition,
      newMessageId,
      newBranchId,
      splitByUserId: splitByUserId || conversationOwnerUserId,
      conversationId
    }, splitByUserId || conversationOwnerUserId);
    
    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    
    console.log(`[splitMessage] Split message ${messageId} at position ${splitPosition}, created new message ${newMessageId}`);
    
    return { originalMessage, newMessage };
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
  
  async updateMessageContent(messageId: string, conversationId: string, conversationOwnerUserId: string, branchId: string, content: string, contentBlocks?: any[]): Promise<boolean> {
    const message = await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
    if (!message) return false;
    
    const branch = message.branches.find(b => b.id === branchId);
    if (!branch) return false;
    
    // Create new message object with updated content
    const updatedBranches = message.branches.map(b => 
      b.id === branchId 
        ? { ...b, content, contentBlocks }
        : b
    );
    const updated = { ...message, branches: updatedBranches };
    this.messages.set(messageId, updated);
    
    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);
    await this.logConversationEvent(conversationId, 'message_content_updated', { messageId, branchId, content, contentBlocks });

    return true;
  }

  async updateMessageBranch(messageId: string, conversationOwnerUserId: string, branchId: string, updates: Partial<MessageBranch>): Promise<boolean> {
    const message = this.messages.get(messageId);
    if (!message) return false;

    const branch = message.branches.find(b => b.id === branchId);
    if (!branch) return false;

    // Store debug data as blobs - NEVER keep in memory
    // The full debugRequest includes the entire conversation context and can be 8+ MB
    const updatesForMemory = { ...updates } as any;
    const blobStore = getBlobStore();
    
    // Strip debug data from memory, save to blobs, store only blob IDs
    if (updatesForMemory.debugRequest) {
      try {
        const debugRequestBlobId = await blobStore.saveJsonBlob(updatesForMemory.debugRequest);
        updatesForMemory.debugRequestBlobId = debugRequestBlobId;
      } catch (err) {
        console.warn('[Database] Failed to save debugRequest as blob:', err);
      }
      delete updatesForMemory.debugRequest; // Never store in memory
    }
    
    if (updatesForMemory.debugResponse) {
      try {
        const debugResponseBlobId = await blobStore.saveJsonBlob(updatesForMemory.debugResponse);
        updatesForMemory.debugResponseBlobId = debugResponseBlobId;
      } catch (err) {
        console.warn('[Database] Failed to save debugResponse as blob:', err);
      }
      delete updatesForMemory.debugResponse; // Never store in memory
    }

    // Create new message object with updated branch (debug data stripped, only blob IDs)
    const updatedBranches = message.branches.map(b =>
      b.id === branchId
        ? { ...b, ...updatesForMemory }
        : b
    );
    const updated = { ...message, branches: updatedBranches };
    this.messages.set(messageId, updated);

    // Log event with blob references (same as memory state)
    await this.logConversationEvent(message.conversationId, 'message_branch_updated', { messageId, branchId, updates: updatesForMemory });

    return true;
  }
  
  async deleteMessageBranch(messageId: string, conversationId: string, conversationOwnerUserId: string, branchId: string, deletedByUserId?: string): Promise<string[] | null> {
    const message = await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
    if (!message) return null;

    const branch = message.branches.find(b => b.id === branchId);
    if (!branch) return null;

    const deletedMessageIds: string[] = [];
    const actionUserId = deletedByUserId || conversationOwnerUserId;

    // Track non-system branches being deleted (for updating cached count)
    let deletedNonSystemBranches = 0;

    // If this is the only branch, delete the entire message and cascade
    if (message.branches.length === 1) {
      // Count non-system branches in original message
      deletedNonSystemBranches += message.branches.filter(b => b.role !== 'system').length;

      // Find all messages that need to be deleted (cascade)
      const messagesToDelete = this.findDescendantMessages(messageId, branchId);
      deletedMessageIds.push(messageId, ...messagesToDelete);

      // Delete messages in reverse order (children first)
      for (const msgId of [...messagesToDelete].reverse()) {
        const msg = this.messages.get(msgId);
        if (msg) {
          // Count non-system branches in cascade-deleted messages
          deletedNonSystemBranches += msg.branches.filter(b => b.role !== 'system').length;

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
            conversationId,
            deletedByUserId: actionUserId
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
        conversationId,
        deletedByUserId: actionUserId
      });
    } else {
      // Just remove this branch - count if non-system
      if (branch.role !== 'system') {
        deletedNonSystemBranches += 1;
      }

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
        conversationId,
        deletedByUserId: actionUserId
      });

      // Still need to cascade delete messages that reply to this specific branch
      const descendantMessages = this.findDescendantMessages(messageId, branchId);
      deletedMessageIds.push(...descendantMessages);

      for (const msgId of [...descendantMessages].reverse()) {
        const msg = this.messages.get(msgId);
        if (msg) {
          // Count non-system branches in cascade-deleted messages
          deletedNonSystemBranches += msg.branches.filter(b => b.role !== 'system').length;

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
            conversationId,
            deletedByUserId: actionUserId
          });
        }
      }
    }

    await this.updateConversationTimestamp(conversationId, conversationOwnerUserId);

    // Update cached branch count in state file
    if (deletedNonSystemBranches > 0) {
      await this.uiStateStore.decrementBranchCount(conversationId, deletedNonSystemBranches);
    }

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

  /**
   * Topologically sort messages so parents come before children.
   * This ensures correct processing when order numbers don't reflect tree structure.
   */
  private sortMessagesByTreeOrder(messages: Message[]): Message[] {
    if (messages.length === 0) return [];
    
    // Build a map of branch ID -> message index
    const branchToMsgIndex = new Map<string, number>();
    for (let i = 0; i < messages.length; i++) {
      for (const branch of messages[i].branches) {
        branchToMsgIndex.set(branch.id, i);
      }
    }
    
    // Topological sort
    const sortedIndices: number[] = [];
    const visited = new Set<number>();
    const visiting = new Set<number>();
    
    const visit = (msgIndex: number): void => {
      if (visited.has(msgIndex)) return;
      if (visiting.has(msgIndex)) return; // Cycle detected, skip
      
      visiting.add(msgIndex);
      const msg = messages[msgIndex];
      
      // Visit all parents first
      for (const branch of msg.branches) {
        if (branch.parentBranchId && branch.parentBranchId !== 'root') {
          const parentMsgIndex = branchToMsgIndex.get(branch.parentBranchId);
          if (parentMsgIndex !== undefined && parentMsgIndex !== msgIndex) {
            visit(parentMsgIndex);
          }
        }
      }
      
      visiting.delete(msgIndex);
      visited.add(msgIndex);
      sortedIndices.push(msgIndex);
    };
    
    // Visit all messages
    for (let i = 0; i < messages.length; i++) {
      visit(i);
    }
    
    // Return messages in sorted order
    return sortedIndices.map(i => messages[i]);
  }

  async getConversationMessages(conversationId: string, conversationOwnerUserId: string, requestingUserId?: string): Promise<Message[]> {
    await this.loadUser(conversationOwnerUserId);
    await this.loadConversation(conversationId, conversationOwnerUserId);
    const messageIds = this.conversationMessages.get(conversationId) || [];
    
    // Get messages and filter branches by privacy
    const viewerId = requestingUserId || conversationOwnerUserId;
    const messages = messageIds
      .map(id => this.messages.get(id))
      .filter((msg): msg is Message => msg !== undefined)
      .map(msg => {
        // Filter out branches that are private to other users
        const visibleBranches = msg.branches.filter(
          b => !b.privateToUserId || b.privateToUserId === viewerId
        );
        return { ...msg, branches: visibleBranches };
      })
      .filter(msg => msg.branches.length > 0); // Remove messages with no visible branches
    
    // Only log if there's a potential issue
    if (messageIds.length !== messages.length) {
      console.warn(`Message mismatch for conversation ${conversationId}: ${messageIds.length} IDs but only ${messages.length} messages found (some may have no visible branches for user ${viewerId})`);
    }
    
    // Sort by tree order (parents before children) instead of order field
    // This handles cases where order numbers don't reflect tree structure
    return this.sortMessagesByTreeOrder(messages);
  }

  async getMessage(messageId: string, conversationId: string, conversationOwnerUserId: string): Promise<Message | null> {
    return await this.tryLoadAndVerifyMessage(messageId, conversationId, conversationOwnerUserId);
  }

  /**
   * Admin-only: Get conversation messages without requiring owner ID
   * Used for diagnostic purposes to investigate problematic conversations
   */
  async getConversationMessagesAdmin(conversationId: string): Promise<Message[]> {
    // Find the conversation by scanning all users' conversations
    // This is inefficient but acceptable for admin diagnostics
    for (const [userId] of this.users) {
      await this.loadUser(userId);
      const userConvos = this.userConversations.get(userId) || new Set();
      if (userConvos.has(conversationId)) {
        await this.loadConversation(conversationId, userId);
        const messageIds = this.conversationMessages.get(conversationId) || [];
        const messages = messageIds
          .map(id => this.messages.get(id))
          .filter((msg): msg is Message => msg !== undefined && msg.branches.length > 0);
        return this.sortMessagesByTreeOrder(messages);
      }
    }
    return [];
  }

  /**
   * Get event history for a conversation
   */
  async getConversationEvents(conversationId: string, conversationOwnerUserId: string): Promise<any[]> {
    await this.loadUser(conversationOwnerUserId);
    await this.loadConversation(conversationId, conversationOwnerUserId);
    
    // Load events from the conversation event store
    const events = await this.conversationEventStore.loadEvents(conversationId);
    
    // Build index of message_created events by messageId for looking up deleted message data
    const messageCreatedByIdMap = new Map<string, any>();
    // Track branches added after message creation, keyed by messageId
    const additionalBranchesByMessageId = new Map<string, any[]>();
    // Also track branches by branchId for looking up deleted branches
    const branchByIdMap = new Map<string, { messageId: string; branch: any }>();
    
    for (const event of events) {
      if (event.type === 'message_created' && event.data?.id) {
        messageCreatedByIdMap.set(event.data.id, event.data);
        // Index branches from message_created
        for (const branch of event.data.branches || []) {
          branchByIdMap.set(branch.id, { messageId: event.data.id, branch });
        }
      }
      if (event.type === 'message_branch_added' && event.data?.branch) {
        // Index branches from message_branch_added
        branchByIdMap.set(event.data.branch.id, { messageId: event.data.messageId, branch: event.data.branch });
        // Also track additional branches per message for full message reconstruction
        const messageId = event.data.messageId;
        if (!additionalBranchesByMessageId.has(messageId)) {
          additionalBranchesByMessageId.set(messageId, []);
        }
        additionalBranchesByMessageId.get(messageId)!.push(event.data.branch);
      }
    }
    
    // Filter out noise events that shouldn't appear in the event history panel
    const filteredEvents = events.filter((event: any) => {
      // active_branch_changed events are now stored separately and shouldn't clutter history
      if (event.type === 'active_branch_changed') return false;
      // message_order_changed events are internal bookkeeping
      if (event.type === 'message_order_changed') return false;
      return true;
    });

    // Enrich events with user info where available
    const enrichedEvents = await Promise.all(filteredEvents.map(async (event: any) => {
      const enriched: any = {
        type: event.type,
        timestamp: event.timestamp,
        data: event.data
      };
      
      // Try to get user info from various possible fields
      // Check both top-level and nested in branches[0] for message_created events
      // Also check branch.sentByUserId for message_branch_added events
      const userId = event.data?.sentByUserId || 
                     event.data?.deletedByUserId || 
                     event.data?.editedByUserId ||
                     event.data?.userId ||
                     event.data?.triggeredByUserId ||
                     event.data?.branches?.[0]?.sentByUserId ||
                     event.data?.branch?.sentByUserId;
      if (userId) {
        const user = await this.getUserById(userId);
        enriched.userName = user?.name || 'Unknown';
        enriched.userId = userId;
      }
      
      // For message_created events, include message role, branch, and participant info
      if (event.type === 'message_created' && event.data?.branches?.[0]) {
        enriched.role = event.data.branches[0].role;
        enriched.messageId = event.data.id;
        enriched.branchId = event.data.branches[0].id;
        if (event.data.branches[0].participantId) {
          const participant = this.participants.get(event.data.branches[0].participantId);
          enriched.participantName = participant?.name;
        }
      }
      
      // For message_branch_added events, include branch info
      if (event.type === 'message_branch_added' && event.data?.branch) {
        enriched.messageId = event.data.messageId;
        enriched.branchId = event.data.branch.id;
        enriched.role = event.data.branch.role;
        if (event.data.branch.participantId) {
          const participant = this.participants.get(event.data.branch.participantId);
          enriched.participantName = participant?.name;
        }
      }
      
      // For message_deleted events, include the message ID and original message data
      if (event.type === 'message_deleted') {
        const messageId = event.data?.messageId || event.data?.id;
        enriched.messageId = messageId;
        
        // Look up original message from message_created event and merge in any additional branches
        const baseMessage = messageCreatedByIdMap.get(messageId);
        if (baseMessage) {
          const additionalBranches = additionalBranchesByMessageId.get(messageId) || [];
          if (additionalBranches.length > 0) {
            // Merge additional branches into the message for full restoration
            enriched.originalMessage = {
              ...baseMessage,
              branches: [...(baseMessage.branches || []), ...additionalBranches]
            };
          } else {
            enriched.originalMessage = baseMessage;
          }
        }
      }
      
      // For message_branch_deleted events, include the original branch data
      if (event.type === 'message_branch_deleted') {
        const branchId = event.data?.branchId;
        enriched.messageId = event.data?.messageId;
        enriched.branchId = branchId;
        
        // Look up original branch
        const branchInfo = branchByIdMap.get(branchId);
        if (branchInfo) {
          enriched.originalBranch = branchInfo.branch;
        }
      }
      
      return enriched;
    }));
    
    return enrichedEvents;
  }

  // Get conversation archive with all branches and orphan/deleted status for debugging
  async getConversationArchive(conversationId: string): Promise<{
    messages: Array<{
      id: string;
      order: number;
      branches: Array<{
        id: string;
        parentBranchId: string | null;
        content: string;
        role: string;
        createdAt: string;
        isActive: boolean;
        isOrphan: boolean;
        isDeleted: boolean;
        model?: string;
      }>;
    }>;
    stats: {
      totalMessages: number;
      totalBranches: number;
      orphanedBranches: number;
      deletedBranches: number;
      rootBranches: number;
    };
  }> {
    // Load raw events from the conversation event store
    const events = await this.conversationEventStore.loadEvents(conversationId);
    
    // Process events to build complete picture
    const messagesMap = new Map<string, {
      id: string;
      order: number;
      activeBranchId: string;
      branches: Map<string, {
        id: string;
        parentBranchId: string | null;
        content: string;
        role: string;
        createdAt: string;
        model?: string;
        isDeleted: boolean;
        contentBlocks?: any[];
      }>;
      isDeleted: boolean;
    }>();
    
    const deletedBranchIds = new Set<string>();
    const deletedMessageIds = new Set<string>();
    
    for (const event of events) {
      const data = event.data as any;
      
      if (event.type === 'message_created') {
        const branches = new Map();
        for (const b of data.branches || []) {
          branches.set(b.id, {
            id: b.id,
            parentBranchId: b.parentBranchId || null,
            content: b.content || '',
            role: b.role,
            createdAt: b.createdAt,
            model: b.model,
            isDeleted: false,
          });
        }
        messagesMap.set(data.id, {
          id: data.id,
          order: data.order ?? 0,
          activeBranchId: data.activeBranchId,
          branches,
          isDeleted: false,
        });
      } else if (event.type === 'message_branch_added') {
        const msg = messagesMap.get(data.messageId);
        if (msg && data.branch) {
          msg.branches.set(data.branch.id, {
            id: data.branch.id,
            parentBranchId: data.branch.parentBranchId || null,
            content: data.branch.content || '',
            role: data.branch.role,
            createdAt: data.branch.createdAt,
            model: data.branch.model,
            isDeleted: false,
          });
        }
      } else if (event.type === 'active_branch_changed') {
        const msg = messagesMap.get(data.messageId);
        if (msg) {
          msg.activeBranchId = data.branchId;
        }
      } else if (event.type === 'message_deleted') {
        deletedMessageIds.add(data.messageId);
        const msg = messagesMap.get(data.messageId);
        if (msg) {
          msg.isDeleted = true;
          for (const [bid] of msg.branches) {
            deletedBranchIds.add(bid);
          }
        }
      } else if (event.type === 'message_branch_deleted') {
        deletedBranchIds.add(data.branchId);
        const msg = messagesMap.get(data.messageId);
        if (msg) {
          const branch = msg.branches.get(data.branchId);
          if (branch) {
            branch.isDeleted = true;
          }
        }
      } else if (event.type === 'message_content_updated') {
        const msg = messagesMap.get(data.messageId);
        if (msg) {
          const branch = msg.branches.get(data.branchId);
          if (branch) {
            branch.content = data.content;
            // Restore contentBlocks if present in the event
            if (data.contentBlocks && Array.isArray(data.contentBlocks)) {
              branch.contentBlocks = data.contentBlocks;
            }
          }
        }
      }
    }
    
    // Build set of all existing (non-deleted) branch IDs
    const existingBranchIds = new Set<string>();
    for (const [, msg] of messagesMap) {
      if (!msg.isDeleted) {
        for (const [bid, branch] of msg.branches) {
          if (!branch.isDeleted) {
            existingBranchIds.add(bid);
          }
        }
      }
    }
    
    // Build result with orphan status
    const result: Array<{
      id: string;
      order: number;
      branches: Array<{
        id: string;
        parentBranchId: string | null;
        content: string;
        role: string;
        createdAt: string;
        isActive: boolean;
        isOrphan: boolean;
        isDeleted: boolean;
        model?: string;
      }>;
    }> = [];
    
    let orphanedCount = 0;
    let deletedCount = 0;
    let rootCount = 0;
    let totalBranches = 0;
    
    for (const [, msg] of messagesMap) {
      const branchesArray = [];
      for (const [bid, branch] of msg.branches) {
        totalBranches++;
        
        // Check if orphan: parent exists but is deleted or doesn't exist
        const isOrphan = branch.parentBranchId !== null && 
          !existingBranchIds.has(branch.parentBranchId);
        
        if (isOrphan) orphanedCount++;
        if (branch.isDeleted) deletedCount++;
        if (branch.parentBranchId === null) rootCount++;
        
        branchesArray.push({
          id: bid,
          parentBranchId: branch.parentBranchId,
          content: branch.content,
          role: branch.role,
          createdAt: branch.createdAt,
          isActive: bid === msg.activeBranchId,
          isOrphan,
          isDeleted: branch.isDeleted || msg.isDeleted,
          model: branch.model,
        });
      }
      
      result.push({
        id: msg.id,
        order: msg.order,
        branches: branchesArray,
      });
    }
    
    // Sort by order
    result.sort((a, b) => a.order - b.order);
    
    return {
      messages: result,
      stats: {
        totalMessages: result.length,
        totalBranches,
        orphanedBranches: orphanedCount,
        deletedBranches: deletedCount,
        rootBranches: rootCount,
      },
    };
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
    contextManagement?: any,
    participantUserId?: string // The user who "owns" this participant (for collaborative user participants)
  ): Promise<Participant> {
    await this.loadUser(conversationOwnerUserId);
    const participant: Participant = {
      id: uuidv4(),
      conversationId,
      name,
      type,
      userId: participantUserId,
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
    
    // Only log in debug mode
    if (process.env.LOG_DEBUG === 'true') {
      console.log(`[Database] getConversationParticipants for ${conversationId}:`, participants.map(p => ({ id: p.id, name: p.name, model: p.model })));
    }

    return participants;
  }
  
  async getParticipant(participantId: string, conversationOwnerUserId: string): Promise<Participant | null> {
    return await this.tryLoadAndVerifyParticipant(participantId, conversationOwnerUserId);
  }
  
  async updateParticipant(participantId: string, conversationOwnerUserId: string, updates: Partial<Participant>): Promise<Participant | null> {
    const participant = await this.tryLoadAndVerifyParticipant(participantId, conversationOwnerUserId);
    if (!participant) return null;
    
    console.log(`[Database] updateParticipant ${participantId}:`);
    console.log('  Old model:', participant.model);
    console.log('  Updates:', updates);
    
    const updated = {
      ...participant,
      ...updates
    };
    
    console.log('  New model:', updated.model);
    
    this.participants.set(participantId, updated);
    console.log('[Database] ✅ Participant updated in memory map');
  
    await this.logUserEvent(conversationOwnerUserId, 'participant_updated', { participantId, updates });
    console.log('[Database] ✅ Event logged');
    
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
  
  /**
   * Sanitize numeric fields in metrics to prevent NaN contamination
   */
  private sanitizeMetrics(metrics: MetricsData): MetricsData {
    const safeNumber = (val: any): number => {
      const num = Number(val);
      return Number.isFinite(num) ? num : 0;
    };
    
    return {
      ...metrics,
      inputTokens: safeNumber(metrics.inputTokens),
      outputTokens: safeNumber(metrics.outputTokens),
      cachedTokens: safeNumber(metrics.cachedTokens),
      cost: safeNumber(metrics.cost),
      cacheSavings: safeNumber(metrics.cacheSavings),
      responseTime: safeNumber(metrics.responseTime),
    };
  }
  
  async addMetrics(conversationId: string, conversationOwnerUserId: string, metrics: MetricsData): Promise<void> {

    const conversation = await this.tryLoadAndVerifyConversation(conversationId, conversationOwnerUserId);
    if (!conversation) return;

    if (!this.conversationMetrics.has(conversationId)) {
      this.conversationMetrics.set(conversationId, []);
    }

    // Sanitize metrics to prevent NaN/undefined from corrupting totals
    const sanitizedMetrics = this.sanitizeMetrics(metrics);
    
    const convMetrics = this.conversationMetrics.get(conversationId)!;
    convMetrics.push(sanitizedMetrics);

    // Store event (with sanitized metrics to prevent NaN in persisted data)
    await this.logUserEvent(conversationOwnerUserId, 'metrics_added', { conversationId, metrics: sanitizedMetrics });

    // Check if user has their own API key for this provider - if so, skip burning credits
    const modelLoader = ModelLoader.getInstance();
    const model = await modelLoader.getModelById(metrics.model, conversationOwnerUserId);
    if (model) {
      const userApiKeys = await this.getUserApiKeys(conversationOwnerUserId);
      const hasProviderKey = userApiKeys.some(key => key.provider === model.provider);
      if (hasProviderKey) {
        console.log(`[Credits] User ${conversationOwnerUserId} has custom ${model.provider} API key, skipping credit burn`);
        return;
      }
    }

    const burnAmount = Math.max(Number(metrics.cost) || 0, 0);
    this.ensureGrantContainers(conversationOwnerUserId);
    const applicableCurrencies = await this.getApplicableGrantCurrencies(metrics.model, conversationOwnerUserId);
    const totals = this.userGrantTotals.get(conversationOwnerUserId)!;
    let burnCurrency = applicableCurrencies.find(currency => Number(totals.get(currency) || 0) > 0);
    if (!burnCurrency) {
      burnCurrency = applicableCurrencies[applicableCurrencies.length - 1] || 'credit';
    }
    await this.recordGrantInfo({
      id: uuidv4(),
      time: new Date().toISOString(),
      type: 'burn',
      amount: burnAmount,
      fromUserId: conversationOwnerUserId,
      causeId: metrics.timestamp,
      reason: `Model usage (${metrics.model})`,
      currency: burnCurrency,
      details: metrics.details
    });
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
    totalTreeTokens?: number; // Total size of ALL branches in conversation tree
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
    
    // Helper to safely add numbers (handles NaN/undefined from legacy data)
    const safeAdd = (a: number, b: any): number => {
      const num = Number(b);
      return Number.isFinite(num) ? a + num : a;
    };
    
    for (const metric of metrics) {
      totals.inputTokens = safeAdd(totals.inputTokens, metric.inputTokens);
      totals.outputTokens = safeAdd(totals.outputTokens, metric.outputTokens);
      totals.cachedTokens = safeAdd(totals.cachedTokens, metric.cachedTokens);
      totals.totalCost = safeAdd(totals.totalCost, metric.cost);
      totals.totalSavings = safeAdd(totals.totalSavings, metric.cacheSavings);
      const modelMetrics = perModelMetrics.get(metric.model);
      if (modelMetrics) {
        modelMetrics.lastCompletion = metric;
        modelMetrics.totals.inputTokens = safeAdd(modelMetrics.totals.inputTokens, metric.inputTokens);
        modelMetrics.totals.outputTokens = safeAdd(modelMetrics.totals.outputTokens, metric.outputTokens);
        modelMetrics.totals.cachedTokens = safeAdd(modelMetrics.totals.cachedTokens, metric.cachedTokens);
        modelMetrics.totals.totalCost = safeAdd(modelMetrics.totals.totalCost, metric.cost);
        modelMetrics.totals.completionCount += 1;
      }
    }
    
    // Calculate total tree size: all content in all branches of all messages
    let totalTreeTokens = 0;
    let totalBranches = 0;
    for (const message of messages) {
      for (const branch of message.branches) {
        const branchTokens = Math.ceil(branch.content.length / 4);
        totalTreeTokens += branchTokens;
        totalBranches++;
      }
    }
    
    console.log(`[Database] Conversation tree size: ${messages.length} messages, ${totalBranches} branches, ${totalTreeTokens} tokens`);
    
    return {
      messageCount: messages.length,
      perModelMetrics: perModelMetrics,
      lastCompletion: metrics[metrics.length-1],
      totals: totals,
      totalTreeTokens
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

  // ==========================================
  // Collaboration (User-to-User Sharing) Methods
  // ==========================================

  /**
   * Share a conversation with another user
   */
  async createCollaborationShare(
    conversationId: string,
    sharedWithEmail: string,
    sharedByUserId: string,
    permission: SharePermission
  ): Promise<ConversationShare | null> {
    // Find the user by email
    const targetUser = await this.getUserByEmail(sharedWithEmail);
    if (!targetUser) {
      console.log(`[Collaboration] User not found with email: ${sharedWithEmail}`);
      return null;
    }
    
    // Check if already shared with this user
    if (this.collaborationStore.hasExistingShare(conversationId, targetUser.id)) {
      console.log(`[Collaboration] Already shared with user: ${targetUser.id}`);
      return null;
    }
    
    // Verify the conversation exists and sharer has access
    const conversation = await this.getConversation(conversationId, sharedByUserId);
    if (!conversation) {
      console.log(`[Collaboration] Conversation not found or no access: ${conversationId}`);
      return null;
    }
    
    // Create the share
    const { share, eventData } = this.collaborationStore.createShare(
      conversationId,
      targetUser.id,
      sharedWithEmail,
      sharedByUserId,
      permission
    );
    
    // Persist the event
    await this.eventStore.appendEvent({
      timestamp: new Date(),
      ...eventData
    });
    
    // Create a user participant for the invited user (if they have edit/collaborator permission)
    if (permission === 'editor' || permission === 'collaborator') {
      // Get the target user's display name
      const invitedUserName = targetUser.name || sharedWithEmail.split('@')[0];
      
      // Create participant for the invited user - use conversation owner's userId for loading
      await this.createParticipant(
        conversationId,
        conversation.userId, // Load under conversation owner's account
        invitedUserName,
        'user',
        undefined, // model
        undefined, // systemPrompt
        undefined, // settings
        undefined, // contextManagement
        targetUser.id // participantUserId - the invited user "owns" this participant
      );
      
      console.log(`[Collaboration] Created participant for invited user ${targetUser.id} in conversation ${conversationId}`);
    }
    
    console.log(`[Collaboration] Shared conversation ${conversationId} with ${sharedWithEmail} (${permission})`);
    return share;
  }

  /**
   * Update collaboration share permission
   */
  async updateCollaborationShare(
    shareId: string,
    permission: SharePermission,
    updatedByUserId: string
  ): Promise<ConversationShare | null> {
    const { share, eventData } = this.collaborationStore.updateSharePermission(
      shareId,
      permission,
      updatedByUserId
    );
    
    if (share && eventData) {
      await this.eventStore.appendEvent({
        timestamp: new Date(),
        ...eventData
      });
      console.log(`[Collaboration] Updated share ${shareId} to ${permission}`);
    }
    
    return share;
  }

  /**
   * Revoke a collaboration share
   */
  async revokeCollaborationShare(
    shareId: string,
    revokedByUserId: string
  ): Promise<boolean> {
    const { success, eventData } = this.collaborationStore.revokeShare(shareId, revokedByUserId);
    
    if (success && eventData) {
      await this.eventStore.appendEvent({
        timestamp: new Date(),
        ...eventData
      });
      console.log(`[Collaboration] Revoked share ${shareId}`);
    }
    
    return success;
  }

  /**
   * Get all shares for a conversation (who has access)
   */
  getCollaborationSharesForConversation(conversationId: string): ConversationShare[] {
    return this.collaborationStore.getSharesForConversation(conversationId);
  }

  /**
   * Get all conversations shared with a user
   */
  getConversationsSharedWithUser(userId: string): ConversationShare[] {
    return this.collaborationStore.getSharesForUser(userId);
  }

  /**
   * Get user's permission level for a conversation (null if no access)
   */
  getUserCollaborationPermission(conversationId: string, userId: string): SharePermission | null {
    return this.collaborationStore.getUserPermission(conversationId, userId);
  }

  /**
   * Check if user can access conversation (owner or has share)
   */
  async canUserAccessConversation(conversationId: string, userId: string): Promise<{ canAccess: boolean; isOwner: boolean; permission: SharePermission | null }> {
    // First check if owner
    const conversation = this.conversations.get(conversationId);
    if (conversation && conversation.userId === userId) {
      return { canAccess: true, isOwner: true, permission: 'editor' }; // Owner has full access
    }
    
    // Check collaboration shares
    const permission = this.collaborationStore.getUserPermission(conversationId, userId);
    return { 
      canAccess: permission !== null, 
      isOwner: false, 
      permission 
    };
  }

  /**
   * Check if user can chat in conversation
   */
  async canUserChatInConversation(conversationId: string, userId: string): Promise<boolean> {
    const { canAccess, isOwner, permission } = await this.canUserAccessConversation(conversationId, userId);
    if (!canAccess) return false;
    if (isOwner) return true;
    return permission !== null && canChat(permission);
  }

  /**
   * Check if user can delete messages in conversation
   */
  async canUserDeleteInConversation(conversationId: string, userId: string): Promise<boolean> {
    const { canAccess, isOwner, permission } = await this.canUserAccessConversation(conversationId, userId);
    if (!canAccess) return false;
    if (isOwner) return true;
    return permission !== null && canDelete(permission);
  }

  // ==========================================
  // Collaboration Invite Link Methods
  // ==========================================

  /**
   * Create an invite link for a conversation
   */
  async createCollaborationInvite(
    conversationId: string,
    createdByUserId: string,
    permission: SharePermission,
    options?: {
      label?: string;
      expiresInHours?: number;
      maxUses?: number;
    }
  ): Promise<any> {
    const { invite, eventData } = this.collaborationStore.createInvite(
      conversationId,
      createdByUserId,
      permission,
      options
    );
    
    await this.eventStore.appendEvent({
      timestamp: new Date(),
      ...eventData
    });
    
    console.log(`[Collaboration] Created invite link for conversation ${conversationId}`);
    return invite;
  }

  /**
   * Get invite by token (for claiming)
   */
  async getCollaborationInviteByToken(token: string): Promise<any> {
    return this.collaborationStore.getInviteByToken(token);
  }

  /**
   * Get invites for a conversation
   */
  async getCollaborationInvitesForConversation(conversationId: string): Promise<any[]> {
    return this.collaborationStore.getInvitesForConversation(conversationId);
  }

  /**
   * Claim an invite (join the conversation)
   */
  async claimCollaborationInvite(token: string, userId: string): Promise<{ 
    success: boolean; 
    error?: string; 
    conversationId?: string; 
    permission?: SharePermission 
  }> {
    const invite = this.collaborationStore.getInviteByToken(token);
    if (!invite) {
      return { success: false, error: 'Invite not found or expired' };
    }
    
    // Check if user already has access
    const existingAccess = await this.canUserAccessConversation(invite.conversationId, userId);
    if (existingAccess.canAccess) {
      return { success: false, error: 'You already have access to this conversation' };
    }
    
    // Can't claim your own invite
    if (invite.createdByUserId === userId) {
      return { success: false, error: 'Cannot claim your own invite' };
    }
    
    // Load the invite creator's data to ensure the conversation is in memory
    await this.loadUser(invite.createdByUserId);
    
    // Get conversation to find owner
    const conversation = this.conversations.get(invite.conversationId);
    if (!conversation) {
      return { success: false, error: 'Conversation not found' };
    }
    
    // Get user info for the share
    const claimingUser = await this.getUserById(userId);
    if (!claimingUser) {
      return { success: false, error: 'User not found' };
    }
    
    // Create collaboration share for the user
    const { share, eventData } = this.collaborationStore.createShare(
      invite.conversationId,
      userId,
      claimingUser.email || '',
      invite.createdByUserId,
      invite.permission
    );
    
    await this.eventStore.appendEvent({
      timestamp: new Date(),
      ...eventData
    });
    
    // Create user participant for the claiming user (if they have edit/collaborator permission)
    if (invite.permission === 'editor' || invite.permission === 'collaborator') {
      const userName = claimingUser.name || claimingUser.email?.split('@')[0] || 'User';
      
      await this.createParticipant(
        invite.conversationId,
        conversation.userId,
        userName,
        'user',
        undefined,
        undefined,
        undefined,
        undefined,
        userId
      );
    }
    
    // Increment invite use count
    const { eventData: useEventData } = this.collaborationStore.useInvite(invite.id);
    if (useEventData) {
      await this.eventStore.appendEvent({
        timestamp: new Date(),
        ...useEventData
      });
    }
    
    console.log(`[Collaboration] User ${userId} claimed invite for conversation ${invite.conversationId}`);
    
    return {
      success: true,
      conversationId: invite.conversationId,
      permission: invite.permission
    };
  }

  /**
   * Delete an invite
   */
  async deleteCollaborationInvite(inviteId: string, deletedByUserId: string): Promise<boolean> {
    const { success, eventData } = this.collaborationStore.deleteInvite(inviteId, deletedByUserId);
    
    if (success && eventData) {
      await this.eventStore.appendEvent({
        timestamp: new Date(),
        ...eventData
      });
    }
    
    return success;
  }

  /**
   * Get public info about a conversation (limited data for invite pages)
   */
  async getConversationPublicInfo(conversationId: string): Promise<{ title: string } | null> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return null;
    return { title: conversation.title };
  }

  /**
   * Get user display name
   */
  async getUserDisplayName(userId: string): Promise<string> {
    const user = await this.getUserById(userId);
    return user?.name || 'Unknown User';
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

  // User Model methods
  async createUserModel(userId: string, modelData: import('@deprecated-claude/shared').CreateUserModel): Promise<UserDefinedModel> {
    await this.loadUser(userId); // Ensure user data is loaded
    
    // Limit number of custom models per user
    const existingModels = await this.getUserModels(userId);
    if (existingModels.length >= 20) {
      throw new Error('Maximum number of custom models (20) reached');
    }

    // Resolve settings with validation
    let resolvedSettings = modelData.settings;
    if (!resolvedSettings) {
      // Default settings for user models - use outputTokenLimit as default
      // Users can adjust in settings if needed, most generations won't hit the limit
      resolvedSettings = {
        temperature: 1.0,
        maxTokens: modelData.outputTokenLimit
      };
    } else {
      // Validate provided maxTokens doesn't exceed outputTokenLimit
      resolvedSettings = {
        ...resolvedSettings,
        maxTokens: Math.min(resolvedSettings.maxTokens, modelData.outputTokenLimit)
      };
    }

    const model: UserDefinedModel = {
      id: uuidv4(),
      userId,
      ...modelData,
      supportsThinking: modelData.supportsThinking || false,
      supportsPrefill: modelData.supportsPrefill ?? false,
      capabilities: modelData.capabilities, // Include auto-detected capabilities
      hidden: false,
      settings: resolvedSettings,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.userModels.set(model.id, model);
    
    const userModelIds = this.userModelsByUser.get(userId) || new Set();
    userModelIds.add(model.id);
    this.userModelsByUser.set(userId, userModelIds);

    await this.logUserEvent(userId, 'user_model_created', { model });

    return model;
  }

  async getUserModels(userId: string): Promise<UserDefinedModel[]> {
    await this.loadUser(userId); // Ensure user data is loaded
    const modelIds = this.userModelsByUser.get(userId) || new Set();
    return Array.from(modelIds)
      .map(id => this.userModels.get(id))
      .filter((model): model is UserDefinedModel => model !== undefined && !model.hidden);
  }

  async getUserModel(modelId: string, userId: string): Promise<UserDefinedModel | null> {
    await this.loadUser(userId); // Ensure user data is loaded
    const model = this.userModels.get(modelId);
    if (!model || model.userId !== userId) {
      return null;
    }
    return model;
  }

  async updateUserModel(modelId: string, userId: string, updates: import('@deprecated-claude/shared').UpdateUserModel): Promise<UserDefinedModel | null> {
    const model = await this.getUserModel(modelId, userId);
    if (!model) {
      return null;
    }

    const updatedModel = {
      ...model,
      ...updates,
      updatedAt: new Date()
    };

    this.userModels.set(modelId, updatedModel);

    await this.logUserEvent(userId, 'user_model_updated', { modelId, updates: { ...updates, updatedAt: updatedModel.updatedAt } });

    return updatedModel;
  }

  async deleteUserModel(modelId: string, userId: string): Promise<boolean> {
    const model = await this.getUserModel(modelId, userId);
    if (!model) {
      return false;
    }

    this.userModels.delete(modelId);
    
    const userModelIds = this.userModelsByUser.get(userId);
    if (userModelIds) {
      userModelIds.delete(modelId);
    }

    await this.logUserEvent(userId, 'user_model_deleted', { modelId, userId });

    return true;
  }

  // ============================================================================
  // Persona Methods
  // ============================================================================

  async createPersona(userId: string, request: CreatePersonaRequest): Promise<Persona> {
    const result = this.personaStore.createPersona(userId, request);
    await this.logUserEvent(userId, result.eventData.type, result.eventData.data);
    return result.persona;
  }

  async getPersona(personaId: string): Promise<Persona | undefined> {
    return this.personaStore.getPersona(personaId);
  }

  async getPersonasByOwner(userId: string): Promise<Persona[]> {
    return this.personaStore.getPersonasByOwner(userId);
  }

  async getPersonasSharedWithUser(userId: string): Promise<Array<{ persona: Persona; permission: PersonaPermission }>> {
    return this.personaStore.getPersonasSharedWithUser(userId);
  }

  async getUserAccessiblePersonas(userId: string): Promise<{
    owned: Persona[];
    shared: Array<{ persona: Persona; permission: PersonaPermission }>;
  }> {
    return {
      owned: this.personaStore.getPersonasByOwner(userId),
      shared: this.personaStore.getPersonasSharedWithUser(userId)
    };
  }

  getUserPermissionForPersona(userId: string, personaId: string): PersonaPermission | null {
    return this.personaStore.getUserPermissionForPersona(userId, personaId);
  }

  // Alias for convenience (reversed parameter order)
  getPersonaPermission(personaId: string, userId: string): PersonaPermission | null {
    return this.getUserPermissionForPersona(userId, personaId);
  }

  async updatePersona(personaId: string, userId: string, request: UpdatePersonaRequest): Promise<Persona | null> {
    // Check permission
    const permission = this.personaStore.getUserPermissionForPersona(userId, personaId);
    if (!permission || (permission !== 'owner' && permission !== 'editor')) {
      return null;
    }

    const result = this.personaStore.updatePersona(personaId, request);
    if (!result) return null;

    const persona = this.personaStore.getPersona(personaId);
    if (persona) {
      await this.logUserEvent(persona.ownerId, result.eventData.type, result.eventData.data);
    }
    return result.persona;
  }

  async archivePersona(personaId: string, userId: string): Promise<boolean> {
    // Check permission
    const permission = this.personaStore.getUserPermissionForPersona(userId, personaId);
    if (!permission || (permission !== 'owner' && permission !== 'editor')) {
      return false;
    }

    const result = this.personaStore.archivePersona(personaId);
    if (!result) return false;

    const persona = this.personaStore.getPersona(personaId);
    if (persona) {
      await this.logUserEvent(persona.ownerId, result.eventData.type, result.eventData.data);
    }
    return true;
  }

  async deletePersona(personaId: string, userId: string): Promise<boolean> {
    const persona = this.personaStore.getPersona(personaId);
    if (!persona) return false;

    // Only owner can delete
    if (persona.ownerId !== userId) return false;

    const result = this.personaStore.deletePersona(personaId);
    if (!result) return false;

    await this.logUserEvent(userId, result.eventData.type, result.eventData.data);
    return true;
  }

  // History Branch Methods

  getPersonaHeadBranch(personaId: string): PersonaHistoryBranch | undefined {
    return this.personaStore.getHeadBranch(personaId);
  }

  getPersonaHistoryBranches(personaId: string): PersonaHistoryBranch[] {
    return this.personaStore.getHistoryBranches(personaId);
  }

  async createPersonaHistoryBranch(
    personaId: string,
    userId: string,
    request: ForkHistoryBranchRequest
  ): Promise<PersonaHistoryBranch | null> {
    // Check permission
    const permission = this.personaStore.getUserPermissionForPersona(userId, personaId);
    if (!permission || permission === 'viewer') {
      return null;
    }

    const result = this.personaStore.createHistoryBranch(
      personaId,
      request.name,
      request.forkPointParticipationId
    );
    if (!result) return null;

    const persona = this.personaStore.getPersona(personaId);
    if (persona) {
      await this.logUserEvent(persona.ownerId, result.eventData.type, result.eventData.data);
    }
    return result.branch;
  }

  async setPersonaHeadBranch(personaId: string, userId: string, branchId: string): Promise<boolean> {
    // Check permission
    const permission = this.personaStore.getUserPermissionForPersona(userId, personaId);
    if (!permission || permission === 'viewer') {
      return false;
    }

    const result = this.personaStore.setHeadBranch(personaId, branchId);
    if (!result) return false;

    const persona = this.personaStore.getPersona(personaId);
    if (persona) {
      await this.logUserEvent(persona.ownerId, result.eventData.type, result.eventData.data);
    }
    return true;
  }

  // Participation Methods

  async personaJoinConversation(
    personaId: string,
    request: PersonaJoinRequest
  ): Promise<{ participation: PersonaParticipation; participant: Participant } | null> {
    const persona = this.personaStore.getPersona(personaId);
    if (!persona) {
      return null;
    }

    // Check if persona already has an active participation (and interleaving not allowed)
    if (!persona.allowInterleavedParticipation) {
      const activeParticipation = this.personaStore.getActiveParticipation(personaId);
      if (activeParticipation) {
        throw new Error(`Persona ${persona.name} already active in another conversation`);
      }
    }

    // Get conversation to verify it exists and get owner
    const conversation = this.getConversationById(request.conversationId);
    if (!conversation) {
      return null;
    }

    // Create a participant record for the persona
    const participantName = request.participantName || persona.name;
    const participant = await this.createParticipant(
      request.conversationId,
      conversation.userId,
      participantName,
      'assistant',
      persona.modelId,
      undefined, // systemPrompt - could be set later
      undefined, // settings
      undefined  // contextManagement
    );

    // Update participant with persona link
    await this.updateParticipant(participant.id, conversation.userId, {
      personaId: personaId
    });

    // Get updated participant with persona fields
    const updatedParticipant = await this.getParticipant(participant.id, conversation.userId);
    if (!updatedParticipant) {
      return null;
    }

    // Use 'root' as the default canonical branch (main conversation branch)
    const canonicalBranchId = 'root';

    const result = this.personaStore.createParticipation(
      personaId,
      request.conversationId,
      participant.id,
      canonicalBranchId
    );
    if (!result) {
      // Clean up the participant we created
      await this.deleteParticipant(participant.id, conversation.userId);
      return null;
    }

    // Update participant with participation link
    await this.updateParticipant(participant.id, conversation.userId, {
      personaParticipationId: result.participation.id
    });

    // Get final participant state
    const finalParticipant = await this.getParticipant(participant.id, conversation.userId);

    await this.logUserEvent(persona.ownerId, result.eventData.type, result.eventData.data);

    return {
      participation: result.participation,
      participant: finalParticipant || updatedParticipant
    };
  }

  async personaLeaveConversation(personaId: string, conversationId: string): Promise<PersonaParticipation | null> {
    // Find the active participation for this persona in this conversation
    const activeParticipation = this.personaStore.getActiveParticipation(personaId);
    if (!activeParticipation || activeParticipation.conversationId !== conversationId) {
      return null;
    }

    // Compute canonical branch: find the latest message's branch ID in this conversation
    const conversation = this.getConversationById(conversationId);
    if (!conversation) return null;

    const messages = await this.getConversationMessages(conversationId, conversation.userId);
    let canonicalBranchId = 'root';

    if (messages.length > 0) {
      // Use the active branch of the last message as the canonical branch
      const lastMessage = messages[messages.length - 1];
      canonicalBranchId = lastMessage.activeBranchId;
    }

    // Set the canonical branch before ending participation
    const canonicalResult = this.personaStore.setCanonicalBranch(
      activeParticipation.id,
      canonicalBranchId
    );
    if (canonicalResult) {
      const persona = this.personaStore.getPersona(personaId);
      if (persona) {
        await this.logUserEvent(persona.ownerId, canonicalResult.eventData.type, canonicalResult.eventData.data);
      }
    }

    // Now end the participation
    const result = this.personaStore.endParticipation(activeParticipation.id);
    if (!result) return null;

    const persona = this.personaStore.getPersona(personaId);
    if (persona) {
      await this.logUserEvent(persona.ownerId, result.eventData.type, result.eventData.data);
    }
    
    // Get the updated participation after ending
    return this.personaStore.getParticipation(activeParticipation.id) || null;
  }

  getPersonaParticipation(participationId: string): PersonaParticipation | undefined {
    return this.personaStore.getParticipation(participationId);
  }

  getPersonaActiveParticipation(personaId: string): PersonaParticipation | undefined {
    return this.personaStore.getActiveParticipation(personaId);
  }

  getPersonaOrderedParticipations(branchId: string): PersonaParticipation[] {
    return this.personaStore.getOrderedParticipations(branchId);
  }

  getPersonaParticipations(personaId: string, branchId?: string): PersonaParticipation[] {
    if (branchId) {
      return this.personaStore.getParticipationsForBranch(branchId);
    }
    return this.personaStore.getParticipationsForPersona(personaId);
  }

  getPersonaParticipationsForConversation(conversationId: string): PersonaParticipation[] {
    return this.personaStore.getParticipationsForConversation(conversationId);
  }

  collectPersonaBranchParticipations(branchId: string): PersonaParticipation[] {
    return this.personaStore.collectBranchParticipations(branchId);
  }

  async setParticipationCanonicalBranch(
    participationId: string,
    userId: string,
    branchId: string
  ): Promise<boolean> {
    const participation = this.personaStore.getParticipation(participationId);
    if (!participation) return false;

    // Check permission
    const permission = this.personaStore.getUserPermissionForPersona(userId, participation.personaId);
    if (!permission || permission === 'viewer') {
      return false;
    }

    const result = this.personaStore.setCanonicalBranch(participationId, branchId);
    if (!result) return false;

    const persona = this.personaStore.getPersona(participation.personaId);
    if (persona) {
      await this.logUserEvent(persona.ownerId, result.eventData.type, result.eventData.data);
    }
    return true;
  }

  async updateParticipationLogicalTime(
    participationId: string,
    userId: string,
    logicalStart: number,
    logicalEnd: number
  ): Promise<boolean> {
    const participation = this.personaStore.getParticipation(participationId);
    if (!participation) return false;

    // Check permission
    const permission = this.personaStore.getUserPermissionForPersona(userId, participation.personaId);
    if (!permission || permission === 'viewer') {
      return false;
    }

    const result = this.personaStore.updateLogicalTime(participationId, logicalStart, logicalEnd);
    if (!result) return false;

    const persona = this.personaStore.getPersona(participation.personaId);
    if (persona) {
      await this.logUserEvent(persona.ownerId, result.eventData.type, result.eventData.data);
    }
    return true;
  }

  // Persona Share Methods

  async sharePersona(
    personaId: string,
    sharedByUserId: string,
    sharedWithUserId: string,
    permission: PersonaPermission
  ): Promise<PersonaShare | null> {
    const persona = this.personaStore.getPersona(personaId);
    if (!persona) return null;

    // Only owner can share
    if (persona.ownerId !== sharedByUserId) return null;

    const result = this.personaStore.createShare(personaId, sharedWithUserId, sharedByUserId, permission);
    if (!result) return null;

    await this.logUserEvent(sharedByUserId, result.eventData.type, result.eventData.data);
    return result.share;
  }

  async updatePersonaShare(shareId: string, userId: string, permission: PersonaPermission): Promise<PersonaShare | null> {
    const share = this.personaStore.getShare(shareId);
    if (!share) return null;

    const persona = this.personaStore.getPersona(share.personaId);
    if (!persona || persona.ownerId !== userId) return null;

    const result = this.personaStore.updateShare(shareId, permission);
    if (!result) return null;

    await this.logUserEvent(userId, result.eventData.type, result.eventData.data);
    return result.share;
  }

  async revokePersonaShare(shareId: string, userId: string): Promise<boolean> {
    const share = this.personaStore.getShare(shareId);
    if (!share) return false;

    const persona = this.personaStore.getPersona(share.personaId);
    if (!persona || persona.ownerId !== userId) return false;

    const result = this.personaStore.revokeShare(shareId);
    if (!result) return false;

    await this.logUserEvent(userId, result.eventData.type, result.eventData.data);
    return true;
  }

  getPersonaShares(personaId: string): PersonaShare[] {
    return this.personaStore.getSharesForPersona(personaId);
  }

  // Close database connection
  async close(): Promise<void> {
    await this.eventStore.close();
    await this.userEventStore.close();
    await this.conversationEventStore.close();
  }
}
