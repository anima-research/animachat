import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../database/index.js';
import { generateToken, authenticateToken, AuthRequest } from '../middleware/auth.js';
import { ConfigLoader } from '../config/loader.js';
import { ModelLoader } from '../config/model-loader.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email.js';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string(),
  inviteCode: z.string().optional(),
  tosAgreed: z.boolean().optional(), // User agreed to Terms of Service
  ageVerified: z.boolean().optional() // User confirmed they are 18+
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

const ForgotPasswordSchema = z.object({
  email: z.string().email()
});

const ResetPasswordSchema = z.object({
  token: z.string().uuid(),
  password: z.string().min(8)
});

const ResendVerificationSchema = z.object({
  email: z.string().email()
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

  // Public endpoint to get registration requirements
  router.get('/registration-info', async (req, res) => {
    try {
      const config = await ConfigLoader.getInstance().loadConfig();
      res.json({
        requireInviteCode: (config as any).features?.requireInviteCode === true
      });
    } catch (error) {
      res.json({ requireInviteCode: false });
    }
  });

  // Register - now requires email verification
  router.post('/register', async (req, res) => {
    try {
      const data = RegisterSchema.parse(req.body);
      
      // Check config for invite code requirement
      const config = await ConfigLoader.getInstance().loadConfig();
      const requireInviteCode = (config as any).features?.requireInviteCode === true;
      
      // Validate invite code if required
      if (requireInviteCode) {
        if (!data.inviteCode) {
          return res.status(400).json({ error: 'Invite code is required for registration' });
        }
        const validation = db.validateInvite(data.inviteCode);
        if (!validation.valid) {
          return res.status(400).json({ error: validation.error || 'Invalid invite code' });
        }
      }
      
      const existingUser = await db.getUserByEmail(data.email);
      if (existingUser) {
        return res.status(400).json({ error: 'User already exists' });
      }
      const requireEmailVerification = (config as any).requireEmailVerification !== false && !!process.env.RESEND_API_KEY;
      
      // Create user with emailVerified based on config, and ageVerified/tosAccepted from registration
      const user = await db.createUser(
        data.email, 
        data.password, 
        data.name, 
        !requireEmailVerification,
        data.ageVerified === true, // Pass age verification status
        data.tosAgreed === true // Pass ToS acceptance status
      );

      // Grant initial credits from config
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

      // Claim invite if provided
      let inviteClaimed: { amount: number; currency: string } | null = null;
      if (data.inviteCode) {
        const validation = db.validateInvite(data.inviteCode);
        if (validation.valid && validation.invite) {
          try {
            await db.claimInvite(data.inviteCode, user.id);
            inviteClaimed = { amount: validation.invite.amount, currency: validation.invite.currency };
          } catch (e) {
            // Log but don't fail registration if invite claim fails
            console.error('Failed to claim invite during registration:', e);
          }
        }
      }

      // If email verification is required, send verification email
      if (requireEmailVerification) {
        const verificationToken = await db.createEmailVerificationToken(user.id);
        const emailSent = await sendVerificationEmail(data.email, verificationToken, data.name);
        
        if (!emailSent) {
          console.error('Failed to send verification email, but user was created');
        }
        
        return res.json({
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            emailVerified: false
          },
          requiresVerification: true,
          emailSent, // Let frontend know if initial email was sent
          message: emailSent 
            ? 'Please check your email to verify your account'
            : 'Account created but we could not send the verification email. Please use the resend option.'
        });
      }

      // No verification required - return token for immediate login
      const token = generateToken(user.id);
      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: true
        },
        token,
        inviteClaimed
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  // Verify email
  router.post('/verify-email', async (req, res) => {
    try {
      const { token } = req.body;
      
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'Verification token is required' });
      }
      
      const user = await db.verifyEmail(token);
      
      if (!user) {
        return res.status(400).json({ error: 'Invalid or expired verification token' });
      }
      
      // Generate auth token for immediate login
      const authToken = generateToken(user.id);
      
      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: true
        },
        token: authToken,
        message: 'Email verified successfully'
      });
    } catch (error) {
      console.error('Email verification error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  // Resend verification email
  router.post('/resend-verification', async (req, res) => {
    try {
      const data = ResendVerificationSchema.parse(req.body);
      
      const user = await db.getUserByEmail(data.email);
      if (!user) {
        // Don't reveal if user exists or not
        return res.json({ message: 'If an account exists with this email, a verification link has been sent', sent: true });
      }
      
      if (user.emailVerified) {
        return res.status(400).json({ error: 'Email is already verified' });
      }
      
      const verificationToken = await db.createEmailVerificationToken(user.id);
      const emailSent = await sendVerificationEmail(data.email, verificationToken, user.name);
      
      if (!emailSent) {
        // User exists and is unverified, so they already know they have an account
        // Give them accurate feedback about email delivery failure
        return res.status(500).json({ 
          error: 'Failed to send verification email. Please try again or contact support.',
          sent: false
        });
      }
      
      res.json({ message: 'Verification email sent! Please check your inbox.', sent: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Resend verification error:', error);
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

      // Check if email verification is required
      const config = await ConfigLoader.getInstance().loadConfig();
      const requireEmailVerification = (config as any).requireEmailVerification !== false && !!process.env.RESEND_API_KEY;
      
      if (requireEmailVerification && !user.emailVerified) {
        // Auto-send verification email on login attempt
        const verificationToken = await db.createEmailVerificationToken(user.id);
        const emailSent = await sendVerificationEmail(data.email, verificationToken, user.name);
        
        return res.status(403).json({ 
          error: 'Email not verified',
          requiresVerification: true,
          email: user.email,
          emailSent // Let frontend know if email was actually sent
        });
      }

      const token = generateToken(user.id);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified
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
  
  // Forgot password - request reset email
  router.post('/forgot-password', async (req, res) => {
    try {
      const data = ForgotPasswordSchema.parse(req.body);
      
      const user = await db.getUserByEmail(data.email);
      
      // Always return success to not reveal if email exists
      if (user) {
        const resetToken = await db.createPasswordResetToken(user.id);
        await sendPasswordResetEmail(data.email, resetToken, user.name);
      }
      
      res.json({ message: 'If an account exists with this email, a password reset link has been sent' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Forgot password error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  // Reset password with token
  router.post('/reset-password', async (req, res) => {
    try {
      const data = ResetPasswordSchema.parse(req.body);
      
      const user = await db.resetPassword(data.token, data.password);
      
      if (!user) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
      }
      
      res.json({ message: 'Password reset successfully' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      console.error('Reset password error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  // Validate reset token (to check before showing reset form)
  router.get('/reset-password/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const tokenData = db.getPasswordResetTokenData(token);
      
      if (!tokenData) {
        return res.status(400).json({ valid: false, error: 'Invalid or expired reset token' });
      }
      
      res.json({ valid: true });
    } catch (error) {
      console.error('Validate reset token error:', error);
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
      const config = await ConfigLoader.getInstance().loadConfig();
      const currencyConfig = config.currencies || {};
      
      res.json({
        ...summary,
        availableCurrencies,
        currencyConfig
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
