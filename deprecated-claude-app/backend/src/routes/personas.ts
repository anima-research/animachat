import { Router } from 'express';
import { z } from 'zod';
import { Database } from '../database/index.js';
import { AuthRequest } from '../middleware/auth.js';
import { roomManager } from '../websocket/room-manager.js';
import {
  CreatePersonaRequestSchema,
  UpdatePersonaRequestSchema,
  PersonaJoinRequestSchema,
  PersonaLeaveRequestSchema,
  ForkHistoryBranchRequestSchema,
  SharePersonaRequestSchema,
  PersonaPermissionSchema
} from '@deprecated-claude/shared';

const UpdateLogicalTimeSchema = z.object({
  logicalStart: z.number(),
  logicalEnd: z.number()
});

const SetCanonicalBranchSchema = z.object({
  branchId: z.string().uuid()
});

const UpdateShareSchema = z.object({
  permission: PersonaPermissionSchema
});

export function personaRouter(db: Database): Router {
  const router = Router();

  // ============== Persona CRUD ==============

  // Create persona
  router.post('/', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = CreatePersonaRequestSchema.parse(req.body);
      const persona = await db.createPersona(req.userId, data);
      res.status(201).json(persona);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Create persona error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // List owned + shared personas
  router.get('/', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const personas = await db.getUserAccessiblePersonas(req.userId);
      res.json(personas);
    } catch (error) {
      console.error('List personas error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get persona details
  router.get('/:id', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const persona = await db.getPersona(req.params.id);
      if (!persona) {
        return res.status(404).json({ error: 'Persona not found' });
      }

      // Check access
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (!permission) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json(persona);
    } catch (error) {
      console.error('Get persona error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Update persona
  router.patch('/:id', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = UpdatePersonaRequestSchema.parse(req.body);

      // Check editor permission
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (!permission || !['editor', 'owner'].includes(permission)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const persona = await db.updatePersona(req.params.id, req.userId, data);
      if (!persona) {
        return res.status(404).json({ error: 'Persona not found' });
      }

      res.json(persona);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Update persona error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Delete persona
  router.delete('/:id', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Check owner permission
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (permission !== 'owner') {
        return res.status(403).json({ error: 'Only owner can delete persona' });
      }

      const success = await db.deletePersona(req.params.id, req.userId);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Persona not found' });
      }
    } catch (error) {
      console.error('Delete persona error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Archive persona
  router.post('/:id/archive', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Check editor permission
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (!permission || !['editor', 'owner'].includes(permission)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const success = await db.archivePersona(req.params.id, req.userId);
      if (!success) {
        return res.status(404).json({ error: 'Persona not found' });
      }

      const persona = await db.getPersona(req.params.id);
      res.json(persona);
    } catch (error) {
      console.error('Archive persona error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ============== History Branches ==============

  // List history branches
  router.get('/:id/branches', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Check access
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (!permission) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const branches = await db.getPersonaHistoryBranches(req.params.id);
      res.json(branches);
    } catch (error) {
      console.error('List branches error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Create new branch (fork)
  router.post('/:id/branches', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = ForkHistoryBranchRequestSchema.parse(req.body);

      // Check editor permission
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (!permission || !['editor', 'owner'].includes(permission)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const branch = await db.createPersonaHistoryBranch(req.params.id, req.userId, data);
      if (!branch) {
        return res.status(403).json({ error: 'Access denied' });
      }
      res.status(201).json(branch);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Fork branch error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Set branch as HEAD
  router.post('/:id/branches/:branchId/head', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Check editor permission
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (!permission || !['editor', 'owner'].includes(permission)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const success = await db.setPersonaHeadBranch(req.params.id, req.userId, req.params.branchId);
      if (!success) {
        return res.status(404).json({ error: 'Branch not found or access denied' });
      }

      const branch = db.getPersonaHeadBranch(req.params.id);
      res.json(branch);
    } catch (error) {
      console.error('Set head branch error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ============== Participation ==============

  // Join conversation
  router.post('/:id/join', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = PersonaJoinRequestSchema.parse(req.body);

      // Check user permission (can use persona)
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (!permission || !['user', 'editor', 'owner'].includes(permission)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Verify conversation access
      const conversation = await db.getConversation(data.conversationId, req.userId);
      if (!conversation) {
        return res.status(403).json({ error: 'No access to conversation' });
      }

      const result = await db.personaJoinConversation(req.params.id, data);
      if (!result) {
        return res.status(500).json({ error: 'Failed to join conversation' });
      }

      // Get persona info for the broadcast
      const persona = await db.getPersona(req.params.id);

      // Broadcast to conversation room
      roomManager.broadcastToRoom(data.conversationId, {
        type: 'persona_joined',
        conversationId: data.conversationId,
        persona: persona,
        participant: result.participant,
        participation: result.participation
      });

      res.status(201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      if (error instanceof Error && error.message.includes('already active')) {
        return res.status(409).json({ error: error.message });
      }
      console.error('Join conversation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Leave conversation
  router.post('/:id/leave', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = PersonaLeaveRequestSchema.parse(req.body);

      // Check user permission
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (!permission || !['user', 'editor', 'owner'].includes(permission)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const participation = await db.personaLeaveConversation(req.params.id, data.conversationId);
      if (!participation) {
        return res.status(404).json({ error: 'No active participation found' });
      }

      // Get persona info for the broadcast
      const persona = await db.getPersona(req.params.id);

      // Broadcast to conversation room
      roomManager.broadcastToRoom(data.conversationId, {
        type: 'persona_left',
        conversationId: data.conversationId,
        personaId: req.params.id,
        personaName: persona?.name,
        participantId: participation.participantId,
        participation: participation
      });

      res.json(participation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Leave conversation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // List participations
  router.get('/:id/participations', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Check access
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (!permission) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const branchId = req.query.branchId as string | undefined;
      const participations = await db.getPersonaParticipations(req.params.id, branchId);
      res.json(participations);
    } catch (error) {
      console.error('List participations error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Set canonical branch for participation
  router.patch('/:id/participations/:participationId/canonical', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = SetCanonicalBranchSchema.parse(req.body);

      // Check editor permission
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (!permission || !['editor', 'owner'].includes(permission)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const success = await db.setParticipationCanonicalBranch(
        req.params.participationId,
        req.userId,
        data.branchId
      );
      if (!success) {
        return res.status(404).json({ error: 'Participation not found or access denied' });
      }

      const participation = db.getPersonaParticipation(req.params.participationId);
      res.json(participation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Set canonical branch error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Update logical time for participation
  router.patch('/:id/participations/:participationId/logical-time', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = UpdateLogicalTimeSchema.parse(req.body);

      // Validate logical time values
      if (data.logicalEnd <= data.logicalStart) {
        return res.status(400).json({ error: 'logicalEnd must be greater than logicalStart' });
      }

      // Check editor permission
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (!permission || !['editor', 'owner'].includes(permission)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const success = await db.updateParticipationLogicalTime(
        req.params.participationId,
        req.userId,
        data.logicalStart,
        data.logicalEnd
      );
      if (!success) {
        return res.status(404).json({ error: 'Participation not found or access denied' });
      }

      const participation = db.getPersonaParticipation(req.params.participationId);
      res.json(participation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Update logical time error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ============== Sharing ==============

  // List shares
  router.get('/:id/shares', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Check owner permission
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (permission !== 'owner') {
        return res.status(403).json({ error: 'Only owner can view shares' });
      }

      const shares = await db.getPersonaShares(req.params.id);
      res.json(shares);
    } catch (error) {
      console.error('List shares error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Share persona
  router.post('/:id/shares', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = SharePersonaRequestSchema.parse(req.body);

      // Check owner permission
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (permission !== 'owner') {
        return res.status(403).json({ error: 'Only owner can share persona' });
      }

      // Resolve email to userId
      const targetUser = await db.getUserByEmail(data.email);
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found with that email' });
      }

      const share = await db.sharePersona(req.params.id, req.userId, targetUser.id, data.permission);
      res.status(201).json(share);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Share persona error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Update share
  router.patch('/:id/shares/:shareId', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = UpdateShareSchema.parse(req.body);

      // Check owner permission
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (permission !== 'owner') {
        return res.status(403).json({ error: 'Only owner can modify shares' });
      }

      const share = await db.updatePersonaShare(req.params.shareId, req.userId, data.permission);
      if (!share) {
        return res.status(404).json({ error: 'Share not found' });
      }

      res.json(share);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Update share error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Revoke share
  router.delete('/:id/shares/:shareId', async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Check owner permission
      const permission = await db.getPersonaPermission(req.params.id, req.userId);
      if (permission !== 'owner') {
        return res.status(403).json({ error: 'Only owner can revoke shares' });
      }

      const success = await db.revokePersonaShare(req.params.shareId, req.userId);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Share not found' });
      }
    } catch (error) {
      console.error('Revoke share error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
