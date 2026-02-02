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
  private keepAliveInterval: number | null = null; // Client-side keep-alive for Safari
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private messageQueue: WsMessage[] = [];
  private currentRoomId: string | null = null;
  private visibilityHandler: (() => void) | null = null;
  private intentionalDisconnect = false; // Track if disconnect was intentional
  private isClosingConnection = false; // Prevent race conditions during close
  private lastPongTime: number = 0; // Track last server response
  
  constructor(token: string) {
    this.token = token;
    this.setupVisibilityHandler();
  }
  
  private setupVisibilityHandler(): void {
    // Handle tab visibility changes (Safari aggressively suspends background tabs)
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        console.log('[WS] Tab became visible, checking connection...');
        // Reset reconnect attempts when tab becomes visible (user is actively using the tab)
        this.reconnectAttempts = 0;
        
        // Check if connection is stale (no server activity while tab was hidden)
        const timeSinceLastPong = Date.now() - this.lastPongTime;
        const connectionMayBeStale = timeSinceLastPong > 60000; // 1 minute without activity
        
        // Force reconnect if not connected or connection appears stale
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          console.log('[WS] Connection dead after tab resume, reconnecting...');
          this.connect();
          
          // Rejoin room if we were in one
          if (this.currentRoomId) {
            const roomId = this.currentRoomId;
            this.currentRoomId = null; // Clear so joinRoom actually sends the message
            setTimeout(() => this.joinRoom(roomId), 500); // Give connection time to establish
          }
        } else if (connectionMayBeStale) {
          console.log(`[WS] Connection may be stale (${Math.round(timeSinceLastPong / 1000)}s since last activity), sending ping...`);
          // Send a ping to verify connection is still alive
          try {
            this.ws.send(JSON.stringify({ type: 'ping' }));
            // If we don't get a pong within 5 seconds, force reconnect
            setTimeout(() => {
              const newTimeSinceLastPong = Date.now() - this.lastPongTime;
              if (newTimeSinceLastPong > timeSinceLastPong) {
                console.warn('[WS] Connection confirmed dead (no pong), reconnecting...');
                this.ws?.close(4001, 'Connection stale after visibility change');
              }
            }, 5000);
          } catch (e) {
            console.warn('[WS] Failed to send visibility ping, reconnecting...');
            this.connect();
          }
        } else {
          console.log(`[WS] Connection appears healthy (last activity ${Math.round(timeSinceLastPong / 1000)}s ago)`);
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
    
    // Don't try to connect while we're closing a previous connection
    if (this.isClosingConnection) {
      console.log('[WS] Waiting for previous connection to close...');
      return;
    }
    
    // Clear any existing connection timeout
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    // Clear keep-alive interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    
    // Mark as not intentionally disconnected
    this.intentionalDisconnect = false;
    
    const wsUrl = new URL('/ws', window.location.href);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl.searchParams.set('token', this.token);
    
    // Add unique tab identifier to work around Safari + iCloud Private Relay bug
    // where multiple WebSocket connections to the same host:port are serialized.
    // Each tab gets a unique ID, making the URLs distinct to Safari.
    let tabId = sessionStorage.getItem('ws_tab_id');
    if (!tabId) {
      tabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      sessionStorage.setItem('ws_tab_id', tabId);
    }
    wsUrl.searchParams.set('tabId', tabId);
    
    // For development, connect to backend port
    if (import.meta.env.DEV) {
      // Use HTTPS port if the page is served over HTTPS
      wsUrl.port = wsUrl.protocol === 'wss:' ? '3443' : '3010';
      wsUrl.pathname = '/';
    }
    
    console.log('[WS] Connecting to:', wsUrl.toString(), '(tabId:', tabId, ')');
    this.emit('connection_state', { state: 'connecting' });
    
    // Close any existing WebSocket before creating new one
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.isClosingConnection = true;
      try {
        // Remove handlers to prevent double-triggering
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch (e) {
        // Ignore errors when closing
      }
      // Wait a bit for the close to complete, then proceed
      setTimeout(() => {
        this.isClosingConnection = false;
        this.ws = null;
        this.connect();
      }, 100);
      return;
    }
    
    this.ws = new WebSocket(wsUrl.toString());
    this.lastPongTime = Date.now();
    
    // Set connection timeout (20 seconds) to avoid hanging in "connecting" state
    // Increased from 15s to give Safari more time
    this.connectionTimeout = window.setTimeout(() => {
      if (this.ws?.readyState === WebSocket.CONNECTING) {
        console.warn('[WS] Connection timeout after 20s, closing and retrying...');
        this.isClosingConnection = true;
        this.ws.onclose = null; // Prevent double-handling
        this.ws.close();
        this.ws = null;
        this.isClosingConnection = false;
        this.attemptReconnect();
      }
    }, 20000);
    
    this.ws.onopen = () => {
      console.log('[WS] Connected successfully');
      // Clear connection timeout
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      this.reconnectAttempts = 0;
      this.lastPongTime = Date.now();
      this.emit('connection_state', { state: 'connected' });
      
      // Start client-side keep-alive (Safari needs this more frequently)
      // Send a ping every 15 seconds to keep the connection alive
      this.startKeepAlive();
      
      // Send queued messages
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        if (message) {
          this.sendMessage(message);
        }
      }
    };
    
    this.ws.onmessage = (event) => {
      // Any message from server counts as "pong" - connection is alive
      this.lastPongTime = Date.now();
      
      try {
        const data = JSON.parse(event.data);
        // console.log('WebSocket received:', data.type, data);
        this.emit(data.type, data);
      } catch (error) {
        console.error('[WS] Failed to parse message:', error);
      }
    };
    
    this.ws.onclose = (event) => {
      console.log('[WS] Disconnected', event.code, event.reason, `(was connected for ${Math.round((Date.now() - this.lastPongTime) / 1000)}s since last activity)`);
      // Clear connection timeout
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      // Clear keep-alive
      if (this.keepAliveInterval) {
        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = null;
      }
      this.emit('connection_state', { state: 'disconnected' });
      // Only attempt reconnect if not intentionally disconnected and not already closing
      if (!this.intentionalDisconnect && !this.isClosingConnection) {
        this.attemptReconnect();
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('[WS] Error:', error);
    };
  }
  
  /**
   * Start client-side keep-alive to prevent Safari from closing idle connections.
   * Sends a lightweight ping message every 15 seconds.
   */
  private startKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }
    
    this.keepAliveInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Check if we haven't heard from server in 45 seconds (missed 1.5 server heartbeats)
        const timeSinceLastPong = Date.now() - this.lastPongTime;
        if (timeSinceLastPong > 45000) {
          console.warn(`[WS] No server activity for ${Math.round(timeSinceLastPong / 1000)}s, connection may be dead`);
          // Force reconnect - the connection might be zombie
          this.ws.close(4000, 'No server activity');
          return;
        }
        
        // Send a lightweight ping message to keep connection alive
        // This helps Safari maintain the WebSocket connection
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch (e) {
          console.warn('[WS] Failed to send keep-alive ping:', e);
        }
      }
    }, 15000);
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
    
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
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
