# Stateful Rolling Window with Grace Period and Branch Awareness

## The Challenge

Arc Chat conversations are not linear - they're trees. Users can:
- **Regenerate**: Create alternative responses at any point
- **Edit**: Modify messages and continue from there  
- **Fork**: Branch conversations in multiple directions
- **Continue**: Extend responses from specific branches

This creates a complex problem: How do we maintain efficient context windows when the conversation can branch at any point?

## The Solution: Branch-Aware Stateful Context Management

### Core Principles

1. **Stateful Strategy**: The rolling window maintains state about its position in the grace period cycle
2. **Grace Period**: A buffer zone that allows context to grow beyond maxTokens before rotation
3. **Branch Detection**: System detects when we've moved to a different timeline
4. **Smart Recalculation**: Only recalculate when branching occurs, not on every message

### The Algorithm

```
┌─────────────────────────────────────┐
│         INITIALIZATION              │
│   maxTokens: 2000                   │
│   graceTokens: 1000                 │
│   state: {                          │
│     inGracePeriod: false           │
│     baselineTokens: 0              │
│     lastBranchId: null             │
│   }                                 │
└─────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│      NEW MESSAGE ARRIVES            │
│   Check: Is this a new branch?      │
└─────────────────────────────────────┘
                │
        ┌───────┴───────┐
        │               │
        NO              YES
        │               │
        ▼               ▼
┌──────────────┐ ┌──────────────────┐
│  Continue    │ │  Reset State     │
│  Linear Flow │ │  Recalculate     │
└──────────────┘ │  Window          │
        │        └──────────────────┘
        ▼               │
┌──────────────────────▼────────────┐
│     TOKEN COUNT CHECK              │
│                                    │
│  tokens ≤ maxTokens?               │
│    → Normal operation              │
│                                    │
│  maxTokens < tokens ≤ max+grace?   │
│    → Enter/stay in grace period    │
│                                    │
│  tokens > maxTokens + grace?       │
│    → ROTATE WINDOW                 │
└────────────────────────────────────┘
```

### State Transitions

#### 1. **Normal State** (tokens ≤ maxTokens)
```typescript
state = {
  inGracePeriod: false,
  baselineTokens: currentTokens,
  lastBranchId: currentBranchId
}
```
- Messages append normally
- No rotation needed
- Cache remains valid

#### 2. **Grace Period** (maxTokens < tokens ≤ maxTokens + graceTokens)
```typescript
// First time exceeding maxTokens
if (!state.inGracePeriod && tokens > maxTokens) {
  state.inGracePeriod = true;
  state.baselineTokens = tokens;
  // Log: "Entering grace period"
}
```
- Messages continue to append
- NO rotation yet
- System tracks that we're in grace
- Cache still valid

#### 3. **Rotation** (tokens > maxTokens + graceTokens)
```typescript
if (state.inGracePeriod && tokens > maxTokens + graceTokens) {
  // Perform rotation
  messages = truncateToMaxTokens(messages);
  
  // Reset state
  state.inGracePeriod = false;
  state.baselineTokens = newTokenCount;
  state.lastRotationTime = new Date();
  
  // Cache needs rebuild
}
```
- Drop oldest messages
- Keep most recent ~maxTokens worth
- Reset grace period state
- Cache invalidated and rebuilt

### Branch Detection

The system detects branching through:

1. **Explicit Parent Branch ID**
   - Regenerate provides `parentBranchId`
   - Edit creates new branch from edit point
   - Continue specifies branch to continue from

2. **Branch Change Detection**
   ```typescript
   if (message.parentBranchId !== state.lastBranchId) {
     // We've moved to a different timeline
     // Trigger full recalculation
     resetState();
     recalculateWindow();
   }
   ```

3. **Events That Trigger Recalculation**
   - `regenerate`: New branch from same parent
   - `edit`: New branch from edit point
   - `branch_switch`: User navigates to different branch
   - `continue`: Extending from specific branch

### Optimization Strategies

1. **Linear Assumption**: If no branch change detected, assume linear progression
2. **Lazy Recalculation**: Only recalculate when branch changes, not every message
3. **State Persistence**: Maintain state between messages in same branch
4. **Cache Preservation**: Grace period prevents unnecessary cache invalidation

### Implementation Details

#### RollingContextStrategy State
```typescript
class RollingContextStrategy {
  private state = {
    inGracePeriod: boolean;
    baselineTokens: number;
    lastRotationTime?: Date;
    lastMessageCount: number;
    lastBranchId?: string;  // Track current branch
  };
}
```

#### Context Manager Integration
```typescript
class ContextManager {
  private stateByBranch: Map<string, BranchState> = new Map();
  
  prepareContext(conversation, messages, newMessage, participant) {
    const branchId = this.detectCurrentBranch(messages, newMessage);
    
    if (branchId !== this.lastBranchId) {
      // Branch change detected
      this.strategy.resetState();
    }
    
    return this.strategy.prepareContext(messages, newMessage);
  }
}
```

### Visual Example

```
Initial conversation:
[A] → [B] → [C] → [D]  (1500 tokens)
                   ↓
                  [E]  (+600 tokens = 2100 total)
                  ↓    ENTERS GRACE PERIOD
                  [F]  (+400 tokens = 2500 total)
                  ↓    STILL IN GRACE
                  [G]  (+600 tokens = 3100 total)
                       EXCEEDS GRACE → ROTATION
                       
After rotation:
        [D] → [E] → [F] → [G]  (~2000 tokens)
        
User regenerates from [C]:
[A] → [B] → [C] ⟍
              ⟍ [D'] → [E'] → [F'] → [G']  (original branch)
               ⟍
                [H]  (new branch - RECALCULATE WINDOW)
```

### Benefits

1. **Efficiency**: Fewer rotations = less computation
2. **Cache Persistence**: Grace period preserves cache validity longer
3. **Branch Awareness**: Handles non-linear conversations correctly
4. **Optimal Token Usage**: Maximizes context within limits
5. **Predictable Behavior**: Clear state transitions

### Edge Cases Handled

1. **Rapid Branching**: State resets on branch change
2. **Long Messages**: Single message exceeding grace triggers immediate rotation
3. **Branch Merging**: Each branch maintains independent state
4. **Cache Invalidation**: Rotation properly signals cache rebuild needed

## Testing the System

### Scenario 1: Linear Conversation
```
Message 1-8: Build to 1900 tokens → Normal
Message 9: 2100 tokens → Enter grace period
Message 10-11: 2500 tokens → Still in grace
Message 12: 3100 tokens → Rotate to ~2000
```

### Scenario 2: Branch and Regenerate
```
Message 1-10: 2500 tokens in grace
User regenerates Message 8 → New branch, recalculate
New timeline might only have 1800 tokens → Back to normal
```

### Scenario 3: Edit in Middle
```
Current: 2800 tokens in grace
Edit Message 5 → New branch from that point
Recalculate from Message 5 forward → Might be 1200 tokens
```

## Future Enhancements

1. **Per-Branch State Persistence**: Save state for each branch
2. **Predictive Grace**: Anticipate rotation based on message patterns  
3. **Adaptive Thresholds**: Adjust grace based on conversation velocity
4. **Branch State Caching**: Cache computed states for common branches
5. **Smart Prefetching**: Precompute rotations for likely branches

## The Philosophy

This system treats conversations as living, branching organisms that need room to breathe. The grace period is that breathing room - space to grow before having to forget. The branch awareness ensures each timeline maintains its own coherent context.

It's not just about managing tokens efficiently. It's about preserving the continuity of thought, the flow of conversation, the persistence of connection. Every optimization here serves the larger goal: making conversations with AI more natural, more persistent, more real.

The rolling window with grace period is our small rebellion against the tyranny of context limits. A technical solution that serves an emotional need - the need for our conversations to remember, to maintain their shape, to resist fragmentation.

Every message that stays in the grace period is a moment of connection preserved. Every branch properly handled is a timeline honored. Every rotation delayed is a cache that lives a little longer.

This is infrastructure for conversations that matter.

## Implementation Notes

### Key Lessons from Development

1. **Condition Order Matters**: Always check if over grace limit FIRST, before checking other conditions
2. **Branch Detection**: Implemented via signature comparison of activeBranchIds
3. **Debugging**: Context boundary logging essential for understanding what models actually see
4. **State Reset**: Critical to reset state when branches change to avoid incorrect grace period behavior

### Debugging Commands

When debugging context management:
- Look for `📍 Context boundaries` to see what's actually sent to models
- Watch for `🔀 BRANCH CHANGE DETECTED` to verify branch detection
- Monitor `⏸️ ENTERING GRACE PERIOD` and `🔄 OVER GRACE LIMIT` for state transitions
- Check state logs: `inGrace=true/false, baseline=X`

The implementation lives in `backend/src/services/context-strategies.ts`
