import { existsSync, readFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../database/index.js';

type Sender = 'human' | 'assistant';

interface ClaudeContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  signature?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  display_content?: { text?: string };
}

interface ClaudeMessage {
  uuid: string;
  text?: string;
  content?: ClaudeContentBlock[];
  created_at?: string;
  updated_at?: string;
  parent_message_uuid?: string | null;
  sender: Sender | string;
  attachments?: unknown[];
  files?: Array<{ file_name?: string; file_uuid?: string }>;
}

interface ClaudeConversation {
  uuid: string;
  name?: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: ClaudeMessage[];
}

interface ArcContentBlock {
  type: 'thinking' | 'text';
  thinking?: string;
  signature?: string;
  text?: string;
}

interface ArcBranch {
  id: string;
  content: string;
  contentBlocks?: ArcContentBlock[];
  role: 'user' | 'assistant';
  participantId?: string;
  sentByUserId?: string;
  createdAt: Date;
  model?: string;
  parentBranchId: string;
  creationSource: 'import';
}

interface ArcRawMessage {
  id: string;
  conversationId: string;
  branches: ArcBranch[];
  activeBranchId: string;
  order: number;
}

export type ClaudeArchiveContentMode = 'rendered' | 'text-blocks' | 'verbose-blocks';

export interface ClaudeArchiveImportOptions {
  model: string;
  skipEmpty?: boolean;
  limit?: number;
  contentMode?: ClaudeArchiveContentMode;
  onProgress?: (progress: ClaudeArchiveImportProgress) => void | Promise<void>;
}

export interface ClaudeArchiveImportProgress {
  importedConversations: number;
  totalConversations: number;
  importedMessages: number;
  importedBranches: number;
  currentTitle?: string;
}

export interface ClaudeArchivePreview {
  totalConversations: number;
  selectedConversations: number;
  nonEmptyConversations: number;
  emptyConversations: number;
  totalMessages: number;
  branchyConversations: number;
  largestConversation?: {
    uuid: string;
    title: string;
    messageCount: number;
    sizeBytes: number;
  };
  samples: Array<{
    uuid: string;
    title: string;
    messageCount: number;
    createdAt?: string;
    updatedAt?: string;
  }>;
}

export interface ClaudeArchiveImportResult extends ClaudeArchiveImportProgress {
  skippedConversations: number;
}

const DEFAULT_CONTENT_MODE: ClaudeArchiveContentMode = 'rendered';

export function getDefaultClaudeArchiveModel(): string {
  return 'claude-sonnet-4.6-openrouter';
}

function parseArchive(filePath: string): ClaudeConversation[] {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('Expected a Claude.ai archive array, but the top-level JSON value is not an array.');
  }

  return parsed;
}

function selectedConversations(archive: ClaudeConversation[], skipEmpty = true, limit?: number): ClaudeConversation[] {
  return archive
    .filter(conversation => !skipEmpty || (conversation.chat_messages?.length || 0) > 0)
    .slice(0, limit || undefined);
}

function roleFor(sender: string): 'user' | 'assistant' {
  return sender === 'human' ? 'user' : 'assistant';
}

function dateFrom(value: string | undefined): Date {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

interface BuiltContent {
  content: string;
  contentBlocks?: ArcContentBlock[];
}

// Inline rendering for blocks Arc has no structured representation for
// (tools, misc). Thinking is intentionally NOT inlined in 'rendered' mode —
// it becomes a structured thinking contentBlock instead.
function renderInlineBlock(block: ClaudeContentBlock, includeThinking: boolean): string {
  switch (block.type) {
    case 'text':
      return block.text || '';
    case 'thinking':
      return includeThinking && block.thinking ? `<thinking>\n${block.thinking}\n</thinking>` : '';
    case 'tool_use': {
      const label = block.name || 'tool';
      const body = block.input === undefined ? '' : `\n${JSON.stringify(block.input, null, 2)}`;
      return `<tool_use name="${label}">${body}\n</tool_use>`;
    }
    case 'tool_result': {
      const body = typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2);
      return `<tool_result name="${block.name || 'tool'}">\n${body || ''}\n</tool_result>`;
    }
    case 'token_budget':
      return '';
    case 'flag':
      return '[Claude.ai safety flag omitted]';
    default:
      return block.display_content?.text || block.text || '';
  }
}

// Builds display content + (optionally) structured contentBlocks.
//
//  - 'rendered' (default): thinking blocks become real {type:'thinking'}
//    contentBlocks (extended thinking, shown separately), text is the display
//    content, tools fold into display text. contentBlocks only attached when
//    the message actually has thinking (keeps simple messages simple).
//  - 'text-blocks': text only, thinking/tools stripped, no contentBlocks.
//  - 'verbose-blocks': everything dumped inline as text (archival raw mode),
//    no structured blocks.
function buildMessageContent(message: ClaudeMessage, mode: ClaudeArchiveContentMode): BuiltContent {
  const blocks = Array.isArray(message.content) ? message.content : [];
  const fallbackText = typeof message.text === 'string' ? message.text.trim() : '';

  if (mode === 'verbose-blocks') {
    const dumped = blocks
      .map(block => renderInlineBlock(block, true))
      .filter(text => text && text.trim())
      .join('\n\n')
      .trim();
    return { content: dumped || fallbackText };
  }

  if (mode === 'text-blocks') {
    const textOnly = blocks
      .filter(block => block.type === 'text')
      .map(block => block.text || '')
      .filter(text => text.trim())
      .join('\n\n')
      .trim();
    return { content: textOnly || fallbackText };
  }

  // 'rendered'
  const thinkingBlocks: ArcContentBlock[] = [];
  const displayParts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'thinking') {
      if (block.thinking && block.thinking.trim()) {
        thinkingBlocks.push({
          type: 'thinking',
          thinking: block.thinking,
          ...(block.signature ? { signature: block.signature } : {})
        });
      }
      continue;
    }
    const rendered = renderInlineBlock(block, false);
    if (rendered && rendered.trim()) displayParts.push(rendered.trim());
  }

  let display = displayParts.join('\n\n').trim();
  if (!display && !thinkingBlocks.length) display = fallbackText;

  if (thinkingBlocks.length === 0) {
    return { content: display };
  }

  const contentBlocks: ArcContentBlock[] = [...thinkingBlocks];
  if (display) contentBlocks.push({ type: 'text', text: display });
  return { content: display, contentBlocks };
}

function applyFileReferences(built: BuiltContent, message: ClaudeMessage): BuiltContent {
  const fileNames = (message.files || [])
    .map(file => file.file_name || file.file_uuid)
    .filter((name): name is string => !!name);

  if (fileNames.length === 0) return built;

  const suffix = `\n\n[Imported file references: ${fileNames.join(', ')}]`;
  const content = built.content ? `${built.content}${suffix}` : suffix.trim();

  let contentBlocks = built.contentBlocks;
  if (contentBlocks && contentBlocks.length) {
    const lastText = [...contentBlocks].reverse().find(b => b.type === 'text');
    if (lastText) {
      lastText.text = lastText.text ? `${lastText.text}${suffix}` : suffix.trim();
    } else {
      contentBlocks = [...contentBlocks, { type: 'text', text: suffix.trim() }];
    }
  }

  return { content, contentBlocks };
}

// The bulk conversations.json archive has no current_leaf_message_uuid, so we
// pick the active path the way Claude.ai effectively does: the most recent
// leaf, walked back to the root. Returns the set of source message uuids that
// lie on that active path.
function activeSourceUuids(messages: ClaudeMessage[]): Set<string> {
  const active = new Set<string>();
  if (messages.length === 0) return active;

  const byId = new Map<string, ClaudeMessage>();
  const hasChild = new Set<string>();
  for (const message of messages) {
    byId.set(message.uuid, message);
  }
  for (const message of messages) {
    const parentId = message.parent_message_uuid;
    if (parentId && byId.has(parentId)) hasChild.add(parentId);
  }

  const leaves = messages.filter(message => !hasChild.has(message.uuid));
  leaves.sort((a, b) => {
    const at = dateFrom(a.updated_at || a.created_at).getTime();
    const bt = dateFrom(b.updated_at || b.created_at).getTime();
    return bt - at;
  });

  let current: ClaudeMessage | undefined = leaves[0];
  let guard = 0;
  while (current && guard++ <= messages.length) {
    if (active.has(current.uuid)) break;
    active.add(current.uuid);
    const parentId: string | null | undefined = current.parent_message_uuid;
    current = parentId ? byId.get(parentId) : undefined;
  }
  return active;
}

function sortedClaudeMessages(messages: ClaudeMessage[]): ClaudeMessage[] {
  const byId = new Map<string, ClaudeMessage>();
  const originalIndex = new Map<string, number>();
  messages.forEach((message, index) => {
    byId.set(message.uuid, message);
    originalIndex.set(message.uuid, index);
  });

  const sorted: ClaudeMessage[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(message: ClaudeMessage) {
    if (visited.has(message.uuid)) return;
    if (visiting.has(message.uuid)) {
      console.warn(`[Claude archive import] Cycle detected at message ${message.uuid}; preserving input order for that branch.`);
      return;
    }

    visiting.add(message.uuid);
    const parentId = message.parent_message_uuid || undefined;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) visit(parent);
    visiting.delete(message.uuid);
    visited.add(message.uuid);
    sorted.push(message);
  }

  [...messages]
    .sort((a, b) => {
      const timeDelta = dateFrom(a.created_at).getTime() - dateFrom(b.created_at).getTime();
      if (timeDelta !== 0) return timeDelta;
      return (originalIndex.get(a.uuid) || 0) - (originalIndex.get(b.uuid) || 0);
    })
    .forEach(visit);

  return sorted;
}

function buildArcMessages(
  conversationId: string,
  sourceMessages: ClaudeMessage[],
  userParticipantId: string | undefined,
  assistantParticipantId: string | undefined,
  importingUserId: string,
  model: string,
  contentMode: ClaudeArchiveContentMode
): ArcRawMessage[] {
  const sourceBranchIds = new Map<string, string>();
  for (const message of sourceMessages) {
    sourceBranchIds.set(message.uuid, uuidv4());
  }

  const activeSet = activeSourceUuids(sourceMessages);
  const grouped = new Map<string, ArcRawMessage>();
  const rawMessages: ArcRawMessage[] = [];

  for (const source of sortedClaudeMessages(sourceMessages)) {
    const role = roleFor(source.sender);
    const parentBranchId = source.parent_message_uuid
      ? sourceBranchIds.get(source.parent_message_uuid) || 'root'
      : 'root';
    const groupKey = `${parentBranchId}:${role}`;
    const branchId = sourceBranchIds.get(source.uuid) || uuidv4();
    const participantId = role === 'user' ? userParticipantId : assistantParticipantId;
    const built = applyFileReferences(buildMessageContent(source, contentMode), source);

    // Skip only if there is genuinely nothing to import (no text AND no
    // structured thinking blocks).
    if (!built.content.trim() && !(built.contentBlocks && built.contentBlocks.length)) continue;

    let rawMessage = grouped.get(groupKey);
    if (!rawMessage) {
      rawMessage = {
        id: uuidv4(),
        conversationId,
        branches: [],
        activeBranchId: branchId,
        order: rawMessages.length
      };
      grouped.set(groupKey, rawMessage);
      rawMessages.push(rawMessage);
    }

    rawMessage.branches.push({
      id: branchId,
      content: built.content,
      ...(built.contentBlocks ? { contentBlocks: built.contentBlocks } : {}),
      role,
      participantId,
      sentByUserId: role === 'user' ? importingUserId : undefined,
      createdAt: dateFrom(source.created_at),
      model: role === 'assistant' ? model : undefined,
      parentBranchId,
      creationSource: 'import'
    });

    // Point the message at the branch that lies on Claude's active path.
    if (activeSet.has(source.uuid)) {
      rawMessage.activeBranchId = branchId;
    }
  }

  return rawMessages;
}

function titleFor(conversation: ClaudeConversation): string {
  const title = conversation.name?.trim() || conversation.summary?.trim();
  if (title) return title;
  return `Claude import ${conversation.uuid.slice(0, 8)}`;
}

function isBranchy(conversation: ClaudeConversation): boolean {
  const parentCounts = new Map<string, number>();
  for (const message of conversation.chat_messages || []) {
    const key = `${message.parent_message_uuid || 'root'}:${roleFor(message.sender)}`;
    parentCounts.set(key, (parentCounts.get(key) || 0) + 1);
  }
  return [...parentCounts.values()].some(count => count > 1);
}

export function previewClaudeArchive(filePath: string, options: Pick<ClaudeArchiveImportOptions, 'skipEmpty' | 'limit'> = {}): ClaudeArchivePreview {
  const archive = parseArchive(filePath);
  const selected = selectedConversations(archive, options.skipEmpty ?? true, options.limit);
  const nonEmptyConversations = archive.filter(conversation => (conversation.chat_messages?.length || 0) > 0).length;

  let largestConversation: ClaudeArchivePreview['largestConversation'];
  for (const conversation of selected) {
    const sizeBytes = Buffer.byteLength(JSON.stringify(conversation), 'utf8');
    const messageCount = conversation.chat_messages?.length || 0;
    if (!largestConversation || sizeBytes > largestConversation.sizeBytes) {
      largestConversation = {
        uuid: conversation.uuid,
        title: titleFor(conversation),
        messageCount,
        sizeBytes
      };
    }
  }

  return {
    totalConversations: archive.length,
    selectedConversations: selected.length,
    nonEmptyConversations,
    emptyConversations: archive.length - nonEmptyConversations,
    totalMessages: selected.reduce((sum, conversation) => sum + (conversation.chat_messages?.length || 0), 0),
    branchyConversations: selected.filter(isBranchy).length,
    largestConversation,
    samples: selected.slice(0, 5).map(conversation => ({
      uuid: conversation.uuid,
      title: titleFor(conversation),
      messageCount: conversation.chat_messages?.length || 0,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at
    }))
  };
}

export async function importClaudeArchive(
  db: Database,
  filePath: string,
  userId: string,
  options: ClaudeArchiveImportOptions
): Promise<ClaudeArchiveImportResult> {
  const startedAt = Date.now();
  const archive = parseArchive(filePath);
  const selected = selectedConversations(archive, options.skipEmpty ?? true, options.limit);
  const user = await db.getUserById(userId);
  if (!user) throw new Error(`No user found with id ${userId}`);

  console.log(
    `[claude-archive] import start: user=${userId} selected=${selected.length}/${archive.length} ` +
    `model=${options.model} contentMode=${options.contentMode || DEFAULT_CONTENT_MODE} ` +
    `skipEmpty=${options.skipEmpty ?? true}${options.limit ? ` limit=${options.limit}` : ''}`
  );

  let importedConversations = 0;
  let importedMessages = 0;
  let importedBranches = 0;
  let skippedConversations = 0;

  for (const sourceConversation of selected) {
    const sourceMessages = sourceConversation.chat_messages || [];
    if (sourceMessages.length === 0 && (options.skipEmpty ?? true)) {
      skippedConversations++;
      continue;
    }

    const conversation = await db.createConversation(
      user.id,
      titleFor(sourceConversation),
      options.model,
      undefined,
      undefined,
      'standard'
    );

    const participants = await db.getConversationParticipants(conversation.id, user.id);
    const userParticipant = participants.find(participant => participant.type === 'user');
    const assistantParticipant = participants.find(participant => participant.type === 'assistant');

    const rawMessages = buildArcMessages(
      conversation.id,
      sourceMessages,
      userParticipant?.id,
      assistantParticipant?.id,
      user.id,
      options.model,
      options.contentMode || DEFAULT_CONTENT_MODE
    );

    for (const rawMessage of rawMessages) {
      await db.importRawMessage(conversation.id, user.id, rawMessage);
      importedMessages++;
      importedBranches += rawMessage.branches.length;
    }

    // Reconcile the active branch path so getVisibleMessages renders the
    // canonical thread (parity with the arc_chat import path). Per-message
    // time is preserved on each branch.createdAt; the conversation itself
    // intentionally keeps its import-time created/updated timestamps.
    await db.alignActiveBranchPath(conversation.id, user.id);

    importedConversations++;
    if (importedConversations % 100 === 0 || importedConversations === selected.length) {
      console.log(
        `[claude-archive] progress: ${importedConversations}/${selected.length} conversations, ` +
        `${importedMessages} messages, ${importedBranches} branches`
      );
    }
    await options.onProgress?.({
      importedConversations,
      totalConversations: selected.length,
      importedMessages,
      importedBranches,
      currentTitle: titleFor(sourceConversation)
    });
  }

  console.log(
    `[claude-archive] import done: user=${userId} ` +
    `${importedConversations} conversations, ${importedMessages} messages, ` +
    `${importedBranches} branches, ${skippedConversations} skipped, ` +
    `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
  );

  return {
    importedConversations,
    totalConversations: selected.length,
    importedMessages,
    importedBranches,
    skippedConversations
  };
}
