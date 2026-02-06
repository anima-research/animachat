// Vendored from @deprecated-claude/backend
// Original location: node_modules/@deprecated-claude/backend/src/tools/tool-registry.ts
// Modified: Added policy enforcement, ToolDefinitionWithSource, getToolsForUserWithSource, executeWithTimeout

/**
 * Tool Registry
 *
 * Central registry for all tools available in the system.
 * Manages both server-side tools and delegate-provided tools.
 *
 * Tool resolution order for a given userId:
 * 1. Server tools (available to all users)
 * 2. User's delegate tools (scoped by userId + delegateId)
 *
 * Delegate tool keys: `${userId}:${delegateId}:${toolName}`
 * Server tool keys: `server:${toolName}`
 */

import { Logger } from '../utils/logger.js';
import type { ToolConfig } from '@deprecated-claude/shared';

// Membrane-compatible tool types (mirrored from membrane to avoid import dependency)
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Extended tool definition with source info for API/UI
export interface ToolDefinitionWithSource extends ToolDefinition {
  source: 'server' | 'delegate';
  delegateId?: string;
}

export interface ToolResult {
  toolUseId: string;
  content: string | Array<{ type: string; [key: string]: unknown }>;
  isError?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type ToolExecutor = (input: Record<string, unknown>) => Promise<ToolResult>;

interface RegisteredTool {
  definition: ToolDefinition;
  source: 'server' | 'delegate';
  delegateId?: string;
  userId?: string;
  execute: ToolExecutor;
}

export class ToolRegistry {
  private serverTools: Map<string, RegisteredTool> = new Map();
  private delegateTools: Map<string, RegisteredTool> = new Map();

  /**
   * Register a server-side tool (available to all users).
   */
  registerServerTool(
    name: string,
    definition: ToolDefinition,
    executor: ToolExecutor
  ): void {
    const key = `server:${name}`;
    this.serverTools.set(key, {
      definition,
      source: 'server',
      execute: executor,
    });
    Logger.debug(`[ToolRegistry] Registered server tool: ${name}`);
  }

  /**
   * Register tools from a delegate (scoped to a user).
   */
  registerDelegateTools(
    userId: string,
    delegateId: string,
    tools: ToolDefinition[],
    executor: (name: string, input: Record<string, unknown>) => Promise<ToolResult>
  ): void {
    for (const tool of tools) {
      const key = `${userId}:${delegateId}:${tool.name}`;
      this.delegateTools.set(key, {
        definition: tool,
        source: 'delegate',
        delegateId,
        userId,
        execute: (input) => executor(tool.name, input),
      });
    }
    Logger.debug(`[ToolRegistry] Registered ${tools.length} delegate tools for user ${userId}, delegate ${delegateId}`);
  }

  /**
   * Unregister all tools from a specific delegate.
   */
  unregisterDelegateTools(userId: string, delegateId: string): void {
    const prefix = `${userId}:${delegateId}:`;
    let removed = 0;
    for (const key of this.delegateTools.keys()) {
      if (key.startsWith(prefix)) {
        this.delegateTools.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      Logger.debug(`[ToolRegistry] Unregistered ${removed} delegate tools for user ${userId}, delegate ${delegateId}`);
    }
  }

  /**
   * Get all tool definitions available to a user.
   * Returns server tools + user's delegate tools.
   *
   * NOTE: This is the original method, kept for backward compatibility.
   * Use getToolsForUserWithSource() for API/UI with source info.
   */
  getToolsForUser(userId: string): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    const seenNames = new Set<string>();

    // Server tools first
    for (const tool of this.serverTools.values()) {
      tools.push(tool.definition);
      seenNames.add(tool.definition.name);
    }

    // User's delegate tools (skip if name conflicts with server tool)
    const userPrefix = `${userId}:`;
    for (const [key, tool] of this.delegateTools) {
      if (key.startsWith(userPrefix)) {
        if (seenNames.has(tool.definition.name)) {
          // Conflict: delegate tool name matches server tool, skip
          Logger.debug(`[ToolRegistry] Skipping delegate tool "${tool.definition.name}" (conflicts with server tool)`);
          continue;
        }
        tools.push(tool.definition);
        seenNames.add(tool.definition.name);
      }
    }

    return tools;
  }

  /**
   * Get all tool definitions available to a user WITH source info.
   * Use this for API/UI to show where each tool comes from.
   */
  getToolsForUserWithSource(userId: string): ToolDefinitionWithSource[] {
    const tools: ToolDefinitionWithSource[] = [];
    const seenNames = new Set<string>();

    // Server tools first
    for (const tool of this.serverTools.values()) {
      tools.push({ ...tool.definition, source: 'server' });
      seenNames.add(tool.definition.name);
    }

    // User's delegate tools (skip conflicts with server)
    const userPrefix = `${userId}:`;
    let delegateToolCount = 0;
    for (const [key, tool] of this.delegateTools) {
      if (key.startsWith(userPrefix)) {
        if (seenNames.has(tool.definition.name)) continue;  // Same conflict logic as original
        tools.push({ ...tool.definition, source: 'delegate', delegateId: tool.delegateId });
        seenNames.add(tool.definition.name);
        delegateToolCount++;
      }
    }

    return tools;
  }

  /**
   * Check if a tool is allowed for a participant based on their toolConfig.
   *
   * Logic:
   * - toolsEnabled === false → no tools allowed
   * - enabledTools === null/undefined → allow ALL tools
   * - enabledTools === [] (empty array) → no tools allowed (selective mode, none selected)
   * - enabledTools === ['tool1', 'tool2'] → only these tools allowed
   */
  isToolAllowedForParticipant(toolName: string, toolConfig?: ToolConfig): boolean {
    if (!toolConfig) return true;
    if (toolConfig.toolsEnabled === false) return false;

    // null/undefined = allow all tools
    if (toolConfig.enabledTools === null || toolConfig.enabledTools === undefined) {
      return true;
    }

    // Array (even empty) = selective mode
    return toolConfig.enabledTools.includes(toolName);
  }

  /**
   * Filter tools by participant config.
   */
  getToolsForParticipant(allTools: ToolDefinitionWithSource[], toolConfig?: ToolConfig): ToolDefinitionWithSource[] {
    return allTools.filter(t => this.isToolAllowedForParticipant(t.name, toolConfig));
  }

  /**
   * Check if any tools are available for a user.
   */
  hasToolsForUser(userId: string): boolean {
    if (this.serverTools.size > 0) return true;

    const userPrefix = `${userId}:`;
    for (const key of this.delegateTools.keys()) {
      if (key.startsWith(userPrefix)) return true;
    }

    return false;
  }

  /**
   * Execute a tool by name for a given user.
   *
   * Resolution order (v1):
   * 1. Preferred delegate (if specified and connected with this tool)
   * 2. Server tool (stable, predictable)
   * 3. Fallback delegate (any delegate with this tool)
   *
   * Note: If tool exists on BOTH server and delegate, without preferred delegate
   * we use server (more stable). This is intentional for v1.
   */
  async executeTool(
    call: ToolCall,
    userId: string,
    toolConfig?: ToolConfig
  ): Promise<ToolResult> {
    const { id: toolUseId, name, input } = call;

    // Policy check FIRST - return with correct toolUseId
    if (!this.isToolAllowedForParticipant(name, toolConfig)) {
      return {
        toolUseId,
        content: `Tool "${name}" is not allowed for this participant`,
        isError: true
      };
    }

    const timeout = toolConfig?.toolTimeout ?? 30000;
    const preferredDelegateId = toolConfig?.delegateId;

    // Step 1: Try preferred delegate first (if specified)
    if (preferredDelegateId) {
      const preferredKey = `${userId}:${preferredDelegateId}:${name}`;
      const preferredTool = this.delegateTools.get(preferredKey);
      if (preferredTool) {
        return this.executeWithTimeout(preferredTool.execute(input), timeout, toolUseId, name);
      }
      // Preferred delegate doesn't have this tool - log and continue
      Logger.debug(`[ToolRegistry] Preferred delegate "${preferredDelegateId}" doesn't have tool "${name}", falling back`);
    }

    // Step 2: Try server tool (stable, predictable)
    const serverKey = `server:${name}`;
    const serverTool = this.serverTools.get(serverKey);
    if (serverTool) {
      return this.executeWithTimeout(serverTool.execute(input), timeout, toolUseId, name);
    }

    // Step 3: Try any delegate with this tool (fallback)
    const userPrefix = `${userId}:`;
    for (const [key, tool] of this.delegateTools) {
      if (key.startsWith(userPrefix) && tool.definition.name === name) {
        return this.executeWithTimeout(tool.execute(input), timeout, toolUseId, name);
      }
    }

    // Tool not found
    console.warn(`[ToolRegistry] Tool not found: ${name} (user: ${userId})`);
    return { toolUseId, content: `Unknown tool: ${name}`, isError: true };
  }

  /**
   * Timeout wrapper with proper toolUseId and logging.
   *
   * NOTE on late responses:
   * - For delegate tools: delegate-manager.ts already handles this -
   *   on timeout, pendingCall is deleted, late response finds no entry → ignored
   * - For server tools: Promise.race returns first result, second is GC'd
   * - This is "timeout of waiting", NOT "execution cancelled"
   */
  private async executeWithTimeout(
    promise: Promise<ToolResult>,
    timeoutMs: number,
    toolUseId: string,
    toolName: string
  ): Promise<ToolResult> {
    const correlationId = `${toolUseId}-${Date.now()}`;

    const result = await Promise.race([
      promise.then(r => ({ ...r, toolUseId })),  // Ensure toolUseId is set
      new Promise<ToolResult>((resolve) =>
        setTimeout(() => {
          Logger.warn(`[ToolRegistry] Tool "${toolName}" timed out waiting for result after ${timeoutMs}ms (correlation: ${correlationId})`);
          resolve({
            toolUseId,
            content: `Tool "${toolName}" timed out waiting for result after ${timeoutMs}ms`,
            isError: true
          });
        }, timeoutMs)
      )
    ]);

    return result;
  }

  /**
   * Get delegate info for a tool (used for routing decisions).
   */
  getDelegateForTool(name: string, userId: string): { delegateId: string; userId: string } | null {
    const userPrefix = `${userId}:`;
    for (const [key, tool] of this.delegateTools) {
      if (key.startsWith(userPrefix) && tool.definition.name === name) {
        return { delegateId: tool.delegateId!, userId: tool.userId! };
      }
    }
    return null;
  }

  /**
   * Get registry stats for debugging.
   */
  getStats(): { serverTools: number; delegateTools: number; delegateToolsByUser: Record<string, number> } {
    const delegateToolsByUser: Record<string, number> = {};
    for (const [key] of this.delegateTools) {
      const userId = key.split(':')[0];
      delegateToolsByUser[userId] = (delegateToolsByUser[userId] || 0) + 1;
    }

    return {
      serverTools: this.serverTools.size,
      delegateTools: this.delegateTools.size,
      delegateToolsByUser,
    };
  }
}

export const toolRegistry = new ToolRegistry();
