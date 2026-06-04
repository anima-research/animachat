/**
 * SQLite sync layer for the Database.
 *
 * Runs alongside the existing in-memory Maps and JSONL event logs.
 * On startup: hydrates SQLite from Maps after JSONL replay completes.
 * On every mutation: mirrors events to SQLite so the DB stays in sync.
 *
 * JSONL remains the canonical source of truth for disaster recovery.
 * SQLite provides crash durability (survives restarts without full replay).
 */

import { EventStore, Event } from './persistence.js';
import { SqliteStore } from './sqlite-store.js';

// ── Helpers ────────────────────────────────────────────────────────────

function toISO(d: any): string {
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

function bv(v: any): number { return v ? 1 : 0; }

// ── SqliteSync ─────────────────────────────────────────────────────────

export class SqliteSync {
  private sql: SqliteStore;
  private enabled: boolean;

  constructor(dataDir: string = './data') {
    this.sql = new SqliteStore(dataDir);
    this.enabled = true;
  }

  init(): void {
    this.sql.init();
  }

  // ═══ Hydrate from Maps (called after JSONL replay) ════════════════

  async hydrateFromMaps(opts: {
    users: Map<string, any>;
    conversations: Map<string, any>;
    passwordHashes: Map<string, string>;
    messages: Map<string, any>;
    apiKeys: Map<string, any>;
    participants: Map<string, any>;
    userModels: Map<string, any>;
    bookmarks: Map<string, any>;
    invites: Map<string, any>;
    conversationMetrics: Map<string, any[]>;
    userGrants: Map<string, any[]>;
    userGrantCaps: Map<string, any[]>;
    userGrantTotals: Map<string, Map<string, number>>;
  }): Promise<void> {
    console.log('[SqliteSync] Hydrating SQLite from Maps...');

    this.sql.exec('BEGIN');
    try {
    const { users, conversations, passwordHashes, messages, apiKeys,
      participants, userModels, bookmarks, invites,
      conversationMetrics, userGrants, userGrantCaps, userGrantTotals } = opts;

    for (const [, user] of users) {
      this.sql.exec(
        `INSERT OR REPLACE INTO users (id, email, name, created_at, email_verified, email_verified_at, age_verified, age_verified_at, tos_accepted, tos_accepted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        user.id, user.email, user.name, toISO(user.createdAt),
        bv(user.emailVerified), toISO(user.emailVerifiedAt),
        bv(user.ageVerified), toISO(user.ageVerifiedAt),
        bv(user.tosAccepted), toISO(user.tosAcceptedAt));
      const hash = passwordHashes.get(user.email);
      if (hash) this.sql.exec('INSERT OR REPLACE INTO password_hashes (email, hash) VALUES (?,?)', user.email, hash);
    }

    for (const [, conv] of conversations) {
      this.sql.exec(
        `INSERT OR REPLACE INTO conversations
           (id, user_id, title, model, system_prompt, format, created_at, updated_at,
            archived, settings, context_management, prefill_user_message,
            cli_mode_prompt, combine_consecutive_messages, total_branch_count)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        conv.id, conv.userId, conv.title, conv.model, conv.systemPrompt || null,
        conv.format || 'standard', toISO(conv.createdAt), toISO(conv.updatedAt),
        bv(conv.archived), JSON.stringify(conv.settings),
        conv.contextManagement ? JSON.stringify(conv.contextManagement) : null,
        conv.prefillUserMessage ? JSON.stringify(conv.prefillUserMessage) : null,
        conv.cliModePrompt ? JSON.stringify(conv.cliModePrompt) : null,
        bv(conv.combineConsecutiveMessages ?? true), conv.totalBranchCount ?? 0);
    }

    for (const [, msg] of messages) {
      const branches = (msg.branches || []).map((b: any) =>
        ({ ...b, createdAt: toISO(b.createdAt || new Date()) }));
      this.sql.exec(
        'INSERT OR REPLACE INTO messages (id, conversation_id, active_branch_id, branches, msg_order) VALUES (?,?,?,?,?)',
        msg.id, msg.conversationId, msg.activeBranchId, JSON.stringify(branches), msg.order ?? 0);
    }

    for (const [, key] of apiKeys) {
      this.sql.exec(
        'INSERT OR REPLACE INTO api_keys (id, user_id, name, provider, masked, created_at) VALUES (?,?,?,?,?,?)',
        key.id, key.userId, key.name, key.provider, key.masked, toISO(key.createdAt));
    }

    for (const [, p] of participants) {
      this.sql.exec(
        `INSERT OR REPLACE INTO participants
           (id, conversation_id, name, type, user_id, model, system_prompt,
            settings, context_management, conversation_mode, is_active,
            persona_id, persona_participation_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        p.id, p.conversationId, p.name, p.type, p.userId || null,
        (typeof p.model === 'string' ? p.model : p.model?.id) || null,
        p.systemPrompt || null, p.settings ? JSON.stringify(p.settings) : null,
        p.contextManagement ? JSON.stringify(p.contextManagement) : null,
        p.conversationMode || null, bv(p.isActive ?? true),
        p.personaId || null, p.personaParticipationId || null);
    }

    for (const [, m] of userModels) {
      this.sql.exec(
        `INSERT OR REPLACE INTO user_models
           (id, user_id, display_name, short_name, canonical_id, provider,
            provider_model_id, context_window, output_token_limit,
            supports_thinking, supports_prefill, capabilities_json, hidden,
            settings_json, created_at, updated_at, custom_endpoint_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        m.id, m.userId, m.displayName, m.shortName, m.canonicalId || null,
        m.provider, m.providerModelId, m.contextWindow, m.outputTokenLimit,
        bv(m.supportsThinking), bv(m.supportsPrefill),
        m.capabilities ? JSON.stringify(m.capabilities) : null, bv(m.hidden),
        JSON.stringify(m.settings), toISO(m.createdAt), toISO(m.updatedAt),
        m.customEndpoint ? JSON.stringify(m.customEndpoint) : null);
    }

    for (const [, b] of bookmarks) {
      this.sql.exec(
        'INSERT OR REPLACE INTO bookmarks (id, conversation_id, message_id, branch_id, label, created_at) VALUES (?,?,?,?,?,?)',
        b.id, b.conversationId, b.messageId, b.branchId, b.label, toISO(b.createdAt));
    }

    for (const [, i] of invites) {
      this.sql.exec(
        `INSERT OR REPLACE INTO invites
           (code, created_by, created_at, amount, currency, expires_at,
            max_uses, use_count, claimed_by, claimed_at, claimed_by_users_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        i.code, i.createdBy, i.createdAt || toISO(new Date()), i.amount,
        i.currency || 'credit', i.expiresAt || null, i.maxUses || null,
        i.useCount || 0, i.claimedBy || null, i.claimedAt || null,
        JSON.stringify(i.claimedByUsers || []));
    }

    for (const [convId, metricsList] of conversationMetrics) {
      for (const m of metricsList) {
        this.sql.exec(
          'INSERT INTO conversation_metrics (conversation_id, metrics_json, created_at) VALUES (?,?,?)',
          convId, JSON.stringify(m), toISO(new Date()));
      }
    }

    for (const [userId, grants] of userGrants) {
      for (const g of grants) {
        this.sql.exec('INSERT INTO user_grants (user_id, grant_json) VALUES (?,?)', userId, JSON.stringify(g));
      }
    }
    for (const [userId, caps] of userGrantCaps) {
      for (const c of caps) {
        this.sql.exec('INSERT INTO user_grant_capabilities (user_id, capability_json) VALUES (?,?)', userId, JSON.stringify(c));
      }
    }
    for (const [userId, totals] of userGrantTotals) {
      for (const [currency, amount] of totals) {
        this.sql.exec(
          `INSERT INTO user_grant_totals (user_id, currency, amount) VALUES (?,?,?)
           ON CONFLICT(user_id, currency) DO UPDATE SET amount = ?`,
          userId, currency, amount, amount);
      }
    }

    // Track access for all users and conversations
    for (const [userId] of users) {
      this.sql.exec('INSERT OR REPLACE INTO access_tracking (entity_type, entity_id, last_accessed_at) VALUES (?,?,?)',
        'user', userId, toISO(new Date()));
    }
    for (const [convId] of conversations) {
      this.sql.exec('INSERT OR REPLACE INTO access_tracking (entity_type, entity_id, last_accessed_at) VALUES (?,?,?)',
        'conversation', convId, toISO(new Date()));
    }

    console.log('[SqliteSync] Hydration complete');
    this.sql.exec('COMMIT');
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }

  // ═══ Event sync (call after each logEvent) ═════════════════════════

  syncEvent(event: Event): void {
    if (!this.enabled) return;
    try { this._sync(event); } catch (err) {
      console.error('[SqliteSync] sync failed for', event.type, err);
    }
  }

  private _sync(event: Event): void {
    switch (event.type) {
      case 'user_created': {
        const { user: u, passwordHash } = event.data;
        this.sql.exec(
          `INSERT OR REPLACE INTO users (id,email,name,created_at,email_verified,email_verified_at,age_verified,age_verified_at,tos_accepted,tos_accepted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          u.id,u.email,u.name,toISO(u.createdAt),bv(u.emailVerified),toISO(u.emailVerifiedAt),bv(u.ageVerified),toISO(u.ageVerifiedAt),bv(u.tosAccepted),toISO(u.tosAcceptedAt));
        if (passwordHash) this.sql.exec('INSERT OR REPLACE INTO password_hashes (email,hash) VALUES (?,?)', u.email, passwordHash);
        break;
      }
      case 'conversation_created': {
        const c = event.data;
        this.sql.exec(
          `INSERT OR REPLACE INTO conversations (id,user_id,title,model,system_prompt,format,created_at,updated_at,archived,settings,context_management,prefill_user_message,cli_mode_prompt,combine_consecutive_messages,total_branch_count)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          c.id,c.userId,c.title,c.model,c.systemPrompt||null,c.format||'standard',toISO(c.createdAt),toISO(c.updatedAt),bv(c.archived),JSON.stringify(c.settings),c.contextManagement?JSON.stringify(c.contextManagement):null,c.prefillUserMessage?JSON.stringify(c.prefillUserMessage):null,c.cliModePrompt?JSON.stringify(c.cliModePrompt):null,bv(c.combineConsecutiveMessages??true),c.totalBranchCount??0);
        break;
      }
      case 'message_created': {
        const m = event.data;
        const branches = (m.branches||[]).map((b:any)=>({...b,createdAt:toISO(b.createdAt||new Date())}));
        this.sql.exec('INSERT OR REPLACE INTO messages (id,conversation_id,active_branch_id,branches,msg_order) VALUES (?,?,?,?,?)', m.id,m.conversationId,m.activeBranchId,JSON.stringify(branches),m.order??0);
        break;
      }
      case 'branch_added': {
        const {messageId,branch}=event.data;
        const row=this.sql.get<{branches:string}>('SELECT branches FROM messages WHERE id=?',messageId);
        if(row){const branches:any[]=JSON.parse(row.branches);branches.push({...branch,createdAt:toISO(branch.createdAt||new Date())});this.sql.exec('UPDATE messages SET branches=? WHERE id=?',JSON.stringify(branches),messageId);}
        break;
      }
      case 'participant_created': {
        const p=event.data;
        this.sql.exec(
          `INSERT OR REPLACE INTO participants (id,conversation_id,name,type,user_id,model,system_prompt,settings,context_management,conversation_mode,is_active,persona_id,persona_participation_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          p.id,p.conversationId,p.name,p.type,p.userId||null,(typeof p.model==='string'?p.model:p.model?.id)||null,p.systemPrompt||null,p.settings?JSON.stringify(p.settings):null,p.contextManagement?JSON.stringify(p.contextManagement):null,p.conversationMode||null,bv(p.isActive??true),p.personaId||null,p.personaParticipationId||null);
        break;
      }
      case 'participant_updated': {
        const d=event.data;const id=d.participantId||d.id;
        const fs:string[]=[];const vs:any[]=[];
        if(d.name!==undefined){fs.push('name=?');vs.push(d.name);}
        if(d.model!==undefined){fs.push('model=?');vs.push(d.model);}
        if(d.systemPrompt!==undefined){fs.push('system_prompt=?');vs.push(d.systemPrompt);}
        if(d.settings!==undefined){fs.push('settings=?');vs.push(JSON.stringify(d.settings));}
        if(d.contextManagement!==undefined){fs.push('context_management=?');vs.push(JSON.stringify(d.contextManagement));}
        if(d.conversationMode!==undefined){fs.push('conversation_mode=?');vs.push(d.conversationMode);}
        if(d.isActive!==undefined){fs.push('is_active=?');vs.push(bv(d.isActive));}
        if(fs.length){vs.push(id);this.sql.exec(`UPDATE participants SET ${fs.join(',')} WHERE id=?`,...vs);}
        break;
      }
      case 'participant_deleted':this.sql.exec('DELETE FROM participants WHERE id=?',event.data.participantId||event.data.id);break;
      case 'bookmark_created':{const b=event.data;this.sql.exec('INSERT OR REPLACE INTO bookmarks (id,conversation_id,message_id,branch_id,label,created_at) VALUES (?,?,?,?,?,?)',b.id,b.conversationId,b.messageId,b.branchId,b.label,toISO(b.createdAt));break;}
      case 'bookmark_deleted':this.sql.exec('DELETE FROM bookmarks WHERE id=?',event.data.bookmarkId||event.data.id);break;
      case 'metrics_added':this.sql.exec('INSERT INTO conversation_metrics (conversation_id,metrics_json,created_at) VALUES (?,?,?)',event.data.conversationId,JSON.stringify(event.data.metrics),toISO(new Date()));break;
      case 'api_key_created':{const k=event.data;this.sql.exec('INSERT OR REPLACE INTO api_keys (id,user_id,name,provider,masked,created_at) VALUES (?,?,?,?,?,?)',k.id,k.userId,k.name,k.provider,k.masked,toISO(k.createdAt));break;}
      case 'api_key_deleted':this.sql.exec('DELETE FROM api_keys WHERE id=?',event.data.apiKeyId||event.data.id);break;
      case 'user_model_created':{const m=event.data;this.sql.exec(`INSERT OR REPLACE INTO user_models (id,user_id,display_name,short_name,canonical_id,provider,provider_model_id,context_window,output_token_limit,supports_thinking,supports_prefill,capabilities_json,hidden,settings_json,created_at,updated_at,custom_endpoint_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,m.id,m.userId,m.displayName,m.shortName,m.canonicalId||null,m.provider,m.providerModelId,m.contextWindow,m.outputTokenLimit,bv(m.supportsThinking),bv(m.supportsPrefill),m.capabilities?JSON.stringify(m.capabilities):null,bv(m.hidden),JSON.stringify(m.settings),toISO(m.createdAt),toISO(m.updatedAt),m.customEndpoint?JSON.stringify(m.customEndpoint):null);break;}
      case 'user_model_updated':{const d=event.data;const id=d.id||d.modelId;const fs:string[]=[];const vs:any[]=[];if(d.displayName!==undefined){fs.push('display_name=?');vs.push(d.displayName);}if(d.shortName!==undefined){fs.push('short_name=?');vs.push(d.shortName);}if(d.providerModelId!==undefined){fs.push('provider_model_id=?');vs.push(d.providerModelId);}if(d.contextWindow!==undefined){fs.push('context_window=?');vs.push(d.contextWindow);}if(d.outputTokenLimit!==undefined){fs.push('output_token_limit=?');vs.push(d.outputTokenLimit);}if(d.supportsThinking!==undefined){fs.push('supports_thinking=?');vs.push(bv(d.supportsThinking));}if(d.supportsPrefill!==undefined){fs.push('supports_prefill=?');vs.push(bv(d.supportsPrefill));}if(d.capabilities!==undefined){fs.push('capabilities_json=?');vs.push(JSON.stringify(d.capabilities));}if(d.hidden!==undefined){fs.push('hidden=?');vs.push(bv(d.hidden));}if(d.settings!==undefined){fs.push('settings_json=?');vs.push(JSON.stringify(d.settings));}if(d.customEndpoint!==undefined){fs.push('custom_endpoint_json=?');vs.push(JSON.stringify(d.customEndpoint));}if(fs.length){fs.push('updated_at=?');vs.push(toISO(new Date()));vs.push(id);this.sql.exec(`UPDATE user_models SET ${fs.join(',')} WHERE id=?`,...vs);}break;}
      case 'user_model_deleted':this.sql.exec('DELETE FROM user_models WHERE id=?',event.data.id||event.data.modelId);break;
      case 'grant_capability':this.sql.exec('INSERT INTO user_grant_capabilities (user_id,capability_json) VALUES (?,?)',event.data.userId,JSON.stringify(event.data));break;
      case 'grant_burned':{const d=event.data;this.sql.exec('INSERT INTO user_grants (user_id,grant_json) VALUES (?,?)',d.userId,JSON.stringify(d));const c=d.currency||'credit';this.sql.exec(`INSERT INTO user_grant_totals (user_id,currency,amount) VALUES (?,?,?) ON CONFLICT(user_id,currency) DO UPDATE SET amount=amount+?`,d.userId,c,-(d.amount||0),-(d.amount||0));break;}
      case 'invite_created':{const i=event.data;this.sql.exec(`INSERT OR REPLACE INTO invites (code,created_by,created_at,amount,currency,expires_at,max_uses,use_count,claimed_by,claimed_at,claimed_by_users_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,i.code,i.createdBy,i.createdAt||toISO(new Date()),i.amount,i.currency||'credit',i.expiresAt||null,i.maxUses||null,i.useCount||0,i.claimedBy||null,i.claimedAt||null,JSON.stringify(i.claimedByUsers||[]));break;}
      case 'invite_claimed':{const d=event.data;this.sql.exec('UPDATE invites SET use_count=?,claimed_by=?,claimed_at=?,claimed_by_users_json=? WHERE code=?',d.useCount,d.claimedBy||null,d.claimedAt||null,JSON.stringify(d.claimedByUsers||[]),d.code);break;}
      case 'conversation_updated':{const d=event.data;const id=d.conversationId||d.id;const fs:string[]=[];const vs:any[]=[];if(d.title!==undefined){fs.push('title=?');vs.push(d.title);}if(d.model!==undefined){fs.push('model=?');vs.push(d.model);}if(d.systemPrompt!==undefined){fs.push('system_prompt=?');vs.push(d.systemPrompt);}if(d.settings!==undefined){fs.push('settings=?');vs.push(JSON.stringify(d.settings));}if(d.contextManagement!==undefined){fs.push('context_management=?');vs.push(JSON.stringify(d.contextManagement));}if(d.totalBranchCount!==undefined){fs.push('total_branch_count=?');vs.push(d.totalBranchCount);}if(fs.length){fs.push('updated_at=?');vs.push(toISO(new Date()));vs.push(id);this.sql.exec(`UPDATE conversations SET ${fs.join(',')} WHERE id=?`,...vs);}break;}
      case 'conversation_deleted':{const id=event.data.id||event.data.conversationId;this.sql.exec('DELETE FROM messages WHERE conversation_id=?',id);this.sql.exec('DELETE FROM participants WHERE conversation_id=?',id);this.sql.exec('DELETE FROM conversation_metrics WHERE conversation_id=?',id);this.sql.exec('DELETE FROM bookmarks WHERE conversation_id=?',id);this.sql.exec('DELETE FROM conversations WHERE id=?',id);break;}
      case 'archived_conversation':case'unarchived_conversation':{const id=event.data.conversationId||event.data.id;const a=event.type==='archived_conversation'?1:0;this.sql.exec('UPDATE conversations SET archived=?,updated_at=? WHERE id=?',a,toISO(new Date()),id);break;}
    }
  }


  // ═══ Fast startup: hydrate Maps from SQLite ═══════════════════════

  /** Check if SQLite has any persisted data to hydrate from. */
  hasData(): boolean {
    const row = this.sql.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM users');
    return (row?.cnt ?? 0) > 0;
  }

  /** Get a sync metadata value. */
  getSyncMeta(key: string): string | null {
    const row = this.sql.get<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', key);
    return row?.value || null;
  }

  /** Set a sync metadata value. */
  setSyncMeta(key: string, value: string): void {
    this.sql.exec('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', key, value);
  }

  /** Get the last synced main-event timestamp (ISO string or empty). */
  getLastMainSyncTimestamp(): string {
    const ts = this.getSyncMeta('last_event_timestamp');
    return ts || '';
  }

  /**
   * Record that we have synced all main events up to (and including) this
   * timestamp. Stores separate bookmarks for main, conversation, and user
   * event stores so incremental replay can be selective on restart.
   */
  recordSyncTimestamps(mainTs: string, convTs: string, userTs: string): void {
    this.setSyncMeta('last_event_timestamp', mainTs);
    this.setSyncMeta('last_conversation_event_timestamp', convTs);
    this.setSyncMeta('last_user_event_timestamp', userTs);
  }

  /**
   * Populate the in-memory Maps from SQLite tables.
   * Reverse of hydrateFromMaps — reads SQLite rows and inserts into Maps.
   */
  loadMapsFromSqlite(maps: {
    users: Map<string, any>;
    usersByEmail: Map<string, string>;
    conversations: Map<string, any>;
    passwordHashes: Map<string, string>;
    messages: Map<string, any>;
    conversationMessages: Map<string, string[]>;
    apiKeys: Map<string, any>;
    participants: Map<string, any>;
    conversationParticipants: Map<string, string[]>;
    userModels: Map<string, any>;
    userModelsByUser: Map<string, Set<string>>;
    bookmarks: Map<string, any>;
    invites: Map<string, any>;
    conversationMetrics: Map<string, any[]>;
    userGrantInfos: Map<string, any[]>;
    userGrantCapabilities: Map<string, any[]>;
    userGrantTotals: Map<string, Map<string, number>>;
    userConversations: Map<string, Set<string>>;
    branchBookmarks: Map<string, string>;
  }): void {
    console.log('[SqliteSync] Loading Maps from SQLite...');

    // Users
    for (const row of this.sql.all('SELECT * FROM users') as any[]) {
      const user = {
        id: row.id, email: row.email, name: row.name,
        createdAt: new Date(row.created_at),
        emailVerified: row.email_verified === 1,
        emailVerifiedAt: row.email_verified_at ? new Date(row.email_verified_at) : undefined,
        ageVerified: row.age_verified === 1,
        ageVerifiedAt: row.age_verified_at ? new Date(row.age_verified_at) : undefined,
        tosAccepted: row.tos_accepted === 1,
        tosAcceptedAt: row.tos_accepted_at ? new Date(row.tos_accepted_at) : undefined,
        apiKeys: [],
      };
      maps.users.set(user.id, user);
      maps.usersByEmail.set(user.email, user.id);
      maps.userConversations.set(user.id, new Set());
    }

    // Password hashes
    for (const row of this.sql.all('SELECT * FROM password_hashes') as any[]) {
      maps.passwordHashes.set(row.email, row.hash);
    }

    // API keys (attach to users)
    for (const row of this.sql.all('SELECT * FROM api_keys') as any[]) {
      const apiKey = { id: row.id, name: row.name, provider: row.provider, masked: row.masked, createdAt: new Date(row.created_at) };
      maps.apiKeys.set(apiKey.id, apiKey);
      const user = maps.users.get(row.user_id);
      if (user) user.apiKeys.push(apiKey);
    }

    // Conversations
    for (const row of this.sql.all('SELECT * FROM conversations') as any[]) {
      const conv = {
        id: row.id, userId: row.user_id, title: row.title, model: row.model,
        systemPrompt: row.system_prompt, format: row.format,
        createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
        archived: row.archived === 1,
        settings: JSON.parse(row.settings || '{}'),
        contextManagement: row.context_management ? JSON.parse(row.context_management) : undefined,
        prefillUserMessage: row.prefill_user_message ? JSON.parse(row.prefill_user_message) : undefined,
        cliModePrompt: row.cli_mode_prompt ? JSON.parse(row.cli_mode_prompt) : undefined,
        combineConsecutiveMessages: row.combine_consecutive_messages !== 0,
        totalBranchCount: row.total_branch_count ?? 0,
      };
      maps.conversations.set(conv.id, conv);
      maps.conversationMessages.set(conv.id, []);
      maps.conversationParticipants.set(conv.id, []);

      // Link user -> conversation
      const userConvs = maps.userConversations.get(conv.userId);
      if (userConvs) userConvs.add(conv.id);
    }

    // Messages
    for (const row of this.sql.all('SELECT * FROM messages ORDER BY conversation_id, msg_order') as any[]) {
      const branches: any[] = JSON.parse(row.branches || '[]');
      const hydratedBranches = branches.map((b: any) => ({
        ...b, createdAt: b.createdAt ? new Date(b.createdAt) : new Date(),
      }));
      const msg = {
        id: row.id, conversationId: row.conversation_id,
        branches: hydratedBranches, activeBranchId: row.active_branch_id,
        order: row.msg_order,
      };
      maps.messages.set(msg.id, msg);

      const msgIds = maps.conversationMessages.get(msg.conversationId);
      if (msgIds) msgIds.push(msg.id);
    }

    // Participants
    for (const row of this.sql.all('SELECT * FROM participants') as any[]) {
      const p = {
        id: row.id, conversationId: row.conversation_id, name: row.name,
        type: row.type, userId: row.user_id, model: row.model,
        systemPrompt: row.system_prompt,
        settings: row.settings ? JSON.parse(row.settings) : undefined,
        contextManagement: row.context_management ? JSON.parse(row.context_management) : undefined,
        conversationMode: row.conversation_mode,
        pseudoPrefillMode: row.pseudo_prefill_mode || 'cat',
        pseudoPrefillFilename: row.pseudo_prefill_filename || 'conversation.txt',
        isActive: row.is_active !== 0,
        personaContext: row.persona_context,
        personaId: row.persona_id,
        personaParticipationId: row.persona_participation_id,
      };
      maps.participants.set(p.id, p);

      const pIds = maps.conversationParticipants.get(p.conversationId);
      if (pIds) pIds.push(p.id);
    }

    // User models
    for (const row of this.sql.all('SELECT * FROM user_models') as any[]) {
      const m = {
        id: row.id, userId: row.user_id, displayName: row.display_name,
        shortName: row.short_name, canonicalId: row.canonical_id,
        provider: row.provider, providerModelId: row.provider_model_id,
        contextWindow: row.context_window, outputTokenLimit: row.output_token_limit,
        supportsThinking: row.supports_thinking === 1,
        supportsPrefill: row.supports_prefill === 1,
        capabilities: row.capabilities_json ? JSON.parse(row.capabilities_json) : undefined,
        hidden: row.hidden === 1,
        settings: JSON.parse(row.settings_json || '{}'),
        createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
        customEndpoint: row.custom_endpoint_json ? JSON.parse(row.custom_endpoint_json) : undefined,
      };
      maps.userModels.set(m.id, m);

      const modelSet = maps.userModelsByUser.get(m.userId) || new Set<string>();
      modelSet.add(m.id);
      maps.userModelsByUser.set(m.userId, modelSet);
    }

    // Bookmarks
    for (const row of this.sql.all('SELECT * FROM bookmarks') as any[]) {
      const b = {
        id: row.id, conversationId: row.conversation_id,
        messageId: row.message_id, branchId: row.branch_id,
        label: row.label, createdAt: new Date(row.created_at),
      };
      maps.bookmarks.set(b.id, b);
      const bmKey = b.messageId + "-" + b.branchId;
      maps.branchBookmarks.set(bmKey, b.id);
    }

    // Invites
    for (const row of this.sql.all('SELECT * FROM invites') as any[]) {
      const i = {
        code: row.code, createdBy: row.created_by, createdAt: row.created_at,
        amount: row.amount, currency: row.currency,
        expiresAt: row.expires_at, maxUses: row.max_uses, useCount: row.use_count,
        claimedBy: row.claimed_by, claimedAt: row.claimed_at,
        claimedByUsers: row.claimed_by_users_json ? JSON.parse(row.claimed_by_users_json) : [],
      };
      maps.invites.set(i.code, i);
    }

    // Conversation metrics
    for (const row of this.sql.all('SELECT * FROM conversation_metrics ORDER BY conversation_id, created_at') as any[]) {
      const metrics = JSON.parse(row.metrics_json);
      const list = maps.conversationMetrics.get(row.conversation_id) || [];
      list.push(metrics);
      maps.conversationMetrics.set(row.conversation_id, list);
    }

    // Grants
    for (const row of this.sql.all('SELECT * FROM user_grants') as any[]) {
      const list = maps.userGrantInfos.get(row.user_id) || [];
      list.push(JSON.parse(row.grant_json));
      maps.userGrantInfos.set(row.user_id, list);
    }
    for (const row of this.sql.all('SELECT * FROM user_grant_capabilities') as any[]) {
      const list = maps.userGrantCapabilities.get(row.user_id) || [];
      list.push(JSON.parse(row.capability_json));
      maps.userGrantCapabilities.set(row.user_id, list);
    }
    for (const row of this.sql.all('SELECT * FROM user_grant_totals') as any[]) {
      const totals = maps.userGrantTotals.get(row.user_id) || new Map();
      totals.set(row.currency, row.amount);
      maps.userGrantTotals.set(row.user_id, totals);
    }

    console.log('[SqliteSync] Maps loaded from SQLite');
  }

  close(): void { this.sql.close(); }
}

