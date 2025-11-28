# Metrics Audit - What We Calculate vs What We Show

**Context:** Request with 109 messages, 2 images, Append strategy  
**Logs:** Lines 146-247  
**UI:** Screenshot showing metrics panel

---

## TOKEN COUNTS - Three Different Numbers

### 1. "Current Conversation" (Our Calculation)

**Log line 150:**
```
🧮 Current conversation: 32,844 tokens in 109 messages
```

**What this is:**
- Our ESTIMATE using `getTotalTokens(allMessages)`
- Text: `content.length / 4`
- Images: 1500 tokens each (fixed)
- Used for: Cache point arithmetic

**Accuracy:** Approximate (±10-20%)

---

### 2. "Total Input" (Anthropic's Actual Count)

**Log line 214:**
```
[EnhancedInference] Total input=29,035, cache size=26,379
```

**What this is:**
- ACTUAL tokens from Anthropic API response
- `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
- Line 206: 2,656 + 0 + 26,379 = **29,035 tokens**
- Used for: Cost calculation, metrics

**Accuracy:** Exact (from Anthropic's tokenizer)

---

### 3. "Last Input" (UI Display)

**UI shows:** `29.0k`

**What this is:**
- `lastCompletion.inputTokens` from metrics
- Same as "Total Input" above
- Line 206: 2,656 fresh + 26,379 cached = 29,035 total

**Accuracy:** Exact ✅

**MATCH:** Log (29,035) ≈ UI (29.0k) ✅

---

## CACHE SIZE

### Our Calculation
**Log line 150:** 32,844 total tokens  
**Log line 163:** 99 messages cached

**Our cache size estimate:**
- Messages 0-98 cached (99 messages)
- We calculated ~29,896 tokens (line 161, cache point 4)

### Anthropic's Actual
**Log line 208:** `cache_read_input_tokens: 26,379`

### UI Display
**Screenshot:** `Cache Length: 26.4k`

**MATCH:** Log (26,379) ≈ UI (26.4k) ✅

---

## DISCREPANCY ANALYSIS

### Why Our Estimate (32,844) ≠ Anthropic's Actual (29,035)?

**Difference:** ~3,800 tokens (~12% overestimate)

**Possible causes:**

1. **Image token estimation**
   - We count: 1500 tokens per image (fixed)
   - Anthropic counts: Varies by image (actual vision model cost)
   - 2 images: we add 3000, reality might be 1800-2500

2. **Text token estimation**
   - We count: `content.length / 4`
   - Anthropic counts: Actual tokenizer (Claude's BPE)
   - Can differ by ±20% depending on content

3. **Attachment text**
   - We count text attachments as `length / 4`
   - Might not match Anthropic's tokenization

**Impact:**
- Cache points might be slightly off target (aiming for 7.5K, actually at 7.2K)
- But this is FINE - we're placing at message boundaries anyway
- Approximate is good enough for cache placement

---

## TOTAL TOKENS (Tree Size)

**UI shows:** `71.5k`

**What this is:**
- ALL content in ALL branches (not just active)
- Calculated in database: `totalTreeTokens`
- Represents full conversation data size

**Not directly comparable to:**
- Current conversation tokens (32,844) - only active branch
- Input tokens (29,035) - what was sent to API

**This is CORRECT** - different metric for different purpose ✅

---

## COST & SAVINGS

### Last Request

**Log line 241:** `costSaved: $0.0712`

**Calculation:**
```
Cached tokens: 26,379
Price per 1M (Opus): $15 input
Savings: 26,379 / 1,000,000 * $15 * 0.9 = $0.356
```

Wait, that doesn't match $0.0712...

Let me check the cost calculation:

**From code (anthropic.ts):**
```typescript
const pricePerToken = (pricingPer1M[modelId] || 3.00) / 1_000_000;
const savings = cachedTokens * pricePerToken * 0.9;
```

**For Opus:** $15 per 1M input  
**Cached:** 26,379 tokens  
**Savings:** 26,379 / 1,000,000 * $15 * 0.9 = **$0.356**

**But log shows:** $0.0712

**ISSUE:** Price table might not have Opus 4? Let me check...

Actually, looking at line 213-214:
```
Total input=29,035, cache size=26,379
```

If the calculation uses wrong pricing:
- 26,379 / 1,000,000 * $3.00 * 0.9 = $0.0712 ✅

**BUG:** Using Sonnet pricing ($3/1M) instead of Opus pricing ($15/1M)!

### UI Total Saved

**UI shows:** `$0.159`

This is cumulative across all completions. Multiple requests each saving $0.0712 (with wrong pricing) = $0.159 total.

**If we fix pricing:**
- Should show ~$0.80 saved (not $0.159)
- 5x underestimate!

---

## SUMMARY OF ISSUES

### ✅ CORRECT (Matches Between Log & UI)
1. Last Input: 29.0k tokens
2. Last Output: 566 tokens  
3. Cache Length: 26.4k tokens
4. Total Tokens: 71.5k (tree size, different metric)

### ⚠️ APPROXIMATE (Expected)
1. Our calculation (32,844) vs Anthropic actual (29,035)
   - Difference: ~12% due to estimation
   - Impact: Minimal (cache points slightly off target)
   - Status: **Acceptable**

### 🔴 WRONG (Bug to Fix)
1. **Cost savings calculation using wrong model pricing**
   - Uses $3/1M (Sonnet) for all models
   - Should use $15/1M for Opus
   - Impact: Savings shown as 5x smaller than reality
   - Status: **Needs fix**

---

## WHAT TO FIX

### Priority 1: Model-Specific Pricing

**File:** `anthropic.ts` and `enhanced-inference.ts`

**Current pricing table:**
```typescript
const pricingPer1M: Record<string, number> = {
  'claude-3-5-sonnet-20241022': 3.00,
  'claude-3-5-haiku-20241022': 0.25,
  'claude-3-opus-20240229': 15.00,
  // Missing: claude-opus-4, claude-sonnet-4, etc.
};
```

**Issue:** New models (Opus 4, Sonnet 4.5) not in table, fall back to default $3/1M

**Fix:** Add all models to pricing table OR extract pricing from model config

### Priority 2: Token Estimation Accuracy

**Current:**
- Images: 1500 tokens (rough estimate)
- Text: length / 4 (rough estimate)

**Better:**
- Use actual tokenizer (tiktoken for Claude)
- Or at least improve estimates based on actual usage data

**But this is OPTIONAL** - estimates are good enough for cache placement.

---

## RECOMMENDATION

**Fix model pricing immediately** - this affects user-facing savings numbers.

**Leave token estimation as-is** - approximate is fine for cache positioning.

**Document the differences:**
- "Estimated tokens" = our calculation (for cache placement)
- "Actual tokens" = from API (for billing/metrics)
- "Tree size" = all branches (for data size)

All three serve different purposes and that's OK!

