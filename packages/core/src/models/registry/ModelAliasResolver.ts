/**
 * Model Alias Resolver
 *
 * Resolves model aliases (like 'sonnet', 'opus', 'haiku') to full model IDs.
 * Used by the sub-agent system to support convenient model specification
 * in agent definitions.
 *
 * @module models/registry/ModelAliasResolver
 * @version 1.0.0
 */

import type { ModularModelRegistry } from './ModularModelRegistry.js';

/**
 * Standard model aliases mapping to full model IDs
 *
 * These aliases provide convenient shortcuts for common models.
 * Aliases are case-insensitive when resolved.
 */
export const MODEL_ALIASES: Record<string, string> = {
  // ─────────────────────────────────────────────────────────────────
  // Anthropic Claude Models
  // ─────────────────────────────────────────────────────────────────
  'sonnet': 'claude-sonnet-4-5-20250929',
  'claude-sonnet': 'claude-sonnet-4-5-20250929',
  'sonnet-4': 'claude-sonnet-4-5-20250929',
  'sonnet-4.5': 'claude-sonnet-4-5-20250929',

  'opus': 'claude-opus-4-1-20250805',
  'claude-opus': 'claude-opus-4-1-20250805',
  'opus-4': 'claude-opus-4-1-20250805',

  'haiku': 'claude-3-5-haiku-20241022',
  'claude-haiku': 'claude-3-5-haiku-20241022',
  'haiku-3.5': 'claude-3-5-haiku-20241022',

  // ─────────────────────────────────────────────────────────────────
  // Google Gemini Models
  // ─────────────────────────────────────────────────────────────────
  'gemini': 'gemini-2.5-pro',
  'gemini-pro': 'gemini-2.5-pro',
  'gemini-2.5': 'gemini-2.5-pro',

  'gemini-flash': 'gemini-2.5-flash',
  'flash': 'gemini-2.5-flash',

  'gemini-thinking': 'gemini-2.5-flash-thinking',

  // ─────────────────────────────────────────────────────────────────
  // OpenAI Models
  // ─────────────────────────────────────────────────────────────────
  'gpt4': 'gpt-4.1',
  'gpt-4': 'gpt-4.1',
  'gpt4o': 'gpt-4o',
  'gpt-4o': 'gpt-4o',
  'gpt4o-mini': 'gpt-4o-mini',

  'o1': 'o1',
  'o1-mini': 'o1-mini',
  'o1-preview': 'o1-preview',
  'o3': 'o3',
  'o3-mini': 'o3-mini',
  'o4-mini': 'o4-mini',

  // ─────────────────────────────────────────────────────────────────
  // X.AI Grok Models
  // ─────────────────────────────────────────────────────────────────
  'grok': 'grok-4.1-fast-reasoning',
  'grok-4': 'grok-4.1-fast-reasoning',
  'grok-fast': 'grok-4.1-fast-reasoning',
  'grok-mini': 'grok-3-mini-fast-beta',

  // ─────────────────────────────────────────────────────────────────
  // DeepSeek Models
  // ─────────────────────────────────────────────────────────────────
  'deepseek': 'deepseek-chat',
  'deepseek-chat': 'deepseek-chat',
  'deepseek-coder': 'deepseek-coder',
  'reasoner': 'deepseek-reasoner',
  'deepseek-reasoner': 'deepseek-reasoner',

  // ─────────────────────────────────────────────────────────────────
  // Mistral Models
  // ─────────────────────────────────────────────────────────────────
  'mistral': 'mistral-large-latest',
  'mistral-large': 'mistral-large-latest',
  'codestral': 'codestral-latest',
  'pixtral': 'pixtral-large-latest',

  // ─────────────────────────────────────────────────────────────────
  // Cohere Models
  // ─────────────────────────────────────────────────────────────────
  'command-r': 'command-r-plus',
  'cohere': 'command-r-plus',
};

/**
 * Result of resolving a model alias
 */
export interface ResolvedModel {
  /** The full model ID */
  modelId: string;

  /** Whether the input was an alias that was resolved */
  wasAlias: boolean;

  /** The original input (for logging/debugging) */
  originalInput: string;
}

/**
 * Options for model resolution
 */
export interface ResolveOptions {
  /** If true, throws on unknown model. If false, returns null. Default: true */
  strict?: boolean;

  /** Registry to validate full model IDs against (optional) */
  registry?: ModularModelRegistry;
}

/**
 * Model Alias Resolver
 *
 * Provides resolution of model aliases to full model IDs with optional
 * validation against a model registry.
 */
export class ModelAliasResolver {
  private aliases: Map<string, string>;

  constructor(customAliases?: Record<string, string>) {
    // Build case-insensitive alias map
    this.aliases = new Map();

    // Add standard aliases
    for (const [alias, modelId] of Object.entries(MODEL_ALIASES)) {
      this.aliases.set(alias.toLowerCase(), modelId);
    }

    // Add custom aliases (override if conflicts)
    if (customAliases) {
      for (const [alias, modelId] of Object.entries(customAliases)) {
        this.aliases.set(alias.toLowerCase(), modelId);
      }
    }
  }

  /**
   * Resolve a model specification to a full model ID
   *
   * @param modelSpec - Can be:
   *   - 'inherit': Returns null (use parent's model)
   *   - An alias like 'sonnet': Returns the full model ID
   *   - A full model ID: Returns as-is (optionally validated)
   * @param options - Resolution options
   * @returns Resolved model info, or null for 'inherit'
   * @throws Error if strict mode and model is unknown
   */
  resolve(modelSpec: string, options: ResolveOptions = {}): ResolvedModel | null {
    const { strict = true, registry } = options;
    const normalized = modelSpec.trim().toLowerCase();

    // Handle 'inherit' special case
    if (normalized === 'inherit') {
      return null;
    }

    // Check if it's a known alias
    const aliasedModelId = this.aliases.get(normalized);
    if (aliasedModelId) {
      return {
        modelId: aliasedModelId,
        wasAlias: true,
        originalInput: modelSpec,
      };
    }

    // Not an alias - treat as full model ID
    // Optionally validate against registry
    if (registry) {
      if (!registry.hasModel(modelSpec)) {
        if (strict) {
          const available = this.getAvailableAliases().slice(0, 10).join(', ');
          throw new Error(
            `Unknown model: "${modelSpec}". ` +
            `Use an alias (${available}, ...) or a valid model ID from the registry.`
          );
        }
        return null;
      }
    }

    // Return the model ID as-is
    return {
      modelId: modelSpec,
      wasAlias: false,
      originalInput: modelSpec,
    };
  }

  /**
   * Quick resolution without options
   * Returns the model ID string or null for 'inherit'
   * Throws on unknown models
   */
  resolveToId(modelSpec: string): string | null {
    const result = this.resolve(modelSpec, { strict: false });
    return result?.modelId ?? null;
  }

  /**
   * Check if a string is a known alias
   */
  isAlias(spec: string): boolean {
    return this.aliases.has(spec.toLowerCase());
  }

  /**
   * Get all available alias names
   */
  getAvailableAliases(): string[] {
    return Array.from(this.aliases.keys()).sort();
  }

  /**
   * Get the target model ID for an alias
   * Returns undefined if not an alias
   */
  getAliasTarget(alias: string): string | undefined {
    return this.aliases.get(alias.toLowerCase());
  }

  /**
   * Add a custom alias
   */
  addAlias(alias: string, modelId: string): void {
    this.aliases.set(alias.toLowerCase(), modelId);
  }

  /**
   * Remove an alias
   */
  removeAlias(alias: string): boolean {
    return this.aliases.delete(alias.toLowerCase());
  }

  /**
   * Get all aliases grouped by provider
   */
  getAliasesByProvider(): {
    anthropic: string[];
    google: string[];
    openai: string[];
    xai: string[];
    deepseek: string[];
    mistral: string[];
    cohere: string[];
    other: string[];
  } {
    const grouped = {
      anthropic: [] as string[],
      google: [] as string[],
      openai: [] as string[],
      xai: [] as string[],
      deepseek: [] as string[],
      mistral: [] as string[],
      cohere: [] as string[],
      other: [] as string[],
    };

    for (const [alias, modelId] of this.aliases) {
      if (modelId.startsWith('claude')) {
        grouped.anthropic.push(alias);
      } else if (modelId.startsWith('gemini')) {
        grouped.google.push(alias);
      } else if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4')) {
        grouped.openai.push(alias);
      } else if (modelId.startsWith('grok')) {
        grouped.xai.push(alias);
      } else if (modelId.startsWith('deepseek')) {
        grouped.deepseek.push(alias);
      } else if (modelId.startsWith('mistral') || modelId.startsWith('codestral') || modelId.startsWith('pixtral')) {
        grouped.mistral.push(alias);
      } else if (modelId.startsWith('command')) {
        grouped.cohere.push(alias);
      } else {
        grouped.other.push(alias);
      }
    }

    return grouped;
  }
}

/**
 * Default singleton instance
 */
let defaultResolver: ModelAliasResolver | null = null;

/**
 * Get the default resolver instance
 */
export function getDefaultResolver(): ModelAliasResolver {
  if (!defaultResolver) {
    defaultResolver = new ModelAliasResolver();
  }
  return defaultResolver;
}

/**
 * Convenience function: resolve a model spec using the default resolver
 */
export function resolveModelAlias(modelSpec: string): string | null {
  return getDefaultResolver().resolveToId(modelSpec);
}
