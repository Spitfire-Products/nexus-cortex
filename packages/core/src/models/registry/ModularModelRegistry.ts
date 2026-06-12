/**
 * Modular Model Registry
 * Loads all model cards from modular files
 *
 * Phase 3: Complete Modular Implementation
 * - 100% model cards (no fallback)
 * - All providers: XAI, DeepSeek, Anthropic, Gemma, Google, OpenAI, GLM, Qwen, Moonshot, MiniMax, Mercury, Cloudflare
 * - The card files are the source of truth for the model count — run `cortex models list`
 *
 * Benefits:
 * - One model = one file = clear git history
 * - Easy to add/modify models (< 2 minutes)
 * - Type-safe with configurator pattern
 * - No monolithic registry maintenance
 */

import type { ModelConfig, ModelRegistry } from '../ModelConfig.interface.js';
import { MODEL_ALIASES } from './ModelAliasResolver.js';

// Import modular model cards (all providers)
import * as xaiModels from '../cards/xai/index.js';
import * as deepseekModels from '../cards/deepseek/index.js';
import * as anthropicModels from '../cards/anthropic/index.js';
import * as gemmaModels from '../cards/gemma/index.js';
import * as googleModels from '../cards/google/index.js';
import * as openaiModels from '../cards/openai/index.js';
import * as glmModels from '../cards/glm/index.js';
import * as qwenModels from '../cards/qwen/index.js';
import * as moonshotModels from '../cards/moonshot/index.js';
import * as minimaxModels from '../cards/minimax/index.js';
import * as cloudflareModels from '../cards/cloudflare/index.js';
import * as mercuryModels from '../cards/mercury/index.js';

export interface ModularModelRegistryOptions {
  /**
   * Enable debug logging
   */
  debug?: boolean;

  /**
   * Filter function to selectively load models
   */
  filter?: (model: ModelConfig) => boolean;
}

/**
 * Modular Model Registry
 *
 * Implements the ModelRegistry interface using imported model cards
 */
export class ModularModelRegistry implements ModelRegistry {
  private models: Map<string, ModelConfig> = new Map();
  private options: ModularModelRegistryOptions;

  constructor(options: ModularModelRegistryOptions = {}) {
    this.options = options;
    this.loadModelCards();
  }

  /**
   * Load model cards from modular imports
   */
  private loadModelCards(): void {
    // All models from modular cards (100% coverage)
    const allModelCards: ModelConfig[] = [
      // XAI models
      xaiModels.grok43,
      xaiModels.grok420Reasoning,
      xaiModels.grok420NonReasoning,
      xaiModels.grok420MultiAgent,
      xaiModels.grok41FastReasoning,
      xaiModels.grok41FastNonReasoning,
      xaiModels.grok4Fast,
      xaiModels.grok4FastNonReasoning,
      xaiModels.grokCodeFast1,           // grok-build-0.1 via Messages API (alias)
      xaiModels.grokBuild01,             // grok-build-0.1 via Messages API (canonical)
      xaiModels.grokBuild01Responses,    // grok-build-0.1 via Responses API

      // DeepSeek models. deepseek-chat and deepseek-reasoner removed 2026-06-10
      // (DeepSeek deprecating both 2026-07-24); deepseek-v4-flash supersedes chat and
      // deepseek-v4-pro supersedes reasoner. The old names redirect to the V4 pair via
      // ModelAliasResolver for back-compat. (v3.x / r1-0528 / deepseek-coder were
      // already rejected by the live API as of 2026-05-13.)
      deepseekModels.deepseekV4Pro,
      deepseekModels.deepseekV4Flash,

      // Anthropic models
      anthropicModels.claudeFable5,
      anthropicModels.claudeOpus48,
      anthropicModels.claudeOpus47,
      anthropicModels.claudeOpus46,
      anthropicModels.claudeSonnet46,
      anthropicModels.claudeSonnet45,
      anthropicModels.claudeOpus45,
      anthropicModels.claudeHaiku45,
      anthropicModels.claudeSonnet4,
      anthropicModels.claudeOpus41,

      // Gemma models
      gemmaModels.gemma327bIt,
      gemmaModels.gemma312bIt,
      gemmaModels.gemma34bIt,
      gemmaModels.gemma31bIt,

      // Google Gemini models (gemini-3.5-flash GA added 2026-05-27;
      // gemini-3-pro-preview + gemini-3.1-flash-lite-preview discontinued)
      googleModels.gemini35Flash,
      googleModels.gemini3FlashPreview,
      googleModels.gemini31ProPreview,
      googleModels.gemini25Pro,
      googleModels.gemini25Flash,
      googleModels.gemini25FlashSDK,
      googleModels.gemini25FlashLite,
      googleModels.gemini25ComputerUsePreview,

      // OpenAI models
      openaiModels.gpt4o,
      openaiModels.gpt4oMini,
      openaiModels.gpt55,
      openaiModels.gpt54,
      openaiModels.gpt54Mini,
      openaiModels.gpt5,
      openaiModels.gpt51,
      openaiModels.gpt51Reasoning,
      openaiModels.gpt52,
      openaiModels.gpt5Mini,
      openaiModels.gpt5Nano,
      openaiModels.gpt5ChatLatest,
      openaiModels.gpt5Codex,
      openaiModels.gpt41,
      openaiModels.gpt41Mini,
      openaiModels.gpt41Nano,
      openaiModels.o1Pro,
      openaiModels.o3,
      openaiModels.o3Pro,
      openaiModels.o3Mini,
      openaiModels.o4Mini,

      // GLM models
      glmModels.glm46,
      glmModels.glm45,
      glmModels.glm45Air,
      glmModels.glm4,
      glmModels.glm4Flash,

      // Qwen models
      qwenModels.qwen3Coder,
      qwenModels.qwen3MaxPreview,
      qwenModels.qwenTurbo,
      qwenModels.qwenPlus,
      qwenModels.qwenMax,

      // Moonshot models
      moonshotModels.kimiK2Instruct,
      moonshotModels.kimiK2Thinking,

      // MiniMax models
      minimaxModels.minimaxM2,
      minimaxModels.minimaxM2Stable,

      // Cloudflare Workers AI models (parity with the upstream CORTEX
      // 2026-05-14; OpenAI-compatible chat/completions endpoint, single auth
      // grants access to Moonshot, NVIDIA, Google Gemma 4, OpenAI OSS,
      // Qwen, Zhipu GLM, Mistral, Meta Llama, IBM Granite)
      cloudflareModels.cfKimiK26,
      cloudflareModels.cfKimiK25,
      cloudflareModels.cfNemotron3,
      cloudflareModels.cfGemma426b,
      cloudflareModels.cfGptOss120b,
      cloudflareModels.cfGptOss20b,
      cloudflareModels.cfQwen330b,
      cloudflareModels.cfGlm47Flash,
      cloudflareModels.cfMistralSmall31,
      cloudflareModels.cfLlama4Scout,
      cloudflareModels.cfLlama3370b,
      cloudflareModels.cfQwq32b,
      cloudflareModels.cfGranite4,

      // Mercury (Inception Labs) — diffusion LLM, OpenAI-compatible.
      // Direct API serves only mercury-2 (verified 2026-06-07).
      mercuryModels.mercury2
    ];

    // Apply user filter if provided
    const filteredModels = this.options.filter
      ? allModelCards.filter(this.options.filter)
      : allModelCards;

    // Register all models
    for (const model of filteredModels) {
      this.models.set(model.id, model);
    }

    // Register model aliases (same model config, multiple IDs)
    this.registerAliases();

    if (this.options.debug) {
      // Counts computed from the canonical cards (alias entries — where the map key
      // differs from the config's own id — are skipped) so the breakdown never drifts.
      const byProvider = new Map<string, number>();
      let canonical = 0;
      for (const [id, model] of this.models) {
        if (id !== model.id) continue;
        canonical++;
        byProvider.set(model.provider, (byProvider.get(model.provider) ?? 0) + 1);
      }
      const breakdown = [...byProvider.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([provider, n]) => `${provider}: ${n}`)
        .join(' | ');
      console.log(`[ModularModelRegistry] Loaded ${canonical} models (100% modular)`);
      console.log(` - ${breakdown}`);
    }
  }

  /**
   * Register model aliases
   * Maps alternative model IDs to the same model configuration
   */
  private registerAliases(): void {
    // XAI Grok 4.1 Fast Reasoning aliases
    const grok41FastReasoning = this.models.get('grok-4-1-fast-reasoning');
    if (grok41FastReasoning) {
      this.models.set('grok-4-1-fast', grok41FastReasoning);
      this.models.set('grok-4-1-fast-reasoning-latest', grok41FastReasoning);
    }

    // XAI Grok 4.1 Fast Non-Reasoning aliases
    const grok41FastNonReasoning = this.models.get('grok-4-1-fast-non-reasoning');
    if (grok41FastNonReasoning) {
      this.models.set('grok-4-1-fast-non-reasoning-latest', grok41FastNonReasoning);
    }

    // Dash-to-dot convenience aliases (users type dashes, IDs use dots)
    const dashAliases: [string, string][] = [
      ['gpt-5-4-mini', 'gpt-5.4-mini'],
      ['gpt-5-4', 'gpt-5.4'],
      ['gpt-5-5', 'gpt-5.5'],
      ['gemini-2-5-flash', 'gemini-2.5-flash'],
      ['gemini-2-5-pro', 'gemini-2.5-pro'],
      ['gemini-3-5-flash', 'gemini-3.5-flash'],
    ];
    for (const [alias, canonical] of dashAliases) {
      const model = this.models.get(canonical);
      if (model) this.models.set(alias, model);
    }
  }

  /**
   * Register a model
   */
  registerModel(model: ModelConfig): void {
    this.models.set(model.id, model);
  }

  /**
   * Get model by ID
   * @throws Error if model not found
   */
  getModel(modelId: string): ModelConfig {
    let model = this.models.get(modelId);
    if (!model) {
      // Back-compat aliases: deprecated names removed from the card set keep
      // resolving (e.g. deepseek-chat → deepseek-v4-flash), so existing configs,
      // sessions, and scripts auto-migrate to the successor models. MODEL_ALIASES
      // is the single source of truth for these mappings.
      const alias = MODEL_ALIASES[modelId.trim().toLowerCase()];
      if (alias) model = this.models.get(alias);
    }
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }
    return model;
  }

  /**
   * List all registered model IDs
   */
  listModels(): string[] {
    return Array.from(this.models.keys());
  }

  /**
   * Check if model exists
   */
  hasModel(modelId: string): boolean {
    return this.models.has(modelId);
  }

  /**
   * Get all models for a specific provider
   */
  getModelsByProvider(provider: string): ModelConfig[] {
    return Array.from(this.models.values()).filter(
      (model) => model.provider === provider
    );
  }

  /**
   * Get all models in a specific family
   */
  getModelsByFamily(family: string): ModelConfig[] {
    return Array.from(this.models.values()).filter(
      (model) => model.family === family
    );
  }

  /**
   * Get helper model for a provider
   * Returns the most cost-effective model suitable for helper tasks
   */
  getHelperModel(provider: string): ModelConfig {
    const providerModels = this.getModelsByProvider(provider);

    if (providerModels.length === 0) {
      throw new Error(`No models found for provider: ${provider}`);
    }

    // Find the cheapest model that supports tools
    const helperModel = providerModels
      .filter((model) => model.tools.supported)
      .sort((a, b) => {
        const aCost = (a.cost?.inputPerMillion || 0) + (a.cost?.outputPerMillion || 0);
        const bCost = (b.cost?.inputPerMillion || 0) + (b.cost?.outputPerMillion || 0);
        return aCost - bCost;
      })[0];

    if (!helperModel) {
      throw new Error(`No tool-supporting models found for provider: ${provider}`);
    }

    return helperModel;
  }

  /**
   * Calculate compaction threshold for a model
   * Returns the token count at which compaction should be triggered
   */
  getCompactionThreshold(modelId: string): number {
    const model = this.getModel(modelId);
    const config = model.compaction.thresholdCalculation;

    if (config.method === 'percentage' && config.percentage !== undefined) {
      const threshold = Math.floor(
        model.limits.contextWindow * config.percentage - config.safetyMargin
      );
      return Math.max(threshold, 0);
    } else if (config.method === 'absolute' && config.absolute !== undefined) {
      return config.absolute;
    }

    // Default fallback: 80% of context window with 4000 token safety margin
    return Math.max(Math.floor(model.limits.contextWindow * 0.8) - 4000, 0);
  }

  /**
   * Get all model configurations
   * Helper method (not part of ModelRegistry interface) for convenience
   */
  getAllModels(): ModelConfig[] {
    return Array.from(this.models.values());
  }
}
