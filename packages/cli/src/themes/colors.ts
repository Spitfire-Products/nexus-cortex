/**
 * Nexus Cortex - UI Colors
 *
 * Themeable color constants for the Ink UI.
 * Uses theme definitions from the chalk CLI theme system.
 * Theme persistence via .cortex/config.json with platform-specific settings.
 *
 * Platforms:
 * - fuzzycortex: Chalk-based terminal UI
 * - neoncortex: Ink-based React terminal UI
 * - cortexserver: HTTP API server
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { themeDefinitions, type ThemeDefinition, type ThemeName, themeNames } from './themeDefinitions.js';

/**
 * Platform identifiers for platform-specific settings
 */
export type Platform = 'fuzzycortex' | 'neoncortex' | 'cortexserver';

/**
 * Platform-specific settings interface
 */
interface PlatformSettings {
  defaultModel?: string;
  theme?: ThemeName;
  [key: string]: unknown;
}

/**
 * Cortex config interface for .cortex/config.json
 * Supports both legacy flat structure and new platform-specific structure
 */
interface CortexConfig {
  // Legacy flat settings (for backward compatibility)
  theme?: ThemeName;
  defaultModel?: string;

  // Platform-specific settings
  fuzzycortex?: PlatformSettings;
  neoncortex?: PlatformSettings;
  cortexserver?: PlatformSettings;

  [key: string]: unknown;
}

/**
 * Get the .cortex directory path (relative to cwd)
 */
function getCortexConfigPath(): string {
  return join(process.cwd(), '.cortex', 'config.json');
}

/**
 * Load cortex config from .cortex/config.json
 */
function loadCortexConfig(): CortexConfig {
  try {
    const configPath = getCortexConfigPath();
    if (existsSync(configPath)) {
      const data = readFileSync(configPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Ignore errors, return empty config
  }
  return {};
}

/**
 * `.cortex/config.json` is a TRACKED file (committed to git) holding only UI
 * preferences — theme + default model. Its interface is open-ended
 * (`[key: string]: unknown`), so this guard structurally prevents any
 * secret-looking key (token/secret/key/password/oauth/credential) from ever
 * being persisted here, even via a future regression or a hand-edited config.
 * Secrets belong in `.env` / the environment / `~/.claude/.credentials.json`,
 * never in a project-tracked file.
 */
const SECRET_KEY_RE = /token|secret|password|api[_-]?key|credential|oauth/i;

function stripSecretKeys<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => stripSecretKeys(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) continue; // drop the secret-bearing key entirely
    out[k] = stripSecretKeys(v);
  }
  return out as unknown as T;
}

/**
 * Save cortex config to .cortex/config.json
 */
function saveCortexConfig(config: CortexConfig): boolean {
  try {
    const cortexDir = join(process.cwd(), '.cortex');
    if (!existsSync(cortexDir)) {
      mkdirSync(cortexDir, { recursive: true });
    }
    const configPath = getCortexConfigPath();
    // Never let a secret-looking key reach this tracked file.
    const safe = stripSecretKeys(config);
    writeFileSync(configPath, JSON.stringify(safe, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get platform-specific settings, with fallback to legacy flat structure
 */
function getPlatformSettings(config: CortexConfig, platform: Platform): PlatformSettings {
  // First try platform-specific settings
  const platformSettings = config[platform];
  if (platformSettings && typeof platformSettings === 'object') {
    return platformSettings as PlatformSettings;
  }

  // Fallback to legacy flat structure for backward compatibility
  return {
    defaultModel: config.defaultModel,
    theme: config.theme,
  };
}

/**
 * Ensure platform settings object exists in config
 */
function ensurePlatformSettings(config: CortexConfig, platform: Platform): PlatformSettings {
  if (!config[platform] || typeof config[platform] !== 'object') {
    config[platform] = {};
  }
  return config[platform] as PlatformSettings;
}

// ============================================================================
// PLATFORM-SPECIFIC LOAD/PERSIST FUNCTIONS
// ============================================================================

/**
 * Load persisted theme for a specific platform
 */
export function loadPersistedThemeForPlatform(platform: Platform): ThemeName | null {
  const config = loadCortexConfig();
  const settings = getPlatformSettings(config, platform);
  if (settings.theme && settings.theme in themeDefinitions) {
    return settings.theme;
  }
  return null;
}

/**
 * Save theme for a specific platform
 */
export function persistThemeForPlatform(platform: Platform, themeName: ThemeName): boolean {
  const config = loadCortexConfig();
  const settings = ensurePlatformSettings(config, platform);
  settings.theme = themeName;
  return saveCortexConfig(config);
}

/**
 * Load persisted default model for a specific platform
 */
export function loadPersistedModelForPlatform(platform: Platform): string | null {
  const config = loadCortexConfig();
  const settings = getPlatformSettings(config, platform);
  return settings.defaultModel || null;
}

/**
 * Save default model for a specific platform
 */
export function persistModelForPlatform(platform: Platform, modelId: string): boolean {
  const config = loadCortexConfig();
  const settings = ensurePlatformSettings(config, platform);
  settings.defaultModel = modelId;
  return saveCortexConfig(config);
}

// ============================================================================
// LEGACY FUNCTIONS (for backward compatibility - use platform-specific versions)
// ============================================================================

/**
 * Load persisted theme from .cortex/config.json
 * @deprecated Use loadPersistedThemeForPlatform() instead
 */
export function loadPersistedTheme(): ThemeName | null {
  const config = loadCortexConfig();
  // Try neoncortex first (this function is primarily used by ink-ui)
  const neoncortexSettings = getPlatformSettings(config, 'neoncortex');
  if (neoncortexSettings.theme && neoncortexSettings.theme in themeDefinitions) {
    return neoncortexSettings.theme;
  }
  // Fallback to legacy flat
  if (config.theme && config.theme in themeDefinitions) {
    return config.theme;
  }
  return null;
}

/**
 * Save theme to .cortex/config.json for persistence
 * @deprecated Use persistThemeForPlatform() instead
 */
export function persistTheme(themeName: ThemeName): boolean {
  // Default to neoncortex for backward compatibility (ink-ui calls this)
  return persistThemeForPlatform('neoncortex', themeName);
}

/**
 * Load persisted default model from .cortex/config.json
 * @deprecated Use loadPersistedModelForPlatform() instead
 */
export function loadPersistedModel(): string | null {
  const config = loadCortexConfig();
  // Try neoncortex first (this function is primarily used by ink-ui)
  const neoncortexSettings = getPlatformSettings(config, 'neoncortex');
  if (neoncortexSettings.defaultModel) {
    return neoncortexSettings.defaultModel;
  }
  // Fallback to legacy flat
  return config.defaultModel || null;
}

/**
 * Save default model to .cortex/config.json for persistence
 * @deprecated Use persistModelForPlatform() instead
 */
export function persistModel(modelId: string): boolean {
  // Default to neoncortex for backward compatibility (ink-ui calls this)
  return persistModelForPlatform('neoncortex', modelId);
}

export interface ColorsTheme {
  type: 'dark' | 'light';
  Foreground: string;
  Background: string;
  White: string;
  LightBlue: string;
  AccentBlue: string;
  AccentPurple: string;
  AccentCyan: string;
  AccentGreen: string;
  AccentYellow: string;
  AccentRed: string;
  DiffAdded: string;
  DiffRemoved: string;
  Comment: string;
  Gray: string;
  DarkGray: string;
  GradientColors: string[];
  // Raw theme definition colors for splash screen theming
  primary: string;
  secondary: string;
  info: string;
  text: string;
  dimmed: string;
  warning: string;
}

/**
 * Convert a theme definition to our ColorsTheme format
 */
function themeDefinitionToColors(theme: ThemeDefinition): ColorsTheme {
  const isLight = theme.background.toLowerCase().startsWith('#f') ||
                  theme.background.toLowerCase().startsWith('#e') ||
                  theme.name.toLowerCase().includes('light');

  return {
    type: isLight ? 'light' : 'dark',
    Foreground: theme.text,
    Background: theme.background,
    White: '#ffffff',
    LightBlue: theme.info,
    AccentBlue: theme.primary,
    AccentPurple: theme.secondary,
    AccentCyan: theme.info,
    AccentGreen: theme.success,
    AccentYellow: theme.warning,
    AccentRed: theme.error,
    DiffAdded: theme.success,
    DiffRemoved: theme.error,
    Comment: theme.comment,
    Gray: theme.dimmed,
    DarkGray: theme.dimmed,
    GradientColors: [theme.primary, theme.secondary, theme.info],
    // Raw theme definition colors for splash screen theming
    primary: theme.primary,
    secondary: theme.secondary,
    info: theme.info,
    text: theme.text,
    dimmed: theme.dimmed,
    warning: theme.warning,
  };
}

// Export theme names for use in UI
export { themeNames };
export type { ThemeName };

// Current theme - defaults to Tokyo Night
let currentThemeName: ThemeName = 'tokyoNight';

/**
 * Get all available theme names
 */
export function getThemeNames(): ThemeName[] {
  return themeNames;
}

/**
 * Get current theme name
 */
export function getCurrentThemeName(): ThemeName {
  return currentThemeName;
}

/**
 * Set the current theme (optionally persisting to .cortex/config.json)
 * @param themeName - Theme to set
 * @param persist - Whether to save to .cortex/config.json (default: true)
 */
export function setTheme(themeName: ThemeName, persist: boolean = true): boolean {
  if (themeName in themeDefinitions) {
    currentThemeName = themeName;
    // Update the Colors export
    Object.assign(Colors, themeDefinitionToColors(themeDefinitions[themeName]!));
    // Persist theme to .cortex/config.json
    if (persist) {
      persistTheme(themeName);
    }
    return true;
  }
  return false;
}

/**
 * Initialize theme from persisted config or use default
 * Call this on app startup to load the user's preferred theme
 */
export function initializeTheme(): ThemeName {
  const persisted = loadPersistedTheme();
  if (persisted) {
    setTheme(persisted, false); // Don't re-persist on load
    return persisted;
  }
  return currentThemeName;
}

/**
 * Get theme definition by name
 */
export function getThemeDefinition(themeName: ThemeName): ThemeDefinition | undefined {
  return themeDefinitions[themeName];
}

/**
 * Default color theme (Tokyo Night inspired)
 */
export const Colors: ColorsTheme = themeDefinitionToColors(themeDefinitions.tokyoNight!);
