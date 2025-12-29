import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { Message, getActiveBranch, ModelSettings } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { llmLogger } from '../utils/llmLogger.js';
import sharp from 'sharp';

// Image size limit - Anthropic/Bedrock limit is 5MB, we target 4MB to have margin
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export class BedrockService {
  private client: BedrockRuntimeClient;
  private db: Database;

  constructor(db: Database, credentials?: import('@deprecated-claude/shared').BedrockCredentials) {
    this.db = db;
    
    // Initialize Bedrock client with user credentials or environment variables
    if (credentials) {
      this.client = new BedrockRuntimeClient({
        region: credentials.region || 'us-east-1',
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          ...(credentials.sessionToken && { sessionToken: credentials.sessionToken })
        }
      });
    } else {
      // Fall back to environment variables
      this.client = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || 'us-east-1',
        ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN })
          }
        })
      });
    }
  }

  async streamCompletion(
    modelId: string,
    messages: Message[],
    systemPrompt: string | undefined,
    settings: ModelSettings,
    onChunk: (chunk: string, isComplete: boolean) => Promise<void>,
    stopSequences?: string[]
  ): Promise<{ rawRequest?: any }> {
    // Demo mode - simulate streaming response
    if (process.env.DEMO_MODE === 'true') {
      await this.simulateStreamingResponse(messages, onChunk);
      return {};
    }

    let requestId: string | undefined;
    let startTime: number = Date.now();
    let bedrockModelId: string | undefined;

    try {
      // Convert messages to Claude format (async due to image resizing)
      const claudeMessages = await this.formatMessagesForClaude(messages);
      
      // Build the request body based on model version
      const requestBody = this.buildRequestBody(modelId, claudeMessages, systemPrompt, settings, stopSequences);
      bedrockModelId = modelId; // modelId is already the provider model ID from config
      
      // Store raw request for debugging
      const rawRequest = {
        model: bedrockModelId,
        ...requestBody
      };

      requestId = `bedrock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Log the request
      await llmLogger.logRequest({
        requestId,
        service: 'bedrock',
        model: bedrockModelId,
        systemPrompt: systemPrompt,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        topP: settings.topP,
        topK: settings.topK,
        stopSequences: stopSequences,
        messageCount: claudeMessages.length,
        requestBody: requestBody
      });

      startTime = Date.now();
      const chunks: string[] = [];

      const command = new InvokeModelWithResponseStreamCommand({
        modelId: bedrockModelId,
        body: JSON.stringify(requestBody),
        contentType: 'application/json',
        accept: 'application/json'
      });

      const response = await this.client.send(command);
      
      if (!response.body) {
        throw new Error('No response body from Bedrock');
      }

      let fullContent = '';

      for await (const chunk of response.body) {
        if (chunk.chunk?.bytes) {
          const chunkData = JSON.parse(new TextDecoder().decode(chunk.chunk.bytes));
          
          // Handle different response formats based on model
          const content = this.extractContentFromChunk(modelId, chunkData);
          
          if (content) {
            fullContent += content;
            chunks.push(content);
            await onChunk(content, false);
          }

          // Check if stream is complete
          if (this.isStreamComplete(modelId, chunkData)) {
            await onChunk('', true);
            
            // Log the response
            const duration = Date.now() - startTime;
            await llmLogger.logResponse({
              requestId,
              service: 'bedrock',
              model: bedrockModelId || modelId,
              chunks,
              duration
            });
            break;
          }
        }
      }
      
      return { rawRequest };
    } catch (error) {
      console.error('Bedrock streaming error:', error);
      
      // Log the error
      if (requestId) {
        await llmLogger.logResponse({
          requestId,
          service: 'bedrock',
          model: bedrockModelId || modelId,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime
        });
      }
      
      throw error;
    }
  }

  async formatMessagesForClaude(messages: Message[]): Promise<Array<{ role: string; content: string | any[] }>> {
    const formattedMessages: Array<{ role: string; content: string | any[] }> = [];

    for (const message of messages) {
      const activeBranch = getActiveBranch(message);
      if (activeBranch && activeBranch.role !== 'system') {
        let content: string | any[] = activeBranch.content;
        
        // Handle attachments for user messages - need to use content blocks for images
        if (activeBranch.role === 'user' && activeBranch.attachments && activeBranch.attachments.length > 0) {
          const contentParts: any[] = [{ type: 'text', text: activeBranch.content }];
          
          console.log(`[Bedrock] Processing ${activeBranch.attachments.length} attachments for user message`);
          for (const attachment of activeBranch.attachments) {
            const isImage = this.isImageAttachment(attachment.fileName);
            const isPdf = this.isPdfAttachment(attachment.fileName);
            const mediaType = this.getMediaType(attachment.fileName, (attachment as any).mimeType);
            
            if (isImage) {
              // Resize image if needed (Anthropic/Bedrock has 5MB limit)
              const resizedContent = await this.resizeImageIfNeeded(attachment.content, attachment.fileName);
              // After resize, always use JPEG media type since we convert during resize
              const resizedMediaType = resizedContent !== attachment.content ? 'image/jpeg' : mediaType;
              
              // Add image as a separate content block for Claude 3 API
              contentParts.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: resizedMediaType,
                  data: resizedContent
                }
              });
              console.log(`[Bedrock] Added image attachment: ${attachment.fileName} (${resizedMediaType})`);
            } else if (isPdf) {
              // Add PDF as a document content block for Claude API
              contentParts.push({
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: attachment.content
                }
              });
              console.log(`[Bedrock] Added PDF attachment: ${attachment.fileName}`);
            } else {
              // Append text attachments to the text content
              contentParts[0].text += `\n\n<attachment filename="${attachment.fileName}">\n${attachment.content}\n</attachment>`;
              console.log(`[Bedrock] Added text attachment: ${attachment.fileName} (${attachment.content.length} chars)`);
            }
          }
          
          content = contentParts;
        }
        
        // Claude expects 'user' and 'assistant' roles only
        formattedMessages.push({
          role: activeBranch.role,
          content
        });
      }
    }

    return formattedMessages;
  }

  private isImageAttachment(fileName: string): boolean {
    // Note: GIF excluded - Anthropic API has issues with some GIF formats
    const imageExtensions = ['jpg', 'jpeg', 'png', 'webp'];
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    return imageExtensions.includes(extension);
  }
  
  private isPdfAttachment(fileName: string): boolean {
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    return extension === 'pdf';
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
    };
    return mediaTypes[extension] || 'application/octet-stream';
  }
  
  /**
   * Resize an image if it exceeds the max size limit (4MB to stay under Anthropic/Bedrock's 5MB limit)
   * Returns the resized base64 string, or the original if already small enough
   */
  private async resizeImageIfNeeded(base64Data: string, fileName: string): Promise<string> {
    // Calculate size of base64 data (base64 is ~4/3 of binary size)
    const estimatedBytes = Math.ceil(base64Data.length * 0.75);
    
    if (estimatedBytes <= MAX_IMAGE_BYTES) {
      return base64Data; // Already small enough
    }
    
    console.log(`[Bedrock] Image ${fileName} is ${(estimatedBytes / 1024 / 1024).toFixed(2)}MB, resizing...`);
    
    try {
      // Decode base64 to buffer
      const inputBuffer = Buffer.from(base64Data, 'base64');
      
      // Get image metadata to calculate resize ratio
      const metadata = await sharp(inputBuffer).metadata();
      if (!metadata.width || !metadata.height) {
        console.warn(`[Bedrock] Could not get image dimensions for ${fileName}, using original`);
        return base64Data;
      }
      
      // Calculate how much we need to shrink (target 80% of max to have margin)
      const targetBytes = MAX_IMAGE_BYTES * 0.8;
      const shrinkRatio = Math.sqrt(targetBytes / estimatedBytes);
      const newWidth = Math.floor(metadata.width * shrinkRatio);
      const newHeight = Math.floor(metadata.height * shrinkRatio);
      
      console.log(`[Bedrock] Resizing from ${metadata.width}x${metadata.height} to ${newWidth}x${newHeight}`);
      
      // Resize and convert to JPEG for better compression
      const resizedBuffer = await sharp(inputBuffer)
        .resize(newWidth, newHeight, { fit: 'inside' })
        .jpeg({ quality: 85 })
        .toBuffer();
      
      const resizedBase64 = resizedBuffer.toString('base64');
      const newSize = Math.ceil(resizedBase64.length * 0.75);
      
      console.log(`[Bedrock] Resized ${fileName}: ${(estimatedBytes / 1024 / 1024).toFixed(2)}MB -> ${(newSize / 1024 / 1024).toFixed(2)}MB`);
      
      return resizedBase64;
    } catch (error) {
      console.error(`[Bedrock] Failed to resize image ${fileName}:`, error);
      return base64Data; // Return original on error
    }
  }

  private buildRequestBody(
    modelId: string,
    messages: Array<{ role: string; content: string | any[] }>,
    systemPrompt: string | undefined,
    settings: ModelSettings,
    stopSequences?: string[]
  ): any {
    // Claude 3 models use Messages API format with content blocks
    // Check if it's a Claude 3 model by looking for the pattern in the Bedrock model ID
    if (modelId.includes('claude-3')) {
      // Anthropic API doesn't allow both temperature AND top_p/top_k together
      const useTemperature = settings.temperature !== undefined;
      return {
        anthropic_version: 'bedrock-2023-05-31',
        messages,
        ...(systemPrompt && { system: systemPrompt }),
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        ...(!useTemperature && settings.topP !== undefined && { top_p: settings.topP }),
        ...(!useTemperature && settings.topK !== undefined && { top_k: settings.topK }),
        ...(stopSequences && stopSequences.length > 0 && { stop_sequences: stopSequences })
      };
    }
    
    // Claude 2 and Instant use older format - convert content blocks to text
    let prompt = '';
    
    if (systemPrompt) {
      prompt += `System: ${systemPrompt}\n\n`;
    }

    for (const msg of messages) {
      // Extract text content from content blocks or use string content directly
      let textContent: string;
      if (typeof msg.content === 'string') {
        textContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        // For Claude 2, we can only use text content - images are not supported
        textContent = msg.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');
        
        // Warn about unsupported content types
        const nonTextBlocks = msg.content.filter(block => block.type !== 'text');
        if (nonTextBlocks.length > 0) {
          console.warn(`[Bedrock] Claude 2/Instant does not support ${nonTextBlocks.length} non-text content blocks (images, PDFs). These will be ignored.`);
        }
      } else {
        textContent = String(msg.content);
      }
      
      if (msg.role === 'user') {
        prompt += `\n\nHuman: ${textContent}`;
      } else if (msg.role === 'assistant') {
        prompt += `\n\nAssistant: ${textContent}`;
      }
    }
    
    prompt += '\n\nAssistant:';

    // Anthropic API doesn't allow both temperature AND top_p/top_k together
    const useTemperature = settings.temperature !== undefined;
    return {
      prompt,
      max_tokens_to_sample: settings.maxTokens,
      temperature: settings.temperature,
      ...(!useTemperature && settings.topP !== undefined && { top_p: settings.topP }),
      ...(!useTemperature && settings.topK !== undefined && { top_k: settings.topK }),
      ...(stopSequences && stopSequences.length > 0 && { stop_sequences: stopSequences })
    };
  }



  private extractContentFromChunk(modelId: string, chunkData: any): string | null {
    // Claude 3 models - check if the Bedrock model ID contains 'claude-3'
    if (modelId.includes('claude-3')) {
      if (chunkData.type === 'content_block_delta' && chunkData.delta?.text) {
        return chunkData.delta.text;
      }
    } else {
      // Claude 2 and Instant
      if (chunkData.completion) {
        return chunkData.completion;
      }
    }
    
    return null;
  }

  private isStreamComplete(modelId: string, chunkData: any): boolean {
    // Claude 3 models - check if the Bedrock model ID contains 'claude-3'
    if (modelId.includes('claude-3')) {
      return chunkData.type === 'message_stop';
    } else {
      // Claude 2 and Instant
      return chunkData.stop_reason !== null;
    }
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
      "I understand you're testing the deprecated Claude models application! This is a demo response since AWS Bedrock access isn't configured.",
      "This application successfully preserves conversation branching and allows you to continue using deprecated Claude models.",
      "You can import conversations from claude.ai and maintain all the context and relationships you've built with AI assistants.",
      "The real power comes when you configure AWS Bedrock access to use actual deprecated Claude models like Claude 3 Opus, Sonnet, Claude 2.1, etc."
    ];

    let response = responses[Math.floor(Math.random() * responses.length)];
    
    // Add some context based on user message
    if (userMessage.toLowerCase().includes('hello') || userMessage.toLowerCase().includes('hi')) {
      response = "Hello! I'm a simulated response from the deprecated Claude models application. " + response;
    } else if (userMessage.toLowerCase().includes('test')) {
      response = "This is indeed a test response! " + response;
    }

    // Simulate streaming by sending chunks
    const words = response.split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunk = (i === 0 ? '' : ' ') + words[i];
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100)); // Random delay
      await onChunk(chunk, false);
    }
    
    await onChunk('', true); // Signal completion
  }

  // Method to validate API keys
  async validateApiKey(provider: string, apiKey: string): Promise<boolean> {
    try {
      if (provider === 'bedrock') {
        // For Bedrock, we could do a simple list models call to validate
        // For now, we'll assume valid if properly formatted
        return true;
      } else if (provider === 'anthropic') {
        // For direct Anthropic API, would need to make a test request
        // Not implemented in this version
        return false;
      }
      
      return false;
    } catch (error) {
      console.error('API key validation error:', error);
      return false;
    }
  }
}
