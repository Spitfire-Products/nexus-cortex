/**
 * Modular Registry Validation Test
 * Tests registry behavior dynamically without hardcoded counts
 *
 * Success Criteria:
 * - Models load correctly from modular cards
 * - Registry interface methods work properly
 * - All models have valid configurations
 * - No hardcoded counts (resilient to adding/removing models)
 */

import { describe, it, expect } from 'vitest';
import { ModularModelRegistry } from '../ModularModelRegistry.js';

describe('Modular Registry Validation', () => {
  describe('1. Model Loading', () => {
    it('should load models successfully', () => {
      const registry = new ModularModelRegistry();
      const models = registry.listModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
    });

    it('should load expected XAI models', () => {
      const registry = new ModularModelRegistry();
      const xaiModels = registry.getModelsByProvider('xai');

      expect(xaiModels.length).toBeGreaterThan(0);
      expect(xaiModels.some(m => m.id === 'grok-4.3')).toBe(true);
      expect(xaiModels.some(m => m.id === 'grok-4-fast')).toBe(true);
      expect(xaiModels.some(m => m.id === 'grok-4-fast-non-reasoning')).toBe(true);
    });

    it('should load expected DeepSeek models', () => {
      const registry = new ModularModelRegistry();
      const deepseekModels = registry.getModelsByProvider('deepseek');

      expect(deepseekModels.length).toBeGreaterThan(0);
      expect(deepseekModels.some(m => m.id === 'deepseek-chat')).toBe(true);
      expect(deepseekModels.some(m => m.id === 'deepseek-reasoner')).toBe(true);
    });

    it('should load expected Anthropic models', () => {
      const registry = new ModularModelRegistry();
      const anthropicModels = registry.getModelsByProvider('anthropic');

      expect(anthropicModels.length).toBeGreaterThan(0);
      expect(anthropicModels.some(m => m.id === 'claude-sonnet-4-5-20250929')).toBe(true);
      expect(anthropicModels.some(m => m.id === 'claude-haiku-4-5')).toBe(true);
      expect(anthropicModels.some(m => m.id === 'claude-fable-5')).toBe(true);
    });

    it('claude-fable-5 card should match the live Models API spec', () => {
      // Verified against GET /v1/models/claude-fable-5 (2026-06-10):
      // max_input_tokens 1M, max_tokens 128K, thinking adaptive-only.
      const registry = new ModularModelRegistry();
      const model = registry.getModel('claude-fable-5');

      expect(model.provider).toBe('anthropic');
      expect(model.displayName).toBe('Claude Fable 5');
      // The family gates the adaptive-thinking-only request surface in APIClient —
      // thinking.type 'enabled'/budget_tokens (and explicit 'disabled') 400 on Fable 5.
      expect(model.family).toBe('claude-fable-5');
      expect(model.limits.contextWindow).toBe(1000000);
      expect(model.limits.outputTokens).toBe(128000);
      expect(model.cost?.inputPerMillion).toBe(10.0);
      expect(model.cost?.outputPerMillion).toBe(50.0);
      expect(model.reasoning?.supported).toBe(true);
      expect(model.reasoning?.pattern).toBe('interleaved');
      // Sampling params are rejected by Fable 5 — the card must not opt into a
      // fixed temperature default (GatewayTranslationLayer only sends temperature
      // when a default or per-request value exists).
      expect(model.parameters.temperature.default).toBeUndefined();
    });

    it('should load expected Google Gemini models', () => {
      const registry = new ModularModelRegistry();
      const googleModels = registry.getModelsByProvider('google');

      const geminis = googleModels.filter(m => m.id.startsWith('gemini-'));
      expect(geminis.length).toBeGreaterThan(0);
      expect(geminis.some(m => m.id === 'gemini-3.5-flash')).toBe(true);
      expect(geminis.some(m => m.id === 'gemini-2.5-pro')).toBe(true);
    });

    it('should load expected Gemma models', () => {
      const registry = new ModularModelRegistry();
      const googleModels = registry.getModelsByProvider('google');

      const gemmas = googleModels.filter(m => m.id.startsWith('gemma-'));
      expect(gemmas.length).toBeGreaterThan(0);
      expect(gemmas.some(m => m.id === 'gemma-3-27b-it')).toBe(true);
    });

    it('should load expected OpenAI models', () => {
      const registry = new ModularModelRegistry();
      const openaiModels = registry.getModelsByProvider('openai');

      expect(openaiModels.length).toBeGreaterThan(0);
      expect(openaiModels.some(m => m.id === 'gpt-4o')).toBe(true);
      expect(openaiModels.some(m => m.id === 'gpt-5.5')).toBe(true);
      expect(openaiModels.some(m => m.id === 'gpt-5')).toBe(true);
    });
  });

  describe('2. Model Config Validation', () => {
    it('all models should have required fields', () => {
      const registry = new ModularModelRegistry();
      const modelIds = registry.listModels();

      modelIds.forEach(id => {
        const model = registry.getModel(id);

        // Aliases map to models with different canonical IDs — skip strict id check for those
        expect(model.id === id || registry.hasModel(model.id)).toBe(true);
        expect(model.provider).toBeTruthy();
        expect(model.displayName).toBeTruthy();
        expect(model.family).toBeTruthy();
        expect(model.api).toBeTruthy();
        expect(model.api.pattern).toBeTruthy();
        expect(model.api.endpoint).toBeTruthy();
        expect(model.tools).toBeTruthy();
        expect(model.parameters).toBeTruthy();
        expect(model.limits).toBeTruthy();
        expect(model.limits.contextWindow).toBeGreaterThan(0);
        expect(model.limits.outputTokens).toBeGreaterThan(0);
      });
    });

    it('models with tools should have valid tool configs', () => {
      const registry = new ModularModelRegistry();
      const modelIds = registry.listModels();

      modelIds.forEach(id => {
        const model = registry.getModel(id);

        if (model.tools.supported) {
          expect(model.tools.adapter).toBeTruthy();
          expect(model.tools.namingConvention).toBeTruthy();
          expect(model.tools.maxTools).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('3. Registry Interface Methods', () => {
    it('getModel() should return correct model', () => {
      const registry = new ModularModelRegistry();

      const model = registry.getModel('grok-4-fast');
      expect(model.id).toBe('grok-4-fast');
      expect(model.displayName).toBe('Grok 4 Fast');
    });

    it('getModel() should throw for non-existent model', () => {
      const registry = new ModularModelRegistry();
      expect(() => registry.getModel('non-existent-model-id')).toThrow();
    });

    it('hasModel() should work correctly', () => {
      const registry = new ModularModelRegistry();

      expect(registry.hasModel('grok-4-fast')).toBe(true);
      expect(registry.hasModel('claude-haiku-4-5')).toBe(true);
      expect(registry.hasModel('non-existent-model-id')).toBe(false);
    });

    it('listModels() should return string array', () => {
      const registry = new ModularModelRegistry();
      const models = registry.listModels();

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
      expect(models.every(id => typeof id === 'string')).toBe(true);
    });

    it('getModelsByProvider() should filter correctly', () => {
      const registry = new ModularModelRegistry();

      const xaiModels = registry.getModelsByProvider('xai');
      expect(xaiModels.every(m => m.provider === 'xai')).toBe(true);

      const anthropicModels = registry.getModelsByProvider('anthropic');
      expect(anthropicModels.every(m => m.provider === 'anthropic')).toBe(true);

      const googleModels = registry.getModelsByProvider('google');
      expect(googleModels.every(m => m.provider === 'google')).toBe(true);

      const openaiModels = registry.getModelsByProvider('openai');
      expect(openaiModels.every(m => m.provider === 'openai')).toBe(true);
    });

    it('getModelsByFamily() should filter correctly', () => {
      const registry = new ModularModelRegistry();

      const grok4Models = registry.getModelsByFamily('grok-4');
      expect(grok4Models.every(m => m.family === 'grok-4')).toBe(true);
      expect(grok4Models.length).toBeGreaterThan(0);

      const claude45Models = registry.getModelsByFamily('claude-4.5');
      expect(claude45Models.every(m => m.family === 'claude-4.5')).toBe(true);
      expect(claude45Models.length).toBeGreaterThan(0);
    });

    it('getHelperModel() should return valid model', () => {
      const registry = new ModularModelRegistry();

      const xaiHelper = registry.getHelperModel('xai');
      expect(xaiHelper).toBeTruthy();
      expect(xaiHelper.provider).toBe('xai');
      expect(xaiHelper.tools.supported).toBe(true);

      const anthropicHelper = registry.getHelperModel('anthropic');
      expect(anthropicHelper).toBeTruthy();
      expect(anthropicHelper.provider).toBe('anthropic');
      expect(anthropicHelper.tools.supported).toBe(true);
    });

    it('getCompactionThreshold() should calculate correctly', () => {
      const registry = new ModularModelRegistry();

      const threshold = registry.getCompactionThreshold('grok-4-fast');
      expect(threshold).toBeGreaterThan(0);

      const model = registry.getModel('grok-4-fast');
      const expected = Math.floor(model.limits.contextWindow * 0.8) - 4000;
      expect(threshold).toBe(expected);
    });

    it('registerModel() should allow adding new models', () => {
      const registry = new ModularModelRegistry();
      const initialCount = registry.listModels().length;

      registry.registerModel({
        id: 'test-custom-model',
        provider: 'test-provider',
        displayName: 'Test Custom Model',
        family: 'test-family',
        api: {
          pattern: 'messages',
          endpoint: 'https://test.example.com/api',
          apiKeyEnvVar: 'TEST_API_KEY',
          authHeader: 'Authorization',
          authPrefix: 'Bearer'
        },
        tools: {
          supported: true,
          adapter: 'MessagesAPIAdapter',
          namingConvention: 'snake_case',
          maxTools: 64,
          parallelToolCalls: true
        },
        parameters: {
          temperature: { supported: true, paramName: 'temperature', default: 1.0, min: 0.0, max: 1.0 },
          maxTokens: { supported: true, paramName: 'max_tokens', default: 4096, min: 1, max: 8192 },
          topP: { supported: true, paramName: 'top_p', default: 1.0, min: 0.0, max: 1.0 }
        },
        limits: {
          contextWindow: 128000,
          outputTokens: 8192,
          requestsPerMinute: 100,
          tokensPerMinute: 100000
        },
        streaming: { supported: true, format: 'sse' },
        compaction: {
          strategy: 'auto',
          thresholdCalculation: { method: 'percentage', percentage: 0.8, safetyMargin: 4000 },
          behavior: { preserveRecent: 10, compactOlder: true, useHelperModel: false }
        },
        cost: {
          inputPerMillion: 1.0,
          outputPerMillion: 3.0
        }
      });

      expect(registry.listModels().length).toBe(initialCount + 1);
      expect(registry.hasModel('test-custom-model')).toBe(true);
    });
  });

  describe('4. Modular Architecture Features', () => {
    it('should support filtering during construction', () => {
      const registry = new ModularModelRegistry({
        filter: (model) => model.id.includes('fast')
      });

      const models = registry.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.every(id => id.includes('fast'))).toBe(true);
    });

    it('should support provider-specific filtering', () => {
      const registry = new ModularModelRegistry({
        filter: (model) => model.provider === 'xai'
      });

      const models = registry.listModels();
      expect(models.length).toBeGreaterThan(0);

      models.forEach(id => {
        const model = registry.getModel(id);
        expect(model.provider).toBe('xai');
      });
    });

    it('recently added model should be accessible', () => {
      const registry = new ModularModelRegistry();

      // Verify grok-4-fast-non-reasoning exists (added during Phase 3)
      expect(registry.hasModel('grok-4-fast-non-reasoning')).toBe(true);

      const model = registry.getModel('grok-4-fast-non-reasoning');
      expect(model.displayName).toBe('Grok 4 Fast Non-Reasoning');
      expect(model.provider).toBe('xai');
    });
  });
});
