import { Router } from 'express';
import { ModelLoader } from '../config/model-loader.js';
import { OpenRouterService } from '../services/openrouter.js';
import { updateOpenRouterModelsCache, getOpenRouterModelsCache } from '../services/pricing-cache.js';

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export function modelRouter(db: any): Router {
  const router = Router();
  const modelLoader = ModelLoader.getInstance();

  // Get available models (including user's custom models)
  router.get('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const models = await modelLoader.getAllModels(userId);
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

  // Get specific model info (checks user's custom models too)
  router.get('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const model = await modelLoader.getModelById(req.params.id, userId);
      
      if (!model) {
        return res.status(404).json({ error: 'Model not found' });
      }

      res.json(model);
    } catch (error) {
      console.error('Error loading model:', error);
      res.status(500).json({ error: 'Failed to load model' });
    }
  });

  // Get OpenRouter available models with caching
  router.get('/openrouter/available', async (req, res) => {
    try {
      const now = Date.now();
      const cached = getOpenRouterModelsCache();
      
      // Return cached data if still fresh
      if (cached.models.length > 0 && !cached.isStale) {
        console.log('Returning cached OpenRouter models');
        return res.json({
          models: cached.models,
          cached: true,
          cacheAge: now - cached.cacheTime
        });
      }

      // Fetch fresh data
      console.log('Fetching fresh OpenRouter models list');
      const openRouterService = new OpenRouterService(db);
      const models = await openRouterService.listModels();
      
      // Update shared cache (also rebuilds pricing lookup)
      updateOpenRouterModelsCache(models);
      
      res.json({
        models: models,
        cached: false,
        cacheAge: 0
      });
    } catch (error) {
      console.error('Error fetching OpenRouter models:', error);
      
      // If we have cached data, return it even if expired
      const cached = getOpenRouterModelsCache();
      if (cached.models.length > 0) {
        console.log('Returning stale cached data due to error');
        return res.json({
          models: cached.models,
          cached: true,
          cacheAge: Date.now() - cached.cacheTime,
          warning: 'Using cached data due to API error'
        });
      }
      
      res.status(500).json({ error: 'Failed to fetch OpenRouter models' });
    }
  });

  return router;
}
