import express from 'express';
import compression from 'compression';
import { clearOpenRouterLog } from './utils/openrouterLogger.js';

// Clean up old OpenRouter request logs on startup
clearOpenRouterLog();
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { authRouter } from './routes/auth.js';
import { conversationRouter } from './routes/conversations.js';
import { modelRouter } from './routes/models.js';
import { customModelsRouter } from './routes/custom-models.js';
import { participantRouter } from './routes/participants.js';
import { importRouter } from './routes/import.js';
import { systemRouter } from './routes/system.js';
import { createPromptRouter } from './routes/prompt.js';
import { createShareRouter } from './routes/shares.js';
import { publicModelRouter } from './routes/public-models.js';
import { ModelLoader } from './config/model-loader.js';
import { createBookmarksRouter } from './routes/bookmarks.js';
import { createInvitesRouter } from './routes/invites.js';
import { adminRouter } from './routes/admin.js';
import { collaborationRouter } from './routes/collaboration.js';
import { personaRouter } from './routes/personas.js';
import avatarRouter from './routes/avatars.js';
import { websocketHandler } from './websocket/handler.js';
import { Database } from './database/index.js';
import { authenticateToken } from './middleware/auth.js';
import { OpenRouterService } from './services/openrouter.js';
import { updateOpenRouterModelsCache } from './services/pricing-cache.js';

dotenv.config();

const app = express();

// Initialize database
const db = new Database();

// HTTPS configuration
const USE_HTTPS = process.env.USE_HTTPS === 'true';
const PORT = process.env.PORT || 3010;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Create appropriate server
let server: ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;
if (USE_HTTPS) {
  // Check for SSL certificate files
  const certPath = process.env.SSL_CERT_PATH || path.join(process.cwd(), 'certs', 'cert.pem');
  const keyPath = process.env.SSL_KEY_PATH || path.join(process.cwd(), 'certs', 'key.pem');
  const caPath = process.env.SSL_CA_PATH || path.join(process.cwd(), 'certs', 'ca.pem');

  if (!existsSync(certPath) || !existsSync(keyPath)) {
    console.error('SSL certificate files not found! Please ensure the following files exist:');
    console.error(`  - Certificate: ${certPath}`);
    console.error(`  - Private Key: ${keyPath}`);
    console.error('\nFor development, you can generate self-signed certificates with:');
    console.error('  npm run generate-cert');
    process.exit(1);
  }

  // HTTPS options
  const httpsOptions: any = {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath)
  };

  // Include CA bundle if it exists
  if (existsSync(caPath)) {
    httpsOptions.ca = readFileSync(caPath);
  }

  server = createHttpsServer(httpsOptions, app);
} else {
  server = createHttpServer(app);
}

const wss = new WebSocketServer({ 
  server,
  // Enable per-message deflate compression for large messages
  perMessageDeflate: {
    zlibDeflateOptions: {
      // Use maximum compression level for slow connections
      level: 6, // 1-9, higher = more compression but slower
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    },
    // Compress messages larger than 1KB
    threshold: 1024,
    // Don't limit concurrent decompression
    concurrencyLimit: 10,
  }
});
console.log('[WebSocket] Per-message deflate compression enabled (threshold: 1KB)');

// Middleware
// Enable gzip/deflate compression for HTTP responses
app.use(compression({
  // Compress responses larger than 1KB
  threshold: 1024,
  // Compression level (1-9, higher = more compression)
  level: 6,
  // Don't compress if client doesn't support it
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));
console.log('[HTTP] Gzip compression enabled (threshold: 1KB)');

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.use('/api/auth', authRouter(db));
app.use('/api/public/models', publicModelRouter());
app.use('/api/conversations', authenticateToken, conversationRouter(db));
// Mount custom models BEFORE general models to prevent /:id catching /custom
app.use('/api/models/custom', authenticateToken, customModelsRouter(db));
app.use('/api/models', authenticateToken, modelRouter(db));
app.use('/api/participants', authenticateToken, participantRouter(db));
app.use('/api/import', authenticateToken, importRouter(db));
app.use('/api/prompt', createPromptRouter(db));
app.use('/api/shares', createShareRouter(db));
app.use('/api/bookmarks', createBookmarksRouter(db));
app.use('/api/invites', createInvitesRouter(db));
app.use('/api/admin', adminRouter(db));
app.use('/api/collaboration', collaborationRouter(db));
app.use('/api/personas', authenticateToken, personaRouter(db));
app.use('/api/avatars', authenticateToken, avatarRouter);
app.use('/api/system', systemRouter());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WebSocket handling
wss.on('connection', (ws, req) => {
  websocketHandler(ws, req, db);
});

// Start server
async function startServer() {
  try {
    // Initialize database
    await db.init();
    console.log('Database initialized');
    
    // Initialize ModelLoader with database
    const modelLoader = ModelLoader.getInstance();
    modelLoader.setDatabase(db);
    console.log('ModelLoader initialized with database');
    
    // Pre-populate OpenRouter pricing cache
    try {
      console.log('Pre-populating OpenRouter pricing cache...');
      const openRouterService = new OpenRouterService(db);
      const openRouterModels = await openRouterService.listModels();
      updateOpenRouterModelsCache(openRouterModels);
      console.log(`✅ OpenRouter pricing cache ready with ${openRouterModels.length} models`);
    } catch (error: any) {
      console.error('⚠️ PRICING WARNING: Failed to pre-populate OpenRouter pricing cache.');
      console.error('   OpenRouter models will show $0 cost until the cache is populated.');
      console.error('   This usually means OPENROUTER_API_KEY is not set or invalid.');
      console.error('   Error:', error?.message || error);
    }
    
    const listenPort = Number(USE_HTTPS ? HTTPS_PORT : PORT);
    const protocol = USE_HTTPS ? 'HTTPS' : 'HTTP';
    
    const HOST = process.env.HOST || '0.0.0.0';
    server.listen(listenPort, HOST, () => {
      console.log(`${protocol} Server running on ${HOST}:${listenPort}`);
      console.log(`${USE_HTTPS ? 'Secure WebSocket (WSS)' : 'WebSocket'} server ready`);
      if (USE_HTTPS) {
        console.log(`API endpoint: https://${HOST}:${listenPort}/api`);
        console.log(`WebSocket endpoint: wss://${HOST}:${listenPort}`);
      } else {
        console.log(`API endpoint: http://${HOST}:${listenPort}/api`);
        console.log(`WebSocket endpoint: ws://${HOST}:${listenPort}`);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await db.close();
  process.exit(0);
});

startServer();
