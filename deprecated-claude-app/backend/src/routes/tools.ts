/**
 * Tools API Routes
 *
 * Provides endpoints for:
 * - GET /api/tools - List all available tools for the authenticated user
 * - GET /api/tools/delegates - List connected delegates for the authenticated user
 * - GET /api/tools/api-keys - List delegate API keys for the authenticated user
 * - POST /api/tools/api-keys - Create a new delegate API key
 * - DELETE /api/tools/api-keys/:keyId - Revoke a delegate API key
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { toolRegistry, ToolRegistry } from '../tools/tool-registry.js';
import { delegateManager, DelegateManager } from '../delegate/delegate-manager.js';
import { Database } from '../database/index.js';

// Extend Express Request to include userId from auth middleware
interface AuthRequest extends Request {
  userId?: string;
}

interface ToolsRouterDeps {
  toolRegistry?: ToolRegistry;
  delegateManager?: DelegateManager;
  db?: Database;
}

// Schema for creating API keys
const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().nullable().optional(),
});

export function toolsRouter(deps: ToolsRouterDeps = {}): Router {
  const registry = deps.toolRegistry ?? toolRegistry;
  const delegates = deps.delegateManager ?? delegateManager;
  // db will be injected from index.ts
  const db = deps.db;
  const router = Router();

  /**
   * GET /api/tools
   * Returns all available tools for the authenticated user (with source info)
   */
  router.get('/', async (req: AuthRequest, res: Response) => {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const tools = registry.getToolsForUserWithSource(req.userId);
    res.json({ tools });
  });

  /**
   * GET /api/tools/delegates
   * Returns connected delegates for the authenticated user
   */
  router.get('/delegates', async (req: AuthRequest, res: Response) => {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userDelegates = delegates.getDelegatesForUser(req.userId);
    res.json({
      delegates: userDelegates.map(d => ({
        delegateId: d.delegateId,
        userId: d.userId,
        tools: d.tools,
        connectedAt: d.connectedAt.toISOString(),
        // Adapter: convert string[] to object (future-proof for when capabilities becomes object)
        capabilities: {
          managedInstall: Array.isArray(d.capabilities)
            ? d.capabilities.includes('managedInstall')
            : (d.capabilities as any)?.managedInstall ?? false,
          canFileAccess: Array.isArray(d.capabilities)
            ? d.capabilities.includes('canFileAccess')
            : (d.capabilities as any)?.canFileAccess ?? false,
          canShellAccess: Array.isArray(d.capabilities)
            ? d.capabilities.includes('canShellAccess')
            : (d.capabilities as any)?.canShellAccess ?? false,
        },
      }))
    });
  });

  // =============================================================================
  // Delegate API Keys
  // =============================================================================

  /**
   * GET /api/tools/api-keys
   * Returns all delegate API keys for the authenticated user
   */
  router.get('/api-keys', async (req: AuthRequest, res: Response) => {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }

    const keys = db.getDelegateApiKeys(req.userId);
    res.json({ keys });
  });

  /**
   * POST /api/tools/api-keys
   * Create a new delegate API key
   * Returns the full secret key only once on creation
   */
  router.post('/api-keys', async (req: AuthRequest, res: Response) => {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }

    // Validate request body
    const parsed = CreateApiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    const { name, expiresAt } = parsed.data;
    const expiresAtDate = expiresAt ? new Date(expiresAt) : null;

    try {
      const result = await db.createDelegateApiKey(req.userId, name, expiresAtDate);

      // Return the key info + secret (only time secret is returned!)
      res.status(201).json({
        key: result.key,
        secretKey: result.secretKey,
        warning: 'Save this key securely! It will not be shown again.',
      });
    } catch (error) {
      console.error('[tools/api-keys] Failed to create API key:', error);
      res.status(500).json({ error: 'Failed to create API key' });
    }
  });

  /**
   * DELETE /api/tools/api-keys/:keyId
   * Revoke a delegate API key
   */
  router.delete('/api-keys/:keyId', async (req: AuthRequest, res: Response) => {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }

    const { keyId } = req.params;

    try {
      const success = await db.revokeDelegateApiKey(req.userId, keyId);

      if (!success) {
        return res.status(404).json({ error: 'API key not found' });
      }

      res.json({ success: true, message: 'API key revoked' });
    } catch (error) {
      console.error('[tools/api-keys] Failed to revoke API key:', error);
      res.status(500).json({ error: 'Failed to revoke API key' });
    }
  });

  return router;
}
