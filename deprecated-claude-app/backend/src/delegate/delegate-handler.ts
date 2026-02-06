// Vendored from @deprecated-claude/backend
// Original location: node_modules/@deprecated-claude/backend/src/delegate/delegate-handler.ts

/**
 * Delegate WebSocket Handler
 *
 * Handles WebSocket connections from delegate apps.
 * Delegates connect with:
 *   ?token=JWT&delegateId=xxx (JWT auth - for testing/legacy)
 *   ?apiKey=dak_xxx&delegateId=xxx (API Key auth - recommended)
 */

import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { verifyToken } from '../middleware/auth.js';
import { Database } from '../database/index.js';
import { delegateManager } from './delegate-manager.js';
import { toolRegistry } from '../tools/tool-registry.js';
import { triggerHandler } from './trigger-handler.js';
import {
  DelegateToServerMessageSchema,
  type ToolManifestMessage,
  type ToolCallResponseMessage,
  type TriggerInferenceMessage,
} from './protocol.js';

interface DelegateWebSocket extends WebSocket {
  userId?: string;
  delegateId?: string;
  sessionId?: string;
  isAlive?: boolean;
}

export async function delegateWebsocketHandler(
  ws: DelegateWebSocket,
  req: IncomingMessage,
  db: Database
): Promise<void> {
  // Parse query parameters
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const apiKey = url.searchParams.get('apiKey');
  const delegateId = url.searchParams.get('delegateId');

  if (!delegateId) {
    console.warn('[DelegateHandler] Missing delegateId');
    ws.close(1008, 'Missing delegateId');
    return;
  }

  if (!token && !apiKey) {
    console.warn('[DelegateHandler] Missing token or apiKey');
    ws.close(1008, 'Missing authentication (token or apiKey required)');
    return;
  }

  let userId: string;

  // Try API Key auth first (preferred)
  if (apiKey) {
    const keyResult = await db.validateDelegateApiKey(apiKey);
    if (!keyResult) {
      console.warn('[DelegateHandler] Invalid API key');
      ws.close(1008, 'Invalid API key (expired, revoked, or invalid)');
      return;
    }
    userId = keyResult.userId;
    console.log(`[DelegateHandler] Delegate "${delegateId}" authenticated via API key (user: ${userId})`);
  } else {
    // Fallback to JWT auth
    const decoded = verifyToken(token!);
    if (!decoded) {
      console.warn('[DelegateHandler] Invalid token');
      ws.close(1008, 'Authentication failed');
      return;
    }
    userId = decoded.userId;
    console.log(`[DelegateHandler] Delegate "${delegateId}" authenticated via JWT (user: ${userId})`);
  }

  ws.userId = userId;
  ws.delegateId = delegateId;
  ws.isAlive = true;

  // Register delegate
  const sessionId = delegateManager.registerDelegate(ws, userId, delegateId);
  ws.sessionId = sessionId;

  // Send auth result
  ws.send(JSON.stringify({
    type: 'delegate_auth_result',
    success: true,
    userId,
    sessionId,
  }));

  console.log(`[DelegateHandler] Delegate "${delegateId}" authenticated for user ${userId}`);

  // Handle pong for heartbeat
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Handle messages
  ws.on('message', (data) => {
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      console.warn('[DelegateHandler] Invalid JSON from delegate');
      return;
    }

    // Parse and validate message
    const parsed = DelegateToServerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[DelegateHandler] Invalid message from delegate "${delegateId}":`, parsed.error.message);
      return;
    }

    const msg = parsed.data;

    switch (msg.type) {
      case 'tool_manifest':
        handleToolManifest(ws, msg, userId, delegateId, sessionId);
        break;

      case 'tool_call_response':
        handleToolCallResponse(msg);
        break;

      case 'trigger_inference':
        handleTriggerInference(ws, msg, userId, db);
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
        break;

      case 'delegate_auth':
        // Already authenticated at connection time, ignore re-auth
        break;

      default:
        console.warn(`[DelegateHandler] Unknown message type from delegate "${delegateId}"`);
    }
  });

  // Handle disconnect
  ws.on('close', (code, reason) => {
    console.log(`[DelegateHandler] Delegate "${delegateId}" disconnected (code: ${code}, reason: ${reason.toString()})`);

    // Unregister from delegate manager (fails pending calls)
    delegateManager.unregisterDelegate(sessionId);

    // Unregister tools from registry
    toolRegistry.unregisterDelegateTools(userId, delegateId);
  });

  ws.on('error', (error) => {
    console.error(`[DelegateHandler] WebSocket error for delegate "${delegateId}":`, error.message);
  });
}

// =============================================================================
// Message Handlers
// =============================================================================

function handleToolManifest(
  ws: DelegateWebSocket,
  msg: ToolManifestMessage,
  userId: string,
  delegateId: string,
  sessionId: string
): void {
  console.log(`[DelegateHandler] Tool manifest from "${delegateId}": ${msg.tools.length} tools`);

  // Update tools in delegate manager
  delegateManager.updateTools(sessionId, msg.tools as any);

  // Register tools in tool registry with delegate executor
  toolRegistry.registerDelegateTools(
    userId,
    delegateId,
    msg.tools as any,
    async (toolName: string, input: Record<string, unknown>) => {
      return delegateManager.executeToolOnDelegate(
        delegateId,
        userId,
        { id: '', name: toolName, input },
        30000
      );
    }
  );

  // Acknowledge manifest receipt
  ws.send(JSON.stringify({
    type: 'tool_manifest_ack',
    toolCount: msg.tools.length,
    tools: msg.tools.map(t => t.name),
  }));
}

function handleToolCallResponse(msg: ToolCallResponseMessage): void {
  delegateManager.handleToolCallResponse(msg);
}

async function handleTriggerInference(
  ws: DelegateWebSocket,
  msg: TriggerInferenceMessage,
  userId: string,
  db: Database
): Promise<void> {
  try {
    const result = await triggerHandler.handleTrigger(msg, userId, db);
    ws.send(JSON.stringify(result));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[DelegateHandler] Trigger inference error:`, errorMsg);
    ws.send(JSON.stringify({
      type: 'trigger_inference_result',
      triggerId: msg.triggerId,
      success: false,
      error: errorMsg,
    }));
  }
}
