import fs from 'fs/promises';
import path from 'path';

export class LLMLogger {
  private logDir: string;
  private currentDate: string;
  private dirCreated: boolean = false;

  constructor() {
    this.logDir = path.join(process.cwd(), 'logs', 'llm');
    this.currentDate = new Date().toISOString().split('T')[0];
  }

  private async ensureLogDirectory() {
    if (!this.dirCreated) {
      try {
        await fs.mkdir(this.logDir, { recursive: true });
        this.dirCreated = true;
      } catch (error) {
        console.error('Failed to create log directory:', error);
      }
    }
  }

  private getLogFilePath(type: 'requests' | 'responses'): string {
    return path.join(this.logDir, `${this.currentDate}-${type}.log`);
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  async logRequest(data: {
    requestId: string;
    service: 'anthropic' | 'bedrock';
    model: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    messageCount?: number;
    format?: string;
    requestBody?: any;
  }): Promise<void> {
    await this.ensureLogDirectory();
    
    const logEntry = {
      timestamp: this.formatTimestamp(),
      type: 'REQUEST',
      ...data
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    
    try {
      await fs.appendFile(this.getLogFilePath('requests'), logLine);
    } catch (error) {
      console.error('Failed to log request:', error);
    }
  }

  async logResponse(data: {
    requestId: string;
    service: 'anthropic' | 'bedrock';
    model: string;
    chunks?: string[];
    error?: string;
    duration?: number;
    tokenCount?: number;
  }): Promise<void> {
    await this.ensureLogDirectory();
    
    const logEntry = {
      timestamp: this.formatTimestamp(),
      type: 'RESPONSE',
      ...data
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    
    try {
      await fs.appendFile(this.getLogFilePath('responses'), logLine);
    } catch (error) {
      console.error('Failed to log response:', error);
    }
  }

  async logWebSocketEvent(data: {
    event: string;
    conversationId: string;
    messageId?: string;
    participantId?: string;
    responderId?: string;
    model?: string;
    settings?: any;
    format?: string;
  }): Promise<void> {
    await this.ensureLogDirectory();
    
    const logEntry = {
      timestamp: this.formatTimestamp(),
      type: 'WEBSOCKET_EVENT',
      ...data
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    
    try {
      await fs.appendFile(this.getLogFilePath('requests'), logLine);
    } catch (error) {
      console.error('Failed to log WebSocket event:', error);
    }
  }
  
  async logCustom(data: any): Promise<void> {
    await this.ensureLogDirectory();
    
    const logEntry = {
      timestamp: this.formatTimestamp(),
      ...data
    };
    
    const logLine = JSON.stringify(logEntry) + '\n';
    
    try {
      await fs.appendFile(this.getLogFilePath('requests'), logLine);
    } catch (error) {
      console.error('Failed to log custom entry:', error);
    }
  }
}

// Singleton instance
export const llmLogger = new LLMLogger();
