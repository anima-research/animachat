import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { authRouter } from './routes/auth.js';
import { conversationRouter } from './routes/conversations.js';
import { modelRouter } from './routes/models.js';
import { websocketHandler } from './websocket/handler.js';
import { Database } from './database/index.js';
import { authenticateToken } from './middleware/auth.js';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Initialize database
const db = new Database();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRouter(db));
app.use('/api/conversations', authenticateToken, conversationRouter(db));
app.use('/api/models', authenticateToken, modelRouter());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WebSocket handling
wss.on('connection', (ws, req) => {
  websocketHandler(ws, req, db);
});

const PORT = process.env.PORT || 3010;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready`);
});
