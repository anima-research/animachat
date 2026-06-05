import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStore } from './sqlite-store.js';
import { SqliteSync } from './sqlite-sync.js';

function createTestSync(): SqliteSync {
  const sync = Object.create(SqliteSync.prototype) as SqliteSync;
  (sync as any).sql = SqliteStore.memory();
  (sync as any).enabled = true;
  sync.init();
  return sync;
}

function evt(type: string, data: any, ts?: Date) {
  return { timestamp: ts || new Date(), type, data };
}

describe('SqliteSync event sync', () => {
  let s: SqliteSync;
  beforeEach(() => { s = createTestSync(); });

  it('syncs user_created', () => {
    s.syncEvent(evt('user_created', {
      user: { id: 'u1', email: 'a@b.com', name: 'Alice', createdAt: new Date('2025-01-01'), emailVerified: true, apiKeys: [] },
      passwordHash: 'hash123',
    }));
    expect((s['sql'].get('SELECT name FROM users WHERE id=?', 'u1') as any).name).toBe('Alice');
    expect((s['sql'].get('SELECT hash FROM password_hashes WHERE email=?', 'a@b.com') as any).hash).toBe('hash123');
  });

  it('syncs conversation_created', () => {
    s.syncEvent(evt('conversation_created', {
      id: 'c1', userId: 'u1', title: 'Test', model: 'claude-3', format: 'standard',
      createdAt: new Date(), updatedAt: new Date(), archived: false,
      settings: { temperature: 1.0 }, combineConsecutiveMessages: true, totalBranchCount: 0,
    }));
    expect((s['sql'].get('SELECT title FROM conversations WHERE id=?', 'c1') as any).title).toBe('Test');
  });

  it('syncs message_created with branches JSON', () => {
    s.syncEvent(evt('user_created', { user: { id: 'u1', email: 'a@b.com', name: 'A', createdAt: new Date(), apiKeys: [] } }));
    s.syncEvent(evt('conversation_created', { id: 'c1', userId: 'u1', title: 'T', model: 'x', format: 'standard', createdAt: new Date(), updatedAt: new Date(), archived: false, settings: {}, combineConsecutiveMessages: true, totalBranchCount: 0 }));
    s.syncEvent(evt('message_created', {
      id: 'm1', conversationId: 'c1', activeBranchId: 'b1',
      branches: [{ id: 'b1', content: 'hello', role: 'user', parentBranchId: 'root', isActive: true, createdAt: new Date() }],
      order: 0,
    }));
    expect(JSON.parse((s['sql'].get('SELECT branches FROM messages WHERE id=?', 'm1') as any).branches)[0].content).toBe('hello');
  });

  it('syncs branch_added', () => {
    s.syncEvent(evt('user_created', { user: { id: 'u1', email: 'a@b.com', name: 'A', createdAt: new Date(), apiKeys: [] } }));
    s.syncEvent(evt('conversation_created', { id: 'c1', userId: 'u1', title: 'T', model: 'x', format: 'standard', createdAt: new Date(), updatedAt: new Date(), archived: false, settings: {}, combineConsecutiveMessages: true, totalBranchCount: 0 }));
    s.syncEvent(evt('message_created', {
      id: 'm1', conversationId: 'c1', activeBranchId: 'b1',
      branches: [{ id: 'b1', content: 'first', role: 'user', parentBranchId: 'root', isActive: true, createdAt: new Date() }],
      order: 0,
    }));
    s.syncEvent(evt('branch_added', { messageId: 'm1', branch: { id: 'b2', content: 'second', role: 'assistant', parentBranchId: 'b1', isActive: false, createdAt: new Date(), model: 'x' } }));
    expect(JSON.parse((s['sql'].get('SELECT branches FROM messages WHERE id=?', 'm1') as any).branches)).toHaveLength(2);
  });

  it('syncs participant CRUD', () => {
    s.syncEvent(evt('participant_created', { id: 'p1', conversationId: 'c1', name: 'Bot', type: 'assistant', model: 'x', isActive: true }));
    s.syncEvent(evt('participant_updated', { participantId: 'p1', name: 'Renamed', isActive: false }));
    const p = s['sql'].get('SELECT name,is_active FROM participants WHERE id=?', 'p1') as any;
    expect(p.name).toBe('Renamed');
    expect(p.is_active).toBe(0);
    s.syncEvent(evt('participant_deleted', { participantId: 'p1' }));
    expect(s['sql'].get('SELECT * FROM participants WHERE id=?', 'p1')).toBeUndefined();
  });

  it('syncs bookmark create/delete', () => {
    s.syncEvent(evt('bookmark_created', { id: 'bk1', conversationId: 'c1', messageId: 'm1', branchId: 'b1', label: 'x', createdAt: new Date() }));
    expect((s['sql'].get('SELECT label FROM bookmarks WHERE id=?', 'bk1') as any).label).toBe('x');
    s.syncEvent(evt('bookmark_deleted', { bookmarkId: 'bk1' }));
    expect(s['sql'].get('SELECT * FROM bookmarks WHERE id=?', 'bk1')).toBeUndefined();
  });

  it('syncs metrics_added', () => {
    s.syncEvent(evt('user_created', { user: { id: 'u1', email: 'a@b.com', name: 'A', createdAt: new Date(), apiKeys: [] } }));
    s.syncEvent(evt('conversation_created', { id: 'c1', userId: 'u1', title: 'T', model: 'x', format: 'standard', createdAt: new Date(), updatedAt: new Date(), archived: false, settings: {}, combineConsecutiveMessages: true, totalBranchCount: 0 }));
    s.syncEvent(evt('metrics_added', { conversationId: 'c1', metrics: { inputTokens: 100, outputTokens: 50, cachedTokens: 20, cost: 0.001, model: 'x', timestamp: '', responseTime: 0, cacheSavings: 0 } }));
    expect((s['sql'].all('SELECT * FROM conversation_metrics WHERE conversation_id=?', 'c1') as any[])).toHaveLength(1);
  });

  it('syncs api_key create/delete', () => {
    s.syncEvent(evt('user_created', { user: { id: 'u1', email: 'a@b.com', name: 'A', createdAt: new Date(), apiKeys: [] } }));
    s.syncEvent(evt('api_key_created', { id: 'ak1', userId: 'u1', name: 'k', provider: 'anthropic', masked: 'sk-...x', createdAt: new Date() }));
    expect(s['sql'].get('SELECT * FROM api_keys WHERE id=?', 'ak1')).toBeDefined();
    s.syncEvent(evt('api_key_deleted', { apiKeyId: 'ak1' }));
    expect(s['sql'].get('SELECT * FROM api_keys WHERE id=?', 'ak1')).toBeUndefined();
  });

  it('syncs user_model CRUD', () => {
    s.syncEvent(evt('user_model_created', {
      id: 'um1', userId: 'u1', displayName: 'M', shortName: 'm', provider: 'openrouter', providerModelId: 'x',
      contextWindow: 8192, outputTokenLimit: 2048, supportsThinking: false, supportsPrefill: false,
      hidden: false, settings: { temperature: 1.0, maxTokens: 2048 }, createdAt: new Date(), updatedAt: new Date(),
    }));
    s.syncEvent(evt('user_model_updated', { id: 'um1', displayName: 'Updated', hidden: true }));
    const m = s['sql'].get('SELECT display_name,hidden FROM user_models WHERE id=?', 'um1') as any;
    expect(m.display_name).toBe('Updated');
    expect(m.hidden).toBe(1);
    s.syncEvent(evt('user_model_deleted', { id: 'um1' }));
    expect(s['sql'].get('SELECT * FROM user_models WHERE id=?', 'um1')).toBeUndefined();
  });

  it('syncs grant events', () => {
    s.syncEvent(evt('grant_capability', { id: 'gc1', userId: 'u1', action: 'granted', capability: 'admin', time: new Date().toISOString() }));
    s.syncEvent(evt('grant_burned', { userId: 'u1', amount: 10, currency: 'credit' }));
    expect((s['sql'].all('SELECT * FROM user_grant_capabilities WHERE user_id=?', 'u1') as any[])).toHaveLength(1);
    expect((s['sql'].get('SELECT amount FROM user_grant_totals WHERE user_id=? AND currency=?', 'u1', 'credit') as any).amount).toBe(-10);
  });

  it('syncs conversation_updated', () => {
    s.syncEvent(evt('conversation_created', {
      id: 'c1', userId: 'u1', title: 'Old', model: 'x', format: 'standard',
      createdAt: new Date(), updatedAt: new Date(), archived: false,
      settings: {}, combineConsecutiveMessages: true, totalBranchCount: 0,
    }));
    s.syncEvent(evt('conversation_updated', { conversationId: 'c1', title: 'New', totalBranchCount: 5 }));
    const c = s['sql'].get('SELECT title,total_branch_count FROM conversations WHERE id=?', 'c1') as any;
    expect(c.title).toBe('New');
    expect(c.total_branch_count).toBe(5);
  });

  it('syncs conversation_deleted cascading', () => {
    s.syncEvent(evt('conversation_created', {
      id: 'c1', userId: 'u1', title: 'T', model: 'x', format: 'standard',
      createdAt: new Date(), updatedAt: new Date(), archived: false,
      settings: {}, combineConsecutiveMessages: true, totalBranchCount: 0,
    }));
    s.syncEvent(evt('message_created', {
      id: 'm1', conversationId: 'c1', activeBranchId: 'b1',
      branches: [{ id: 'b1', content: 'x', role: 'user', parentBranchId: 'root', isActive: true, createdAt: new Date() }],
      order: 0,
    }));
    s.syncEvent(evt('conversation_deleted', { id: 'c1' }));
    expect(s['sql'].get('SELECT * FROM conversations WHERE id=?', 'c1')).toBeUndefined();
    expect(s['sql'].get('SELECT * FROM messages WHERE conversation_id=?', 'c1')).toBeUndefined();
  });

  it('syncs archive/unarchive', () => {
    s.syncEvent(evt('conversation_created', {
      id: 'c1', userId: 'u1', title: 'T', model: 'x', format: 'standard',
      createdAt: new Date(), updatedAt: new Date(), archived: false,
      settings: { temperature: 1.0 }, combineConsecutiveMessages: true, totalBranchCount: 0,
    }));
    s.syncEvent(evt('archived_conversation', { conversationId: 'c1' }));
    expect((s['sql'].get('SELECT archived FROM conversations WHERE id=?', 'c1') as any).archived).toBe(1);
    s.syncEvent(evt('unarchived_conversation', { conversationId: 'c1' }));
    expect((s['sql'].get('SELECT archived FROM conversations WHERE id=?', 'c1') as any).archived).toBe(0);
  });

  it('respects enabled flag', () => {
    (s as any).enabled = false;
    s.syncEvent(evt('user_created', { user: { id: 'u1', email: 'a@b.com', name: 'A', createdAt: new Date(), apiKeys: [] } }));
    expect(s['sql'].get('SELECT * FROM users WHERE id=?', 'u1')).toBeUndefined();
  });
});

describe('SqliteSync hydration and fast startup', () => {
  let s: SqliteSync;
  beforeEach(() => { s = createTestSync(); });

  it('hasData returns false on empty, true after user sync', () => {
    expect(s.hasData()).toBe(false);
    s.syncEvent(evt('user_created', { user: { id: 'u1', email: 'a@b.com', name: 'A', createdAt: new Date(), apiKeys: [] } }));
    expect(s.hasData()).toBe(true);
  });

  it('hydrateFromMaps populates SQLite', async () => {
    await s.hydrateFromMaps({
      users: new Map([['u1', { id: 'u1', email: 'a@b.com', name: 'Alice', createdAt: new Date(), apiKeys: [] }]]),
      conversations: new Map([['c1', { id: 'c1', userId: 'u1', title: 'C', model: 'x', format: 'standard', createdAt: new Date(), updatedAt: new Date(), archived: false, settings: {}, combineConsecutiveMessages: true, totalBranchCount: 0 }]]),
      passwordHashes: new Map([['a@b.com', 'hash1']]),
      messages: new Map([['m1', { id: 'm1', conversationId: 'c1', activeBranchId: 'b1', branches: [{ id: 'b1', content: 'hi', role: 'user', parentBranchId: 'root', isActive: true, createdAt: new Date() }], order: 0 }]]),
      apiKeys: new Map(),
      participants: new Map(),
      userModels: new Map(),
      bookmarks: new Map(),
      invites: new Map(),
      conversationMetrics: new Map(),
      userGrants: new Map(),
      userGrantCaps: new Map(),
      userGrantTotals: new Map(),
    });
    expect(s['sql'].get('SELECT * FROM users WHERE id=?', 'u1')).toBeDefined();
    expect(s['sql'].get('SELECT * FROM conversations WHERE id=?', 'c1')).toBeDefined();
    expect(s['sql'].get('SELECT * FROM messages WHERE id=?', 'm1')).toBeDefined();
  });

  it('loadMapsFromSqlite roundtrips through SQLite', () => {
    s.syncEvent(evt('user_created', { user: { id: 'u1', email: 'a@b.com', name: 'Alice', createdAt: new Date('2025-01-01'), apiKeys: [] }, passwordHash: 'hash1' }));
    s.syncEvent(evt('conversation_created', { id: 'c1', userId: 'u1', title: 'Conv', model: 'm1', format: 'standard', createdAt: new Date(), updatedAt: new Date(), archived: false, settings: {}, combineConsecutiveMessages: true, totalBranchCount: 3 }));
    s.syncEvent(evt('message_created', { id: 'm1', conversationId: 'c1', activeBranchId: 'b1', branches: [{ id: 'b1', content: 'hello', role: 'user', parentBranchId: 'root', isActive: true, createdAt: new Date() }], order: 0 }));
    s.syncEvent(evt('bookmark_created', { id: 'bk1', conversationId: 'c1', messageId: 'm1', branchId: 'b1', label: 'x', createdAt: new Date() }));

    const maps: any = {
      users: new Map(), usersByEmail: new Map(), conversations: new Map(),
      passwordHashes: new Map(), messages: new Map(), conversationMessages: new Map(),
      apiKeys: new Map(), participants: new Map(), conversationParticipants: new Map(),
      userModels: new Map(), userModelsByUser: new Map(), bookmarks: new Map(),
      branchBookmarks: new Map(), invites: new Map(), conversationMetrics: new Map(),
      userGrantInfos: new Map(), userGrantCapabilities: new Map(),
      userGrantTotals: new Map(), userConversations: new Map(),
    };
    s.loadMapsFromSqlite(maps);

    expect(maps.users.size).toBe(1);
    expect(maps.users.get('u1').name).toBe('Alice');
    expect(maps.passwordHashes.get('a@b.com')).toBe('hash1');
    expect(maps.conversations.get('c1').title).toBe('Conv');
    expect(maps.conversations.get('c1').totalBranchCount).toBe(3);
    expect(maps.messages.get('m1').branches[0].content).toBe('hello');
    expect(maps.conversationMessages.get('c1')).toEqual(['m1']);
    expect(maps.bookmarks.size).toBe(1);
    expect(maps.branchBookmarks.get('m1-b1')).toBe('bk1');
    expect(maps.userConversations.get('u1')!.has('c1')).toBe(true);
  });

  it('loadMapsFromSqlite handles empty DB', () => {
    const maps: any = { users: new Map(), conversations: new Map(), messages: new Map(),
      usersByEmail: new Map(), passwordHashes: new Map(), conversationMessages: new Map(),
      apiKeys: new Map(), participants: new Map(), conversationParticipants: new Map(),
      userModels: new Map(), userModelsByUser: new Map(), bookmarks: new Map(),
      branchBookmarks: new Map(), invites: new Map(), conversationMetrics: new Map(),
      userGrantInfos: new Map(), userGrantCapabilities: new Map(),
      userGrantTotals: new Map(), userConversations: new Map(),
    };
    s.loadMapsFromSqlite(maps);
    expect(maps.users.size).toBe(0);
    expect(maps.messages.size).toBe(0);
  });

  it('recordSyncTimestamps and retrieval', () => {
    s.recordSyncTimestamps('ts1', 'ts2', 'ts3');
    expect(s.getLastMainSyncTimestamp()).toBe('ts1');
    expect(s.getSyncMeta('last_conversation_event_timestamp')).toBe('ts2');
    expect(s.getSyncMeta('last_user_event_timestamp')).toBe('ts3');
  });

  it('getSyncMeta returns null for unknown key', () => {
    expect(s.getSyncMeta('nonexistent')).toBeNull();
  });
});

describe('SqliteStore', () => {
  it('lazy-open: init() creates the database, not the constructor', () => {
    const store = SqliteStore.memory();
    store.init();
    store.exec('CREATE TABLE IF NOT EXISTS _test (x INTEGER)');
    store.exec('INSERT INTO _test VALUES (1)');
    expect(store.get('SELECT x FROM _test') as any).toEqual({ x: 1 });
    store.close();
  });

  it('transaction rolls back on error', () => {
    const store = SqliteStore.memory();
    store.init();
    store.exec('CREATE TABLE IF NOT EXISTS _test (x INTEGER UNIQUE)');
    store.exec('INSERT INTO _test VALUES (1)');
    try {
      store.transaction(() => {
        store.exec('INSERT INTO _test VALUES (2)');
        store.exec('INSERT INTO _test VALUES (1)'); // duplicate, should fail
      });
    } catch {}
    // Only the first row should exist (rollback undid the INSERT of 2)
    const rows = store.all('SELECT x FROM _test ORDER BY x') as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].x).toBe(1);
    store.close();
  });

  it('checkpoint does not throw on in-memory DB', () => {
    const store = SqliteStore.memory();
    store.init();
    expect(() => store.checkpoint()).not.toThrow();
    store.close();
  });
});

describe('SqliteSync batch performance', () => {
  let s: SqliteSync;
  beforeEach(() => {
    s = new SqliteSync('./data');
    (s as any).sql = SqliteStore.memory();
    s.init();
    s.syncEvent({ timestamp: new Date(), type: 'user_created', data: { user: { id: 'u1', email: 'a@b.com', name: 'A', createdAt: new Date(), apiKeys: [] } } });
  });

  it('syncs many messages without error', () => {
    s.syncEvent({ timestamp: new Date(), type: 'conversation_created', data: { id: 'c1', userId: 'u1', title: 'T', model: 'x', format: 'standard', createdAt: new Date(), updatedAt: new Date(), archived: false, settings: {}, combineConsecutiveMessages: true, totalBranchCount: 0 } });
    for (let i = 0; i < 50; i++) {
      s.syncEvent({ timestamp: new Date(), type: 'message_created', data: { id: `m${i}`, conversationId: 'c1', activeBranchId: `b${i}`, branches: [{ id: `b${i}`, content: `msg ${i}`, role: i % 2 === 0 ? 'user' : 'assistant', parentBranchId: i === 0 ? 'root' : `b${i-1}`, isActive: true, createdAt: new Date() }], order: i } });
    }
    const count = (s['sql'].get('SELECT COUNT(*) as cnt FROM messages WHERE conversation_id=?', 'c1') as any).cnt;
    expect(count).toBe(50);
  });
});

describe('Sub-store sync', () => {
  let s: SqliteSync;
  beforeEach(() => {
    s = new SqliteSync('./data');
    (s as any).sql = SqliteStore.memory();
    s.init();
  });

  // ── Persona ──────────────────────────────────────────────────────────

  it('syncs persona_created', () => {
    s.syncEvent({ timestamp: new Date(), type: 'persona_created', data: {
      persona: {
        id: 'p1', name: 'Test Persona', modelId: 'claude-3', ownerId: 'u1',
        contextStrategy: { type: 'rolling', maxTokens: 60000 },
        backscrollTokens: 30000, allowInterleavedParticipation: false,
        createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-01'),
      },
      initialBranch: { id: 'b1', personaId: 'p1', name: 'main', isHead: true, createdAt: new Date('2025-01-01') },
    }});
    const p = s['sql'].get('SELECT name,model_id,backscroll_tokens FROM persona_personas WHERE id=?', 'p1') as any;
    expect(p.name).toBe('Test Persona');
    expect(p.backscroll_tokens).toBe(30000);
    const b = s['sql'].get('SELECT name,is_head FROM persona_history_branches WHERE id=?', 'b1') as any;
    expect(b.name).toBe('main');
    expect(b.is_head).toBe(1);
  });

  it('syncs persona_updated', () => {
    s.syncEvent({ timestamp: new Date(), type: 'persona_created', data: {
      persona: { id: 'p1', name: 'Old', modelId: 'x', ownerId: 'u1', contextStrategy: {}, backscrollTokens: 10000, allowInterleavedParticipation: false, createdAt: new Date(), updatedAt: new Date() },
      initialBranch: { id: 'b1', personaId: 'p1', name: 'main', isHead: true, createdAt: new Date() },
    }});
    s.syncEvent({ timestamp: new Date(), type: 'persona_updated', data: { personaId: 'p1', changes: { name: 'New Name', backscrollTokens: 50000 } } });
    const p = s['sql'].get('SELECT name,backscroll_tokens FROM persona_personas WHERE id=?', 'p1') as any;
    expect(p.name).toBe('New Name');
    expect(p.backscroll_tokens).toBe(50000);
  });

  it('syncs persona_archived', () => {
    s.syncEvent({ timestamp: new Date(), type: 'persona_created', data: {
      persona: { id: 'p1', name: 'P', modelId: 'x', ownerId: 'u1', contextStrategy: {}, backscrollTokens: 10000, allowInterleavedParticipation: false, createdAt: new Date(), updatedAt: new Date() },
      initialBranch: { id: 'b1', personaId: 'p1', name: 'main', isHead: true, createdAt: new Date() },
    }});
    s.syncEvent({ timestamp: new Date(), type: 'persona_archived', data: { personaId: 'p1', at: new Date('2025-06-01') } });
    const p = s['sql'].get('SELECT archived_at FROM persona_personas WHERE id=?', 'p1') as any;
    expect(p.archived_at).toBeTruthy();
  });

  it('syncs persona_deleted with cascade', () => {
    s.syncEvent({ timestamp: new Date(), type: 'persona_created', data: {
      persona: { id: 'p1', name: 'P', modelId: 'x', ownerId: 'u1', contextStrategy: {}, backscrollTokens: 10000, allowInterleavedParticipation: false, createdAt: new Date(), updatedAt: new Date() },
      initialBranch: { id: 'b1', personaId: 'p1', name: 'main', isHead: true, createdAt: new Date() },
    }});
    s.syncEvent({ timestamp: new Date(), type: 'persona_share_created', data: { share: { id: 'ps1', personaId: 'p1', sharedWithUserId: 'u2', sharedByUserId: 'u1', permission: 'viewer', createdAt: new Date() } } });
    s.syncEvent({ timestamp: new Date(), type: 'persona_deleted', data: { personaId: 'p1' } });
    expect(s['sql'].get('SELECT * FROM persona_personas WHERE id=?', 'p1')).toBeUndefined();
    expect(s['sql'].get('SELECT * FROM persona_shares WHERE persona_id=?', 'p1')).toBeUndefined();
  });

  it('syncs persona_history_branch_created and head_changed', () => {
    s.syncEvent({ timestamp: new Date(), type: 'persona_created', data: {
      persona: { id: 'p1', name: 'P', modelId: 'x', ownerId: 'u1', contextStrategy: {}, backscrollTokens: 10000, allowInterleavedParticipation: false, createdAt: new Date(), updatedAt: new Date() },
      initialBranch: { id: 'b1', personaId: 'p1', name: 'main', isHead: true, createdAt: new Date() },
    }});
    s.syncEvent({ timestamp: new Date(), type: 'persona_history_branch_created', data: { branch: { id: 'b2', personaId: 'p1', name: 'fork', parentBranchId: 'b1', isHead: false, createdAt: new Date() } } });
    s.syncEvent({ timestamp: new Date(), type: 'persona_history_branch_head_changed', data: { personaId: 'p1', newHeadBranchId: 'b2', previousHeadBranchId: 'b1' } });
    expect((s['sql'].get('SELECT is_head FROM persona_history_branches WHERE id=?', 'b1') as any).is_head).toBe(0);
    expect((s['sql'].get('SELECT is_head FROM persona_history_branches WHERE id=?', 'b2') as any).is_head).toBe(1);
  });

  it('syncs persona_participation_created and ended', () => {
    s.syncEvent({ timestamp: new Date(), type: 'persona_created', data: {
      persona: { id: 'p1', name: 'P', modelId: 'x', ownerId: 'u1', contextStrategy: {}, backscrollTokens: 10000, allowInterleavedParticipation: false, createdAt: new Date(), updatedAt: new Date() },
      initialBranch: { id: 'b1', personaId: 'p1', name: 'main', isHead: true, createdAt: new Date() },
    }});
    s.syncEvent({ timestamp: new Date(), type: 'persona_participation_created', data: { participation: {
      id: 'part1', personaId: 'p1', conversationId: 'c1', participantId: 'par1', historyBranchId: 'b1',
      joinedAt: new Date('2025-01-01'),
      logicalStart: 100, logicalEnd: 200, canonicalBranchId: 'cb1',
      canonicalHistory: [{ branchId: 'cb1', setAt: new Date('2025-01-01') }],
    }}});
    s.syncEvent({ timestamp: new Date(), type: 'persona_participation_ended', data: { participationId: 'part1', at: new Date('2025-06-01') } });
    const p = s['sql'].get('SELECT left_at,logical_start FROM persona_participations WHERE id=?', 'part1') as any;
    expect(p.logical_start).toBe(100);
    expect(p.left_at).toBeTruthy();
  });

  it('syncs persona_share CRUD', () => {
    s.syncEvent({ timestamp: new Date(), type: 'persona_share_created', data: { share: { id: 'ps1', personaId: 'p1', sharedWithUserId: 'u2', sharedByUserId: 'u1', permission: 'viewer', createdAt: new Date() } } });
    expect((s['sql'].get('SELECT permission FROM persona_shares WHERE id=?', 'ps1') as any).permission).toBe('viewer');
    s.syncEvent({ timestamp: new Date(), type: 'persona_share_updated', data: { shareId: 'ps1', permission: 'editor' } });
    expect((s['sql'].get('SELECT permission FROM persona_shares WHERE id=?', 'ps1') as any).permission).toBe('editor');
    s.syncEvent({ timestamp: new Date(), type: 'persona_share_revoked', data: { shareId: 'ps1' } });
    expect(s['sql'].get('SELECT * FROM persona_shares WHERE id=?', 'ps1')).toBeUndefined();
  });

  // ── SharesStore (public links) ────────────────────────────────────────

  it('syncs share_created', () => {
    s.syncEvent({ timestamp: new Date(), type: 'share_created', data: {
      id: 's1', conversationId: 'c1', userId: 'u1', shareToken: 'tok1',
      shareType: 'branch', branchId: 'b1', createdAt: new Date('2025-01-01'),
      viewCount: 0, settings: { allowDownload: true },
    }});
    const sh = s['sql'].get('SELECT share_token,share_type FROM shared_conversations WHERE id=?', 's1') as any;
    expect(sh.share_token).toBe('tok1');
    expect(sh.share_type).toBe('branch');
  });

  it('syncs share_deleted', () => {
    s.syncEvent({ timestamp: new Date(), type: 'share_created', data: { id: 's1', conversationId: 'c1', userId: 'u1', shareToken: 'tok1', shareType: 'tree', createdAt: new Date(), viewCount: 0, settings: {} } });
    s.syncEvent({ timestamp: new Date(), type: 'share_deleted', data: { id: 's1', shareToken: 'tok1' } });
    expect(s['sql'].get('SELECT * FROM shared_conversations WHERE id=?', 's1')).toBeUndefined();
  });

  it('syncs share_viewed', () => {
    s.syncEvent({ timestamp: new Date(), type: 'share_created', data: { id: 's1', conversationId: 'c1', userId: 'u1', shareToken: 'tok1', shareType: 'tree', createdAt: new Date(), viewCount: 0, settings: {} } });
    s.syncEvent({ timestamp: new Date(), type: 'share_viewed', data: { id: 's1', viewCount: 5 } });
    expect((s['sql'].get('SELECT view_count FROM shared_conversations WHERE id=?', 's1') as any).view_count).toBe(5);
  });

  // ── Collaboration ─────────────────────────────────────────────────────

  it('syncs collaboration_share_created/updated/revoked', () => {
    s.syncEvent({ timestamp: new Date(), type: 'collaboration_share_created', data: {
      id: 'cs1', conversationId: 'c1', sharedWithUserId: 'u2', sharedWithEmail: 'u2@test.com',
      sharedByUserId: 'u1', permission: 'viewer', createdAt: new Date().toISOString(),
    }});
    expect((s['sql'].get('SELECT permission FROM collaboration_shares WHERE id=?', 'cs1') as any).permission).toBe('viewer');
    s.syncEvent({ timestamp: new Date(), type: 'collaboration_share_updated', data: { shareId: 'cs1', permission: 'editor', time: new Date().toISOString() } });
    expect((s['sql'].get('SELECT permission FROM collaboration_shares WHERE id=?', 'cs1') as any).permission).toBe('editor');
    s.syncEvent({ timestamp: new Date(), type: 'collaboration_share_revoked', data: { shareId: 'cs1' } });
    expect(s['sql'].get('SELECT * FROM collaboration_shares WHERE id=?', 'cs1')).toBeUndefined();
  });

  it('syncs collaboration_invite_created/used/deleted', () => {
    s.syncEvent({ timestamp: new Date(), type: 'collaboration_invite_created', data: {
      id: 'ci1', conversationId: 'c1', createdByUserId: 'u1', inviteToken: 'itok1',
      permission: 'viewer', useCount: 0, createdAt: new Date().toISOString(),
    }});
    expect((s['sql'].get('SELECT invite_token FROM collaboration_invites WHERE id=?', 'ci1') as any).invite_token).toBe('itok1');
    s.syncEvent({ timestamp: new Date(), type: 'collaboration_invite_used', data: { inviteId: 'ci1', useCount: 1 } });
    expect((s['sql'].get('SELECT use_count FROM collaboration_invites WHERE id=?', 'ci1') as any).use_count).toBe(1);
    s.syncEvent({ timestamp: new Date(), type: 'collaboration_invite_deleted', data: { inviteId: 'ci1' } });
    expect(s['sql'].get('SELECT * FROM collaboration_invites WHERE id=?', 'ci1')).toBeUndefined();
  });
});

describe('Sub-store hydration roundtrip', () => {
  let s: SqliteSync;
  beforeEach(() => {
    s = new SqliteSync('./data');
    (s as any).sql = SqliteStore.memory();
    s.init();
  });

  it('syncPersonaStore and loadPersonaStore roundtrip', () => {
    // Create a fake personaStore with Maps
    const ps = {
      personas: new Map(),
      historyBranches: new Map(),
      participations: new Map(),
      shares: new Map(),
      replayEvent(e: any) {
        if (e.type === 'persona_created') {
          this.personas.set(e.data.persona.id, e.data.persona);
          this.historyBranches.set(e.data.initialBranch.id, e.data.initialBranch);
        } else if (e.type === 'persona_share_created') {
          this.shares.set(e.data.share.id, e.data.share);
        } else if (e.type === 'persona_history_branch_created') {
          this.historyBranches.set(e.data.branch.id, e.data.branch);
        }
      },
    };
    ps.personas.set('p1', { id: 'p1', name: 'Test', modelId: 'x', ownerId: 'u1', contextStrategy: {}, backscrollTokens: 10000, allowInterleavedParticipation: false, createdAt: new Date(), updatedAt: new Date() });
    ps.historyBranches.set('b1', { id: 'b1', personaId: 'p1', name: 'main', isHead: true, createdAt: new Date() });
    ps.shares.set('ps1', { id: 'ps1', personaId: 'p1', sharedWithUserId: 'u2', sharedByUserId: 'u1', permission: 'viewer', createdAt: new Date() });

    // Sync to SQLite
    s.syncPersonaStore(ps);

    // Clear Maps
    ps.personas.clear();
    ps.historyBranches.clear();
    ps.shares.clear();

    // Load from SQLite
    s.loadPersonaStore(ps);

    expect(ps.personas.size).toBe(1);
    expect(ps.personas.get('p1').name).toBe('Test');
    expect(ps.historyBranches.size).toBe(1);
    expect(ps.historyBranches.has('b1')).toBe(true);
    expect(ps.historyBranches.has('p1-branch')).toBe(false);
    expect(ps.shares.size).toBe(1);
  });

  it('syncSharesStore and loadSharesStore roundtrip', () => {
    const ss = {
      shares: new Map(),
      replayEvent(e: any) {
        if (e.type === 'share_created') this.shares.set(e.data.id, e.data);
      },
    };
    ss.shares.set('s1', { id: 's1', conversationId: 'c1', userId: 'u1', shareToken: 'tok1', shareType: 'tree', createdAt: new Date(), viewCount: 3, settings: {} });

    s.syncSharesStore(ss);
    ss.shares.clear();
    s.loadSharesStore(ss);

    expect(ss.shares.size).toBe(1);
    expect(ss.shares.get('s1').shareToken).toBe('tok1');
    expect(ss.shares.get('s1').viewCount).toBe(3);
  });

  it('syncCollaborationStore and loadCollaborationStore roundtrip', () => {
    const cs = {
      shares: new Map(),
      invites: new Map(),
      replayEvent(e: any) {
        if (e.type === 'collaboration_share_created') this.shares.set(e.data.id, e.data);
        if (e.type === 'collaboration_invite_created') this.invites.set(e.data.id, e.data);
      },
    };
    cs.shares.set('cs1', { id: 'cs1', conversationId: 'c1', sharedWithUserId: 'u2', sharedByUserId: 'u1', permission: 'editor', createdAt: new Date().toISOString() });
    cs.invites.set('ci1', { id: 'ci1', conversationId: 'c1', createdByUserId: 'u1', inviteToken: 'tok', permission: 'viewer', useCount: 2, createdAt: new Date().toISOString() });

    s.syncCollaborationStore(cs);
    cs.shares.clear();
    cs.invites.clear();
    s.loadCollaborationStore(cs);

    expect(cs.shares.size).toBe(1);
    expect(cs.invites.size).toBe(1);
    expect(cs.shares.get('cs1').permission).toBe('editor');
    expect(cs.invites.get('ci1').useCount).toBe(2);
  });
});
