/**
 * ChromiumBrowserManager - Robust browser binary discovery for Playwright
 * Handles finding Chromium/Chrome binaries across different environments
 */
import { existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * ChromiumBinaryLocator - Robust chromium binary discovery
 * Searches multiple locations with priority order and validation
 */
class ChromiumBinaryLocator {
  private cachedPath: string | null | undefined = undefined;

  /**
   * Find chromium binary with comprehensive search
   */
  private findBinary(): string | null {
    // 1. Environment variable (highest priority - user override)
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
      if (this.isExecutable(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)) {
        console.log(`[ChromiumManager] Using PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: ${process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}`);
        return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
      }
      console.warn(`[ChromiumManager] PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH set but not executable: ${process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}`);
    }

    if (process.env.CHROMIUM_BIN) {
      if (this.isExecutable(process.env.CHROMIUM_BIN)) {
        console.log(`[ChromiumManager] Using CHROMIUM_BIN: ${process.env.CHROMIUM_BIN}`);
        return process.env.CHROMIUM_BIN;
      }
      console.warn(`[ChromiumManager] CHROMIUM_BIN set but not executable: ${process.env.CHROMIUM_BIN}`);
    }

    // 2. Nix store - search for chromium directories
    try {
      const nixStorePath = '/nix/store';
      if (existsSync(nixStorePath)) {
        const chromiumPath = this.findChromiumInNixStore(nixStorePath);
        if (chromiumPath) {
          console.log(`[ChromiumManager] Found chromium (nix store): ${chromiumPath}`);
          return chromiumPath;
        }
      }
    } catch (error) {
      console.warn(`[ChromiumManager] Error searching nix store:`, error);
    }

    // 3. Nix profile locations (common on Replit, NixOS)
    const homeDir = process.env.HOME;
    if (homeDir) {
      const nixPaths = [
        join(homeDir, '.nix-profile/bin/chromium'),
        join(homeDir, '.nix-profile/bin/chromium-browser'),
        join(homeDir, '.local/state/nix/profiles/profile/bin/chromium'),
      ];

      for (const path of nixPaths) {
        if (this.isExecutable(path)) {
          console.log(`[ChromiumManager] Found chromium (nix profile): ${path}`);
          return path;
        }
      }
    }

    // 4. System-wide nix locations
    const systemNixPaths = [
      '/nix/var/nix/profiles/default/bin/chromium',
      '/run/current-system/sw/bin/chromium',
    ];

    for (const path of systemNixPaths) {
      if (this.isExecutable(path)) {
        console.log(`[ChromiumManager] Found chromium (system nix): ${path}`);
        return path;
      }
    }

    // 5. Standard Chrome/Chromium system paths
    const systemPaths = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/local/bin/chromium',
      '/opt/google/chrome/chrome',
      '/opt/chromium.org/chromium/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',  // macOS
      '/Applications/Chromium.app/Contents/MacOS/Chromium',  // macOS
    ];

    for (const path of systemPaths) {
      if (this.isExecutable(path)) {
        console.log(`[ChromiumManager] Found chromium (system): ${path}`);
        return path;
      }
    }

    // 6. Check Playwright's cache (where browsers get installed)
    try {
      const playwrightCachePath = this.findPlaywrightCachedChromium();
      if (playwrightCachePath) {
        console.log(`[ChromiumManager] Found chromium (playwright cache): ${playwrightCachePath}`);
        return playwrightCachePath;
      }
    } catch (error) {
      console.warn(`[ChromiumManager] Error searching playwright cache:`, error);
    }

    // 7. Return null if nothing found (don't fallback to 'chromium' - be explicit)
    console.warn(`[ChromiumManager] No chromium binary found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH environment variable or install chromium.`);
    return null;
  }

  /**
   * Search nix store for chromium binaries
   */
  private findChromiumInNixStore(nixStorePath: string): string | null {
    try {
      const entries = readdirSync(nixStorePath);

      // Look for chromium directories (sorted by name to get latest version)
      const chromiumDirs = entries
        .filter(name => name.startsWith('chromium-') || name.includes('chromium'))
        .sort()
        .reverse(); // Get latest version first

      for (const dir of chromiumDirs) {
        const chromiumBin = join(nixStorePath, dir, 'bin/chromium');
        if (this.isExecutable(chromiumBin)) {
          return chromiumBin;
        }

        // Also check for chrome-sandbox and chrome binaries
        const chromeBin = join(nixStorePath, dir, 'bin/chrome');
        if (this.isExecutable(chromeBin)) {
          return chromeBin;
        }
      }
    } catch (error) {
      // Directory read error - not a problem, continue searching
    }

    return null;
  }

  /**
   * Find chromium in Playwright's cache directory
   */
  private findPlaywrightCachedChromium(): string | null {
    const homeDir = process.env.HOME;
    if (!homeDir) return null;

    const playwrightPaths = [
      join(homeDir, '.cache/ms-playwright'),
      join(homeDir, 'Library/Caches/ms-playwright'),  // macOS
      join(homeDir, 'AppData/Local/ms-playwright'),   // Windows
    ];

    for (const cachePath of playwrightPaths) {
      if (!existsSync(cachePath)) continue;

      try {
        const entries = readdirSync(cachePath);
        const chromiumDirs = entries
          .filter(name => name.startsWith('chromium-'))
          .sort()
          .reverse();

        for (const dir of chromiumDirs) {
          // Linux/Windows
          let chromiumBin = join(cachePath, dir, 'chrome-linux/chrome');
          if (this.isExecutable(chromiumBin)) {
            return chromiumBin;
          }

          // macOS
          chromiumBin = join(cachePath, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium');
          if (this.isExecutable(chromiumBin)) {
            return chromiumBin;
          }

          // Windows
          chromiumBin = join(cachePath, dir, 'chrome-win/chrome.exe');
          if (this.isExecutable(chromiumBin)) {
            return chromiumBin;
          }
        }
      } catch (error) {
        // Continue searching
      }
    }

    return null;
  }

  /**
   * Check if path is an executable file
   */
  private isExecutable(path: string): boolean {
    try {
      if (!existsSync(path)) return false;
      const stats = statSync(path);
      // Check if file and has execute permission
      return stats.isFile() && !!(stats.mode & 0o111);
    } catch {
      return false;
    }
  }

  /**
   * Get chromium binary path (cached)
   */
  public getBinary(): string | null {
    if (this.cachedPath === undefined) {
      this.cachedPath = this.findBinary();
    }
    return this.cachedPath;
  }

  /**
   * Clear cached path (for testing)
   */
  public clearCache(): void {
    this.cachedPath = undefined;
  }

  /**
   * Get browser configuration for Playwright
   */
  public getPlaywrightConfig(): { executablePath?: string } {
    const binary = this.getBinary();
    if (!binary) {
      throw new Error(
        'Chromium binary not found. Please install chromium or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH environment variable.'
      );
    }
    return { executablePath: binary };
  }
}

// Singleton instance
const locator = new ChromiumBinaryLocator();

/**
 * Get chromium binary path
 */
export function getChromiumBinary(): string | null {
  return locator.getBinary();
}

/**
 * Get Playwright browser launch configuration
 */
export function getPlaywrightConfig(): { executablePath?: string } {
  return locator.getPlaywrightConfig();
}

/**
 * Clear cached chromium path (for testing)
 */
export function clearChromiumCache(): void {
  locator.clearCache();
}

/**
 * Export the locator class for advanced usage
 */
export { ChromiumBinaryLocator };
