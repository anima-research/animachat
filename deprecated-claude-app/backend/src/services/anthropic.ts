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
      
      requestParams = {
        model: modelId,
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        ...(settings.topP !== undefined && { top_p: settings.topP }),
        ...(settings.topK !== undefined && { top_k: settings.topK }),
        ...(systemPrompt && { system: systemPrompt }),
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

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          chunks.push(chunk.delta.text);
          await onChunk(chunk.delta.text, false);
        } else if (chunk.type === 'message_stop') {
          await onChunk('', true);
          
          // Log the response
          const duration = Date.now() - startTime;
          await llmLogger.logResponse({
            requestId,
            service: 'anthropic',
            model: requestParams.model,
            chunks,
            duration
          });
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
      if (activeBranch && activeBranch.role !== 'system') {
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
          
          formattedMessages.push({
            role: 'user',
            content: contentParts
          });
        } else {
          // Simple text message
          formattedMessages.push({
            role: activeBranch.role as 'user' | 'assistant',
            content: activeBranch.content
          });
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
}
