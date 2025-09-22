import { Router } from 'express';
import { z } from 'zod';
import { Database } from '../database/index.js';
import { generateToken, authenticateToken, AuthRequest } from '../middleware/auth.js';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string()
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

export function authRouter(db: Database): Router {
  const router = Router();

  // Register
  router.post('/register', async (req, res) => {
    try {
      const data = RegisterSchema.parse(req.body);
      
      const existingUser = await db.getUserByEmail(data.email);
      if (existingUser) {
        return res.status(400).json({ error: 'User already exists' });
      }

      const user = await db.createUser(data.email, data.password, data.name);
      const token = generateToken(user.id);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        },
        token
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Login
  router.post('/login', async (req, res) => {
    try {
      const data = LoginSchema.parse(req.body);
      
      const user = await db.getUserByEmail(data.email);
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const validPassword = await db.validatePassword(data.email, data.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = generateToken(user.id);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        },
        token
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get current user
  router.get('/me', authenticateToken, async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const user = await db.getUserById(req.userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        apiKeys: user.apiKeys || []
      });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // API Key management
  router.post('/api-keys', authenticateToken, async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { name, provider, credentials } = req.body;
      
      if (!name || !provider || !credentials) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const apiKey = await db.createApiKey(req.userId, { name, provider, credentials });

      // Create masked version for display
      let masked = '****';
      if ('apiKey' in credentials) {
        masked = '****' + credentials.apiKey.slice(-4);
      } else if ('accessKeyId' in credentials) {
        masked = '****' + credentials.accessKeyId.slice(-4);
      }

      res.json({
        id: apiKey.id,
        name: apiKey.name,
        provider: apiKey.provider,
        masked,
        createdAt: apiKey.createdAt
      });
    } catch (error) {
      console.error('API key creation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/api-keys', authenticateToken, async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const apiKeys = await db.getUserApiKeys(req.userId);
      
      res.json(apiKeys.map(key => {
        // Create masked version for display
        let masked = '****';
        if ('apiKey' in key.credentials) {
          masked = '****' + (key.credentials.apiKey as string).slice(-4);
        } else if ('accessKeyId' in key.credentials) {
          masked = '****' + (key.credentials.accessKeyId as string).slice(-4);
        }
        
        return {
          id: key.id,
          name: key.name,
          provider: key.provider,
          masked,
          createdAt: key.createdAt
        };
      }));
    } catch (error) {
      console.error('Get API keys error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/api-keys/:id', authenticateToken, async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { id } = req.params;
      const didRemove = db.deleteApiKey(id);
      res.json({ success: didRemove });
    } catch (error) {
      console.error('Delete API key error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
