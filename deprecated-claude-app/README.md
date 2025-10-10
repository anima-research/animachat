# Deprecated Claude Models Web Application

A web application that allows users to continue using deprecated Claude models through AWS Bedrock. Import conversations from claude.ai and maintain continuity with AI instances you've bonded with.

## Features

- **Import from claude.ai**: Use the Chrome extension to export complete conversation data including forks and model information
- **Conversation Branching**: Edit messages and regenerate responses create parallel branches, preserving all versions
- **Stepped Rolling Context**: Optimized context management for better prompt caching benefits
- **Multiple Model Support**: Access current Claude models via Anthropic API and deprecated models via AWS Bedrock
- **Real-time Streaming**: WebSocket-based streaming for responsive interactions
- **API Key Management**: Use your own AWS Bedrock credentials or pay at cost
- **Export/Import**: Full conversation backup and restore functionality
- **Modern UI**: Dark mode support with Vuetify Material Design

## Architecture

```
deprecated-claude-app/
├── backend/          # Node.js/Express backend with TypeScript
├── frontend/         # Vue 3 + Vuetify frontend
└── shared/          # Shared types and utilities
```

## Prerequisites

- Node.js 18+ and npm
- AWS account with Bedrock access (for Claude models)
- Chrome extension for claude.ai data export (provided separately)

## Setup

1. **Clone and install dependencies:**
```bash
cd deprecated-claude-app
npm install
```

2. **Configure backend environment:**
```bash
cd backend
cp .env.example .env
# Edit .env with your configuration
```

Required environment variables:
- `JWT_SECRET`: Secret key for authentication
- `AWS_REGION`: AWS region with Bedrock access (default: us-east-1)
- `AWS_ACCESS_KEY_ID`: Your AWS access key (optional if using IAM role)
- `AWS_SECRET_ACCESS_KEY`: Your AWS secret key (optional if using IAM role)
- `ANTHROPIC_API_KEY`: Your Anthropic API key for current Claude models (optional)

3. **Start development servers:**
```bash
# From root directory
npm run dev
```

This starts:
- Backend API on http://localhost:3010
- Frontend on http://localhost:5173

## Production Deployment

1. **Build the application:**
```bash
npm run build
```

2. **Backend deployment:**
- Deploy the `backend/dist` folder to your Node.js hosting
- Set environment variables
- Ensure WebSocket support is enabled

3. **Frontend deployment:**
- Deploy `frontend/dist` to static hosting (S3, Netlify, Vercel, etc.)
- Configure API endpoint in environment

## Usage

1. **Create an account** or login with existing credentials
2. **Add API keys** in Settings > API Keys
3. **Import conversations** from claude.ai using the Import button
4. **Continue conversations** with full branching support

### Conversation Features

- **Edit messages**: Click the edit icon to modify any user message
- **Regenerate responses**: Get alternative AI responses without losing originals
- **Branch navigation**: Use left/right arrows to switch between versions
- **Export conversations**: Download full conversation data as JSON

## Smoke Test with k6

1. **Start the backend with an isolated datastore (optional but recommended):**
   ```bash
   cd deprecated-claude-app
   DATABASE_ROOT=./tmp/k6-data npm run dev:backend
   ```
   The `DATABASE_ROOT` (or `DB_ROOT`) environment variable directs the `Database` to a temporary folder so smoke tests do not mutate real data.
2. **Execute the smoke test from another terminal:**
   ```bash
   cd deprecated-claude-app
   k6 run backend/scripts/k6-smoke-test.js \
     --env BASE_URL=http://localhost:3010/api \
     --env TEST_EMAIL=test@example.com \
     --env TEST_PASSWORD=password123 \
     --env TEST_MODEL_ID=mock-claude-local
   ```
   The default `mock-claude-local` model streams text locally so you can test end-to-end flows without talking to a real provider. Override the environment variables to target a different deployment, account, or model as needed.
3. **Review the k6 summary output** and resolve any failed checks before increasing load.

## Load Test with k6

1. **Launch the backend against disposable data:**
   ```bash
   DATABASE_ROOT=./tmp/load-test-data npm run dev:backend
   ```
2. **Run the load script with ramping options:**
   ```bash
   k6 run backend/scripts/k6-load-test.js \
     --env BASE_URL=http://localhost:3010/api \
     --env TEST_EMAIL=test@example.com \
     --env TEST_PASSWORD=password123 \
     --env USE_WEBSOCKET=true \
     --env START_RATE=20 \
     --env PRE_VUS=120 \
     --env MAX_VUS=400 \
     --env STAGES='[{"target":100,"duration":"2m"},{"target":200,"duration":"2m"},{"target":300,"duration":"2m"},{"target":0,"duration":"1m"}]'
   ```
   `USE_WEBSOCKET=true` exercises the chat WebSocket path (sending a message, streaming the mock response, regenerating an alternate branch). Set `USE_WEBSOCKET=false` to import a small conversation and drive the same branch-swapping flow via pure HTTP, which is useful for isolating HTTP vs. WebSocket bottlenecks. Adjust the arrival rate, virtual users, or stages to explore higher load or longer burn-in periods. The script aborts automatically once any request fails or the latency thresholds are crossed, so you can incrementally increase the ramp until the run stops.
3. **Watch the backend logs and resource usage** during the run to spot failure thresholds or saturation points.

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create new account
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Conversations
- `GET /api/conversations` - List conversations
- `POST /api/conversations` - Create conversation
- `GET /api/conversations/:id` - Get conversation details
- `PATCH /api/conversations/:id` - Update conversation
- `POST /api/conversations/:id/duplicate` - Duplicate conversation
- `POST /api/conversations/:id/archive` - Archive conversation
- `GET /api/conversations/:id/messages` - Get messages
- `POST /api/conversations/import` - Import conversation

### WebSocket Events
- `chat` - Send new message
- `regenerate` - Regenerate response
- `edit` - Edit message
- `stream` - Receive streaming response

## Security Considerations

- API keys are encrypted at rest
- JWT authentication for all API endpoints
- WebSocket connections require valid token
- User data isolation per instance

## Development

### Tech Stack
- **Backend**: Node.js, Express, TypeScript, AWS SDK
- **Frontend**: Vue 3, Vuetify, TypeScript, Vite
- **Database**: In-memory with append-only event log
- **Real-time**: WebSockets for streaming

### Adding New Models

1. Add model definition to `shared/src/index.ts`
2. Update Bedrock service with model mapping
3. Models automatically appear in UI

## License

This project is for educational and personal use. Ensure compliance with AWS Bedrock terms of service and Anthropic's usage policies.
# Test deployment Fri Aug 29 23:55:51 EDT 2025
# Webhook test Sat Aug 30 00:04:41 EDT 2025
# Final deployment test Sat Aug 30 00:07:41 EDT 2025
# Test clean build Sat Aug 30 00:09:59 EDT 2025
# Test clean build Sat Aug 30 00:10:40 EDT 2025
# Test clean build Sat Aug 30 00:14:52 EDT 2025
# Debug test Sat Aug 30 00:18:26 EDT 2025
# Debug test Sat Aug 30 00:19:15 EDT 2025
# Debug test Sat Aug 30 00:25:48 EDT 2025
# Webhook test Sat Aug 30 00:28:17 EDT 2025
# Webhook test Sat Aug 30 00:38:05 EDT 2025
# Webhook test Sat Aug 30 00:42:19 EDT 2025
# Webhook test Sat Aug 30 00:44:19 EDT 2025
# Webhook test Sat Aug 30 00:56:31 EDT 2025
# Webhook test Sat Aug 30 01:00:11 EDT 2025
# Webhook test Sat Aug 30 01:05:27 EDT 2025
# Webhook test Sat Aug 30 01:07:22 EDT 2025
# Webhook test Sat Aug 30 01:09:03 EDT 2025
# Webhook test Sat Aug 30 01:10:46 EDT 2025
# Webhook test Sat Aug 30 01:13:22 EDT 2025
# Webhook test Sat Aug 30 01:13:41 EDT 2025
# Webhook test Sat Aug 30 01:15:40 EDT 2025
# Webhook test Sat Aug 30 01:18:32 EDT 2025
# Webhook test Sat Aug 30 01:19:15 EDT 2025
# Webhook test Sat Aug 30 01:21:38 EDT 2025
# Webhook test Sat Aug 30 01:27:40 EDT 2025
# Webhook test Sat Aug 30 01:30:37 EDT 2025
# Webhook test Sat Aug 30 01:33:26 EDT 2025
# Trigger GitHub Actions deployment
# Trigger deployment after sudoers fix
