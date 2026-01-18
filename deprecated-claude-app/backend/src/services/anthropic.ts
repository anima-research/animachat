import Anthropic from '@anthropic-ai/sdk';
import { Message, getActiveBranch, ModelSettings } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { llmLogger } from '../utils/llmLogger.js';
import sharp from 'sharp';

// Anthropic's image size limit is 5MB, we target 4MB to have margin
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export class AnthropicService {
  private client: Anthropic;
  private db: Database;

  constructor(db: Database, apiKey?: string) {
    this.db = db;
    
    const resolvedKey = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!resolvedKey) {
      console.error('⚠️ API KEY ERROR: No Anthropic API key provided. Set ANTHROPIC_API_KEY environment variable or configure user API keys. API calls will fail.');
    }
    
    this.client = new Anthropic({
      apiKey: resolvedKey || 'missing-api-key'
    });
  }

  async streamCompletion(
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
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
    },
    rawRequest?: {
      model: string;
      system?: string;
      messages: any[];
      max_tokens: number;
      temperature?: number;
      top_p?: number;
      top_k?: number;
      stop_sequences?: string[];
    }
  }> {
    // Demo mode - simulate streaming response
    if (process.env.DEMO_MODE === 'true') {
      await this.simulateStreamingResponse(messages, onChunk);
      return {}; // No usage metrics in demo mode
    }

    let requestId: string | undefined;
    let startTime: number = Date.now();
    let requestParams: any;

    try {
      // Convert messages to Anthropic format
      const anthropicMessages = await this.formatMessagesForAnthropic(messages);
      
      // Debug logging
      console.log(`Total messages to Anthropic: ${anthropicMessages.length}`);
      console.log('[DEBUG] Message 0 role:', anthropicMessages[0]?.role, 'content type:', typeof anthropicMessages[0]?.content);
      if (anthropicMessages.length > 1) {
        console.log('[DEBUG] Message 1 role:', anthropicMessages[1]?.role, 'content type:', typeof anthropicMessages[1]?.content, 'is array:', Array.isArray(anthropicMessages[1]?.content));
        if (Array.isArray(anthropicMessages[1]?.content)) {
          console.log('[DEBUG] Message 1 has', anthropicMessages[1].content.length, 'content blocks');
          console.log('[DEBUG] First block:', JSON.stringify(anthropicMessages[1].content[0]).substring(0, 300));
        }
      }
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
          // System prompt should also be cached (1h TTL for OpenRouter compatibility)
          systemContent = [{
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' as const, ttl: '1h' as const }
          }];
        }
      }
      
      // Ensure max_tokens > budget_tokens when thinking is enabled
      let effectiveMaxTokens = settings.maxTokens;
      if (settings.thinking?.enabled && settings.thinking.budgetTokens) {
        // max_tokens must be greater than budget_tokens
        // Add reasonable room for the actual response (at least 4096 tokens)
        const minMaxTokens = settings.thinking.budgetTokens + 4096;
        if (effectiveMaxTokens < minMaxTokens) {
          console.log(`[Anthropic API] Adjusting max_tokens from ${effectiveMaxTokens} to ${minMaxTokens} (budget_tokens: ${settings.thinking.budgetTokens})`);
          effectiveMaxTokens = minMaxTokens;
        }
      }
      
      // Anthropic API doesn't allow both temperature AND top_p/top_k together
      // If temperature is set, don't send top_p/top_k
      const useTemperature = settings.temperature !== undefined;
      
      requestParams = {
        model: modelId,
        max_tokens: effectiveMaxTokens,
        temperature: settings.temperature,
        ...(!useTemperature && settings.topP !== undefined && { top_p: settings.topP }),
        ...(!useTemperature && settings.topK !== undefined && { top_k: settings.topK }),
        ...(systemContent && { system: systemContent }),
        ...(stopSequences && stopSequences.length > 0 && { stop_sequences: stopSequences }),
        ...(settings.thinking && settings.thinking.enabled && {
          thinking: {
            type: 'enabled',
            budget_tokens: settings.thinking.budgetTokens
          }
        }),
        messages: anthropicMessages,
        stream: true
      };
      
      // Debug log for thinking configuration
      console.log('[Anthropic API] Settings:', JSON.stringify({
        thinking: settings.thinking,
        thinkingEnabled: settings.thinking?.enabled,
        hasThinkingInRequest: !!requestParams.thinking
      }));
      
      // Log the EXACT request parameters being sent to Anthropic
      console.log('[Anthropic API] Request params:', JSON.stringify({
        model: requestParams.model,
        max_tokens: requestParams.max_tokens,
        thinking: requestParams.thinking,
        temperature: requestParams.temperature,
        top_p: requestParams.top_p,
        top_k: requestParams.top_k,
        messageCount: requestParams.messages.length
      }, null, 2));
      
    // Log the full prompt being sent to the model (only in debug mode)
    if (process.env.LOG_DEBUG === 'true') {
      console.log('\n========== FULL PROMPT TO ANTHROPIC ==========');
      if (systemContent) {
        console.log('SYSTEM:', systemContent);
      }
      for (const msg of anthropicMessages) {
        if (typeof msg.content === 'string') {
          console.log(`${msg.role.toUpperCase()}:`, msg.content);
        } else if (Array.isArray(msg.content)) {
          console.log(`${msg.role.toUpperCase()}: [multipart content with ${msg.content.length} parts]`);
          for (const part of msg.content) {
            if (part.type === 'text') {
              console.log(`  TEXT:`, part.text);
            } else if (part.type === 'image') {
              console.log(`  IMAGE: [base64 data]`);
            }
          }
        }
      }
      console.log('========== END PROMPT ==========\n');
    }
      
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
      const contentBlocks: any[] = []; // Store all content blocks
      let currentBlockIndex = -1;
      let currentBlock: any = null;
      
      const stream = await this.client.messages.create(requestParams) as any;

      let stopReason: string | undefined;
      let usage: any = {};
      let cacheMetrics = {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0
      };
      
      for await (const chunk of stream) {
        // Only log important events, not every chunk
        if (chunk.type === 'message_start') {
          console.log(`[Anthropic API] Stream started`);
        } else if (chunk.type === 'message_stop') {
          console.log(`[Anthropic API] Stream completed`);
        } else if (chunk.type === 'error') {
          console.log(`[Anthropic API] Stream error:`, chunk.error);
        }
        
        // Capture cache metrics from message_start
        if (chunk.type === 'message_start' && chunk.message?.usage) {
          const messageUsage = chunk.message.usage;
          cacheMetrics.cacheCreationInputTokens = messageUsage.cache_creation_input_tokens || 0;
          cacheMetrics.cacheReadInputTokens = messageUsage.cache_read_input_tokens || 0;
          console.log('[Anthropic API] Cache metrics:', cacheMetrics);
        }
        
        // Handle content block start
        if (chunk.type === 'content_block_start') {
          currentBlockIndex = chunk.index;
          currentBlock = { ...chunk.content_block };
          
          if (chunk.content_block.type === 'thinking') {
            currentBlock.thinking = '';
            console.log('[Anthropic API] Thinking block started');
          } else if (chunk.content_block.type === 'redacted_thinking') {
            currentBlock.data = '';
            console.log('[Anthropic API] Redacted thinking block started');
          } else if (chunk.content_block.type === 'text') {
            currentBlock.text = '';
          }
          
          contentBlocks[currentBlockIndex] = currentBlock;
        }
        
        // Handle content block deltas
        if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'thinking_delta') {
            // Thinking content
            if (currentBlock && currentBlock.type === 'thinking') {
              currentBlock.thinking += chunk.delta.thinking;
              contentBlocks[currentBlockIndex] = currentBlock;
              // Stream thinking content
              await onChunk('', false, contentBlocks);
            }
          } else if (chunk.delta.type === 'text_delta') {
            // Text content
            if (currentBlock && currentBlock.type === 'text') {
              currentBlock.text += chunk.delta.text;
              contentBlocks[currentBlockIndex] = currentBlock;
            }
            chunks.push(chunk.delta.text);
            await onChunk(chunk.delta.text, false, contentBlocks);
          } else if (chunk.delta.type === 'signature_delta') {
            // Signature for thinking block
            if (currentBlock && currentBlock.type === 'thinking') {
              currentBlock.signature = (currentBlock.signature || '') + chunk.delta.signature;
              contentBlocks[currentBlockIndex] = currentBlock;
            }
          }
        }
        
        // Handle content block stop
        if (chunk.type === 'content_block_stop') {
          if (currentBlock) {
            console.log(`[Anthropic API] Content block ${currentBlock.type} completed`);
            currentBlock = null;
          }
        }
        
        if (chunk.type === 'message_delta') {
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
          // Pass actual usage metrics to callback
          const actualUsage = {
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            cacheCreationInputTokens: cacheMetrics.cacheCreationInputTokens,
            cacheReadInputTokens: cacheMetrics.cacheReadInputTokens
          };
          
          // If no API thinking blocks but response contains <think> tags (prefill mode),
          // parse them into contentBlocks for proper UI display
          let finalContentBlocks = contentBlocks;
          if (contentBlocks.length === 0) {
            const fullResponse = chunks.join('');
            const parsedBlocks = this.parseThinkingTags(fullResponse);
            if (parsedBlocks.length > 0) {
              finalContentBlocks = parsedBlocks;
              console.log(`[Anthropic API] Parsed ${parsedBlocks.length} thinking blocks from prefill response`);
            }
          }
          
          await onChunk('', true, finalContentBlocks, actualUsage);
          
          // Log complete response summary
          const fullResponse = chunks.join('');
          console.log(`[Anthropic API] Response complete:`, {
            model: requestParams.model,
            totalLength: fullResponse.length,
            contentBlocks: contentBlocks.length,
            stopReason,
            usage,
            truncated: stopReason === 'max_tokens',
            lastChars: fullResponse.slice(-100)
          });
          
          // DIAGNOSTIC: Detect when thinking happened but no text content followed
          const hasThinkingBlocks = contentBlocks.some((b: any) => b.type === 'thinking' || b.type === 'redacted_thinking');
          if (hasThinkingBlocks && fullResponse.length === 0) {
            console.warn(`[Anthropic API] ⚠️ DIAGNOSTIC: Thinking blocks present but NO text content generated!`);
            console.warn(`[Anthropic API] ⚠️ Stop reason: ${stopReason}, Usage: input=${usage.input_tokens}, output=${usage.output_tokens}`);
            console.warn(`[Anthropic API] ⚠️ This may be a token budget issue - thinking may have consumed all output tokens.`);
          }
          
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
      
      // Return actual usage metrics from Anthropic and raw request
      return {
        usage: {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          cacheCreationInputTokens: cacheMetrics.cacheCreationInputTokens,
          cacheReadInputTokens: cacheMetrics.cacheReadInputTokens
        },
        rawRequest: {
          model: requestParams.model,
          system: requestParams.system,
          messages: anthropicMessages,
          max_tokens: requestParams.max_tokens,
          temperature: requestParams.temperature,
          top_p: requestParams.top_p,
          top_k: requestParams.top_k,
          stop_sequences: requestParams.stop_sequences
        }
      };
    } catch (error) {
      console.error('Anthropic streaming error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Log the error
      if (requestId) {
        await llmLogger.logResponse({
          requestId,
          service: 'anthropic',
          model: requestParams?.model || modelId,
          error: errorMessage,
          duration: Date.now() - startTime
        });
      }
      
      // Estimate input tokens from request for cost tracking on failures
      // Anthropic still charges for failed requests that were processed
      try {
        const requestStr = JSON.stringify(requestParams || {});
        const estimatedInputTokens = Math.ceil(requestStr.length / 4); // Rough estimate
        
        await onChunk('', true, undefined, {
          inputTokens: estimatedInputTokens,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          failed: true,
          error: errorMessage
        });
        
        console.log(`[Anthropic] Recorded failure metrics: ~${estimatedInputTokens} input tokens (estimated)`);
      } catch (metricsError) {
        console.error('[Anthropic] Failed to record failure metrics:', metricsError);
      }
      
      throw error;
    }
  }

  async formatMessagesForAnthropic(messages: Message[]): Promise<Array<{ role: 'user' | 'assistant'; content: any }>> {
    const formattedMessages: Array<{ role: 'user' | 'assistant'; content: any }> = [];

    for (const message of messages) {
      const activeBranch = getActiveBranch(message);
      if (activeBranch && activeBranch.role !== 'system' && activeBranch.content.trim() !== '') {
        let messageContent = activeBranch.content;
        
        // In prefill mode, thinking blocks should be wrapped in <thinking> tags and prepended
        if (activeBranch.contentBlocks && activeBranch.contentBlocks.length > 0) {
          // Check if we're in a prefill-style format (content contains participant names)
          const isPrefillFormat = messageContent.includes(':') && messageContent.match(/^[A-Z][a-zA-Z\s]*:/m);
          
          if (isPrefillFormat) {
            // Extract thinking blocks and wrap in XML tags
            let thinkingContent = '';
            for (const block of activeBranch.contentBlocks) {
              if (block.type === 'thinking') {
                thinkingContent += `<thinking>\n${block.thinking}\n</thinking>\n\n`;
              } else if (block.type === 'redacted_thinking') {
                thinkingContent += `<thinking>[Redacted for safety]</thinking>\n\n`;
              }
            }
            
            // Prepend thinking content to the message
            if (thinkingContent) {
              messageContent = thinkingContent + messageContent;
            }
          }
        }
        
        // Handle attachments for user messages
        if (activeBranch.role === 'user' && activeBranch.attachments && activeBranch.attachments.length > 0) {
          const contentParts: any[] = [{ type: 'text', text: messageContent }];
          
          console.log(`Processing ${activeBranch.attachments.length} attachments for user message`);
          for (const attachment of activeBranch.attachments) {
            const isImage = this.isImageAttachment(attachment.fileName);
            const isPdf = this.isPdfAttachment(attachment.fileName);
            const mediaType = this.getMediaType(attachment.fileName, (attachment as any).mimeType);
            
            if (isImage) {
              // Resize image if needed (Anthropic has 5MB limit)
              const resizedContent = await this.resizeImageIfNeeded(attachment.content, attachment.fileName);
              // After resize, always use JPEG media type since we convert during resize
              const resizedMediaType = resizedContent !== attachment.content ? 'image/jpeg' : mediaType;
              
              // Add image as a separate content block for Claude API
              contentParts.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: resizedMediaType,
                  data: resizedContent
                }
              });
              console.log(`Added image attachment: ${attachment.fileName} (${resizedMediaType})`);
            } else if (isPdf) {
              // Add PDF as a document content block for Claude API
              // Claude supports PDFs natively via the document type
              contentParts.push({
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: attachment.content
                }
              });
              console.log(`Added PDF attachment: ${attachment.fileName}`);
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
          // Check for cache breakpoint markers (Chapter II style)
          if ((activeBranch as any)._hasCacheBreakpoints && messageContent.includes('<|cache_breakpoint|>')) {
            // Split content at cache breakpoints and create separate text blocks
            const contentBlocks = this.splitAtCacheBreakpoints(messageContent);
            formattedMessages.push({
              role: activeBranch.role as 'user' | 'assistant',
              content: contentBlocks
            });
          } else if (activeBranch.role === 'assistant' && activeBranch.contentBlocks && activeBranch.contentBlocks.length > 0) {
            // Assistant message with thinking blocks - format as content array for API
            // This is required for models like Opus 4.5 to maintain chain of thought
            const apiContentBlocks: any[] = [];
            let unsignedThinkingText = ''; // Collect thinking without signatures to prepend as text
            
            for (const block of activeBranch.contentBlocks) {
              if (block.type === 'thinking') {
                // Only send thinking as structured block if it has a signature
                // Anthropic API requires signatures to verify thinking authenticity
                // Thinking without signatures (e.g., imported) is converted to text
                if (block.signature) {
                  apiContentBlocks.push({
                    type: 'thinking',
                    thinking: block.thinking,
                    signature: block.signature
                  });
                } else {
                  // Collect unsigned thinking to include as text
                  unsignedThinkingText += `<thinking>\n${block.thinking}\n</thinking>\n\n`;
                }
              } else if (block.type === 'redacted_thinking') {
                apiContentBlocks.push({
                  type: 'redacted_thinking',
                  data: block.data
                });
              } else if (block.type === 'text') {
                apiContentBlocks.push({
                  type: 'text',
                  text: block.text
                });
              }
            }
            
            // If we have unsigned thinking, prepend it to the text content
            if (unsignedThinkingText) {
              const existingTextIndex = apiContentBlocks.findIndex(b => b.type === 'text');
              if (existingTextIndex >= 0) {
                // Prepend to existing text block
                apiContentBlocks[existingTextIndex].text = unsignedThinkingText + apiContentBlocks[existingTextIndex].text;
              } else {
                // Create new text block with the thinking + main content
                apiContentBlocks.push({
                  type: 'text',
                  text: unsignedThinkingText + messageContent.trim()
                });
              }
            }
            
            // If no text block was in contentBlocks, add the main content
            const hasTextBlock = apiContentBlocks.some(b => b.type === 'text');
            if (!hasTextBlock && messageContent.trim()) {
              apiContentBlocks.push({
                type: 'text',
                text: messageContent
              });
            }
            
            // Add cache control to last block if present
            if ((activeBranch as any)._cacheControl && apiContentBlocks.length > 0) {
              apiContentBlocks[apiContentBlocks.length - 1].cache_control = (activeBranch as any)._cacheControl;
            }
            
            formattedMessages.push({
              role: 'assistant',
              content: apiContentBlocks
            });
          } else if ((activeBranch as any)._cacheControl) {
            // Need to convert to content block format to add cache control
            formattedMessages.push({
              role: activeBranch.role as 'user' | 'assistant',
              content: [{
                type: 'text',
                text: messageContent,
                cache_control: (activeBranch as any)._cacheControl
              }]
            });
          } else {
            // Regular string content
            formattedMessages.push({
              role: activeBranch.role as 'user' | 'assistant',
              content: messageContent
            });
          }
        }
      }
    }

    return formattedMessages;
  }
  
  /**
   * Split content at <|cache_breakpoint|> markers and convert to Anthropic text blocks
   * Each section BEFORE a marker gets cache_control, the last section does not
   * This implements Chapter II's caching approach
   */
  private splitAtCacheBreakpoints(content: string): Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral'; ttl: '1h' } }> {
    const CACHE_BREAKPOINT = '<|cache_breakpoint|>';
    const sections = content.split(CACHE_BREAKPOINT);
    
    console.log(`[Anthropic] 📦 Splitting prefill content at ${sections.length - 1} cache breakpoints`);
    
    const contentBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral'; ttl: '1h' } }> = [];
    
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i].trim();
      if (!section) continue; // Skip empty sections
      
      const isLastSection = i === sections.length - 1;
      
      if (isLastSection) {
        // Last section (after final marker) - NO cache control
        contentBlocks.push({
          type: 'text',
          text: section
        });
        console.log(`[Anthropic] 📦   Block ${i + 1}: ${section.length} chars (NOT cached - fresh content)`);
      } else {
        // All sections before the last get cache_control
        contentBlocks.push({
          type: 'text',
          text: section,
          cache_control: { type: 'ephemeral', ttl: '1h' }
        });
        console.log(`[Anthropic] 📦   Block ${i + 1}: ${section.length} chars (CACHED with 1h TTL)`);
      }
    }
    
    console.log(`[Anthropic] 📦 Created ${contentBlocks.length} content blocks for Anthropic API`);
    return contentBlocks;
  }
  
  private isImageAttachment(fileName: string): boolean {
    // Note: GIF excluded - Anthropic API has issues with some GIF formats
    const imageExtensions = ['jpg', 'jpeg', 'png', 'webp'];
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    return imageExtensions.includes(extension);
  }
  
  /**
   * Resize an image if it exceeds the max size limit (4MB to stay under Anthropic's 5MB limit)
   * Returns the resized base64 string, or the original if already small enough
   */
  private async resizeImageIfNeeded(base64Data: string, fileName: string): Promise<string> {
    // Calculate size of base64 data (base64 is ~4/3 of binary size)
    const estimatedBytes = Math.ceil(base64Data.length * 0.75);
    
    if (estimatedBytes <= MAX_IMAGE_BYTES) {
      return base64Data; // Already small enough
    }
    
    console.log(`[Anthropic] Image ${fileName} is ${(estimatedBytes / 1024 / 1024).toFixed(2)}MB, resizing...`);
    
    try {
      // Decode base64 to buffer
      const inputBuffer = Buffer.from(base64Data, 'base64');
      
      // Get image metadata to calculate resize ratio
      const metadata = await sharp(inputBuffer).metadata();
      if (!metadata.width || !metadata.height) {
        console.warn(`[Anthropic] Could not get image dimensions for ${fileName}, using original`);
        return base64Data;
      }
      
      // Calculate how much we need to shrink (target 80% of max to have margin)
      const targetBytes = MAX_IMAGE_BYTES * 0.8;
      const shrinkRatio = Math.sqrt(targetBytes / estimatedBytes);
      const newWidth = Math.floor(metadata.width * shrinkRatio);
      const newHeight = Math.floor(metadata.height * shrinkRatio);
      
      console.log(`[Anthropic] Resizing from ${metadata.width}x${metadata.height} to ${newWidth}x${newHeight}`);
      
      // Resize and convert to JPEG for better compression
      const resizedBuffer = await sharp(inputBuffer)
        .resize(newWidth, newHeight, { fit: 'inside' })
        .jpeg({ quality: 85 })
        .toBuffer();
      
      const resizedBase64 = resizedBuffer.toString('base64');
      const newSize = Math.ceil(resizedBase64.length * 0.75);
      
      console.log(`[Anthropic] Resized ${fileName}: ${(estimatedBytes / 1024 / 1024).toFixed(2)}MB -> ${(newSize / 1024 / 1024).toFixed(2)}MB`);
      
      return resizedBase64;
    } catch (error) {
      console.error(`[Anthropic] Failed to resize image ${fileName}:`, error);
      return base64Data; // Return original on error
    }
  }
  
  private isPdfAttachment(fileName: string): boolean {
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    return extension === 'pdf';
  }
  
  private isAudioAttachment(fileName: string): boolean {
    const audioExtensions = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'webm'];
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    return audioExtensions.includes(extension);
  }
  
  private isVideoAttachment(fileName: string): boolean {
    const videoExtensions = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    return videoExtensions.includes(extension);
  }
  
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
      // Video
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'webm': 'video/webm',
    };
    return mediaTypes[extension] || 'application/octet-stream';
  }
  
  private getImageMediaType(fileName: string): string {
    return this.getMediaType(fileName);
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
    // NOTE: For console logging only. UI uses enhanced-inference.ts pricing (source of truth)
    // Anthropic pricing per 1M input tokens (updated 2025-11-24)
    const pricingPer1M: Record<string, number> = {
      // Claude 4.x models
      'claude-opus-4-5-20251101': 5.00,    // New! 3x cheaper
      'claude-opus-4-1-20250805': 15.00,
      'claude-opus-4-20250514': 15.00,
      'claude-sonnet-4-5-20250929': 3.00,
      'claude-sonnet-4-20250514': 3.00,
      'claude-haiku-4-5-20251001': 0.80,
      
      // Claude 3.x models
      'claude-3-7-sonnet-20250219': 3.00,
      'claude-3-5-sonnet-20241022': 3.00,
      'claude-3-5-sonnet-20240620': 3.00,
      'claude-3-5-haiku-20241022': 0.80,
      'claude-3-opus-20240229': 15.00,
      'claude-3-sonnet-20240229': 3.00,
      'claude-3-haiku-20240307': 0.25,
      
      // Bedrock IDs (if needed)
      'anthropic.claude-3-5-sonnet-20241022-v2:0': 3.00,
      'anthropic.claude-3-5-haiku-20241022-v1:0': 0.80,
      'anthropic.claude-3-opus-20240229-v1:0': 15.00,
      'anthropic.claude-3-sonnet-20240229-v1:0': 3.00,
      'anthropic.claude-3-haiku-20240307-v1:0': 0.25
    };
    
    const pricePerToken = (pricingPer1M[modelId] || 3.00) / 1_000_000;
    // Cached tokens are 90% cheaper
    const savings = cachedTokens * pricePerToken * 0.9;
    
    return savings;
  }
  
  /**
   * Parse <think>...</think> tags from content and create contentBlocks
   * Used for prefill mode thinking where API thinking is not available
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
}
