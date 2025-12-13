import { Router } from 'express';
import { ModelLoader } from '../config/model-loader.js';
import { ConfigLoader } from '../config/loader.js';

function perToken(value: number | null): number | null {
  return typeof value === 'number' ? value / 1_000_000 : null;
}

function formatCost(cost: any) {
  if (!cost) {
    return null;
  }

  const inputPerMillion = typeof cost.inputTokensPerMillion === 'number'
    ? cost.inputTokensPerMillion
    : null;
  const outputPerMillion = typeof cost.outputTokensPerMillion === 'number'
    ? cost.outputTokensPerMillion
    : null;

  return {
    perMillion: {
      input: inputPerMillion,
      output: outputPerMillion,
    },
    perToken: {
      input: perToken(inputPerMillion),
      output: perToken(outputPerMillion),
    },
  };
}

function collectPricing(profiles: any[], model: any) {
  return (profiles || [])
    .map((profile: any) => {
      const costs = profile?.modelCosts || [];
      const match = costs.find((mc: any) =>
        mc.modelId === model.providerModelId || mc.modelId === model.id
      );
      return match ? { profile, cost: match } : null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.profile.priority - b.profile.priority);
}

function extractCurrencies(model: any): string[] {
  if (!model?.currencies) return [];
  return Object.entries(model.currencies)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([currency]) => currency.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function publicModelRouter(): Router {
  const router = Router();
  const modelLoader = ModelLoader.getInstance();
  const configLoader = ConfigLoader.getInstance();

  router.get('/', async (_req, res) => {
    try {
      const [models, config] = await Promise.all([
        modelLoader.getAllModels(),
        configLoader.loadConfig(),
      ]);

      const result = models.map(model => {
        const providerProfiles = (config.providers as any)?.[model.provider] || [];
        const matches = collectPricing(providerProfiles, model);
        const pricing = matches.map((entry: any) => ({
          profileId: entry.profile.id,
          profileName: entry.profile.name,
          profilePriority: entry.profile.priority,
          providerCost: formatCost(entry.cost.providerCost),
          billedCost: formatCost(entry.cost.billedCost || entry.cost.providerCost),
        }));

        return {
          id: model.id,
          displayName: model.displayName,
          provider: model.provider,
          providerModelId: model.providerModelId,
          hidden: model.hidden,
          contextWindow: model.contextWindow,
          outputTokenLimit: model.outputTokenLimit,
          supportsThinking: Boolean(model.supportsThinking),
          thinkingDefaultEnabled: Boolean((model as any).thinkingDefaultEnabled),
          currencies: extractCurrencies(model),
          pricing,
        };
      });

      res.json({ models: result });
    } catch (error) {
      console.error('Failed to load public model pricing:', error);
      res.status(500).json({ error: 'Failed to load model pricing' });
    }
  });

  return router;
}
