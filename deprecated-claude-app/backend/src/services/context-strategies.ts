import { Message, ContextManagement } from '@deprecated-claude/shared';
import { Logger } from '../utils/logger.js';

export interface CacheMarker {
  messageId: string;
  messageIndex: number;
  tokenCount: number;
}

export interface ContextWindow {
  messages: Message[];
  cacheablePrefix: Message[];
  activeWindow: Message[];
  cacheMarker?: CacheMarker; // Legacy single marker (deprecated)
  cacheMarkers?: CacheMarker[]; // Multiple cache markers (4 for Anthropic)
  metadata: {
    totalMessages: number;
    totalTokens: number;
    windowStart: number;
    windowEnd: number;
    lastRotation: Date | null;
    cacheKey?: string;
  };
}

export interface ContextStrategy {
  name: string;
  prepareContext(
    messages: Message[], 
    newMessage?: Message,
    currentCacheMarker?: CacheMarker,
    modelMaxContext?: number // Model's maximum context window in tokens
  ): ContextWindow;
  shouldRotate(currentWindow: ContextWindow): boolean;
  getCacheBreakpoint(messages: Message[]): number;
}

// Simplified token counting - in production, use tiktoken or similar
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function isImageAttachment(fileName?: string): boolean {
  if (!fileName) return false;
  // Note: GIF excluded - Anthropic API has issues with some GIF formats
  // BMP and SVG also excluded - not widely supported by vision APIs
  const imageExtensions = ['jpg', 'jpeg', 'png', 'webp'];
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return imageExtensions.includes(ext);
}

function getMessageTokens(message: Message): number {
  const branch = message.branches.find(b => b.id === message.activeBranchId);
  if (!branch) return 0;
  
  let tokens = estimateTokens(branch.content);
  
  // Include contentBlocks (thinking) in token count
  // In prefill mode, thinking blocks are prepended to the message content
  // so we must count them to accurately estimate total tokens sent to the API
  if (branch.contentBlocks && branch.contentBlocks.length > 0) {
    for (const block of branch.contentBlocks) {
      if (block.type === 'thinking' && block.thinking) {
        // Thinking content + XML tags overhead: <thinking>\n...\n</thinking>\n\n
        tokens += estimateTokens(block.thinking) + 10; // ~10 tokens for tags
      } else if (block.type === 'redacted_thinking') {
        // Redacted thinking: <thinking>[Redacted for safety]</thinking>\n\n
        tokens += 15; // Fixed overhead for redacted content
      }
    }
  }
  
  // Include attachments in token count
  if (branch.attachments && branch.attachments.length > 0) {
    for (const attachment of branch.attachments) {
      let attachmentTokens = 0;
      
      if (isImageAttachment(attachment.fileName)) {
        // Images: Anthropic counts as ~1500 tokens regardless of size
        attachmentTokens = 1500;
      } else {
        // Text attachments: use length/4 estimation
        attachmentTokens = estimateTokens(attachment.content);
      }
      
      tokens += attachmentTokens;
    }
  }
  
  return tokens;
}

function getTotalTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + getMessageTokens(msg), 0);
}

/**
 * Helper to find the nearest preceding user message for cache placement
 * This works around OpenRouter/Anthropic issues where caching on Assistant messages fails
 */
function findNearestUserMessage(
  messages: Message[], 
  startIndex: number, 
  currentTokens: number
): { index: number, tokens: number } | null {
  let index = startIndex;
  let tokens = currentTokens;
  
  // Search backwards for a user message
  // Limit search depth to avoid going back too far (e.g. 5 messages)
  const minIndex = Math.max(0, index - 5);
  
  while (index >= minIndex) {
    const msg = messages[index];
    const branch = msg.branches.find(b => b.id === msg.activeBranchId);
    const role = branch?.role || 'user';
    
    if (role === 'user') {
      return { index, tokens };
    }
    
    // Subtract tokens of the message we are skipping
    tokens -= getMessageTokens(msg);
    index--;
  }
  
  return null;
}

export class AppendContextStrategy implements ContextStrategy {
  name = 'append';
  
  constructor(
    private config: Extract<ContextManagement, { strategy: 'append' }>
  ) {}
  
  prepareContext(
    messages: Message[], 
    newMessage?: Message,
    currentCacheMarker?: CacheMarker,
    modelMaxContext?: number
  ): ContextWindow {
    const allMessages = newMessage ? [...messages, newMessage] : messages;
    const totalTokens = getTotalTokens(allMessages);
    
    // Log context boundaries for debugging
    if (allMessages.length > 0) {
      const firstMsg = allMessages[0];
      const lastMsg = allMessages[allMessages.length - 1];
      const firstBranch = firstMsg.branches.find(b => b.id === firstMsg.activeBranchId);
      const lastBranch = lastMsg.branches.find(b => b.id === lastMsg.activeBranchId);
      
      const firstContent = firstBranch?.content || '';
      const lastContent = lastBranch?.content || '';
      
      const firstLine = firstContent.split('\n')[0].substring(0, 100);
      const lastLines = lastContent.split('\n');
      const lastLine = lastLines[lastLines.length - 1].substring(0, 100);
      
      Logger.context(`[AppendContextStrategy] 📍 Context boundaries:`);
      Logger.context(`  First msg: [${firstBranch?.role}] "${firstLine}${firstContent.length > 100 ? '...' : ''}"`);
      Logger.context(`  Last msg:  [${lastBranch?.role}] "${lastLine}${lastContent.length > 100 ? '...' : ''}"`);
      Logger.context(`  Total messages: ${allMessages.length}, ${totalTokens} tokens`);
    }
    
    // Arithmetic cache positioning with 4 points
    const PROVIDER_MIN_CACHE_TOKENS = 1024;
    const NUM_CACHE_POINTS = 4; // Anthropic supports 4
    
    let cacheMarker: CacheMarker | undefined;
    let cacheMarkers: CacheMarker[] | undefined;
    
    if (totalTokens >= PROVIDER_MIN_CACHE_TOKENS) {
      // For append strategy: incremental cache advancement
      // Cache interval = floor(currentTokens / tokensBeforeCaching) * tokensBeforeCaching
      // Distribute 4 points within that interval
      const tokensBeforeCaching = this.config.tokensBeforeCaching || 10000; // Fallback for old conversations
      const currentWindow = Math.floor(totalTokens / tokensBeforeCaching) * tokensBeforeCaching;
      
      // If conversation hasn't reached tokensBeforeCaching yet, don't cache
      if (currentWindow < tokensBeforeCaching) {
        Logger.cache(`\n🧮 ============= CACHE RECALCULATION (APPEND) =============`);
        Logger.cache(`🧮 Conversation too short: ${totalTokens} tokens < ${tokensBeforeCaching} threshold`);
        Logger.cache(`🧮 No caching until threshold reached`);
        Logger.cache(`🧮 =========================================================\n`);
        // Fall through to return without cache markers
      } else {
        // Distribute 4 cache points within the window: 0.25, 0.5, 0.75, 1.0
        const cacheStep = currentWindow / NUM_CACHE_POINTS;
        
        Logger.cache(`\n🧮 ============= CACHE RECALCULATION (APPEND) =============`);
        Logger.cache(`🧮 Cache strategy: Append (unlimited growth)`);
        Logger.cache(`🧮 Tokens before caching: ${tokensBeforeCaching} (cache threshold)`);
        Logger.cache(`🧮 Current conversation: ${totalTokens} tokens in ${allMessages.length} messages`);
        Logger.cache(`🧮 Current cache interval: ${currentWindow} tokens (cache moves every ${tokensBeforeCaching} tokens)`);
        Logger.cache(`🧮 Cache points: ${NUM_CACHE_POINTS}`);
        Logger.cache(`🧮 Cache step size: ${cacheStep.toFixed(0)} tokens`);
      
      // Calculate all cache positions: step, 2*step, 3*step, 4*step
      const tempMarkers: CacheMarker[] = [];
      let runningTokens = 0;
      let currentMessageIdx = 0;
      
      for (let cachePointNum = 1; cachePointNum <= NUM_CACHE_POINTS; cachePointNum++) {
        const targetTokens = cachePointNum * cacheStep;
        
        // Skip if target exceeds our total tokens
        // NOTE: We iterate PAST the target to find the message that *contains* the target point
        // or is closest to it.
        if (targetTokens > totalTokens) break;
        
        // Find message boundary closest to target
        while (currentMessageIdx < allMessages.length && runningTokens < targetTokens) {
          runningTokens += getMessageTokens(allMessages[currentMessageIdx]);
          currentMessageIdx++;
        }
        
        // Place cache marker at this message
        if (currentMessageIdx > 0) {
          let markerIndex = currentMessageIdx - 1;
          let markerTokens = runningTokens;
          
          // WORKAROUND: OpenRouter fails to cache if marker is on Assistant message
          // Find nearest User message backwards
          const nearestUser = findNearestUserMessage(allMessages, markerIndex, markerTokens);
          if (nearestUser) {
             // Check if we already used this message for a previous cache point
             const alreadyUsed = tempMarkers.some(m => m.messageIndex === nearestUser.index);
             if (alreadyUsed) {
               Logger.cache(`⚠️ Skipping cache point ${cachePointNum}: message ${nearestUser.index} already used`);
               continue;
             }
             
             if (nearestUser.index !== markerIndex) {
               Logger.cache(`🧮 Adjusted cache point ${cachePointNum} from msg ${markerIndex} to user msg ${nearestUser.index}`);
             }
             markerIndex = nearestUser.index;
             markerTokens = nearestUser.tokens;
             
             // CRITICAL: Update loop state to continue from adjusted position
             runningTokens = markerTokens;
             currentMessageIdx = markerIndex + 1;
          }
          
          // CRITICAL: Ensure we didn't drop below the minimum token threshold
          if (markerTokens < PROVIDER_MIN_CACHE_TOKENS) {
             Logger.cache(`⚠️ Skipping cache point ${cachePointNum}: adjusted position ${markerTokens} tokens < minimum ${PROVIDER_MIN_CACHE_TOKENS}`);
             continue;
          }
          
          tempMarkers.push({
            messageId: allMessages[markerIndex].id,
            messageIndex: markerIndex,
            tokenCount: markerTokens
          });
          Logger.cache(`🧮 Cache point ${cachePointNum}: message ${markerIndex} at ${markerTokens} tokens (target: ${targetTokens})`);
        }
      }
      
        if (tempMarkers.length > 0) {
          cacheMarkers = tempMarkers;
          cacheMarker = tempMarkers[tempMarkers.length - 1]; // Legacy: last marker
          
          const totalCached = cacheMarkers[cacheMarkers.length - 1].messageIndex + 1;
          const totalFresh = allMessages.length - totalCached;
          
          Logger.cache(`🧮 Summary: ${cacheMarkers.length} cache points established`);
          Logger.cache(`🧮   - ${totalCached} messages cached`);
          Logger.cache(`🧮   - ${totalFresh} messages fresh`);
          Logger.cache(`🧮 =========================================================\n`);
        }
      }
    }
    
    const cacheBreakpoint = cacheMarker ? cacheMarker.messageIndex + 1 : 0;
    
    return {
      messages: allMessages,
      cacheablePrefix: allMessages.slice(0, cacheBreakpoint),
      activeWindow: allMessages.slice(cacheBreakpoint),
      cacheMarker,
      cacheMarkers,
      metadata: {
        totalMessages: allMessages.length,
        totalTokens,
        windowStart: 0,
        windowEnd: allMessages.length,
        lastRotation: null,
      },
    };
  }
  
  shouldRotate(): boolean {
    return false; // Append strategy never rotates
  }
  
  getCacheBreakpoint(messages: Message[]): number {
    // For append strategy, cache breakpoint is determined by token count
    const totalTokens = getTotalTokens(messages);
    if (totalTokens < 5000) return 0;
    
    let tokenSum = 0;
    for (let i = 0; i < messages.length; i++) {
      tokenSum += getMessageTokens(messages[i]);
      if (tokenSum >= totalTokens - 1000) { // Keep last 1k tokens uncached
        return i;
      }
    }
    return messages.length - 1;
  }
}

export class RollingContextStrategy implements ContextStrategy {
  name = 'rolling';
  private state: {
    inGracePeriod: boolean;
    baselineTokens: number;  // Token count after last rotation
    lastRotationTime?: Date;
    lastMessageCount: number;
    lastBranchSignature?: string;  // Track branch state
    windowMessageIds: string[];  // IDs of messages currently in our window
  } = {
    inGracePeriod: false,
    baselineTokens: 0,
    lastMessageCount: 0,
    windowMessageIds: []
  };
  
  constructor(
    private config: Extract<ContextManagement, { strategy: 'rolling' }>
  ) {
    Logger.debug('[RollingContextStrategy] Initialized with config:', this.config);
  }
  
  resetState(): void {
    this.state = {
      inGracePeriod: false,
      baselineTokens: 0,
      lastMessageCount: 0,
      windowMessageIds: []
    };
    Logger.context('[RollingContextStrategy] State reset');
  }
  
  prepareContext(
    messages: Message[], 
    newMessage?: Message,
    currentCacheMarker?: CacheMarker,
    modelMaxContext?: number
  ): ContextWindow {
    const allMessages = newMessage ? [...messages, newMessage] : messages;
    
    // Detect branch changes by comparing ONLY existing messages (not new ones)
    // Adding a message isn't a branch change - only editing/switching branches is
    const existingMessageCount = this.state.lastMessageCount || 0;
    const existingMessages = messages.slice(0, Math.min(existingMessageCount, messages.length));
    const branchSignature = existingMessages.length > 0 
      ? existingMessages.map(m => m.activeBranchId).join('-')
      : '';
    const branchChanged = this.state.lastBranchSignature && 
                         branchSignature.length > 0 &&
                         this.state.lastBranchSignature !== branchSignature;
    
    // Enhanced logging for debugging
    if (this.state.lastBranchSignature) {
      Logger.debug(`[RollingContextStrategy] Branch signature comparison:`);
      Logger.debug(`  Comparing first ${existingMessages.length} messages (excluding new ones)`);
      Logger.debug(`  Previous: ${this.state.lastBranchSignature.substring(0, 50)}...`);
      Logger.debug(`  Current:  ${branchSignature.substring(0, 50)}...`);
      Logger.debug(`  Changed:  ${branchChanged}`);
    }
    
    if (branchChanged) {
      Logger.context(`[RollingContextStrategy] 🔀 BRANCH CHANGE DETECTED! Resetting state.`);
      Logger.context(`  User switched branches in existing messages`);
      Logger.context(`  Messages: ${this.state.lastMessageCount} → ${allMessages.length}`);
      Logger.context(`  Tokens: ${this.state.baselineTokens} → will recalculate`);
      // Reset state on branch change
      this.state.inGracePeriod = false;
      this.state.baselineTokens = 0;
      this.state.lastMessageCount = 0;
      this.state.windowMessageIds = [];  // Clear window tracking
    }
    
    // Update signature to ALL messages (for next comparison)
    this.state.lastBranchSignature = allMessages.map(m => m.activeBranchId).join('-');
    
    // Determine which messages to evaluate:
    // - If we have a window: only messages in window OR new messages
    // - If no window (first call or after branch change): evaluate all
    let messagesToEvaluate: Message[];
    
    if (this.state.windowMessageIds.length > 0) {
      // We have a window - only evaluate messages in window + new messages
      const windowIds = new Set(this.state.windowMessageIds);
      messagesToEvaluate = allMessages.filter((m, idx) => 
        windowIds.has(m.id) || idx >= this.state.lastMessageCount
      );
      Logger.context(`[RollingContextStrategy] Evaluating windowed messages: ${messagesToEvaluate.length} (${this.state.windowMessageIds.length} in window + ${allMessages.length - this.state.lastMessageCount} new)`);
    } else {
      // No window yet - evaluate all messages
      messagesToEvaluate = allMessages;
      Logger.context(`[RollingContextStrategy] Evaluating all messages (no window yet)`);
    }
    
    let totalTokens = getTotalTokens(messagesToEvaluate);
    
    Logger.context(`[RollingContextStrategy] Processing ${allMessages.length} total messages (${messagesToEvaluate.length} in scope), ${totalTokens} tokens`);
    Logger.context(`[RollingContextStrategy] Config: maxTokens=${this.config.maxTokens}, graceTokens=${this.config.maxGraceTokens}, total=${this.config.maxTokens + this.config.maxGraceTokens}`);
    Logger.context(`[RollingContextStrategy] State: inGrace=${this.state.inGracePeriod}, baseline=${this.state.baselineTokens}, lastMsgCount=${this.state.lastMessageCount}`);
    if (branchChanged) {
      Logger.context(`[RollingContextStrategy] ⚠️ Branch changed, state was reset`);
    }
    
    // Check if we need to truncate
    const maxTotal = this.config.maxTokens + this.config.maxGraceTokens;
    let keptMessages = messagesToEvaluate;
    let droppedCount = 0;
    
    // Determine if we should rotate
    let shouldRotate = false;
    
    // Log decision process
    Logger.context(`[RollingContextStrategy] Decision logic:`);
    Logger.context(`  Current tokens: ${totalTokens}`);
    Logger.context(`  Max tokens: ${this.config.maxTokens}`);
    Logger.context(`  Max + grace: ${maxTotal}`);
    
    // Check if we need immediate rotation (over grace limit)
    if (totalTokens > maxTotal) {
      // Over the grace limit - must rotate regardless of state
      shouldRotate = true;
      Logger.context(`[RollingContextStrategy] 🔄 OVER GRACE LIMIT (${totalTokens} > ${maxTotal})`);
      Logger.context(`  Will rotate back to ~${this.config.maxTokens} tokens`);
    } else if (!this.state.inGracePeriod && totalTokens > this.config.maxTokens) {
      // Not in grace period and exceeded maxTokens - enter grace period
      this.state.inGracePeriod = true;
      this.state.baselineTokens = totalTokens;
      Logger.context(`[RollingContextStrategy] ⏸️ ENTERING GRACE PERIOD at ${totalTokens} tokens`);
      Logger.context(`  Can grow to ${maxTotal} before rotation`);
    } else if (this.state.inGracePeriod) {
      Logger.context(`[RollingContextStrategy] ⏸️ IN GRACE PERIOD: ${totalTokens}/${maxTotal} tokens`);
    } else {
      Logger.context(`[RollingContextStrategy] ✅ NORMAL: ${totalTokens}/${this.config.maxTokens} tokens`);
    }
    
    if (shouldRotate) {
      Logger.context(`\n🔄 ============= CONTEXT WINDOW ROTATION =============`);
      Logger.context(`🔄 Total tokens (${totalTokens}) exceeds limit (${maxTotal})`);
      Logger.context(`🔄 Truncating to guarantee at least ${this.config.maxTokens} tokens...`);
      
      // Truncate to maxTokens from the end
      let tokenSum = 0;
      let startIdx = messagesToEvaluate.length - 1;
      
      // Find where to start keeping messages to meet or slightly exceed maxTokens
      for (let i = messagesToEvaluate.length - 1; i >= 0; i--) {
        const msgTokens = getMessageTokens(messagesToEvaluate[i]);
        tokenSum += msgTokens;
        
        // Keep going until we meet or exceed maxTokens
        if (tokenSum >= this.config.maxTokens) {
          startIdx = i;
          break;
        }
      }
      
      keptMessages = messagesToEvaluate.slice(startIdx);
      droppedCount = startIdx;
      totalTokens = getTotalTokens(keptMessages);
      
      // Reset state after rotation
      this.state.inGracePeriod = false;
      this.state.baselineTokens = totalTokens;
      this.state.lastRotationTime = new Date();
      
      // Track which messages are in our window
      this.state.windowMessageIds = keptMessages.map(m => m.id);
      Logger.context(`[RollingContextStrategy] 📌 Window updated: tracking ${this.state.windowMessageIds.length} message IDs`);
      
      Logger.context(`❌ Dropped: ${droppedCount} old messages`);
      Logger.context(`✅ Kept: ${keptMessages.length} recent messages (${totalTokens} tokens)`);
      Logger.context(`🔄 =================================================\n`);
    } else {
      // Not rotating - update window IDs to include any new messages
      this.state.windowMessageIds = messagesToEvaluate.map(m => m.id);
      
      if (!this.state.inGracePeriod) {
        Logger.debug(`[RollingContextStrategy] Within limits (${totalTokens}/${this.config.maxTokens} tokens), keeping all messages`);
      } else {
        Logger.debug(`[RollingContextStrategy] In grace period (${totalTokens}/${maxTotal} tokens), appending...`);
      }
    }
    
    // Update message count
    this.state.lastMessageCount = allMessages.length;
    
    // Determine cache marker using arithmetic positioning
    let cacheMarker = currentCacheMarker;
    let cacheMarkers: CacheMarker[] | undefined;
    
    // X = maxTokens + maxGraceTokens (working window size, NOT model max)
    const workingWindowSize = this.config.maxTokens + this.config.maxGraceTokens;
    
    // Clear cache if: branch changed, messages dropped, or cache marker no longer in window
    if (branchChanged || droppedCount > 0 || (currentCacheMarker && !keptMessages.find(m => m.id === currentCacheMarker.messageId))) {
      // Context changed significantly, cache invalid
      cacheMarker = undefined;
      if (branchChanged) {
        Logger.context(`[RollingContextStrategy] 📦 Cache cleared due to branch change`);
      } else if (droppedCount > 0) {
        Logger.context(`[RollingContextStrategy] 📦 Cache cleared due to rotation`);
      }
    }
    
    // Arithmetic cache positioning (only calculate if cache was invalidated or doesn't exist)
    // Provider minimum: 1024 tokens (Anthropic/OpenRouter requirement)
    const PROVIDER_MIN_CACHE_TOKENS = 1024;
    
    // Anthropic supports 4 cache points, others support 1
    const NUM_CACHE_POINTS = 4; // For Anthropic
    
    // Always recalculate distribution to maximize cache points (up to 4)
    // The calculation is deterministic so stable messages will get stable markers
    if (totalTokens >= PROVIDER_MIN_CACHE_TOKENS) {
      // Calculate cache step: X / (N + 1)
      // For 4 cache points: step = workingWindowSize / 5
      
      // Ensure step is large enough to be valid
      const calculatedStep = Math.floor(workingWindowSize / (NUM_CACHE_POINTS + 1));
      const cacheStep = Math.max(calculatedStep, PROVIDER_MIN_CACHE_TOKENS);
      
      Logger.cache(`\n🧮 ============= CACHE RECALCULATION =============`);
      Logger.cache(`🧮 Max context (working window): ${workingWindowSize} tokens`);
      Logger.cache(`🧮   - maxTokens: ${this.config.maxTokens}`);
      Logger.cache(`🧮   - maxGraceTokens: ${this.config.maxGraceTokens}`);
      Logger.cache(`🧮 Cache points: ${NUM_CACHE_POINTS}`);
      Logger.cache(`🧮 Cache step size: ${cacheStep} tokens (workingWindow / ${NUM_CACHE_POINTS + 1}, clamped to >= ${PROVIDER_MIN_CACHE_TOKENS})`);
      Logger.cache(`🧮 Current conversation: ${totalTokens} tokens in ${keptMessages.length} messages`);
      
      // Calculate all cache positions: step, 2*step, 3*step, 4*step
      const tempMarkers: CacheMarker[] = [];
      let runningTokens = 0;
      let currentMessageIdx = 0;
      
      for (let cachePointNum = 1; cachePointNum <= NUM_CACHE_POINTS; cachePointNum++) {
        const targetTokens = cachePointNum * cacheStep;
        
        // Skip if target exceeds our total tokens
        // NOTE: We iterate PAST the target to find the message that *contains* the target point
        // or is closest to it.
        if (targetTokens > totalTokens) break;
        
        // Find message boundary closest to target
        while (currentMessageIdx < keptMessages.length && runningTokens < targetTokens) {
          runningTokens += getMessageTokens(keptMessages[currentMessageIdx]);
          currentMessageIdx++;
        }
        
        // Place cache marker at this message (back up one since we incremented)
        if (currentMessageIdx > 0) {
          let markerIndex = currentMessageIdx - 1;
          let markerTokens = runningTokens;
          
          // WORKAROUND: OpenRouter fails to cache if marker is on Assistant message
          // Find nearest User message backwards
          const nearestUser = findNearestUserMessage(keptMessages, markerIndex, markerTokens);
          if (nearestUser) {
             // Check if we already used this message
             const alreadyUsed = tempMarkers.some(m => m.messageIndex === nearestUser.index);
             if (alreadyUsed) {
               Logger.cache(`⚠️ Skipping cache point ${cachePointNum}: message ${nearestUser.index} already used`);
               continue;
             }
             
             if (nearestUser.index !== markerIndex) {
               Logger.cache(`🧮 Adjusted cache point ${cachePointNum} from msg ${markerIndex} to user msg ${nearestUser.index}`);
             }
             markerIndex = nearestUser.index;
             markerTokens = nearestUser.tokens;
             
             // CRITICAL: Update loop state to continue from adjusted position
             runningTokens = markerTokens;
             currentMessageIdx = markerIndex + 1;
          }
          
          // CRITICAL: Ensure we didn't drop below the minimum token threshold
          if (markerTokens < PROVIDER_MIN_CACHE_TOKENS) {
             Logger.cache(`⚠️ Skipping cache point ${cachePointNum}: adjusted position ${markerTokens} tokens < minimum ${PROVIDER_MIN_CACHE_TOKENS}`);
             continue;
          }
          
          tempMarkers.push({
            messageId: keptMessages[markerIndex].id,
            messageIndex: markerIndex,
            tokenCount: markerTokens
          });
          Logger.cache(`🧮 Cache point ${cachePointNum}: message ${markerIndex} at ${markerTokens} tokens (target: ${targetTokens})`);
        }
      }
      
      if (tempMarkers.length > 0) {
        // Store both for compatibility
        cacheMarkers = tempMarkers;
        cacheMarker = tempMarkers[tempMarkers.length - 1]; // Legacy: last marker
        
        const totalCached = cacheMarkers[cacheMarkers.length - 1].messageIndex + 1;
        const totalFresh = keptMessages.length - totalCached;
        
        Logger.cache(`🧮 Summary: ${cacheMarkers.length} cache points established`);
        Logger.cache(`🧮   - ${totalCached} messages cached`);
        Logger.cache(`🧮   - ${totalFresh} messages fresh`);
        Logger.cache(`🧮 ===============================================\n`);
      } else {
        Logger.cache(`🧮 Conversation too short (${totalTokens} tokens) for cache points`);
        Logger.cache(`🧮 ===============================================\n`);
      }
    }
    
    const cacheBreakpoint = cacheMarker ? cacheMarker.messageIndex + 1 : 0;
    
    // Log context boundaries for debugging
    if (keptMessages.length > 0) {
      const firstMsg = keptMessages[0];
      const lastMsg = keptMessages[keptMessages.length - 1];
      const firstBranch = firstMsg.branches.find(b => b.id === firstMsg.activeBranchId);
      const lastBranch = lastMsg.branches.find(b => b.id === lastMsg.activeBranchId);
      
      const firstContent = firstBranch?.content || '';
      const lastContent = lastBranch?.content || '';
      
      // Get first line of first message and last line of last message
      const firstLine = firstContent.split('\n')[0].substring(0, 100);
      const lastLines = lastContent.split('\n');
      const lastLine = lastLines[lastLines.length - 1].substring(0, 100);
      
      Logger.context(`[RollingContextStrategy] 📍 Context boundaries:`);
      Logger.context(`  First msg: [${firstBranch?.role}] "${firstLine}${firstContent.length > 100 ? '...' : ''}"`);
      Logger.context(`  Last msg:  [${lastBranch?.role}] "${lastLine}${lastContent.length > 100 ? '...' : ''}"`);
      Logger.context(`  Total messages in window: ${keptMessages.length}`);
    }

    return {
      messages: keptMessages,
      cacheablePrefix: keptMessages.slice(0, cacheBreakpoint),
      activeWindow: keptMessages.slice(cacheBreakpoint),
      cacheMarker,
      cacheMarkers,
      metadata: {
        totalMessages: allMessages.length,
        totalTokens,
        windowStart: droppedCount,
        windowEnd: droppedCount + keptMessages.length,
        lastRotation: droppedCount > 0 ? new Date() : null,
      },
    };
  }
  
  shouldRotate(currentWindow: ContextWindow): boolean {
    // Rotation happens automatically in prepareContext when exceeding limits
    return false;
  }
  
  getCacheBreakpoint(messages: Message[]): number {
    // Use arithmetic positioning for cache breakpoint
    const totalTokens = getTotalTokens(messages);
    const workingWindowSize = this.config.maxTokens + this.config.maxGraceTokens;
    const cacheStep = Math.floor(workingWindowSize / 2);
    const PROVIDER_MIN_CACHE_TOKENS = 1024;
    
    if (totalTokens < PROVIDER_MIN_CACHE_TOKENS) return 0;
    
    // Find message boundary closest to cacheStep tokens
    let tokenCount = 0;
    for (let i = 0; i < messages.length; i++) {
      tokenCount += getMessageTokens(messages[i]);
      if (tokenCount >= cacheStep) {
        return i + 1; // Return index after the cache marker
      }
    }
    
    // Fallback: if conversation too short for target, use midpoint
    return Math.floor(messages.length / 2);
  }
}

// Legacy strategies for backward compatibility
export class LegacyRollingContextStrategy implements ContextStrategy {
  name = 'legacy-rolling';
  
  constructor(
    private maxMessages: number = 100,
    private rotationInterval: number = 20,
    private cacheRatio: number = 0.8
  ) {}
  
  prepareContext(messages: Message[], newMessage?: Message, currentCacheMarker?: CacheMarker, modelMaxContext?: number): ContextWindow {
    const allMessages = newMessage ? [...messages, newMessage] : messages;
    
    if (allMessages.length <= this.maxMessages) {
      const breakpoint = Math.max(0, allMessages.length - 10);
      return {
        messages: allMessages,
        cacheablePrefix: allMessages.slice(0, breakpoint),
        activeWindow: allMessages.slice(breakpoint),
        metadata: {
          totalMessages: allMessages.length,
          totalTokens: getTotalTokens(allMessages),
          windowStart: 0,
          windowEnd: allMessages.length,
          lastRotation: null,
        },
      };
    }
    
    const cacheSize = Math.floor(this.maxMessages * this.cacheRatio);
    const windowSize = this.maxMessages - cacheSize;
    
    const currentWindowSize = allMessages.length - cacheSize;
    const rotationsNeeded = Math.floor(currentWindowSize / this.rotationInterval);
    
    const startIdx = rotationsNeeded * this.rotationInterval;
    const keptMessages = allMessages.slice(startIdx);
    
    const finalMessages = keptMessages.slice(-this.maxMessages);
    const breakpoint = Math.min(cacheSize, finalMessages.length - windowSize);
    
    return {
      messages: finalMessages,
      cacheablePrefix: finalMessages.slice(0, breakpoint),
      activeWindow: finalMessages.slice(breakpoint),
      metadata: {
        totalMessages: allMessages.length,
        totalTokens: getTotalTokens(finalMessages),
        windowStart: startIdx,
        windowEnd: startIdx + finalMessages.length,
        lastRotation: rotationsNeeded > 0 ? new Date() : null,
      },
    };
  }
  
  shouldRotate(currentWindow: ContextWindow): boolean {
    const activeSize = currentWindow.activeWindow.length;
    return activeSize >= this.rotationInterval;
  }
  
  getCacheBreakpoint(messages: Message[]): number {
    const cacheSize = Math.floor(this.maxMessages * this.cacheRatio);
    return Math.min(cacheSize, messages.length - 10);
  }
}

export class StaticContextStrategy implements ContextStrategy {
  name = 'static';
  
  constructor(
    private maxMessages: number = 200,
    private alwaysCacheRatio: number = 0.9
  ) {}
  
  prepareContext(messages: Message[], newMessage?: Message, currentCacheMarker?: CacheMarker, modelMaxContext?: number): ContextWindow {
    const allMessages = newMessage ? [...messages, newMessage] : messages;
    const breakpoint = Math.floor(allMessages.length * this.alwaysCacheRatio);
    
    return {
      messages: allMessages.slice(-this.maxMessages),
      cacheablePrefix: allMessages.slice(0, breakpoint),
      activeWindow: allMessages.slice(breakpoint),
      metadata: {
        totalMessages: allMessages.length,
        totalTokens: getTotalTokens(allMessages.slice(-this.maxMessages)),
        windowStart: Math.max(0, allMessages.length - this.maxMessages),
        windowEnd: allMessages.length,
        lastRotation: null,
      },
    };
  }
  
  shouldRotate(): boolean {
    return false;
  }
  
  getCacheBreakpoint(messages: Message[]): number {
    return Math.floor(messages.length * this.alwaysCacheRatio);
  }
}

export class AdaptiveContextStrategy implements ContextStrategy {
  name = 'adaptive';
  
  constructor(
    private maxMessages: number = 100,
    private importanceThreshold: number = 0.7
  ) {}
  
  prepareContext(messages: Message[], newMessage?: Message, currentCacheMarker?: CacheMarker, modelMaxContext?: number): ContextWindow {
    const allMessages = newMessage ? [...messages, newMessage] : messages;
    const scoredMessages = this.scoreMessages(allMessages);
    
    const importantMessages = scoredMessages
      .filter(m => m.score >= this.importanceThreshold)
      .map(m => m.message);
    
    const recentMessages = allMessages.slice(-20);
    
    const messageSet = new Set([...importantMessages, ...recentMessages]
      .map(m => m.id));
    const finalMessages = allMessages
      .filter(m => messageSet.has(m.id))
      .slice(-this.maxMessages);
    
    const breakpoint = importantMessages.length;
    
    return {
      messages: finalMessages,
      cacheablePrefix: finalMessages.slice(0, breakpoint),
      activeWindow: finalMessages.slice(breakpoint),
      metadata: {
        totalMessages: allMessages.length,
        totalTokens: getTotalTokens(finalMessages),
        windowStart: 0,
        windowEnd: finalMessages.length,
        lastRotation: new Date(),
      },
    };
  }
  
  private scoreMessages(messages: Message[]): Array<{message: Message, score: number}> {
    return messages.map((message, idx) => {
      let score = 0.5;
      
      const recency = idx / messages.length;
      score += recency * 0.2;
      
      const branch = message.branches.find(b => b.id === message.activeBranchId);
      if (branch) {
        if (branch.content.length > 500) score += 0.1;
        if (branch.content.includes('```')) score += 0.2;
        if (branch.role === 'user') score += 0.1;
      }
      
      return { message, score: Math.min(1, score) };
    });
  }
  
  shouldRotate(currentWindow: ContextWindow): boolean {
    return currentWindow.activeWindow.length > 30;
  }
  
  getCacheBreakpoint(messages: Message[]): number {
    const scored = this.scoreMessages(messages);
    const important = scored.filter(m => m.score >= this.importanceThreshold);
    return important.length;
  }
}