import { ref, readonly } from 'vue';
import type { SiteConfig } from '@deprecated-claude/shared';
import { defaultSiteConfig } from '@deprecated-claude/shared';
import { api } from '../services/api';

/**
 * Composable for managing site configuration
 * 
 * Site config is loaded once on app init and cached for the session.
 * It contains deployment-specific content like branding, links, and legal info.
 */

// Singleton state - shared across all component instances
const siteConfig = ref<SiteConfig>(defaultSiteConfig);
const isLoaded = ref(false);
const isLoading = ref(false);
const loadError = ref<string | null>(null);

// Promise to prevent multiple concurrent loads
let loadPromise: Promise<SiteConfig> | null = null;

async function loadSiteConfig(): Promise<SiteConfig> {
  // Return cached config if already loaded
  if (isLoaded.value) {
    return siteConfig.value;
  }
  
  // Return existing load promise if one is in flight
  if (loadPromise) {
    return loadPromise;
  }
  
  isLoading.value = true;
  loadError.value = null;
  
  loadPromise = (async () => {
    try {
      const response = await api.get('/site-config');
      siteConfig.value = response.data;
      isLoaded.value = true;
      console.log('[SiteConfig] Loaded site configuration:', siteConfig.value.branding.name);
      return siteConfig.value;
    } catch (error: any) {
      console.warn('[SiteConfig] Failed to load site config, using defaults:', error?.message);
      loadError.value = error?.message || 'Failed to load site configuration';
      // Use defaults on error - site should still work
      siteConfig.value = defaultSiteConfig;
      isLoaded.value = true;
      return siteConfig.value;
    } finally {
      isLoading.value = false;
      loadPromise = null;
    }
  })();
  
  return loadPromise;
}

/**
 * Get site config synchronously (returns defaults if not yet loaded)
 * Use for template bindings that need immediate values
 */
function getConfig(): SiteConfig {
  return siteConfig.value;
}

/**
 * Ensure site config is loaded, returning a promise
 * Use in onMounted or async setup
 */
async function ensureLoaded(): Promise<SiteConfig> {
  return loadSiteConfig();
}

/**
 * Force reload site configuration from server
 */
async function reloadConfig(): Promise<SiteConfig> {
  isLoaded.value = false;
  loadPromise = null;
  return loadSiteConfig();
}

export function useSiteConfig() {
  return {
    // Reactive state
    config: readonly(siteConfig),
    isLoaded: readonly(isLoaded),
    isLoading: readonly(isLoading),
    loadError: readonly(loadError),
    
    // Actions
    ensureLoaded,
    getConfig,
    reloadConfig,
    
    // Convenience getters for common values
    get branding() { return siteConfig.value.branding; },
    get links() { return siteConfig.value.links; },
    get operator() { return siteConfig.value.operator; },
    get features() { return siteConfig.value.features; },
    get content() { return siteConfig.value.content; },
  };
}

