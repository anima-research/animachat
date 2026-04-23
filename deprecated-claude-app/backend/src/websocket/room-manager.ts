import { WebSocket } from 'ws';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  isAlive?: boolean;
}

interface RoomMember {
  ws: AuthenticatedWebSocket;
  userId: string;
  joinedAt: Date;
}

interface ConversationRoom {
  conversationId: string;
  members: Map<string, RoomMember>; // keyed by odable
  activeAiRequest: {
    userId: string;
    messageId: string;
    startedAt: Date;
  } | null;
}

/**
 * Manages WebSocket "rooms" for multi-user conversations.
 * Each conversation is a room that multiple users can join.
 */
class RoomManager {
  private rooms: Map<string, ConversationRoom> = new Map();
  private userConnections: Map<string, Set<AuthenticatedWebSocket>> = new Map();
  
  /**
   * Register a WebSocket connection for a user.
   * A user can have multiple connections (multiple tabs).
   */
  registerConnection(ws: AuthenticatedWebSocket, userId: string): void {
    let connections = this.userConnections.get(userId);
    if (!connections) {
      connections = new Set();
      this.userConnections.set(userId, connections);
    }
    connections.add(ws);
    console.log(`[RoomManager] User ${userId} connected. Total connections: ${connections.size}`);
  }
  
  /**
   * Unregister a WebSocket connection when it closes.
   */
  unregisterConnection(ws: AuthenticatedWebSocket): void {
    if (!ws.userId) return;
    
    const connections = this.userConnections.get(ws.userId);
    if (connections) {
      connections.delete(ws);
      if (connections.size === 0) {
        this.userConnections.delete(ws.userId);
      }
      console.log(`[RoomManager] User ${ws.userId} disconnected. Remaining connections: ${connections.size}`);
    }
    
    // Remove from all rooms
    for (const room of this.rooms.values()) {
      this.leaveRoomInternal(room, ws);
    }
  }
  
  /**
   * User joins a conversation room.
   */
  joinRoom(conversationId: string, ws: AuthenticatedWebSocket): void {
    if (!ws.userId) return;
    
    let room = this.rooms.get(conversationId);
    if (!room) {
      room = {
        conversationId,
        members: new Map(),
        activeAiRequest: null
      };
      this.rooms.set(conversationId, room);
    }
    
    // Use a unique key for this connection (user can have multiple tabs)
    const connectionKey = `${ws.userId}:${Date.now()}:${Math.random()}`;
    room.members.set(connectionKey, {
      ws,
      userId: ws.userId,
      joinedAt: new Date()
    });
    
    // Store the connection key on the websocket for later removal
    (ws as any)._roomConnectionKey = (ws as any)._roomConnectionKey || {};
    (ws as any)._roomConnectionKey[conversationId] = connectionKey;
    
    console.log(`[RoomManager] User ${ws.userId} joined room ${conversationId}. Members: ${room.members.size}`);
    
    // Notify others that someone joined
    this.broadcastToRoom(conversationId, {
      type: 'user_joined',
      conversationId,
      userId: ws.userId,
      activeUsers: this.getActiveUsers(conversationId)
    }, ws); // Exclude the joining user
  }
  
  /**
   * User leaves a conversation room.
   */
  leaveRoom(conversationId: string, ws: AuthenticatedWebSocket): void {
    const room = this.rooms.get(conversationId);
    if (!room) return;
    
    this.leaveRoomInternal(room, ws);
    
    // Clean up empty rooms
    if (room.members.size === 0) {
      this.rooms.delete(conversationId);
      console.log(`[RoomManager] Room ${conversationId} is empty, removing`);
    }
  }
  
  private leaveRoomInternal(room: ConversationRoom, ws: AuthenticatedWebSocket): void {
    if (!ws.userId) return;
    
    const connectionKey = (ws as any)._roomConnectionKey?.[room.conversationId];
    if (connectionKey) {
      room.members.delete(connectionKey);
      delete (ws as any)._roomConnectionKey[room.conversationId];
      
      console.log(`[RoomManager] User ${ws.userId} left room ${room.conversationId}. Members: ${room.members.size}`);
      
      // Notify others
      this.broadcastToRoom(room.conversationId, {
        type: 'user_left',
        conversationId: room.conversationId,
        userId: ws.userId,
        activeUsers: this.getActiveUsers(room.conversationId)
      });
    }
  }
  
  /**
   * Broadcast a message to all users in a room.
   * @param exclude - Optional WebSocket to exclude from broadcast (e.g., the sender)
   */
  broadcastToRoom(conversationId: string, message: any, exclude?: AuthenticatedWebSocket): void {
    const room = this.rooms.get(conversationId);
    if (!room) return;

    const payload = JSON.stringify(message);

    for (const member of room.members.values()) {
      if (member.ws !== exclude && member.ws.readyState === WebSocket.OPEN) {
        try {
          member.ws.send(payload);
        } catch (error) {
          console.error(`[RoomManager] Failed to send to user ${member.userId}:`, error);
        }
      }
    }
  }

  /**
   * Broadcast a message to all connections of a specific user.
   * Used for user-wide notifications like delegate status changes.
   */
  broadcastToUser(userId: string, message: any): void {
    const connections = this.userConnections.get(userId);
    if (!connections || connections.size === 0) return;

    const payload = JSON.stringify(message);

    for (const ws of connections) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch (error) {
          console.error(`[RoomManager] Failed to send to user ${userId}:`, error);
        }
      }
    }
  }
  
  /**
   * Get list of active users in a room.
   */
  getActiveUsers(conversationId: string): Array<{ userId: string; joinedAt: Date }> {
    const room = this.rooms.get(conversationId);
    if (!room) return [];
    
    // Dedupe by userId (user might have multiple connections)
    const userMap = new Map<string, Date>();
    for (const member of room.members.values()) {
      const existing = userMap.get(member.userId);
      if (!existing || member.joinedAt < existing) {
        userMap.set(member.userId, member.joinedAt);
      }
    }
    
    return Array.from(userMap.entries()).map(([userId, joinedAt]) => ({
      userId,
      joinedAt
    }));
  }
  
  /**
   * Check if there's an active AI request for a conversation.
   */
  hasActiveAiRequest(conversationId: string): boolean {
    const room = this.rooms.get(conversationId);
    return room?.activeAiRequest !== null;
  }
  
  /**
   * Start tracking an AI request.
   */
  startAiRequest(conversationId: string, userId: string, messageId: string): boolean {
    let room = this.rooms.get(conversationId);
    if (!room) {
      room = {
        conversationId,
        members: new Map(),
        activeAiRequest: null
      };
      this.rooms.set(conversationId, room);
    }
    
    if (room.activeAiRequest) {
      console.log(`[RoomManager] AI request already active for ${conversationId} by ${room.activeAiRequest.userId}`);
      return false; // Already has an active request
    }
    
    room.activeAiRequest = {
      userId,
      messageId,
      startedAt: new Date()
    };
    
    console.log(`[RoomManager] AI request started for ${conversationId} by ${userId}`);
    
    // Broadcast to room that AI is generating
    this.broadcastToRoom(conversationId, {
      type: 'ai_generating',
      conversationId,
      userId,
      messageId
    });
    
    return true;
  }
  
  /**
   * End tracking an AI request.
   */
  endAiRequest(conversationId: string): void {
    const room = this.rooms.get(conversationId);
    if (room) {
      room.activeAiRequest = null;
      console.log(`[RoomManager] AI request ended for ${conversationId}`);
      
      // Broadcast that AI finished
      this.broadcastToRoom(conversationId, {
        type: 'ai_finished',
        conversationId
      });
    }
  }
  
  /**
   * Get the active AI request info for a conversation.
   */
  getActiveAiRequest(conversationId: string): ConversationRoom['activeAiRequest'] {
    const room = this.rooms.get(conversationId);
    return room?.activeAiRequest || null;
  }
  
  /**
   * Get room stats for debugging.
   */
  getStats(): { totalRooms: number; totalConnections: number; rooms: Array<{ id: string; members: number; hasActiveAi: boolean }> } {
    let totalConnections = 0;
    for (const connections of this.userConnections.values()) {
      totalConnections += connections.size;
    }
    
    return {
      totalRooms: this.rooms.size,
      totalConnections,
      rooms: Array.from(this.rooms.entries()).map(([id, room]) => ({
        id,
        members: room.members.size,
        hasActiveAi: room.activeAiRequest !== null
      }))
    };
  }
  
  /**
   * Get all active WebSocket connections.
   * Used by heartbeat to ping all connections and keep them alive.
   */
  getAllConnections(): AuthenticatedWebSocket[] {
    const allConnections: AuthenticatedWebSocket[] = [];
    for (const connections of this.userConnections.values()) {
      for (const ws of connections) {
        allConnections.push(ws);
      }
    }
    return allConnections;
  }
  
  /**
   * Perform heartbeat check on all connections.
   * Terminates connections that didn't respond to the last ping.
   */
  performHeartbeat(): { checked: number; terminated: number } {
    const connections = this.getAllConnections();
    let terminated = 0;
    
    for (const ws of connections) {
      if (ws.isAlive === false) {
        // Connection didn't respond to last ping - terminate it
        console.log(`[Heartbeat] Terminating unresponsive connection for user ${ws.userId}`);
        ws.terminate();
        terminated++;
        continue;
      }
      
      // Mark as not alive, will be set to true when pong is received
      ws.isAlive = false;
      
      // Send ping (the 'pong' handler will set isAlive = true)
      try {
        ws.ping();
      } catch (error) {
        console.error(`[Heartbeat] Failed to ping user ${ws.userId}:`, error);
      }
    }
    
    if (connections.length > 0) {
      console.log(`[Heartbeat] Checked ${connections.length} connections, terminated ${terminated} unresponsive`);
    }
    
    return { checked: connections.length, terminated };
  }
}

// Singleton instance
export const roomManager = new RoomManager();

