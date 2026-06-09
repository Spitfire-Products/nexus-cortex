/**
 * ConfigProvider Interface
 *
 * Abstracts configuration / environment variable access.
 * The orchestrator reads configuration for model selection, feature flags,
 * tool limits, mentorship settings, etc.
 *
 * Node.js impl: wraps SettingsLoader (reads .env files via dotenv, process.env)
 * Browser impl: reads from localStorage or host-provided settings
 *
 * @module interfaces/ConfigProvider
 */

/**
 * Config Provider — read-only configuration access.
 *
 * Provides key-value access to settings. The orchestrator only reads
 * configuration — write operations (e.g., writeEnvSetting) are
 * CLI/UI concerns and not part of this interface.
 */
export interface ConfigProvider {
  /**
   * Get a configuration value by key.
   *
   * @param key - Setting name (e.g., 'DEFAULT_MODEL_ID', 'MAX_TOOL_ITERATIONS')
   * @returns Setting value or undefined if not set
   */
  get(key: string): string | undefined;

  /**
   * Get a required configuration value. Throws if not set.
   *
   * @param key - Setting name
   * @returns Setting value
   * @throws Error if setting is not configured
   */
  getRequired(key: string): string;

  /**
   * Get all configuration as a key-value map.
   *
   * @returns All settings (both explicitly set and defaults)
   */
  getAll(): Record<string, string | undefined>;

  /**
   * Get configuration merged with schema defaults.
   *
   * Returns a fully-populated settings object where every known key
   * has a value (either from configuration or from SettingsSchema defaults).
   *
   * @returns All settings with defaults applied
   */
  getMerged(): Record<string, string>;
}
