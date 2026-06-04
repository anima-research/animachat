-- AnimaChat SQLite schema
-- Replaces in-memory Maps with durable SQLite storage.
-- Event-sourced JSONL logs remain the durability guarantee;
-- SQLite is the working-state store.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Sync metadata: tracks last mirrored JSONL timestamps for incremental replay
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('last_event_timestamp', '');
INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('last_conversation_event_timestamp', '');
INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('last_user_event_timestamp', '');
INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('schema_version', '1');

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  email_verified INTEGER DEFAULT 0,
  email_verified_at TEXT,
  age_verified INTEGER DEFAULT 0,
  age_verified_at TEXT,
  tos_accepted INTEGER DEFAULT 0,
  tos_accepted_at TEXT
);

-- Password hashes keyed by email
CREATE TABLE IF NOT EXISTS password_hashes (
  email TEXT PRIMARY KEY,
  hash TEXT NOT NULL
);

-- Email verification tokens
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- API keys per user
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  masked TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  system_prompt TEXT,
  format TEXT DEFAULT 'standard',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived INTEGER DEFAULT 0,
  settings TEXT NOT NULL,
  context_management TEXT,
  prefill_user_message TEXT,
  cli_mode_prompt TEXT,
  combine_consecutive_messages INTEGER DEFAULT 1,
  total_branch_count INTEGER DEFAULT 0
);

-- Messages (branches stored as JSON array in the branches column)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  active_branch_id TEXT,
  branches TEXT NOT NULL,
  msg_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, msg_order);

-- Participants
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  user_id TEXT,
  model TEXT,
  system_prompt TEXT,
  settings TEXT,
  context_management TEXT,
  conversation_mode TEXT,
  pseudo_prefill_mode TEXT DEFAULT 'cat',
  pseudo_prefill_filename TEXT DEFAULT 'conversation.txt',
  is_active INTEGER DEFAULT 1,
  persona_context TEXT,
  persona_id TEXT,
  persona_participation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_participants_conversation ON participants(conversation_id);

-- Conversation metrics (one row per metric event)
CREATE TABLE IF NOT EXISTS conversation_metrics (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_conversation ON conversation_metrics(conversation_id);

-- Bookmarks
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_conversation ON bookmarks(conversation_id);

-- User-defined models
CREATE TABLE IF NOT EXISTS user_models (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  canonical_id TEXT,
  provider TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  context_window INTEGER NOT NULL,
  output_token_limit INTEGER NOT NULL,
  supports_thinking INTEGER DEFAULT 0,
  supports_prefill INTEGER DEFAULT 0,
  capabilities_json TEXT,
  hidden INTEGER DEFAULT 0,
  settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  custom_endpoint_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_models_user ON user_models(user_id);

-- Grant info per user
CREATE TABLE IF NOT EXISTS user_grants (
  user_id TEXT NOT NULL,
  grant_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grants_user ON user_grants(user_id);

-- Grant capabilities
CREATE TABLE IF NOT EXISTS user_grant_capabilities (
  user_id TEXT NOT NULL,
  capability_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grant_caps_user ON user_grant_capabilities(user_id);

-- Grant totals per user (currency -> amount)
CREATE TABLE IF NOT EXISTS user_grant_totals (
  user_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, currency)
);

-- Invites
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'credit',
  expires_at TEXT,
  max_uses INTEGER,
  use_count INTEGER DEFAULT 0,
  claimed_by TEXT,
  claimed_at TEXT,
  claimed_by_users_json TEXT DEFAULT '[]'
);

-- Lazy-load tracking (replaces Maps for access-time tracking)
CREATE TABLE IF NOT EXISTS access_tracking (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

-- Persona system
CREATE TABLE IF NOT EXISTS persona_personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  context_strategy_json TEXT NOT NULL DEFAULT '{}',
  backscroll_tokens INTEGER DEFAULT 30000,
  allow_interleaved INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_persona_owner ON persona_personas(owner_id);

CREATE TABLE IF NOT EXISTS persona_history_branches (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_branch_id TEXT,
  fork_point_participation_id TEXT,
  is_head INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_persona_branches ON persona_history_branches(persona_id);

CREATE TABLE IF NOT EXISTS persona_participations (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  history_branch_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  left_at TEXT,
  logical_start INTEGER NOT NULL DEFAULT 0,
  logical_end INTEGER NOT NULL DEFAULT 0,
  canonical_branch_id TEXT NOT NULL,
  canonical_history_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_persona_parts_persona ON persona_participations(persona_id);
CREATE INDEX IF NOT EXISTS idx_persona_parts_branch ON persona_participations(history_branch_id);
CREATE INDEX IF NOT EXISTS idx_persona_parts_conv ON persona_participations(conversation_id);

CREATE TABLE IF NOT EXISTS persona_shares (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  shared_with_user_id TEXT NOT NULL,
  shared_by_user_id TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_persona_shares_persona ON persona_shares(persona_id);
CREATE INDEX IF NOT EXISTS idx_persona_shares_user ON persona_shares(shared_with_user_id);

-- Shared conversations (public links)
CREATE TABLE IF NOT EXISTS shared_conversations (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  share_token TEXT NOT NULL UNIQUE,
  share_type TEXT NOT NULL DEFAULT 'tree',
  branch_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  view_count INTEGER DEFAULT 0,
  settings_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_shared_conv_token ON shared_conversations(share_token);
CREATE INDEX IF NOT EXISTS idx_shared_conv_user ON shared_conversations(user_id);

-- Collaboration shares (user-to-user)
CREATE TABLE IF NOT EXISTS collaboration_shares (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  shared_with_user_id TEXT NOT NULL,
  shared_with_email TEXT,
  shared_by_user_id TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_collab_conv ON collaboration_shares(conversation_id);
CREATE INDEX IF NOT EXISTS idx_collab_user ON collaboration_shares(shared_with_user_id);

-- Collaboration invites
CREATE TABLE IF NOT EXISTS collaboration_invites (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  invite_token TEXT NOT NULL UNIQUE,
  permission TEXT NOT NULL DEFAULT 'viewer',
  label TEXT,
  expires_at TEXT,
  max_uses INTEGER,
  use_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collab_inv_conv ON collaboration_invites(conversation_id);
CREATE INDEX IF NOT EXISTS idx_collab_inv_token ON collaboration_invites(invite_token);

