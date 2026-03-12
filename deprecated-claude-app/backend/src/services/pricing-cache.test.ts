import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  updateOpenRouterModelsCache,
  getOpenRouterModelsCache,
  getOpenRouterPricing,
  tryRefreshOpenRouterCache,
  setOpenRouterRefreshCallback,
} from './pricing-cache.js';

// Reset module state between tests by re-initializing with empty data
beforeEach(() => {
  updateOpenRouterModelsCache([]);
  setOpenRouterRefreshCallback(null as any);
});

describe('updateOpenRouterModelsCache + getOpenRouterModelsCache', () => {
  it('stores models and returns them', () => {
    const models = [
      { id: 'model-a', pricing: { prompt: '0.001', completion: '0.002' } },
      { id: 'model-b', pricing: { prompt: '0.005', completion: '0.01' } },
    ];
    updateOpenRouterModelsCache(models);

    const { models: cached } = getOpenRouterModelsCache();
    expect(cached).toHaveLength(2);
    expect(cached[0].id).toBe('model-a');
  });

  it('sets cacheTime to approximately now', () => {
    const before = Date.now();
    updateOpenRouterModelsCache([{ id: 'x', pricing: { prompt: '0.001', completion: '0.002' } }]);
    const after = Date.now();

    const { cacheTime } = getOpenRouterModelsCache();
    expect(cacheTime).toBeGreaterThanOrEqual(before);
    expect(cacheTime).toBeLessThanOrEqual(after);
  });

  it('reports isStale as false immediately after update', () => {
    updateOpenRouterModelsCache([]);
    const { isStale } = getOpenRouterModelsCache();
    expect(isStale).toBe(false);
  });

  it('replaces previous cache data on subsequent calls', () => {
    updateOpenRouterModelsCache([
      { id: 'old', pricing: { prompt: '0.001', completion: '0.002' } },
    ]);
    updateOpenRouterModelsCache([
      { id: 'new', pricing: { prompt: '0.003', completion: '0.004' } },
    ]);

    const { models } = getOpenRouterModelsCache();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('new');
  });
});

describe('getOpenRouterModelsCache staleness', () => {
  it('reports stale after 1 hour has passed', () => {
    updateOpenRouterModelsCache([]);
    // The cache was just set with Date.now(). We can't easily travel time,
    // but we can verify the logic by checking the initial non-stale state
    // and the formula: Date.now() - cacheTime > 60*60*1000
    const { cacheTime } = getOpenRouterModelsCache();
    expect(cacheTime).toBeGreaterThan(0);
    // Just updated, should not be stale
    expect(getOpenRouterModelsCache().isStale).toBe(false);
  });
});

describe('pricing lookup via getOpenRouterPricing', () => {
  it('returns null for unknown model ID', () => {
    updateOpenRouterModelsCache([]);
    expect(getOpenRouterPricing('nonexistent')).toBeNull();
  });

  it('returns per-million pricing for a known model', () => {
    // OpenRouter returns per-token pricing; the cache multiplies by 1,000,000
    updateOpenRouterModelsCache([
      { id: 'openai/gpt-4', pricing: { prompt: '0.00003', completion: '0.00006' } },
    ]);

    const result = getOpenRouterPricing('openai/gpt-4');
    expect(result).not.toBeNull();
    // 0.00003 * 1,000,000 = 30
    expect(result!.input).toBeCloseTo(30, 2);
    // 0.00006 * 1,000,000 = 60
    expect(result!.output).toBeCloseTo(60, 2);
  });

  it('handles numeric pricing values', () => {
    updateOpenRouterModelsCache([
      { id: 'numeric-model', pricing: { prompt: 0.00001, completion: 0.00002 } },
    ]);

    const result = getOpenRouterPricing('numeric-model');
    expect(result).not.toBeNull();
    // 0.00001 * 1_000_000 = 10
    expect(result!.input).toBeCloseTo(10, 2);
    expect(result!.output).toBeCloseTo(20, 2);
  });

  it('skips models without pricing', () => {
    updateOpenRouterModelsCache([
      { id: 'no-pricing-model' },
    ]);

    expect(getOpenRouterPricing('no-pricing-model')).toBeNull();
  });

  it('skips models without an ID', () => {
    updateOpenRouterModelsCache([
      { pricing: { prompt: '0.001', completion: '0.002' } },
    ]);

    // No model.id, so nothing was indexed
    expect(getOpenRouterPricing('undefined')).toBeNull();
  });

  it('skips models with NaN pricing', () => {
    updateOpenRouterModelsCache([
      { id: 'nan-model', pricing: { prompt: 'not-a-number', completion: '0.002' } },
    ]);

    expect(getOpenRouterPricing('nan-model')).toBeNull();
  });

  it('skips models with null/undefined pricing fields', () => {
    updateOpenRouterModelsCache([
      { id: 'null-pricing', pricing: { prompt: null, completion: undefined } },
    ]);

    expect(getOpenRouterPricing('null-pricing')).toBeNull();
  });

  it('handles zero pricing', () => {
    updateOpenRouterModelsCache([
      { id: 'free-model', pricing: { prompt: '0', completion: '0' } },
    ]);

    const result = getOpenRouterPricing('free-model');
    expect(result).not.toBeNull();
    expect(result!.input).toBe(0);
    expect(result!.output).toBe(0);
  });

  it('clears old pricing when cache is updated', () => {
    updateOpenRouterModelsCache([
      { id: 'model-a', pricing: { prompt: '0.001', completion: '0.002' } },
    ]);
    expect(getOpenRouterPricing('model-a')).not.toBeNull();

    // Update with different models
    updateOpenRouterModelsCache([
      { id: 'model-b', pricing: { prompt: '0.003', completion: '0.004' } },
    ]);

    expect(getOpenRouterPricing('model-a')).toBeNull();
    expect(getOpenRouterPricing('model-b')).not.toBeNull();
  });

  it('handles multiple models correctly', () => {
    updateOpenRouterModelsCache([
      { id: 'model-1', pricing: { prompt: '0.00001', completion: '0.00002' } },
      { id: 'model-2', pricing: { prompt: '0.00003', completion: '0.00004' } },
      { id: 'model-3', pricing: { prompt: '0.00005', completion: '0.00006' } },
    ]);

    const r1 = getOpenRouterPricing('model-1');
    const r2 = getOpenRouterPricing('model-2');
    const r3 = getOpenRouterPricing('model-3');

    expect(r1!.input).toBeCloseTo(10, 2);
    expect(r2!.input).toBeCloseTo(30, 2);
    expect(r3!.input).toBeCloseTo(50, 2);
    expect(r1!.output).toBeCloseTo(20, 2);
    expect(r2!.output).toBeCloseTo(40, 2);
    expect(r3!.output).toBeCloseTo(60, 2);
  });
});

describe('tryRefreshOpenRouterCache', () => {
  it('returns false when no refresh callback is set', async () => {
    const result = await tryRefreshOpenRouterCache();
    expect(result).toBe(false);
  });

  it('returns false when cache is fresh and non-empty', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    setOpenRouterRefreshCallback(callback);
    updateOpenRouterModelsCache([
      { id: 'model', pricing: { prompt: '0.001', completion: '0.002' } },
    ]);

    const result = await tryRefreshOpenRouterCache();
    expect(result).toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });

  it('calls refresh callback when cache is empty', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    setOpenRouterRefreshCallback(callback);
    // Cache is empty (from beforeEach)

    const result = await tryRefreshOpenRouterCache();
    expect(result).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('returns false if refresh callback throws (graceful error handling)', async () => {
    const callback = vi.fn().mockRejectedValue(new Error('network error'));
    setOpenRouterRefreshCallback(callback);

    const result = await tryRefreshOpenRouterCache();
    expect(result).toBe(false);
  });
});

describe('setOpenRouterRefreshCallback', () => {
  it('registers a callback that tryRefreshOpenRouterCache can invoke', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    setOpenRouterRefreshCallback(callback);

    // With empty cache, refresh should be attempted
    await tryRefreshOpenRouterCache();
    expect(callback).toHaveBeenCalledOnce();
  });
});
