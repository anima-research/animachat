import { Message, getActiveBranch, ModelSettings, ContentBlock } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { getBlobStore } from '../database/blob-store.js';

/**
 * Gemini API Service
 * Supports Google's Generative AI API for text and image generation
 * 
 * Models:
 * - gemini-2.5-flash: Fast multimodal model
 * - gemini-2.5-flash-image: Fast image generation
 * - gemini-3-pro-preview: Advanced model with thinking
 * - gemini-3-pro-image-preview: Advanced image generation with 4K output
 */

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string; // base64
  };
  thought_signature?: string; // Required for Gemini 3 Pro multi-turn
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string;
        };
        thought_signature?: string;
        thought?: boolean; // Gemini thinking API - true if this is thinking content
      }>;
      role: string;
    };
    finishReason?: string;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string;
        };
        thought_signature?: string;
        thought?: boolean; // Gemini thinking API - true if this is thinking content
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GeminiService {
  private apiKey: string;
  private baseUrl: string;
  private db: Database;

  constructor(db: Database, apiKey?: string) {
    this.db = db;
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    
    if (!this.apiKey) {
      console.error('⚠️ API KEY ERROR: No Gemini API key provided. Set GEMINI_API_KEY environment variable or configure user API keys. Gemini API calls will fail.');
    }
  }

  async streamCompletion(
    modelId: string,
    messages: Message[],
    systemPrompt: string | undefined,
    settings: ModelSettings,
    onChunk: (chunk: string, isComplete: boolean, contentBlocks?: ContentBlock[], usage?: any) => Promise<void>,
    stopSequences?: string[]
  ): Promise<{
    usage?: {
      inputTokens: number;
      outputTokens: number;
    };
    rawRequest?: any;
  }> {
    let requestId: string | undefined;
    const startTime = Date.now();
    let requestBody: any = null;  // Track for error metrics

    try {
      // Convert messages to Gemini format
      const geminiContents = await this.formatMessagesForGemini(messages);
      
      // Build generation config
      const generationConfig: any = {
        temperature: settings.temperature,
        maxOutputTokens: settings.maxTokens,
      };
      
      // Add top_p and top_k if specified
      if (settings.topP !== undefined) {
        generationConfig.topP = settings.topP;
      }
      if (settings.topK !== undefined) {
        generationConfig.topK = settings.topK;
      }
      
      // Add stop sequences if provided (Gemini allows max 5)
      if (stopSequences && stopSequences.length > 0) {
        generationConfig.stopSequences = stopSequences.slice(0, 5);
      }
      
      // Handle model-specific settings
      const modelSpecific = settings.modelSpecific || {};
      
      // Response modalities (for image generation models)
      if (modelSpecific['responseModalities']) {
        generationConfig.responseModalities = modelSpecific['responseModalities'];
      }
      
      // Image config (for image generation) - only include if IMAGE is in responseModalities
      const responseModalities = modelSpecific['responseModalities'] as string[] | undefined;
      const includesImage = responseModalities?.includes('IMAGE');
      
      if (includesImage && (modelSpecific['imageConfig.aspectRatio'] || modelSpecific['imageConfig.imageSize'])) {
        generationConfig.imageConfig = {};
        if (modelSpecific['imageConfig.aspectRatio']) {
          generationConfig.imageConfig.aspectRatio = modelSpecific['imageConfig.aspectRatio'];
        }
        if (modelSpecific['imageConfig.imageSize']) {
          generationConfig.imageConfig.imageSize = modelSpecific['imageConfig.imageSize'];
        }
      }
      
      // Build request body
      requestBody = {
        contents: geminiContents,
        generationConfig,
      };
      
      // Add system instruction if provided
      if (systemPrompt) {
        requestBody.systemInstruction = {
          parts: [{ text: systemPrompt }]
        };
      }
      
      // Add tools if Google Search is enabled
      if (modelSpecific['tools.googleSearch']) {
        requestBody.tools = [{ googleSearch: {} }];
      }
      
      // Add thinking config if thinking is enabled
      // NOTE: The model's supportsThinking flag is already checked in inference.ts
      // If settings.thinking.enabled reaches here, the model was validated to support thinking
      if (settings.thinking?.enabled) {
        generationConfig.thinkingConfig = {
          includeThoughts: true,
        };
        // Add thinking budget if specified
        if (settings.thinking.budgetTokens) {
          generationConfig.thinkingConfig.thinkingBudget = settings.thinking.budgetTokens;
        }
        console.log(`[Gemini API] 🧠 Thinking enabled with budget: ${settings.thinking.budgetTokens || 'auto'}`);
      }
      
      requestId = `gemini-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`[Gemini API] Request ${requestId}: Streaming to ${modelId}, ${messages.length} messages`);
      console.log(`[Gemini API] Generation config:`, JSON.stringify(generationConfig, null, 2));
      
      // Make streaming request
      const url = `${this.baseUrl}/models/${modelId}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Gemini API] Error ${response.status}:`, errorText);
        throw new Error(`Gemini API error: ${response.status} ${errorText}`);
      }
      
      if (!response.body) {
        throw new Error('No response body from Gemini API');
      }
      
      // Process SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      const contentBlocks: ContentBlock[] = [];
      let hasImageOutput = false;
      let usage: any = undefined;
      
      let chunkCount = 0;
      let lastThoughtSignature: string | undefined;
      let thinkingContent = ''; // Accumulated thinking/reasoning content
      let hasThinkingStarted = false;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`[Gemini API] Stream ended after ${chunkCount} chunks`);
          break;
        }
        
        const decoded = decoder.decode(value, { stream: true });
        buffer += decoded;
        chunkCount++;
        
        // Log first few chunks to debug
        if (chunkCount <= 3) {
          console.log(`[Gemini API] Raw chunk ${chunkCount} (${decoded.length} bytes):`, decoded.substring(0, 200));
        }
        
        // Process complete SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            if (jsonStr.trim() === '[DONE]') continue;
            
            try {
              const chunk: GeminiStreamChunk = JSON.parse(jsonStr);
              
              // Extract content from chunk
              if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
                for (const part of chunk.candidates[0].content.parts) {
                  // Check if this is thinking content (Gemini thinking API)
                  if (part.thought && part.text) {
                    // This is thinking/reasoning content
                    if (!hasThinkingStarted) {
                      hasThinkingStarted = true;
                      // Insert thinking block at the beginning
                      contentBlocks.unshift({ type: 'thinking', thinking: '' } as any);
                      console.log('[Gemini API] 🧠 Thinking block started');
                    }
                    thinkingContent += part.text;
                    // Update the thinking block (always at index 0)
                    (contentBlocks[0] as any).thinking = thinkingContent;
                    // Stream thinking update
                    await onChunk('', false, contentBlocks);
                  } else if (part.text) {
                    // Regular text content
                    fullContent += part.text;
                    await onChunk(part.text, false, contentBlocks.length > 0 ? contentBlocks : undefined);
                  }
                  
                  // Capture thought_signature from Gemini 3 Pro
                  if (part.thought_signature) {
                    lastThoughtSignature = part.thought_signature;
                    console.log(`[Gemini API] Captured thought_signature: ${part.thought_signature.substring(0, 50)}...`);
                  }
                  
                  if (part.inlineData) {
                    // Image generated by the model
                    // Gemini may send multiple versions - replace existing image with newer version
                    hasImageOutput = true;
                    
                    // Save image to BlobStore instead of embedding base64
                    const blobStore = getBlobStore();
                    const blobId = await blobStore.saveBlob(part.inlineData.data, part.inlineData.mimeType);
                    
                    const imageBlock = {
                      type: 'image',
                      mimeType: part.inlineData.mimeType,
                      blobId, // Reference to blob instead of inline data
                    } as ContentBlock;
                    
                    // Find existing image block index - Gemini may send preview then final image
                    const existingImageIndex = contentBlocks.findIndex((b: any) => b.type === 'image');
                    if (existingImageIndex >= 0) {
                      // Delete the old blob to prevent orphans
                      const oldBlock = contentBlocks[existingImageIndex] as any;
                      if (oldBlock.blobId && oldBlock.blobId !== blobId) {
                        await blobStore.deleteBlob(oldBlock.blobId);
                        console.log(`[Gemini API] Deleted old preview blob ${oldBlock.blobId.substring(0, 8)}...`);
                      }
                      // Replace preview with final high-res version
                      console.log(`[Gemini API] Replacing image with newer version: ${part.inlineData.mimeType}, blobId: ${blobId.substring(0, 8)}...`);
                      contentBlocks[existingImageIndex] = imageBlock;
                    } else {
                      console.log(`[Gemini API] Saved generated image to blob: ${blobId.substring(0, 8)}... (${part.inlineData.mimeType})`);
                      contentBlocks.push(imageBlock);
                    }
                    
                    // Send update with new content block
                    await onChunk('', false, contentBlocks);
                  }
                }
              }
              
              // Check for finish
              if (chunk.candidates?.[0]?.finishReason) {
                console.log(`[Gemini API] Finish reason: ${chunk.candidates[0].finishReason}`);
                // Log full content length at finish
                console.log(`[Gemini API] Total content at finish: ${fullContent.length} chars`);
              }
              
              // Log any safety blocks
              if ((chunk.candidates?.[0] as any)?.safetyRatings) {
                const blocked = (chunk.candidates![0] as any).safetyRatings.filter((r: any) => r.blocked);
                if (blocked.length > 0) {
                  console.log(`[Gemini API] Safety blocked:`, blocked);
                }
              }
              
              // Extract usage (with defensive defaults to prevent NaN)
              if (chunk.usageMetadata) {
                usage = {
                  inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
                  outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
                };
              }
            } catch (parseError) {
              console.error('[Gemini API] Failed to parse chunk:', parseError);
            }
          }
        }
      }
      
      // Log thinking completion
      if (hasThinkingStarted) {
        console.log(`[Gemini API] 🧠 Thinking complete: ${thinkingContent.length} chars`);
      }
      
      // DIAGNOSTIC: Detect when thinking happened but no text content followed
      if (hasThinkingStarted && fullContent.length === 0) {
        console.warn(`[Gemini API] ⚠️ DIAGNOSTIC: Thinking content received (${thinkingContent.length} chars) but NO text content generated!`);
        console.warn(`[Gemini API] ⚠️ This may be a token budget issue or API limitation. Stream ended after ${chunkCount} chunks.`);
      }
      
      // Add text content block if we have text (with thought_signature if present)
      if (fullContent) {
        const textBlock: any = {
          type: 'text',
          text: fullContent,
        };
        if (lastThoughtSignature) {
          textBlock.thoughtSignature = lastThoughtSignature;
          console.log(`[Gemini API] Storing thought_signature in text content block`);
        }
        // If we have thinking, text goes after thinking (thinking is at index 0)
        if (hasThinkingStarted) {
          // Insert after thinking block
          contentBlocks.splice(1, 0, textBlock as ContentBlock);
        } else if (hasImageOutput) {
          // Insert text block at the beginning if we also have images (but no thinking)
          contentBlocks.unshift(textBlock as ContentBlock);
        } else {
          // Add text block for storing thought_signature even without images
          contentBlocks.push(textBlock as ContentBlock);
        }
      } else if (lastThoughtSignature && contentBlocks.length > 0) {
        // If no text but we have a signature, add it to the first non-thinking content block
        for (const block of contentBlocks) {
          const b = block as any;
          if (b.type === 'text') {
            b.thoughtSignature = lastThoughtSignature;
            break;
          }
        }
      }
      
      // Send completion
      await onChunk('', true, contentBlocks.length > 0 ? contentBlocks : undefined, usage);
      
      const duration = Date.now() - startTime;
      console.log(`[Gemini API] Request ${requestId} completed in ${duration}ms, tokens: ${usage?.inputTokens || 0} in / ${usage?.outputTokens || 0} out`);
      
      return { usage, rawRequest: requestBody };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - startTime;
      console.error(`[Gemini API] Request ${requestId} failed after ${duration}ms:`, errorMessage);
      
      // Estimate input tokens from request for cost tracking on failures
      // Google still charges for failed requests that were processed
      try {
        const requestStr = JSON.stringify(requestBody || {});
        const estimatedInputTokens = Math.ceil(requestStr.length / 4); // Rough estimate
        
        await onChunk('', true, undefined, {
          inputTokens: estimatedInputTokens,
          outputTokens: 0,
          failed: true,
          error: errorMessage
        });
        
        console.log(`[Gemini API] Recorded failure metrics: ~${estimatedInputTokens} input tokens (estimated)`);
      } catch (metricsError) {
        console.error('[Gemini API] Failed to record failure metrics:', metricsError);
      }
      
      throw error;
    }
  }

  /**
   * Non-streaming completion (useful for image generation)
   */
  async generateContent(
    modelId: string,
    messages: Message[],
    systemPrompt: string | undefined,
    settings: ModelSettings
  ): Promise<{
    content: string;
    contentBlocks: ContentBlock[];
    usage?: {
      inputTokens: number;
      outputTokens: number;
    };
  }> {
    const geminiContents = await this.formatMessagesForGemini(messages);
    
    const generationConfig: any = {
      temperature: settings.temperature,
      maxOutputTokens: settings.maxTokens,
    };
    
    const modelSpecific = settings.modelSpecific || {};
    
    if (modelSpecific['responseModalities']) {
      generationConfig.responseModalities = modelSpecific['responseModalities'];
    }
    
    // Image config - only include if IMAGE is in responseModalities
    const responseModalities = modelSpecific['responseModalities'] as string[] | undefined;
    const includesImage = responseModalities?.includes('IMAGE');
    
    if (includesImage && (modelSpecific['imageConfig.aspectRatio'] || modelSpecific['imageConfig.imageSize'])) {
      generationConfig.imageConfig = {};
      if (modelSpecific['imageConfig.aspectRatio']) {
        generationConfig.imageConfig.aspectRatio = modelSpecific['imageConfig.aspectRatio'];
      }
      if (modelSpecific['imageConfig.imageSize']) {
        generationConfig.imageConfig.imageSize = modelSpecific['imageConfig.imageSize'];
      }
    }
    
    const requestBody: any = {
      contents: geminiContents,
      generationConfig,
    };
    
    if (systemPrompt) {
      requestBody.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }
    
    if (modelSpecific['tools.googleSearch']) {
      requestBody.tools = [{ googleSearch: {} }];
    }
    
    // Add thinking config if thinking is enabled
    // NOTE: The model's supportsThinking flag is already checked in inference.ts
    if (settings.thinking?.enabled) {
      generationConfig.thinkingConfig = {
        includeThoughts: true,
      };
      if (settings.thinking.budgetTokens) {
        generationConfig.thinkingConfig.thinkingBudget = settings.thinking.budgetTokens;
      }
    }
    
    const url = `${this.baseUrl}/models/${modelId}:generateContent?key=${this.apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }
    
    const data = await response.json() as GeminiResponse;
    
    let content = '';
    let thinkingContent = '';
    const contentBlocks: ContentBlock[] = [];
    
    if (data.candidates && data.candidates[0]?.content?.parts) {
      for (const part of data.candidates[0].content.parts) {
        if (part.thought && part.text) {
          // This is thinking content
          thinkingContent += part.text;
        } else if (part.text) {
          // Regular text content
          content += part.text;
        }
        if (part.inlineData) {
          // Save image to BlobStore (non-streaming path)
          const blobStore = getBlobStore();
          const blobId = await blobStore.saveBlob(part.inlineData.data, part.inlineData.mimeType);
          console.log(`[Gemini API] Non-streaming: saved image to blob ${blobId.substring(0, 8)}...`);
          contentBlocks.push({
            type: 'image',
            mimeType: part.inlineData.mimeType,
            blobId,
          } as ContentBlock);
        }
      }
    }
    
    // Add thinking block first if we have thinking content
    if (thinkingContent) {
      contentBlocks.unshift({
        type: 'thinking',
        thinking: thinkingContent,
      } as any);
      console.log(`[Gemini API] 🧠 Non-streaming thinking: ${thinkingContent.length} chars`);
    }
    
    // Add text block if we have text (after thinking if present)
    if (content) {
      if (thinkingContent) {
        // Insert after thinking block
        contentBlocks.splice(1, 0, {
          type: 'text',
          text: content,
        } as ContentBlock);
      } else {
        contentBlocks.unshift({
          type: 'text',
          text: content,
        } as ContentBlock);
      }
    }
    
    return {
      content,
      contentBlocks,
      usage: data.usageMetadata ? {
        inputTokens: data.usageMetadata.promptTokenCount,
        outputTokens: data.usageMetadata.candidatesTokenCount,
      } : undefined,
    };
  }

  /**
   * Convert internal message format to Gemini API format
   * Async because it may need to load images from BlobStore
   */
  private async formatMessagesForGemini(messages: Message[]): Promise<GeminiContent[]> {
    const geminiContents: GeminiContent[] = [];
    
    for (const message of messages) {
      const activeBranch = getActiveBranch(message);
      if (!activeBranch) continue;
      
      // Skip system messages - handled separately
      if (activeBranch.role === 'system') continue;
      
      const parts: GeminiPart[] = [];
      
      // Check for thought_signature in content blocks (for model responses)
      let thoughtSignature: string | undefined;
      if (activeBranch.contentBlocks && activeBranch.contentBlocks.length > 0) {
        for (const block of activeBranch.contentBlocks) {
          if (block.type === 'text' && 'thoughtSignature' in block && (block as any).thoughtSignature) {
            thoughtSignature = (block as any).thoughtSignature;
            console.log(`[Gemini] Found thought_signature in history for ${activeBranch.role} message`);
          }
        }
      }
      
      // Add text content with thought_signature if present
      if (activeBranch.content) {
        const textPart: GeminiPart = { text: activeBranch.content };
        if (thoughtSignature) {
          textPart.thought_signature = thoughtSignature;
        }
        parts.push(textPart);
      }
      
      // Handle attachments
      if (activeBranch.attachments && activeBranch.attachments.length > 0) {
        for (const attachment of activeBranch.attachments) {
          const mimeType = this.getMimeType(attachment.fileName, (attachment as any).mimeType);
          
          // Gemini supports images, PDFs, audio, and video as inline data
          if (this.isSupportedMediaType(mimeType)) {
            parts.push({
              inlineData: {
                mimeType,
                data: attachment.content, // Already base64
              }
            });
          } else {
            // For unsupported types, append as text
            parts[0] = {
              text: (parts[0]?.text || '') + `\n\n<attachment filename="${attachment.fileName}">\n${attachment.content}\n</attachment>`,
              thought_signature: parts[0]?.thought_signature // Preserve thought_signature
            };
          }
        }
      }
      
      // Handle existing content blocks (e.g., generated images in history)
      if (activeBranch.contentBlocks && activeBranch.contentBlocks.length > 0) {
        for (const block of activeBranch.contentBlocks) {
          if (block.type === 'image') {
            const imageBlock = block as any;
            let imageData: string | null = null;
            let mimeType = imageBlock.mimeType || 'image/png';
            
            if (imageBlock.blobId) {
              // NEW FORMAT: Load from BlobStore
              const blobStore = getBlobStore();
              const blob = await blobStore.loadBlob(imageBlock.blobId);
              if (blob) {
                imageData = blob.data.toString('base64');
                mimeType = blob.metadata.mimeType;
                console.log(`[Gemini] Loaded image from blob ${imageBlock.blobId.substring(0, 8)}... for history`);
              } else {
                console.warn(`[Gemini] Could not load blob ${imageBlock.blobId} for history`);
              }
            } else if (imageBlock.data) {
              // OLD FORMAT: Inline base64 data
              imageData = imageBlock.data;
              console.log(`[Gemini] Including inline image from history: ${mimeType}, data length: ${imageBlock.data.length}`);
            }
            
            if (imageData) {
              parts.push({
                inlineData: {
                  mimeType,
                  data: imageData,
                }
              });
            }
          }
        }
      }
      
      if (parts.length > 0) {
        geminiContents.push({
          role: activeBranch.role === 'assistant' ? 'model' : 'user',
          parts,
        });
      }
    }
    
    return geminiContents;
  }

  private getMimeType(fileName: string, providedMimeType?: string): string {
    if (providedMimeType) return providedMimeType;
    
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
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
      'avi': 'video/x-msvideo',
    };
    
    return mimeTypes[extension] || 'application/octet-stream';
  }

  private isSupportedMediaType(mimeType: string): boolean {
    // Gemini supports these MIME types natively
    const supportedPrefixes = ['image/', 'audio/', 'video/', 'application/pdf'];
    return supportedPrefixes.some(prefix => mimeType.startsWith(prefix));
  }
}

