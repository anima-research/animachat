/**
 * Shared pricing cache for dynamic model pricing lookup.
 * Caches pricing from OpenRouter API for cost calculations.
 */

interface CachedPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedAt: number;
}

// OpenRouter models cache - populated by models.ts route, used by enhanced-inference.ts
let openRouterModelsCache: any[] = [];
let openRouterCacheTime: number = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Parsed pricing lookup (computed from models cache)
const pricingLookup: Map<string, CachedPricing> = new Map();

// Optional refresh callback - set by index.ts on startup
let refreshCallback: (() => Promise<void>) | null = null;
let isRefreshing = false;

/**
 * Register a callback that can refresh the OpenRouter cache on-demand
 */
export function setOpenRouterRefreshCallback(callback: () => Promise<void>): void {
  refreshCallback = callback;
}

/**
 * Try to refresh the cache if it's empty or stale
 * Returns true if refresh was attempted
 */
export async function tryRefreshOpenRouterCache(): Promise<boolean> {
  if (!refreshCallback) return false;
  if (isRefreshing) return false; // Prevent concurrent refreshes
  
  const { models, isStale } = getOpenRouterModelsCache();
  if (models.length > 0 && !isStale) return false; // Cache is fine
  
  try {
    isRefreshing = true;
    console.log('[PricingCache] Attempting lazy refresh of OpenRouter cache...');
    await refreshCallback();
    return true;
  } catch (error) {
    console.error('[PricingCache] Failed to refresh OpenRouter cache:', error);
    return false;
  } finally {
    isRefreshing = false;
  }
}

/**
 * Update the OpenRouter models cache (called from models.ts route)
 */
export function updateOpenRouterModelsCache(models: any[]): void {
  openRouterModelsCache = models;
  openRouterCacheTime = Date.now();
  
  // Rebuild pricing lookup
  pricingLookup.clear();
  for (const model of models) {
    if (model.id && model.pricing) {
      const inputPrice = parsePrice(model.pricing.prompt);
      const outputPrice = parsePrice(model.pricing.completion);
      
      if (inputPrice !== null && outputPrice !== null) {
        pricingLookup.set(model.id, {
          inputPerMillion: inputPrice * 1_000_000,
          outputPerMillion: outputPrice * 1_000_000,
          cachedAt: openRouterCacheTime
        });
      }
    }
  }
  
  console.log(`[PricingCache] Updated with ${pricingLookup.size} OpenRouter model prices`);
}

/**
 * Get cached OpenRouter models
 */
export function getOpenRouterModelsCache(): { models: any[], cacheTime: number, isStale: boolean } {
  return {
    models: openRouterModelsCache,
    cacheTime: openRouterCacheTime,
    isStale: Date.now() - openRouterCacheTime > CACHE_TTL
  };
}

/**
 * Look up pricing for an OpenRouter model by its providerModelId
 * Returns { input, output } in per-million rates, or null if not found
 */
export function getOpenRouterPricing(providerModelId: string): { input: number; output: number } | null {
  const cached = pricingLookup.get(providerModelId);
  if (cached) {
    return {
      input: cached.inputPerMillion,
      output: cached.outputPerMillion
    };
  }
  return null;
}

/**
 * Parse price from OpenRouter format (can be string or number, per-token)
 */
function parsePrice(price: string | number | undefined): number | null {
  if (price === undefined || price === null) return null;
  
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(num)) return null;
  
  return num; // OpenRouter returns per-token pricing
}

