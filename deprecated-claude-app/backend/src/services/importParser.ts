import { 
  ImportFormat, 
  ParsedMessage, 
  ImportPreview,
  RawMessageSchema 
} from '@deprecated-claude/shared';

// Maximum number of automatically detected participants to limit false positives
const MAX_AUTO_DETECTED_PARTICIPANTS = 15;

export interface ParseOptions {
  // If provided, only these names will be treated as message headers
  // Other potential headers will be treated as regular text
  allowedParticipants?: string[];
}

export class ImportParser {
  async parse(format: ImportFormat, content: string, options?: ParseOptions): Promise<ImportPreview> {
    let messages: ParsedMessage[];
    let title: string | undefined;
    let metadata: Record<string, any> | undefined;

    switch (format) {
      case 'basic_json':
        ({ messages, title, metadata } = await this.parseBasicJson(content));
        break;
      case 'anthropic':
        ({ messages, title, metadata } = await this.parseAnthropic(content));
        break;
      case 'chrome_extension':
        ({ messages, title, metadata } = await this.parseChromeExtension(content));
        break;
      case 'arc_chat':
        ({ messages, title, metadata } = await this.parseArcChat(content));
        break;
      case 'openai':
        ({ messages, title, metadata } = await this.parseOpenAI(content));
        break;
      case 'cursor':
        ({ messages, title, metadata } = await this.parseCursor(content));
        break;
      case 'cursor_json':
        ({ messages, title, metadata } = await this.parseCursorJson(content));
        break;
      case 'colon_single':
        ({ messages, title, metadata } = await this.parseColonFormat(content, '\n', options?.allowedParticipants));
        break;
      case 'colon_double':
        ({ messages, title, metadata } = await this.parseColonFormat(content, '\n\n', options?.allowedParticipants));
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    // For Arc Chat format, use the exported participants directly
    let detectedParticipants;
    let suggestedFormat: 'standard' | 'prefill';
    
    if (format === 'arc_chat' && metadata?.participants) {
      // Use the participants from the Arc Chat export
      detectedParticipants = metadata.participants.map((p: any) => ({
        name: p.name,
        role: p.type as 'user' | 'assistant' | 'unknown',
        messageCount: messages.filter(m => m.participantName === p.name).length,
        model: p.model,
        settings: p.settings
      }));
      
      // Arc Chat exports already know their format
      suggestedFormat = metadata.conversation?.format || (detectedParticipants.length > 2 ? 'prefill' : 'standard');
    } else {
      // Default participant detection for other formats
      const participantMap = new Map<string, { role: 'user' | 'assistant' | 'unknown', count: number }>();
      
      for (const msg of messages) {
        const name = msg.participantName || (msg.role === 'user' ? 'User' : 'Assistant');
        const existing = participantMap.get(name) || { role: msg.role === 'system' ? 'unknown' : msg.role, count: 0 };
        existing.count++;
        participantMap.set(name, existing);
      }

      detectedParticipants = Array.from(participantMap.entries()).map(([name, data]) => ({
        name,
        role: data.role,
        messageCount: data.count
      }));
      
      // Sort by message count descending
      detectedParticipants.sort((a, b) => b.messageCount - a.messageCount);
      
      // Limit to top MAX_AUTO_DETECTED_PARTICIPANTS if not using allowed participants filter
      // (If allowedParticipants is set, we already filtered during parsing)
      if (!options?.allowedParticipants && detectedParticipants.length > MAX_AUTO_DETECTED_PARTICIPANTS) {
        console.log(`[ImportParser] Limiting from ${detectedParticipants.length} to ${MAX_AUTO_DETECTED_PARTICIPANTS} participants`);
        detectedParticipants = detectedParticipants.slice(0, MAX_AUTO_DETECTED_PARTICIPANTS);
      }
      
      // Suggest format based on participant count
      suggestedFormat = detectedParticipants.length > 2 ? 'prefill' : 'standard';
    }

    return {
      format,
      messages,
      detectedParticipants,
      suggestedFormat,
      title,
      metadata
    };
  }

  private async parseBasicJson(content: string): Promise<{ messages: ParsedMessage[], title?: string, metadata?: any }> {
    const data = JSON.parse(content);
    
    if (!data.messages || !Array.isArray(data.messages)) {
      throw new Error('Invalid JSON format: missing messages array');
    }

    const messages: ParsedMessage[] = [];
    
    for (let i = 0; i < data.messages.length; i++) {
      const rawMsg = data.messages[i];
      let validated;
      
      try {
        validated = RawMessageSchema.parse(rawMsg);
      } catch (err) {
        console.error(`Failed to parse message at index ${i}:`, rawMsg);
        throw new Error(`Invalid message format at index ${i}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
      
      // Handle content that might be an array (like Anthropic format)
      let textContent = '';
      if (typeof validated.content === 'string') {
        textContent = validated.content;
      } else if (Array.isArray(validated.content)) {
        textContent = validated.content
          .map(c => {
            if (typeof c === 'string') return c;
            if (typeof c === 'object' && c) {
              return c.text || c.value || '';
            }
            return '';
          })
          .filter(text => text)
          .join('\n');
      } else if (typeof validated.content === 'object' && validated.content) {
        // Handle object content (some formats might have this)
        textContent = JSON.stringify(validated.content);
      }

      messages.push({
        role: this.normalizeRole(validated.role),
        content: textContent,
        participantName: validated.name,
        timestamp: validated.timestamp ? new Date(validated.timestamp) : undefined,
        model: validated.model,
        images: validated.images
      });
    }

    return {
      messages,
      title: data.title,
      metadata: data.metadata
    };
  }

  private async parseAnthropic(content: string): Promise<{ messages: ParsedMessage[], title?: string, metadata?: any }> {
    const data = JSON.parse(content);
    
    // Handle Claude.ai export format
    if (data.name && data.chat_messages) {
      const messages: ParsedMessage[] = [];
      
      for (const msg of data.chat_messages) {
        let textContent = '';
        
        if (typeof msg.text === 'string') {
          textContent = msg.text;
        } else if (msg.content) {
          if (typeof msg.content === 'string') {
            textContent = msg.content;
          } else if (Array.isArray(msg.content)) {
            textContent = msg.content
              .map((c: any) => {
                if (typeof c === 'string') return c;
                if (c && typeof c === 'object') {
                  return c.text || c.value || '';
                }
                return '';
              })
              .filter((text: string) => text)
              .join('\n');
          }
        }

        messages.push({
          role: msg.sender === 'human' ? 'user' : 'assistant',
          content: textContent,
          timestamp: msg.created_at ? new Date(msg.created_at) : undefined,
          model: msg.model
        });
      }

      return {
        messages,
        title: data.name,
        metadata: {
          uuid: data.uuid,
          created_at: data.created_at,
          updated_at: data.updated_at
        }
      };
    }
    
    // Fallback to basic JSON parsing
    return this.parseBasicJson(content);
  }

  private async parseChromeExtension(content: string): Promise<{ messages: ParsedMessage[], title?: string, metadata?: any }> {
    const data = JSON.parse(content);
    
    // Extract basic conversation metadata
    const title = data.name || data.summary || 'Imported Conversation';
    const metadata: any = {
      uuid: data.uuid,
      model: data.model,
      created_at: data.created_at,
      updated_at: data.updated_at,
      settings: data.settings,
      is_starred: data.is_starred,
      current_leaf_message_uuid: data.current_leaf_message_uuid
    };

    // Build a map of message UUID to message for easy parent lookup
    const messageMap = new Map<string, any>();
    const messages: ParsedMessage[] = [];
    
    // First pass: build message map
    for (const msg of data.chat_messages || []) {
      messageMap.set(msg.uuid, msg);
    }

    // Build parent-child relationships to detect branches
    const messagesByParent = new Map<string, any[]>();
    for (const msg of data.chat_messages || []) {
      const parentId = msg.parent_message_uuid || '00000000-0000-4000-8000-000000000000';
      if (!messagesByParent.has(parentId)) {
        messagesByParent.set(parentId, []);
      }
      messagesByParent.get(parentId)!.push(msg);
    }

    // Process messages in order, tracking branches
    const processedMessages = new Map<string, { messageIndex: number, branchIndex: number }>();
    const rootParentId = '00000000-0000-4000-8000-000000000000';
    const messageToParentMap = new Map<string, string>(); // messageUuid -> parentMessageUuid
    
    // Build a proper tree structure
    for (const msg of data.chat_messages || []) {
      if (msg.parent_message_uuid && msg.parent_message_uuid !== rootParentId) {
        messageToParentMap.set(msg.uuid, msg.parent_message_uuid);
      }
    }
    
    // Process messages in chronological order, but track branches
    const sortedMessages = [...(data.chat_messages || [])]
      .sort((a, b) => {
        // First sort by index
        if (a.index !== b.index) return (a.index || 0) - (b.index || 0);
        // Then by creation time for branches
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
    
    // Track which messages have been processed as branches
    const processedAsAlternative = new Set<string>();
    
    for (const msg of sortedMessages) {
      // Extract text content
      let textContent = '';
      if (msg.text) {
        textContent = msg.text;
      } else if (msg.content && Array.isArray(msg.content)) {
        // Combine all text content blocks
        textContent = msg.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text || '')
          .join('\n');
      }

      // Skip empty messages
      if (!textContent.trim()) {
        continue;
      }

      // Determine role
      const role = msg.sender === 'human' ? 'user' : 
                  msg.sender === 'assistant' ? 'assistant' : 
                  'user';

      // Check if this message shares a parent with another message (making it a branch)
      const siblings = messagesByParent.get(msg.parent_message_uuid) || [];
      const siblingIndex = siblings.findIndex(s => s.uuid === msg.uuid);
      const isAlternativeBranch = siblings.length > 1 && siblingIndex > 0;
      
      if (siblings.length > 1) {
        console.log(`Message ${msg.uuid} has ${siblings.length} siblings sharing parent ${msg.parent_message_uuid}`);
        console.log(`This message is at index ${siblingIndex}, isAlternativeBranch: ${isAlternativeBranch}`);
      }
      
      // Create parsed message
      const parsedMessage: ParsedMessage = {
        role,
        content: textContent,
        timestamp: msg.created_at ? new Date(msg.created_at) : undefined,
        model: msg.model || data.model
      };

      // Add metadata for branch detection
      if (isAlternativeBranch && !processedAsAlternative.has(msg.uuid)) {
        // This is an alternative branch
        (parsedMessage as any).__branchInfo = {
          parentMessageUuid: msg.parent_message_uuid,
          uuid: msg.uuid,
          isAlternative: true,
          inputMode: msg.input_mode
        };
        processedAsAlternative.add(msg.uuid);
      }

      // Store current message UUID for active branch detection
      (parsedMessage as any).__uuid = msg.uuid;
      (parsedMessage as any).__parentUuid = msg.parent_message_uuid;

      messages.push(parsedMessage);
      processedMessages.set(msg.uuid, { 
        messageIndex: messages.length - 1, 
        branchIndex: siblingIndex 
      });
    }

    // Mark active branch based on current_leaf_message_uuid
    if (data.current_leaf_message_uuid) {
      // Trace back from leaf to root to identify active path
      let currentUuid = data.current_leaf_message_uuid;
      const activePath = new Set<string>();
      
      while (currentUuid && messageMap.has(currentUuid)) {
        activePath.add(currentUuid);
        const msg = messageMap.get(currentUuid);
        currentUuid = msg.parent_message_uuid;
      }

      // Mark messages in active path
      for (const msg of messages) {
        if ((msg as any).__uuid && activePath.has((msg as any).__uuid)) {
          (msg as any).__isActive = true;
        }
      }
    }

    return {
      messages,
      title,
      metadata
    };
  }

  private async parseArcChat(content: string): Promise<{ messages: ParsedMessage[], title?: string, metadata?: any }> {
    const data = JSON.parse(content);
    
    // Arc Chat export format includes conversation, messages, participants, and metadata
    const conversation = data.conversation;
    const exportedMessages = data.messages || [];
    const participants = data.participants || [];
    
    // Sort messages by tree order (parents before children) instead of array order
    const sortedMessages = this.sortMessagesByTreeOrder(exportedMessages);
    
    // For preview, we need to show only ONE active path, not all messages
    // This handles multi-root conversations (e.g., from looming/branching)
    const visibleMessages = this.getVisibleMessagesFromExport(sortedMessages);
    
    const messages: ParsedMessage[] = [];
    
    // Process only visible messages (those on the active path)
    for (const msg of visibleMessages) {
      // Get the active branch content
      const activeBranch = msg.branches?.find((b: any) => b.id === msg.activeBranchId) || msg.branches?.[0];
      
      if (activeBranch && activeBranch.content) {
        // Find the participant name from the active branch
        let participantName = activeBranch.participantName;
        
        // If no participant name in branch, try to find from participant ID
        if (!participantName && activeBranch.participantId) {
          const participant = participants.find((p: any) => p.id === activeBranch.participantId);
          if (participant) {
            participantName = participant.name;
          }
        }
        
        // Fallback to default names based on role
        if (!participantName) {
          participantName = activeBranch.role === 'user' ? 'User' : 'Assistant';
        }
        
        const parsedMessage: ParsedMessage = {
          role: activeBranch.role, // Use role from the branch, not the message
          content: activeBranch.content,
          timestamp: msg.createdAt ? new Date(msg.createdAt) : undefined,
          model: activeBranch.model,
          participantName: participantName,
          metadata: {
            messageId: msg.id,
            branches: msg.branches,
            activeBranchId: msg.activeBranchId,
            attachments: activeBranch.attachments
          }
        };
        messages.push(parsedMessage);
      }
    }
    
    return {
      messages,
      title: conversation?.title || 'Imported from Arc Chat',
      metadata: {
        conversation,
        participants,
        exportedAt: data.exportedAt,
        version: data.version
      }
    };
  }
  
  /**
   * Get visible messages following ONE active path from a single root.
   * Handles multi-root conversations by picking the root with the most recent activity.
   */
  private getVisibleMessagesFromExport(sortedMessages: any[]): any[] {
    if (sortedMessages.length === 0) return [];
    
    // Build lookup maps
    const parentToChildren = new Map<string, any[]>(); // parentBranchId -> child messages
    
    for (const msg of sortedMessages) {
      for (const branch of (msg.branches || [])) {
        const parentId = branch.parentBranchId || 'root';
        if (!parentToChildren.has(parentId)) {
          parentToChildren.set(parentId, []);
        }
        parentToChildren.get(parentId)!.push(msg);
      }
    }
    
    // Find all root messages (branches with no parent or parent='root')
    const rootMessages = sortedMessages.filter(msg => {
      const activeBranch = msg.branches?.find((b: any) => b.id === msg.activeBranchId) || msg.branches?.[0];
      return activeBranch && (!activeBranch.parentBranchId || activeBranch.parentBranchId === 'root');
    });
    
    if (rootMessages.length === 0) {
      console.warn('[parseArcChat] No root messages found');
      return sortedMessages; // Fallback to all
    }
    
    // Pick the canonical root: the one whose subtree has the most recent message
    let canonicalRoot: any = rootMessages[0];
    let latestTime = 0;
    
    for (const root of rootMessages) {
      const leafTime = this.findLatestLeafTimeInExport(root, parentToChildren);
      if (leafTime > latestTime) {
        latestTime = leafTime;
        canonicalRoot = root;
      }
    }
    
    console.log(`[parseArcChat] Found ${rootMessages.length} roots, using canonical root with latest activity`);
    
    // Walk from canonical root, building visible path
    const visibleMessages: any[] = [];
    const branchPath: string[] = [];
    
    for (const msg of sortedMessages) {
      const activeBranch = msg.branches?.find((b: any) => b.id === msg.activeBranchId) || msg.branches?.[0];
      if (!activeBranch) continue;
      
      // Case 1: This is the canonical root
      if (msg === canonicalRoot) {
        visibleMessages.push(msg);
        branchPath.push(activeBranch.id);
        continue;
      }
      
      // Case 2: This is a root but not the canonical one - skip
      if (!activeBranch.parentBranchId || activeBranch.parentBranchId === 'root') {
        continue;
      }
      
      // Case 3: Active branch continues from our path
      if (branchPath.includes(activeBranch.parentBranchId)) {
        visibleMessages.push(msg);
        const parentIndex = branchPath.indexOf(activeBranch.parentBranchId);
        branchPath.length = parentIndex + 1;
        branchPath.push(activeBranch.id);
        continue;
      }
      
      // Case 4: Not on our path - skip
    }
    
    return visibleMessages;
  }
  
  /**
   * Find the timestamp of the latest leaf in a subtree
   */
  private findLatestLeafTimeInExport(root: any, parentToChildren: Map<string, any[]>): number {
    let latestTime = 0;
    const visited = new Set<string>();
    
    const visit = (msg: any) => {
      if (visited.has(msg.id)) return;
      visited.add(msg.id);
      
      const activeBranch = msg.branches?.find((b: any) => b.id === msg.activeBranchId) || msg.branches?.[0];
      if (activeBranch?.createdAt) {
        const time = new Date(activeBranch.createdAt).getTime();
        if (time > latestTime) latestTime = time;
      }
      
      // Visit children
      for (const branch of (msg.branches || [])) {
        const children = parentToChildren.get(branch.id) || [];
        for (const child of children) {
          visit(child);
        }
      }
    };
    
    visit(root);
    return latestTime;
  }

  private async parseOpenAI(content: string): Promise<{ messages: ParsedMessage[], title?: string, metadata?: any }> {
    const data = JSON.parse(content);
    
    // Handle ChatGPT export format
    if (data.title && data.mapping) {
      const messages: ParsedMessage[] = [];
      const nodes = Object.values(data.mapping) as any[];
      
      // Sort nodes by timestamp
      const sortedNodes = nodes
        .filter(node => node.message && node.message.content && node.message.content.parts)
        .sort((a, b) => (a.message.create_time || 0) - (b.message.create_time || 0));

      for (const node of sortedNodes) {
        const msg = node.message;
        const textContent = msg.content.parts.join('\n');
        
        if (textContent.trim()) {
          messages.push({
            role: msg.author.role === 'user' ? 'user' : 'assistant',
            content: textContent,
            timestamp: msg.create_time ? new Date(msg.create_time * 1000) : undefined,
            model: msg.metadata?.model_slug
          });
        }
      }

      return {
        messages,
        title: data.title,
        metadata: {
          create_time: data.create_time,
          update_time: data.update_time
        }
      };
    }
    
    // Fallback to basic JSON parsing
    return this.parseBasicJson(content);
  }

  private async parseCursor(content: string): Promise<{ messages: ParsedMessage[], title?: string, metadata?: any }> {
    // Cursor export format is Markdown:
    // # Title
    // _Exported on DATE from Cursor (VERSION)_
    //
    // ---
    //
    // **User**
    //
    // Message content...
    //
    // ---
    //
    // **Cursor**
    //
    // Response content...
    
    const messages: ParsedMessage[] = [];
    let title: string | undefined;
    let exportedAt: string | undefined;
    let cursorVersion: string | undefined;
    
    // Parse header - title is the first line starting with #
    const titleMatch = content.match(/^# (.+)$/m);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }
    
    // Parse metadata line (e.g., "_Exported on 1/18/2026 at 13:59:20 PST from Cursor (2.3.29)_")
    const metadataMatch = content.match(/_Exported on ([^_]+) from Cursor \(([^)]+)\)_/);
    if (metadataMatch) {
      exportedAt = metadataMatch[1].trim();
      cursorVersion = metadataMatch[2].trim();
    }
    
    // Split content by message separator (---)
    // The pattern is: --- followed by **Speaker** followed by message content
    const sections = content.split(/\n---\n/).filter(s => s.trim());
    
    for (const section of sections) {
      // Look for speaker line at the START of the section
      // Must be: **SimpleWord** (no colons, no long text, no punctuation inside)
      // This avoids matching bold headers inside message content like "**Section 3.4:**"
      const speakerMatch = section.match(/^\s*\*\*([A-Za-z][A-Za-z0-9 ]{0,20})\*\*\s*$/m);
      
      if (speakerMatch) {
        const speaker = speakerMatch[1].trim();
        
        // Additional validation: speaker should be at or near the start of the section
        // (within first 50 chars, allowing for some whitespace)
        const speakerIndex = section.indexOf(speakerMatch[0]);
        if (speakerIndex > 50) {
          // This bold text is too far into the section to be a speaker header
          continue;
        }
        
        // Extract content after the speaker line
        const contentStart = speakerIndex + speakerMatch[0].length;
        let messageContent = section.substring(contentStart).trim();
        
        // Skip empty messages
        if (!messageContent) continue;
        
        // Determine role based on speaker name
        const lowerSpeaker = speaker.toLowerCase();
        const isAssistant = lowerSpeaker === 'cursor' || 
                           lowerSpeaker === 'assistant' ||
                           lowerSpeaker === 'claude' ||
                           lowerSpeaker === 'ai' ||
                           lowerSpeaker === 'gpt' ||
                           lowerSpeaker === 'chatgpt' ||
                           lowerSpeaker === 'gemini';
        
        messages.push({
          role: isAssistant ? 'assistant' : 'user',
          content: messageContent,
          participantName: speaker
        });
      }
    }
    
    return {
      messages,
      title: title || 'Imported from Cursor',
      metadata: {
        exportedAt,
        cursorVersion,
        source: 'cursor'
      }
    };
  }

  private async parseCursorJson(content: string): Promise<{ messages: ParsedMessage[], title?: string, metadata?: any }> {
    // Cursor JSON export format - goal is to reconstruct the actual context the model saw
    // {
    //   "metadata": { "id", "name", "subtitle", "model": { "modelName", "maxMode" }, "created", "version" },
    //   "messages": [
    //     { "role", "bubble_id", "text", "created", "thinking"?: { "text", "duration_ms" }, "tool_call"?: { "name", "params", "result", "status" } }
    //   ]
    // }
    
    const data = JSON.parse(content);
    const messages: ParsedMessage[] = [];
    
    const conversationMetadata = data.metadata || {};
    const title = conversationMetadata.name;
    const model = conversationMetadata.model?.modelName;
    
    // Group consecutive messages by role to merge assistant "bubbles" into single turns
    // The model sees: thinking (if extended thinking enabled), tool_use blocks, tool_result blocks, then text
    let currentTurn: {
      role: 'user' | 'assistant';
      thinkingBlocks: Array<{ thinking: string; signature?: string }>; // Multiple thinking blocks with optional signatures
      toolCalls: Array<{ name: string; params: any; result: string }>;
      textContent: string;
      attachments: Array<{ fileName: string; content: string; mimeType: string }>;
      timestamp?: Date;
    } | null = null;
    
    const flushTurn = () => {
      if (!currentTurn) return;
      
      // Build contentBlocks for proper extended thinking support
      // This allows thinking to be sent as real API content blocks to Anthropic
      const contentBlocks: Array<{ type: string; thinking?: string; signature?: string; text?: string }> = [];
      
      // Add thinking blocks (with signatures if available)
      for (const tb of currentTurn.thinkingBlocks) {
        contentBlocks.push({
          type: 'thinking',
          thinking: tb.thinking,
          ...(tb.signature && { signature: tb.signature })
        });
      }
      
      // Add text block if there's text content
      if (currentTurn.textContent.trim()) {
        contentBlocks.push({
          type: 'text',
          text: currentTurn.textContent.trim()
        });
      }
      
      // The "content" field is for display/backward compatibility
      // contentBlocks is what gets sent to the API
      const displayContent = currentTurn.textContent.trim();
      
      if (displayContent || contentBlocks.length > 0 || currentTurn.attachments.length > 0) {
        const parsedMessage: ParsedMessage = {
          role: currentTurn.role,
          content: displayContent,
          timestamp: currentTurn.timestamp,
          model: currentTurn.role === 'assistant' ? model : undefined,
          participantName: currentTurn.role === 'user' ? 'User' : 'Cursor',
          metadata: {}
        };
        
        // Add contentBlocks for extended thinking support
        if (contentBlocks.length > 0 && currentTurn.role === 'assistant') {
          (parsedMessage as any).metadata.contentBlocks = contentBlocks;
        }
        
        // Add file attachments (from read_file results - this is what the model saw)
        if (currentTurn.attachments.length > 0) {
          (parsedMessage as any).metadata.attachments = currentTurn.attachments;
        }
        
        messages.push(parsedMessage);
      }
      
      currentTurn = null;
    };
    
    for (const msg of data.messages || []) {
      const role = msg.role === 'user' ? 'user' : 'assistant';
      
      // If role changed, flush the previous turn
      if (currentTurn && currentTurn.role !== role) {
        flushTurn();
      }
      
      // Start a new turn if needed
      if (!currentTurn) {
        currentTurn = {
          role,
          thinkingBlocks: [],
          textContent: '',
          toolCalls: [],
          attachments: [],
          timestamp: msg.created ? new Date(msg.created) : undefined
        };
      }
      
      // Process thinking (model's chain of thought - each thinking block is separate)
      // Include signature if present (allows proper API replay)
      if (msg.thinking?.text) {
        currentTurn.thinkingBlocks.push({ 
          thinking: msg.thinking.text,
          ...(msg.thinking.signature && { signature: msg.thinking.signature })
        });
      }
      
      // Process tool calls
      if (msg.tool_call) {
        const tc = msg.tool_call;
        currentTurn.toolCalls.push({
          name: tc.name,
          params: tc.params || '',
          result: tc.result || ''
        });
        
        // For read_file, extract the file content as an attachment
        // This represents what the model actually saw in its context
        if (tc.name === 'read_file' && tc.result) {
          try {
            const resultData = JSON.parse(tc.result);
            const paramsData = typeof tc.params === 'string' ? JSON.parse(tc.params) : tc.params;
            const fileName = paramsData.targetFile || paramsData.relativeWorkspacePath || 'file.txt';
            const fileContent = resultData.contents || resultData.contentsAfterEdit || '';
            
            if (fileContent) {
              const shortFileName = fileName.split('/').pop() || fileName;
              currentTurn.attachments.push({
                fileName: shortFileName,
                content: fileContent,
                mimeType: this.guessMimeType(shortFileName)
              });
            }
          } catch (e) {
            console.warn('Failed to parse read_file result:', e);
          }
        }
      }
      
      // Process text content (model's text output)
      if (msg.text) {
        if (currentTurn.textContent) {
          currentTurn.textContent += '\n\n' + msg.text;
        } else {
          currentTurn.textContent = msg.text;
        }
      }
    }
    
    // Flush the last turn
    flushTurn();
    
    return {
      messages,
      title: title || 'Imported from Cursor',
      metadata: {
        id: conversationMetadata.id,
        model: model,
        subtitle: conversationMetadata.subtitle,
        created: conversationMetadata.created,
        version: conversationMetadata.version,
        source: 'cursor_json'
      }
    };
  }

  private guessMimeType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      'ts': 'text/typescript',
      'tsx': 'text/typescript',
      'js': 'text/javascript',
      'jsx': 'text/javascript',
      'json': 'application/json',
      'md': 'text/markdown',
      'txt': 'text/plain',
      'py': 'text/x-python',
      'rs': 'text/x-rust',
      'go': 'text/x-go',
      'vue': 'text/x-vue',
      'css': 'text/css',
      'html': 'text/html',
      'yaml': 'text/yaml',
      'yml': 'text/yaml',
      'sh': 'text/x-shellscript',
      'sql': 'text/x-sql',
    };
    return mimeTypes[ext || ''] || 'text/plain';
  }

  private async parseColonFormat(
    content: string, 
    separator: string,
    allowedParticipants?: string[]
  ): Promise<{ messages: ParsedMessage[], title?: string, metadata?: any }> {
    const messages: ParsedMessage[] = [];
    const blocks = content.split(separator).filter(block => block.trim());
    
    // If allowedParticipants is set, only treat those names as message headers
    // Other patterns that look like headers get treated as regular text
    const allowedSet = allowedParticipants ? new Set(allowedParticipants) : null;
    
    for (const block of blocks) {
      const colonIndex = block.indexOf(':');
      
      // No colon found - append to previous message if exists, otherwise skip
      if (colonIndex === -1) {
        if (messages.length > 0) {
          messages[messages.length - 1].content += separator + block;
        }
        continue;
      }
      
      const potentialName = block.substring(0, colonIndex).trim();
      const text = block.substring(colonIndex + 1).trim();
      
      // Check if this looks like a valid participant name
      // Names should be reasonably short (no more than 50 chars) and not contain newlines
      const isValidNameFormat = potentialName.length > 0 && 
                                potentialName.length <= 50 && 
                                !potentialName.includes('\n');
      
      // If we have allowed participants filter, check against it
      const isAllowedParticipant = allowedSet ? allowedSet.has(potentialName) : isValidNameFormat;
      
      if (isAllowedParticipant && text) {
        // This is a valid message header
        const role = this.guessRole(potentialName);
        
        messages.push({
          role,
          content: text,
          participantName: potentialName
        });
      } else if (messages.length > 0) {
        // Not a valid header - append to previous message
        // Include the colon since it's part of the content
        messages[messages.length - 1].content += separator + block;
      } else {
        // No previous message to append to and not a valid header
        // Create a message with unknown participant
        messages.push({
          role: 'user',
          content: block,
          participantName: 'Unknown'
        });
      }
    }

    // Try to generate a title from the first message
    const title = messages.length > 0 
      ? messages[0].content.substring(0, 50) + (messages[0].content.length > 50 ? '...' : '')
      : undefined;

    return { messages, title };
  }

  private normalizeRole(role: string): 'user' | 'assistant' | 'system' {
    const normalized = role.toLowerCase();
    if (normalized === 'human' || normalized === 'user') return 'user';
    if (normalized === 'assistant' || normalized === 'ai' || normalized === 'bot') return 'assistant';
    if (normalized === 'system') return 'system';
    return 'user'; // Default to user for unknown roles
  }

  private guessRole(name: string): 'user' | 'assistant' {
    const lowerName = name.toLowerCase();
    
    // Common assistant indicators
    if (lowerName.includes('assistant') || 
        lowerName.includes('ai') || 
        lowerName.includes('bot') ||
        lowerName.includes('claude') ||
        lowerName.includes('gpt') ||
        lowerName.includes('model')) {
      return 'assistant';
    }
    
    // Default to user
    return 'user';
  }

  /**
   * Topologically sort messages so parents come before children.
   * This ensures correct ordering when the 'order' field doesn't reflect tree structure.
   */
  private sortMessagesByTreeOrder(messages: any[]): any[] {
    if (messages.length === 0) return [];
    
    // Build a map of branch ID -> message index
    const branchToMsgIndex = new Map<string, number>();
    for (let i = 0; i < messages.length; i++) {
      for (const branch of (messages[i].branches || [])) {
        branchToMsgIndex.set(branch.id, i);
      }
    }
    
    // Topological sort
    const sortedIndices: number[] = [];
    const visited = new Set<number>();
    const visiting = new Set<number>();
    
    const visit = (msgIndex: number): void => {
      if (visited.has(msgIndex)) return;
      if (visiting.has(msgIndex)) return; // Cycle detected, skip
      
      visiting.add(msgIndex);
      const msg = messages[msgIndex];
      
      // Visit all parents first
      for (const branch of (msg.branches || [])) {
        if (branch.parentBranchId && branch.parentBranchId !== 'root') {
          const parentMsgIndex = branchToMsgIndex.get(branch.parentBranchId);
          if (parentMsgIndex !== undefined && parentMsgIndex !== msgIndex) {
            visit(parentMsgIndex);
          }
        }
      }
      
      visiting.delete(msgIndex);
      visited.add(msgIndex);
      sortedIndices.push(msgIndex);
    };
    
    // Visit all messages
    for (let i = 0; i < messages.length; i++) {
      visit(i);
    }
    
    // Return messages in sorted order
    return sortedIndices.map(i => messages[i]);
  }
}
