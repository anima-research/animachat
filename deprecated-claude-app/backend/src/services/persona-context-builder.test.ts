import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersonaContextBuilder } from './persona-context-builder.js';
import type { Message, Persona, PersonaParticipation, PersonaHistoryBranch } from '@deprecated-claude/shared';

// ── Mock Logger ──────────────────────────────────────────────────

vi.mock('../utils/logger.js', () => ({
  Logger: {
    debug: vi.fn(),
    error: vi.fn(),
    cache: vi.fn(),
    context: vi.fn(),
    inference: vi.fn(),
    websocket: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────

function makeMessage(id: string, content: string, order: number): Message {
  const branchId = `branch-${id}`;
  return {
    id,
    conversationId: 'conv-1',
    activeBranchId: branchId,
    order,
    branches: [{
      id: branchId,
      content,
      role: 'user' as const,
      createdAt: new Date(),
    }],
  } as Message;
}

function makePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'persona-1',
    name: 'Test Persona',
    modelId: 'claude-3-sonnet',
    ownerId: 'user-1',
    contextStrategy: { type: 'rolling', maxTokens: 60000 },
    backscrollTokens: 30000,
    allowInterleavedParticipation: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Persona;
}

function makeParticipation(overrides: Partial<PersonaParticipation> = {}): PersonaParticipation {
  return {
    id: 'part-1',
    personaId: 'persona-1',
    conversationId: 'conv-old',
    participantId: 'participant-1',
    historyBranchId: 'hbranch-1',
    canonicalBranchId: 'branch-msg-1',
    logicalStart: 1,
    logicalEnd: 10,
    joinedAt: new Date(),
    leftAt: new Date(),
    ...overrides,
  } as PersonaParticipation;
}

function makeBranch(overrides: Partial<PersonaHistoryBranch> = {}): PersonaHistoryBranch {
  return {
    id: 'hbranch-1',
    personaId: 'persona-1',
    name: 'main',
    isHead: true,
    createdAt: new Date(),
    ...overrides,
  } as PersonaHistoryBranch;
}

// ── Mock Database ────────────────────────────────────────────────

const mockDb = {
  getPersona: vi.fn(),
  getPersonaHistoryBranches: vi.fn(),
  collectPersonaBranchParticipations: vi.fn(),
  getConversationMessages: vi.fn(),
  getConversationById: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  // Default: conversation exists with an owner
  mockDb.getConversationById.mockReturnValue({ id: 'conv-1', userId: 'user-1' });
});

// ── buildPersonaContextById ──────────────────────────────────────

describe('buildPersonaContextById', () => {
  it('returns current messages when persona is not found', async () => {
    mockDb.getPersona.mockResolvedValue(null);
    const currentMessages = [makeMessage('m1', 'hello', 0)];

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContextById('bad-id', 'conv-1', currentMessages);

    expect(result).toEqual(currentMessages);
  });

  it('delegates to buildPersonaContext when persona exists', async () => {
    const persona = makePersona();
    mockDb.getPersona.mockResolvedValue(persona);
    mockDb.getPersonaHistoryBranches.mockReturnValue([]);

    const currentMessages = [makeMessage('m1', 'hello', 0)];

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContextById('persona-1', 'conv-1', currentMessages);

    // With no HEAD branch, falls back to backscroll of current messages
    expect(result).toEqual(currentMessages);
  });
});

// ── buildPersonaContext — no history ─────────────────────────────

describe('buildPersonaContext — no history', () => {
  it('returns backscroll of current messages when no HEAD branch exists', async () => {
    const persona = makePersona();
    mockDb.getPersonaHistoryBranches.mockReturnValue([]); // no branches

    const currentMessages = [makeMessage('m1', 'hello', 0)];

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-1', currentMessages);

    expect(result).toEqual(currentMessages);
  });

  it('returns empty array when no history and no current messages', async () => {
    const persona = makePersona();
    mockDb.getPersonaHistoryBranches.mockReturnValue([makeBranch()]);
    mockDb.collectPersonaBranchParticipations.mockReturnValue([]);

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-1', []);

    expect(result).toEqual([]);
  });
});

// ── buildPersonaContext — with history ───────────────────────────

describe('buildPersonaContext — with history', () => {
  it('combines historical messages with current conversation backscroll', async () => {
    const persona = makePersona({ backscrollTokens: 100000 });

    // HEAD branch with one participation from a different conversation
    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);

    const participation = makeParticipation({
      conversationId: 'conv-old',
      historyBranchId: 'hbranch-1',
      canonicalBranchId: 'branch-old-msg',
      logicalStart: 1,
      logicalEnd: 5,
      leftAt: new Date(),
    });
    mockDb.collectPersonaBranchParticipations.mockReturnValue([participation]);

    // Historical conversation messages
    const oldMsg = makeMessage('old-msg', 'past context', 0);
    oldMsg.conversationId = 'conv-old';
    oldMsg.branches[0].id = 'branch-old-msg';
    mockDb.getConversationMessages.mockResolvedValue([oldMsg]);
    mockDb.getConversationById.mockReturnValue({ id: 'conv-old', userId: 'user-1' });

    // Current conversation messages
    const currentMsg = makeMessage('cur-msg', 'current talk', 0);

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-1', [currentMsg]);

    // Should have historical + current
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('old-msg');
    expect(result[1].id).toBe('cur-msg');
  });

  it('skips participations from the current conversation (added via backscroll)', async () => {
    const persona = makePersona({ backscrollTokens: 100000 });

    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);

    // Participation in the CURRENT conversation — should be skipped for history extraction
    const participation = makeParticipation({
      conversationId: 'conv-1', // same as currentConversationId
      logicalStart: 1,
      logicalEnd: 5,
      leftAt: new Date(),
    });
    mockDb.collectPersonaBranchParticipations.mockReturnValue([participation]);

    const currentMsg = makeMessage('cur-msg', 'current talk', 0);

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-1', [currentMsg]);

    // Only backscroll, no historical messages from same conversation
    expect(result).toEqual([currentMsg]);
    // getConversationMessages should NOT have been called
    expect(mockDb.getConversationMessages).not.toHaveBeenCalled();
  });

  it('filters out incomplete participations (no leftAt)', async () => {
    const persona = makePersona({ backscrollTokens: 100000 });

    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);

    // Participation without leftAt (still active) — should be filtered
    const participation = makeParticipation({
      conversationId: 'conv-old',
      logicalStart: 1,
      leftAt: undefined as any,
    });
    mockDb.collectPersonaBranchParticipations.mockReturnValue([participation]);

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-1', []);

    expect(result).toEqual([]);
    expect(mockDb.getConversationMessages).not.toHaveBeenCalled();
  });

  it('orders participations by logicalStart (chronological)', async () => {
    const persona = makePersona({ backscrollTokens: 100000 });

    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);

    // Two participations out of order
    const part1 = makeParticipation({
      id: 'part-2',
      conversationId: 'conv-b',
      canonicalBranchId: 'branch-b-msg',
      logicalStart: 10,
      logicalEnd: 20,
      leftAt: new Date(),
    });
    const part2 = makeParticipation({
      id: 'part-1',
      conversationId: 'conv-a',
      canonicalBranchId: 'branch-a-msg',
      logicalStart: 1,
      logicalEnd: 5,
      leftAt: new Date(),
    });
    mockDb.collectPersonaBranchParticipations.mockReturnValue([part1, part2]);

    const msgA = makeMessage('msg-a', 'from A', 0);
    msgA.conversationId = 'conv-a';
    msgA.branches[0].id = 'branch-a-msg';

    const msgB = makeMessage('msg-b', 'from B', 0);
    msgB.conversationId = 'conv-b';
    msgB.branches[0].id = 'branch-b-msg';

    mockDb.getConversationMessages.mockImplementation(async (convId: string) => {
      if (convId === 'conv-a') return [msgA];
      if (convId === 'conv-b') return [msgB];
      return [];
    });
    mockDb.getConversationById.mockImplementation((convId: string) => {
      return { id: convId, userId: 'user-1' };
    });

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-1', []);

    // Should be ordered: conv-a (logicalStart=1) before conv-b (logicalStart=10)
    expect(result[0].id).toBe('msg-a');
    expect(result[1].id).toBe('msg-b');
  });
});

// ── Context strategy — rolling ───────────────────────────────────

describe('buildPersonaContext — rolling context strategy', () => {
  it('limits historical messages to maxTokens (keeps most recent)', async () => {
    // Each char ≈ 0.25 tokens, so 400 chars = 100 tokens
    // Set maxTokens very low to force trimming
    const persona = makePersona({
      contextStrategy: { type: 'rolling', maxTokens: 100 },
      backscrollTokens: 100000,
    });

    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);

    // Create 3 participations with messages of ~100 tokens each (400 chars)
    const participations = [1, 2, 3].map(i => makeParticipation({
      id: `part-${i}`,
      conversationId: `conv-${i}`,
      canonicalBranchId: `branch-msg-${i}`,
      logicalStart: i,
      logicalEnd: i + 1,
      leftAt: new Date(),
    }));
    mockDb.collectPersonaBranchParticipations.mockReturnValue(participations);

    const messages = [1, 2, 3].map(i => {
      const msg = makeMessage(`msg-${i}`, 'x'.repeat(400), 0);
      msg.conversationId = `conv-${i}`;
      return msg;
    });

    mockDb.getConversationMessages.mockImplementation(async (convId: string) => {
      const idx = parseInt(convId.split('-')[1]) - 1;
      return [messages[idx]];
    });
    mockDb.getConversationById.mockImplementation((convId: string) => {
      return { id: convId, userId: 'user-1' };
    });

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-current', []);

    // With maxTokens=100 and each message ≈ 100 tokens, should keep only the last message
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('msg-3'); // Most recent
  });
});

// ── Context strategy — anchored ──────────────────────────────────

describe('buildPersonaContext — anchored context strategy', () => {
  it('keeps prefix + rolling suffix from historical messages', async () => {
    // Each 400-char message ≈ 100 tokens
    const persona = makePersona({
      contextStrategy: {
        type: 'anchored',
        prefixTokens: 100,
        rollingTokens: 100,
      },
      backscrollTokens: 100000,
    });

    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);

    // 4 participations with messages
    const participations = [1, 2, 3, 4].map(i => makeParticipation({
      id: `part-${i}`,
      conversationId: `conv-${i}`,
      canonicalBranchId: `branch-msg-${i}`,
      logicalStart: i,
      logicalEnd: i + 1,
      leftAt: new Date(),
    }));
    mockDb.collectPersonaBranchParticipations.mockReturnValue(participations);

    const messages = [1, 2, 3, 4].map(i => {
      const msg = makeMessage(`msg-${i}`, 'x'.repeat(400), 0);
      msg.conversationId = `conv-${i}`;
      return msg;
    });

    mockDb.getConversationMessages.mockImplementation(async (convId: string) => {
      const idx = parseInt(convId.split('-')[1]) - 1;
      return [messages[idx]];
    });
    mockDb.getConversationById.mockImplementation((convId: string) => {
      return { id: convId, userId: 'user-1' };
    });

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-current', []);

    // prefixTokens=100 fits first msg, rollingTokens=100 fits last msg
    // Middle messages (2, 3) are dropped
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('msg-1'); // prefix
    expect(result[1].id).toBe('msg-4'); // rolling suffix
  });
});

// ── Backscroll ───────────────────────────────────────────────────

describe('buildPersonaContext — backscroll', () => {
  it('limits current conversation messages by backscrollTokens', async () => {
    // backscrollTokens=100, each 400-char message ≈ 100 tokens
    const persona = makePersona({ backscrollTokens: 100 });

    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);
    mockDb.collectPersonaBranchParticipations.mockReturnValue([]);

    const currentMessages = [1, 2, 3].map(i =>
      makeMessage(`cur-${i}`, 'x'.repeat(400), i)
    );

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-1', currentMessages);

    // Should keep only most recent message (100 tokens fits 1 message)
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('cur-3');
  });

  it('keeps all current messages when within backscroll token limit', async () => {
    const persona = makePersona({ backscrollTokens: 100000 });

    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);
    mockDb.collectPersonaBranchParticipations.mockReturnValue([]);

    const currentMessages = [1, 2, 3].map(i =>
      makeMessage(`cur-${i}`, 'hello', i)
    );

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-1', currentMessages);

    expect(result.length).toBe(3);
  });
});

// ── Branch inheritance ───────────────────────────────────────────

describe('buildPersonaContext — branch inheritance', () => {
  it('collects participations from parent branches recursively', async () => {
    const persona = makePersona({ backscrollTokens: 100000 });

    // Child branch points to parent
    const parentBranch = makeBranch({
      id: 'hbranch-parent',
      isHead: false,
      parentBranchId: undefined,
    });
    const childBranch = makeBranch({
      id: 'hbranch-child',
      isHead: true,
      parentBranchId: 'hbranch-parent',
    });

    mockDb.getPersonaHistoryBranches.mockImplementation((idOrPersonaId: string) => {
      // When called with persona ID, return all branches
      if (idOrPersonaId === 'persona-1') return [parentBranch, childBranch];
      // When called with specific branch ID (for parent lookup)
      if (idOrPersonaId === 'hbranch-child') return [parentBranch, childBranch];
      if (idOrPersonaId === 'hbranch-parent') return [parentBranch];
      return [];
    });

    const parentParticipation = makeParticipation({
      id: 'part-parent',
      conversationId: 'conv-parent',
      canonicalBranchId: 'branch-parent-msg',
      historyBranchId: 'hbranch-parent',
      logicalStart: 1,
      logicalEnd: 5,
      leftAt: new Date(),
    });
    const childParticipation = makeParticipation({
      id: 'part-child',
      conversationId: 'conv-child',
      canonicalBranchId: 'branch-child-msg',
      historyBranchId: 'hbranch-child',
      logicalStart: 10,
      logicalEnd: 15,
      leftAt: new Date(),
    });

    mockDb.collectPersonaBranchParticipations.mockImplementation((branchId: string) => {
      if (branchId === 'hbranch-parent') return [parentParticipation];
      if (branchId === 'hbranch-child') return [childParticipation];
      return [];
    });

    const parentMsg = makeMessage('parent-msg', 'parent context', 0);
    parentMsg.conversationId = 'conv-parent';
    parentMsg.branches[0].id = 'branch-parent-msg';

    const childMsg = makeMessage('child-msg', 'child context', 0);
    childMsg.conversationId = 'conv-child';
    childMsg.branches[0].id = 'branch-child-msg';

    mockDb.getConversationMessages.mockImplementation(async (convId: string) => {
      if (convId === 'conv-parent') return [parentMsg];
      if (convId === 'conv-child') return [childMsg];
      return [];
    });
    mockDb.getConversationById.mockImplementation((convId: string) => {
      return { id: convId, userId: 'user-1' };
    });

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-current', []);

    // Should have parent + child in chronological order
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('parent-msg');
    expect(result[1].id).toBe('child-msg');
  });
});

// ── Token estimation ─────────────────────────────────────────────

describe('token estimation', () => {
  it('estimates ~1 token per 4 characters based on active branch content', async () => {
    const persona = makePersona({
      backscrollTokens: 25, // Should fit exactly a 100-char message (100/4=25)
    });

    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);
    mockDb.collectPersonaBranchParticipations.mockReturnValue([]);

    // 100 chars = 25 tokens. Two messages.
    const msg1 = makeMessage('m1', 'x'.repeat(100), 0);
    const msg2 = makeMessage('m2', 'y'.repeat(100), 1);

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-1', [msg1, msg2]);

    // 25 tokens fits one 100-char message, should take only the last one
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('m2');
  });

  it('uses active branch content for token estimation', async () => {
    const persona = makePersona({ backscrollTokens: 100000 });

    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);
    mockDb.collectPersonaBranchParticipations.mockReturnValue([]);

    // Message with two branches, active one has short content
    const msg: Message = {
      id: 'multi-branch',
      conversationId: 'conv-1',
      activeBranchId: 'b-active',
      order: 0,
      branches: [
        { id: 'b-inactive', content: 'x'.repeat(10000), role: 'user', createdAt: new Date() },
        { id: 'b-active', content: 'short', role: 'user', createdAt: new Date() },
      ],
    } as Message;

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-1', [msg]);

    // Should use active branch content ('short' = 5 chars = 2 tokens)
    expect(result.length).toBe(1);
  });
});

// ── canonicalHistory path ─────────────────────────────────────────

describe('buildPersonaContext — pre-computed canonical history', () => {
  it('uses cached canonicalHistory when available on participation', async () => {
    const persona = makePersona({ backscrollTokens: 100000 });

    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);

    const participation = makeParticipation({
      conversationId: 'conv-old',
      logicalStart: 1,
      logicalEnd: 5,
      leftAt: new Date(),
      canonicalHistory: [
        { branchId: 'branch-cached-1', setAt: new Date() },
        { branchId: 'branch-cached-2', setAt: new Date() },
      ],
    });
    mockDb.collectPersonaBranchParticipations.mockReturnValue([participation]);

    const msg1 = makeMessage('msg-c1', 'cached 1', 0);
    msg1.conversationId = 'conv-old';
    msg1.branches = [{ id: 'branch-cached-1', content: 'cached 1', role: 'user', createdAt: new Date() } as any];
    msg1.activeBranchId = 'branch-cached-1';

    const msg2 = makeMessage('msg-c2', 'cached 2', 1);
    msg2.conversationId = 'conv-old';
    msg2.branches = [{ id: 'branch-cached-2', content: 'cached 2', role: 'assistant', createdAt: new Date() } as any];
    msg2.activeBranchId = 'branch-cached-2';

    mockDb.getConversationMessages.mockResolvedValue([msg1, msg2]);
    mockDb.getConversationById.mockReturnValue({ id: 'conv-old', userId: 'user-1' });

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-current', []);

    expect(result.length).toBe(2);
    expect(result[0].id).toBe('msg-c1');
    expect(result[1].id).toBe('msg-c2');
  });

  it('skips entries in canonicalHistory that have no matching message', async () => {
    const persona = makePersona({ backscrollTokens: 100000 });

    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);

    const participation = makeParticipation({
      conversationId: 'conv-old',
      logicalStart: 1,
      logicalEnd: 5,
      leftAt: new Date(),
      canonicalHistory: [
        { branchId: 'branch-nonexistent', setAt: new Date() },
      ],
    });
    mockDb.collectPersonaBranchParticipations.mockReturnValue([participation]);

    // No messages match the branch ID
    mockDb.getConversationMessages.mockResolvedValue([]);
    mockDb.getConversationById.mockReturnValue({ id: 'conv-old', userId: 'user-1' });

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-current', []);

    expect(result).toEqual([]);
  });
});

// ── Unknown context strategy ─────────────────────────────────────

describe('buildPersonaContext — unknown context strategy', () => {
  it('returns all historical messages when strategy type is unrecognized', async () => {
    const persona = makePersona({
      contextStrategy: { type: 'unknown-strategy' as any },
      backscrollTokens: 100000,
    });

    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);

    const participation = makeParticipation({
      conversationId: 'conv-old',
      canonicalBranchId: 'branch-msg-old',
      logicalStart: 1,
      logicalEnd: 5,
      leftAt: new Date(),
    });
    mockDb.collectPersonaBranchParticipations.mockReturnValue([participation]);

    const msg = makeMessage('msg-old', 'old content', 0);
    msg.conversationId = 'conv-old';
    mockDb.getConversationMessages.mockResolvedValue([msg]);
    mockDb.getConversationById.mockReturnValue({ id: 'conv-old', userId: 'user-1' });

    const builder = new PersonaContextBuilder(mockDb as any);
    const result = await builder.buildPersonaContext(persona, 'conv-current', []);

    // Unknown strategy = all messages pass through
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('msg-old');
  });
});

// ── getConversationOwnerId error ─────────────────────────────────

describe('buildPersonaContext — conversation not found', () => {
  it('throws when a referenced conversation does not exist', async () => {
    const persona = makePersona({ backscrollTokens: 100000 });

    const headBranch = makeBranch({ id: 'hbranch-1', isHead: true });
    mockDb.getPersonaHistoryBranches.mockReturnValue([headBranch]);

    const participation = makeParticipation({
      conversationId: 'conv-missing',
      leftAt: new Date(),
    });
    mockDb.collectPersonaBranchParticipations.mockReturnValue([participation]);
    mockDb.getConversationById.mockReturnValue(null); // Not found

    const builder = new PersonaContextBuilder(mockDb as any);

    await expect(
      builder.buildPersonaContext(persona, 'conv-1', [])
    ).rejects.toThrow('Conversation conv-missing not found');
  });
});
