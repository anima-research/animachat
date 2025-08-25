import { Message, getActiveBranch, ModelSettings, TokenUsage } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { llmLogger } from '../utils/llmLogger.js';

interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OpenRouterResponse {
  id: string;
  choices: [{
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenRouterService {
  private db: Database;
  private apiKey: string;
  private baseUrl = 'https://openrouter.ai/api/v1';

  constructor(db: Database, apiKey?: string) {
    this.db = db;
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || '';
  }

  async streamCompletion(
    modelId: string,
    messages: Message[],
    systemPrompt: string | undefined,
    settings: ModelSettings,
    onChunk: (chunk: string, isComplete: boolean) => Promise<void>,
    stopSequences?: string[],
    onTokenUsage?: (usage: TokenUsage) => Promise<void>
  ): Promise<void> {
    const requestId = `openrouter-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    const chunks: string[] = [];

    try {
      // Convert messages to OpenRouter format
      const openRouterMessages = this.formatMessagesForOpenRouter(messages, systemPrompt);
      
      const requestBody = {
        model: modelId,
        messages: openRouterMessages,
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
        service: 'openrouter' as any,
        model: modelId,
        systemPrompt,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        topP: settings.topP,
        topK: settings.topK,
        stopSequences,
        messageCount: openRouterMessages.length,
        requestBody
      });

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || 'http://localhost:3010',
          'X-Title': 'Deprecated Claude App'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let totalTokens = 0;

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
              await onChunk('', true);
              break;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              
              if (content) {
                chunks.push(content);
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
        service: 'openrouter' as any,
        model: modelId,
        chunks,
        duration,
        tokenCount: totalTokens
      });
    } catch (error) {
      console.error('OpenRouter streaming error:', error);
      
      // Log the error
      const duration = Date.now() - startTime;
      await llmLogger.logResponse({
        requestId,
        service: 'openrouter' as any,
        model: modelId,
        error: error instanceof Error ? error.message : String(error),
        duration
      });
      
      throw error;
    }
  }

  private formatMessagesForOpenRouter(messages: Message[], systemPrompt?: string): OpenRouterMessage[] {
    const formatted: OpenRouterMessage[] = [];

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
        formatted.push({
          role: activeBranch.role as 'user' | 'assistant',
          content: activeBranch.content
        });
      }
    }

    return formatted;
  }

  // List available models from OpenRouter
  async listModels(): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.status}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Failed to list OpenRouter models:', error);
      return [];
    }
  }

  // Validate API key
  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const testService = new OpenRouterService(this.db, apiKey);
      const models = await testService.listModels();
      return models.length > 0;
    } catch (error) {
      return false;
    }
  }
}
