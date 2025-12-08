import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../database/index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

// Admin-only middleware - checks for admin capability
function requireAdmin(db: Database) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const isAdmin = await db.userHasActiveGrantCapability(req.userId, 'admin');
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    next();
  };
}

const GrantCapabilitySchema = z.object({
  capability: z.enum(['admin', 'mint', 'send', 'overspend', 'researcher']),
  action: z.enum(['grant', 'revoke'])
});

const GrantCreditsSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().min(1).max(50),
  reason: z.string().max(200).optional()
});

export interface UserWithStats {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  lastActive?: string;
  conversationCount: number;
  messageCount: number;
  capabilities: string[];
  balances: Record<string, number>;
}

export function adminRouter(db: Database): Router {
  const router = Router();

  // All admin routes require authentication + admin capability
  router.use(authenticateToken);
  router.use(requireAdmin(db));

  // GET /admin/users - List all users with stats
  router.get('/users', async (req: AuthRequest, res) => {
    try {
      const users = await db.getAllUsersWithStats();
      res.json({ users });
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  // GET /admin/users/:id - Get detailed user info
  router.get('/users/:id', async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = await db.getUserById(id);
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const stats = await db.getUserStats(id);
      const grantSummary = await db.getUserGrantSummary(id);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          createdAt: user.createdAt
        },
        stats,
        grants: grantSummary
      });
    } catch (error) {
      console.error('Error fetching user:', error);
      res.status(500).json({ error: 'Failed to fetch user' });
    }
  });

  // POST /admin/users/:id/capabilities - Grant or revoke a capability
  router.post('/users/:id/capabilities', async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { capability, action } = GrantCapabilitySchema.parse(req.body);

      const user = await db.getUserById(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      await db.recordGrantCapability({
        id: uuidv4(),
        time: new Date().toISOString(),
        userId: id,
        action: action === 'grant' ? 'granted' : 'revoked',
        capability: capability as any,
        grantedByUserId: req.userId!
      });

      // Invalidate user cache so changes take effect immediately
      await db.invalidateUserCache(id);

      res.json({ 
        success: true, 
        message: `Capability '${capability}' ${action}ed for user ${user.email}` 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: error.errors });
      }
      console.error('Error updating capability:', error);
      res.status(500).json({ error: 'Failed to update capability' });
    }
  });

  // POST /admin/users/:id/credits - Grant credits to a user
  router.post('/users/:id/credits', async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { amount, currency, reason } = GrantCreditsSchema.parse(req.body);

      const user = await db.getUserById(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      await db.recordGrantInfo({
        id: uuidv4(),
        time: new Date().toISOString(),
        type: 'mint',
        amount,
        toUserId: id,
        reason: reason || `Admin grant by ${req.userId}`,
        currency
      });

      res.json({ 
        success: true, 
        message: `Granted ${amount} ${currency} to ${user.email}` 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: error.errors });
      }
      console.error('Error granting credits:', error);
      res.status(500).json({ error: 'Failed to grant credits' });
    }
  });

  // POST /admin/users/:id/reload - Force reload user data from disk
  router.post('/users/:id/reload', async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      
      const user = await db.getUserById(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      await db.invalidateUserCache(id);
      
      res.json({ 
        success: true, 
        message: `Reloaded user data for ${user.email}` 
      });
    } catch (error) {
      console.error('Error reloading user:', error);
      res.status(500).json({ error: 'Failed to reload user' });
    }
  });

  // GET /admin/stats - Get system-wide statistics
  router.get('/stats', async (req: AuthRequest, res) => {
    try {
      const stats = await db.getSystemStats();
      res.json(stats);
    } catch (error) {
      console.error('Error fetching system stats:', error);
      res.status(500).json({ error: 'Failed to fetch system stats' });
    }
  });

  return router;
}

