// Vendored from @deprecated-claude/backend
// Original location: node_modules/@deprecated-claude/backend/src/tools/server-tools.ts

/**
 * Server-side tool definitions
 *
 * Basic utility tools that run on the server.
 * Import this module for side-effect registration.
 */

import { toolRegistry } from './tool-registry.js';
import type { ToolResult } from './tool-registry.js';

// =============================================================================
// get_current_time — Returns the current date and time
// =============================================================================

toolRegistry.registerServerTool(
  'get_current_time',
  {
    name: 'get_current_time',
    description: 'Get the current date and time. Optionally specify a timezone.',
    inputSchema: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone name (e.g., "America/New_York", "Europe/London", "Asia/Tokyo"). Defaults to UTC.',
        },
      },
    },
  },
  async (input): Promise<ToolResult> => {
    const timezone = (input.timezone as string) || 'UTC';
    try {
      const now = new Date();
      const formatted = now.toLocaleString('en-US', {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      });
      return {
        toolUseId: '',
        content: `Current time (${timezone}): ${formatted}`,
        isError: false,
      };
    } catch {
      return {
        toolUseId: '',
        content: `Invalid timezone: ${timezone}. Use IANA timezone names like "America/New_York".`,
        isError: true,
      };
    }
  }
);

// =============================================================================
// echo — Simple echo tool for testing the tool pipeline
// =============================================================================

toolRegistry.registerServerTool(
  'echo',
  {
    name: 'echo',
    description: 'Echo back the input message. Useful for testing tool calling.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to echo back.',
        },
      },
      required: ['message'],
    },
  },
  async (input): Promise<ToolResult> => {
    const message = (input.message as string) || '';
    return {
      toolUseId: '',
      content: `Echo: ${message}`,
      isError: false,
    };
  }
);

console.log('[ServerTools] Registered built-in server tools: get_current_time, echo');
