# OpenRouter Prompt Caching Implementation

## Overview

This document describes the implementation of prompt caching for OpenRouter-hosted models, with initial support for Anthropic's Claude models and placeholders for future provider support (OpenAI, Google, etc.).

## Motivation

Claude 3 Opus is an expensive but highly capable model ($15/MTok input, $75/MTok output). By implementing prompt caching through OpenRouter, we can:

- **Reduce costs by 90%** for cached content (cache reads cost only 10% of base input tokens)
- Make expensive models accessible without burning through budget
- Support long conversations with large context windows efficiently

## Architecture

### How Prompt Caching Works

1. **Context Management**: The `ContextManager` determines which messages should be cached based on the strategy:
   - **Append strategy**: Caches all messages except the most recent ones
   - **Rolling strategy**: Maintains a sliding window, caching stable older messages

2. **Cache Control Markers**: The `EnhancedInferenceService` adds `_cacheControl` metadata to the last cacheable message

3. **Provider-Specific Formatting**: The `OpenRouterService` converts cache control markers to provider-specific syntax (Anthropic, OpenAI, etc.)

4. **Metrics Tracking**: Cache creation and read metrics are captured from the streaming response

### Flow Diagram

```
User Request
    ↓
EnhancedInferenceService
    ↓
ContextManager.prepareContext()
    ↓
[Messages split into cacheablePrefix + activeWindow]
    ↓
Add _cacheControl to last cacheable message
    ↓
OpenRouterService.formatMessagesForOpenRouter()
    ↓
Detect provider (anthropic/openai/google)
    ↓
Add cache_control blocks (Anthropic syntax)
    ↓
Stream to OpenRouter API
    ↓
Capture cache metrics from response
    ↓
Log savings and metrics
```

## Implementation Details

### 1. Updated Type Definitions

**File**: `backend/src/services/openrouter.ts`

```typescript
interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
  cache_control?: { type: 'ephemeral' };
}

interface OpenRouterResponse {
  // ... existing fields
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    // Anthropic cache fields (via OpenRouter)
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}
```

### 2. Provider Detection

The service automatically detects the underlying provider from the model ID:

```typescript
private detectProviderFromModelId(modelId: string): string {
  const lowerId = modelId.toLowerCase();
  
  if (lowerId.includes('anthropic/') || lowerId.includes('claude')) {
    return 'anthropic';
  }
  if (lowerId.includes('openai/') || lowerId.includes('gpt')) {
    return 'openai';  // Placeholder for future implementation
  }
  if (lowerId.includes('google/') || lowerId.includes('gemini')) {
    return 'google';  // Placeholder for future implementation
  }
  // ... more providers
  
  return 'unknown';
}
```

### 3. Message Formatting with Cache Control

**For Anthropic models via OpenRouter:**

```typescript
// Simple message without cache control
{
  role: 'user',
  content: 'Hello'
}

// Message WITH cache control
{
  role: 'user',
  content: [
    {
      type: 'text',
      text: 'Hello',
      cache_control: { type: 'ephemeral' }
    }
  ]
}
```

The system prompt is automatically included in the cache if any message has cache control.

### 4. Cache Metrics Tracking

The streaming response handler captures cache metrics:

```typescript
if (parsed.usage) {
  // Capture cache metrics if available (Anthropic via OpenRouter)
  if (parsed.usage.cache_creation_input_tokens !== undefined) {
    cacheMetrics.cacheCreationInputTokens = parsed.usage.cache_creation_input_tokens;
  }
  if (parsed.usage.cache_read_input_tokens !== undefined) {
    cacheMetrics.cacheReadInputTokens = parsed.usage.cache_read_input_tokens;
  }
}
```

Metrics are logged separately for tracking:

```typescript
await llmLogger.logCustom({
  timestamp: new Date().toISOString(),
  type: 'CACHE_METRICS',
  requestId,
  provider,
  model: modelId,
  cacheCreationInputTokens: cacheMetrics.cacheCreationInputTokens,
  cacheReadInputTokens: cacheMetrics.cacheReadInputTokens,
  costSaved
});
```

## Usage

### Setting Up Context Management for a Conversation

When creating a conversation, specify the context management strategy:

```typescript
const conversation: Conversation = {
  id: 'conv-123',
  contextManagement: {
    strategy: 'rolling',           // or 'append'
    maxContextTokens: 100000,      // Max context window
    rollingWindowSize: 20,         // Keep last 20 messages active
    cacheAfterMessages: 10         // Cache after 10 messages
  },
  // ... other fields
};
```

### For Append Strategy

- All messages except the most recent N are cached
- Good for conversations where older context remains relevant
- Example: Research sessions, document analysis

```typescript
contextManagement: {
  strategy: 'append',
  maxContextTokens: 100000,
  appendWindowSize: 5  // Last 5 messages not cached
}
```

### For Rolling Strategy

- Maintains a sliding window of active messages
- Caches everything before the window
- Good for long conversations with evolving context
- Example: Ongoing discussions, creative writing

```typescript
contextManagement: {
  strategy: 'rolling',
  maxContextTokens: 100000,
  rollingWindowSize: 20  // Last 20 messages in active window
}
```

## Cost Savings Example

### Scenario: Claude 3 Opus via OpenRouter

**Without caching:**
- 100 messages conversation
- Average 1,000 tokens per message = 100,000 tokens
- Cost: 100K × ($15/1M) = **$1.50 per request**

**With caching (after warmup):**
- First request: 100,000 tokens cached
  - Cost: 100K × ($15/1M) × 1.25 = $1.875 (cache write cost)
- Subsequent requests: 95,000 tokens cached + 5,000 new
  - Cached: 95K × ($15/1M) × 0.10 = $0.1425
  - New: 5K × ($15/1M) = $0.075
  - Total: **$0.2175 per request**

**Savings: 85% reduction in costs after first request!**

## Provider-Specific Implementation

### Anthropic (Currently Implemented)

OpenRouter passes through Anthropic's `cache_control` syntax directly:

```json
{
  "model": "anthropic/claude-3-opus",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Long context here...",
          "cache_control": { "type": "ephemeral" }
        }
      ]
    }
  ]
}
```

**Cache TTL**: 5 minutes (Anthropic standard)

### OpenAI (Placeholder - Not Yet Implemented)

OpenAI uses a different caching mechanism that will be implemented in the future.

**Placeholder code location**: `detectProviderFromModelId()` and `formatMessagesForOpenRouter()`

### Google (Placeholder - Not Yet Implemented)

Google's Gemini models support context caching with their own syntax.

**Placeholder code location**: `detectProviderFromModelId()` and `calculateCacheSavings()`

## Testing

### 1. Create a Test Conversation

```bash
curl -X POST http://localhost:3010/api/conversations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Cache Test - Claude Opus",
    "contextManagement": {
      "strategy": "rolling",
      "maxContextTokens": 100000,
      "rollingWindowSize": 5
    }
  }'
```

### 2. Add Multiple Messages

Send 10+ messages to build up cacheable context.

### 3. Monitor Cache Metrics

Check your backend logs for:

```
[OpenRouter] Cache metrics for anthropic/claude-3-opus: {
  cacheCreationInputTokens: 45000,
  cacheReadInputTokens: 0,
  costSaved: '$0.0000'
}
```

On subsequent requests:

```
[OpenRouter] Cache metrics for anthropic/claude-3-opus: {
  cacheCreationInputTokens: 5000,
  cacheReadInputTokens: 45000,
  costSaved: '$0.6075'
}
```

### 4. Verify Cost Savings

Cache read tokens should be ~90% cheaper than full-price tokens.

## Debugging

### Enable Debug Logging

The implementation includes comprehensive logging:

```typescript
console.log(`[OpenRouter] Cache metrics for ${modelId}:`, {
  cacheCreationInputTokens: ...,
  cacheReadInputTokens: ...,
  costSaved: `$${costSaved.toFixed(4)}`
});
```

### Common Issues

#### 1. Cache not being used

**Symptom**: `cacheReadInputTokens` is always 0

**Causes**:
- Model doesn't support caching (check it's an Anthropic model)
- Cache expired (5-minute TTL)
- Messages changed (even whitespace breaks cache)
- System prompt changed

#### 2. Higher costs than expected

**Symptom**: Cache write tokens are expensive

**Solution**: 
- Wait for 2-3 requests before evaluating savings
- First request pays cache write cost (1.25× base price)
- Subsequent requests save 90%

#### 3. Provider detection failing

**Symptom**: Cache control not being added

**Solution**:
- Check model ID format (should be `anthropic/claude-...`)
- Verify `detectProviderFromModelId()` returns `'anthropic'`
- Check logs for provider detection output

## Performance Considerations

### Cache Efficiency

- **Warmup phase**: First 1-2 requests write to cache (slightly more expensive)
- **Steady state**: 85-90% cost reduction for cached portions
- **Optimal window**: Cache 80-90% of context, keep 10-20% active

### Memory Usage

- No additional memory overhead (cache is managed by OpenRouter/Anthropic)
- Cache state is stored server-side by provider

### Latency

- Cached requests are faster (less tokens to process)
- Cache writes add minimal overhead (~5-10ms)

## Future Enhancements

### Phase 2: OpenAI GPT-4 Caching

OpenAI has beta support for prompt caching. Implementation will require:

1. Different cache syntax (no `cache_control` blocks)
2. Different cache TTL and pricing
3. API version header updates

**Estimated effort**: 4-6 hours

### Phase 3: Google Gemini Caching

Gemini uses `cachedContent` API for context caching:

1. Separate API call to create cached content
2. Reference cached content by ID in requests
3. Different cache management lifecycle

**Estimated effort**: 6-8 hours

### Phase 4: Unified Cache Analytics

Dashboard showing:
- Cache hit rate by model
- Cost savings over time
- Cache efficiency metrics
- Recommendations for optimal strategies

**Estimated effort**: 8-12 hours

## Files Modified

1. **`backend/src/services/openrouter.ts`**
   - Added cache control support
   - Provider detection
   - Cache metrics tracking
   - Cost savings calculation

2. **`backend/src/services/enhanced-inference.ts`**
   - Extended cache control to OpenRouter provider
   - Unified caching logic across providers

## References

- [Anthropic Prompt Caching Documentation](https://docs.claude.com/en/docs/build-with-claude/prompt-caching)
- [OpenRouter API Documentation](https://openrouter.ai/docs)
- [Context Management Strategies](./IMPLEMENTATION_GUIDE.md)

## Questions?

For questions or issues, please check:
1. Backend logs for cache metrics
2. OpenRouter dashboard for usage stats
3. This documentation for debugging tips

---

**Last Updated**: November 14, 2025
**Version**: 1.0.0
**Author**: AnimaChat Development Team

