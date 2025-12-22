/**
 * Centralized error and warning messages for Arc Chat
 * 
 * This file serves as a single source of truth for user-facing error messages.
 * Review and update wording here before deploying.
 * 
 * Categories:
 * - API_KEY: Missing or invalid API key errors
 * - PRICING: Cost calculation and pricing errors  
 * - MODEL: Model configuration and lookup errors
 * - SERVER: Server startup and configuration errors
 * - WEBSOCKET: Real-time communication errors
 */

// =============================================================================
// API KEY ERRORS
// =============================================================================

export const API_KEY_ERRORS = {
  ANTHROPIC_MISSING: 
    '⚠️ API KEY ERROR: No Anthropic API key provided. Set ANTHROPIC_API_KEY environment variable or configure user API keys. API calls will fail.',
  
  OPENROUTER_MISSING: 
    '⚠️ API KEY ERROR: No OpenRouter API key provided. Set OPENROUTER_API_KEY environment variable or configure user API keys. OpenRouter API calls will fail.',
  
  GEMINI_MISSING: 
    '⚠️ API KEY ERROR: No Gemini API key provided. Set GEMINI_API_KEY environment variable or configure user API keys. Gemini API calls will fail.',
  
  BEDROCK_MISSING:
    '⚠️ API KEY ERROR: No AWS credentials configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables. Bedrock API calls will fail.',
};

// =============================================================================
// PRICING ERRORS
// =============================================================================

export const PRICING_ERRORS = {
  NO_INPUT_PRICE: (modelId: string, providerModelId: string | undefined, provider: string) =>
    `⚠️ PRICING ERROR: No input price found for model "${modelId}" (provider: "${providerModelId}", type: ${provider}). Using $0 - configure in Admin panel, use OpenRouter model list, or add to hardcoded table.`,
  
  NO_OUTPUT_PRICE: (modelId: string, providerModelId: string | undefined, provider: string) =>
    `⚠️ PRICING ERROR: No output price found for model "${modelId}" (provider: "${providerModelId}", type: ${provider}). Using $0 - configure in Admin panel, use OpenRouter model list, or add to hardcoded table.`,
  
  OPENROUTER_CACHE_FAILED: [
    '⚠️ PRICING WARNING: Failed to pre-populate OpenRouter pricing cache.',
    '   OpenRouter models will show $0 cost until the cache is populated.',
    '   This usually means OPENROUTER_API_KEY is not set or invalid.',
  ],
};

// =============================================================================
// MODEL ERRORS
// =============================================================================

export const MODEL_ERRORS = {
  NOT_FOUND: (modelId: string) =>
    `Model ${modelId} not found`,
  
  UNKNOWN_PROVIDER: (provider: string) =>
    `Unknown provider: ${provider}`,
  
  UNSUPPORTED_PROVIDER: (provider: string) =>
    `Unsupported provider: ${provider}`,
  
  CONFIG_FALLBACK: (model: string) =>
    `⚠️ MODEL WARNING: Model "${model}" not found in config. Using generic defaults (temperature: 1.0, maxTokens: 4096). This may cause issues with pricing or model-specific features.`,
  
  THINKING_NOT_SUPPORTED: (modelId: string) =>
    `[Gemini API] ⚠️ Thinking requested but model ${modelId} doesn't support it - skipping thinkingConfig`,
};

// =============================================================================
// SERVER ERRORS
// =============================================================================

export const SERVER_ERRORS = {
  SSL_NOT_FOUND: [
    'SSL certificate files not found! Please ensure the following files exist:',
    '  - Certificate: {certPath}',
    '  - Private Key: {keyPath}',
    '',
    'For development, you can generate self-signed certificates with:',
    '  npm run generate-cert',
  ],
  
  STARTUP_FAILED: 'Failed to start server:',
};

// =============================================================================
// USER-FACING ERROR MESSAGES (shown in UI)
// =============================================================================
// These messages are shown to users. Keep them precise and technical for 
// easier debugging. Can be made warmer/friendlier in a future polish pass.
// =============================================================================

export const USER_FACING_ERRORS = {
  MODEL_NOT_FOUND: {
    message: 'Model not found',
    suggestion: 'The selected model may have been removed or is unavailable.',
  },
  
  NO_API_KEY: {
    message: 'No API key configured',
    suggestion: 'Add an API key in Settings → API Keys for this provider.',
  },
  
  RATE_LIMIT: {
    message: 'Rate limit exceeded',
    suggestion: 'Wait a moment and try again, or switch to a different model.',
  },
  
  OVERLOADED: {
    message: 'Service overloaded',
    suggestion: 'The AI provider is experiencing high demand. Try again shortly.',
  },
  
  CONTEXT_TOO_LONG: {
    message: 'Context too long',
    suggestion: 'Start a new conversation or remove some earlier messages.',
  },
  
  INSUFFICIENT_CREDITS: {
    message: 'Insufficient credits',
    suggestion: 'Add more credits or contact an admin for a top-up.',
  },
  
  CONNECTION_ERROR: {
    message: 'Connection error',
    suggestion: 'Check your internet connection and try again.',
  },
  
  GENERIC_ERROR: {
    message: 'Failed to generate response',
    suggestion: 'Please try again. If the problem persists, contact support.',
  },
  
  INVALID_REQUEST: {
    message: 'Invalid request',
    suggestion: 'Check your input and try again.',
  },
  
  AUTHENTICATION_FAILED: {
    message: 'Authentication failed',
    suggestion: 'Check that your API key is valid and has not expired.',
  },
  
  CONTENT_FILTERED: {
    message: 'Content filtered',
    suggestion: 'The AI provider flagged content in the response. Try rephrasing.',
  },
  
  REQUEST_TIMEOUT: {
    message: 'Request timed out',
    suggestion: 'The model took too long to respond. Try again or use a different model.',
  },
  
  SERVER_ERROR: {
    message: 'Model server error',
    suggestion: 'The model server encountered an error. Try again or check the model ID.',
  },
  
  ENDPOINT_NOT_FOUND: {
    message: 'Endpoint not found',
    suggestion: 'Check your custom model configuration - the URL may be incorrect.',
  },
  
  PRICING_NOT_CONFIGURED: {
    message: 'Pricing not configured for this model',
    suggestion: 'Request blocked to prevent untracked charges. Configure pricing in Admin panel or add to hardcoded pricing table.',
  },
};

// =============================================================================
// DEPRECATION WARNINGS
// =============================================================================

export const DEPRECATION_WARNINGS = {
  SET_CONTEXT_STRATEGY: 
    'setContextStrategy is deprecated. Use setContextManagement instead.',
};

// =============================================================================
// SUCCESS MESSAGES
// =============================================================================

export const SUCCESS_MESSAGES = {
  OPENROUTER_CACHE_READY: (count: number) =>
    `✅ OpenRouter pricing cache ready with ${count} models`,
  
  DATABASE_INITIALIZED: 
    'Database initialized',
  
  MODEL_LOADER_INITIALIZED: 
    'ModelLoader initialized with database',
};

