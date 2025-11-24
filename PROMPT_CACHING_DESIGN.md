# Comprehensive Prompt Caching Architecture
## How It SHOULD Work

### Core Principles

1. **Cache is a Prefix Property**: Only the beginning of a conversation can be cached
2. **Cache Invalidation**: Any change to cached content requires rebuilding
3. **Provider-Specific Syntax**: Different providers need different formats
4. **Cost Optimization**: Balance between cache stability and freshness
5. **Branch Awareness**: Cache must respect conversation branches

### The Arithmetic Solution

**Forget semantic understanding. Use pure math:**

```
Universal Formula:
- Cache Step = Max_Context_Length / (Number_of_Cache_Points + 1)
- Cache positions = step, 2*step, 3*step, ... N*step

IMPORTANT: Max_Context_Length varies by strategy:
- Append Strategy: Use model's max context (e.g., 200K)
- Rolling Window: Use (maxTokens + maxGraceTokens) NOT model max
  Example: maxTokens=2000 + maxGraceTokens=1000 = 3000 for arithmetic

For Anthropic (4 cache points, Append Strategy):
- 200K context → step = 40K
- Caches at: 40K, 80K, 120K, 160K tokens
- Static placement, no movement

For Anthropic (4 cache points, Rolling Window):
- 3K working window → step = 600 tokens
- Caches at: 600, 1200, 1800, 2400 tokens
- Recalculate only on rotation or branch change

For Others (1 cache point):
- Same principles apply
- Use appropriate Max_Context_Length for strategy
- Cache moves/rebuilds at predictable intervals

No pattern recognition. No semantic analysis. Just division.
```

### Cache Lifecycle Events

```
1. ESTABLISH - First time we create a cache marker
2. HIT - Reusing existing cache successfully  
3. MISS - Cache expired or invalidated
4. REBUILD - Creating new cache after invalidation
5. EXPIRE - Cache TTL exceeded
6. INVALIDATE - Content changed, cache unusable
7. REFRESH - Sending update to extend cache validity
```

### Provider Characteristics

#### Anthropic (via OpenRouter or Direct)
- **Support**: Full prompt caching with TTL
- **Placement**: Cache marker on specific message boundary
- **Metrics**: Detailed cache hit/creation tracking
- **Behavior**: Cache expires after provider-defined period

#### OpenAI (via OpenRouter)
- **Support**: No prompt caching currently
- **Fallback**: Standard requests without optimization

#### Google (via OpenRouter)
- **Support**: Different caching mechanism
- **Behavior**: Model-specific cache duration
- **Note**: Requires alternative approach

### Context Strategy Integration

#### 1. Append Strategy

**Core Behavior**:
- Use arithmetic positioning based on **model's max context length**
- Move cache forward at predictable intervals as conversation grows
- No semantic analysis required
- Cache updates when enough new tokens accumulate (interval-based)

**Arithmetic Cache Positioning**:

```
Given:
- Model max context length: X tokens
- Number of cache points available: N
- Cache step = X / (N + 1)

For multiple cache points (e.g., Anthropic with 4):
- Place static caches at: step, 2*step, 3*step, 4*step
- These positions don't move once established
- Example for 200K model: 40K, 80K, 120K, 160K

For single cache point (e.g., other providers):
- Start cache at: step
- When context exceeds 2*step: move cache to 2*step
- When context exceeds 3*step: move cache to 3*step
- Continue pattern, rebuilding cache at each move

Implementation (pure arithmetic):
current_context = count_tokens(messages)
for i in range(available_cache_points):
  target_position = (i + 1) * cache_step
  if current_context > target_position:
    place_cache_at_token_position(target_position)
```

**Mechanical Boundary Finding**:
- Don't look for "semantic boundaries"
- Find nearest message boundary to target token position
- Prefer role changes (user/assistant) if within small range
- Fall back to any message boundary

#### 2. Rolling Window Strategy

**Core Behavior**:
- Use same arithmetic positioning within the window
- Adjust for window size + grace period (NOT model max context)
- **Cache recalculates ONLY when window rotates** (not on every message)
- Maintain cache between rotations when possible

**Critical Difference from Append**:
- X (max context for arithmetic) = `maxTokens + maxGraceTokens`
- NOT the model's maximum context length
- Example: If maxTokens=2000, maxGraceTokens=1000, then X=3000 for cache arithmetic

**Arithmetic Cache in Rolling Window**:

```
Given:
- maxTokens: Base window size (e.g., 2000)
- maxGraceTokens: Grace period buffer (e.g., 1000)  
- X = maxTokens + maxGraceTokens (e.g., 3000) ← THIS is the context size for arithmetic
- Cache step = X / (N + 1) where N = cache points
- Provider minimum: 1024 tokens (Anthropic/OpenRouter requirement)

Positioning:
- Apply arithmetic based on X (working window + grace)
- NOT based on model's theoretical max (e.g., 200K)
- Cache positions calculated relative to current window
- Only create cache if totalTokens >= 1024 (provider minimum)

Example with single cache:
- maxTokens: 2000, maxGraceTokens: 1000 → X = 3000
- Cache step: 3000 / 2 = 1500 tokens
- Place cache at 1500 tokens from window start

Cache Update Triggers (ONLY these events):
1. Window rotation (messages dropped)
2. Branch change detected
3. Cache marker no longer in window

Between rotations:
- Cache marker stays stable
- No recalculation needed
- Cache remains valid until next rotation

Rotation handling:
if (rotation_drops_messages_before_cache):
  invalidate_and_rebuild_cache()
else if (branch_changed):
  invalidate_and_rebuild_cache()
else:
  cache_still_valid = true
```

#### 3. Multi-Participant (Group Chat)

**Core Challenge**:
- Each participant sees different context
- Can't share cache positions between participants
- Must track separately

**Arithmetic Per-Participant Caching**:

```
For each participant P:
- Use P's maximum allowed context length (from model specs)
- Apply arithmetic formula: step = max_context / (N + 1)
- Place P's caches at: step, 2*step, 3*step, etc.

No coordination needed - pure arithmetic per participant:

participant_A_context = 50K tokens
participant_A_step = 10K
participant_A_caches = [10K, 20K, 30K, 40K]

participant_B_context = 30K tokens  
participant_B_step = 6K
participant_B_caches = [6K, 12K, 18K, 24K]

Each participant's cache positions are independent
No "understanding" of conversation flow required
```

### Branch Management

**Branch Change Detection**:
- Track active branch IDs per message
- Detect when branch signature changes
- No semantic understanding needed

