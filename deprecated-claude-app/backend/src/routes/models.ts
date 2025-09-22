import { Router } from 'express';
import { ModelLoader } from '../config/model-loader.js';
import { ModelAccessService } from '../services/model-access.js';
import { AuthRequest } from '../middleware/auth.js';
import { Database } from '../database/index.js';

export function modelRouter(db: Database): Router {
  const router = Router();
  const modelLoader = ModelLoader.getInstance();
  const modelAccessService = ModelAccessService.getInstance();

  // Get available models
  router.get('/', async (req: AuthRequest, res) => {
    try {
      const allModels = await modelLoader.getAllModels();
      
      // Filter models based on user access
      let userEmail = '';
      if (req.userId) {
        const user = await db.getUserById(req.userId);
        userEmail = user?.email || '';
      }
      const modelIds = allModels.map(m => m.id);
      const accessibleModelIds = await modelAccessService.getAccessibleModels(userEmail, modelIds);
      
      // Only return models the user has access to
      const accessibleModels = allModels.filter(m => accessibleModelIds.includes(m.id));
      
      console.log(`User ${userEmail} has access to ${accessibleModels.length}/${allModels.length} models`);
      res.json(accessibleModels);
    } catch (error) {
      console.error('Error loading models:', error);
      res.status(500).json({ error: 'Failed to load models' });
    }
  });

  // Get specific model info
  router.get('/:id', async (req: AuthRequest, res) => {
    try {
      const model = await modelLoader.getModelById(req.params.id);
      
      if (!model) {
        return res.status(404).json({ error: 'Model not found' });
      }

      // Check if user has access to this model
      let userEmail = '';
      if (req.userId) {
        const user = await db.getUserById(req.userId);
        userEmail = user?.email || '';
      }
      const access = await modelAccessService.checkModelAccess(model.id, userEmail);
      
      if (!access.allowed) {
        return res.status(403).json({ error: access.message || 'Access denied' });
      }

      res.json(model);
    } catch (error) {
      console.error('Error loading model:', error);
      res.status(500).json({ error: 'Failed to load model' });
    }
  });

  return router;
}
