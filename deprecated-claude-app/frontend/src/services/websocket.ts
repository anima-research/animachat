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
  private connectionTimeout: number | null = null; // Timeout for connection attempts
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private messageQueue: WsMessage[] = [];
  private currentRoomId: string | null = null;
  private visibilityHandler: (() => void) | null = null;
  private intentionalDisconnect = false; // Track if disconnect was intentional
  
  constructor(token: string) {
    this.token = token;
    this.setupVisibilityHandler();
  }
  
  private setupVisibilityHandler(): void {
    // Handle tab visibility changes (Safari aggressively suspends background tabs)
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        console.log('[WS] Tab became visible, checking connection...');
        // Reset reconnect attempts when tab becomes visible
        this.reconnectAttempts = 0;
        
        // Force reconnect if not connected or connection is stale
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          console.log('[WS] Connection dead after tab resume, reconnecting...');
          this.connect();
          
          // Rejoin room if we were in one
          if (this.currentRoomId) {
            const roomId = this.currentRoomId;
            this.currentRoomId = null; // Clear so joinRoom actually sends the message
            setTimeout(() => this.joinRoom(roomId), 500); // Give connection time to establish
          }
        }
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }
  
  connect(): void {
    // Don't create a new connection if one is already open or connecting
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      console.log('[WS] Connection already in progress, waiting...');
      return;
    }
    
    // Clear any existing connection timeout
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    // Mark as not intentionally disconnected
    this.intentionalDisconnect = false;
    
    const wsUrl = new URL('/ws', window.location.href);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl.searchParams.set('token', this.token);
    
    // For development, connect to backend port
    if (import.meta.env.DEV) {
      // Use HTTPS port if the page is served over HTTPS
      wsUrl.port = wsUrl.protocol === 'wss:' ? '3443' : '3010';
      wsUrl.pathname = '/';
    }
    
    console.log('[WS] Connecting to:', wsUrl.toString());
    this.emit('connection_state', { state: 'connecting' });
    
    // Close any existing WebSocket before creating new one
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        // Ignore errors when closing
      }
    }
    
    this.ws = new WebSocket(wsUrl.toString());
    
    // Set connection timeout (15 seconds) to avoid hanging in "connecting" state
    this.connectionTimeout = window.setTimeout(() => {
      if (this.ws?.readyState === WebSocket.CONNECTING) {
        console.warn('[WS] Connection timeout, closing and retrying...');
        this.ws.close();
        // onclose will handle the reconnect
      }
    }, 15000);
    
    this.ws.onopen = () => {
      console.log('[WS] Connected');
      // Clear connection timeout
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      this.reconnectAttempts = 0;
      this.emit('connection_state', { state: 'connected' });
      
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
        console.error('[WS] Failed to parse message:', error);
      }
    };
    
    this.ws.onclose = (event) => {
      console.log('[WS] Disconnected', event.code, event.reason);
      // Clear connection timeout
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      this.emit('connection_state', { state: 'disconnected' });
      // Only attempt reconnect if not intentionally disconnected
      if (!this.intentionalDisconnect) {
        this.attemptReconnect();
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('[WS] Error:', error);
    };
  }
  
  disconnect(): void {
    // Mark as intentional to prevent auto-reconnect
    this.intentionalDisconnect = true;
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    // Clean up visibility handler
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
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
      this.emit('connection_state', { state: 'failed' });
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000);
    
    console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this.emit('connection_state', { state: 'reconnecting', attempt: this.reconnectAttempts, maxAttempts: this.maxReconnectAttempts });
    
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
  
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  
  get isConnecting(): boolean {
    return this.ws?.readyState === WebSocket.CONNECTING;
  }
  
  get connectionState(): 'connected' | 'connecting' | 'disconnected' | 'reconnecting' {
    if (this.ws?.readyState === WebSocket.OPEN) return 'connected';
    if (this.ws?.readyState === WebSocket.CONNECTING) return 'connecting';
    if (this.reconnectAttempts > 0 && this.reconnectAttempts < this.maxReconnectAttempts) return 'reconnecting';
    return 'disconnected';
  }
  
  get queuedMessageCount(): number {
    return this.messageQueue.length;
  }
}
