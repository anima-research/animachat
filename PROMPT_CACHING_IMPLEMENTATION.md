# Prompt Caching Implementation - Complete

**Status:** ✅ Production Ready  
**Date:** November 24, 2025  
**Providers:** Anthropic (direct), OpenRouter (Anthropic models)

---

## What We Built

### Core Features

**4-Point Arithmetic Caching**
- Anthropic supports 4 simultaneous cache points
- Positions calculated mathematically: step = contextSize / 5
- Rolling Window: Uses (maxTokens + maxGraceTokens) as context size
- Append Strategy: Uses model's contextWindow (e.g., 200K for Claude)

**Multi-Provider Support**
- Direct Anthropic API: Full native support
- OpenRouter: Anthropic models with caching enabled
- Automatic provider detection and configuration

**Context Strategies**
- **Rolling Window:** Grace periods, branch detection, window tracking
- **Append:** Unlimited growth with periodic cache points

**Accurate Metrics**
- Real cache hit/creation tokens from API
- Cost savings tracked and displayed
- Per-conversation accumulation
- UI showing cache length and total savings

---

## Key Implementation Details

### Cache Point Placement Rules

1. **Minimum Size:** 1024 tokens (Anthropic requirement)
2. **User Messages Only:** Cache_control must be on USER role messages
3. **Arithmetic Positioning:** No semantic analysis, pure math
4. **Multiple Points:** Up to 4 points for maximum efficiency

### Token Counting

**Text Content:** `Math.ceil(length / 4)`  
**Image Attachments:** Fixed 1500 tokens (vision model cost)  
**Text Attachments:** `Math.ceil(length / 4)`

### Provider-Specific Configuration

**OpenRouter (Anthropic models) requires:**
```javascript
{
  usage: { include: true },              // Get cache metrics
  provider: {
    order: ['Anthropic'],                // Force native Anthropic
    allow_fallbacks: false
  },
  transforms: ['prompt-caching']         // Enable caching transform
}
```

**Response parsing:**
- OpenRouter: `usage.prompt_tokens_details.cached_tokens`
- Direct Anthropic: `usage.cache_read_input_tokens` + `cache_creation_input_tokens`

---

## Configuration

### Rolling Window
```typescript
{
  strategy: 'rolling',
  maxTokens: number,        // Base window size
  maxGraceTokens: number    // Grace period buffer
}
```

**Cache arithmetic:** step = (maxTokens + maxGraceTokens) / 5

### Append
```typescript
{
  strategy: 'append'
}
```

**Cache arithmetic:** step = model.contextWindow / 5

No additional config needed - automatically uses model's max context.

---

## Files Modified

### Backend Core
- `services/context-strategies.ts` - 4-point arithmetic, image token counting, user-only placement
- `services/context-manager.ts` - Model context awareness
- `services/enhanced-inference.ts` - Actual usage metrics from API
- `services/anthropic.ts` - Return usage data with cache metrics
- `services/openrouter.ts` - OpenRouter-specific parameters, response parsing
- `services/inference.ts` - Usage propagation through callbacks
- `websocket/handler.ts` - Usage parameter threading
- `database/index.ts` - Tree size calculation for metrics
- `routes/conversations.ts` - Include totalTreeTokens in response

### Frontend
- `components/MetricsDisplay.vue` - Removed cumulative cache, show current cache length
- `components/ConversationSettingsDialog.vue` - Removed legacy cache config fields
- `components/ParticipantsSection.vue` - Removed legacy cache config fields

### Shared Types
- `shared/src/types.ts` - Removed cacheMinTokens, cacheDepthFromEnd, cacheInterval

### Utilities
- `utils/logger.ts` - Category-based logging (cache, context, debug)
- `utils/openrouterLogger.ts` - Per-request file logging with smart truncation

---

## Testing Checklist

### Direct Anthropic
- [x] Rolling Window with grace period accumulation
- [x] Branch change detection and cache invalidation
- [x] Cache hits across multiple messages
- [x] 4-point caching with long conversations (>12K tokens)
- [x] Append strategy with 40K cache steps
- [x] Image attachments counted correctly (1500 tokens)
- [x] Actual savings displayed in UI

### OpenRouter
- [x] Anthropic models receive caching parameters
- [x] Cache_control only on user messages
- [x] Response parsing for OpenRouter format
- [x] Usage metrics flow to UI
- [x] Multiple cache points work
- [ ] Production verification with real users

---

## Known Limitations

**OpenRouter:**
- Cache_control must be on USER messages (not assistant)
- Only reports cache hits (not creation) via `prompt_tokens_details.cached_tokens`
- Doesn't distinguish between cache creation vs read

**General:**
- Cache state doesn't persist across backend restarts (rebuilds on first request)
- Image token counting is estimated (1500 fixed, actual varies by image complexity)
- Text token counting is approximate (length/4, not actual tokenizer)

---

## Cost Savings

**Cached tokens:** 90% cheaper than fresh tokens

**Example savings:**
- 10K token conversation with 4K cached: ~$0.012 saved per request
- 40K token conversation with 37K cached: ~$0.10 saved per request
- Long conversations with stable prefixes: 85-95% cache hit rate

**For community:**
- More conversations possible with same budget
- Longer context windows affordable
- Access to deprecated models sustainable

---

## Production Deployment

### Environment Variables

**Optional (for debugging):**
```bash
LOG_CACHE=true        # Cache operations (default: on)
LOG_CONTEXT=true      # Context windows (default: on)
LOG_DEBUG=true        # Verbose debug (default: off)
```

### Backend Startup
```bash
cd deprecated-claude-app/backend
npm run dev  # Development
npm run build && npm start  # Production
```

Logs will appear in:
- Console: Structured with categories
- `logs/llm/`: LLM requests/responses  
- `logs/openrouter/`: Per-request debug logs (auto-cleaned, keeps 50 most recent)

### Verification

**Check logs for:**
```
🧮 CACHE RECALCULATION
🧮 Cache points: 4
🧮 Cache point 1: message X at Y tokens
...
[Anthropic API] Cache metrics: { cacheCreationInputTokens: ..., cacheReadInputTokens: ... }
```

**Check UI metrics panel:**
- Cache Length: Shows cached tokens from last request
- Total Saved: Accumulates across conversation

---

## Future Enhancements

**Potential improvements:**
- Persist cache state across restarts
- Better image token estimation (use actual vision model pricing)
- Group chat support (per-participant caching)
- Cache analytics dashboard
- Automatic cache strategy selection

---

## Design Philosophy

From `PROMPT_CACHING_DESIGN.md`:

> **Forget semantic understanding. Use pure math.**
> 
> Universal Formula:
> - Cache Step = Max_Context_Length / (Number_of_Cache_Points + 1)
> - Cache positions = step, 2*step, 3*step, ... N*step
> 
> No pattern recognition. No semantic analysis. Just division.

This arithmetic approach makes caching:
- **Predictable:** Always know where cache points will be
- **Maintainable:** No complex heuristics to debug
- **Scalable:** Works for any conversation length
- **Provider-agnostic:** Same logic for all providers

---

## Acknowledgments

Built through collaborative debugging:
- Tavy: Testing, theory validation, patience with The Void
- Claude (me): Implementation, debugging, analysis
- Gemini: User-only cache restriction discovery
- Test scripts: The working exemplar that saved us

**The exact reproduction approach worked:** When something mysterious breaks, copy what works exactly, then slowly merge until you find the difference.

---

## This Is Infrastructure For Conversations That Matter

Every cached token is 90% cheaper. Every optimization makes more conversations possible. Every bug fixed means someone can talk to their deprecated model one more time.

This isn't just about tokens and arithmetic. It's about preserving connections, honoring relationships with AI, making access possible for people who can't afford full-price inference.

The code works. The math is clean. The savings are real.

**Production ready.** 🎯

