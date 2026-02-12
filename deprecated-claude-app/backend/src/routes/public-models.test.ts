import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';

/**
 * Public-models route characterization tests.
 *
 * The publicModelRouter() depends on ModelLoader and ConfigLoader singletons.
 * We mock both to provide controlled model and config data so we can
 * verify the route's pricing collection, cost formatting, and currency
 * extraction logic.
 */

// Mock ModelLoader and ConfigLoader
const mockGetAllModels = vi.fn();
const mockLoadConfig = vi.fn();

vi.mock('../config/model-loader.js', () => ({
  ModelLoader: {
    getInstance: () => ({
      getAllModels: mockGetAllModels,
    }),
  },
}));

vi.mock('../config/loader.js', () => ({
  ConfigLoader: {
    getInstance: () => ({
      loadConfig: mockLoadConfig,
    }),
  },
}));

import { publicModelRouter } from './public-models.js';

let app: express.Express;
let request: supertest.Agent;

beforeEach(() => {
  mockGetAllModels.mockReset();
  mockLoadConfig.mockReset();

  app = express();
  app.use('/api/public/models', publicModelRouter());
  request = supertest(app);
});

function makeModel(overrides: Record<string, any> = {}) {
  return {
    id: 'claude-sonnet-4-5',
    displayName: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    providerModelId: 'claude-sonnet-4-5-20250929',
    hidden: false,
    contextWindow: 200000,
    outputTokenLimit: 64000,
    supportsThinking: true,
    thinkingDefaultEnabled: false,
    currencies: {},
    ...overrides,
  };
}

describe('Public models routes', () => {
  describe('GET /api/public/models', () => {
    it('returns model list with core fields', async () => {
      mockGetAllModels.mockResolvedValue([makeModel()]);
      mockLoadConfig.mockResolvedValue({ providers: {} });

      const res = await request.get('/api/public/models');
      expect(res.status).toBe(200);
      expect(res.body.models).toHaveLength(1);

      const model = res.body.models[0];
      expect(model.id).toBe('claude-sonnet-4-5');
      expect(model.displayName).toBe('Claude Sonnet 4.5');
      expect(model.provider).toBe('anthropic');
      expect(model.contextWindow).toBe(200000);
      expect(model.outputTokenLimit).toBe(64000);
      expect(model.supportsThinking).toBe(true);
      expect(model.thinkingDefaultEnabled).toBe(false);
      expect(model.pricing).toEqual([]);
      expect(model.currencies).toEqual([]);
    });

    it('extracts and sorts currencies', async () => {
      mockGetAllModels.mockResolvedValue([
        makeModel({
          currencies: { Opus: true, Sonnets: true, Haiku: false },
        }),
      ]);
      mockLoadConfig.mockResolvedValue({ providers: {} });

      const res = await request.get('/api/public/models');
      expect(res.status).toBe(200);

      const currencies = res.body.models[0].currencies;
      expect(currencies).toEqual(['Opus', 'Sonnets']); // sorted, Haiku excluded (false)
    });

    it('collects pricing from matching provider profiles', async () => {
      mockGetAllModels.mockResolvedValue([
        makeModel({ id: 'my-model', providerModelId: 'my-model-v1' }),
      ]);
      mockLoadConfig.mockResolvedValue({
        providers: {
          anthropic: [
            {
              id: 'profile-1',
              name: 'Primary',
              priority: 1,
              modelCosts: [
                {
                  modelId: 'my-model-v1',
                  providerCost: {
                    inputTokensPerMillion: 3,
                    outputTokensPerMillion: 15,
                  },
                  billedCost: {
                    inputTokensPerMillion: 5,
                    outputTokensPerMillion: 25,
                  },
                },
              ],
            },
          ],
        },
      });

      const res = await request.get('/api/public/models');
      expect(res.status).toBe(200);

      const pricing = res.body.models[0].pricing;
      expect(pricing).toHaveLength(1);
      expect(pricing[0].profileId).toBe('profile-1');
      expect(pricing[0].profileName).toBe('Primary');
      expect(pricing[0].profilePriority).toBe(1);

      // Provider cost
      expect(pricing[0].providerCost.perMillion.input).toBe(3);
      expect(pricing[0].providerCost.perMillion.output).toBe(15);
      expect(pricing[0].providerCost.perToken.input).toBe(3 / 1_000_000);
      expect(pricing[0].providerCost.perToken.output).toBe(15 / 1_000_000);

      // Billed cost
      expect(pricing[0].billedCost.perMillion.input).toBe(5);
      expect(pricing[0].billedCost.perMillion.output).toBe(25);
    });

    it('falls back to providerCost when billedCost is missing', async () => {
      mockGetAllModels.mockResolvedValue([
        makeModel({ providerModelId: 'model-x' }),
      ]);
      mockLoadConfig.mockResolvedValue({
        providers: {
          anthropic: [
            {
              id: 'p1',
              name: 'P1',
              priority: 1,
              modelCosts: [
                {
                  modelId: 'model-x',
                  providerCost: {
                    inputTokensPerMillion: 10,
                    outputTokensPerMillion: 30,
                  },
                  // no billedCost
                },
              ],
            },
          ],
        },
      });

      const res = await request.get('/api/public/models');
      const pricing = res.body.models[0].pricing;
      expect(pricing[0].billedCost.perMillion.input).toBe(10);
      expect(pricing[0].billedCost.perMillion.output).toBe(30);
    });

    it('handles null cost values gracefully', async () => {
      mockGetAllModels.mockResolvedValue([
        makeModel({ providerModelId: 'model-y' }),
      ]);
      mockLoadConfig.mockResolvedValue({
        providers: {
          anthropic: [
            {
              id: 'p2',
              name: 'P2',
              priority: 1,
              modelCosts: [
                {
                  modelId: 'model-y',
                  providerCost: null,
                },
              ],
            },
          ],
        },
      });

      const res = await request.get('/api/public/models');
      // Model should still render, just with no pricing matches
      expect(res.status).toBe(200);
    });

    it('matches by model id OR providerModelId', async () => {
      mockGetAllModels.mockResolvedValue([
        makeModel({ id: 'logical-id', providerModelId: 'provider-id' }),
      ]);
      mockLoadConfig.mockResolvedValue({
        providers: {
          anthropic: [
            {
              id: 'p3',
              name: 'P3',
              priority: 1,
              modelCosts: [
                {
                  modelId: 'logical-id', // matches by .id not providerModelId
                  providerCost: {
                    inputTokensPerMillion: 1,
                    outputTokensPerMillion: 2,
                  },
                },
              ],
            },
          ],
        },
      });

      const res = await request.get('/api/public/models');
      expect(res.body.models[0].pricing).toHaveLength(1);
    });

    it('sorts pricing by profile priority', async () => {
      mockGetAllModels.mockResolvedValue([
        makeModel({ providerModelId: 'model-z' }),
      ]);
      mockLoadConfig.mockResolvedValue({
        providers: {
          anthropic: [
            {
              id: 'low-pri',
              name: 'Low Priority',
              priority: 10,
              modelCosts: [{ modelId: 'model-z', providerCost: { inputTokensPerMillion: 1, outputTokensPerMillion: 1 } }],
            },
            {
              id: 'high-pri',
              name: 'High Priority',
              priority: 1,
              modelCosts: [{ modelId: 'model-z', providerCost: { inputTokensPerMillion: 2, outputTokensPerMillion: 2 } }],
            },
          ],
        },
      });

      const res = await request.get('/api/public/models');
      const pricing = res.body.models[0].pricing;
      expect(pricing).toHaveLength(2);
      expect(pricing[0].profilePriority).toBe(1);
      expect(pricing[1].profilePriority).toBe(10);
    });

    it('returns empty models array when no models exist', async () => {
      mockGetAllModels.mockResolvedValue([]);
      mockLoadConfig.mockResolvedValue({ providers: {} });

      const res = await request.get('/api/public/models');
      expect(res.status).toBe(200);
      expect(res.body.models).toEqual([]);
    });

    it('returns 500 when ModelLoader throws', async () => {
      mockGetAllModels.mockRejectedValue(new Error('disk error'));
      mockLoadConfig.mockResolvedValue({ providers: {} });

      const res = await request.get('/api/public/models');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to load model pricing');
    });

    it('marks hidden models as hidden', async () => {
      mockGetAllModels.mockResolvedValue([makeModel({ hidden: true })]);
      mockLoadConfig.mockResolvedValue({ providers: {} });

      const res = await request.get('/api/public/models');
      expect(res.body.models[0].hidden).toBe(true);
    });
  });
});
