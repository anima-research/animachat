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
        groupChatSuggestedModels: config.groupChatSuggestedModels || []
      };
      
      res.json(publicConfig);
    } catch (error) {
      console.error('Error loading system config:', error);
      res.status(500).json({ error: 'Failed to load system configuration' });
    }
  });

  return router;
}
