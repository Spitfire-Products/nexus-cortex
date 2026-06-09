/**
 * Theme manager for selecting and applying themes
 * Now supports 13 professional themes + default and minimal
 */

import { Theme } from './Theme.interface.js';
import { DefaultTheme } from './DefaultTheme.js';
import { MinimalTheme } from './MinimalTheme.js';
import { themeDefinitions, ThemeName, themeNames } from './themeDefinitions.js';
import { createTheme, ExtendedTheme, createExtendedTheme } from './createTheme.js';
import {
  persistTheme,
  loadPersistedTheme,
  persistThemeForPlatform,
  loadPersistedThemeForPlatform,
  type Platform,
} from './colors.js';

// Union type for all available themes
export type AvailableTheme = 'default' | 'minimal' | ThemeName;

// Cache for created themes
const themeCache = new Map<string, Theme>();

/**
 * Theme manager for CLI styling
 */
export class ThemeManager {
  private static currentTheme: Theme | ExtendedTheme = DefaultTheme;

  /**
   * Get all available theme names
   */
  static getAvailableThemes(): AvailableTheme[] {
    return ['default', 'minimal', ...themeNames];
  }

  /**
   * Get theme information for preview
   */
  static getThemeInfo(name: AvailableTheme): { name: string; colors: string[] } {
    if (name === 'default') {
      return { name: 'Default', colors: ['#00FFFF', '#00FF00', '#FF0000', '#FFFF00', '#0000FF'] };
    }
    if (name === 'minimal') {
      return { name: 'Minimal', colors: [] };
    }

    const definition = themeDefinitions[name as ThemeName];
    if (definition) {
      return {
        name: definition.name,
        colors: [
          definition.primary,
          definition.secondary,
          definition.success,
          definition.warning,
          definition.error,
          definition.info
        ]
      };
    }

    return { name: 'Unknown', colors: [] };
  }

  /**
   * Set the current theme
   */
  static async setTheme(name: AvailableTheme): Promise<void> {
    // Check if it's a built-in theme
    if (name === 'default') {
      this.currentTheme = DefaultTheme;
    } else if (name === 'minimal') {
      this.currentTheme = MinimalTheme;
    } else if (themeDefinitions[name as ThemeName]) {
      // Check cache first
      if (!themeCache.has(name)) {
        const definition = themeDefinitions[name as ThemeName];
        if (definition) {
          const theme = createTheme(definition);
          themeCache.set(name, theme);
        }
      }
      this.currentTheme = themeCache.get(name)!;
    } else {
      throw new Error(
        `Invalid theme: ${name}. Available themes: ${this.getAvailableThemes().join(', ')}`
      );
    }

    // Persist to .cortex/config.json (same as Ink UI)
    persistTheme(name as ThemeName);
  }

  /**
   * Set the current theme for a specific platform
   */
  static async setThemeForPlatform(platform: Platform, name: AvailableTheme): Promise<void> {
    // Check if it's a built-in theme
    if (name === 'default') {
      this.currentTheme = DefaultTheme;
    } else if (name === 'minimal') {
      this.currentTheme = MinimalTheme;
    } else if (themeDefinitions[name as ThemeName]) {
      // Check cache first
      if (!themeCache.has(name)) {
        const definition = themeDefinitions[name as ThemeName];
        if (definition) {
          const theme = createTheme(definition);
          themeCache.set(name, theme);
        }
      }
      this.currentTheme = themeCache.get(name)!;
    } else {
      throw new Error(
        `Invalid theme: ${name}. Available themes: ${this.getAvailableThemes().join(', ')}`
      );
    }

    // Persist to .cortex/config.json for the specific platform
    persistThemeForPlatform(platform, name as ThemeName);
  }

  /**
   * Get the current theme for a specific platform
   */
  static getThemeForPlatform(platform: Platform): Theme {
    // Load theme from .cortex/config.json for the specific platform
    const themeName = loadPersistedThemeForPlatform(platform) as AvailableTheme | null;

    if (themeName) {
      if (themeName === 'minimal') {
        this.currentTheme = MinimalTheme;
      } else if (themeName === 'default') {
        this.currentTheme = DefaultTheme;
      } else if (themeDefinitions[themeName as ThemeName]) {
        // Check cache first
        if (!themeCache.has(themeName)) {
          const definition = themeDefinitions[themeName as ThemeName];
          if (definition) {
            const theme = createTheme(definition);
            themeCache.set(themeName, theme);
          }
        }
        this.currentTheme = themeCache.get(themeName)!;
      }
    } else {
      // Default to default theme
      this.currentTheme = DefaultTheme;
    }

    return this.currentTheme;
  }

  /**
   * Get extended theme for a specific platform
   */
  static getExtendedThemeForPlatform(platform: Platform): ExtendedTheme {
    const themeName = loadPersistedThemeForPlatform(platform) as AvailableTheme | null;

    // Extended themes only available for professional themes
    if (themeName && themeName !== 'default' && themeName !== 'minimal') {
      const cacheKey = `extended_${platform}_${themeName}`;

      const cacheResult = themeCache.get(cacheKey);
      if (cacheResult) {
        return cacheResult as unknown as ExtendedTheme;
      }

      const definition = themeDefinitions[themeName as ThemeName];
      if (definition) {
        const extendedTheme = createExtendedTheme(definition);
        themeCache.set(cacheKey, extendedTheme as unknown as Theme);
        return extendedTheme;
      }
    }

    // Fallback: create extended theme from tokyoNight for default/minimal
    const cacheKey = 'extended_fallback';
    if (!themeCache.has(cacheKey)) {
      const tokyoNightDef = themeDefinitions.tokyoNight;
      if (tokyoNightDef) {
        const fallback = createExtendedTheme(tokyoNightDef);
        themeCache.set(cacheKey, fallback as unknown as Theme);
      }
    }
    return themeCache.get(cacheKey) as unknown as ExtendedTheme;
  }

  /**
   * Get the current theme
   */
  static getTheme(): Theme {
    // Load theme from .cortex/config.json (same as Ink UI)
    const themeName = loadPersistedTheme() as AvailableTheme | null;

    if (themeName) {
      if (themeName === 'minimal') {
        this.currentTheme = MinimalTheme;
      } else if (themeName === 'default') {
        this.currentTheme = DefaultTheme;
      } else if (themeDefinitions[themeName as ThemeName]) {
        // Check cache first
        if (!themeCache.has(themeName)) {
          const definition = themeDefinitions[themeName as ThemeName];
          if (definition) {
            const theme = createTheme(definition);
            themeCache.set(themeName, theme);
          }
        }
        this.currentTheme = themeCache.get(themeName)!;
      }
    } else {
      // Default to default theme
      this.currentTheme = DefaultTheme;
    }

    return this.currentTheme;
  }

  /**
   * Get extended theme with additional formatting functions
   */
  static getExtendedTheme(): ExtendedTheme {
    const themeName = loadPersistedTheme() as AvailableTheme | null;

    // Extended themes only available for professional themes
    if (themeName && themeName !== 'default' && themeName !== 'minimal') {
      const cacheKey = `extended_${themeName}`;

      const cacheResult = themeCache.get(cacheKey);
      if (cacheResult) {
        return cacheResult as unknown as ExtendedTheme;
      }

      const definition = themeDefinitions[themeName as ThemeName];
      if (definition) {
        const extendedTheme = createExtendedTheme(definition);
        themeCache.set(cacheKey, extendedTheme as unknown as Theme);
        return extendedTheme;
      }
    }

    // Fallback: create extended theme from tokyoNight for default/minimal
    const cacheKey = 'extended_fallback';
    if (!themeCache.has(cacheKey)) {
      const tokyoNightDef = themeDefinitions.tokyoNight;
      if (tokyoNightDef) {
        const fallback = createExtendedTheme(tokyoNightDef);
        themeCache.set(cacheKey, fallback as unknown as Theme);
      }
    }
    return themeCache.get(cacheKey) as unknown as ExtendedTheme;
  }

  /**
   * Apply theme (alias for getTheme for consistency with plan)
   */
  static applyTheme(theme: Theme): void {
    this.currentTheme = theme;
  }

  /**
   * Get theme by name (without caching/config)
   */
  static getThemeByName(name: AvailableTheme): Theme {
    if (name === 'minimal') {
      return MinimalTheme;
    }
    if (name === 'default') {
      return DefaultTheme;
    }

    const definition = themeDefinitions[name as ThemeName];
    if (definition) {
      return createTheme(definition);
    }

    // Fallback to default
    return DefaultTheme;
  }

  /**
   * Clear theme cache (useful for testing or theme hot-reload)
   */
  static clearCache(): void {
    themeCache.clear();
  }
}
