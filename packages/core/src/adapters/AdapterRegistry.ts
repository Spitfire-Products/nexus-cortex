/**
 * AdapterRegistry
 *
 * Central registry for managing format adapters.
 *
 * Phase 1.5: Multi-Provider Architecture
 * Based on: FormatAdapter.interface.ts
 */

import { FormatAdapter, AdapterRegistry as IAdapterRegistry } from './FormatAdapter.interface.js';
import { ModelConfig } from '../models/ModelConfig.interface.js';
import { GenerateContentAPIAdapter } from './GenerateContentAPIAdapter.js';
import { GoogleGenAPIAdapter } from './GoogleGenAPIAdapter.js';
import { MessagesAPIAdapter } from './MessagesAPIAdapter.js';
import { ChatCompletionsAPIAdapter } from './ChatCompletionsAPIAdapter.js';
import { ResponsesAPIAdapter } from './ResponsesAPIAdapter.js';

/**
 * Adapter Registry Implementation
 *
 * Manages registration and retrieval of format adapters.
 * Provides singleton instances of all three pattern-based adapters.
 */
export class AdapterRegistry implements IAdapterRegistry {
  private adapters: Map<string, FormatAdapter> = new Map();

  /**
   * Create registry with default adapters pre-registered
   */
  constructor() {
    this.registerDefaultAdapters();
  }

  /**
   * Register an adapter
   *
   * @param adapter - Adapter implementation
   */
  registerAdapter(adapter: FormatAdapter): void {
    if (this.adapters.has(adapter.name)) {
      console.warn(
        `AdapterRegistry: Adapter "${adapter.name}" is already registered. Overwriting.`
      );
    }

    this.adapters.set(adapter.name, adapter);
    if (process.env.DEBUG === 'true') {
      console.log(`AdapterRegistry: Registered adapter "${adapter.name}"`);
    }
  }

  /**
   * Get adapter by name
   *
   * @param adapterName - Name of adapter
   * @returns Adapter implementation
   * @throws Error if adapter not found
   */
  getAdapter(adapterName: string): FormatAdapter {
    const adapter = this.adapters.get(adapterName);

    if (!adapter) {
      throw new Error(
        `AdapterRegistry: Adapter "${adapterName}" not found. ` +
        `Available adapters: ${this.listAdapters().join(', ')}`
      );
    }

    return adapter;
  }

  /**
   * Get adapter for model
   *
   * @param modelConfig - Model configuration
   * @returns Adapter implementation
   * @throws Error if adapter not found
   */
  getAdapterForModel(modelConfig: ModelConfig): FormatAdapter {
    const adapterName = modelConfig.tools.adapter;
    return this.getAdapter(adapterName);
  }

  /**
   * Check if adapter is registered
   *
   * @param adapterName - Name of adapter
   * @returns true if registered
   */
  hasAdapter(adapterName: string): boolean {
    return this.adapters.has(adapterName);
  }

  /**
   * List all registered adapters
   *
   * @returns Array of adapter names
   */
  listAdapters(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get adapter by API pattern
   *
   * @param apiPattern - API pattern (e.g., "messages", "chat/completions")
   * @returns Adapter that supports this pattern
   * @throws Error if no adapter found for pattern
   */
  getAdapterByApiPattern(apiPattern: string): FormatAdapter {
    const adapters = Array.from(this.adapters.values());
    for (const adapter of adapters) {
      if (adapter.apiPatterns.includes(apiPattern)) {
        return adapter;
      }
    }

    throw new Error(
      `AdapterRegistry: No adapter found for API pattern "${apiPattern}". ` +
      `Available patterns: ${this.getAvailableApiPatterns().join(', ')}`
    );
  }

  /**
   * Get all available API patterns
   *
   * @returns Array of API patterns
   */
  getAvailableApiPatterns(): string[] {
    const patterns = new Set<string>();
    const adapters = Array.from(this.adapters.values());

    for (const adapter of adapters) {
      adapter.apiPatterns.forEach(pattern => patterns.add(pattern));
    }

    return Array.from(patterns);
  }

  /**
   * Unregister an adapter
   *
   * @param adapterName - Name of adapter to remove
   * @returns true if adapter was removed
   */
  unregisterAdapter(adapterName: string): boolean {
    return this.adapters.delete(adapterName);
  }

  /**
   * Clear all adapters
   */
  clear(): void {
    this.adapters.clear();
  }

  /**
   * Reset to default adapters
   */
  reset(): void {
    this.clear();
    this.registerDefaultAdapters();
  }

  /**
   * Get adapter statistics
   *
   * @returns Statistics about registered adapters
   */
  getStats(): {
    totalAdapters: number;
    adapters: Array<{
      name: string;
      apiPatterns: string[];
    }>;
  } {
    return {
      totalAdapters: this.adapters.size,
      adapters: Array.from(this.adapters.values()).map(adapter => ({
        name: adapter.name,
        apiPatterns: adapter.apiPatterns
      }))
    };
  }

  // ============================================
  // PRIVATE HELPER METHODS
  // ============================================

  /**
   * Register default adapters (4 pattern-based adapters)
   */
  private registerDefaultAdapters(): void {
    // Register generateContent API adapter (used by Google Gemini/Vertex AI)
    this.registerAdapter(new GenerateContentAPIAdapter());

    // Register google-genai API adapter (used by FREE Gemma/CodeGemma models)
    this.registerAdapter(new GoogleGenAPIAdapter());

    // Register messages API adapter (used by Anthropic Claude and XAI Grok)
    this.registerAdapter(new MessagesAPIAdapter());

    // Register chat/completions API adapter (used by OpenAI, DeepSeek, Groq, etc.)
    this.registerAdapter(new ChatCompletionsAPIAdapter());

    // Register responses API adapter (for stateful models like gpt-5-codex)
    this.registerAdapter(new ResponsesAPIAdapter());
  }
}

/**
 * Singleton instance
 */
let registryInstance: AdapterRegistry | null = null;

/**
 * Get singleton adapter registry instance
 *
 * @returns Adapter registry
 */
export function getAdapterRegistry(): AdapterRegistry {
  if (!registryInstance) {
    registryInstance = new AdapterRegistry();
  }

  return registryInstance;
}

/**
 * Reset singleton instance (useful for testing)
 */
export function resetAdapterRegistry(): void {
  registryInstance = null;
}

/**
 * Export default instance
 */
export const adapterRegistry = getAdapterRegistry();
