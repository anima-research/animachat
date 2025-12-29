import type { Model } from '@deprecated-claude/shared';

/**
 * Get a human-readable display name for a model ID.
 * Falls back to shortName, then the raw modelId if no match found.
 */
export function getModelDisplayName(modelId: string, models: Model[]): string {
  const model = models.find(m => m.id === modelId);
  return model?.displayName || model?.shortName || modelId;
}

