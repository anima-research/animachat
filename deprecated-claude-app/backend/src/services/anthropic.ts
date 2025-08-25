import Anthropic from '@anthropic-ai/sdk';
import { Message, getActiveBranch } from '@deprecated-claude/shared';
import { Database } from '../database/index.js';

interface ModelSettings {
  temperature: number;
  maxTokens: number;
  topP?: number;
  topK?: number;
}

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
    onChunk: (chunk: string, isComplete: boolean) => Promise<void>
  ): Promise<void> {
    // Demo mode - simulate streaming response
    if (process.env.DEMO_MODE === 'true') {
      await this.simulateStreamingResponse(messages, onChunk);
      return;
    }

    try {
      // Convert messages to Anthropic format
      const anthropicMessages = this.formatMessagesForAnthropic(messages);
      
      const stream = await this.client.messages.create({
        model: this.getAnthropicModelId(modelId),
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        ...(settings.topP !== undefined && { top_p: settings.topP }),
        ...(settings.topK !== undefined && { top_k: settings.topK }),
        ...(systemPrompt && { system: systemPrompt }),
        messages: anthropicMessages,
        stream: true
      });

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          await onChunk(chunk.delta.text, false);
        } else if (chunk.type === 'message_stop') {
          await onChunk('', true);
          break;
        }
      }
    } catch (error) {
      console.error('Anthropic streaming error:', error);
      throw error;
    }
  }

  private formatMessagesForAnthropic(messages: Message[]): Array<{ role: 'user' | 'assistant'; content: string }> {
    const formattedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const message of messages) {
      const activeBranch = getActiveBranch(message);
      if (activeBranch && activeBranch.role !== 'system') {
        // Anthropic expects 'user' and 'assistant' roles only
        formattedMessages.push({
          role: activeBranch.role as 'user' | 'assistant',
          content: activeBranch.content
        });
      }
    }

    return formattedMessages;
  }

  private getAnthropicModelId(modelId: string): string {
    // Map our model IDs to Anthropic model IDs
    const modelMap: Record<string, string> = {
      'claude-3-opus-20240229': 'claude-3-opus-20240229',
      'claude-3-5-sonnet-20240620': 'claude-3-5-sonnet-20240620',
      'claude-3-sonnet-20240229': 'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307': 'claude-3-haiku-20240307'
    };

    return modelMap[modelId] || modelId;
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
