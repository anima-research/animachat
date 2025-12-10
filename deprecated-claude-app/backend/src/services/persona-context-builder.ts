import { Message, Persona, PersonaParticipation, PersonaHistoryBranch } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { Logger } from '../utils/logger.js';

interface CanonicalHistory {
  conversationId: string;
  messages: Message[];
  logicalTime: { start: number; end: number };
}

/**
 * PersonaContextBuilder - Assembles context for persona-linked participants
 *
 * This service builds the accumulated history for a persona by:
 * 1. Following the persona's history branch lineage
 * 2. Extracting messages from each participation's canonical branch
 * 3. Ordering participations by logical time
 * 4. Applying the persona's context strategy (rolling/anchored)
 * 5. Adding backscroll from the current conversation
 */
export class PersonaContextBuilder {
  constructor(private db: Database) {}

  /**
   * Build full context for a persona participant by ID
   *
   * @param personaId - The persona ID
   * @param currentConversationId - The current conversation ID
   * @param currentMessages - Messages from current conversation (for backscroll)
   * @returns Array of messages ordered chronologically (oldest first)
   */
  async buildPersonaContextById(
    personaId: string,
    currentConversationId: string,
    currentMessages: Message[]
  ): Promise<Message[]> {
    const persona = await this.db.getPersona(personaId);
    if (!persona) {
      Logger.error(`[PersonaContextBuilder] Persona ${personaId} not found`);
      return currentMessages;
    }

    return this.buildPersonaContext(persona, currentConversationId, currentMessages);
  }

  /**
   * Build full context for a persona participant
   *
   * @param persona - The persona configuration
   * @param currentConversationId - The current conversation ID
   * @param currentMessages - Messages from current conversation (for backscroll)
   * @returns Array of messages ordered chronologically (oldest first)
   */
  async buildPersonaContext(
    persona: Persona,
    currentConversationId: string,
    currentMessages: Message[]
  ): Promise<Message[]> {
    Logger.debug(`[PersonaContextBuilder] Building context for persona ${persona.name} (${persona.id})`);

    // Step 1: Get the persona's HEAD branch
    const branches = this.db.getPersonaHistoryBranches(persona.id);
    const headBranch = branches.find(b => b.isHead);

    if (!headBranch) {
      Logger.error(`[PersonaContextBuilder] No HEAD branch found for persona ${persona.id}`);
      return this.getBackscroll(currentMessages, persona.backscrollTokens);
    }

    // Step 2: Collect ordered participations following branch inheritance
    const orderedParticipations = this.collectOrderedParticipations(headBranch.id);

    Logger.debug(`[PersonaContextBuilder] Found ${orderedParticipations.length} participations in history`);

    // Step 3: Extract canonical history for each participation
    const historicalMessages: Message[] = [];

    for (const participation of orderedParticipations) {
      // Skip the current conversation (we'll add backscroll separately)
      if (participation.conversationId === currentConversationId) {
        continue;
      }

      const messages = await this.extractCanonicalBranchMessages(participation);
      historicalMessages.push(...messages);
    }

    Logger.debug(`[PersonaContextBuilder] Extracted ${historicalMessages.length} historical messages`);

    // Step 4: Apply context strategy to historical messages
    const strategyMessages = this.applyContextStrategy(
      persona,
      historicalMessages
    );

    // Step 5: Add backscroll from current conversation
    const backscrollMessages = this.getBackscroll(
      currentMessages,
      persona.backscrollTokens
    );

    // Combine: historical context + current backscroll
    const fullContext = [...strategyMessages, ...backscrollMessages];

    Logger.debug(`[PersonaContextBuilder] Final context: ${strategyMessages.length} historical + ${backscrollMessages.length} backscroll = ${fullContext.length} total messages`);

    return fullContext;
  }

  /**
   * Collect participations in logical time order, following branch inheritance
   *
   * @param branchId - The history branch ID to start from (usually HEAD)
   * @returns Ordered participations (oldest first)
   */
  private collectOrderedParticipations(branchId: string): PersonaParticipation[] {
    // Get participations for this branch
    const directParticipations = this.db.collectPersonaBranchParticipations(branchId);

    // Get the branch to check for parent
    const branches = this.db.getPersonaHistoryBranches(branchId);
    const branch = branches.find(b => b.id === branchId);

    // If branch has a parent, recursively collect parent participations
    let parentParticipations: PersonaParticipation[] = [];
    if (branch?.parentBranchId) {
      parentParticipations = this.collectOrderedParticipations(branch.parentBranchId);
    }

    // Combine: parent history first, then this branch's participations
    const allParticipations = [...parentParticipations, ...directParticipations];

    // Sort by logical time
    return allParticipations
      .filter(p => p.leftAt != null) // Only completed participations
      .sort((a, b) => a.logicalStart - b.logicalStart);
  }

  /**
   * Extract messages from a participation's canonical branch path
   *
   * @param participation - The participation record
   * @returns Messages from the canonical branch, ordered chronologically
   */
  private async extractCanonicalBranchMessages(
    participation: PersonaParticipation
  ): Promise<Message[]> {
    // Use the pre-computed canonical history if available
    if (participation.canonicalHistory && participation.canonicalHistory.length > 0) {
      Logger.debug(`[PersonaContextBuilder] Using cached canonical history for participation ${participation.id}`);

      // Load the actual message objects
      const messages: Message[] = [];
      for (const entry of participation.canonicalHistory) {
        // Get all messages for this conversation (we need to load them to get content)
        const conversationMessages = await this.db.getConversationMessages(
          participation.conversationId,
          await this.getConversationOwnerId(participation.conversationId)
        );

        // Find the message with this branch
        const message = conversationMessages.find(m =>
          m.branches.some(b => b.id === entry.branchId)
        );

        if (message) {
          messages.push(message);
        }
      }

      return messages;
    }

    // Fallback: Build canonical path by following branches backwards
    Logger.debug(`[PersonaContextBuilder] Building canonical path for participation ${participation.id}`);

    const conversationMessages = await this.db.getConversationMessages(
      participation.conversationId,
      await this.getConversationOwnerId(participation.conversationId)
    );

    // Build path following canonical branch backwards to root
    const path: Message[] = [];
    let currentBranchId: string | null = participation.canonicalBranchId;

    // Build map for quick lookup
    const messagesByBranchId = new Map<string, Message>();
    for (const msg of conversationMessages) {
      for (const branch of msg.branches) {
        messagesByBranchId.set(branch.id, msg);
      }
    }

    // Follow the branch path backwards
    while (currentBranchId && currentBranchId !== 'root') {
      const message = messagesByBranchId.get(currentBranchId);
      if (!message) break;

      path.unshift(message); // Add to beginning (building backwards)

      // Get parent branch
      const branch = message.branches.find(b => b.id === currentBranchId);
      currentBranchId = branch?.parentBranchId || null;
    }

    return path;
  }

  /**
   * Apply the persona's context strategy to historical messages
   *
   * @param persona - The persona with context strategy config
   * @param messages - Historical messages to apply strategy to
   * @returns Filtered messages according to strategy
   */
  private applyContextStrategy(
    persona: Persona,
    messages: Message[]
  ): Message[] {
    if (messages.length === 0) return [];

    const strategy = persona.contextStrategy;

    if (strategy.type === 'rolling') {
      // Rolling window: keep most recent messages up to maxTokens
      const maxTokens = strategy.maxTokens || 60000;
      return this.takeLastByTokens(messages, maxTokens);
    } else if (strategy.type === 'anchored') {
      // Anchored: keep prefix + rolling suffix
      const prefixTokens = strategy.prefixTokens || 10000;
      const rollingTokens = strategy.rollingTokens || 50000;

      const prefix = this.takeFirstByTokens(messages, prefixTokens);
      const remainingMessages = messages.slice(prefix.length);
      const suffix = this.takeLastByTokens(remainingMessages, rollingTokens);

      return [...prefix, ...suffix];
    }

    return messages;
  }

  /**
   * Get backscroll messages from current conversation
   *
   * @param messages - Messages from current conversation
   * @param maxTokens - Maximum tokens for backscroll
   * @returns Most recent messages up to maxTokens
   */
  private getBackscroll(messages: Message[], maxTokens: number): Message[] {
    return this.takeLastByTokens(messages, maxTokens);
  }

  /**
   * Take first N messages up to token limit
   */
  private takeFirstByTokens(messages: Message[], maxTokens: number): Message[] {
    const result: Message[] = [];
    let tokenCount = 0;

    for (const message of messages) {
      const messageTokens = this.estimateTokens(message);
      if (tokenCount + messageTokens > maxTokens) break;

      result.push(message);
      tokenCount += messageTokens;
    }

    return result;
  }

  /**
   * Take last N messages up to token limit (most recent)
   */
  private takeLastByTokens(messages: Message[], maxTokens: number): Message[] {
    const result: Message[] = [];
    let tokenCount = 0;

    // Iterate backwards
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const messageTokens = this.estimateTokens(message);
      if (tokenCount + messageTokens > maxTokens) break;

      result.unshift(message); // Add to beginning to maintain order
      tokenCount += messageTokens;
    }

    return result;
  }

  /**
   * Estimate tokens for a message (simple character count / 4)
   */
  private estimateTokens(message: Message): number {
    // Rough estimate: 1 token ~= 4 characters
    // Get content from the active branch
    const activeBranch = message.branches.find(b => b.id === message.activeBranchId);
    const contentLength = activeBranch?.content?.length || 0;
    return Math.ceil(contentLength / 4);
  }

  /**
   * Helper to get conversation owner ID
   */
  private getConversationOwnerId(conversationId: string): string {
    const conversation = this.db.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    return conversation.userId;
  }
}
