import { describe, it, expect } from 'vitest';
import {
  API_KEY_ERRORS,
  PRICING_ERRORS,
  MODEL_ERRORS,
  SERVER_ERRORS,
  USER_FACING_ERRORS,
  DEPRECATION_WARNINGS,
  SUCCESS_MESSAGES,
} from './error-messages.js';

describe('API_KEY_ERRORS', () => {
  it('ANTHROPIC_MISSING mentions Anthropic and ANTHROPIC_API_KEY', () => {
    expect(API_KEY_ERRORS.ANTHROPIC_MISSING).toContain('Anthropic');
    expect(API_KEY_ERRORS.ANTHROPIC_MISSING).toContain('ANTHROPIC_API_KEY');
  });

  it('OPENROUTER_MISSING mentions OpenRouter and OPENROUTER_API_KEY', () => {
    expect(API_KEY_ERRORS.OPENROUTER_MISSING).toContain('OpenRouter');
    expect(API_KEY_ERRORS.OPENROUTER_MISSING).toContain('OPENROUTER_API_KEY');
  });

  it('GEMINI_MISSING mentions Gemini and GEMINI_API_KEY', () => {
    expect(API_KEY_ERRORS.GEMINI_MISSING).toContain('Gemini');
    expect(API_KEY_ERRORS.GEMINI_MISSING).toContain('GEMINI_API_KEY');
  });

  it('BEDROCK_MISSING mentions AWS and required environment variables', () => {
    expect(API_KEY_ERRORS.BEDROCK_MISSING).toContain('AWS');
    expect(API_KEY_ERRORS.BEDROCK_MISSING).toContain('AWS_ACCESS_KEY_ID');
    expect(API_KEY_ERRORS.BEDROCK_MISSING).toContain('AWS_SECRET_ACCESS_KEY');
  });

  it('all API key errors include a warning indicator', () => {
    expect(API_KEY_ERRORS.ANTHROPIC_MISSING).toContain('⚠️');
    expect(API_KEY_ERRORS.OPENROUTER_MISSING).toContain('⚠️');
    expect(API_KEY_ERRORS.GEMINI_MISSING).toContain('⚠️');
    expect(API_KEY_ERRORS.BEDROCK_MISSING).toContain('⚠️');
  });

  it('all API key errors indicate calls will fail', () => {
    expect(API_KEY_ERRORS.ANTHROPIC_MISSING).toContain('will fail');
    expect(API_KEY_ERRORS.OPENROUTER_MISSING).toContain('will fail');
    expect(API_KEY_ERRORS.GEMINI_MISSING).toContain('will fail');
    expect(API_KEY_ERRORS.BEDROCK_MISSING).toContain('will fail');
  });
});

describe('PRICING_ERRORS', () => {
  it('NO_INPUT_PRICE includes model ID, provider model ID, and provider type', () => {
    const msg = PRICING_ERRORS.NO_INPUT_PRICE('claude-3', 'claude-3-opus', 'anthropic');
    expect(msg).toContain('claude-3');
    expect(msg).toContain('claude-3-opus');
    expect(msg).toContain('anthropic');
  });

  it('NO_INPUT_PRICE mentions using $0 as fallback', () => {
    const msg = PRICING_ERRORS.NO_INPUT_PRICE('model-x', undefined, 'openrouter');
    expect(msg).toContain('$0');
  });

  it('NO_INPUT_PRICE handles undefined provider model ID', () => {
    const msg = PRICING_ERRORS.NO_INPUT_PRICE('model-x', undefined, 'openrouter');
    expect(msg).toContain('undefined');
    expect(msg).toContain('input price');
  });

  it('NO_OUTPUT_PRICE includes model ID, provider model ID, and provider type', () => {
    const msg = PRICING_ERRORS.NO_OUTPUT_PRICE('gpt-4', 'gpt-4-turbo', 'openai');
    expect(msg).toContain('gpt-4');
    expect(msg).toContain('gpt-4-turbo');
    expect(msg).toContain('openai');
  });

  it('NO_OUTPUT_PRICE mentions output price specifically', () => {
    const msg = PRICING_ERRORS.NO_OUTPUT_PRICE('model-y', 'model-y-v2', 'gemini');
    expect(msg).toContain('output price');
  });

  it('OPENROUTER_CACHE_FAILED is an array of warning lines', () => {
    expect(Array.isArray(PRICING_ERRORS.OPENROUTER_CACHE_FAILED)).toBe(true);
    expect(PRICING_ERRORS.OPENROUTER_CACHE_FAILED.length).toBeGreaterThan(0);
  });

  it('OPENROUTER_CACHE_FAILED mentions OpenRouter and pricing cache', () => {
    const joined = PRICING_ERRORS.OPENROUTER_CACHE_FAILED.join(' ');
    expect(joined).toContain('OpenRouter');
    expect(joined).toContain('pricing cache');
  });

  it('OPENROUTER_CACHE_FAILED mentions OPENROUTER_API_KEY', () => {
    const joined = PRICING_ERRORS.OPENROUTER_CACHE_FAILED.join(' ');
    expect(joined).toContain('OPENROUTER_API_KEY');
  });
});

describe('MODEL_ERRORS', () => {
  it('NOT_FOUND includes the model ID', () => {
    expect(MODEL_ERRORS.NOT_FOUND('claude-3-opus')).toContain('claude-3-opus');
  });

  it('NOT_FOUND mentions "not found"', () => {
    expect(MODEL_ERRORS.NOT_FOUND('any-model')).toContain('not found');
  });

  it('UNKNOWN_PROVIDER includes the provider name', () => {
    expect(MODEL_ERRORS.UNKNOWN_PROVIDER('my-provider')).toContain('my-provider');
  });

  it('UNSUPPORTED_PROVIDER includes the provider name', () => {
    expect(MODEL_ERRORS.UNSUPPORTED_PROVIDER('my-provider')).toContain('my-provider');
  });

  it('CONFIG_FALLBACK includes the model name and default values', () => {
    const msg = MODEL_ERRORS.CONFIG_FALLBACK('unknown-model');
    expect(msg).toContain('unknown-model');
    expect(msg).toContain('1.0');
    expect(msg).toContain('4096');
  });

  it('THINKING_NOT_SUPPORTED includes model ID and mentions thinking', () => {
    const msg = MODEL_ERRORS.THINKING_NOT_SUPPORTED('gemini-1.0-pro');
    expect(msg).toContain('gemini-1.0-pro');
    expect(msg).toContain('hinking');
  });
});

describe('SERVER_ERRORS', () => {
  it('SSL_NOT_FOUND is an array mentioning certificate files', () => {
    expect(Array.isArray(SERVER_ERRORS.SSL_NOT_FOUND)).toBe(true);
    const joined = SERVER_ERRORS.SSL_NOT_FOUND.join(' ');
    expect(joined).toContain('SSL');
    expect(joined).toContain('Certificate');
    expect(joined).toContain('Private Key');
  });

  it('SSL_NOT_FOUND includes cert and key path placeholders', () => {
    const joined = SERVER_ERRORS.SSL_NOT_FOUND.join(' ');
    expect(joined).toContain('{certPath}');
    expect(joined).toContain('{keyPath}');
  });

  it('SSL_NOT_FOUND suggests generate-cert command', () => {
    const joined = SERVER_ERRORS.SSL_NOT_FOUND.join(' ');
    expect(joined).toContain('generate-cert');
  });

  it('STARTUP_FAILED is a string about server start failure', () => {
    expect(typeof SERVER_ERRORS.STARTUP_FAILED).toBe('string');
    expect(SERVER_ERRORS.STARTUP_FAILED).toContain('start server');
  });
});

describe('USER_FACING_ERRORS', () => {
  it('every entry has message and suggestion fields', () => {
    const entries = Object.values(USER_FACING_ERRORS);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).toHaveProperty('message');
      expect(entry).toHaveProperty('suggestion');
      expect(typeof entry.message).toBe('string');
      expect(typeof entry.suggestion).toBe('string');
      expect(entry.message.length).toBeGreaterThan(0);
      expect(entry.suggestion.length).toBeGreaterThan(0);
    }
  });

  it('MODEL_NOT_FOUND has appropriate message and suggestion', () => {
    expect(USER_FACING_ERRORS.MODEL_NOT_FOUND.message).toBe('Model not found');
    expect(USER_FACING_ERRORS.MODEL_NOT_FOUND.suggestion).toContain('model');
  });

  it('NO_API_KEY suggests adding an API key in Settings', () => {
    expect(USER_FACING_ERRORS.NO_API_KEY.message).toContain('API key');
    expect(USER_FACING_ERRORS.NO_API_KEY.suggestion).toContain('Settings');
  });

  it('RATE_LIMIT suggests waiting or switching models', () => {
    expect(USER_FACING_ERRORS.RATE_LIMIT.message).toContain('Rate limit');
    expect(USER_FACING_ERRORS.RATE_LIMIT.suggestion).toContain('try again');
  });

  it('OVERLOADED mentions high demand', () => {
    expect(USER_FACING_ERRORS.OVERLOADED.message).toContain('overloaded');
    expect(USER_FACING_ERRORS.OVERLOADED.suggestion).toContain('high demand');
  });

  it('CONTEXT_TOO_LONG suggests starting a new conversation', () => {
    expect(USER_FACING_ERRORS.CONTEXT_TOO_LONG.message).toContain('Context too long');
    expect(USER_FACING_ERRORS.CONTEXT_TOO_LONG.suggestion).toContain('new conversation');
  });

  it('INSUFFICIENT_CREDITS suggests adding credits', () => {
    expect(USER_FACING_ERRORS.INSUFFICIENT_CREDITS.message).toContain('credits');
    expect(USER_FACING_ERRORS.INSUFFICIENT_CREDITS.suggestion).toContain('credits');
  });

  it('CONNECTION_ERROR mentions internet connection', () => {
    expect(USER_FACING_ERRORS.CONNECTION_ERROR.message).toContain('Connection');
    expect(USER_FACING_ERRORS.CONNECTION_ERROR.suggestion).toContain('internet');
  });

  it('GENERIC_ERROR provides a fallback message', () => {
    expect(USER_FACING_ERRORS.GENERIC_ERROR.message).toContain('generate response');
    expect(USER_FACING_ERRORS.GENERIC_ERROR.suggestion).toContain('try again');
  });

  it('INVALID_REQUEST tells user to check input', () => {
    expect(USER_FACING_ERRORS.INVALID_REQUEST.message).toContain('Invalid request');
    expect(USER_FACING_ERRORS.INVALID_REQUEST.suggestion).toContain('Check');
  });

  it('AUTHENTICATION_FAILED mentions API key validity', () => {
    expect(USER_FACING_ERRORS.AUTHENTICATION_FAILED.message).toContain('Authentication');
    expect(USER_FACING_ERRORS.AUTHENTICATION_FAILED.suggestion).toContain('API key');
  });

  it('CONTENT_FILTERED mentions flagged content', () => {
    expect(USER_FACING_ERRORS.CONTENT_FILTERED.message).toContain('filtered');
    expect(USER_FACING_ERRORS.CONTENT_FILTERED.suggestion).toContain('flagged');
  });

  it('REQUEST_TIMEOUT suggests trying a different model', () => {
    expect(USER_FACING_ERRORS.REQUEST_TIMEOUT.message).toContain('timed out');
    expect(USER_FACING_ERRORS.REQUEST_TIMEOUT.suggestion).toContain('different model');
  });

  it('SERVER_ERROR mentions model server', () => {
    expect(USER_FACING_ERRORS.SERVER_ERROR.message).toContain('server error');
    expect(USER_FACING_ERRORS.SERVER_ERROR.suggestion).toContain('model');
  });

  it('ENDPOINT_NOT_FOUND suggests checking URL', () => {
    expect(USER_FACING_ERRORS.ENDPOINT_NOT_FOUND.message).toContain('Endpoint not found');
    expect(USER_FACING_ERRORS.ENDPOINT_NOT_FOUND.suggestion).toContain('URL');
  });

  it('PRICING_NOT_CONFIGURED mentions Admin panel', () => {
    expect(USER_FACING_ERRORS.PRICING_NOT_CONFIGURED.message).toContain('Pricing');
    expect(USER_FACING_ERRORS.PRICING_NOT_CONFIGURED.suggestion).toContain('Admin panel');
  });

  it('contains exactly 15 error entries', () => {
    expect(Object.keys(USER_FACING_ERRORS)).toHaveLength(15);
  });
});

describe('DEPRECATION_WARNINGS', () => {
  it('SET_CONTEXT_STRATEGY mentions the deprecated and replacement methods', () => {
    expect(DEPRECATION_WARNINGS.SET_CONTEXT_STRATEGY).toContain('setContextStrategy');
    expect(DEPRECATION_WARNINGS.SET_CONTEXT_STRATEGY).toContain('setContextManagement');
    expect(DEPRECATION_WARNINGS.SET_CONTEXT_STRATEGY).toContain('deprecated');
  });
});

describe('SUCCESS_MESSAGES', () => {
  it('OPENROUTER_CACHE_READY includes the count', () => {
    const msg = SUCCESS_MESSAGES.OPENROUTER_CACHE_READY(150);
    expect(msg).toContain('150');
    expect(msg).toContain('OpenRouter');
  });

  it('OPENROUTER_CACHE_READY with zero models', () => {
    const msg = SUCCESS_MESSAGES.OPENROUTER_CACHE_READY(0);
    expect(msg).toContain('0');
  });

  it('DATABASE_INITIALIZED is a meaningful string', () => {
    expect(SUCCESS_MESSAGES.DATABASE_INITIALIZED).toContain('Database');
    expect(SUCCESS_MESSAGES.DATABASE_INITIALIZED).toContain('initialized');
  });

  it('MODEL_LOADER_INITIALIZED mentions ModelLoader and database', () => {
    expect(SUCCESS_MESSAGES.MODEL_LOADER_INITIALIZED).toContain('ModelLoader');
    expect(SUCCESS_MESSAGES.MODEL_LOADER_INITIALIZED).toContain('database');
  });
});
