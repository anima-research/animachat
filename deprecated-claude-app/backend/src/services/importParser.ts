import { 
  ImportFormat, 
  RawMessage, 
  ParsedMessage, 
  ImportPreview,
  RawMessageSchema 
} from '@deprecated-claude/shared';

export class ImportParser {
  async parse(format: ImportFormat, content: string): Promise<ImportPreview> {
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
      case 'openai':
        ({ messages, title, metadata } = await this.parseOpenAI(content));
        break;
      case 'colon_single':
        ({ messages, title, metadata } = await this.parseColonFormat(content, '\n'));
        break;
      case 'colon_double':
        ({ messages, title, metadata } = await this.parseColonFormat(content, '\n\n'));
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    // Detect participants
    const participantMap = new Map<string, { role: 'user' | 'assistant' | 'unknown', count: number }>();
    
    for (const msg of messages) {
      const name = msg.participantName || (msg.role === 'user' ? 'User' : 'Assistant');
      const existing = participantMap.get(name) || { role: msg.role === 'system' ? 'unknown' : msg.role, count: 0 };
      existing.count++;
      participantMap.set(name, existing);
    }

    const detectedParticipants = Array.from(participantMap.entries()).map(([name, data]) => ({
      name,
      role: data.role,
      messageCount: data.count
    }));

    // Suggest format based on participant count
    const suggestedFormat = detectedParticipants.length > 2 ? 'prefill' : 'standard';

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

  private async parseColonFormat(content: string, separator: string): Promise<{ messages: ParsedMessage[], title?: string, metadata?: any }> {
    const messages: ParsedMessage[] = [];
    const blocks = content.split(separator).filter(block => block.trim());
    
    for (const block of blocks) {
      const colonIndex = block.indexOf(':');
      if (colonIndex === -1) continue;
      
      const name = block.substring(0, colonIndex).trim();
      const text = block.substring(colonIndex + 1).trim();
      
      if (name && text) {
        // Try to guess role based on common patterns
        const role = this.guessRole(name);
        
        messages.push({
          role,
          content: text,
          participantName: name
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
}
