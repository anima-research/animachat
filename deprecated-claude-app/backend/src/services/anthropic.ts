import Anthropic from '@anthropic-ai/sdk';
import { Message, getActiveBranch, ModelSettings } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { llmLogger } from '../utils/llmLogger.js';

export class AnthropicService {
  private client: Anthropic;
  private db: Database;

  constructor(db: Database, apiKey?: string) {
    this.db = db;
    
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY || 'demo-key'
    });
  }

  async streamCompletion(
    modelId: string,
    messages: Message[],
    systemPrompt: string | undefined,
    settings: ModelSettings,
    onChunk: (chunk: string, isComplete: boolean) => Promise<void>,
    stopSequences?: string[]
  ): Promise<void> {
    // Demo mode - simulate streaming response
    if (process.env.DEMO_MODE === 'true') {
      await this.simulateStreamingResponse(messages, onChunk);
      return;
    }

    let requestId: string | undefined;
    let startTime: number = Date.now();
    let requestParams: any;

    try {
      // Convert messages to Anthropic format
      const anthropicMessages = this.formatMessagesForAnthropic(messages);
      
      // Debug logging
      console.log(`Total messages to Anthropic: ${anthropicMessages.length}`);
      if (anthropicMessages.length > 160) {
        console.log(`Message 160-165 content lengths:`, 
          anthropicMessages.slice(160, 165).map((m, i) => ({
            index: 160 + i,
            role: m.role,
            contentLength: typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length
          }))
        );
      }
      
      // Check if we need to cache the system prompt
      let systemContent: any = systemPrompt;
      if (systemPrompt && messages.length > 0) {
        // Check if first message has cache control (indicating it's the cache boundary)
        const firstMessage = messages[0];
        const firstBranch = getActiveBranch(firstMessage);
        if (firstBranch && (firstBranch as any)._cacheControl) {
          // System prompt should also be cached
          systemContent = [{
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' as const }
          }];
        }
      }
      
      requestParams = {
        model: modelId,
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        ...(settings.topP !== undefined && { top_p: settings.topP }),
        ...(settings.topK !== undefined && { top_k: settings.topK }),
        ...(systemContent && { system: systemContent }),
        ...(stopSequences && stopSequences.length > 0 && { stop_sequences: stopSequences }),
        messages: anthropicMessages,
        stream: true
      };
      
      requestId = `anthropic-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Log the request
      await llmLogger.logRequest({
        requestId,
        service: 'anthropic',
        model: requestParams.model,
        systemPrompt: systemPrompt,
        temperature: requestParams.temperature,
        maxTokens: requestParams.max_tokens,
        topP: requestParams.top_p,
        topK: requestParams.top_k,
        stopSequences: stopSequences,
        messageCount: anthropicMessages.length,
        requestBody: {
          ...requestParams,
          messages: anthropicMessages
        }
      });
      
      startTime = Date.now();
      const chunks: string[] = [];
      
      const stream = await this.client.messages.create(requestParams) as any;

      let stopReason: string | undefined;
      let usage: any = {};
      let cacheMetrics = {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0
      };
      
      for await (const chunk of stream) {
        // Log all chunk types for debugging
        console.log(`[Anthropic API] Chunk type: ${chunk.type}`, {
          type: chunk.type,
          ...(chunk.type === 'message_start' && { message: chunk.message }),
          ...(chunk.type === 'content_block_start' && { content_block: chunk.content_block }),
          ...(chunk.type === 'content_block_stop' && { index: chunk.index }),
          ...(chunk.type === 'message_delta' && { 
            stop_reason: chunk.delta?.stop_reason,
            stop_sequence: chunk.delta?.stop_sequence,
            usage: chunk.usage 
          })
        });
        
        // Capture cache metrics from message_start
        if (chunk.type === 'message_start' && chunk.message?.usage) {
          const messageUsage = chunk.message.usage;
          cacheMetrics.cacheCreationInputTokens = messageUsage.cache_creation_input_tokens || 0;
          cacheMetrics.cacheReadInputTokens = messageUsage.cache_read_input_tokens || 0;
          console.log('[Anthropic API] Cache metrics:', cacheMetrics);
        }
        
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          chunks.push(chunk.delta.text);
          await onChunk(chunk.delta.text, false);
        } else if (chunk.type === 'message_delta') {
          // Capture stop reason and usage
          if (chunk.delta?.stop_reason) {
            stopReason = chunk.delta.stop_reason;
            console.log(`[Anthropic API] Stop reason: ${stopReason}`);
            if (chunk.delta?.stop_sequence) {
              console.log(`[Anthropic API] Stop sequence: "${chunk.delta.stop_sequence}"`);
            }
          }
          if (chunk.usage) {
            usage = chunk.usage;
            console.log(`[Anthropic API] Token usage:`, usage);
          }
        } else if (chunk.type === 'message_stop') {
          await onChunk('', true);
          
          // Log complete response summary
          const fullResponse = chunks.join('');
          console.log(`[Anthropic API] Response complete:`, {
            model: requestParams.model,
            totalLength: fullResponse.length,
            stopReason,
            usage,
            truncated: stopReason === 'max_tokens',
            lastChars: fullResponse.slice(-100)
          });
          
          // Calculate cost savings
          const costSaved = this.calculateCacheSavings(requestParams.model, cacheMetrics.cacheReadInputTokens);
          
          // Log the response
          const duration = Date.now() - startTime;
          await llmLogger.logResponse({
            requestId,
            service: 'anthropic',
            model: requestParams.model,
            chunks,
            duration
          });
          
          // Log cache metrics separately
          if (cacheMetrics.cacheReadInputTokens > 0 || cacheMetrics.cacheCreationInputTokens > 0) {
            console.log(`[Anthropic API] Cache metrics:`, {
              cacheCreationInputTokens: cacheMetrics.cacheCreationInputTokens,
              cacheReadInputTokens: cacheMetrics.cacheReadInputTokens,
              costSaved: `$${costSaved.toFixed(4)}`
            });
            
            // Log as a separate entry for tracking
            await llmLogger.logCustom({
              timestamp: new Date().toISOString(),
              type: 'CACHE_METRICS',
              requestId,
              model: requestParams.model,
              cacheCreationInputTokens: cacheMetrics.cacheCreationInputTokens,
              cacheReadInputTokens: cacheMetrics.cacheReadInputTokens,
              costSaved
            });
          }
          break;
        }
      }
    } catch (error) {
      console.error('Anthropic streaming error:', error);
      
      // Log the error
      if (requestId) {
        await llmLogger.logResponse({
          requestId,
          service: 'anthropic',
          model: requestParams?.model || modelId,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime
        });
      }
      
      throw error;
    }
  }

  private formatMessagesForAnthropic(messages: Message[]): Array<{ role: 'user' | 'assistant'; content: any }> {
    const formattedMessages: Array<{ role: 'user' | 'assistant'; content: any }> = [];

    for (const message of messages) {
      const activeBranch = getActiveBranch(message);
      if (activeBranch && activeBranch.role !== 'system' && activeBranch.content.trim() !== '') {
        // Handle attachments for user messages
        if (activeBranch.role === 'user' && activeBranch.attachments && activeBranch.attachments.length > 0) {
          const contentParts: any[] = [{ type: 'text', text: activeBranch.content }];
          
          console.log(`Processing ${activeBranch.attachments.length} attachments for user message`);
          for (const attachment of activeBranch.attachments) {
            const isImage = this.isImageAttachment(attachment.fileName);
            
            if (isImage) {
              // Add image as a separate content block for Claude API
              const mediaType = this.getImageMediaType(attachment.fileName);
              contentParts.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: attachment.content
                }
              });
              console.log(`Added image attachment: ${attachment.fileName} (${mediaType})`);
            } else {
              // Append text attachments to the text content
              contentParts[0].text += `\n\n<attachment filename="${attachment.fileName}">\n${attachment.content}\n</attachment>`;
              console.log(`Added text attachment: ${attachment.fileName} (${attachment.content.length} chars)`);
            }
          }
          
          // Add cache control to the last content part if present
          if ((activeBranch as any)._cacheControl && contentParts.length > 0) {
            // Add cache control to the last content block
            contentParts[contentParts.length - 1].cache_control = (activeBranch as any)._cacheControl;
          }
          
          formattedMessages.push({
            role: 'user',
            content: contentParts
          });
        } else {
          // Simple text message
          if ((activeBranch as any)._cacheControl) {
            // Need to convert to content block format to add cache control
            formattedMessages.push({
              role: activeBranch.role as 'user' | 'assistant',
              content: [{
                type: 'text',
                text: activeBranch.content,
                cache_control: (activeBranch as any)._cacheControl
              }]
            });
          } else {
            // Regular string content
            formattedMessages.push({
              role: activeBranch.role as 'user' | 'assistant',
              content: activeBranch.content
            });
          }
        }
      }
    }

    return formattedMessages;
  }
  
  private isImageAttachment(fileName: string): boolean {
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    return imageExtensions.includes(extension);
  }
  
  private getImageMediaType(fileName: string): string {
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const mediaTypes: { [key: string]: string } = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp'
    };
    return mediaTypes[extension] || 'image/jpeg';
  }

  // Demo mode simulation
  private async simulateStreamingResponse(
    messages: Message[],
    onChunk: (chunk: string, isComplete: boolean) => Promise<void>
  ): Promise<void> {
    const lastMessage = messages[messages.length - 1];
    const lastBranch = getActiveBranch(lastMessage);
    const userMessage = lastBranch?.content || '';

    // Generate a contextual demo response
    const responses = [
      "I'm Claude 3 Opus, accessed through the Anthropic API! This is a demo response showing how the application handles both Anthropic API and AWS Bedrock models.",
      "This application allows you to use both current Claude models (via Anthropic API) and deprecated models (via AWS Bedrock) in the same interface.",
      "You can import conversations from claude.ai and continue them with the appropriate API - Anthropic for current models, Bedrock for deprecated ones.",
      "The conversation branching works seamlessly across both providers, preserving all your conversation history and context."
    ];

    let response = responses[Math.floor(Math.random() * responses.length)];
    
    // Add some context based on user message
    if (userMessage.toLowerCase().includes('hello') || userMessage.toLowerCase().includes('hi')) {
      response = "Hello! I'm Claude 3 Opus via Anthropic API. " + response;
    } else if (userMessage.toLowerCase().includes('test')) {
      response = "Testing Anthropic API integration! " + response;
    }

    // Simulate streaming by sending chunks
    const words = response.split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunk = (i === 0 ? '' : ' ') + words[i];
      await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 70)); // Faster than Bedrock simulation
      await onChunk(chunk, false);
    }
    
    await onChunk('', true); // Signal completion
  }

  // Method to validate API keys
  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const testClient = new Anthropic({ apiKey });
      
      // Make a minimal request to validate the key
      await testClient.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }]
      });
      
      return true;
    } catch (error) {
      console.error('Anthropic API key validation error:', error);
      return false;
    }
  }
  
  private calculateCacheSavings(modelId: string, cachedTokens: number): number {
    // Anthropic pricing per 1M tokens (as of late 2024)
    const pricingPer1M: Record<string, number> = {
      'claude-3-5-sonnet-20241022': 3.00,  // $3 per 1M input tokens
      'claude-3-5-haiku-20241022': 0.25,   // $0.25 per 1M input tokens
      'claude-3-opus-20240229': 15.00,     // $15 per 1M input tokens
      'claude-3-sonnet-20240229': 3.00,    // $3 per 1M input tokens
      'claude-3-haiku-20240307': 0.25      // $0.25 per 1M input tokens
    };
    
    const pricePerToken = (pricingPer1M[modelId] || 3.00) / 1_000_000;
    // Cached tokens are 90% cheaper
    const savings = cachedTokens * pricePerToken * 0.9;
    
    return savings;
  }
}
