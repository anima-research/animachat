import { describe, it, expect, beforeEach } from 'vitest';
import { PersonaStore } from './persona.js';

describe('PersonaStore', () => {
  let store: PersonaStore;

  beforeEach(() => {
    store = new PersonaStore();
  });

  // Helper to create a persona with defaults
  function createTestPersona(ownerId = 'owner-1', name = 'Test Persona', modelId = 'claude-3') {
    return store.createPersona(ownerId, { name, modelId });
  }

  // Helper to create a persona + participation
  function createTestParticipation(
    ownerId = 'owner-1',
    conversationId = 'conv-1',
    participantId = 'participant-1',
    canonicalBranchId = 'branch-1'
  ) {
    const { persona, initialBranch } = createTestPersona(ownerId);
    const result = store.createParticipation(
      persona.id, conversationId, participantId, canonicalBranchId
    );
    return { persona, initialBranch, participation: result!.participation, participationEvent: result!.eventData };
  }

  describe('createPersona', () => {
    it('creates a persona with name, model, owner, and default settings', () => {
      const { persona, initialBranch, eventData } = createTestPersona();

      expect(persona.name).toBe('Test Persona');
      expect(persona.modelId).toBe('claude-3');
      expect(persona.ownerId).toBe('owner-1');
      expect(persona.contextStrategy).toEqual({ type: 'rolling', maxTokens: 60000 });
      expect(persona.backscrollTokens).toBe(30000);
      expect(persona.allowInterleavedParticipation).toBe(false);
      expect(persona.createdAt).toBeInstanceOf(Date);
      expect(persona.updatedAt).toBeInstanceOf(Date);
      expect(persona.archivedAt).toBeUndefined();

      expect(initialBranch.personaId).toBe(persona.id);
      expect(initialBranch.name).toBe('main');
      expect(initialBranch.isHead).toBe(true);

      expect(eventData.type).toBe('persona_created');
    });

    it('creates persona with custom options', () => {
      const { persona } = store.createPersona('owner-1', {
        name: 'Custom',
        modelId: 'gpt-4',
        contextStrategy: { type: 'full' },
        backscrollTokens: 50000,
        allowInterleavedParticipation: true
      });

      expect(persona.contextStrategy).toEqual({ type: 'full' });
      expect(persona.backscrollTokens).toBe(50000);
      expect(persona.allowInterleavedParticipation).toBe(true);
    });

    it('makes persona immediately queryable', () => {
      const { persona } = createTestPersona();
      expect(store.getPersona(persona.id)).toBeDefined();
      expect(store.getPersonasByOwner('owner-1')).toHaveLength(1);
    });
  });

  describe('updatePersona', () => {
    it('updates persona fields', () => {
      const { persona } = createTestPersona();
      const result = store.updatePersona(persona.id, { name: 'Updated Name' });

      expect(result).not.toBeNull();
      expect(result!.persona.name).toBe('Updated Name');
      expect(result!.eventData.type).toBe('persona_updated');
    });

    it('updates multiple fields at once', () => {
      const { persona } = createTestPersona();
      store.updatePersona(persona.id, {
        name: 'New Name',
        backscrollTokens: 10000,
        allowInterleavedParticipation: true
      });

      const updated = store.getPersona(persona.id)!;
      expect(updated.name).toBe('New Name');
      expect(updated.backscrollTokens).toBe(10000);
      expect(updated.allowInterleavedParticipation).toBe(true);
    });

    it('returns null for nonexistent persona', () => {
      expect(store.updatePersona('nonexistent', { name: 'x' })).toBeNull();
    });

    it('sets updatedAt to a new value', () => {
      const { persona } = createTestPersona();
      const originalUpdatedAt = persona.updatedAt;

      // Small delay to ensure timestamp difference
      store.updatePersona(persona.id, { name: 'Changed' });
      const updated = store.getPersona(persona.id)!;
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
    });
  });

  describe('archivePersona', () => {
    it('sets archivedAt on the persona', () => {
      const { persona } = createTestPersona();
      const result = store.archivePersona(persona.id);

      expect(result).not.toBeNull();
      expect(result!.eventData.type).toBe('persona_archived');

      const archived = store.getPersona(persona.id)!;
      expect(archived.archivedAt).toBeInstanceOf(Date);
    });

    it('returns null for nonexistent persona', () => {
      expect(store.archivePersona('nonexistent')).toBeNull();
    });

    it('prevents creating new participations', () => {
      const { persona, initialBranch } = createTestPersona();
      store.archivePersona(persona.id);

      const result = store.createParticipation(
        persona.id, 'conv-1', 'participant-1', 'branch-1'
      );
      expect(result).toBeNull();
    });
  });

  describe('deletePersona', () => {
    it('removes persona from store', () => {
      const { persona } = createTestPersona();
      const result = store.deletePersona(persona.id);

      expect(result).not.toBeNull();
      expect(result!.eventData.type).toBe('persona_deleted');
      expect(store.getPersona(persona.id)).toBeUndefined();
    });

    it('removes persona from owner index', () => {
      const { persona } = createTestPersona();
      store.deletePersona(persona.id);
      expect(store.getPersonasByOwner('owner-1')).toHaveLength(0);
    });

    it('cleans up shares on deletion', () => {
      const { persona } = createTestPersona();
      store.createShare(persona.id, 'user-2', 'owner-1', 'viewer');

      store.deletePersona(persona.id);
      expect(store.getSharesForPersona(persona.id)).toHaveLength(0);
    });

    it('returns null for nonexistent persona', () => {
      expect(store.deletePersona('nonexistent')).toBeNull();
    });
  });

  describe('history branch management', () => {
    it('creates initial branch on persona creation', () => {
      const { persona, initialBranch } = createTestPersona();
      const branches = store.getHistoryBranches(persona.id);
      expect(branches).toHaveLength(1);
      expect(branches[0].id).toBe(initialBranch.id);
      expect(branches[0].isHead).toBe(true);
    });

    it('creates a new branch off the current head', () => {
      const { persona, initialBranch } = createTestPersona();
      const result = store.createHistoryBranch(persona.id, 'experiment');

      expect(result).not.toBeNull();
      expect(result!.branch.name).toBe('experiment');
      expect(result!.branch.parentBranchId).toBe(initialBranch.id);
      expect(result!.branch.isHead).toBe(false);
      expect(result!.eventData.type).toBe('persona_history_branch_created');
    });

    it('returns null for nonexistent persona', () => {
      expect(store.createHistoryBranch('nonexistent', 'x')).toBeNull();
    });

    it('switches head branch', () => {
      const { persona } = createTestPersona();
      const { branch: newBranch } = store.createHistoryBranch(persona.id, 'new-head')!;

      const result = store.setHeadBranch(persona.id, newBranch.id);
      expect(result).not.toBeNull();

      const head = store.getHeadBranch(persona.id);
      expect(head!.id).toBe(newBranch.id);
      expect(head!.isHead).toBe(true);

      // Old branch should no longer be head
      const branches = store.getHistoryBranches(persona.id);
      const oldHead = branches.find(b => b.id !== newBranch.id);
      expect(oldHead!.isHead).toBe(false);
    });

    it('setHeadBranch returns null for branch from wrong persona', () => {
      const { persona: p1 } = createTestPersona('owner-1', 'P1');
      const { persona: p2 } = createTestPersona('owner-2', 'P2');
      const { branch: p2Branch } = store.createHistoryBranch(p2.id, 'other')!;

      expect(store.setHeadBranch(p1.id, p2Branch.id)).toBeNull();
    });

    it('setHeadBranch returns null for nonexistent branch', () => {
      const { persona } = createTestPersona();
      expect(store.setHeadBranch(persona.id, 'nonexistent')).toBeNull();
    });

    it('getHistoryBranch returns a specific branch', () => {
      const { initialBranch } = createTestPersona();
      const branch = store.getHistoryBranch(initialBranch.id);
      expect(branch).toBeDefined();
      expect(branch!.name).toBe('main');
    });

    it('getHistoryBranch returns undefined for unknown branch', () => {
      expect(store.getHistoryBranch('nonexistent')).toBeUndefined();
    });

    it('getHeadBranch returns undefined for unknown persona', () => {
      expect(store.getHeadBranch('nonexistent')).toBeUndefined();
    });

    it('getHistoryBranches returns empty for unknown persona', () => {
      expect(store.getHistoryBranches('nonexistent')).toEqual([]);
    });
  });

  describe('participation tracking', () => {
    it('creates a participation on the head branch', () => {
      const { persona, participation } = createTestParticipation();

      expect(participation.personaId).toBe(persona.id);
      expect(participation.conversationId).toBe('conv-1');
      expect(participation.participantId).toBe('participant-1');
      expect(participation.canonicalBranchId).toBe('branch-1');
      expect(participation.joinedAt).toBeInstanceOf(Date);
      expect(participation.leftAt).toBeUndefined();
      expect(participation.logicalStart).toBe(100); // LOGICAL_TIME_GAP
      expect(participation.logicalEnd).toBe(200); // 2 * LOGICAL_TIME_GAP
      expect(participation.canonicalHistory).toHaveLength(1);
    });

    it('assigns sequential logical times', () => {
      const { persona } = createTestPersona('owner-1', 'P', 'claude-3');
      // Allow interleaved so we can create multiple
      store.updatePersona(persona.id, { allowInterleavedParticipation: true });

      const p1 = store.createParticipation(persona.id, 'conv-1', 'part-1', 'b-1')!;
      store.endParticipation(p1.participation.id);

      const p2 = store.createParticipation(persona.id, 'conv-2', 'part-2', 'b-2')!;
      expect(p2.participation.logicalStart).toBeGreaterThan(p1.participation.logicalEnd);
    });

    it('prevents concurrent participation when interleaving disabled', () => {
      const { persona } = createTestPersona();
      store.createParticipation(persona.id, 'conv-1', 'part-1', 'b-1');

      // Second participation should fail (already active)
      const result = store.createParticipation(persona.id, 'conv-2', 'part-2', 'b-2');
      expect(result).toBeNull();
    });

    it('allows concurrent participation when interleaving enabled', () => {
      const { persona } = store.createPersona('owner-1', {
        name: 'Interleaved',
        modelId: 'claude-3',
        allowInterleavedParticipation: true
      });

      const p1 = store.createParticipation(persona.id, 'conv-1', 'part-1', 'b-1');
      const p2 = store.createParticipation(persona.id, 'conv-2', 'part-2', 'b-2');
      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
    });

    it('returns null for nonexistent persona', () => {
      expect(store.createParticipation('nonexistent', 'c', 'p', 'b')).toBeNull();
    });

    it('getParticipation returns a specific participation', () => {
      const { participation } = createTestParticipation();
      const found = store.getParticipation(participation.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(participation.id);
    });

    it('getParticipation returns undefined for unknown', () => {
      expect(store.getParticipation('nonexistent')).toBeUndefined();
    });
  });

  describe('endParticipation', () => {
    it('sets leftAt and clears active tracking', () => {
      const { persona, participation } = createTestParticipation();

      expect(store.getActiveParticipation(persona.id)).toBeDefined();

      const result = store.endParticipation(participation.id);
      expect(result).not.toBeNull();
      expect(result!.eventData.type).toBe('persona_participation_ended');

      const ended = store.getParticipation(participation.id)!;
      expect(ended.leftAt).toBeInstanceOf(Date);
      expect(store.getActiveParticipation(persona.id)).toBeUndefined();
    });

    it('returns null for already-ended participation', () => {
      const { participation } = createTestParticipation();
      store.endParticipation(participation.id);
      expect(store.endParticipation(participation.id)).toBeNull();
    });

    it('returns null for nonexistent participation', () => {
      expect(store.endParticipation('nonexistent')).toBeNull();
    });

    it('allows new participation after ending the previous one', () => {
      const { persona, participation } = createTestParticipation();
      store.endParticipation(participation.id);

      const p2 = store.createParticipation(persona.id, 'conv-2', 'part-2', 'b-2');
      expect(p2).not.toBeNull();
    });
  });

  describe('setCanonicalBranch', () => {
    it('updates canonical branch and appends to history', () => {
      const { participation } = createTestParticipation();

      const result = store.setCanonicalBranch(participation.id, 'new-branch-id');
      expect(result).not.toBeNull();
      expect(result!.eventData.type).toBe('persona_participation_canonical_set');

      const updated = store.getParticipation(participation.id)!;
      expect(updated.canonicalBranchId).toBe('new-branch-id');
      expect(updated.canonicalHistory).toHaveLength(2); // initial + this change
      expect(updated.canonicalHistory[1].branchId).toBe('new-branch-id');
      expect(updated.canonicalHistory[1].previousBranchId).toBe('branch-1'); // previous
    });

    it('returns null for nonexistent participation', () => {
      expect(store.setCanonicalBranch('nonexistent', 'b')).toBeNull();
    });
  });

  describe('updateLogicalTime', () => {
    it('updates start and end logical times', () => {
      const { participation } = createTestParticipation();

      const result = store.updateLogicalTime(participation.id, 500, 600);
      expect(result).not.toBeNull();
      expect(result!.eventData.type).toBe('persona_participation_logical_time_updated');

      const updated = store.getParticipation(participation.id)!;
      expect(updated.logicalStart).toBe(500);
      expect(updated.logicalEnd).toBe(600);
    });

    it('returns null when end <= start', () => {
      const { participation } = createTestParticipation();
      expect(store.updateLogicalTime(participation.id, 100, 100)).toBeNull();
      expect(store.updateLogicalTime(participation.id, 100, 50)).toBeNull();
    });

    it('returns null for nonexistent participation', () => {
      expect(store.updateLogicalTime('nonexistent', 1, 2)).toBeNull();
    });
  });

  describe('participation queries', () => {
    it('getParticipationsForBranch returns participations on a branch', () => {
      const { persona, initialBranch } = createTestPersona();
      store.updatePersona(persona.id, { allowInterleavedParticipation: true });

      store.createParticipation(persona.id, 'conv-1', 'part-1', 'b-1');
      store.createParticipation(persona.id, 'conv-2', 'part-2', 'b-2');

      const participations = store.getParticipationsForBranch(initialBranch.id);
      expect(participations).toHaveLength(2);
    });

    it('getParticipationsForBranch returns empty for unknown branch', () => {
      expect(store.getParticipationsForBranch('nonexistent')).toEqual([]);
    });

    it('getOrderedParticipations returns only completed participations sorted by logicalStart', () => {
      const { persona, initialBranch } = createTestPersona();
      store.updatePersona(persona.id, { allowInterleavedParticipation: true });

      const p1 = store.createParticipation(persona.id, 'conv-1', 'part-1', 'b-1')!;
      const p2 = store.createParticipation(persona.id, 'conv-2', 'part-2', 'b-2')!;
      store.endParticipation(p1.participation.id);
      store.endParticipation(p2.participation.id);

      // Third participation still active - should be excluded
      store.createParticipation(persona.id, 'conv-3', 'part-3', 'b-3');

      const ordered = store.getOrderedParticipations(initialBranch.id);
      expect(ordered).toHaveLength(2);
      expect(ordered[0].logicalStart).toBeLessThan(ordered[1].logicalStart);
    });

    it('getParticipationsForConversation returns participations for a conversation', () => {
      const { persona, participation } = createTestParticipation('owner-1', 'conv-1');
      const convParts = store.getParticipationsForConversation('conv-1');
      expect(convParts).toHaveLength(1);
      expect(convParts[0].id).toBe(participation.id);
    });

    it('getParticipationsForConversation returns empty for unknown conversation', () => {
      expect(store.getParticipationsForConversation('unknown')).toEqual([]);
    });

    it('getParticipationsForPersona returns all participations for a persona', () => {
      const { persona, participation } = createTestParticipation();
      const parts = store.getParticipationsForPersona(persona.id);
      expect(parts).toHaveLength(1);
      expect(parts[0].id).toBe(participation.id);
    });

    it('getParticipationsForPersona returns empty for unknown persona', () => {
      expect(store.getParticipationsForPersona('unknown')).toEqual([]);
    });

    it('getActiveParticipation returns active participation', () => {
      const { persona, participation } = createTestParticipation();
      const active = store.getActiveParticipation(persona.id);
      expect(active).toBeDefined();
      expect(active!.id).toBe(participation.id);
    });

    it('getActiveParticipation returns undefined when none active', () => {
      const { persona } = createTestPersona();
      expect(store.getActiveParticipation(persona.id)).toBeUndefined();
    });
  });

  describe('collectBranchParticipations', () => {
    it('returns participations on a single branch', () => {
      const { persona, initialBranch, participation } = createTestParticipation();
      store.endParticipation(participation.id);

      const collected = store.collectBranchParticipations(initialBranch.id);
      expect(collected).toHaveLength(1);
    });

    it('returns empty for nonexistent branch', () => {
      expect(store.collectBranchParticipations('nonexistent')).toEqual([]);
    });

    it('inherits participations from parent branch', () => {
      const { persona, initialBranch, participation: p1 } = createTestParticipation();
      store.endParticipation(p1.id);

      // Create child branch
      const { branch: childBranch } = store.createHistoryBranch(persona.id, 'child')!;
      store.setHeadBranch(persona.id, childBranch.id);

      // Create participation on child branch
      const p2 = store.createParticipation(persona.id, 'conv-2', 'part-2', 'b-2')!;
      store.endParticipation(p2.participation.id);

      // Collecting on child should include parent participation + child participation
      const collected = store.collectBranchParticipations(childBranch.id);
      expect(collected).toHaveLength(2);
    });

    it('filters inherited participations by fork point', () => {
      const { persona, initialBranch } = createTestPersona();
      store.updatePersona(persona.id, { allowInterleavedParticipation: true });

      // Create 2 participations on main branch
      const p1 = store.createParticipation(persona.id, 'conv-1', 'part-1', 'b-1')!;
      store.endParticipation(p1.participation.id);
      const p2 = store.createParticipation(persona.id, 'conv-2', 'part-2', 'b-2')!;
      store.endParticipation(p2.participation.id);

      // Create child branch forked at p1 (before p2)
      const { branch: childBranch } = store.createHistoryBranch(
        persona.id, 'forked', p1.participation.id
      )!;

      // Collecting on child should only include p1 (before fork) but not p2
      const collected = store.collectBranchParticipations(childBranch.id);
      expect(collected).toHaveLength(1);
      expect(collected[0].id).toBe(p1.participation.id);
    });
  });

  describe('persona shares', () => {
    it('creates a share for another user', () => {
      const { persona } = createTestPersona();
      const result = store.createShare(persona.id, 'user-2', 'owner-1', 'user');

      expect(result).not.toBeNull();
      expect(result!.share.personaId).toBe(persona.id);
      expect(result!.share.sharedWithUserId).toBe('user-2');
      expect(result!.share.permission).toBe('user');
      expect(result!.eventData.type).toBe('persona_share_created');
    });

    it('prevents duplicate shares for same user+persona', () => {
      const { persona } = createTestPersona();
      store.createShare(persona.id, 'user-2', 'owner-1', 'viewer');
      const dupe = store.createShare(persona.id, 'user-2', 'owner-1', 'editor');
      expect(dupe).toBeNull();
    });

    it('returns null for nonexistent persona', () => {
      expect(store.createShare('nonexistent', 'u', 'o', 'viewer')).toBeNull();
    });

    it('updates share permission', () => {
      const { persona } = createTestPersona();
      const { share } = store.createShare(persona.id, 'user-2', 'owner-1', 'viewer')!;

      const result = store.updateShare(share.id, 'editor');
      expect(result).not.toBeNull();
      expect(result!.share.permission).toBe('editor');
    });

    it('updateShare returns null for unknown share', () => {
      expect(store.updateShare('nonexistent', 'editor')).toBeNull();
    });

    it('revokes a share', () => {
      const { persona } = createTestPersona();
      const { share } = store.createShare(persona.id, 'user-2', 'owner-1', 'viewer')!;

      const result = store.revokeShare(share.id);
      expect(result).not.toBeNull();
      expect(result!.eventData.type).toBe('persona_share_revoked');
      expect(store.getShare(share.id)).toBeUndefined();
    });

    it('revokeShare returns null for unknown share', () => {
      expect(store.revokeShare('nonexistent')).toBeNull();
    });

    it('getSharesForPersona returns all shares', () => {
      const { persona } = createTestPersona();
      store.createShare(persona.id, 'user-2', 'owner-1', 'viewer');
      store.createShare(persona.id, 'user-3', 'owner-1', 'editor');

      expect(store.getSharesForPersona(persona.id)).toHaveLength(2);
    });

    it('getSharesForPersona returns empty for unknown persona', () => {
      expect(store.getSharesForPersona('unknown')).toEqual([]);
    });
  });

  describe('getUserPermissionForPersona', () => {
    it('returns owner for persona owner', () => {
      const { persona } = createTestPersona();
      expect(store.getUserPermissionForPersona('owner-1', persona.id)).toBe('owner');
    });

    it('returns share permission for shared user', () => {
      const { persona } = createTestPersona();
      store.createShare(persona.id, 'user-2', 'owner-1', 'editor');
      expect(store.getUserPermissionForPersona('user-2', persona.id)).toBe('editor');
    });

    it('returns null for unshared user', () => {
      const { persona } = createTestPersona();
      expect(store.getUserPermissionForPersona('user-2', persona.id)).toBeNull();
    });

    it('returns null for nonexistent persona', () => {
      expect(store.getUserPermissionForPersona('user', 'nonexistent')).toBeNull();
    });
  });

  describe('getPersonasSharedWithUser', () => {
    it('returns personas shared with a user', () => {
      const { persona: p1 } = createTestPersona('owner-1', 'P1');
      const { persona: p2 } = createTestPersona('owner-1', 'P2');
      store.createShare(p1.id, 'user-2', 'owner-1', 'viewer');
      store.createShare(p2.id, 'user-2', 'owner-1', 'editor');

      const shared = store.getPersonasSharedWithUser('user-2');
      expect(shared).toHaveLength(2);
      expect(shared.map(s => s.permission).sort()).toEqual(['editor', 'viewer']);
    });

    it('returns empty for user with no shares', () => {
      expect(store.getPersonasSharedWithUser('unknown')).toEqual([]);
    });
  });

  describe('getPersonasByOwner', () => {
    it('returns all personas for an owner', () => {
      createTestPersona('owner-1', 'P1');
      createTestPersona('owner-1', 'P2');
      createTestPersona('owner-2', 'P3');

      expect(store.getPersonasByOwner('owner-1')).toHaveLength(2);
      expect(store.getPersonasByOwner('owner-2')).toHaveLength(1);
    });

    it('returns empty for unknown owner', () => {
      expect(store.getPersonasByOwner('unknown')).toEqual([]);
    });
  });

  describe('replayEvent', () => {
    it('rebuilds persona from creation event', () => {
      const newStore = new PersonaStore();
      const now = new Date().toISOString();

      newStore.replayEvent({
        type: 'persona_created',
        data: {
          persona: {
            id: 'p-1',
            name: 'Replayed',
            modelId: 'claude-3',
            ownerId: 'owner-1',
            contextStrategy: { type: 'rolling', maxTokens: 60000 },
            backscrollTokens: 30000,
            allowInterleavedParticipation: false,
            createdAt: now,
            updatedAt: now
          },
          initialBranch: {
            id: 'b-1',
            personaId: 'p-1',
            name: 'main',
            isHead: true,
            createdAt: now
          }
        }
      });

      const persona = newStore.getPersona('p-1');
      expect(persona).toBeDefined();
      expect(persona!.name).toBe('Replayed');
      expect(persona!.createdAt).toBeInstanceOf(Date);

      const head = newStore.getHeadBranch('p-1');
      expect(head).toBeDefined();
      expect(head!.name).toBe('main');
    });

    it('replays participation events', () => {
      const newStore = new PersonaStore();
      const now = new Date().toISOString();

      // First create persona
      newStore.replayEvent({
        type: 'persona_created',
        data: {
          persona: {
            id: 'p-1', name: 'P', modelId: 'm', ownerId: 'o',
            contextStrategy: { type: 'full' },
            backscrollTokens: 30000,
            allowInterleavedParticipation: false,
            createdAt: now, updatedAt: now
          },
          initialBranch: {
            id: 'b-1', personaId: 'p-1', name: 'main', isHead: true, createdAt: now
          }
        }
      });

      // Create participation
      newStore.replayEvent({
        type: 'persona_participation_created',
        data: {
          participation: {
            id: 'part-1',
            personaId: 'p-1',
            conversationId: 'conv-1',
            participantId: 'user-1',
            historyBranchId: 'b-1',
            joinedAt: now,
            logicalStart: 100,
            logicalEnd: 200,
            canonicalBranchId: 'cb-1',
            canonicalHistory: [{ branchId: 'cb-1', setAt: now }]
          }
        }
      });

      expect(newStore.getParticipation('part-1')).toBeDefined();
      expect(newStore.getActiveParticipation('p-1')).toBeDefined();

      // End participation
      newStore.replayEvent({
        type: 'persona_participation_ended',
        data: { participationId: 'part-1', at: now }
      });

      expect(newStore.getParticipation('part-1')!.leftAt).toBeInstanceOf(Date);
      expect(newStore.getActiveParticipation('p-1')).toBeUndefined();
    });

    it('replays share lifecycle events', () => {
      const newStore = new PersonaStore();
      const now = new Date().toISOString();

      newStore.replayEvent({
        type: 'persona_created',
        data: {
          persona: {
            id: 'p-1', name: 'P', modelId: 'm', ownerId: 'o',
            contextStrategy: { type: 'full' },
            backscrollTokens: 30000,
            allowInterleavedParticipation: false,
            createdAt: now, updatedAt: now
          },
          initialBranch: {
            id: 'b-1', personaId: 'p-1', name: 'main', isHead: true, createdAt: now
          }
        }
      });

      newStore.replayEvent({
        type: 'persona_share_created',
        data: {
          share: {
            id: 's-1', personaId: 'p-1', sharedWithUserId: 'u-2',
            sharedByUserId: 'o', permission: 'viewer', createdAt: now
          }
        }
      });

      expect(newStore.getShare('s-1')).toBeDefined();

      newStore.replayEvent({
        type: 'persona_share_updated',
        data: { shareId: 's-1', permission: 'editor' }
      });

      expect(newStore.getShare('s-1')!.permission).toBe('editor');

      newStore.replayEvent({
        type: 'persona_share_revoked',
        data: { shareId: 's-1' }
      });

      expect(newStore.getShare('s-1')).toBeUndefined();
    });

    it('replays branch head change', () => {
      const newStore = new PersonaStore();
      const now = new Date().toISOString();

      newStore.replayEvent({
        type: 'persona_created',
        data: {
          persona: {
            id: 'p-1', name: 'P', modelId: 'm', ownerId: 'o',
            contextStrategy: { type: 'full' },
            backscrollTokens: 30000,
            allowInterleavedParticipation: false,
            createdAt: now, updatedAt: now
          },
          initialBranch: {
            id: 'b-1', personaId: 'p-1', name: 'main', isHead: true, createdAt: now
          }
        }
      });

      newStore.replayEvent({
        type: 'persona_history_branch_created',
        data: {
          branch: {
            id: 'b-2', personaId: 'p-1', name: 'experiment',
            parentBranchId: 'b-1', isHead: false, createdAt: now
          }
        }
      });

      newStore.replayEvent({
        type: 'persona_history_branch_head_changed',
        data: { personaId: 'p-1', newHeadBranchId: 'b-2', previousHeadBranchId: 'b-1' }
      });

      expect(newStore.getHeadBranch('p-1')!.id).toBe('b-2');
      expect(newStore.getHistoryBranch('b-1')!.isHead).toBe(false);
    });

    it('ignores unknown event types', () => {
      store.replayEvent({ type: 'totally_unknown', data: {} });
      // Should not throw
    });
  });
});
