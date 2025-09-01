import { Router } from 'express';
import { ModelLoader } from '../config/model-loader.js';

export function modelRouter(): Router {
  const router = Router();
  const modelLoader = ModelLoader.getInstance();

  // Get available models
  router.get('/', async (req, res) => {
    try {
      const models = await modelLoader.getAllModels();
      console.log('Available models:', models.map(m => ({
        id: m.id,
        providerModelId: m.providerModelId,
        displayName: m.displayName,
        provider: m.provider
      })));
      res.json(models);
    } catch (error) {
      console.error('Error loading models:', error);
      res.status(500).json({ error: 'Failed to load models' });
    }
  });

  // Get specific model info
  router.get('/:id', async (req, res) => {
    try {
      const model = await modelLoader.getModelById(req.params.id);
      
      if (!model) {
        return res.status(404).json({ error: 'Model not found' });
      }

      res.json(model);
    } catch (error) {
      console.error('Error loading model:', error);
      res.status(500).json({ error: 'Failed to load model' });
    }
  });

  return router;
}
