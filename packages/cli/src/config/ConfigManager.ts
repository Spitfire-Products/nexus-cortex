/**
 * Configuration management for Cortex CLI
 *
 * Thin facade over SettingsLoader — all values come from .env.
 * Preserves the CLIConfig interface for backward compatibility with
 * 35+ command files that import ConfigManager.get('serverUrl') etc.
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  SettingsLoader,
  SETTINGS_METADATA,
  validateSetting,
  type EnvironmentVariables,
} from '@nexus-cortex/core';

export interface CLIConfig {
  serverUrl: string;
  defaultModel?: string;
  theme: string;
  timeout: number;
  maxRetries: number;
  logLevel: 'silent' | 'error' | 'info' | 'debug';
}

const MONOREPO_NAME = 'nexus-cortex-monorepo';

function isProjectRoot(dir: string): boolean {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.name === MONOREPO_NAME;
  } catch {
    return false;
  }
}

function findProjectRoot(): string {
  const envRoot = process.env.CORTEX_ROOT;
  if (envRoot && existsSync(envRoot)) return envRoot;

  try {
    const thisFile = fileURLToPath(import.meta.url);
    let d = dirname(thisFile);
    for (let i = 0; i < 8; i++) {
      if (isProjectRoot(d)) return d;
      const parent = dirname(d);
      if (parent === d) break;
      d = parent;
    }
  } catch {}

  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (isProjectRoot(dir)) return dir;
    dir = dirname(dir);
  }

  return process.cwd();
}

function getEnvValue(key: string, loader: SettingsLoader): string {
  const fromEnv = process.env[key];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return loader.get(key as any) || '';
}

function buildConfig(loader: SettingsLoader): CLIConfig {
  const port = getEnvValue('PORT', loader) || '4000';
  const serverUrl = getEnvValue('CORTEX_SERVER_URL', loader) || `http://localhost:${port}`;

  return {
    serverUrl,
    defaultModel: getEnvValue('DEFAULT_MODEL_ID', loader) || undefined,
    theme: getEnvValue('THEME', loader) || 'default',
    timeout: parseInt(getEnvValue('TOOL_TIMEOUT_MS', loader) || '120000', 10),
    maxRetries: parseInt(getEnvValue('MAX_CONSECUTIVE_ERRORS', loader) || '3', 10),
    logLevel: (getEnvValue('LOG_LEVEL', loader) || 'error') as CLIConfig['logLevel'],
  };
}

export class ConfigManager {
  private static cachedConfig: CLIConfig | null = null;
  private static loader: SettingsLoader | null = null;
  /** Override for the project root that holds `.env` (test isolation). */
  private static overrideRoot: string | null = null;

  /** The directory whose `.env` ConfigManager reads/writes. */
  private static rootDir(): string {
    return this.overrideRoot ?? findProjectRoot();
  }

  private static getLoader(): SettingsLoader {
    if (!this.loader) {
      this.loader = new SettingsLoader(this.rootDir());
    }
    return this.loader;
  }

  static load(): CLIConfig {
    if (this.cachedConfig) {
      return { ...this.cachedConfig };
    }
    this.cachedConfig = buildConfig(this.getLoader());
    return { ...this.cachedConfig };
  }

  static get<K extends keyof CLIConfig>(key: K): CLIConfig[K] {
    const config = this.load();
    return config[key];
  }

  static async set<K extends keyof CLIConfig>(key: K, value: CLIConfig[K]): Promise<void> {
    const envKey = configKeyToEnvKey(key);
    if (!envKey) {
      throw new Error(`Unknown config key: ${String(key)}`);
    }

    const strValue = String(value);
    const meta = SETTINGS_METADATA.find(s => s.key === envKey);
    if (meta) {
      const validation = validateSetting(envKey as keyof EnvironmentVariables, strValue);
      if (validation !== true) {
        throw new Error(`Invalid value for ${String(key)}: ${validation}`);
      }
    }

    const loader = this.getLoader();
    const result = loader.set(envKey as keyof EnvironmentVariables, strValue);
    if (!result.success) {
      throw new Error(`Failed to set ${String(key)}: ${result.error}`);
    }
    process.env[envKey] = strValue;
    this.cachedConfig = null;
  }

  static async reset(): Promise<void> {
    this.cachedConfig = null;
  }

  static async save(config: CLIConfig): Promise<void> {
    const loader = this.getLoader();
    if (config.serverUrl) {
      loader.set('CORTEX_SERVER_URL' as keyof EnvironmentVariables, config.serverUrl);
      process.env.CORTEX_SERVER_URL = config.serverUrl;
    }
    if (config.defaultModel) {
      loader.set('DEFAULT_MODEL_ID' as keyof EnvironmentVariables, config.defaultModel);
      process.env.DEFAULT_MODEL_ID = config.defaultModel;
    }
    this.cachedConfig = null;
  }

  static validate(_config: Partial<CLIConfig>): boolean {
    return true;
  }

  static clearCache(): void {
    this.cachedConfig = null;
    this.loader = null;
  }

  static getConfigPath(): string {
    return join(this.rootDir(), '.env');
  }

  /**
   * Redirect where ConfigManager reads/writes its `.env`. Pass the path to a
   * `.env` file (its directory becomes the project root) or `null` to restore
   * auto-detection. Primarily for test isolation, so tests never mutate the
   * real project `.env`.
   */
  static setConfigPath(envFilePath: string | null): void {
    this.overrideRoot = envFilePath ? dirname(envFilePath) : null;
    this.clearCache();
  }
}

function configKeyToEnvKey(key: keyof CLIConfig): string | null {
  const map: Record<string, string> = {
    serverUrl: 'CORTEX_SERVER_URL',
    defaultModel: 'DEFAULT_MODEL_ID',
    theme: 'THEME',
    timeout: 'TOOL_TIMEOUT_MS',
    maxRetries: 'MAX_CONSECUTIVE_ERRORS',
    logLevel: 'LOG_LEVEL',
  };
  return map[key as string] || null;
}
