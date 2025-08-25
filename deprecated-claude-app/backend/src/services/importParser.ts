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
              .filter(text => text)
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
    // Parse Chrome extension export format
    // This will be implemented based on the actual export format of your Chrome extension
    const data = JSON.parse(content);
    
    // For now, assume it's similar to basic JSON
    return this.parseBasicJson(content);
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
