// Vendored from @deprecated-claude/backend
// Original location: node_modules/@deprecated-claude/backend/src/tools/tool-registry.ts
// Modified: Phase 3 — Tool namespacing (prefixed delegate tools, flat lookup, compat shim)

/**
 * Tool Registry
 *
 * Central registry for all tools available in the system.
 * Manages both server-side tools and delegate-provided tools.
 *
 * Phase 3 namespacing:
 * - Delegate tools are registered with prefixed names: `{delegateName}__{toolName}`
 * - Server tools remain unprefixed (global)
 * - Flat map lookup by exact prefixed name
 * - Compat shim: unprefixed names auto-resolve if only one candidate exists
 *
 * Separator: `__` (double underscore) — Anthropic API forbids dots in tool names.
 * API pattern: ^[a-zA-Z0-9_-]{1,128}$
 *
 * Key formats:
 *   Server tools:   `server:{toolName}`
 *   Delegate tools:  `{userId}:{delegateName}__{toolName}`
 */

import { Logger } from '../utils/logger.js';
import type { ToolConfig } from '@deprecated-claude/shared';

/**
 * Namespace separator for prefixed tool names.
 * Anthropic API pattern: ^[a-zA-Z0-9_-]{1,128}$ — dots are forbidden.
 * We use `__` (double underscore) as the delimiter.
 */
const NS_SEP = '__';

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
  delegateName?: string;  // normalized (lowercase) delegate name
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
  delegateName?: string;   // normalized (lowercase)
  displayName?: string;    // original case for UI
  userId?: string;
  execute: ToolExecutor;
}

export class ToolRegistry {
  private serverTools: Map<string, RegisteredTool> = new Map();
  private delegateTools: Map<string, RegisteredTool> = new Map();

  /**
   * Register a server-side tool (available to all users, unprefixed).
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
   * Tools are stored with prefixed names: `{delegateName}__{toolName}`
   * The executor receives the ORIGINAL (unprefixed) tool name.
   */
  registerDelegateTools(
    userId: string,
    delegateName: string,
    displayName: string,
    tools: ToolDefinition[],
    executor: (originalName: string, input: Record<string, unknown>) => Promise<ToolResult>
  ): void {
    for (const tool of tools) {
      const prefixedName = `${delegateName}${NS_SEP}${tool.name}`;
      const key = `${userId}:${prefixedName}`;

      this.delegateTools.set(key, {
        definition: { ...tool, name: prefixedName },  // LLM sees prefixed name
        source: 'delegate',
        delegateName,
        displayName,
        userId,
        execute: (input) => executor(tool.name, input),  // delegate receives ORIGINAL name
      });
    }
    Logger.debug(`[ToolRegistry] Registered ${tools.length} delegate tools for user ${userId}, delegate ${delegateName} (display: ${displayName})`);
  }

  /**
   * Unregister all tools from a specific delegate.
   * @param delegateName — normalized (lowercase) delegate name
   */
  unregisterDelegateTools(userId: string, delegateName: string): void {
    const prefix = `${userId}:${delegateName}${NS_SEP}`;
    let removed = 0;
    for (const key of this.delegateTools.keys()) {
      if (key.startsWith(prefix)) {
        this.delegateTools.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      Logger.debug(`[ToolRegistry] Unregistered ${removed} delegate tools for user ${userId}, delegate ${delegateName}`);
    }
  }

  /**
   * Get all tool definitions available to a user.
   * Server tools are unprefixed; delegate tools have `{delegateName}__` prefix.
   * No conflict resolution needed — uniqueness is structural.
   */
  getToolsForUser(userId: string): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    // Global server tools (unprefixed)
    for (const tool of this.serverTools.values()) {
      tools.push(tool.definition);
    }

    // User's delegate tools (already prefixed)
    const userPrefix = `${userId}:`;
    for (const [key, tool] of this.delegateTools) {
      if (key.startsWith(userPrefix)) {
        tools.push(tool.definition);
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

    // Server tools first
    for (const tool of this.serverTools.values()) {
      tools.push({ ...tool.definition, source: 'server' });
    }

    // User's delegate tools (already prefixed, no conflict resolution needed)
    const userPrefix = `${userId}:`;
    for (const [key, tool] of this.delegateTools) {
      if (key.startsWith(userPrefix)) {
        tools.push({ ...tool.definition, source: 'delegate', delegateName: tool.delegateName });
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
   * Resolution (v2 — namespaced):
   * 1. Exact match on global server tools (unprefixed)
   * 2. Exact match on delegate tools (prefixed: `{delegateName}__{toolName}`)
   * 3. Compat shim — unprefixed name → auto-resolve if exactly one candidate
   * 4. Not found
   *
   * Policy check happens AFTER match (not before) to avoid blocking compat shim.
   */
  async executeTool(
    call: ToolCall,
    userId: string,
    toolConfig?: ToolConfig
  ): Promise<ToolResult> {
    const { id: toolUseId, name, input } = call;
    const timeout = toolConfig?.toolTimeout ?? 30000;

    // 1. Try exact match on global tools
    const serverKey = `server:${name}`;
    const serverTool = this.serverTools.get(serverKey);
    if (serverTool) {
      if (!this.isToolAllowedForParticipant(name, toolConfig)) {
        return { toolUseId, content: `Tool "${name}" is not allowed for this participant`, isError: true };
      }
      return this.executeWithTimeout(serverTool.execute(input), timeout, toolUseId, name);
    }

    // 2. Try exact match on delegate tools (prefixed name)
    const delegateKey = `${userId}:${name}`;
    const delegateTool = this.delegateTools.get(delegateKey);
    if (delegateTool) {
      if (!this.isToolAllowedForParticipant(name, toolConfig)) {
        return { toolUseId, content: `Tool "${name}" is not allowed for this participant`, isError: true };
      }
      return this.executeWithTimeout(delegateTool.execute(input), timeout, toolUseId, name);
    }

    // 3. Compat shim — unprefixed name resolution
    if (!name.includes(NS_SEP)) {
      const resolved = this.tryUnprefixedLookup(name, userId, toolConfig);
      if (resolved) {
        console.log(`[ToolRegistry] COMPAT_SHIM resolved: "${name}" → "${resolved.definition.name}"`);
        return this.executeWithTimeout(resolved.execute(input), timeout, toolUseId, resolved.definition.name);
      }

      // Ambiguous or disabled hints
      const errorMsg = this.getResolutionError(name, userId, toolConfig);
      if (errorMsg) return { toolUseId, content: errorMsg, isError: true };
    }

    // 4. Not found
    console.warn(`[ToolRegistry] Tool not found: ${name} (user: ${userId})`);
    return { toolUseId, content: `Unknown tool: ${name}`, isError: true };
  }

  /**
   * Migrate old unprefixed enabledTools to prefixed format.
   * Called ONCE at config load time (not per-call). Cache the result.
   *
   * Security: Never auto-expand access on ambiguity.
   *
   * @param oldDelegateId — the old preferredDelegateId from config, if any
   */
  migrateEnabledTools(
    enabledTools: string[] | null,
    userId: string,
    oldDelegateId?: string | null
  ): { tools: string[] | null; warnings: string[] } {
    if (!enabledTools) return { tools: null, warnings: [] };

    const migrated: string[] = [];
    const warnings: string[] = [];
    const oldPrefix = oldDelegateId?.trim().toLowerCase();

    for (const toolName of enabledTools) {
      if (toolName.includes(NS_SEP)) {
        migrated.push(toolName); // already prefixed
        continue;
      }

      // Global tools stay unprefixed
      if (this.serverTools.has(`server:${toolName}`)) {
        migrated.push(toolName);
        continue;
      }

      // If old config had preferredDelegateId, use it as hint
      if (oldPrefix) {
        const prefixed = `${oldPrefix}${NS_SEP}${toolName}`;
        const key = `${userId}:${prefixed}`;
        if (this.delegateTools.has(key)) {
          migrated.push(prefixed);
          continue;
        }
      }

      // Find candidates: delegate tools ending with __{toolName}
      const candidates: string[] = [];
      const userPrefix = `${userId}:`;
      for (const [key, tool] of this.delegateTools) {
        if (key.startsWith(userPrefix) && key.endsWith(`${NS_SEP}${toolName}`)) {
          candidates.push(tool.definition.name);
        }
      }

      if (candidates.length === 1) {
        migrated.push(candidates[0]); // unambiguous auto-resolve
      } else if (candidates.length > 1) {
        // AMBIGUOUS — DO NOT expand access. Leave disabled, warn user.
        warnings.push(`"${toolName}" is ambiguous (${candidates.join(', ')}). Please choose in settings.`);
      } else {
        migrated.push(toolName); // no candidates — keep (may be stale, harmless)
      }
    }

    return { tools: [...new Set(migrated)], warnings };
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

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

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

    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<ToolResult>((resolve) => {
      timer = setTimeout(() => {
        Logger.warn(`[ToolRegistry] Tool "${toolName}" timed out waiting for result after ${timeoutMs}ms (correlation: ${correlationId})`);
        resolve({
          toolUseId,
          content: `Tool "${toolName}" timed out waiting for result after ${timeoutMs}ms`,
          isError: true
        });
      }, timeoutMs);
    });

    const result = await Promise.race([
      promise.then(r => ({ ...r, toolUseId })),
      timeoutPromise,
    ]);

    clearTimeout(timer!);
    return result;
  }

  /**
   * Compat shim: try to resolve an unprefixed tool name.
   * Returns the tool if exactly one allowed candidate exists, null otherwise.
   */
  private tryUnprefixedLookup(name: string, userId: string, toolConfig?: ToolConfig): RegisteredTool | null {
    const candidates: RegisteredTool[] = [];

    const userPrefix = `${userId}:`;
    const suffix = `${NS_SEP}${name}`;
    for (const [key, tool] of this.delegateTools) {
      if (key.startsWith(userPrefix) && key.endsWith(suffix)) {
        if (this.isToolAllowedForParticipant(tool.definition.name, toolConfig)) {
          candidates.push(tool);
        }
      }
    }

    return candidates.length === 1 ? candidates[0] : null;
  }

  /**
   * Generate a helpful error message for unprefixed tool resolution failures.
   */
  private getResolutionError(name: string, userId: string, toolConfig?: ToolConfig): string | null {
    const allCandidates: string[] = [];
    const allowedCandidates: string[] = [];

    const userPrefix = `${userId}:`;
    const suffix = `${NS_SEP}${name}`;
    for (const [key, tool] of this.delegateTools) {
      if (key.startsWith(userPrefix) && key.endsWith(suffix)) {
        allCandidates.push(tool.definition.name);
        if (this.isToolAllowedForParticipant(tool.definition.name, toolConfig)) {
          allowedCandidates.push(tool.definition.name);
        }
      }
    }

    if (allowedCandidates.length > 1) {
      console.log(`[ToolRegistry] COMPAT_SHIM ambiguous: "${name}" → [${allowedCandidates.join(', ')}]`);
      return `Ambiguous tool "${name}". Use full name: ${allowedCandidates.join(' or ')}`;
    }

    if (allCandidates.length > 0 && allowedCandidates.length === 0) {
      return `Tool "${name}" exists but is disabled. Enable one of: ${allCandidates.sort().join(', ')}`;
    }

    return null;
  }
}

export const toolRegistry = new ToolRegistry();
