import { Router } from 'express';
import { ConfigLoader } from '../config/loader.js';

export function systemRouter(): Router {
  const router = Router();
  const configLoader = ConfigLoader.getInstance();

  // Get system configuration (public data only)
  router.get('/config', async (req, res) => {
    try {
      const config = await configLoader.loadConfig();
      
      // Only send safe/public configuration data
      const publicConfig = {
        features: config.features,
        groupChatSuggestedModels: config.groupChatSuggestedModels || [],
        defaultModel: config.defaultModel || 'claude-3-5-sonnet-20241022'
      };
      
      res.json(publicConfig);
    } catch (error) {
      console.error('Error loading system config:', error);
      res.status(500).json({ error: 'Failed to load system configuration' });
    }
  });

  return router;
}
