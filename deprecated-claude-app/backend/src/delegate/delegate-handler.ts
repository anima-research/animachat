// Vendored from @deprecated-claude/backend
// Original location: node_modules/@deprecated-claude/backend/src/delegate/delegate-handler.ts
// Modified: Phase 3 — strict delegateId validation, normalization, prefixed ack, reconnect race guard

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

// =============================================================================
// DelegateId Validation
// =============================================================================

const DELEGATE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const DELEGATE_ID_MAX_LENGTH = 32;
const RESERVED_DELEGATE_NAMES = new Set(['server', 'system', 'internal', 'admin']);

function validateDelegateId(raw: string | null): { valid: false; reason: string } | { valid: true; delegateId: string } {
  if (!raw || !raw.trim()) {
    return { valid: false, reason: 'Missing delegateId' };
  }
  const trimmed = raw.trim();
  if (trimmed.length > DELEGATE_ID_MAX_LENGTH) {
    return { valid: false, reason: `delegateId too long (max ${DELEGATE_ID_MAX_LENGTH} chars)` };
  }
  if (!DELEGATE_ID_REGEX.test(trimmed)) {
    return { valid: false, reason: 'delegateId contains invalid characters (allowed: a-z, A-Z, 0-9, _, -)' };
  }
  if (trimmed.includes('__')) {
    return { valid: false, reason: 'delegateId must not contain "__" (reserved as namespace separator)' };
  }
  if (RESERVED_DELEGATE_NAMES.has(trimmed.toLowerCase())) {
    return { valid: false, reason: `delegateId "${trimmed}" is reserved` };
  }
  return { valid: true, delegateId: trimmed };
}

// =============================================================================
// WebSocket Handler
// =============================================================================

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

  // Strict delegateId validation
  const delegateIdResult = validateDelegateId(url.searchParams.get('delegateId'));
  if (!delegateIdResult.valid) {
    console.warn(`[DelegateHandler] Invalid delegateId: ${delegateIdResult.reason}`);
    ws.close(1008, delegateIdResult.reason);
    return;
  }
  const delegateId = delegateIdResult.delegateId;  // trimmed, validated

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

  // Handle disconnect — with reconnect race guard
  ws.on('close', (code, reason) => {
    console.log(`[DelegateHandler] Delegate "${delegateId}" disconnected (code: ${code}, reason: ${reason.toString()})`);

    // Unregister THIS session from delegate manager (fails pending calls)
    delegateManager.unregisterDelegate(sessionId);

    // Race guard: only unregister tools if no replacement connection exists.
    // Prevents: Connection B replaces A → A.onClose deletes B's tools.
    const currentDelegate = delegateManager.findDelegate(userId, delegateId);
    if (!currentDelegate) {
      // No active connection with this delegateId → safe to unregister tools
      toolRegistry.unregisterDelegateTools(userId, delegateId.toLowerCase());
    } else {
      console.log(`[DelegateHandler] Skipping tool unregister — delegate "${delegateId}" has active replacement (session: ${currentDelegate.sessionId})`);
    }
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
  // NOTE: msg.delegateId is IGNORED — handshake delegateId is canonical.
  // Prevents delegate from "renaming" itself inside a manifest message.
  const delegateName = delegateId.toLowerCase();  // normalize for namespacing

  console.log(`[DelegateHandler] Tool manifest from "${delegateId}" (namespace: ${delegateName}): ${msg.tools.length} tools`);

  // Update tools in delegate manager (uses original delegateId for WS routing)
  delegateManager.updateTools(sessionId, msg.tools as any);

  // Clean old tools before registering new ones (handles re-manifest with changed tool set)
  toolRegistry.unregisterDelegateTools(userId, delegateName);

  // Register tools in tool registry with prefixed names
  toolRegistry.registerDelegateTools(
    userId,
    delegateName,     // normalized (lowercase) for registry keys
    delegateId,       // original case for display
    msg.tools as any,
    async (originalToolName: string, input: Record<string, unknown>) => {
      // No timeout here — timeout is controlled by executeWithTimeout() in ToolRegistry
      // which reads toolConfig.toolTimeout. DelegateManager has its own large safety-net timeout.
      return delegateManager.executeToolOnDelegate(
        delegateId,   // original delegateId for WS routing
        userId,
        { id: '', name: originalToolName, input },
      );
    }
  );

  // Acknowledge manifest receipt — include prefixed names so delegate knows what LLM sees
  ws.send(JSON.stringify({
    type: 'tool_manifest_ack',
    toolCount: msg.tools.length,
    tools: msg.tools.map(t => `${delegateName}__${t.name}`),
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
