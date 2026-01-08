import { readFile } from 'fs/promises';
import { join } from 'path';
import { SiteConfig, SiteConfigSchema, defaultSiteConfig } from '@deprecated-claude/shared';

/**
 * Site Configuration Loader
 * 
 * Loads deployment-specific site configuration from:
 * 1. SITE_CONFIG_PATH environment variable
 * 2. /etc/claude-app/siteConfig.json (production)
 * 3. ./config/siteConfig.json (development)
 * 
 * Falls back to default configuration if no file is found.
 */
export class SiteConfigLoader {
  private static instance: SiteConfigLoader;
  private config: SiteConfig | null = null;
  private configPath: string;

  private constructor() {
    // Look for config in these locations (in order):
    // 1. Environment variable SITE_CONFIG_PATH
    // 2. /etc/claude-app/siteConfig.json (production)
    // 3. ./config/siteConfig.json (development)
    this.configPath = process.env.SITE_CONFIG_PATH || 
      (process.env.NODE_ENV === 'production' 
        ? '/etc/claude-app/siteConfig.json'
        : join(process.cwd(), 'config', 'siteConfig.json'));
  }

  static getInstance(): SiteConfigLoader {
    if (!SiteConfigLoader.instance) {
      SiteConfigLoader.instance = new SiteConfigLoader();
    }
    return SiteConfigLoader.instance;
  }

  /**
   * Load and validate site configuration
   * Merges loaded config with defaults to ensure all fields are present
   */
  async loadConfig(): Promise<SiteConfig> {
    if (this.config) {
      return this.config;
    }

    try {
      const configData = await readFile(this.configPath, 'utf-8');
      const rawConfig = JSON.parse(configData);
      
      // Parse and validate with Zod, which applies defaults
      this.config = SiteConfigSchema.parse(rawConfig);
      console.log(`[SiteConfig] Loaded site configuration from ${this.configPath}`);
      
      return this.config;
    } catch (error) {
      // Only warn in debug mode - siteConfig.json is optional
      if (process.env.LOG_DEBUG === 'true') {
        console.warn(`[SiteConfig] Failed to load config from ${this.configPath}:`, error);
      }
      console.log('[SiteConfig] Using default site configuration');
      
      // Return default config
      this.config = defaultSiteConfig;
      return this.config;
    }
  }

  /**
   * Get the current configuration (loads if not already loaded)
   */
  async getConfig(): Promise<SiteConfig> {
    return this.loadConfig();
  }

  /**
   * Reload configuration from disk
   */
  async reloadConfig(): Promise<SiteConfig> {
    this.config = null;
    return this.loadConfig();
  }

  /**
   * Get a specific config value by path (dot notation)
   * Example: getSiteValue('branding.name') returns 'Arc Chat'
   */
  async getValue<T>(path: string): Promise<T | undefined> {
    const config = await this.loadConfig();
    const parts = path.split('.');
    let value: any = config;
    
    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[part];
    }
    
    return value as T;
  }
}

// Export singleton getter for convenience
export const getSiteConfig = () => SiteConfigLoader.getInstance().getConfig();

