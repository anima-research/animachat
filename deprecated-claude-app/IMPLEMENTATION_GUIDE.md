# Arc Implementation Guide - Week 1

## Quick Start for This Week

Given the timeline (launch by end of week), here's a pragmatic implementation plan:

### Option 1: Integrated Approach (Recommended for Week 1)
Keep everything in the monolith for now, but with clean abstractions that allow future separation.

```typescript
// backend/src/websocket/handler.ts
import { EnhancedInferenceService } from '../services/enhanced-inference.js';
import { ContextManager } from '../services/context-manager.js';

// Initialize once
const contextManager = new ContextManager({
  defaultStrategy: 'rolling',
  enableCaching: true,
});

const enhancedInference = new EnhancedInferenceService(
  inferenceService,
  contextManager
);

// Use in handleChatMessage
const response = await enhancedInference.streamCompletion(
  model,
  messages,
  systemPrompt,
  settings,
  userId,
  streamCallback,
  conversation, // Pass conversation for context management
  responder.id
);
```

### Option 2: Separate Service (If You Have DevOps Support)

Create a lightweight context service:

```bash
# New service structure
arc-context-service/
├── src/
│   ├── index.ts        # Express server
│   ├── api/            # REST endpoints
│   ├── strategies/     # Context strategies
│   └── cache/          # Cache management
├── package.json
└── Dockerfile
```

## Implementation Checklist for Week 1

### Day 1-2: Core Context Management
- [x] Implement context strategies (rolling, static)
- [x] Create context manager with state tracking
- [x] Add Anthropic cache control support
- [ ] Test with real conversations

### Day 2-3: Integration
- [ ] Update WebSocket handler to use enhanced inference
- [ ] Add context strategy selection to conversation settings
- [ ] Update frontend to show cache savings
- [ ] Add strategy selector in conversation settings dialog

### Day 3-4: Anthropic Prompt Caching
- [ ] Implement proper cache key generation
- [ ] Add cache breakpoint optimization
- [ ] Track cache metrics in database
- [ ] Add cache analytics endpoint

### Day 4-5: Testing & Polish
- [ ] Load test with long conversations
- [ ] Verify cache hit rates
- [ ] Add monitoring/logging
- [ ] Documentation for users

## Critical Code Changes Needed

### 1. Update Shared Types
```typescript
// shared/src/types.ts
export const ConversationSettingsSchema = z.object({
  contextStrategy: z.enum(['rolling', 'static', 'adaptive']).optional(),
  maxContextTokens: z.number().optional(),
  rotationInterval: z.number().optional(),
  // ... existing fields
});
```

### 2. Database Schema Update
```typescript
// backend/src/database/index.ts
interface ConversationSettings {
  contextStrategy?: 'rolling' | 'static' | 'adaptive';
  maxContextTokens?: number;
  rotationInterval?: number;
  // ... existing fields
}
```

### 3. Frontend Context Strategy Selector
```vue
<!-- frontend/src/components/ConversationSettingsDialog.vue -->
<v-select
  v-model="localSettings.contextStrategy"
  :items="contextStrategies"
  label="Context Management Strategy"
  hint="How to manage long conversations"
/>

<script>
const contextStrategies = [
  { value: 'rolling', title: 'Rolling Window', subtitle: 'Rotate old messages for efficiency' },
  { value: 'static', title: 'Static Context', subtitle: 'Keep all messages (higher cost)' },
  { value: 'adaptive', title: 'Adaptive', subtitle: 'Smart selection based on importance' },
];
</script>
```

### 4. Cache Metrics Display
```vue
<!-- frontend/src/components/CacheMetrics.vue -->
<template>
  <v-card v-if="metrics">
    <v-card-title>Cache Performance</v-card-title>
    <v-card-text>
      <v-row>
        <v-col>
          <div class="text-h6">${{ metrics.totalSaved.toFixed(2) }}</div>
          <div class="text-caption">Saved with caching</div>
        </v-col>
        <v-col>
          <div class="text-h6">{{ (metrics.cacheHitRate * 100).toFixed(1) }}%</div>
          <div class="text-caption">Cache hit rate</div>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>
```

## Anthropic Prompt Caching Details

### How It Works
1. Mark a message with `cache_control: { type: 'ephemeral' }`
2. Anthropic caches everything up to and including that message
3. Cache is valid for 5 minutes
4. Cached tokens cost 90% less

### Optimization Strategy
```typescript
// For a 100-message conversation with 20-message rotation:
// Messages 1-80: Cached (stable)
// Messages 81-100: Not cached (rotating window)
// When message 101 arrives:
// - Remove messages 1-20
// - Messages 21-80 become 1-60 (still cached!)
// - Messages 81-101 become 61-81 (active window)
```

## Testing the Implementation

### 1. Create Test Conversation
```typescript
// Create a long conversation to test rotation
const testConversation = await createConversation({
  title: 'Cache Test',
  settings: {
    contextStrategy: 'rolling',
    maxContextTokens: 4000,
    rotationInterval: 20,
  },
});
```

### 2. Monitor Cache Performance
```bash
# Add logging to see cache behavior
curl http://localhost:3010/api/conversations/:id/cache-metrics
```

### 3. Verify Cost Savings
- Send 100+ messages
- Check cache hit rate (should be >80% after warmup)
- Monitor token usage in Anthropic dashboard

## Production Considerations

### State Persistence
For production, add Redis for context state:

```typescript
import Redis from 'ioredis';

class RedisContextStore {
  constructor(private redis: Redis) {}
  
  async saveState(conversationId: string, state: ContextState): Promise<void> {
    await this.redis.set(
      `context:${conversationId}`,
      JSON.stringify(state),
      'EX', 3600 // 1 hour TTL
    );
  }
  
  async loadState(conversationId: string): Promise<ContextState | null> {
    const data = await this.redis.get(`context:${conversationId}`);
    return data ? JSON.parse(data) : null;
  }
}
```

### Monitoring
Add Prometheus metrics:

```typescript
import { Counter, Histogram, Gauge } from 'prom-client';

const cacheHits = new Counter({
  name: 'arc_cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['model', 'strategy'],
});

const cacheSavings = new Gauge({
  name: 'arc_cache_savings_dollars',
  help: 'Estimated cost savings from caching',
  labelNames: ['model'],
});
```

## Future Enhancements (Post-Launch)

### Memory Compression
```typescript
interface MemoryCompressor {
  compress(messages: Message[]): Promise<CompressedMemory>;
  decompress(memory: CompressedMemory): Promise<Message[]>;
}

// Use GPT-4 or Claude to summarize old messages
class LLMMemoryCompressor implements MemoryCompressor {
  async compress(messages: Message[]): Promise<CompressedMemory> {
    const summary = await this.llm.summarize(messages);
    return {
      summary,
      originalCount: messages.length,
      keyPoints: this.extractKeyPoints(messages),
    };
  }
}
```

### RAG Integration
```typescript
interface RAGProvider {
  retrieve(query: string, context: Message[]): Promise<Document[]>;
  shouldRetrieve(messages: Message[]): boolean;
}

// Integrate with vector stores
class PineconeRAGProvider implements RAGProvider {
  async retrieve(query: string, context: Message[]): Promise<Document[]> {
    const embedding = await this.embed(query);
    return this.pinecone.query({ vector: embedding, topK: 5 });
  }
}
```

## Launch Readiness Checklist

- [ ] Context strategies implemented and tested
- [ ] Anthropic cache control working
- [ ] Cache metrics visible in UI
- [ ] User can select context strategy
- [ ] Cost savings tracked and displayed
- [ ] Documentation for users
- [ ] Monitoring in place
- [ ] Rollback plan ready

This guide should help you implement the essential context management features by the end of the week while laying the groundwork for future enhancements.

