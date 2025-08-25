import { Router } from 'express';
import { MODELS } from '@deprecated-claude/shared';

export function modelRouter(): Router {
  const router = Router();

  // Get available models
  router.get('/', (req, res) => {
    res.json(MODELS);
  });

  // Get specific model info
  router.get('/:id', (req, res) => {
    const model = MODELS.find(m => m.id === req.params.id);
    
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    res.json(model);
  });

  return router;
}
