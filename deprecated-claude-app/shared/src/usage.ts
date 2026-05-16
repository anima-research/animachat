/**
 * Per-channel token accounting for a single provider API call.
 *
 * Every billable channel that a provider exposes gets its own field. Channels are
 * priced at different multiples of the model's base input/output rate, so collapsing
 * them into a single `inputTokens` field (and applying a flat 90% "savings" discount)
 * structurally undercounts cache-creation and overcounts cache-read parity.
 *
 * The shape is provider-agnostic: each provider's extraction layer maps its native
 * response fields onto this schema, leaving unknown channels at 0.
 */
export interface ChannelTokens {
  /** Fresh (non-cached, non-thinking) prompt tokens. Billed at the model's base input rate. */
  freshInput: number;
  /** Prompt tokens written to cache this call. Billed at base input × creation multiplier (see `cacheCreationTtl`). */
  cacheCreationInput: number;
  /** TTL of the cache writes in this call. Determines which creation multiplier applies. Defaults to '1h' (matches current cache_control behavior). */
  cacheCreationTtl?: '5m' | '1h';
  /** Prompt tokens read from cache this call. Billed at base input × read multiplier (typically 0.1×). */
  cacheReadInput: number;
  /** Completion tokens (everything the model emits that isn't separately broken out). Billed at base output rate. */
  output: number;
  /**
   * Extended-thinking / reasoning tokens, when the provider reports them as a separate
   * channel from regular output (Gemini `thoughtsTokenCount`; OpenRouter
   * `completion_tokens_details.reasoning_tokens`). When the provider folds reasoning
   * into `output_tokens` (Anthropic), leave this at 0.
   * Billed at base output × thinking multiplier (default 1.0× — same as output).
   */
  thinking?: number;
  /** Gemini-specific: tokens spent on tool-use prompt scaffolding. Billed as input. */
  toolUsePrompt?: number;
}

/**
 * Per-model multipliers applied to the base input/output prices for the non-fresh-input
 * and non-output channels. The set of channels here matches the optional fields in
 * `ChannelTokens` that aren't priced at the base rate.
 *
 * Anthropic's published values are the defaults; other providers' overrides can be
 * configured per-model in `production-models.json` when their cache pricing differs.
 */
export interface CachePricingMultipliers {
  /** Multiplier on base input price for cache-read tokens. */
  read: number;
  /** Multiplier on base input price for cache-creation tokens with 5-minute TTL. */
  creation5m: number;
  /** Multiplier on base input price for cache-creation tokens with 1-hour TTL. */
  creation1h: number;
  /** Multiplier on base output price for thinking/reasoning tokens. Optional — defaults to 1.0×. */
  thinking?: number;
}

/**
 * Anthropic's published prompt-cache pricing multipliers, applied to the base input price.
 *
 * Reference: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#pricing
 *  - Cache read:                        0.1× input  (90% discount)
 *  - Cache creation, 5-minute TTL:      1.25× input (25% premium)
 *  - Cache creation, 1-hour TTL:        2.0× input  (100% premium)
 *
 * Used as the default when a model's `ModelCost.cachePricing` is not configured.
 */
export const DEFAULT_ANTHROPIC_CACHE_MULTIPLIERS: Required<CachePricingMultipliers> = {
  read: 0.1,
  creation5m: 1.25,
  creation1h: 2.0,
  thinking: 1.0,
};

/**
 * One `UsageRecord` is emitted per provider API call — not per user message.
 *
 * Branches (parallel sampling), retried streams, tool-use rounds, and aborted streams
 * that produced partial output each emit their own record. Aggregation is a flat sum
 * over records; nothing is deduplicated upstream.
 *
 * The `tokens` block is the source of truth. `computedCost` is a cache of the
 * tokens-times-pricing-table math, allowed to lag if the pricing table changes —
 * the raw tokens let us re-derive correct historic costs after pricing fixes.
 *
 * When a provider returns ground-truth cost directly (OpenRouter via `usage.cost`),
 * it lands in `providerReportedCost` and overrides `computedCost` for aggregation
 * purposes. The two values are kept side-by-side so that `pricingDriftDelta` can
 * surface pricing-table drift as a continuous regression signal.
 */
export interface UsageRecord {
  /** Stable id for dedup across retries and replay. */
  id: string;
  /** ISO-8601 timestamp of when the API call completed (or aborted). */
  timestamp: string;
  conversationId: string;
  /** The message this call produced (or attempted to produce). */
  messageId: string;
  /** Branch index within the message for parallel-sampling generations. 0 for single-sample. */
  branchIndex: number;
  /** Which participant the call was made for. Optional for legacy events. */
  participantId?: string;
  /** Provider tag — 'anthropic' | 'bedrock' | 'openrouter' | 'gemini' | 'openai-compatible'. */
  provider: string;
  /** Display name or providerModelId — used for per-model rollup in the UI. */
  model: string;
  /** Raw per-channel token counts. Source of truth. */
  tokens: ChannelTokens;
  /**
   * Cost reported directly by the provider's response (currently OpenRouter only,
   * via `usage.cost` when `usage: { include: true }` is requested). Authoritative
   * when present.
   */
  providerReportedCost?: number;
  /**
   * Cost we computed from `tokens` × pricing table at the time of write. Cached for
   * fast display; can be re-derived from `tokens` if the pricing table is corrected.
   */
  computedCost?: number;
  /**
   * `computedCost − providerReportedCost`. Non-null only when both are set. Positive
   * means our table overestimates; negative means we underestimate. A persistent
   * non-zero drift is a signal that the pricing table is stale.
   */
  pricingDriftDelta?: number;
  /** Hash or version stamp of the pricing table snapshot used to compute `computedCost`. */
  pricingVersion?: string;
  /** Whether the API call completed cleanly. Partial output from aborted/errored streams is still billed by the provider. */
  status: 'complete' | 'aborted' | 'errored';
}
