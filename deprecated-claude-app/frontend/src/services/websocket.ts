import type { WsMessage } from '@deprecated-claude/shared';

type EventHandler = (data: any) => void;

export interface RoomUser {
  userId: string;
  joinedAt: Date;
}

export interface ActiveAiRequest {
  userId: string;
  messageId: string;
  startedAt: Date;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private token: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: number | null = null;
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private messageQueue: WsMessage[] = [];
  private currentRoomId: string | null = null;
  
  constructor(token: string) {
    this.token = token;
  }
  
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    
    const wsUrl = new URL('/ws', window.location.href);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl.searchParams.set('token', this.token);
    
    // For development, connect to backend port
    if (import.meta.env.DEV) {
      // Use HTTPS port if the page is served over HTTPS
      wsUrl.port = wsUrl.protocol === 'wss:' ? '3443' : '3010';
      wsUrl.pathname = '/';
    }
    
    this.ws = new WebSocket(wsUrl.toString());
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      
      // Send queued messages
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        if (message) {
          this.sendMessage(message);
        }
      }
    };
    
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // console.log('WebSocket received:', data.type, data);
        this.emit(data.type, data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.attemptReconnect();
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }
  
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.eventHandlers.clear();
    this.messageQueue = [];
  }
  
  sendMessage(message: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket sending message:', message);
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message if not connected
      this.messageQueue.push(message);
      
      // Try to connect if not already attempting
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.connect();
      }
    }
  }
  
  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)?.add(handler);
  }
  
  off(event: string, handler: EventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }
  
  private emit(event: string, data: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }
  
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('error', { error: 'Failed to reconnect to server' });
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000);
    
    console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimeout = window.setTimeout(() => {
      this.connect();
    }, delay);
  }
  
  // Room management for multi-user conversations
  joinRoom(conversationId: string): void {
    if (this.currentRoomId === conversationId) {
      return; // Already in this room
    }
    
    // Leave current room if any
    if (this.currentRoomId) {
      this.leaveRoom(this.currentRoomId);
    }
    
    this.currentRoomId = conversationId;
    this.sendMessage({
      type: 'join_room',
      conversationId
    } as WsMessage);
    
    console.log('[WS] Joined room:', conversationId);
  }
  
  leaveRoom(conversationId: string): void {
    if (this.currentRoomId !== conversationId) {
      return; // Not in this room
    }
    
    this.sendMessage({
      type: 'leave_room',
      conversationId
    } as WsMessage);
    
    this.currentRoomId = null;
    console.log('[WS] Left room:', conversationId);
  }
  
  sendTyping(conversationId: string, isTyping: boolean): void {
    this.sendMessage({
      type: 'typing',
      conversationId,
      isTyping
    } as WsMessage);
  }
  
  getCurrentRoom(): string | null {
    return this.currentRoomId;
  }
}
