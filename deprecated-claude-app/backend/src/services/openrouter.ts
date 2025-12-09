import { Message, getActiveBranch, ModelSettings, TokenUsage } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { llmLogger } from '../utils/llmLogger.js';
import { Logger } from '../utils/logger.js';
import { logOpenRouterRequest, logOpenRouterResponse } from '../utils/openrouterLogger.js';

interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
  cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' };
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
    // Anthropic cache fields (via OpenRouter)
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
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
  
  /**
   * EXACT REPRODUCTION of working test script
   * Non-streaming, matches test-prompt-caching.js line-by-line
   * Used to verify OpenRouter caching works in production environment
   */
  async streamCompletionExactTest(
    modelId: string,
    messages: Message[],
    systemPrompt: string | undefined,
    settings: ModelSettings,
    onChunk: (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => Promise<void>,
    stopSequences?: string[]
  ): Promise<{
    usage?: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
    }
  }> {
    const requestId = `openrouter-exact-${Date.now()}`;
    const startTime = Date.now();
    
    try {
      // Detect provider (same as production)
      const provider = this.detectProviderFromModelId(modelId);
      
      // Format messages EXACTLY like test script
      const openRouterMessages = this.formatMessagesForOpenRouter(messages, systemPrompt, provider);
      
      // REQUEST BODY - EXACT COPY from test-prompt-caching.js
      const requestBody = {
        model: modelId,
        messages: openRouterMessages,
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        // CRITICAL: These three fields from test script
        usage: { include: true },
        provider: {
          order: ['Anthropic'],
          allow_fallbacks: false
        },
        transforms: ['prompt-caching']
      };
      
      Logger.cache(`[OpenRouter-EXACT] Request to ${modelId} with caching enabled`);
      Logger.cache(`[OpenRouter-EXACT] Messages: ${openRouterMessages.length}, Provider forced: Anthropic`);
      
      // NON-STREAMING REQUEST (exactly like test script)
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || 'http://localhost:3010',
          'X-Title': 'Arc Chat'
        },
        body: JSON.stringify(requestBody)
      });
      
      const duration = Date.now() - startTime;
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
      }
      
      const result = await response.json() as any;
      
      Logger.cache(`[OpenRouter-EXACT] Response received (${duration}ms)`);
      
      // Extract content
      const content = result.choices?.[0]?.message?.content || '';
      
      // Stream the complete content at once (simulate streaming)
      await onChunk(content, false);
      
      // Parse usage EXACTLY like test script
      const usage = result.usage || {};
      const promptTokens = usage.prompt_tokens || 0;
      const completionTokens = usage.completion_tokens || 0;
      const cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0;
      
      // OpenRouter's prompt_tokens is TOTAL (includes cached)
      // To match Anthropic semantics, we report fresh = total - cached
      const freshInputTokens = promptTokens - cachedTokens;
      
      Logger.cache(`[OpenRouter-EXACT] Usage:`, {
        promptTokens,
        freshInputTokens,
        completionTokens,
        cachedTokens,
        cost: usage.cost
      });
      
      if (cachedTokens > 0) {
        Logger.cache(`[OpenRouter-EXACT] ✅ CACHE HIT! ${cachedTokens} tokens cached`);
      } else {
        Logger.cache(`[OpenRouter-EXACT] ❌ No cache hit (first request or expired)`);
      }
      
      // Complete the stream
      // NOTE: inputTokens = fresh only (non-cached), to match Anthropic semantics
      // enhanced-inference.ts will add cacheRead to get total
      const actualUsage = {
        inputTokens: freshInputTokens,
        outputTokens: completionTokens,
        cacheCreationInputTokens: 0, // OpenRouter doesn't distinguish
        cacheReadInputTokens: cachedTokens
      };
      
      await onChunk('', true, undefined, actualUsage);
      
      return {
        usage: actualUsage
      };
      
    } catch (error) {
      Logger.error('[OpenRouter-EXACT] Error:', error);
      throw error;
    }
  }

  async streamCompletion(
    modelId: string,
    messages: Message[],
    systemPrompt: string | undefined,
    settings: ModelSettings,
    onChunk: (chunk: string, isComplete: boolean, contentBlocks?: any[], usage?: any) => Promise<void>,
    stopSequences?: string[],
    onTokenUsage?: (usage: TokenUsage) => Promise<void>
  ): Promise<{
    usage?: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
    }
  }> {
    const requestId = `openrouter-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    const chunks: string[] = [];

    try {
      // Determine the provider from the model ID for cache syntax
      const provider = this.detectProviderFromModelId(modelId);
      
      // Convert messages to OpenRouter format with cache support
      const openRouterMessages = this.formatMessagesForOpenRouter(messages, systemPrompt, provider);
      
      const requestBody: any = {
        model: modelId,
        messages: openRouterMessages,
        stream: true,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        ...(settings.topP !== undefined && { top_p: settings.topP }),
        ...(settings.topK !== undefined && { top_k: settings.topK }),
        ...(stopSequences && stopSequences.length > 0 && { stop: stopSequences }),
        
        // Required for cache metrics in response
        usage: { include: true }
      };
      
      // For Anthropic models: force native provider and enable caching
      if (provider === 'anthropic') {
        requestBody.provider = {
          order: ['Anthropic'],
          allow_fallbacks: false
        };
        requestBody.transforms = ['prompt-caching'];
        Logger.cache(`[OpenRouter] 🔒 Forcing native Anthropic with prompt-caching enabled`);
      }

      // Log request to file (with truncated message content) and get cache hash
      logOpenRouterRequest(requestId, modelId, requestBody, provider);
      
      // Log summary to console
      Logger.cache(`[OpenRouter] 📝 Request logged: logs/openrouter/${requestId}.log`);
      
      // Log the request (legacy logger)
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
      let promptTokens = 0;
      let completionTokens = 0;
      let cacheMetrics = {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0
      };

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
              // Pass usage metrics when completing
              // OpenRouter's prompt_tokens is TOTAL (includes cached)
              // Report fresh tokens only, to match Anthropic semantics
              const freshInputTokens = promptTokens - cacheMetrics.cacheReadInputTokens;
              
              const actualUsage = {
                inputTokens: freshInputTokens,
                outputTokens: completionTokens,
                cacheCreationInputTokens: cacheMetrics.cacheCreationInputTokens,
                cacheReadInputTokens: cacheMetrics.cacheReadInputTokens
              };
              await onChunk('', true, undefined, actualUsage);
              break;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              
              if (content) {
                chunks.push(content);
                await onChunk(content, false);
              }
              
              // Capture prompt tokens early to calculate fresh tokens later
              if (parsed.usage?.prompt_tokens) {
                promptTokens = parsed.usage.prompt_tokens;
              }

              // Check if we have usage data (including cache metrics for Anthropic models)
              if (parsed.usage) {
                totalTokens = parsed.usage.total_tokens;
                promptTokens = parsed.usage.prompt_tokens || 0;
                completionTokens = parsed.usage.completion_tokens || 0;
                
                // OpenRouter format: cache info in prompt_tokens_details.cached_tokens
                if (parsed.usage.prompt_tokens_details?.cached_tokens) {
                  // OpenRouter doesn't distinguish creation vs read, just reports cached
                  cacheMetrics.cacheReadInputTokens = parsed.usage.prompt_tokens_details.cached_tokens;
                  Logger.cache(`[OpenRouter] ✅ Cache hit detected: ${cacheMetrics.cacheReadInputTokens} tokens`);
                } else {
                  Logger.cache(`[OpenRouter] ❌ No cache hit (cached_tokens: ${parsed.usage.prompt_tokens_details?.cached_tokens || 0})`);
                }
                
                // Also check for native Anthropic format (fallback)
                if (parsed.usage.cache_creation_input_tokens !== undefined) {
                  cacheMetrics.cacheCreationInputTokens = parsed.usage.cache_creation_input_tokens;
                }
                if (parsed.usage.cache_read_input_tokens !== undefined) {
                  cacheMetrics.cacheReadInputTokens = parsed.usage.cache_read_input_tokens;
                }
                
                // OpenRouter's prompt_tokens is TOTAL (includes cached)
                // Adjust to get fresh tokens only for token usage callback
                const freshPromptTokens = promptTokens - cacheMetrics.cacheReadInputTokens;
                
                if (onTokenUsage) {
                  await onTokenUsage({
                    promptTokens: freshPromptTokens, // Report fresh only
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
      
      // Create full response object for logging (simulating what we'd get from non-streaming)
      const fullResponseForLog = {
        id: `gen-${requestId}`,
        provider: provider === 'anthropic' ? 'Anthropic' : 'OpenRouter',
        model: modelId,
        choices: [{
          message: {
            role: 'assistant',
            content: chunks.join('')
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          prompt_tokens_details: {
            cached_tokens: cacheMetrics.cacheReadInputTokens
          }
        }
      };
      
      // Log response to file with full structure
      logOpenRouterResponse(requestId, fullResponseForLog, fullResponseForLog.usage, cacheMetrics, chunks.join(''));
      
      await llmLogger.logResponse({
        requestId,
        service: 'openrouter' as any,
        model: modelId,
        chunks,
        duration,
        tokenCount: totalTokens
      });
      
      // Log cache metrics if available (for Anthropic models via OpenRouter)
      if (cacheMetrics.cacheReadInputTokens > 0 || cacheMetrics.cacheCreationInputTokens > 0) {
        const costSaved = this.calculateCacheSavings(modelId, cacheMetrics.cacheReadInputTokens, provider);
        
        // Distinguish between different cache scenarios
        const hasRead = cacheMetrics.cacheReadInputTokens > 0;
        const hasCreation = cacheMetrics.cacheCreationInputTokens > 0;
        
        if (hasRead && hasCreation) {
          // Cache partial hit + rebuild (cache was partially valid)
          const efficiency = totalTokens > 0 ? ((cacheMetrics.cacheReadInputTokens / totalTokens) * 100).toFixed(1) : '0';
          Logger.cache(`♾️ Cache partial: ${cacheMetrics.cacheReadInputTokens} tokens reused (${efficiency}%), ${cacheMetrics.cacheCreationInputTokens} tokens rebuilt`);
        } else if (hasCreation && !hasRead) {
          // Pure cache creation (no reuse)
          const duration = '1 hour'; // All caches are 1-hour now
          const isRebuild = messages.some(msg => {
            const branch = getActiveBranch(msg);
            return branch && (branch as any)._cacheControl;
          });
          
          if (isRebuild) {
            Logger.cache(`🔄 Cache rebuilt: ${cacheMetrics.cacheCreationInputTokens} tokens (expires in ${duration})`);
          } else {
            Logger.cache(`📦 Cache created: ${cacheMetrics.cacheCreationInputTokens} tokens (expires in ${duration})`);
          }
        } else if (hasRead && !hasCreation) {
          // Pure cache hit (full reuse)
          const efficiency = totalTokens > 0 ? ((cacheMetrics.cacheReadInputTokens / totalTokens) * 100).toFixed(1) : '0';
          Logger.cache(`✅ Cache hit! ${cacheMetrics.cacheReadInputTokens} tokens (${efficiency}%) - saved $${costSaved.toFixed(4)}`);
        }
        
        // Log as a separate entry for tracking
        await llmLogger.logCustom({
          timestamp: new Date().toISOString(),
          type: 'CACHE_METRICS',
          requestId,
          provider,
          model: modelId,
          cacheCreationInputTokens: cacheMetrics.cacheCreationInputTokens,
          cacheReadInputTokens: cacheMetrics.cacheReadInputTokens,
          costSaved
        });
      }
      
      // Return usage metrics (captured from streaming response)
      // Note: OpenRouter may not send usage data, in which case we return empty
      if (promptTokens > 0 || completionTokens > 0) {
        // OpenRouter's prompt_tokens is TOTAL (includes cached)
        // Report fresh tokens only, to match Anthropic semantics
        const freshInputTokens = promptTokens - cacheMetrics.cacheReadInputTokens;
        
        return {
          usage: {
            inputTokens: freshInputTokens,
            outputTokens: completionTokens,
            cacheCreationInputTokens: cacheMetrics.cacheCreationInputTokens,
            cacheReadInputTokens: cacheMetrics.cacheReadInputTokens
          }
        };
      }
      
      return {}; // No usage data available
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

  formatMessagesForOpenRouter(messages: Message[], systemPrompt?: string, provider?: string): OpenRouterMessage[] {
    const formatted: OpenRouterMessage[] = [];

    // Check if any message has cache control (to determine if we should cache system prompt)
    const hasCacheControl = messages.some(msg => {
      const activeBranch = getActiveBranch(msg);
      return activeBranch && (activeBranch as any)._cacheControl;
    });

    // Add system prompt if provided
    if (systemPrompt) {
      // For Anthropic models, wrap system prompt in content blocks if caching is enabled
      if (hasCacheControl && provider === 'anthropic') {
        // System prompt should also be cached (but without cache_control marker - it's implicit)
        formatted.push({
          role: 'system',
          content: systemPrompt
        });
      } else {
        formatted.push({
          role: 'system',
          content: systemPrompt
        });
      }
    }

    // Convert messages
    for (const message of messages) {
      const activeBranch = getActiveBranch(message);
      if (activeBranch && activeBranch.role !== 'system') {
        let content: string | ContentBlock[] = activeBranch.content;
        
        // Check if this message has cache control marker
        const cacheControl = (activeBranch as any)._cacheControl;
        
        // Handle attachments for user messages
        if (activeBranch.role === 'user' && activeBranch.attachments && activeBranch.attachments.length > 0) {
          // Convert to content blocks format to handle attachments properly
          const contentBlocks: ContentBlock[] = [{ type: 'text', text: activeBranch.content }];
          
          for (const attachment of activeBranch.attachments) {
            const extension = attachment.fileName.split('.').pop()?.toLowerCase() || '';
            const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension);
            const isPdf = extension === 'pdf';
            
            if (isImage) {
              // Add image - use Anthropic format for Claude, file format for others
              const mediaType = this.getMediaType(attachment.fileName, (attachment as any).mimeType);
              
              if (provider === 'anthropic') {
                // Anthropic format for Claude models
                contentBlocks.push({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: attachment.content
                  }
                } as any);
              } else {
                // OpenRouter file format for other models (OpenAI, Gemini, etc.)
                const fileData = `data:${mediaType};base64,${attachment.content}`;
                contentBlocks.push({
                  type: 'file',
                  file: {
                    filename: attachment.fileName,
                    file_data: fileData,
                  }
                } as any);
              }
              console.log(`[OpenRouter] Added image attachment: ${attachment.fileName} (${mediaType})`);
            } else if (isPdf) {
              // OpenRouter PDF processing - uses file type with data URI format
              // Processing engines (specified via X-PDF-Engine header or defaults):
              // - "native": Use model's native PDF support (Claude, Gemini) - charged as input tokens
              // - "pdf-text": Free text extraction for well-structured PDFs
              // - "mistral-ocr": $2/1000 pages for scanned documents
              // Default: native if available, otherwise mistral-ocr
              
              // Format: data:application/pdf;base64,{base64_data}
              const fileData = `data:application/pdf;base64,${attachment.content}`;
              
              contentBlocks.push({
                type: 'file',
                file: {
                  filename: attachment.fileName,
                  file_data: fileData,
                }
              } as any);
              console.log(`[OpenRouter] Added PDF attachment: ${attachment.fileName}`);
            } else if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'webm'].includes(extension)) {
              // Audio files - supported by Gemini, GPT-4o, etc.
              const mediaType = this.getMediaType(attachment.fileName, (attachment as any).mimeType);
              const fileData = `data:${mediaType};base64,${attachment.content}`;
              
              contentBlocks.push({
                type: 'file',
                file: {
                  filename: attachment.fileName,
                  file_data: fileData,
                }
              } as any);
              console.log(`[OpenRouter] Added audio attachment: ${attachment.fileName} (${mediaType})`);
            } else if (['mp4', 'mov', 'avi', 'mkv'].includes(extension)) {
              // Video files - supported by Gemini
              const mediaType = this.getMediaType(attachment.fileName, (attachment as any).mimeType);
              const fileData = `data:${mediaType};base64,${attachment.content}`;
              
              contentBlocks.push({
                type: 'file',
                file: {
                  filename: attachment.fileName,
                  file_data: fileData,
                }
              } as any);
              console.log(`[OpenRouter] Added video attachment: ${attachment.fileName} (${mediaType})`);
            } else {
              // Append text attachments to the text content
            contentBlocks[0].text += `\n\n<attachment filename="${attachment.fileName}">\n${attachment.content}\n</attachment>`;
            }
          }
          
          // Add cache control to the last content block if present
          if (cacheControl && provider === 'anthropic') {
            contentBlocks[contentBlocks.length - 1].cache_control = cacheControl;
            console.log(`[OpenRouter] 🎯 Cache control marker added to message with attachments`);
          }
          
          content = contentBlocks;
        } else if (activeBranch.role === 'assistant' && activeBranch.contentBlocks && activeBranch.contentBlocks.length > 0 && provider === 'anthropic') {
          // Assistant message with thinking blocks - format as content array for Anthropic API
          // This is required for models like Opus 4.5 to maintain chain of thought
          const apiContentBlocks: ContentBlock[] = [];
          
          for (const block of activeBranch.contentBlocks) {
            if (block.type === 'thinking') {
              apiContentBlocks.push({
                type: 'thinking',
                thinking: block.thinking,
                ...(block.signature && { signature: block.signature })
              } as any);
            } else if (block.type === 'redacted_thinking') {
              apiContentBlocks.push({
                type: 'redacted_thinking',
                data: block.data
              } as any);
            } else if (block.type === 'text') {
              apiContentBlocks.push({
                type: 'text',
                text: block.text
              });
            }
          }
          
          // If no text block was in contentBlocks, add the main content
          const hasTextBlock = apiContentBlocks.some(b => b.type === 'text');
          if (!hasTextBlock && activeBranch.content.trim()) {
            apiContentBlocks.push({
              type: 'text',
              text: activeBranch.content
            });
          }
          
          // Add cache control to last block if present
          if (cacheControl && apiContentBlocks.length > 0) {
            apiContentBlocks[apiContentBlocks.length - 1].cache_control = cacheControl;
            console.log(`[OpenRouter] 🎯 Cache control marker added to assistant message with thinking`);
          }
          
          content = apiContentBlocks;
        } else if (cacheControl && provider === 'anthropic') {
          // Need to convert to content block format to add cache control
          content = [{
            type: 'text',
            text: activeBranch.content,
            cache_control: cacheControl
          }];
          console.log(`[OpenRouter] 🎯 Cache control marker added to message at position ${messages.indexOf(message)}`);
        }
        
        formatted.push({
          role: activeBranch.role as 'user' | 'assistant',
          content
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
      return (data as any)?.data || [];
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
  
  /**
   * Detect the underlying provider from the OpenRouter model ID
   * This helps us determine which cache syntax to use
   */
  private getMediaType(fileName: string, mimeType?: string): string {
    // Use provided mimeType if available
    if (mimeType) return mimeType;
    
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const mediaTypes: { [key: string]: string } = {
      // Images
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      // Documents
      'pdf': 'application/pdf',
      // Audio
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'flac': 'audio/flac',
      'ogg': 'audio/ogg',
      'm4a': 'audio/mp4',
      'aac': 'audio/aac',
      'webm': 'audio/webm',
      // Video
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
    };
    return mediaTypes[extension] || 'application/octet-stream';
  }
  
  private detectProviderFromModelId(modelId: string): string {
    const lowerId = modelId.toLowerCase();
    
    // Anthropic models
    if (lowerId.includes('anthropic/') || lowerId.includes('claude')) {
      return 'anthropic';
    }
    
    // OpenAI models
    if (lowerId.includes('openai/') || lowerId.includes('gpt')) {
      return 'openai';
    }
    
    // Google models
    if (lowerId.includes('google/') || lowerId.includes('gemini') || lowerId.includes('palm')) {
      return 'google';
    }
    
    // Meta models
    if (lowerId.includes('meta-llama/') || lowerId.includes('llama')) {
      return 'meta';
    }
    
    // Mistral models
    if (lowerId.includes('mistralai/') || lowerId.includes('mistral')) {
      return 'mistral';
    }
    
    // Cohere models
    if (lowerId.includes('cohere/')) {
      return 'cohere';
    }
    
    // Default to unknown
    return 'unknown';
  }
  
  /**
   * Calculate cost savings from cached tokens
   * Currently only implemented for Anthropic models via OpenRouter
   */
  private calculateCacheSavings(modelId: string, cachedTokens: number, provider: string): number {
    if (provider !== 'anthropic' || cachedTokens === 0) {
      return 0;
    }
    
    // Anthropic pricing per 1M tokens via OpenRouter
    // Note: OpenRouter may add a small markup, but cache savings are still ~90%
    // NOTE: For console logging only. UI uses enhanced-inference.ts pricing (source of truth)
    // Model pricing per 1M input tokens (updated 2025-11-24)
    const pricingPer1M: Record<string, number> = {
      // Anthropic via OpenRouter (4.x models)
      'anthropic/claude-opus-4.5': 5.00,      // New! 3x cheaper
      'anthropic/claude-opus-4.1': 15.00,
      'anthropic/claude-opus-4': 15.00,
      'anthropic/claude-sonnet-4': 3.00,
      'anthropic/claude-haiku-4': 0.80,
      
      // Anthropic via OpenRouter (3.x models)
      'anthropic/claude-3-opus': 15.00,
      'anthropic/claude-3-opus-20240229': 15.00,
      'anthropic/claude-3.5-sonnet': 3.00,
      'anthropic/claude-3-5-sonnet-20241022': 3.00,
      'anthropic/claude-3-sonnet': 3.00,
      'anthropic/claude-3-haiku': 0.25,
      'anthropic/claude-3-haiku-20240307': 0.25,
      'anthropic/claude-3.5-haiku': 0.80,
      'anthropic/claude-3-5-haiku-20241022': 0.80,
    };
    
    const pricePerToken = (pricingPer1M[modelId] || 3.00) / 1_000_000;
    // Cached tokens are 90% cheaper (10% cost vs full price)
    const savings = cachedTokens * pricePerToken * 0.9;
    
    return savings;
  }
}
