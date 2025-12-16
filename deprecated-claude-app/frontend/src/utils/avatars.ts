import { ref, computed } from 'vue';
import { api } from '@/services/api';
import type { AvatarPack, Model } from '@deprecated-claude/shared';
import { deriveCanonicalId } from '@deprecated-claude/shared';

// Cache for avatar packs
const avatarPacks = ref<AvatarPack[]>([]);
const packsLoaded = ref(false);
const activePackId = ref<string>('anima-discord'); // Default to system pack

// Load avatar packs
export async function loadAvatarPacks(): Promise<void> {
  if (packsLoaded.value) return;
  
  try {
    const response = await api.get('/avatars/packs');
    avatarPacks.value = response.data;
    packsLoaded.value = true;
  } catch (error) {
    console.error('Failed to load avatar packs:', error);
    // Create a minimal fallback
    avatarPacks.value = [];
    packsLoaded.value = true;
  }
}

// Get the currently active avatar pack
export function getActivePack(): AvatarPack | undefined {
  return avatarPacks.value.find(p => p.id === activePackId.value);
}

// Set the active avatar pack
export function setActivePack(packId: string): void {
  activePackId.value = packId;
  localStorage.setItem('activeAvatarPack', packId);
}

// Initialize from localStorage
const savedPackId = localStorage.getItem('activeAvatarPack');
if (savedPackId) {
  activePackId.value = savedPackId;
}

/**
 * Get avatar URL for a model by its canonicalId
 */
export function getAvatarUrl(canonicalId: string | undefined): string | null {
  if (!canonicalId) return null;
  
  const pack = getActivePack();
  if (!pack || !pack.avatars) return null;
  
  const filename = pack.avatars[canonicalId];
  if (!filename) return null;
  
  // Construct URL based on pack type
  const packPath = (pack as any).path || `system/${pack.id}`;
  return `/avatars/${packPath}/${filename}`;
}

/**
 * Get nickname color for a model by its canonicalId
 */
export function getAvatarColor(canonicalId: string | undefined): string | null {
  if (!canonicalId) return null;
  
  const pack = getActivePack();
  if (!pack || !pack.colors) return null;
  
  return pack.colors[canonicalId] || null;
}

/**
 * Get avatar URL for a model object
 */
export function getModelAvatarUrl(model: Model | { canonicalId?: string; id?: string; providerModelId?: string } | null | undefined): string | null {
  if (!model) return null;
  
  // Use explicit canonicalId if available
  if (model.canonicalId) {
    return getAvatarUrl(model.canonicalId);
  }
  
  // Try to derive canonicalId from model info
  const modelId = (model as any).providerModelId || (model as any).id || '';
  const displayName = (model as any).displayName || '';
  const derived = deriveCanonicalId(modelId, displayName);
  
  return getAvatarUrl(derived);
}

/**
 * Get avatar URL for a participant
 * Resolution order: participant.avatarOverride > persona.avatarOverride > model.canonicalId
 */
export function getParticipantAvatarUrl(
  participant: { 
    avatarOverride?: string; 
    model?: string; 
    type?: string;
  } | null | undefined,
  models: Model[],
  persona?: { avatarOverride?: string; model?: string } | null
): string | null {
  if (!participant) return null;
  
  // Check participant override
  if (participant.avatarOverride) {
    return participant.avatarOverride;
  }
  
  // Check persona override
  if (persona?.avatarOverride) {
    return persona.avatarOverride;
  }
  
  // For user participants, no avatar (could add user avatar support later)
  if (participant.type === 'user') {
    return null;
  }
  
  // Look up model
  const modelId = persona?.model || participant.model;
  if (!modelId) return null;
  
  const model = models.find(m => m.id === modelId);
  return getModelAvatarUrl(model);
}

/**
 * Get nickname color for a participant based on their model's canonicalId
 */
export function getParticipantColor(
  participant: { 
    colorOverride?: string; 
    model?: string; 
    type?: string;
  } | null | undefined,
  models: Model[],
  persona?: { colorOverride?: string; model?: string } | null
): string | null {
  if (!participant) return null;
  
  // Check participant override
  if ((participant as any).colorOverride) {
    return (participant as any).colorOverride;
  }
  
  // Check persona override
  if ((persona as any)?.colorOverride) {
    return (persona as any).colorOverride;
  }
  
  // For user participants, no color
  if (participant.type === 'user') {
    return null;
  }
  
  // Look up model
  const modelId = persona?.model || participant.model;
  if (!modelId) return null;
  
  const model = models.find(m => m.id === modelId);
  if (!model?.canonicalId) return null;
  
  return getAvatarColor(model.canonicalId);
}

/**
 * Derive canonicalId for a dynamically added model (e.g., from OpenRouter)
 * This is exported for use by the custom models module
 */
export { deriveCanonicalId } from '@deprecated-claude/shared';

// Reactive exports for Vue components
export const packs = computed(() => avatarPacks.value);
export const activePack = computed(() => getActivePack());
export const isLoaded = computed(() => packsLoaded.value);

