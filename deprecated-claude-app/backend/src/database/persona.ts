import { v4 as uuidv4 } from 'uuid';
import {
  Persona,
  PersonaHistoryBranch,
  PersonaParticipation,
  PersonaShare,
  PersonaPermission,
  CreatePersonaRequest,
  UpdatePersonaRequest,
  DEFAULT_PERSONA_CONTEXT_STRATEGY
} from '@deprecated-claude/shared';

// Event types for persona system
export type PersonaEventType =
  | 'persona_created'
  | 'persona_updated'
  | 'persona_archived'
  | 'persona_deleted'
  | 'persona_history_branch_created'
  | 'persona_history_branch_head_changed'
  | 'persona_participation_created'
  | 'persona_participation_ended'
  | 'persona_participation_canonical_set'
  | 'persona_participation_logical_time_updated'
  | 'persona_share_created'
  | 'persona_share_updated'
  | 'persona_share_revoked';

export interface PersonaEvent {
  type: PersonaEventType;
  data: any;
}

// Default gap for logical time assignments
const LOGICAL_TIME_GAP = 100;

export class PersonaStore {
  // Persona storage
  private personas: Map<string, Persona> = new Map();
  private personasByOwner: Map<string, Set<string>> = new Map();

  // History branches storage
  private historyBranches: Map<string, PersonaHistoryBranch> = new Map();
  private branchesByPersona: Map<string, Set<string>> = new Map();

  // Participations storage
  private participations: Map<string, PersonaParticipation> = new Map();
  private participationsByPersona: Map<string, Set<string>> = new Map();
  private participationsByBranch: Map<string, Set<string>> = new Map();
  private participationsByConversation: Map<string, Set<string>> = new Map();
  private activeParticipationByPersona: Map<string, string> = new Map(); // personaId -> participationId (if active)

  // Shares storage
  private shares: Map<string, PersonaShare> = new Map();
  private sharesByPersona: Map<string, Set<string>> = new Map();
  private sharesByUser: Map<string, Set<string>> = new Map();

  // ============================================================================
  // Event Replay
  // ============================================================================

  replayEvent(event: { type: string; data: any }): void {
    switch (event.type) {
      case 'persona_created':
        this.applyPersonaCreated(event.data);
        break;
      case 'persona_updated':
        this.applyPersonaUpdated(event.data);
        break;
      case 'persona_archived':
        this.applyPersonaArchived(event.data);
        break;
      case 'persona_deleted':
        this.applyPersonaDeleted(event.data);
        break;
      case 'persona_history_branch_created':
        this.applyHistoryBranchCreated(event.data);
        break;
      case 'persona_history_branch_head_changed':
        this.applyHistoryBranchHeadChanged(event.data);
        break;
      case 'persona_participation_created':
        this.applyParticipationCreated(event.data);
        break;
      case 'persona_participation_ended':
        this.applyParticipationEnded(event.data);
        break;
      case 'persona_participation_canonical_set':
        this.applyCanonicalSet(event.data);
        break;
      case 'persona_participation_logical_time_updated':
        this.applyLogicalTimeUpdated(event.data);
        break;
      case 'persona_share_created':
        this.applyShareCreated(event.data);
        break;
      case 'persona_share_updated':
        this.applyShareUpdated(event.data);
        break;
      case 'persona_share_revoked':
        this.applyShareRevoked(event.data);
        break;
    }
  }

  // ============================================================================
  // Apply Methods (state mutations from events)
  // ============================================================================

  private applyPersonaCreated(data: { persona: Persona; initialBranch: PersonaHistoryBranch }): void {
    const persona = {
      ...data.persona,
      createdAt: new Date(data.persona.createdAt),
      updatedAt: new Date(data.persona.updatedAt),
      archivedAt: data.persona.archivedAt ? new Date(data.persona.archivedAt) : undefined
    };
    this.personas.set(persona.id, persona);

    const ownerPersonas = this.personasByOwner.get(persona.ownerId) || new Set();
    ownerPersonas.add(persona.id);
    this.personasByOwner.set(persona.ownerId, ownerPersonas);

    // Apply initial branch
    this.applyHistoryBranchCreated({ branch: data.initialBranch });
  }

  private applyPersonaUpdated(data: { personaId: string; changes: Partial<Persona> }): void {
    const persona = this.personas.get(data.personaId);
    if (!persona) return;

    Object.assign(persona, data.changes, { updatedAt: new Date() });
  }

  private applyPersonaArchived(data: { personaId: string; at: Date | string }): void {
    const persona = this.personas.get(data.personaId);
    if (!persona) return;

    persona.archivedAt = new Date(data.at);
    persona.updatedAt = new Date();
  }

  private applyPersonaDeleted(data: { personaId: string }): void {
    const persona = this.personas.get(data.personaId);
    if (!persona) return;

    // Remove from owner index
    const ownerPersonas = this.personasByOwner.get(persona.ownerId);
    if (ownerPersonas) {
      ownerPersonas.delete(data.personaId);
    }

    // Remove shares
    const personaShares = this.sharesByPersona.get(data.personaId);
    if (personaShares) {
      for (const shareId of personaShares) {
        const share = this.shares.get(shareId);
        if (share) {
          const userShares = this.sharesByUser.get(share.sharedWithUserId);
          if (userShares) userShares.delete(shareId);
        }
        this.shares.delete(shareId);
      }
      this.sharesByPersona.delete(data.personaId);
    }

    // Note: We don't delete branches and participations to preserve history
    // They become orphaned but that's intentional for audit purposes

    this.personas.delete(data.personaId);
  }

  private applyHistoryBranchCreated(data: { branch: PersonaHistoryBranch }): void {
    const branch = {
      ...data.branch,
      createdAt: new Date(data.branch.createdAt)
    };
    this.historyBranches.set(branch.id, branch);

    const personaBranches = this.branchesByPersona.get(branch.personaId) || new Set();
    personaBranches.add(branch.id);
    this.branchesByPersona.set(branch.personaId, personaBranches);
  }

  private applyHistoryBranchHeadChanged(data: {
    personaId: string;
    newHeadBranchId: string;
    previousHeadBranchId?: string;
  }): void {
    // Unset previous head
    if (data.previousHeadBranchId) {
      const prevBranch = this.historyBranches.get(data.previousHeadBranchId);
      if (prevBranch) {
        prevBranch.isHead = false;
      }
    }

    // Set new head
    const newBranch = this.historyBranches.get(data.newHeadBranchId);
    if (newBranch) {
      newBranch.isHead = true;
    }
  }

  private applyParticipationCreated(data: { participation: PersonaParticipation }): void {
    const participation = {
      ...data.participation,
      joinedAt: new Date(data.participation.joinedAt),
      leftAt: data.participation.leftAt ? new Date(data.participation.leftAt) : undefined,
      canonicalHistory: data.participation.canonicalHistory?.map((h: any) => ({
        ...h,
        setAt: new Date(h.setAt)
      })) || []
    };
    this.participations.set(participation.id, participation);

    // Index by persona
    const personaParticipations = this.participationsByPersona.get(participation.personaId) || new Set();
    personaParticipations.add(participation.id);
    this.participationsByPersona.set(participation.personaId, personaParticipations);

    // Index by branch
    const branchParticipations = this.participationsByBranch.get(participation.historyBranchId) || new Set();
    branchParticipations.add(participation.id);
    this.participationsByBranch.set(participation.historyBranchId, branchParticipations);

    // Index by conversation
    const convParticipations = this.participationsByConversation.get(participation.conversationId) || new Set();
    convParticipations.add(participation.id);
    this.participationsByConversation.set(participation.conversationId, convParticipations);

    // Track active participation
    if (!participation.leftAt) {
      this.activeParticipationByPersona.set(participation.personaId, participation.id);
    }
  }

  private applyParticipationEnded(data: { participationId: string; at: Date | string }): void {
    const participation = this.participations.get(data.participationId);
    if (!participation) return;

    participation.leftAt = new Date(data.at);

    // Clear active participation
    if (this.activeParticipationByPersona.get(participation.personaId) === data.participationId) {
      this.activeParticipationByPersona.delete(participation.personaId);
    }
  }

  private applyCanonicalSet(data: {
    participationId: string;
    branchId: string;
    previousBranchId?: string;
  }): void {
    const participation = this.participations.get(data.participationId);
    if (!participation) return;

    participation.canonicalBranchId = data.branchId;
    participation.canonicalHistory.push({
      branchId: data.branchId,
      setAt: new Date(),
      previousBranchId: data.previousBranchId
    });
  }

  private applyLogicalTimeUpdated(data: {
    participationId: string;
    logicalStart: number;
    logicalEnd: number;
  }): void {
    const participation = this.participations.get(data.participationId);
    if (!participation) return;

    participation.logicalStart = data.logicalStart;
    participation.logicalEnd = data.logicalEnd;
  }

  private applyShareCreated(data: { share: PersonaShare }): void {
    const share = {
      ...data.share,
      createdAt: new Date(data.share.createdAt)
    };
    this.shares.set(share.id, share);

    const personaShares = this.sharesByPersona.get(share.personaId) || new Set();
    personaShares.add(share.id);
    this.sharesByPersona.set(share.personaId, personaShares);

    const userShares = this.sharesByUser.get(share.sharedWithUserId) || new Set();
    userShares.add(share.id);
    this.sharesByUser.set(share.sharedWithUserId, userShares);
  }

  private applyShareUpdated(data: { shareId: string; permission: PersonaPermission }): void {
    const share = this.shares.get(data.shareId);
    if (!share) return;

    share.permission = data.permission;
  }

  private applyShareRevoked(data: { shareId: string }): void {
    const share = this.shares.get(data.shareId);
    if (!share) return;

    // Remove from indexes
    const personaShares = this.sharesByPersona.get(share.personaId);
    if (personaShares) personaShares.delete(data.shareId);

    const userShares = this.sharesByUser.get(share.sharedWithUserId);
    if (userShares) userShares.delete(data.shareId);

    this.shares.delete(data.shareId);
  }

  // ============================================================================
  // Mutation Methods (return event data for persistence)
  // ============================================================================

  createPersona(
    ownerId: string,
    request: CreatePersonaRequest
  ): { persona: Persona; initialBranch: PersonaHistoryBranch; eventData: PersonaEvent } {
    const now = new Date();
    const personaId = uuidv4();
    const branchId = uuidv4();

    const persona: Persona = {
      id: personaId,
      name: request.name,
      modelId: request.modelId,
      ownerId,
      contextStrategy: request.contextStrategy || DEFAULT_PERSONA_CONTEXT_STRATEGY,
      backscrollTokens: request.backscrollTokens ?? 30000,
      allowInterleavedParticipation: request.allowInterleavedParticipation ?? false,
      createdAt: now,
      updatedAt: now
    };

    const initialBranch: PersonaHistoryBranch = {
      id: branchId,
      personaId,
      name: 'main',
      isHead: true,
      createdAt: now
    };

    // Apply state
    this.applyPersonaCreated({ persona, initialBranch });

    return {
      persona,
      initialBranch,
      eventData: {
        type: 'persona_created',
        data: { persona, initialBranch }
      }
    };
  }

  updatePersona(
    personaId: string,
    request: UpdatePersonaRequest
  ): { persona: Persona; eventData: PersonaEvent } | null {
    const persona = this.personas.get(personaId);
    if (!persona) return null;

    const changes: Partial<Persona> = {};
    if (request.name !== undefined) changes.name = request.name;
    if (request.contextStrategy !== undefined) changes.contextStrategy = request.contextStrategy;
    if (request.backscrollTokens !== undefined) changes.backscrollTokens = request.backscrollTokens;
    if (request.allowInterleavedParticipation !== undefined) {
      changes.allowInterleavedParticipation = request.allowInterleavedParticipation;
    }

    this.applyPersonaUpdated({ personaId, changes });

    return {
      persona: this.personas.get(personaId)!,
      eventData: {
        type: 'persona_updated',
        data: { personaId, changes }
      }
    };
  }

  archivePersona(personaId: string): { eventData: PersonaEvent } | null {
    const persona = this.personas.get(personaId);
    if (!persona) return null;

    const at = new Date();
    this.applyPersonaArchived({ personaId, at });

    return {
      eventData: {
        type: 'persona_archived',
        data: { personaId, at }
      }
    };
  }

  deletePersona(personaId: string): { eventData: PersonaEvent } | null {
    const persona = this.personas.get(personaId);
    if (!persona) return null;

    this.applyPersonaDeleted({ personaId });

    return {
      eventData: {
        type: 'persona_deleted',
        data: { personaId }
      }
    };
  }

  createHistoryBranch(
    personaId: string,
    name: string,
    forkPointParticipationId?: string
  ): { branch: PersonaHistoryBranch; eventData: PersonaEvent } | null {
    const persona = this.personas.get(personaId);
    if (!persona) return null;

    // Get current HEAD branch
    const currentHead = this.getHeadBranch(personaId);
    if (!currentHead) return null;

    const branch: PersonaHistoryBranch = {
      id: uuidv4(),
      personaId,
      name,
      parentBranchId: currentHead.id,
      forkPointParticipationId,
      isHead: false,
      createdAt: new Date()
    };

    this.applyHistoryBranchCreated({ branch });

    return {
      branch,
      eventData: {
        type: 'persona_history_branch_created',
        data: { branch }
      }
    };
  }

  setHeadBranch(
    personaId: string,
    branchId: string
  ): { eventData: PersonaEvent } | null {
    const branch = this.historyBranches.get(branchId);
    if (!branch || branch.personaId !== personaId) return null;

    const currentHead = this.getHeadBranch(personaId);
    const previousHeadBranchId = currentHead?.id;

    this.applyHistoryBranchHeadChanged({ personaId, newHeadBranchId: branchId, previousHeadBranchId });

    return {
      eventData: {
        type: 'persona_history_branch_head_changed',
        data: { personaId, newHeadBranchId: branchId, previousHeadBranchId }
      }
    };
  }

  createParticipation(
    personaId: string,
    conversationId: string,
    participantId: string,
    canonicalBranchId: string
  ): { participation: PersonaParticipation; eventData: PersonaEvent } | null {
    const persona = this.personas.get(personaId);
    if (!persona) return null;

    // Check if persona is archived
    if (persona.archivedAt) return null;

    // Check sequential participation constraint
    if (!persona.allowInterleavedParticipation) {
      const activeParticipationId = this.activeParticipationByPersona.get(personaId);
      if (activeParticipationId) {
        // Already in a conversation
        return null;
      }
    }

    const headBranch = this.getHeadBranch(personaId);
    if (!headBranch) return null;

    // Calculate next logical time
    const { start, end } = this.getNextLogicalTime(headBranch.id);

    const participation: PersonaParticipation = {
      id: uuidv4(),
      personaId,
      conversationId,
      participantId,
      historyBranchId: headBranch.id,
      joinedAt: new Date(),
      logicalStart: start,
      logicalEnd: end,
      canonicalBranchId,
      canonicalHistory: [{
        branchId: canonicalBranchId,
        setAt: new Date()
      }]
    };

    this.applyParticipationCreated({ participation });

    return {
      participation,
      eventData: {
        type: 'persona_participation_created',
        data: { participation }
      }
    };
  }

  endParticipation(participationId: string): { eventData: PersonaEvent } | null {
    const participation = this.participations.get(participationId);
    if (!participation || participation.leftAt) return null;

    const at = new Date();
    this.applyParticipationEnded({ participationId, at });

    return {
      eventData: {
        type: 'persona_participation_ended',
        data: { participationId, at }
      }
    };
  }

  setCanonicalBranch(
    participationId: string,
    branchId: string
  ): { eventData: PersonaEvent } | null {
    const participation = this.participations.get(participationId);
    if (!participation) return null;

    const previousBranchId = participation.canonicalBranchId;
    this.applyCanonicalSet({ participationId, branchId, previousBranchId });

    return {
      eventData: {
        type: 'persona_participation_canonical_set',
        data: { participationId, branchId, previousBranchId }
      }
    };
  }

  updateLogicalTime(
    participationId: string,
    logicalStart: number,
    logicalEnd: number
  ): { eventData: PersonaEvent } | null {
    const participation = this.participations.get(participationId);
    if (!participation) return null;

    if (logicalEnd <= logicalStart) return null;

    const previous = {
      logicalStart: participation.logicalStart,
      logicalEnd: participation.logicalEnd
    };

    this.applyLogicalTimeUpdated({ participationId, logicalStart, logicalEnd });

    return {
      eventData: {
        type: 'persona_participation_logical_time_updated',
        data: { participationId, logicalStart, logicalEnd, previous }
      }
    };
  }

  createShare(
    personaId: string,
    sharedWithUserId: string,
    sharedByUserId: string,
    permission: PersonaPermission
  ): { share: PersonaShare; eventData: PersonaEvent } | null {
    const persona = this.personas.get(personaId);
    if (!persona) return null;

    // Check if share already exists
    const existingShareId = this.findShareByUserAndPersona(sharedWithUserId, personaId);
    if (existingShareId) return null;

    const share: PersonaShare = {
      id: uuidv4(),
      personaId,
      sharedWithUserId,
      sharedByUserId,
      permission,
      createdAt: new Date()
    };

    this.applyShareCreated({ share });

    return {
      share,
      eventData: {
        type: 'persona_share_created',
        data: { share }
      }
    };
  }

  updateShare(
    shareId: string,
    permission: PersonaPermission
  ): { share: PersonaShare; eventData: PersonaEvent } | null {
    const share = this.shares.get(shareId);
    if (!share) return null;

    this.applyShareUpdated({ shareId, permission });

    return {
      share: this.shares.get(shareId)!,
      eventData: {
        type: 'persona_share_updated',
        data: { shareId, permission }
      }
    };
  }

  revokeShare(shareId: string): { eventData: PersonaEvent } | null {
    const share = this.shares.get(shareId);
    if (!share) return null;

    this.applyShareRevoked({ shareId });

    return {
      eventData: {
        type: 'persona_share_revoked',
        data: { shareId }
      }
    };
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  getPersona(personaId: string): Persona | undefined {
    return this.personas.get(personaId);
  }

  getPersonasByOwner(ownerId: string): Persona[] {
    const personaIds = this.personasByOwner.get(ownerId);
    if (!personaIds) return [];
    return Array.from(personaIds)
      .map(id => this.personas.get(id))
      .filter((p): p is Persona => p !== undefined);
  }

  getPersonasSharedWithUser(userId: string): Array<{ persona: Persona; permission: PersonaPermission }> {
    const shareIds = this.sharesByUser.get(userId);
    if (!shareIds) return [];

    const result: Array<{ persona: Persona; permission: PersonaPermission }> = [];
    for (const shareId of shareIds) {
      const share = this.shares.get(shareId);
      if (share) {
        const persona = this.personas.get(share.personaId);
        if (persona) {
          result.push({ persona, permission: share.permission });
        }
      }
    }
    return result;
  }

  getUserPermissionForPersona(userId: string, personaId: string): PersonaPermission | null {
    const persona = this.personas.get(personaId);
    if (!persona) return null;

    // Owner has owner permission
    if (persona.ownerId === userId) return 'owner';

    // Check shares
    const shareId = this.findShareByUserAndPersona(userId, personaId);
    if (shareId) {
      const share = this.shares.get(shareId);
      return share?.permission ?? null;
    }

    return null;
  }

  getHeadBranch(personaId: string): PersonaHistoryBranch | undefined {
    const branchIds = this.branchesByPersona.get(personaId);
    if (!branchIds) return undefined;

    for (const branchId of branchIds) {
      const branch = this.historyBranches.get(branchId);
      if (branch?.isHead) return branch;
    }
    return undefined;
  }

  getHistoryBranches(personaId: string): PersonaHistoryBranch[] {
    const branchIds = this.branchesByPersona.get(personaId);
    if (!branchIds) return [];
    return Array.from(branchIds)
      .map(id => this.historyBranches.get(id))
      .filter((b): b is PersonaHistoryBranch => b !== undefined);
  }

  getHistoryBranch(branchId: string): PersonaHistoryBranch | undefined {
    return this.historyBranches.get(branchId);
  }

  getParticipation(participationId: string): PersonaParticipation | undefined {
    return this.participations.get(participationId);
  }

  getParticipationsForBranch(branchId: string): PersonaParticipation[] {
    const participationIds = this.participationsByBranch.get(branchId);
    if (!participationIds) return [];
    return Array.from(participationIds)
      .map(id => this.participations.get(id))
      .filter((p): p is PersonaParticipation => p !== undefined);
  }

  getOrderedParticipations(branchId: string): PersonaParticipation[] {
    return this.getParticipationsForBranch(branchId)
      .filter(p => p.leftAt != null) // Only completed participations
      .sort((a, b) => a.logicalStart - b.logicalStart);
  }

  getActiveParticipation(personaId: string): PersonaParticipation | undefined {
    const participationId = this.activeParticipationByPersona.get(personaId);
    if (!participationId) return undefined;
    return this.participations.get(participationId);
  }

  getParticipationsForConversation(conversationId: string): PersonaParticipation[] {
    const participationIds = this.participationsByConversation.get(conversationId);
    if (!participationIds) return [];
    return Array.from(participationIds)
      .map(id => this.participations.get(id))
      .filter((p): p is PersonaParticipation => p !== undefined);
  }

  getParticipationsForPersona(personaId: string): PersonaParticipation[] {
    const participationIds = this.participationsByPersona.get(personaId);
    if (!participationIds) return [];
    return Array.from(participationIds)
      .map(id => this.participations.get(id))
      .filter((p): p is PersonaParticipation => p !== undefined);
  }

  getSharesForPersona(personaId: string): PersonaShare[] {
    const shareIds = this.sharesByPersona.get(personaId);
    if (!shareIds) return [];
    return Array.from(shareIds)
      .map(id => this.shares.get(id))
      .filter((s): s is PersonaShare => s !== undefined);
  }

  getShare(shareId: string): PersonaShare | undefined {
    return this.shares.get(shareId);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private findShareByUserAndPersona(userId: string, personaId: string): string | null {
    const userShares = this.sharesByUser.get(userId);
    if (!userShares) return null;

    for (const shareId of userShares) {
      const share = this.shares.get(shareId);
      if (share?.personaId === personaId) {
        return shareId;
      }
    }
    return null;
  }

  private getNextLogicalTime(branchId: string): { start: number; end: number } {
    const participations = this.getParticipationsForBranch(branchId);
    const maxEnd = participations.length > 0
      ? Math.max(...participations.map(p => p.logicalEnd))
      : 0;

    return {
      start: maxEnd + LOGICAL_TIME_GAP,
      end: maxEnd + LOGICAL_TIME_GAP + LOGICAL_TIME_GAP
    };
  }

  /**
   * Collect participations for a branch including inherited from parent branches.
   * Used for context building.
   */
  collectBranchParticipations(branchId: string): PersonaParticipation[] {
    const branch = this.historyBranches.get(branchId);
    if (!branch) return [];

    // Get participations directly on this branch
    const directParticipations = this.getParticipationsForBranch(branchId);

    // If this branch has a parent, get inherited participations
    if (branch.parentBranchId) {
      const parentParticipations = this.collectBranchParticipations(branch.parentBranchId);

      // Filter parent participations to only include those before fork point
      if (branch.forkPointParticipationId) {
        const forkPoint = this.participations.get(branch.forkPointParticipationId);
        if (forkPoint) {
          const inherited = parentParticipations.filter(
            p => p.logicalStart < forkPoint.logicalEnd
          );
          return [...inherited, ...directParticipations];
        }
      }

      return [...parentParticipations, ...directParticipations];
    }

    return directParticipations;
  }
}
