// Run: npm test -w frontend   (= node --import tsx --test tests/*.test.ts, from deprecated-claude-app)
//
// The attachment side of "edit in place" (post-hoc edit operations). The
// backend builds the AI's context and the frontend marks attachments as
// hidden / added with the same two functions, tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPostHocAttachmentOp,
  postHocEditsAttachments,
  resolvePostHocAttachments,
  type Attachment,
  type PostHocAttachmentState,
  type PostHocOperation,
} from '@deprecated-claude/shared';

const TARGET = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';

function op(fields: Partial<PostHocOperation> & Pick<PostHocOperation, 'type'>): PostHocOperation {
  return { targetMessageId: TARGET, targetBranchId: BRANCH, ...fields };
}

function file(name: string): Attachment {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    fileName: name,
    fileSize: name.length,
    fileType: 'md',
    content: `contents of ${name}`,
    encoding: 'text',
    createdAt: new Date(0),
  };
}

function fold(ops: PostHocOperation[]): PostHocAttachmentState | undefined {
  return ops.reduce<PostHocAttachmentState | undefined>(applyPostHocAttachmentOp, undefined);
}

const names = (list: Attachment[] | undefined) => list?.map(a => a.fileName);

test('an edit that only changes text does not touch attachments', () => {
  const textOnly = op({ type: 'edit', replacementContent: [{ type: 'text', text: 'new text' }] });
  assert.equal(postHocEditsAttachments(textOnly), false);
  assert.equal(fold([textOnly]), undefined);

  const own = [file('archive.md')];
  assert.equal(resolvePostHocAttachments(own, fold([textOnly])), own);
});

test('an edit can swap an attachment: hide the own one, add another', () => {
  const swap = op({ type: 'edit', attachmentIndices: [0], addedAttachments: [file('redacted.md')] });
  assert.equal(postHocEditsAttachments(swap), true);

  const seen = resolvePostHocAttachments([file('archive.md'), file('notes.md')], fold([swap]));
  assert.deepEqual(names(seen), ['notes.md', 'redacted.md']);
});

test('an edit can add an attachment to a message that had none', () => {
  const add = op({ type: 'edit', attachmentIndices: [], addedAttachments: [file('late.md')] });
  assert.deepEqual(names(resolvePostHocAttachments(undefined, fold([add]))), ['late.md']);
});

test('a later attachment edit states the whole change again', () => {
  const first = op({ type: 'edit', attachmentIndices: [0], addedAttachments: [file('redacted.md')] });
  // The second edit shows the archive again and drops the redacted copy.
  const second = op({ type: 'edit', attachmentIndices: [], addedAttachments: [] });

  const state = fold([first, second]);
  assert.deepEqual(state, { hiddenIndices: [], added: [] });
  assert.deepEqual(names(resolvePostHocAttachments([file('archive.md')], state)), ['archive.md']);
});

test('a later text-only edit keeps an earlier attachment change', () => {
  const swap = op({ type: 'edit', attachmentIndices: [0], addedAttachments: [file('redacted.md')] });
  const textOnly = op({ type: 'edit', replacementContent: [{ type: 'text', text: 'new text' }] });

  const seen = resolvePostHocAttachments([file('archive.md')], fold([swap, textOnly]));
  assert.deepEqual(names(seen), ['redacted.md']);
});

test('hide_attachment still accumulates, and counts from the own attachments', () => {
  const state = fold([
    op({ type: 'hide_attachment', attachmentIndices: [2] }),
    op({ type: 'hide_attachment', attachmentIndices: [0, 2] }),
  ]);
  assert.deepEqual(state, { hiddenIndices: [0, 2], added: [] });

  const seen = resolvePostHocAttachments([file('a.md'), file('b.md'), file('c.md')], state);
  assert.deepEqual(names(seen), ['b.md']);
});

test('hide_attachment after an attachment edit keeps what the edit added', () => {
  const state = fold([
    op({ type: 'edit', attachmentIndices: [], addedAttachments: [file('extra.md')] }),
    op({ type: 'hide_attachment', attachmentIndices: [1] }),
  ]);
  const seen = resolvePostHocAttachments([file('a.md'), file('b.md')], state);
  assert.deepEqual(names(seen), ['a.md', 'extra.md']);
});

test('operations that are not about attachments leave the state as it is', () => {
  const state: PostHocAttachmentState = { hiddenIndices: [1], added: [] };
  for (const type of ['hide', 'hide_before', 'unhide'] as const) {
    assert.equal(applyPostHocAttachmentOp(state, op({ type })), state);
  }
  assert.equal(applyPostHocAttachmentOp(state, op({ type: 'hide_attachment', attachmentIndices: [] })), state);
});

test('hiding everything leaves no attachments, not a missing list', () => {
  const state = fold([op({ type: 'edit', attachmentIndices: [0], addedAttachments: [] })]);
  assert.deepEqual(resolvePostHocAttachments([file('archive.md')], state), []);
  assert.equal(resolvePostHocAttachments(undefined, state), undefined);
});
