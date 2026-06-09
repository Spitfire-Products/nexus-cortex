/**
 * Model Card Loader
 * Auto-discovers and loads model cards from the cards/ directory
 *
 * Phase 2: Modular Registry Architecture
 */

import { glob } from 'glob';
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ModelConfig } from '../ModelConfig.interface.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ModelCardLoaderOptions {
  /**
   * Directory to search for model cards
   * Default: packages/core/src/models/cards/
   */
  cardsPath?: string;

  /**
   * Provider filter (e.g., 'xai', 'anthropic')
   * Default: undefined (load all providers)
   */
  provider?: string;

  /**
   * Enable debug logging
   */
  debug?: boolean;
}

export class ModelCardLoader {
  private cardsPath: string;
  private provider?: string;
  private debug: boolean;

  constructor(options: ModelCardLoaderOptions = {}) {
    this.cardsPath = options.cardsPath || path.join(__dirname, '../cards');
    this.provider = options.provider;
    this.debug = options.debug || false;
  }

  /**
   * Discover and load all model cards
   * Returns array of ModelConfig objects
   */
  async loadModelCards(): Promise<ModelConfig[]> {
    const models: ModelConfig[] = [];

    try {
      // Build glob pattern
      const pattern = this.provider
        ? `${this.provider}/**/*.ts`
        : '**/*.ts';

      if (this.debug) {
        console.log(`[ModelCardLoader] Searching for model cards:`);
        console.log(` Path: ${this.cardsPath}`);
        console.log(` Pattern: ${pattern}`);
      }

      // Find all model card files
      const cardFiles = await glob.glob(pattern, {
        cwd: this.cardsPath,
        ignore: ['**/index.ts', '**/*.test.ts', '**/*.spec.ts'],
        absolute: false
      });

      if (this.debug) {
        console.log(`[ModelCardLoader] Found ${cardFiles.length} model card files`);
      }

      // Load each card file
      for (const file of cardFiles) {
        try {
          const models = await this.loadCardFile(file);
          models.push(...models);
        } catch (error) {
          console.error(`[ModelCardLoader] Failed to load ${file}:`, error);
        }
      }

      if (this.debug) {
        console.log(`[ModelCardLoader] Loaded ${models.length} models total`);
      }

      return models;
    } catch (error) {
      console.error('[ModelCardLoader] Error during model card discovery:', error);
      return [];
    }
  }

  /**
   * Load a single model card file
   * Supports both default and named exports
   */
  private async loadCardFile(file: string): Promise<ModelConfig[]> {
    const models: ModelConfig[] = [];
    const fullPath = path.join(this.cardsPath, file);
    const fileUrl = pathToFileURL(fullPath).href;

    if (this.debug) {
      console.log(`[ModelCardLoader] Loading: ${file}`);
    }

    try {
      // Dynamic import
      const module = await import(fileUrl);

      // Check for default export
      if (module.default && this.isModelConfig(module.default)) {
        models.push(module.default);
        if (this.debug) {
          console.log(` ✓ Found default export: ${module.default.id}`);
        }
      }

      // Check for named exports
      for (const [key, value] of Object.entries(module)) {
        if (key !== 'default' && this.isModelConfig(value)) {
          models.push(value as ModelConfig);
          if (this.debug) {
            console.log(` ✓ Found named export '${key}': ${(value as ModelConfig).id}`);
          }
        }
      }

      if (models.length === 0 && this.debug) {
        console.log(` ⚠ No ModelConfig exports found in ${file}`);
      }

    } catch (error) {
      throw new Error(`Failed to import ${file}: ${error}`);
    }

    return models;
  }

  /**
   * Type guard to check if an object is a ModelConfig
   */
  private isModelConfig(obj: unknown): obj is ModelConfig {
    if (!obj || typeof obj !== 'object') {
      return false;
    }

    const config = obj as Partial<ModelConfig>;

    return (
      typeof config.id === 'string' &&
      typeof config.provider === 'string' &&
      typeof config.displayName === 'string' &&
      typeof config.family === 'string' &&
      config.api !== undefined &&
      config.tools !== undefined &&
      config.parameters !== undefined &&
      config.limits !== undefined
    );
  }
}
