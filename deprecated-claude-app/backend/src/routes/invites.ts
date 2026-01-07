import { Router } from 'express';
import { Database } from '../database/index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import crypto from 'crypto';

function generateInviteCode(): string {
  // Generate a random 8-character alphanumeric code
  return crypto.randomBytes(4).toString('hex');
}

export function createInvitesRouter(db: Database): Router {
  const router = Router();

  // Create an invite (requires mint capability)
  router.post('/', authenticateToken, async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Check if user has mint capability
      const hasMint = await db.userHasActiveGrantCapability(req.userId, 'mint');
      const hasAdmin = await db.userHasActiveGrantCapability(req.userId, 'admin');
      if (!hasMint && !hasAdmin) {
        return res.status(403).json({ error: 'Mint capability required to create invites' });
      }

      const schema = z.object({
        code: z.string().min(1).max(50).optional(),
        amount: z.number().positive(),
        currency: z.string().min(1).max(50).default('credit'),
        expiresInDays: z.number().positive().optional(),
        maxUses: z.number().positive().optional() // undefined = unlimited uses
      });

      const data = schema.parse(req.body);
      const code = data.code || generateInviteCode();
      
      // Check if code already exists
      if (db.getInvite(code)) {
        return res.status(400).json({ error: 'Invite code already exists' });
      }

      const expiresAt = data.expiresInDays 
        ? new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined;

      const invite = await db.createInvite(
        code,
        req.userId,
        data.amount,
        data.currency,
        expiresAt,
        data.maxUses
      );

      res.json({
        code: invite.code,
        amount: invite.amount,
        currency: invite.currency,
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses,
        useCount: invite.useCount ?? 0,
        createdAt: invite.createdAt
      });
    } catch (error) {
      console.error('Error creating invite:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to create invite' });
    }
  });

  // List invites created by the current user
  router.get('/', authenticateToken, async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const invites = db.listInvitesByCreator(req.userId);
      res.json(invites);
    } catch (error) {
      console.error('Error listing invites:', error);
      res.status(500).json({ error: 'Failed to list invites' });
    }
  });

  // Check if an invite code is valid (public endpoint for UI validation)
  router.get('/:code/check', async (req, res) => {
    try {
      const { code } = req.params;
      const validation = db.validateInvite(code);

      if (validation.valid && validation.invite) {
        res.json({
          valid: true,
          amount: validation.invite.amount,
          currency: validation.invite.currency
        });
      } else {
        res.json({
          valid: false,
          error: validation.error
        });
      }
    } catch (error) {
      console.error('Error checking invite:', error);
      res.status(500).json({ error: 'Failed to check invite' });
    }
  });

  // Claim an invite (authenticated users)
  router.post('/claim', authenticateToken, async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const schema = z.object({
        code: z.string().min(1)
      });

      const { code } = schema.parse(req.body);

      // Validate first to get the invite details for the response
      const validation = db.validateInvite(code);
      if (!validation.valid || !validation.invite) {
        return res.status(400).json({ error: validation.error || 'Invalid invite' });
      }

      const invite = validation.invite;
      await db.claimInvite(code, req.userId);

      res.json({
        success: true,
        amount: invite.amount,
        currency: invite.currency
      });
    } catch (error) {
      console.error('Error claiming invite:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request data', details: error.errors });
      }
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to claim invite' });
    }
  });

  return router;
}

