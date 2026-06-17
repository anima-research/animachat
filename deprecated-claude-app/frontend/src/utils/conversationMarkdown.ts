/**
 * Serialize a conversation to human-readable Markdown.
 *
 * This is a *view* over a conversation, intended as a readable companion to the
 * full JSON export. It renders the active branch path only (the conversation as
 * it actually played out); branch resolution and ordering are done by the
 * shared helpers (`computeVisibleMessages` + `sortMessagesByTreeOrder`) before
 * the messages reach this serializer, so nothing about ordering or branching is
 * reimplemented here.
 *
 * Conventions:
 *  - Each message becomes a `## Name · model` section.
 *  - `thinking` content blocks are preserved but set apart in a `<details>`.
 *  - Images / audio / attachments are referenced by a short placeholder rather
 *    than inlined (the JSON export holds the actual bytes).
 */
import type {
  Conversation,
  Message,
  MessageBranch,
  Participant,
  ContentBlock,
  Attachment,
} from '@deprecated-claude/shared';
import { getActiveBranch } from '@deprecated-claude/shared';

export interface ConversationMarkdownInput {
  conversation: Pick<Conversation, 'title' | 'model'> & Partial<Conversation>;
  participants: Participant[];
  /** Messages already filtered to the visible active-branch path and ordered. */
  messages: Message[];
}

function formatTimestamp(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Resolve the display name for the speaker of a branch. */
function speakerName(
  branch: MessageBranch,
  participantsById: Map<string, Participant>,
): string {
  if (branch.participantId) {
    const participant = participantsById.get(branch.participantId);
    if (participant?.name) return participant.name;
  }
  switch (branch.role) {
    case 'user':
      return 'User';
    case 'system':
      return 'System';
    default:
      return 'Assistant';
  }
}

/** Resolve the model label (branch overrides participant default). */
function speakerModel(
  branch: MessageBranch,
  participantsById: Map<string, Participant>,
): string | undefined {
  if (branch.model) return branch.model;
  if (branch.participantId) {
    return participantsById.get(branch.participantId)?.model;
  }
  return undefined;
}

function renderContentBlock(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text.trim();
    case 'thinking': {
      const thinking = block.thinking.trim();
      if (!thinking) return '';
      return `<details>\n<summary>thinking</summary>\n\n${thinking}\n\n</details>`;
    }
    case 'redacted_thinking':
      return '> _[redacted thinking]_';
    case 'image': {
      const detail = block.revisedPrompt ? ` — ${block.revisedPrompt.trim()}` : '';
      return `\`[image — ${block.mimeType}${detail}]\``;
    }
    case 'audio': {
      const transcript = block.transcript?.trim();
      const ref = `\`[audio — ${block.mimeType}]\``;
      return transcript ? `${ref}\n\n> ${transcript.replace(/\n/g, '\n> ')}` : ref;
    }
    default:
      return '';
  }
}

function renderAttachment(att: Attachment): string {
  const type = att.mimeType || att.fileType || 'file';
  return `\`[attachment: ${att.fileName} — ${type}]\``;
}

/** Render the body of a single branch (content blocks or plain content). */
function renderBranchBody(branch: MessageBranch): string {
  const parts: string[] = [];

  if (branch.contentBlocks && branch.contentBlocks.length > 0) {
    for (const block of branch.contentBlocks) {
      const rendered = renderContentBlock(block);
      if (rendered) parts.push(rendered);
    }
  } else if (branch.content && branch.content.trim()) {
    parts.push(branch.content.trim());
  }

  if (branch.attachments && branch.attachments.length > 0) {
    parts.push(branch.attachments.map(renderAttachment).join('\n'));
  }

  return parts.join('\n\n').trim();
}

export function serializeConversationToMarkdown(
  input: ConversationMarkdownInput,
): string {
  const { conversation, participants, messages } = input;
  const participantsById = new Map(participants.map((p) => [p.id, p]));

  const lines: string[] = [];

  // Document header
  const title = conversation.title?.trim() || 'Untitled conversation';
  lines.push(`# ${title}`);

  const meta: string[] = [];
  if (conversation.model) meta.push(`Model: ${conversation.model}`);
  meta.push(`Messages: ${messages.length}`);
  const exportedAt = formatTimestamp(new Date());
  if (exportedAt) meta.push(`Exported: ${exportedAt}`);
  lines.push('');
  lines.push(`_${meta.join(' · ')}_`);

  if (conversation.systemPrompt && conversation.systemPrompt.trim()) {
    lines.push('');
    lines.push('## System prompt');
    lines.push('');
    lines.push(conversation.systemPrompt.trim());
  }

  for (const message of messages) {
    const branch = getActiveBranch(message);
    if (!branch) continue;

    const name = speakerName(branch, participantsById);
    const model = speakerModel(branch, participantsById);
    const heading = model ? `${name} · ${model}` : name;

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`## ${heading}`);

    const ts = formatTimestamp(branch.createdAt);
    if (ts) {
      lines.push('');
      lines.push(`_${ts}_`);
    }

    const body = renderBranchBody(branch);
    lines.push('');
    lines.push(body || '_[empty message]_');
  }

  // Trailing newline for POSIX-friendly files
  return lines.join('\n').trim() + '\n';
}
