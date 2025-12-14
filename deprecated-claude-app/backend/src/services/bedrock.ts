import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { Message, getActiveBranch, ModelSettings } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';
import { llmLogger } from '../utils/llmLogger.js';

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
      // Convert messages to Claude format
      const claudeMessages = this.formatMessagesForClaude(messages);
      
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

  formatMessagesForClaude(messages: Message[]): Array<{ role: string; content: string }> {
    const formattedMessages: Array<{ role: string; content: string }> = [];

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
        
        // Claude expects 'user' and 'assistant' roles only
        formattedMessages.push({
          role: activeBranch.role,
          content
        });
      }
    }

    return formattedMessages;
  }

  private buildRequestBody(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    systemPrompt: string | undefined,
    settings: ModelSettings,
    stopSequences?: string[]
  ): any {
    // Claude 3 models use Messages API format
    // Check if it's a Claude 3 model by looking for the pattern in the Bedrock model ID
    if (modelId.includes('claude-3')) {
      return {
        anthropic_version: 'bedrock-2023-05-31',
        messages,
        ...(systemPrompt && { system: systemPrompt }),
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        ...(settings.topP !== undefined && { top_p: settings.topP }),
        ...(settings.topK !== undefined && { top_k: settings.topK }),
        ...(stopSequences && stopSequences.length > 0 && { stop_sequences: stopSequences })
      };
    }
    
    // Claude 2 and Instant use older format
    let prompt = '';
    
    if (systemPrompt) {
      prompt += `System: ${systemPrompt}\n\n`;
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        prompt += `\n\nHuman: ${msg.content}`;
      } else if (msg.role === 'assistant') {
        prompt += `\n\nAssistant: ${msg.content}`;
      }
    }
    
    prompt += '\n\nAssistant:';

    return {
      prompt,
      max_tokens_to_sample: settings.maxTokens,
      temperature: settings.temperature,
      ...(settings.topP !== undefined && { top_p: settings.topP }),
      ...(settings.topK !== undefined && { top_k: settings.topK }),
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
