import { Message, getActiveBranch, ModelSettings, TokenUsage } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { llmLogger } from '../utils/llmLogger.js';

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class OpenAICompatibleService {
  private db: Database;
  private apiKey: string;
  private baseUrl: string;
  private modelPrefix?: string;

  constructor(db: Database, apiKey: string, baseUrl: string, modelPrefix?: string) {
    this.db = db;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.modelPrefix = modelPrefix;
  }

  async streamCompletion(
    modelId: string,
    messages: Message[],
    systemPrompt: string | undefined,
    settings: ModelSettings,
    onChunk: (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => Promise<void>,
    stopSequences?: string[],
    onTokenUsage?: (usage: TokenUsage) => Promise<void>
  ): Promise<{ rawRequest?: any }> {
    const requestId = `openai-compatible-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    const chunks: string[] = [];

    try {
      // Convert messages to OpenAI format
      const openAIMessages = this.formatMessagesForOpenAI(messages, systemPrompt);
      
      // Apply model prefix if configured
      const actualModelId = this.modelPrefix ? `${this.modelPrefix}${modelId}` : modelId;
      
      const requestBody = {
        model: actualModelId,
        messages: openAIMessages,
        stream: true,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        ...(settings.topP !== undefined && { top_p: settings.topP }),
        ...(settings.topK !== undefined && { top_k: settings.topK }),
        ...(stopSequences && stopSequences.length > 0 && { stop: stopSequences })
      };

      // Log the request
      await llmLogger.logRequest({
        requestId,
        service: 'openai-compatible' as any,
        model: actualModelId,
        systemPrompt,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        topP: settings.topP,
        topK: settings.topK,
        stopSequences,
        messageCount: openAIMessages.length,
        requestBody,
        format: this.baseUrl
      });

      // Smart path construction - don't double-add /v1
      const endpoint = this.baseUrl.endsWith('/v1') 
        ? `${this.baseUrl}/chat/completions`
        : `${this.baseUrl}/v1/chat/completions`;
      
      console.log(`[OpenAI-Compatible] Making request to: ${endpoint}`);
      if (process.env.LOG_DEBUG === 'true') {
      console.log(`[OpenAI-Compatible] Model: ${actualModelId}`);
      console.log(`[OpenAI-Compatible] Request body:`, JSON.stringify(requestBody, null, 2));
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OpenAI-Compatible] Error response:`, errorText);
        console.error(`[OpenAI-Compatible] Request URL was: ${endpoint}`);
        console.error(`[OpenAI-Compatible] Model ID was: ${actualModelId}`);
        throw new Error(`OpenAI-compatible API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let totalTokens = 0;

      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              // Parse thinking tags from full content and create contentBlocks
              const contentBlocks = this.parseThinkingTags(fullContent);
              await onChunk('', true, contentBlocks.length > 0 ? contentBlocks : undefined);
              break;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              
              if (content) {
                chunks.push(content);
                fullContent += content;
                await onChunk(content, false);
              }

              // Check if we have usage data
              if (parsed.usage) {
                totalTokens = parsed.usage.total_tokens;
                if (onTokenUsage) {
                  await onTokenUsage({
                    promptTokens: parsed.usage.prompt_tokens,
                    completionTokens: parsed.usage.completion_tokens,
                    totalTokens: parsed.usage.total_tokens
                  });
                }
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }

      // Log the response
      const duration = Date.now() - startTime;
      await llmLogger.logResponse({
        requestId,
        service: 'openai-compatible' as any,
        model: actualModelId,
        chunks,
        duration,
        tokenCount: totalTokens
      });
      
      return { rawRequest: requestBody };
    } catch (error) {
      console.error('OpenAI-compatible streaming error:', error);
      
      // Log the error
      const duration = Date.now() - startTime;
      await llmLogger.logResponse({
        requestId,
        service: 'openai-compatible' as any,
        model: modelId,
        error: error instanceof Error ? error.message : String(error),
        duration
      });
      
      throw error;
    }
  }

  /**
   * Parse <think>...</think> tags from content and create contentBlocks
   * Used for open source models that output reasoning in this format
   */
  private parseThinkingTags(content: string): any[] {
    const contentBlocks: any[] = [];
    
    // Match all <think>...</think> blocks (non-greedy, handles multiple)
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    let match;
    let textContent = content;
    
    while ((match = thinkRegex.exec(content)) !== null) {
      const thinkingContent = match[1].trim();
      if (thinkingContent) {
        contentBlocks.push({
          type: 'thinking',
          thinking: thinkingContent
        });
      }
    }
    
    // Remove thinking tags from content to get the text part
    textContent = content.replace(thinkRegex, '').trim();
    
    // Add text block if there's remaining content
    if (textContent && contentBlocks.length > 0) {
      contentBlocks.push({
        type: 'text',
        text: textContent
      });
    }
    
    return contentBlocks;
  }

  formatMessagesForOpenAI(messages: Message[], systemPrompt?: string): OpenAIMessage[] {
    const formatted: OpenAIMessage[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
      formatted.push({
        role: 'system',
        content: systemPrompt
      });
    }

    // Convert messages
    for (const message of messages) {
      const activeBranch = getActiveBranch(message);
      if (activeBranch && activeBranch.role !== 'system') {
        let content = activeBranch.content;
        
        // For assistant messages with thinking blocks, prepend thinking wrapped in <think> tags
        // This format is commonly used by open source models (DeepSeek, Qwen, etc.)
        if (activeBranch.role === 'assistant' && activeBranch.contentBlocks && activeBranch.contentBlocks.length > 0) {
          let thinkingContent = '';
          
          for (const block of activeBranch.contentBlocks) {
            if (block.type === 'thinking') {
              thinkingContent += `<think>\n${block.thinking}\n</think>\n\n`;
            } else if (block.type === 'redacted_thinking') {
              thinkingContent += `<think>[Redacted for safety]</think>\n\n`;
            }
          }
          
          // Prepend thinking to content
          if (thinkingContent) {
            content = thinkingContent + content;
          }
        }
        
        // Append attachments to user messages
        if (activeBranch.role === 'user' && activeBranch.attachments && activeBranch.attachments.length > 0) {
          for (const attachment of activeBranch.attachments) {
            content += `\n\n<attachment filename="${attachment.fileName}">\n${attachment.content}\n</attachment>`;
          }
        }
        
        formatted.push({
          role: activeBranch.role as 'user' | 'assistant',
          content
        });
      }
    }

    return formatted;
  }

  // List available models from the API
  async listModels(): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        // Some providers don't implement the models endpoint
        console.warn(`Models endpoint not available: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return (data as any)?.data || [];
    } catch (error) {
      console.error('Failed to list models:', error);
      return [];
    }
  }

  // Validate API key by trying to list models or make a minimal completion
  async validateApiKey(): Promise<boolean> {
    try {
      // First try to list models
      const models = await this.listModels();
      if (models.length > 0) return true;

      // If models endpoint doesn't work, try a minimal completion
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'test',
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1
        })
      });

      // Even if it returns an error about the model, a 4xx response means auth worked
      return response.status !== 401 && response.status !== 403;
    } catch (error) {
      return false;
    }
  }
}
