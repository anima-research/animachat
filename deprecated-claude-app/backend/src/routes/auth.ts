import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../database/index.js';
import { generateToken, authenticateToken, AuthRequest } from '../middleware/auth.js';
import { ConfigLoader } from '../config/loader.js';
import { ModelLoader } from '../config/model-loader.js';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string()
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

const GrantTransferSchema = z.object({
  email: z.string().email(),
  amount: z.coerce.number().positive(),
  reason: z.string().trim().max(200).optional(),
  currency: z.string().trim().max(50).optional()
});

export function authRouter(db: Database): Router {
  const router = Router();
  const modelLoader = ModelLoader.getInstance();

  async function userHasAnyCapability(userId: string, capabilities: Array<'send'|'mint'|'admin'|'overspend'>): Promise<boolean> {
    for (const capability of capabilities) {
      if (await db.userHasActiveGrantCapability(userId, capability)) return true;
    }
    return false;
  }

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

      // Grant initial credits from config
      const config = await ConfigLoader.getInstance().loadConfig();
      const initialGrants = (config as any).initialGrants || {};
      
      for (const [currency, amount] of Object.entries(initialGrants)) {
        if (typeof amount === 'number' && amount > 0) {
          await db.recordGrantInfo({
            id: uuidv4(),
            time: new Date().toISOString(),
            type: 'mint',
            amount: amount,
            toUserId: user.id,
            reason: `Welcome credits: ${currency}`,
            currency: currency
          });
        }
      }

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

  async function collectAvailableCurrencies(): Promise<string[]> {
    const models = await modelLoader.loadModels();
    const currencies = new Set<string>(['credit']);
    for (const model of models) {
      if (!model?.currencies) continue;
      for (const [currency, enabled] of Object.entries(model.currencies)) {
        if (!enabled) continue;
        const trimmed = currency.trim();
        if (trimmed) currencies.add(trimmed);
      }
    }
    return Array.from(currencies).sort((a, b) => a.localeCompare(b));
  }

  router.get('/grants', authenticateToken, async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const summary = await db.getUserGrantSummary(req.userId);
      const availableCurrencies = await collectAvailableCurrencies();
      res.json({
        ...summary,
        availableCurrencies
      });
    } catch (error) {
      console.error('Get grants error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/users/lookup', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const emailInput = req.query.email;
      if (typeof emailInput !== 'string') {
        return res.status(400).json({ error: 'Email is required' });
      }
      const parsed = z.string().email().safeParse(emailInput);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid email' });
      }
      const user = await db.getUserByEmail(parsed.data);
      if (!user) {
        return res.json({ exists: false });
      }
      res.json({ exists: true, user: { id: user.id, email: user.email, name: user.name } });
    } catch (error) {
      console.error('Lookup user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/grants/mint', authenticateToken, async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = GrantTransferSchema.parse(req.body);
      if (!await userHasAnyCapability(req.userId, ['mint', 'admin'])) {
        return res.status(403).json({ error: 'Mint capability required' });
      }

      const recipient = await db.getUserByEmail(data.email);
      if (!recipient) {
        return res.status(404).json({ error: 'Recipient not found' });
      }

      await db.recordGrantInfo({
        id: uuidv4(),
        time: new Date().toISOString(),
        type: 'mint',
        amount: data.amount,
        fromUserId: req.userId,
        toUserId: recipient.id,
        reason: data.reason?.trim() || undefined,
        currency: data.currency?.trim() || 'credit'
      });

      res.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Mint grant error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/grants/send', authenticateToken, async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = GrantTransferSchema.parse(req.body);
      if (!await userHasAnyCapability(req.userId, ['send', 'admin'])) {
        return res.status(403).json({ error: 'Send capability required' });
      }

      const receiver = await db.getUserByEmail(data.email);
      if (!receiver) {
        return res.status(404).json({ error: 'Receiver not found' });
      }

      await db.recordGrantInfo({
        id: uuidv4(),
        time: new Date().toISOString(),
        type: 'send',
        amount: data.amount,
        fromUserId: req.userId,
        toUserId: receiver.id,
        reason: data.reason?.trim() || undefined,
        currency: data.currency?.trim() || 'credit'
      });

      res.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Send grant error:', error);
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
