/**
 * Node.js ConfigProvider Implementation
 *
 * Wraps SettingsLoader functions behind the ConfigProvider interface.
 * Reads .env files via dotenv and process.env.
 *
 * @module adapters/node/NodeConfigProvider
 */

import type { ConfigProvider } from '../../interfaces/ConfigProvider.js';
import { loadEnvFile, mergeWithDefaults } from '../../config/SettingsLoader.js';
import type { EnvironmentVariables } from '../../config/SettingsSchema.js';

export class NodeConfigProvider implements ConfigProvider {
  private env: EnvironmentVariables;
  private merged: Record<string, string> | null = null;

  constructor(projectPath?: string) {
    this.env = loadEnvFile(projectPath);
  }

  get(key: string): string | undefined {
    // process.env takes priority (runtime overrides), then .env file values
    return process.env[key] ?? (this.env as Record<string, string | undefined>)[key];
  }

  getRequired(key: string): string {
    const val = this.get(key);
    if (val === undefined || val === '') {
      throw new Error(`Required configuration '${key}' is not set`);
    }
    return val;
  }

  getAll(): Record<string, string | undefined> {
    return { ...this.env } as Record<string, string | undefined>;
  }

  getMerged(): Record<string, string> {
    if (!this.merged) {
      this.merged = mergeWithDefaults(this.env) as unknown as Record<string, string>;
    }
    return this.merged;
  }
}
