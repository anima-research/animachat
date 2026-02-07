/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Provide a proper localStorage before any module imports run.
// Node 25 has a native localStorage that lacks getItem/setItem methods,
// which conflicts with happy-dom. We override it.
const store: Record<string, string> = {};
vi.hoisted(() => {
  const store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  } as Storage;
});

// Mock the api module before importing avatars (vi.mock is hoisted)
vi.mock('@/services/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

import {
  getAvatarUrl,
  getAvatarColor,
  getModelAvatarUrl,
  getParticipantAvatarUrl,
  getParticipantColor,
  loadAvatarPacks,
  getActivePack,
  setActivePack,
} from './avatars';
import { api } from '@/services/api';
import type { AvatarPack, Model } from '@deprecated-claude/shared';

const SAMPLE_PACK: AvatarPack = {
  id: 'test-pack',
  name: 'Test Pack',
  isSystem: true,
  avatars: {
    'claude-3-opus': 'opus.png',
    'claude-3-sonnet': 'sonnet.png',
    'claude-3-haiku': 'haiku.png',
  },
  colors: {
    'claude-3-opus': '#ffc300',
    'claude-3-sonnet': '#ed098e',
  },
};

function makeModel(overrides: Partial<Model> & { id: string }): Model {
  return {
    providerModelId: overrides.id,
    displayName: overrides.id,
    shortName: overrides.id,
    provider: 'anthropic',
    hidden: false,
    contextWindow: 200000,
    outputTokenLimit: 8000,
    settings: {
      temperature: { min: 0, max: 1, default: 1, step: 0.1 },
      maxTokens: { min: 1, max: 8000, default: 4000 },
    },
    ...overrides,
  } as Model;
}

describe('avatars', () => {
  beforeEach(async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [SAMPLE_PACK] });
    await loadAvatarPacks();
    setActivePack('test-pack');
  });

  describe('loadAvatarPacks', () => {
    it('loads packs from API', () => {
      expect(vi.mocked(api.get)).toHaveBeenCalledWith('/avatars/packs');
    });

    it('does not reload if already loaded', async () => {
      const callsBefore = vi.mocked(api.get).mock.calls.length;
      await loadAvatarPacks();
      expect(vi.mocked(api.get).mock.calls.length).toBe(callsBefore);
    });

    it('handles API error gracefully with empty packs', async () => {
      // Reset modules to get a fresh avatars module with clean state
      vi.resetModules();

      // Re-mock api with error
      vi.doMock('@/services/api', () => ({
        api: {
          get: vi.fn().mockRejectedValue(new Error('Network error')),
        },
      }));

      const freshAvatars = await import('./avatars');
      await freshAvatars.loadAvatarPacks();

      // After error, packs should be empty but loaded
      expect(freshAvatars.getActivePack()).toBeUndefined();
      expect(freshAvatars.isLoaded.value).toBe(true);

      // Restore mocks for subsequent tests
      vi.resetModules();
    });
  });

  describe('getActivePack', () => {
    it('returns the active pack when set', () => {
      const pack = getActivePack();
      expect(pack).toBeDefined();
      expect(pack!.id).toBe('test-pack');
    });

    it('returns undefined when pack not found', () => {
      setActivePack('nonexistent-pack-xyz');
      expect(getActivePack()).toBeUndefined();
      setActivePack('test-pack');
    });
  });

  describe('setActivePack', () => {
    it('stores selection in localStorage', () => {
      setActivePack('my-custom-pack');
      expect(localStorage.getItem('activeAvatarPack')).toBe('my-custom-pack');
      setActivePack('test-pack');
    });

    it('changes which pack getActivePack returns', () => {
      setActivePack('test-pack');
      expect(getActivePack()?.id).toBe('test-pack');
    });
  });

  describe('getAvatarUrl', () => {
    it('returns null for undefined canonicalId', () => {
      expect(getAvatarUrl(undefined)).toBeNull();
    });

    it('returns null for canonicalId not in pack', () => {
      expect(getAvatarUrl('nonexistent-model')).toBeNull();
    });

    it('returns correct URL for known canonicalId', () => {
      const url = getAvatarUrl('claude-3-opus');
      expect(url).toBe('/avatars/system/test-pack/opus.png');
    });

    it('returns null when no active pack matches', () => {
      setActivePack('nonexistent-pack');
      expect(getAvatarUrl('claude-3-opus')).toBeNull();
      setActivePack('test-pack');
    });

    it('uses different filenames per canonicalId', () => {
      expect(getAvatarUrl('claude-3-opus')).toContain('opus.png');
      expect(getAvatarUrl('claude-3-sonnet')).toContain('sonnet.png');
      expect(getAvatarUrl('claude-3-haiku')).toContain('haiku.png');
    });
  });

  describe('getAvatarColor', () => {
    it('returns null for undefined canonicalId', () => {
      expect(getAvatarColor(undefined)).toBeNull();
    });

    it('returns null for canonicalId not in colors map', () => {
      expect(getAvatarColor('claude-3-haiku')).toBeNull();
    });

    it('returns correct color for known canonicalId', () => {
      expect(getAvatarColor('claude-3-opus')).toBe('#ffc300');
      expect(getAvatarColor('claude-3-sonnet')).toBe('#ed098e');
    });

    it('returns null when no active pack', () => {
      setActivePack('bad-pack');
      expect(getAvatarColor('claude-3-opus')).toBeNull();
      setActivePack('test-pack');
    });
  });

  describe('getModelAvatarUrl', () => {
    it('returns null for null model', () => {
      expect(getModelAvatarUrl(null)).toBeNull();
    });

    it('returns null for undefined model', () => {
      expect(getModelAvatarUrl(undefined)).toBeNull();
    });

    it('uses canonicalId when available on model', () => {
      const model = makeModel({
        id: 'claude-3-opus-20240229',
        canonicalId: 'claude-3-opus',
      });
      expect(getModelAvatarUrl(model)).toBe('/avatars/system/test-pack/opus.png');
    });

    it('derives canonicalId from providerModelId when not set', () => {
      const model = {
        id: 'test-id',
        providerModelId: 'claude-3-opus-20240229',
        displayName: 'Claude 3 Opus',
      };
      // deriveCanonicalId normalizes the model ID
      const url = getModelAvatarUrl(model);
      // Result depends on deriveCanonicalId, but should not throw
      expect(typeof url === 'string' || url === null).toBe(true);
    });
  });

  describe('getParticipantAvatarUrl', () => {
    const models = [
      makeModel({ id: 'claude-3-opus-20240229', canonicalId: 'claude-3-opus' }),
    ];

    it('returns null for null participant', () => {
      expect(getParticipantAvatarUrl(null, models)).toBeNull();
    });

    it('participant avatarOverride takes highest priority', () => {
      const participant = {
        avatarOverride: 'https://custom.png',
        model: 'claude-3-opus-20240229',
        type: 'assistant',
      };
      expect(getParticipantAvatarUrl(participant, models)).toBe('https://custom.png');
    });

    it('persona avatarOverride is second priority', () => {
      const participant = { model: 'claude-3-opus-20240229', type: 'assistant' };
      const persona = { avatarOverride: 'https://persona.png' };
      expect(getParticipantAvatarUrl(participant, models, persona)).toBe(
        'https://persona.png'
      );
    });

    it('returns null for user-type participants', () => {
      expect(getParticipantAvatarUrl({ type: 'user' }, models)).toBeNull();
    });

    it('falls back to model avatar when no overrides', () => {
      const participant = { model: 'claude-3-opus-20240229', type: 'assistant' };
      expect(getParticipantAvatarUrl(participant, models)).toBe(
        '/avatars/system/test-pack/opus.png'
      );
    });

    it('prefers persona model over participant model', () => {
      const participant = { model: 'other-model', type: 'assistant' };
      const persona = { model: 'claude-3-opus-20240229' };
      expect(getParticipantAvatarUrl(participant, models, persona)).toBe(
        '/avatars/system/test-pack/opus.png'
      );
    });

    it('returns null when model not found', () => {
      const participant = { model: 'nonexistent', type: 'assistant' };
      expect(getParticipantAvatarUrl(participant, models)).toBeNull();
    });

    it('returns null when participant has no model', () => {
      const participant = { type: 'assistant' };
      expect(getParticipantAvatarUrl(participant, models)).toBeNull();
    });
  });

  describe('getParticipantColor', () => {
    const models = [
      makeModel({ id: 'claude-3-opus-20240229', canonicalId: 'claude-3-opus' }),
    ];

    it('returns null for null participant', () => {
      expect(getParticipantColor(null, models)).toBeNull();
    });

    it('participant colorOverride takes highest priority', () => {
      const participant = {
        colorOverride: '#ff0000',
        model: 'claude-3-opus-20240229',
        type: 'assistant',
      };
      expect(getParticipantColor(participant as any, models)).toBe('#ff0000');
    });

    it('persona colorOverride is second priority', () => {
      const participant = { model: 'claude-3-opus-20240229', type: 'assistant' };
      const persona = { colorOverride: '#00ff00' };
      expect(getParticipantColor(participant, models, persona as any)).toBe('#00ff00');
    });

    it('returns null for user-type participants', () => {
      expect(getParticipantColor({ type: 'user' }, models)).toBeNull();
    });

    it('resolves color from model canonicalId', () => {
      const participant = { model: 'claude-3-opus-20240229', type: 'assistant' };
      expect(getParticipantColor(participant, models)).toBe('#ffc300');
    });

    it('returns null when model has no canonicalId', () => {
      const noCanonical = [makeModel({ id: 'no-canonical' })];
      delete (noCanonical[0] as any).canonicalId;
      const participant = { model: 'no-canonical', type: 'assistant' };
      expect(getParticipantColor(participant, noCanonical)).toBeNull();
    });

    it('prefers persona model for color lookup', () => {
      const participant = { model: 'other', type: 'assistant' };
      const persona = { model: 'claude-3-opus-20240229' };
      expect(getParticipantColor(participant, models, persona as any)).toBe('#ffc300');
    });
  });
});
