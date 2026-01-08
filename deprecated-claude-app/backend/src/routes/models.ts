import { Router } from 'express';
import { ModelLoader } from '../config/model-loader.js';
import { ConfigLoader } from '../config/loader.js';
import { OpenRouterService } from '../services/openrouter.js';
import { updateOpenRouterModelsCache, getOpenRouterModelsCache } from '../services/pricing-cache.js';

export function modelRouter(db: any): Router {
  const router = Router();
  const modelLoader = ModelLoader.getInstance();
  const configLoader = ConfigLoader.getInstance();

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

  // Get model availability info for the current user
  // Returns which providers have API keys configured (user or admin) and grant currencies
  router.get('/availability', async (req, res) => {
    try {
      const userId = (req as any).userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Get user's API keys
      const userApiKeys = await db.getUserApiKeys(userId);
      const userProviders = new Set(userApiKeys.map((k: any) => k.provider));

      // Get admin-configured providers (those with credentials in config)
      const config = await configLoader.loadConfig();
      const adminProviders = new Set<string>();
      for (const [provider, profiles] of Object.entries(config.providers)) {
        if (Array.isArray(profiles) && profiles.length > 0) {
          // Check if any profile has credentials
          const hasCredentials = profiles.some((p: any) => p.credentials && Object.keys(p.credentials).length > 0);
          if (hasCredentials) {
            adminProviders.add(provider);
          }
        }
      }

      // Get user's grant summary to know which currencies they have
      const grantSummary = await db.getUserGrantSummary(userId);
      const currencies = Object.entries(grantSummary.totals)
        .filter(([_, amount]) => Number(amount) > 0)
        .map(([currency]) => currency);

      // Check if user can overspend (has overspend capability)
      const canOverspend = await db.userHasActiveGrantCapability(userId, 'overspend');

      res.json({
        // Providers where user has their own API key configured
        userProviders: Array.from(userProviders),
        // Providers where admin has configured API keys (subsidized)
        adminProviders: Array.from(adminProviders),
        // Currencies where user has positive balance
        grantCurrencies: currencies,
        // Whether user can use models even without balance
        canOverspend,
        // Combined set of providers user can actually use (either own key or admin key)
        availableProviders: Array.from(new Set([...userProviders, ...adminProviders]))
      });
    } catch (error) {
      console.error('Error getting model availability:', error);
      res.status(500).json({ error: 'Failed to get model availability' });
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
