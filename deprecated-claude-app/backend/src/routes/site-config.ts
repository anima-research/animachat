import { Router, Request, Response } from 'express';
import { SiteConfigLoader } from '../config/site-config-loader.js';

const router = Router();

/**
 * GET /api/site-config
 * Returns the site configuration for the frontend
 * This is public (no auth required) as it contains no sensitive data
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const configLoader = SiteConfigLoader.getInstance();
    const config = await configLoader.getConfig();
    
    res.json(config);
  } catch (error) {
    console.error('[SiteConfig] Error loading config:', error);
    res.status(500).json({ error: 'Failed to load site configuration' });
  }
});

/**
 * POST /api/site-config/reload
 * Reloads the site configuration from disk (admin only)
 */
router.post('/reload', async (req: Request, res: Response) => {
  try {
    // Check if user is admin (if auth is present)
    const user = (req as any).user;
    if (user && !user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const configLoader = SiteConfigLoader.getInstance();
    const config = await configLoader.reloadConfig();
    
    console.log('[SiteConfig] Configuration reloaded');
    res.json({ success: true, config });
  } catch (error) {
    console.error('[SiteConfig] Error reloading config:', error);
    res.status(500).json({ error: 'Failed to reload site configuration' });
  }
});

export default router;

