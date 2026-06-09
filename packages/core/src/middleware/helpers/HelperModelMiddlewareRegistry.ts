/**
 * Helper Model Middleware Registry
 * Phase 1.5: Week 2 - API Pattern-Based Helper System
 *
 * Central registry for managing helper middleware adapters.
 * Independent from main adapter system - operates as self-contained unit.
 */

import type { HelperMiddlewareAdapter } from './HelperMiddlewareAdapter.interface.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';

/**
 * Registry for helper middleware adapters
 *
 * Manages registration and retrieval of helper adapters based on
 * API patterns. Each adapter is self-contained and handles communication
 * with helper models using a specific API pattern.
 *
 * ARCHITECTURE NOTE:
 * This registry is INDEPENDENT from AdapterRegistry (main adapter system).
 * Helper adapters do not depend on or share code with main adapters.
 */
export class HelperModelMiddlewareRegistry {
  private adapters: Map<string, HelperMiddlewareAdapter> = new Map();
  private static instance: HelperModelMiddlewareRegistry | null = null;

  constructor() {
    // Note: registerDefaultAdapters() will be called after concrete adapters are imported
    // This avoids circular dependencies
  }

  /**
   * Get singleton instance
   *
   * @returns Singleton registry instance
   */
  static getInstance(): HelperModelMiddlewareRegistry {
    if (!HelperModelMiddlewareRegistry.instance) {
      HelperModelMiddlewareRegistry.instance = new HelperModelMiddlewareRegistry();
    }
    return HelperModelMiddlewareRegistry.instance;
  }

  /**
   * Reset singleton instance (useful for testing)
   */
  static resetInstance(): void {
    HelperModelMiddlewareRegistry.instance = null;
  }

  /**
   * Register a helper adapter
   *
   * @param adapter - Helper adapter to register
   * @param force - If true, allows overwriting existing adapter
   */
  register(adapter: HelperMiddlewareAdapter, force: boolean = false): void {
    const apiPattern = adapter.apiPattern;

    if (this.adapters.has(apiPattern) && !force) {
      console.warn(
        `HelperRegistry: Adapter for pattern "${apiPattern}" is already registered. ` +
        `Use force=true to overwrite.`
      );
      return;
    }

    this.adapters.set(apiPattern, adapter);
    if (process.env.DEBUG === 'true') {
      console.log(`HelperRegistry: Registered adapter "${adapter.name}" for pattern "${apiPattern}"`);
    }
  }

  /**
   * Get helper adapter for a specific API pattern
   *
   * @param apiPattern - API pattern (e.g., 'messages', 'chat/completions')
   * @returns Helper adapter for the pattern
   * @throws Error if no adapter found for pattern
   */
  getAdapter(apiPattern: string): HelperMiddlewareAdapter {
    const adapter = this.adapters.get(apiPattern);

    if (!adapter) {
      throw new Error(
        `HelperRegistry: No helper adapter found for API pattern "${apiPattern}". ` +
        `Available patterns: ${Array.from(this.adapters.keys()).join(', ')}`
      );
    }

    return adapter;
  }

  /**
   * Get helper adapter for a model configuration
   *
   * Selects the appropriate helper adapter based on the helper model's
   * API pattern.
   *
   * @param helperConfig - Helper model configuration
   * @returns Helper adapter that can handle this model
   * @throws Error if no adapter found for model's API pattern
   */
  getAdapterForModel(helperConfig: ModelConfig): HelperMiddlewareAdapter {
    const apiPattern = helperConfig.api.pattern;
    return this.getAdapter(apiPattern);
  }

  /**
   * Check if an adapter exists for an API pattern
   *
   * @param apiPattern - API pattern to check
   * @returns True if adapter exists
   */
  hasAdapter(apiPattern: string): boolean {
    return this.adapters.has(apiPattern);
  }

  /**
   * Get all registered API patterns
   *
   * @returns Array of registered API patterns
   */
  getRegisteredPatterns(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get all registered adapters
   *
   * @returns Array of all registered helper adapters
   */
  getAllAdapters(): HelperMiddlewareAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Unregister an adapter
   *
   * @param apiPattern - API pattern of adapter to remove
   * @returns True if adapter was removed
   */
  unregister(apiPattern: string): boolean {
    return this.adapters.delete(apiPattern);
  }

  /**
   * Clear all registered adapters
   */
  clear(): void {
    this.adapters.clear();
  }

  /**
   * Get registry statistics
   *
   * @returns Statistics about registered adapters
   */
  getStats(): {
    totalAdapters: number;
    patterns: string[];
    adapterNames: string[];
  } {
    const adapters = this.getAllAdapters();
    return {
      totalAdapters: adapters.length,
      patterns: adapters.map(a => a.apiPattern),
      adapterNames: adapters.map(a => a.name)
    };
  }
}

/**
 * Default singleton instance for convenience
 */
export const helperRegistry = HelperModelMiddlewareRegistry.getInstance();
