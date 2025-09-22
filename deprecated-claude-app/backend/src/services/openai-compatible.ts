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
    onChunk: (chunk: string, isComplete: boolean) => Promise<void>,
    stopSequences?: string[],
    onTokenUsage?: (usage: TokenUsage) => Promise<void>,
    apiType?: 'chat' | 'completion',
    assistantName?: string
  ): Promise<void> {
    const requestId = `openai-compatible-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    const chunks: string[] = [];

    try {
      // Apply model prefix if configured
      const actualModelId = this.modelPrefix ? `${this.modelPrefix}${modelId}` : modelId;
      
      // Determine API type (default to chat)
      const useCompletionAPI = apiType === 'completion';
      
      let requestBody: any;
      let endpoint: string;
      
      if (useCompletionAPI) {
        // Format for completion API
        const prompt = this.formatMessagesAsPrompt(messages, systemPrompt, assistantName);
        requestBody = {
          model: actualModelId,
          prompt,
          stream: true,
          temperature: settings.temperature,
          max_tokens: settings.maxTokens,
          ...(settings.topP !== undefined && { top_p: settings.topP }),
          ...(settings.topK !== undefined && { top_k: settings.topK }),
          ...(stopSequences && stopSequences.length > 0 && { stop: stopSequences })
        };
        endpoint = `${this.baseUrl}/v1/completions`;
      } else {
        // Format for chat completion API
        const openAIMessages = this.formatMessagesForOpenAI(messages, systemPrompt);
        requestBody = {
          model: actualModelId,
          messages: openAIMessages,
          stream: true,
          temperature: settings.temperature,
          max_tokens: settings.maxTokens,
          ...(settings.topP !== undefined && { top_p: settings.topP }),
          ...(settings.topK !== undefined && { top_k: settings.topK }),
          ...(stopSequences && stopSequences.length > 0 && { stop: stopSequences })
        };
        endpoint = `${this.baseUrl}/v1/chat/completions`;
      }

      // Log the request
      console.log(`[OpenAI-Compatible] Request to ${endpoint}:`, JSON.stringify(requestBody, null, 2));
      
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
        messageCount: messages.length,
        requestBody,
        format: `${this.baseUrl} (${useCompletionAPI ? 'completion' : 'chat'})`
      });

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
        throw new Error(`OpenAI-compatible API error: ${response.status} ${response.statusText} - ${errorText}`);
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
              
              // Handle both chat and completion API responses
              let content: string | undefined;
              if (useCompletionAPI) {
                // Completion API: choices[0].text
                content = parsed.choices?.[0]?.text;
              } else {
                // Chat API: choices[0].delta.content
                content = parsed.choices?.[0]?.delta?.content;
              }
              
              if (content) {
                // For XML format completions, strip any trailing </msg> that might be included
                let processedContent = content;
                if (useCompletionAPI && requestBody.prompt.includes('<msg username=')) {
                  // Check if this chunk ends with </msg> and remove it
                  processedContent = content.replace(/<\/msg>$/, '');
                }
                chunks.push(processedContent);
                await onChunk(processedContent, false);
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

  private formatMessagesAsPrompt(messages: Message[], systemPrompt?: string, assistantName?: string): string {
    // For completion API, we need to format messages as a single prompt string
    // Messages passed here should already be formatted with participant names
    let prompt = '';
    
    // Add system prompt if provided
    if (systemPrompt) {
      prompt += `${systemPrompt}\n\n`;
    }
    
    // Convert messages to prompt format
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const activeBranch = getActiveBranch(message);
      if (activeBranch) {
        // The content should already include formatting from formatMessagesForConversation
        // (either "name: content" or "<msg username="name">content</msg>")
        prompt += activeBranch.content;
        
        // Add spacing between messages (but not after the last one)
        if (i < messages.length - 1) {
          // For XML format, use single newline between messages
          const useXmlFormat = activeBranch.content.includes('<msg username=');
          prompt += useXmlFormat ? '\n' : '\n\n';
        }
      }
    }
    
    // For completion models, we need to start the assistant's response
    // Check if we're using XML format by looking at the last message
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      const lastBranch = getActiveBranch(lastMessage);
      if (lastBranch && lastBranch.content.includes('<msg username=')) {
        // XML format - add the start of assistant's message with single newline
        const name = assistantName || 'Assistant';
        prompt += `\n<msg username="${name}">`;
      }
      // For colon format, the model can continue naturally
    }
    
    // Return the prompt as-is (don't trim, as spacing is intentional)
    return prompt;
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
