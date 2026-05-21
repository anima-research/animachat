import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SiteConfig } from '@deprecated-claude/shared';
import { defaultSiteConfig } from '@deprecated-claude/shared';

// Use vi.hoisted to create a stable mock reference that survives module resets
const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

vi.mock('../services/api', () => ({
  api: { get: mockGet },
}));

// Custom config for testing
const customConfig: SiteConfig = {
  branding: {
    name: 'Test App',
    tagline: 'Testing composable',
    logoVariant: 'custom',
  },
  links: {
    discord: 'https://discord.test',
    github: 'https://github.test',
    parentSite: null,
    documentation: null,
    exportTool: null,
  },
  operator: {
    name: 'Test Operator',
    contactEmail: 'test@test.com',
    contactDiscord: null,
  },
  features: {
    showTestimonials: true,
    showPhilosophy: false,
    showEcosystem: true,
    showVoices: false,
  },
  content: {},
};

describe('useSiteConfig', () => {
  let useSiteConfig: typeof import('./useSiteConfig').useSiteConfig;

  beforeEach(async () => {
    mockGet.mockReset();
    // Reset module registry so composable gets fresh singleton refs
    vi.resetModules();
    const mod = await import('./useSiteConfig');
    useSiteConfig = mod.useSiteConfig;
  });

  describe('initial state', () => {
    it('returns default config before loading', () => {
      const { config, isLoaded, isLoading, loadError } = useSiteConfig();

      expect(config.value).toEqual(defaultSiteConfig);
      expect(isLoaded.value).toBe(false);
      expect(isLoading.value).toBe(false);
      expect(loadError.value).toBeNull();
    });

    it('provides convenience getters matching defaults', () => {
      const composable = useSiteConfig();

      expect(composable.branding).toEqual(defaultSiteConfig.branding);
      expect(composable.links).toEqual(defaultSiteConfig.links);
      expect(composable.operator).toEqual(defaultSiteConfig.operator);
      expect(composable.features).toEqual(defaultSiteConfig.features);
      expect(composable.content).toEqual(defaultSiteConfig.content);
    });

    it('getConfig returns default synchronously before loading', () => {
      const { getConfig } = useSiteConfig();
      expect(getConfig()).toEqual(defaultSiteConfig);
    });
  });

  describe('ensureLoaded / loadSiteConfig', () => {
    it('loads config from API and updates state', async () => {
      mockGet.mockResolvedValue({ data: customConfig });

      const { ensureLoaded, config, isLoaded, isLoading, loadError } = useSiteConfig();
      const result = await ensureLoaded();

      expect(mockGet).toHaveBeenCalledWith('/site-config');
      expect(result).toEqual(customConfig);
      expect(config.value).toEqual(customConfig);
      expect(isLoaded.value).toBe(true);
      expect(isLoading.value).toBe(false);
      expect(loadError.value).toBeNull();
    });

    it('returns cached config on second call (no duplicate fetch)', async () => {
      mockGet.mockResolvedValue({ data: customConfig });

      const { ensureLoaded } = useSiteConfig();
      await ensureLoaded();
      const result = await ensureLoaded();

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(result).toEqual(customConfig);
    });

    it('deduplicates concurrent loads (single promise)', async () => {
      let resolveApi!: (value: any) => void;
      mockGet.mockReturnValue(new Promise(r => { resolveApi = r; }));

      const { ensureLoaded, isLoading } = useSiteConfig();

      const promise1 = ensureLoaded();
      const promise2 = ensureLoaded();

      expect(isLoading.value).toBe(true);
      expect(mockGet).toHaveBeenCalledTimes(1);

      resolveApi({ data: customConfig });
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual(customConfig);
      expect(result2).toEqual(customConfig);
    });

    it('sets isLoading during fetch then clears it', async () => {
      let resolveApi!: (value: any) => void;
      mockGet.mockReturnValue(new Promise(r => { resolveApi = r; }));

      const { ensureLoaded, isLoading } = useSiteConfig();
      expect(isLoading.value).toBe(false);

      const promise = ensureLoaded();
      expect(isLoading.value).toBe(true);

      resolveApi({ data: customConfig });
      await promise;
      expect(isLoading.value).toBe(false);
    });
  });

  describe('error handling', () => {
    it('falls back to defaults on API error', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const { ensureLoaded, config, isLoaded, loadError } = useSiteConfig();
      const result = await ensureLoaded();

      expect(result).toEqual(defaultSiteConfig);
      expect(config.value).toEqual(defaultSiteConfig);
      expect(isLoaded.value).toBe(true);
      expect(loadError.value).toBe('Network error');
    });

    it('handles error without message property', async () => {
      mockGet.mockRejectedValue({});

      const { ensureLoaded, loadError } = useSiteConfig();
      await ensureLoaded();

      expect(loadError.value).toBe('Failed to load site configuration');
    });

    it('clears loadPromise after error so reload works', async () => {
      mockGet
        .mockRejectedValueOnce(new Error('first fail'))
        .mockResolvedValueOnce({ data: customConfig });

      const { ensureLoaded, reloadConfig, config } = useSiteConfig();

      await ensureLoaded();
      const result = await reloadConfig();

      expect(result).toEqual(customConfig);
      expect(config.value).toEqual(customConfig);
    });
  });

  describe('reloadConfig', () => {
    it('forces a fresh fetch ignoring cache', async () => {
      const config2: SiteConfig = {
        ...customConfig,
        branding: { ...customConfig.branding, name: 'Updated App' },
      };
      mockGet
        .mockResolvedValueOnce({ data: customConfig })
        .mockResolvedValueOnce({ data: config2 });

      const { ensureLoaded, reloadConfig, config } = useSiteConfig();

      await ensureLoaded();
      expect(config.value.branding.name).toBe('Test App');

      const result = await reloadConfig();
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(result.branding.name).toBe('Updated App');
      expect(config.value.branding.name).toBe('Updated App');
    });

    it('resets isLoaded before fetching', async () => {
      mockGet.mockResolvedValue({ data: customConfig });

      const { ensureLoaded, reloadConfig, isLoaded } = useSiteConfig();

      await ensureLoaded();
      expect(isLoaded.value).toBe(true);

      await reloadConfig();
      expect(isLoaded.value).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('returns loaded config synchronously after load', async () => {
      mockGet.mockResolvedValue({ data: customConfig });

      const { ensureLoaded, getConfig } = useSiteConfig();
      await ensureLoaded();

      expect(getConfig()).toEqual(customConfig);
    });
  });

  describe('convenience getters reflect loaded config', () => {
    it('getters update after loading custom config', async () => {
      mockGet.mockResolvedValue({ data: customConfig });

      const composable = useSiteConfig();
      await composable.ensureLoaded();

      expect(composable.branding.name).toBe('Test App');
      expect(composable.links.discord).toBe('https://discord.test');
      expect(composable.operator.name).toBe('Test Operator');
      expect(composable.features.showTestimonials).toBe(true);
    });
  });
});
