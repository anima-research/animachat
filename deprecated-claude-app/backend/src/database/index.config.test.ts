import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Database, MetricsData } from './index.js';
import { GrantInfo } from '@deprecated-claude/shared';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

const TEMP_BASE = '/tmp/animachat-test-db-config';

let db: Database;
let tempDir: string;
let originalCwd: string;
let userId: string;

beforeAll(async () => {
  originalCwd = process.cwd();
  tempDir = path.join(TEMP_BASE, `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });
  process.chdir(tempDir);

  db = new Database();
  await db.init();

  const user = await db.createUser('configuser@example.com', 'pass', 'ConfigUser');
  userId = user.id;
}, 30000);

afterAll(async () => {
  await db.close();
  process.chdir(originalCwd);
  await fs.rm(tempDir, { recursive: true, force: true });
});

// Helper: create a conversation with explicit settings
async function createConv(title = 'Test Conv', ownerId = userId): Promise<string> {
  const conv = await db.createConversation(ownerId, title, 'test-model', 'System prompt', {
    temperature: 1.0,
    maxTokens: 4096,
  });
  return conv.id;
}

function makeGrant(overrides: Partial<GrantInfo> = {}): GrantInfo {
  return {
    id: uuidv4(),
    time: new Date().toISOString(),
    type: 'mint',
    amount: 100,
    toUserId: userId,
    currency: 'credit',
    reason: 'test grant',
    ...overrides,
  };
}

describe('Database — Custom model operations', () => {
  describe('createUserModel', () => {
    it('creates a user model with all fields', async () => {
      const model = await db.createUserModel(userId, {
        displayName: 'Custom GPT',
        shortName: 'CGPT',
        provider: 'openai-compatible',
        providerModelId: 'gpt-custom',
        contextWindow: 8192,
        outputTokenLimit: 2048,
        supportsThinking: false,
        settings: {
          temperature: 0.7,
          maxTokens: 1024,
        },
      });

      expect(model.id).toBeDefined();
      expect(model.userId).toBe(userId);
      expect(model.displayName).toBe('Custom GPT');
      expect(model.provider).toBe('openai-compatible');
      expect(model.hidden).toBe(false);
      expect(model.settings.maxTokens).toBe(1024); // min(1024, 2048)
      expect(model.createdAt).toBeInstanceOf(Date);
      expect(model.updatedAt).toBeInstanceOf(Date);
    });

    it('caps maxTokens at outputTokenLimit when settings are provided', async () => {
      const model = await db.createUserModel(userId, {
        displayName: 'Capped Model',
        shortName: 'CM',
        provider: 'openrouter',
        providerModelId: 'test/capped',
        contextWindow: 4096,
        outputTokenLimit: 500,
        supportsThinking: false,
        settings: {
          temperature: 1.0,
          maxTokens: 2000, // exceeds outputTokenLimit
        },
      });

      expect(model.settings.maxTokens).toBe(500); // capped to outputTokenLimit
    });

    it('uses outputTokenLimit as default maxTokens when no settings provided', async () => {
      const model = await db.createUserModel(userId, {
        displayName: 'Default Settings',
        shortName: 'DS',
        provider: 'openrouter',
        providerModelId: 'test/defaults',
        contextWindow: 4096,
        outputTokenLimit: 1234,
        supportsThinking: false,
      });

      expect(model.settings.temperature).toBe(1.0);
      expect(model.settings.maxTokens).toBe(1234);
    });

    it('sets supportsThinking and supportsPrefill defaults', async () => {
      const model = await db.createUserModel(userId, {
        displayName: 'Defaults',
        shortName: 'D',
        provider: 'openrouter',
        providerModelId: 'test/bool-defaults',
        contextWindow: 4096,
        outputTokenLimit: 2048,
        supportsThinking: true,
        supportsPrefill: true,
      });

      expect(model.supportsThinking).toBe(true);
      expect(model.supportsPrefill).toBe(true);
    });
  });

  describe('getUserModels', () => {
    it('returns models for the user excluding hidden ones', async () => {
      const models = await db.getUserModels(userId);
      expect(models.length).toBeGreaterThan(0);
      // All models should not be hidden
      for (const m of models) {
        expect(m.hidden).toBe(false);
        expect(m.userId).toBe(userId);
      }
    });

    it('returns empty array for user with no models', async () => {
      const newUser = await db.createUser('nomodels@example.com', 'pass', 'NoModels');
      const models = await db.getUserModels(newUser.id);
      expect(models).toEqual([]);
    });
  });

  describe('getUserModel', () => {
    it('returns model belonging to user', async () => {
      const created = await db.createUserModel(userId, {
        displayName: 'Get Me',
        shortName: 'GM',
        provider: 'openrouter',
        providerModelId: 'test/get-me',
        contextWindow: 4096,
        outputTokenLimit: 2048,
        supportsThinking: false,
      });

      const fetched = await db.getUserModel(created.id, userId);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.displayName).toBe('Get Me');
    });

    it('returns null for model belonging to different user', async () => {
      const otherUser = await db.createUser('othermodeluser@example.com', 'pass', 'Other');
      const created = await db.createUserModel(userId, {
        displayName: 'Not Yours',
        shortName: 'NY',
        provider: 'openrouter',
        providerModelId: 'test/not-yours',
        contextWindow: 4096,
        outputTokenLimit: 2048,
        supportsThinking: false,
      });

      const result = await db.getUserModel(created.id, otherUser.id);
      expect(result).toBeNull();
    });

    it('returns null for nonexistent model id', async () => {
      const result = await db.getUserModel('nonexistent-model-id', userId);
      expect(result).toBeNull();
    });
  });

  describe('updateUserModel', () => {
    it('updates model fields', async () => {
      const model = await db.createUserModel(userId, {
        displayName: 'Before Update',
        shortName: 'BU',
        provider: 'openrouter',
        providerModelId: 'test/update',
        contextWindow: 4096,
        outputTokenLimit: 2048,
        supportsThinking: false,
      });

      const updated = await db.updateUserModel(model.id, userId, {
        displayName: 'After Update',
        shortName: 'AU',
      });

      expect(updated).not.toBeNull();
      expect(updated!.displayName).toBe('After Update');
      expect(updated!.shortName).toBe('AU');
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(model.updatedAt.getTime());
    });

    it('returns null for nonexistent model', async () => {
      const result = await db.updateUserModel('nonexistent', userId, { displayName: 'X' });
      expect(result).toBeNull();
    });

    it('returns null when updating model belonging to other user', async () => {
      const otherUser = await db.createUser('otherupdate@example.com', 'pass', 'OU');
      const model = await db.createUserModel(userId, {
        displayName: 'Mine',
        shortName: 'M',
        provider: 'openrouter',
        providerModelId: 'test/mine-update',
        contextWindow: 4096,
        outputTokenLimit: 2048,
        supportsThinking: false,
      });

      const result = await db.updateUserModel(model.id, otherUser.id, { displayName: 'Stolen' });
      expect(result).toBeNull();
    });
  });

  describe('deleteUserModel', () => {
    it('deletes a model successfully', async () => {
      const model = await db.createUserModel(userId, {
        displayName: 'To Delete',
        shortName: 'TD',
        provider: 'openrouter',
        providerModelId: 'test/delete',
        contextWindow: 4096,
        outputTokenLimit: 2048,
        supportsThinking: false,
      });

      const deleted = await db.deleteUserModel(model.id, userId);
      expect(deleted).toBe(true);

      const fetched = await db.getUserModel(model.id, userId);
      expect(fetched).toBeNull();
    });

    it('returns false for nonexistent model', async () => {
      const result = await db.deleteUserModel('nonexistent', userId);
      expect(result).toBe(false);
    });

    it('returns false when deleting model belonging to other user', async () => {
      const otherUser = await db.createUser('otherdelete@example.com', 'pass', 'OD');
      const model = await db.createUserModel(userId, {
        displayName: 'Cant Delete',
        shortName: 'CD',
        provider: 'openrouter',
        providerModelId: 'test/cant-delete',
        contextWindow: 4096,
        outputTokenLimit: 2048,
        supportsThinking: false,
      });

      const result = await db.deleteUserModel(model.id, otherUser.id);
      expect(result).toBe(false);
    });
  });
});

describe('Database — API key operations', () => {
  describe('createApiKey', () => {
    it('creates an API key with apiKey credential and masks correctly', async () => {
      const apiKey = await db.createApiKey(userId, {
        name: 'My Key',
        provider: 'anthropic',
        credentials: { apiKey: 'sk-ant-1234567890abcdef' },
      });

      expect(apiKey.id).toBeDefined();
      expect(apiKey.userId).toBe(userId);
      expect(apiKey.name).toBe('My Key');
      expect(apiKey.provider).toBe('anthropic');
      expect(apiKey.credentials).toEqual({ apiKey: 'sk-ant-1234567890abcdef' });

      // Check user's apiKeys include the masked version
      const user = await db.getUserById(userId);
      const maskedKey = user!.apiKeys.find((k: any) => k.id === apiKey.id);
      expect(maskedKey).toBeDefined();
      expect(maskedKey!.masked).toBe('****cdef');
    });

    it('creates an API key with accessKeyId credential and masks correctly', async () => {
      const apiKey = await db.createApiKey(userId, {
        name: 'AWS Key',
        provider: 'bedrock',
        credentials: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'secret', region: 'us-east-1' },
      });

      const user = await db.getUserById(userId);
      const maskedKey = user!.apiKeys.find((k: any) => k.id === apiKey.id);
      expect(maskedKey).toBeDefined();
      expect(maskedKey!.masked).toBe('****MPLE');
    });
  });

  describe('getApiKey', () => {
    it('returns the API key by id', async () => {
      const created = await db.createApiKey(userId, {
        name: 'Get Key',
        provider: 'openrouter',
        credentials: { apiKey: 'or-test-key-1234' },
      });

      const fetched = await db.getApiKey(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
    });

    it('returns null for nonexistent key', async () => {
      const result = await db.getApiKey('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getUserApiKeys', () => {
    it('returns all keys for a user', async () => {
      const keys = await db.getUserApiKeys(userId);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key.userId).toBe(userId);
      }
    });
  });

  describe('deleteApiKey', () => {
    it('deletes an API key', async () => {
      const key = await db.createApiKey(userId, {
        name: 'To Delete',
        provider: 'anthropic',
        credentials: { apiKey: 'sk-delete-me-1234' },
      });

      const deleted = await db.deleteApiKey(key.id);
      expect(deleted).toBe(true);

      const fetched = await db.getApiKey(key.id);
      expect(fetched).toBeNull();
    });

    it('returns false for nonexistent key', async () => {
      const result = await db.deleteApiKey('nonexistent');
      expect(result).toBe(false);
    });
  });
});

describe('Database — Admin stats operations', () => {
  describe('getAllUsersWithStats', () => {
    it('returns user stats with conversation counts and capabilities', async () => {
      // Create a conversation for our user
      await createConv('Stats test');

      const stats = await db.getAllUsersWithStats();
      expect(stats.length).toBeGreaterThan(0);

      const ourUser = stats.find(s => s.id === userId);
      expect(ourUser).toBeDefined();
      expect(ourUser!.email).toBe('configuser@example.com');
      expect(ourUser!.name).toBe('ConfigUser');
      expect(ourUser!.conversationCount).toBeGreaterThanOrEqual(1);
      expect(ourUser!.createdAt).toBeInstanceOf(Date);
      expect(typeof ourUser!.balances).toBe('object');
      expect(Array.isArray(ourUser!.capabilities)).toBe(true);
    });

    it('includes lastActive based on conversation activity', async () => {
      const stats = await db.getAllUsersWithStats();
      const ourUser = stats.find(s => s.id === userId);
      // We created a conversation, so lastActive should be defined
      expect(ourUser!.lastActive).toBeDefined();
    });

    it('user with admin capability shows admin in capabilities', async () => {
      const adminUser = await db.createUser('statsadmin@example.com', 'pass', 'StatsAdmin');
      await db.recordGrantCapability({
        id: uuidv4(),
        time: new Date().toISOString(),
        userId: adminUser.id,
        action: 'granted',
        capability: 'admin',
        grantedByUserId: userId,
      });

      const stats = await db.getAllUsersWithStats();
      const admin = stats.find(s => s.id === adminUser.id);
      expect(admin!.capabilities).toContain('admin');
    });
  });

  describe('getUserStats', () => {
    it('returns conversation and message counts', async () => {
      const user = await db.createUser('userstats@example.com', 'pass', 'UserStats');
      const convId = await createConv('User stats test', user.id);
      await db.createMessage(convId, user.id, 'Hello', 'user');

      const stats = await db.getUserStats(user.id);
      expect(stats.conversationCount).toBeGreaterThanOrEqual(1);
      expect(stats.messageCount).toBeGreaterThanOrEqual(1);
    });

    it('returns undefined lastActive for user with no conversations', async () => {
      const user = await db.createUser('nostats@example.com', 'pass', 'NoStats');
      const stats = await db.getUserStats(user.id);
      expect(stats.conversationCount).toBe(0);
      expect(stats.lastActive).toBeUndefined();
    });
  });

  describe('getSystemStats', () => {
    it('returns total users, conversations, and active users', async () => {
      const stats = await db.getSystemStats();
      expect(stats.totalUsers).toBeGreaterThan(0);
      expect(stats.totalConversations).toBeGreaterThanOrEqual(0);
      expect(typeof stats.activeUsersLast7Days).toBe('number');
    });
  });

  describe('invalidateUserCache', () => {
    it('unloads and reloads user data from disk', async () => {
      const user = await db.createUser('cache@example.com', 'pass', 'Cache');
      const convId = await createConv('Cache test', user.id);
      await db.createMessage(convId, user.id, 'Before invalidate', 'user');

      // Invalidate and reload
      await db.invalidateUserCache(user.id);

      // Data should still be accessible
      const conv = await db.getConversation(convId, user.id);
      expect(conv).not.toBeNull();
      expect(conv!.title).toBe('Cache test');
    });
  });
});

describe('Database — Conversation operations', () => {
  describe('createConversation', () => {
    it('creates with standard format (default) and two default participants', async () => {
      const conv = await db.createConversation(userId, 'Standard', 'test-model', 'prompt', {
        temperature: 1.0,
        maxTokens: 4096,
      });

      expect(conv.id).toBeDefined();
      expect(conv.format).toBe('standard');
      expect(conv.userId).toBe(userId);
      expect(conv.title).toBe('Standard');
      expect(conv.archived).toBe(false);

      const participants = await db.getConversationParticipants(conv.id, userId);
      expect(participants.length).toBe(2);
      const userP = participants.find(p => p.type === 'user');
      const assistantP = participants.find(p => p.type === 'assistant');
      expect(userP).toBeDefined();
      expect(assistantP).toBeDefined();
      expect(assistantP!.name).toBe('A'); // Standard format uses "A" for assistant
    });

    it('creates with prefill format', async () => {
      const conv = await db.createConversation(userId, 'Prefill', 'test-model', 'prompt', {
        temperature: 1.0,
        maxTokens: 4096,
      }, 'prefill');

      expect(conv.format).toBe('prefill');
    });

    it('defaults title to New Conversation when empty string', async () => {
      const conv = await db.createConversation(userId, '', 'test-model', undefined, {
        temperature: 1.0,
        maxTokens: 4096,
      });
      expect(conv.title).toBe('New Conversation');
    });
  });

  describe('getConversation', () => {
    it('returns conversation for owner', async () => {
      const convId = await createConv('Get Conv');
      const conv = await db.getConversation(convId, userId);
      expect(conv).not.toBeNull();
      expect(conv!.title).toBe('Get Conv');
    });

    it('returns null for non-owner without share', async () => {
      const convId = await createConv('Private');
      const stranger = await db.createUser('stranger@example.com', 'pass', 'Stranger');
      const conv = await db.getConversation(convId, stranger.id);
      expect(conv).toBeNull();
    });
  });

  describe('getUserConversations', () => {
    it('returns non-archived conversations sorted by updatedAt desc', async () => {
      const user = await db.createUser('convlist@example.com', 'pass', 'ConvList');
      const conv1Id = (await db.createConversation(user.id, 'First', 'test-model', undefined, {
        temperature: 1.0,
        maxTokens: 4096,
      })).id;

      // Create second conversation (newer)
      const conv2Id = (await db.createConversation(user.id, 'Second', 'test-model', undefined, {
        temperature: 1.0,
        maxTokens: 4096,
      })).id;

      const convs = await db.getUserConversations(user.id);
      expect(convs.length).toBe(2);
      // Most recently updated should be first
      expect(convs[0].id).toBe(conv2Id);
    });

    it('excludes archived conversations', async () => {
      const user = await db.createUser('archive-filter@example.com', 'pass', 'AF');
      const conv = await db.createConversation(user.id, 'Archived', 'test-model', undefined, {
        temperature: 1.0,
        maxTokens: 4096,
      });
      await db.archiveConversation(conv.id, user.id);

      const convs = await db.getUserConversations(user.id);
      const found = convs.find(c => c.id === conv.id);
      expect(found).toBeUndefined();
    });
  });

  describe('updateConversation', () => {
    it('updates conversation fields', async () => {
      const convId = await createConv('Before Update');
      const updated = await db.updateConversation(convId, userId, { title: 'After Update' });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('After Update');
    });

    it('returns null for nonexistent conversation', async () => {
      const result = await db.updateConversation('nonexistent', userId, { title: 'X' });
      expect(result).toBeNull();
    });

    it('updates assistant participant model when changing model on standard conversation', async () => {
      const conv = await db.createConversation(userId, 'Model Change', 'model-a', 'prompt', {
        temperature: 1.0,
        maxTokens: 4096,
      });

      await db.updateConversation(conv.id, userId, { model: 'model-b' });

      const participants = await db.getConversationParticipants(conv.id, userId);
      const assistant = participants.find(p => p.type === 'assistant');
      expect(assistant!.model).toBe('model-b');
    });
  });

  describe('archiveConversation', () => {
    it('archives a conversation', async () => {
      const convId = await createConv('To Archive');
      const result = await db.archiveConversation(convId, userId);
      expect(result).toBe(true);

      const conv = await db.getConversation(convId, userId);
      expect(conv!.archived).toBe(true);
    });

    it('returns false for nonexistent conversation', async () => {
      const result = await db.archiveConversation('nonexistent', userId);
      expect(result).toBe(false);
    });
  });

  describe('duplicateConversation', () => {
    it('duplicates a conversation with default options', async () => {
      const original = await db.createConversation(userId, 'Original', 'test-model', 'sys prompt', {
        temperature: 0.5,
        maxTokens: 2048,
      });
      await db.createMessage(original.id, userId, 'Hello', 'user');
      await db.createMessage(original.id, userId, 'Hi there', 'assistant');

      const dup = await db.duplicateConversation(original.id, userId, userId);

      expect(dup).not.toBeNull();
      expect(dup!.title).toBe('Original (Copy)');
      expect(dup!.model).toBe('test-model');
      expect(dup!.systemPrompt).toBe('sys prompt');
      expect(dup!.id).not.toBe(original.id);
    });

    it('duplicates with custom title', async () => {
      const original = await db.createConversation(userId, 'Orig', 'test-model', undefined, {
        temperature: 1.0,
        maxTokens: 4096,
      });

      const dup = await db.duplicateConversation(original.id, userId, userId, {
        newTitle: 'My Fork',
      });

      expect(dup!.title).toBe('My Fork');
    });

    it('duplicates with includeSystemPrompt=false omits system prompt', async () => {
      const original = await db.createConversation(userId, 'With Prompt', 'test-model', 'Important prompt', {
        temperature: 1.0,
        maxTokens: 4096,
      });

      const dup = await db.duplicateConversation(original.id, userId, userId, {
        includeSystemPrompt: false,
      });

      expect(dup!.systemPrompt).toBeUndefined();
    });

    it('returns null for nonexistent conversation', async () => {
      const result = await db.duplicateConversation('nonexistent', userId, userId);
      expect(result).toBeNull();
    });
  });

  describe('exportConversation', () => {
    it('exports conversation with messages and participants', async () => {
      const convId = await createConv('Export Me');
      await db.createMessage(convId, userId, 'Export msg', 'user');

      const exported = await db.exportConversation(convId, userId);

      expect(exported).not.toBeNull();
      expect(exported.conversation.title).toBe('Export Me');
      expect(exported.messages.length).toBeGreaterThan(0);
      expect(exported.participants.length).toBeGreaterThan(0);
      expect(exported.version).toBe('1.0');
      expect(exported.exportedAt).toBeDefined();
    });

    it('returns null for nonexistent conversation', async () => {
      const result = await db.exportConversation('nonexistent', userId);
      expect(result).toBeNull();
    });
  });

  describe('getConversationById (internal)', () => {
    it('returns conversation without access check', async () => {
      const convId = await createConv('Internal Get');
      const conv = db.getConversationById(convId);
      expect(conv).not.toBeNull();
      expect(conv!.title).toBe('Internal Get');
    });

    it('returns null for nonexistent', () => {
      const result = db.getConversationById('nonexistent');
      expect(result).toBeNull();
    });
  });
});

describe('Database — Bookmark operations', () => {
  let bookmarkConvId: string;
  let bookmarkMsgId: string;
  let bookmarkBranchId: string;

  beforeAll(async () => {
    bookmarkConvId = await createConv('Bookmark Conv');
    const msg = await db.createMessage(bookmarkConvId, userId, 'Bookmark target', 'user');
    bookmarkMsgId = msg.id;
    bookmarkBranchId = msg.branches[0].id;
  });

  it('creates a new bookmark', async () => {
    const bookmark = await db.createOrUpdateBookmark(
      bookmarkConvId, bookmarkMsgId, bookmarkBranchId, 'Important'
    );

    expect(bookmark.id).toBeDefined();
    expect(bookmark.label).toBe('Important');
    expect(bookmark.conversationId).toBe(bookmarkConvId);
    expect(bookmark.messageId).toBe(bookmarkMsgId);
    expect(bookmark.branchId).toBe(bookmarkBranchId);
    expect(bookmark.createdAt).toBeInstanceOf(Date);
  });

  it('updates existing bookmark label', async () => {
    const updated = await db.createOrUpdateBookmark(
      bookmarkConvId, bookmarkMsgId, bookmarkBranchId, 'Updated Label'
    );

    expect(updated.label).toBe('Updated Label');
  });

  it('getBookmarkForBranch returns the bookmark', async () => {
    const bookmark = await db.getBookmarkForBranch(bookmarkMsgId, bookmarkBranchId);
    expect(bookmark).not.toBeNull();
    expect(bookmark!.label).toBe('Updated Label');
  });

  it('getBookmarkForBranch returns null for nonexistent', async () => {
    const bookmark = await db.getBookmarkForBranch('nonexistent', 'nonexistent');
    expect(bookmark).toBeNull();
  });

  it('getConversationBookmarks returns all bookmarks for conversation', async () => {
    const bookmarks = await db.getConversationBookmarks(bookmarkConvId);
    expect(bookmarks.length).toBeGreaterThanOrEqual(1);
    expect(bookmarks.some(b => b.messageId === bookmarkMsgId)).toBe(true);
  });

  it('deleteBookmark removes the bookmark', async () => {
    const deleted = await db.deleteBookmark(bookmarkMsgId, bookmarkBranchId);
    expect(deleted).toBe(true);

    const bookmark = await db.getBookmarkForBranch(bookmarkMsgId, bookmarkBranchId);
    expect(bookmark).toBeNull();
  });

  it('deleteBookmark returns false for nonexistent', async () => {
    const result = await db.deleteBookmark('nonexistent', 'nonexistent');
    expect(result).toBe(false);
  });
});

describe('Database — Metrics operations', () => {
  describe('addMetrics + getConversationMetrics', () => {
    it('adds and retrieves metrics for a conversation', async () => {
      const convId = await createConv('Metrics Conv');

      const metrics: MetricsData = {
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 20,
        cost: 0.01,
        cacheSavings: 0.002,
        model: 'test-model',
        timestamp: new Date().toISOString(),
        responseTime: 1500,
      };

      await db.addMetrics(convId, userId, metrics);

      const retrieved = await db.getConversationMetrics(convId, userId);
      expect(retrieved.length).toBeGreaterThanOrEqual(1);
      const last = retrieved[retrieved.length - 1];
      expect(last.inputTokens).toBe(100);
      expect(last.outputTokens).toBe(50);
      expect(last.model).toBe('test-model');
    });

    it('sanitizes NaN values in metrics', async () => {
      const convId = await createConv('NaN Metrics');

      const metrics: MetricsData = {
        inputTokens: NaN,
        outputTokens: undefined as any,
        cachedTokens: Infinity,
        cost: 'not-a-number' as any,
        cacheSavings: 0.002,
        model: 'test-model',
        timestamp: new Date().toISOString(),
        responseTime: NaN,
      };

      await db.addMetrics(convId, userId, metrics);

      const retrieved = await db.getConversationMetrics(convId, userId);
      const last = retrieved[retrieved.length - 1];
      expect(last.inputTokens).toBe(0);
      expect(last.outputTokens).toBe(0);
      expect(last.cachedTokens).toBe(0);
      expect(last.cost).toBe(0);
      expect(last.responseTime).toBe(0);
    });

    it('returns empty array for nonexistent conversation', async () => {
      const result = await db.getConversationMetrics('nonexistent', userId);
      expect(result).toEqual([]);
    });
  });

  describe('getConversationMetricsSummary', () => {
    it('returns summary with totals and per-model breakdown', async () => {
      const convId = await createConv('Summary Conv');

      await db.addMetrics(convId, userId, {
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 10,
        cost: 0.01,
        cacheSavings: 0.001,
        model: 'test-model',
        timestamp: new Date().toISOString(),
        responseTime: 1000,
      });

      await db.addMetrics(convId, userId, {
        inputTokens: 200,
        outputTokens: 100,
        cachedTokens: 30,
        cost: 0.02,
        cacheSavings: 0.003,
        model: 'test-model',
        timestamp: new Date().toISOString(),
        responseTime: 2000,
      });

      const summary = await db.getConversationMetricsSummary(convId, userId);
      expect(summary).not.toBeNull();
      expect(summary!.totals.inputTokens).toBe(300);
      expect(summary!.totals.outputTokens).toBe(150);
      expect(summary!.totals.cachedTokens).toBe(40);
      expect(summary!.totals.completionCount).toBe(2);
      expect(summary!.messageCount).toBeGreaterThanOrEqual(0);
      expect(summary!.totalTreeTokens).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('Database — Usage stats operations', () => {
  describe('getUserUsageStats', () => {
    it('returns usage stats aggregated from burn grants and metrics', async () => {
      const user = await db.createUser('usage@example.com', 'pass', 'Usage');

      // Record a burn grant with details
      await db.recordGrantInfo({
        id: uuidv4(),
        time: new Date().toISOString(),
        type: 'burn',
        amount: 0.05,
        fromUserId: user.id,
        currency: 'credit',
        reason: 'Model usage (test-model)',
        details: {
          input: { price: 0.01, tokens: 100, credits: 0.01 },
          output: { price: 0.03, tokens: 50, credits: 0.03 },
          cached_input: { price: 0.005, tokens: 20, credits: 0.005 },
        },
      });

      const stats = await db.getUserUsageStats(user.id);
      expect(stats.daily.length).toBeGreaterThanOrEqual(1);
      expect(stats.totals.requests).toBeGreaterThanOrEqual(1);
      expect(stats.totals.inputTokens).toBeGreaterThanOrEqual(100);
      expect(stats.totals.outputTokens).toBeGreaterThanOrEqual(50);
      expect(stats.totals.cachedTokens).toBeGreaterThanOrEqual(20);
      expect(stats.byModel).toBeDefined();
      expect(stats.byModel['test-model']).toBeDefined();
    });
  });

  describe('getSystemUsageStats', () => {
    it('aggregates usage across all users', async () => {
      const stats = await db.getSystemUsageStats();
      expect(stats.daily).toBeDefined();
      expect(stats.totals).toBeDefined();
      expect(stats.byModel).toBeDefined();
    });
  });

  describe('getModelUsageStats', () => {
    it('aggregates usage for a specific model', async () => {
      const stats = await db.getModelUsageStats('test-model');
      expect(stats.daily).toBeDefined();
      expect(stats.totals).toBeDefined();
    });
  });
});

describe('Database — Collaboration invite operations', () => {
  let convOwner: { id: string };
  let claimUser: { id: string };
  let inviteConvId: string;

  beforeAll(async () => {
    convOwner = await db.createUser('inviteowner@example.com', 'pass', 'InvOwner');
    claimUser = await db.createUser('inviteclaimer@example.com', 'pass', 'InvClaimer');
    inviteConvId = (await db.createConversation(convOwner.id, 'Invite Conv', 'test-model', undefined, {
      temperature: 1.0,
      maxTokens: 4096,
    })).id;
  });

  it('creates a collaboration invite', async () => {
    const invite = await db.createCollaborationInvite(inviteConvId, convOwner.id, 'collaborator');
    expect(invite).toBeDefined();
    expect(invite.conversationId).toBe(inviteConvId);
    expect(invite.permission).toBe('collaborator');
    expect(invite.inviteToken).toBeDefined();
  });

  it('claims a collaboration invite gives access', async () => {
    const invite = await db.createCollaborationInvite(inviteConvId, convOwner.id, 'editor');
    const result = await db.claimCollaborationInvite(invite.inviteToken, claimUser.id);

    expect(result.success).toBe(true);
    expect(result.conversationId).toBe(inviteConvId);
    expect(result.permission).toBe('editor');

    // User should now have access
    const access = await db.canUserAccessConversation(inviteConvId, claimUser.id);
    expect(access.canAccess).toBe(true);
  });

  it('claiming own invite fails (owner already has access)', async () => {
    const invite = await db.createCollaborationInvite(inviteConvId, convOwner.id, 'viewer');
    const result = await db.claimCollaborationInvite(invite.inviteToken, convOwner.id);
    expect(result.success).toBe(false);
    // Owner already has access, so it hits that check first
    expect(result.error).toContain('already have access');
  });

  it('claiming with existing access fails', async () => {
    // claimUser already has access from previous test
    const invite = await db.createCollaborationInvite(inviteConvId, convOwner.id, 'viewer');
    const result = await db.claimCollaborationInvite(invite.inviteToken, claimUser.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain('already have access');
  });

  it('claiming nonexistent token fails', async () => {
    const result = await db.claimCollaborationInvite('nonexistent-token', claimUser.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('getCollaborationInviteByToken returns the invite', async () => {
    const invite = await db.createCollaborationInvite(inviteConvId, convOwner.id, 'viewer');
    const fetched = await db.getCollaborationInviteByToken(invite.inviteToken);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(invite.id);
  });

  it('getCollaborationInvitesForConversation returns all invites', async () => {
    const invites = await db.getCollaborationInvitesForConversation(inviteConvId);
    expect(invites.length).toBeGreaterThan(0);
  });

  it('deleteCollaborationInvite removes the invite', async () => {
    const invite = await db.createCollaborationInvite(inviteConvId, convOwner.id, 'viewer');
    const deleted = await db.deleteCollaborationInvite(invite.id, convOwner.id);
    expect(deleted).toBe(true);
  });
});

describe('Database — Participant operations', () => {
  it('getConversationParticipants returns all participants', async () => {
    const convId = await createConv('Participant Test');
    const participants = await db.getConversationParticipants(convId, userId);
    expect(participants.length).toBe(2); // user + assistant
    expect(participants.some(p => p.type === 'user')).toBe(true);
    expect(participants.some(p => p.type === 'assistant')).toBe(true);
  });

  it('updateParticipant updates fields', async () => {
    const convId = await createConv('Update Participant');
    const participants = await db.getConversationParticipants(convId, userId);
    const assistant = participants.find(p => p.type === 'assistant')!;

    const updated = await db.updateParticipant(assistant.id, userId, { name: 'NewName' });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('NewName');
  });

  it('deleteParticipant removes a participant', async () => {
    const convId = await createConv('Delete Participant');
    const participants = await db.getConversationParticipants(convId, userId);
    const participant = participants[0];

    const deleted = await db.deleteParticipant(participant.id, userId);
    expect(deleted).toBe(true);

    const afterDelete = await db.getConversationParticipants(convId, userId);
    expect(afterDelete.find(p => p.id === participant.id)).toBeUndefined();
  });

  it('deleteParticipant returns false for nonexistent', async () => {
    const result = await db.deleteParticipant('nonexistent', userId);
    expect(result).toBe(false);
  });
});

describe('Database — Misc operations', () => {
  describe('getConversationPublicInfo', () => {
    it('returns title for existing conversation', async () => {
      const convId = await createConv('Public Info');
      const info = await db.getConversationPublicInfo(convId);
      expect(info).not.toBeNull();
      expect(info!.title).toBe('Public Info');
    });

    it('returns null for nonexistent conversation', async () => {
      const info = await db.getConversationPublicInfo('nonexistent');
      expect(info).toBeNull();
    });
  });

  describe('getUserDisplayName', () => {
    it('returns user name when user exists', async () => {
      const name = await db.getUserDisplayName(userId);
      expect(name).toBe('ConfigUser');
    });

    it('returns Unknown User for nonexistent user', async () => {
      const name = await db.getUserDisplayName('nonexistent');
      expect(name).toBe('Unknown User');
    });
  });

  describe('ensureConversationLoaded', () => {
    it('loads a conversation without error', async () => {
      const convId = await createConv('Ensure Loaded');
      await db.ensureConversationLoaded(convId, userId);
      const conv = await db.getConversation(convId, userId);
      expect(conv).not.toBeNull();
    });
  });

  describe('getConversationMessagesAdmin', () => {
    it('returns messages without requiring owner id', async () => {
      const convId = await createConv('Admin Messages');
      await db.createMessage(convId, userId, 'Admin visible', 'user');

      const messages = await db.getConversationMessagesAdmin(convId);
      expect(messages.length).toBeGreaterThan(0);
    });

    it('returns empty array for nonexistent conversation', async () => {
      const messages = await db.getConversationMessagesAdmin('nonexistent');
      expect(messages).toEqual([]);
    });
  });

  describe('getConversationEvents', () => {
    it('returns enriched event history', async () => {
      const convId = await createConv('Events Conv');
      await db.createMessage(convId, userId, 'Event test', 'user');
      await db.createMessage(convId, userId, 'Reply', 'assistant');

      const events = await db.getConversationEvents(convId, userId);
      expect(events.length).toBeGreaterThan(0);
      // Should include message_created events
      const msgCreated = events.filter((e: any) => e.type === 'message_created');
      expect(msgCreated.length).toBeGreaterThan(0);
    });
  });

  describe('restoreMessage', () => {
    it('restores a deleted message', async () => {
      const convId = await createConv('Restore Conv');
      const msg = await db.createMessage(convId, userId, 'To restore', 'user');

      // Delete and restore
      await db.deleteMessage(msg.id, convId, userId);
      const restored = await db.restoreMessage(convId, userId, {
        id: msg.id,
        conversationId: convId,
        branches: msg.branches,
        activeBranchId: msg.activeBranchId,
        order: msg.order,
      });

      expect(restored).toBeDefined();
      expect(restored.id).toBe(msg.id);
    });
  });

  describe('splitMessage', () => {
    it('splits a message at a valid position', async () => {
      const convId = await createConv('Split Conv');
      const msg = await db.createMessage(convId, userId, 'First part. Second part.', 'user');
      const branchId = msg.branches[0].id;

      const result = await db.splitMessage(convId, userId, msg.id, branchId, 12);

      expect(result).not.toBeNull();
      expect(result!.originalMessage.branches[0].content).toBe('First part.');
      expect(result!.newMessage.branches[0].content).toBe('Second part.');
    });

    it('returns null for nonexistent message', async () => {
      const convId = await createConv('Split None');
      const result = await db.splitMessage(convId, userId, 'nonexistent', 'branch', 5);
      expect(result).toBeNull();
    });

    it('returns null for nonexistent branch', async () => {
      const convId = await createConv('Split No Branch');
      const msg = await db.createMessage(convId, userId, 'Content', 'user');
      const result = await db.splitMessage(convId, userId, msg.id, 'nonexistent', 3);
      expect(result).toBeNull();
    });

    it('returns null for invalid split position (0)', async () => {
      const convId = await createConv('Split Zero');
      const msg = await db.createMessage(convId, userId, 'Content', 'user');
      const result = await db.splitMessage(convId, userId, msg.id, msg.branches[0].id, 0);
      expect(result).toBeNull();
    });

    it('returns null for split position at end', async () => {
      const convId = await createConv('Split End');
      const msg = await db.createMessage(convId, userId, 'Content', 'user');
      const result = await db.splitMessage(convId, userId, msg.id, msg.branches[0].id, 7); // length of 'Content'
      expect(result).toBeNull();
    });
  });

  describe('grant edge cases', () => {
    it('send to self results in zero delta (no change)', async () => {
      const user = await db.createUser('selfSend@example.com', 'pass', 'SelfSend');
      await db.recordGrantInfo(makeGrant({ amount: 100, toUserId: user.id, currency: 'credit' }));

      await db.recordGrantInfo({
        id: uuidv4(),
        time: new Date().toISOString(),
        type: 'send',
        amount: 50,
        fromUserId: user.id,
        toUserId: user.id, // self send
        currency: 'credit',
      });

      // Self-send: both +50 and -50 should cancel out
      const summary = await db.getUserGrantSummary(user.id);
      expect(summary.totals['credit']).toBe(100); // unchanged
    });

    it('tally with fromUserId adds to balance', async () => {
      const user = await db.createUser('tallyFrom@example.com', 'pass', 'TallyFrom');
      await db.recordGrantInfo({
        id: uuidv4(),
        time: new Date().toISOString(),
        type: 'tally',
        amount: 25,
        fromUserId: user.id,
        currency: 'credit',
      });

      const summary = await db.getUserGrantSummary(user.id);
      expect(summary.totals['credit']).toBe(25);
    });
  });
});
