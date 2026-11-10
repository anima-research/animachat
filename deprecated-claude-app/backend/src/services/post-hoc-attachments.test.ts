import assert from 'node:assert/strict';
import test from 'node:test';
import type { Attachment, Message, PostHocOperation } from '@deprecated-claude/shared';

// Run with: npx tsx --test src/services/post-hoc-attachments.test.ts
//
// "Edit in place" on a message's attachments: what the model is sent after a
// post-hoc edit hides one of the message's own attachments and adds another.
// Goes through the real context step (InferenceService.applyPostHocOperations)
// and the real Anthropic formatter, so it checks the request content itself.

const CONVERSATION = '00000000-0000-4000-8000-000000000001';
const USER_MESSAGE = '00000000-0000-4000-8000-000000000002';
const USER_BRANCH = '00000000-0000-4000-8000-000000000003';

function attachment(fileName: string, content: string): Attachment {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    fileName,
    fileSize: content.length,
    fileType: fileName.split('.').pop() || 'txt',
    content,
    encoding: 'text',
    createdAt: new Date(0),
  };
}

function userMessage(attachments: Attachment[]): Message {
  return {
    id: USER_MESSAGE,
    conversationId: CONVERSATION,
    order: 0,
    activeBranchId: USER_BRANCH,
    branches: [{
      id: USER_BRANCH,
      content: 'Please look at the attached files.',
      role: 'user',
      createdAt: new Date(0),
      attachments,
    }],
  } as Message;
}

function operationMessage(order: number, operation: Partial<PostHocOperation> & Pick<PostHocOperation, 'type'>): Message {
  const branchId = `00000000-0000-4000-8000-0000000001${String(order).padStart(2, '0')}`;
  return {
    id: `00000000-0000-4000-8000-0000000002${String(order).padStart(2, '0')}`,
    conversationId: CONVERSATION,
    order,
    activeBranchId: branchId,
    branches: [{
      id: branchId,
      content: 'operation marker',
      role: 'system',
      createdAt: new Date(0),
      postHocOperation: { targetMessageId: USER_MESSAGE, targetBranchId: USER_BRANCH, ...operation },
    }],
  } as Message;
}

async function requestText(messages: Message[]): Promise<{ count: number; text: string }> {
  const { InferenceService } = await import('./inference.js');
  const { AnthropicService } = await import('./anthropic.js');
  // applyPostHocOperations is a private, state-free step of buildPrompt.
  const processed: Message[] = (InferenceService.prototype as any).applyPostHocOperations.call({}, messages);
  const formatted = await new AnthropicService({} as any, 'test-key').formatMessagesForAnthropic(processed);
  return { count: formatted.length, text: JSON.stringify(formatted) };
}

test('an attachment edit in place swaps what the model is sent, and the message keeps its own', async () => {
  const original = userMessage([
    attachment('archive.md', 'ORIGINAL-ARCHIVE-MARKER'),
    attachment('notes.md', 'KEPT-NOTES-MARKER'),
  ]);
  const messages = [
    original,
    operationMessage(1, {
      type: 'edit',
      attachmentIndices: [0],
      addedAttachments: [attachment('redacted.md', 'REDACTED-COPY-MARKER')],
    }),
  ];

  const sent = await requestText(messages);
  assert.equal(sent.count, 1, 'the operation itself is not a message for the model');
  assert.ok(sent.text.includes('Please look at the attached files.'), 'text is unchanged');
  assert.ok(!sent.text.includes('ORIGINAL-ARCHIVE-MARKER'), 'hidden attachment is not sent');
  assert.ok(sent.text.includes('KEPT-NOTES-MARKER'), 'untouched attachment is still sent');
  assert.ok(sent.text.includes('REDACTED-COPY-MARKER'), 'added attachment is sent');
  assert.ok(
    sent.text.indexOf('KEPT-NOTES-MARKER') < sent.text.indexOf('REDACTED-COPY-MARKER'),
    'added attachments come after the own ones that remain'
  );

  // The stored message is not touched.
  assert.deepEqual(original.branches[0].attachments?.map(a => a.fileName), ['archive.md', 'notes.md']);
});

test('a text edit and an attachment edit in place each leave the other standing', async () => {
  const messages = [
    userMessage([attachment('archive.md', 'ORIGINAL-ARCHIVE-MARKER')]),
    operationMessage(1, { type: 'edit', attachmentIndices: [0], addedAttachments: [attachment('redacted.md', 'REDACTED-COPY-MARKER')] }),
    operationMessage(2, { type: 'edit', replacementContent: [{ type: 'text', text: 'EDITED-TEXT-MARKER' }] }),
  ];

  const sent = await requestText(messages);
  assert.ok(sent.text.includes('EDITED-TEXT-MARKER'));
  assert.ok(!sent.text.includes('Please look at the attached files.'));
  assert.ok(sent.text.includes('REDACTED-COPY-MARKER'), 'the earlier attachment edit survives the later text edit');
  assert.ok(!sent.text.includes('ORIGINAL-ARCHIVE-MARKER'));
});

test('a later attachment edit in place replaces the earlier one', async () => {
  const messages = [
    userMessage([attachment('archive.md', 'ORIGINAL-ARCHIVE-MARKER')]),
    operationMessage(1, { type: 'edit', attachmentIndices: [0], addedAttachments: [attachment('redacted.md', 'REDACTED-COPY-MARKER')] }),
    // Shows the archive again and drops the redacted copy.
    operationMessage(2, { type: 'edit', attachmentIndices: [], addedAttachments: [] }),
  ];

  const sent = await requestText(messages);
  assert.ok(sent.text.includes('ORIGINAL-ARCHIVE-MARKER'));
  assert.ok(!sent.text.includes('REDACTED-COPY-MARKER'));
});

test('the later edit on the conversation path wins even when its order number is lower', async () => {
  // message.order is the message count at creation, so after deletions a newer
  // operation can be numbered below an older one. The path order decides.
  const older = operationMessage(1, { type: 'edit', attachmentIndices: [0], addedAttachments: [attachment('redacted.md', 'REDACTED-COPY-MARKER')] });
  const newer = operationMessage(2, { type: 'edit', attachmentIndices: [], addedAttachments: [] });
  older.order = 6;
  newer.order = 5;

  const sent = await requestText([userMessage([attachment('archive.md', 'ORIGINAL-ARCHIVE-MARKER')]), older, newer]);
  assert.ok(sent.text.includes('ORIGINAL-ARCHIVE-MARKER'), 'the newer edit shows the archive again');
  assert.ok(!sent.text.includes('REDACTED-COPY-MARKER'), 'the older edit no longer applies');
});

test('an attachment can be added in place to a message that had none', async () => {
  const bare = userMessage([]);
  delete (bare.branches[0] as any).attachments;
  const messages = [
    bare,
    operationMessage(1, { type: 'edit', attachmentIndices: [], addedAttachments: [attachment('late.md', 'LATE-FILE-MARKER')] }),
  ];

  const sent = await requestText(messages);
  assert.ok(sent.text.includes('LATE-FILE-MARKER'));
});
