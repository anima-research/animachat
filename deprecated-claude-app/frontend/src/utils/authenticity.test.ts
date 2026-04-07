import { describe, it, expect } from 'vitest';
import type { Message, Participant } from '@deprecated-claude/shared';
import {
  computeAuthenticity,
  getAuthenticityLevel,
  getAuthenticityColor,
  getAuthenticityTooltip,
  type AuthenticityStatus,
  type AuthenticityLevel,
} from './authenticity';

// Helper to create a Message with the given branch properties
function makeMessage(
  id: string,
  overrides: {
    role?: 'user' | 'assistant';
    creationSource?: string;
    postHocOperation?: object;
    extraBranches?: Array<{ id: string; role: string; creationSource?: string }>;
  } = {}
): Message {
  const branchId = `branch-${id}`;
  const activeBranch: any = {
    id: branchId,
    content: `Content of ${id}`,
    role: overrides.role || 'assistant',
    createdAt: new Date(),
  };
  if (overrides.creationSource !== undefined) {
    activeBranch.creationSource = overrides.creationSource;
  }
  if (overrides.postHocOperation) {
    activeBranch.postHocOperation = overrides.postHocOperation;
  }

  const branches: any[] = [activeBranch];
  if (overrides.extraBranches) {
    for (const eb of overrides.extraBranches) {
      branches.push({
        id: eb.id,
        content: 'extra branch',
        role: eb.role,
        createdAt: new Date(),
        ...(eb.creationSource !== undefined ? { creationSource: eb.creationSource } : {}),
      });
    }
  }

  return {
    id,
    conversationId: 'conv-1',
    branches,
    activeBranchId: branchId,
    order: 0,
  } as Message;
}

function makeParticipants(
  specs: Array<{ name: string; type: 'user' | 'assistant' }>
): Participant[] {
  return specs.map((s, i) => ({
    id: `p-${i}`,
    conversationId: 'conv-1',
    name: s.name,
    type: s.type,
    isActive: true,
  })) as Participant[];
}

describe('computeAuthenticity', () => {
  const noCollisionParticipants = makeParticipants([
    { name: 'Alice', type: 'user' },
    { name: 'Claude', type: 'assistant' },
  ]);

  it('returns empty map for empty messages', () => {
    const result = computeAuthenticity([], noCollisionParticipants);
    expect(result.size).toBe(0);
  });

  it('returns empty map for null/undefined messages', () => {
    const result = computeAuthenticity(null as any, noCollisionParticipants);
    expect(result.size).toBe(0);
  });

  it('marks a single unaltered AI message as hard_mode authentic', () => {
    const msgs = [makeMessage('m1', { creationSource: 'generation' })];
    const result = computeAuthenticity(msgs, noCollisionParticipants);

    const status = result.get('m1')!;
    expect(status.isUnaltered).toBe(true);
    expect(status.isSplitAuthentic).toBe(true);
    expect(status.isTraceAuthentic).toBe(true);
    expect(status.isFullyAuthentic).toBe(true);
    expect(status.isHardModeAuthentic).toBe(true);
    expect(status.isHumanWrittenAI).toBe(false);
    expect(status.isLegacy).toBe(false);
  });

  it('marks legacy messages (no creationSource) correctly', () => {
    // No creationSource at all — legacy
    const msgs = [makeMessage('m1')]; // no creationSource
    const result = computeAuthenticity(msgs, noCollisionParticipants);

    const status = result.get('m1')!;
    expect(status.isLegacy).toBe(true);
    expect(status.isUnaltered).toBe(false); // Legacy is not unaltered
  });

  it('marks human-written AI messages correctly', () => {
    const msgs = [
      makeMessage('m1', { role: 'assistant', creationSource: 'human_edit' }),
    ];
    const result = computeAuthenticity(msgs, noCollisionParticipants);

    const status = result.get('m1')!;
    expect(status.isHumanWrittenAI).toBe(true);
    expect(status.isUnaltered).toBe(false);
    expect(status.isFullyAuthentic).toBe(false);
  });

  it('user messages with human_edit are NOT marked as human-written AI', () => {
    const msgs = [
      makeMessage('m1', { role: 'user', creationSource: 'human_edit' }),
    ];
    const result = computeAuthenticity(msgs, noCollisionParticipants);

    const status = result.get('m1')!;
    expect(status.isHumanWrittenAI).toBe(false);
    // User messages with human_edit are expected — not altered
    expect(status.isUnaltered).toBe(true);
  });

  it('breaks trace authenticity when edits occur above', () => {
    const msgs = [
      makeMessage('m1', { role: 'assistant', creationSource: 'human_edit' }), // altered
      makeMessage('m2', { creationSource: 'generation' }), // unaltered but edit above
    ];
    const result = computeAuthenticity(msgs, noCollisionParticipants);

    const m2 = result.get('m2')!;
    expect(m2.isUnaltered).toBe(true);
    expect(m2.isTraceAuthentic).toBe(false); // Edit above breaks trace
  });

  it('breaks split authenticity when split+regeneration occurs above', () => {
    const msgs = [
      makeMessage('m1', {
        creationSource: 'split',
        extraBranches: [
          { id: 'regen-branch', role: 'assistant', creationSource: 'regeneration' },
        ],
      }),
      makeMessage('m2', { creationSource: 'generation' }),
    ];
    const result = computeAuthenticity(msgs, noCollisionParticipants);

    const m2 = result.get('m2')!;
    expect(m2.isUnaltered).toBe(true);
    expect(m2.isSplitAuthentic).toBe(false); // Split regeneration above
    expect(m2.isTraceAuthentic).toBe(true); // No edit above
  });

  it('breaks hard mode when branches exist above', () => {
    const msgs = [
      makeMessage('m1', {
        creationSource: 'generation',
        extraBranches: [{ id: 'alt-branch', role: 'assistant' }],
      }),
      makeMessage('m2', { creationSource: 'generation' }),
    ];
    const result = computeAuthenticity(msgs, noCollisionParticipants);

    const m2 = result.get('m2')!;
    expect(m2.isFullyAuthentic).toBe(true);
    expect(m2.isHardModeAuthentic).toBe(false); // Branches above
  });

  it('detects name collisions between human and AI participants', () => {
    const collidingParticipants = makeParticipants([
      { name: 'Claude', type: 'user' },
      { name: 'Claude', type: 'assistant' },
    ]);

    const msgs = [makeMessage('m1', { creationSource: 'generation' })];
    const result = computeAuthenticity(msgs, collidingParticipants);

    const status = result.get('m1')!;
    expect(status.isTraceAuthentic).toBe(false); // Name collision
    expect(status.isSplitAuthentic).toBe(true); // Split doesn't care about names
  });

  it('name collision check is case-insensitive', () => {
    const collidingParticipants = makeParticipants([
      { name: 'claude', type: 'user' },
      { name: 'Claude', type: 'assistant' },
    ]);

    const msgs = [makeMessage('m1', { creationSource: 'generation' })];
    const result = computeAuthenticity(msgs, collidingParticipants);

    expect(result.get('m1')!.isTraceAuthentic).toBe(false);
  });

  it('post-hoc operations break both split and trace authenticity', () => {
    const msgs = [
      makeMessage('m1', {
        creationSource: 'generation',
        postHocOperation: { type: 'hide' },
      }),
    ];
    const result = computeAuthenticity(msgs, noCollisionParticipants);

    const status = result.get('m1')!;
    expect(status.isUnaltered).toBe(true); // Post-hoc doesn't alter the message itself
    expect(status.isSplitAuthentic).toBe(false);
    expect(status.isTraceAuthentic).toBe(false);
  });

  it('post-hoc above breaks authenticity for subsequent messages', () => {
    const msgs = [
      makeMessage('m1', {
        creationSource: 'generation',
        postHocOperation: { type: 'edit' },
      }),
      makeMessage('m2', { creationSource: 'generation' }),
    ];
    const result = computeAuthenticity(msgs, noCollisionParticipants);

    const m2 = result.get('m2')!;
    expect(m2.isSplitAuthentic).toBe(false);
    expect(m2.isTraceAuthentic).toBe(false);
  });

  it('skips messages with no active branch', () => {
    const msg: Message = {
      id: 'orphan',
      conversationId: 'conv-1',
      branches: [
        {
          id: 'branch-1',
          content: 'test',
          role: 'assistant',
          createdAt: new Date(),
        } as any,
      ],
      activeBranchId: 'nonexistent-branch', // No match
      order: 0,
    };

    const result = computeAuthenticity([msg], noCollisionParticipants);
    expect(result.has('orphan')).toBe(false);
  });

  it('processes multi-message conversation correctly', () => {
    const msgs = [
      makeMessage('m1', { role: 'user', creationSource: 'human_edit' }),
      makeMessage('m2', { creationSource: 'generation' }),
      makeMessage('m3', { role: 'user', creationSource: 'human_edit' }),
      makeMessage('m4', { creationSource: 'generation' }),
    ];
    const result = computeAuthenticity(msgs, noCollisionParticipants);

    // All should be unaltered (user human_edit is normal)
    expect(result.get('m1')!.isUnaltered).toBe(true);
    expect(result.get('m2')!.isUnaltered).toBe(true);
    expect(result.get('m3')!.isUnaltered).toBe(true);
    expect(result.get('m4')!.isUnaltered).toBe(true);

    // All should be fully authentic in a clean conversation
    expect(result.get('m4')!.isFullyAuthentic).toBe(true);
  });
});

describe('getAuthenticityLevel', () => {
  const base: AuthenticityStatus = {
    isUnaltered: true,
    isSplitAuthentic: true,
    isTraceAuthentic: true,
    isFullyAuthentic: true,
    isHardModeAuthentic: true,
    isHumanWrittenAI: false,
    isLegacy: false,
  };

  it('returns "hard_mode" for fully authentic with no branches', () => {
    expect(getAuthenticityLevel(base)).toBe('hard_mode');
  });

  it('returns "human_written" when isHumanWrittenAI is true (highest priority)', () => {
    expect(
      getAuthenticityLevel({ ...base, isHumanWrittenAI: true })
    ).toBe('human_written');
  });

  it('returns "legacy" when isLegacy is true', () => {
    expect(
      getAuthenticityLevel({ ...base, isLegacy: true, isUnaltered: false })
    ).toBe('legacy');
  });

  it('returns "altered" when not unaltered', () => {
    expect(
      getAuthenticityLevel({ ...base, isUnaltered: false })
    ).toBe('altered');
  });

  it('returns "full" when fully authentic but not hard mode', () => {
    expect(
      getAuthenticityLevel({ ...base, isHardModeAuthentic: false })
    ).toBe('full');
  });

  it('returns "split_only" when split authentic but not trace', () => {
    expect(
      getAuthenticityLevel({
        ...base,
        isHardModeAuthentic: false,
        isFullyAuthentic: false,
        isTraceAuthentic: false,
      })
    ).toBe('split_only');
  });

  it('returns "trace_only" when trace authentic but not split', () => {
    expect(
      getAuthenticityLevel({
        ...base,
        isHardModeAuthentic: false,
        isFullyAuthentic: false,
        isSplitAuthentic: false,
      })
    ).toBe('trace_only');
  });

  it('returns "unaltered" when only unaltered (neither split nor trace)', () => {
    expect(
      getAuthenticityLevel({
        ...base,
        isHardModeAuthentic: false,
        isFullyAuthentic: false,
        isSplitAuthentic: false,
        isTraceAuthentic: false,
      })
    ).toBe('unaltered');
  });
});

describe('getAuthenticityColor', () => {
  const expectedColors: Record<AuthenticityLevel, string> = {
    hard_mode: '#2196F3',
    full: '#42A5F5',
    split_only: '#64B5F6',
    trace_only: '#78909C',
    unaltered: '#81C784',
    altered: '#FF9800',
    legacy: '#B0BEC5',
    human_written: '#E91E63',
  };

  for (const [level, color] of Object.entries(expectedColors)) {
    it(`returns ${color} for "${level}"`, () => {
      expect(getAuthenticityColor(level as AuthenticityLevel)).toBe(color);
    });
  }
});

describe('getAuthenticityTooltip', () => {
  const levels: AuthenticityLevel[] = [
    'hard_mode',
    'full',
    'split_only',
    'trace_only',
    'unaltered',
    'altered',
    'legacy',
    'human_written',
  ];

  for (const level of levels) {
    it(`returns a non-empty string for "${level}"`, () => {
      const tooltip = getAuthenticityTooltip(level);
      expect(typeof tooltip).toBe('string');
      expect(tooltip.length).toBeGreaterThan(10);
    });
  }

  it('hard_mode tooltip mentions "no branches"', () => {
    expect(getAuthenticityTooltip('hard_mode')).toContain('no branches');
  });

  it('legacy tooltip mentions "predates"', () => {
    expect(getAuthenticityTooltip('legacy')).toContain('predates');
  });

  it('human_written tooltip mentions "human"', () => {
    expect(getAuthenticityTooltip('human_written').toLowerCase()).toContain('human');
  });

  it('altered tooltip mentions "edited"', () => {
    expect(getAuthenticityTooltip('altered').toLowerCase()).toContain('edited');
  });
});
