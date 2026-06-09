/**
 * AdapterRegistry Tests
 *
 * Test suite for adapter registry management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AdapterRegistry, resetAdapterRegistry } from '../AdapterRegistry';
import { GenerateContentAPIAdapter } from '../GenerateContentAPIAdapter';
import { GoogleGenAPIAdapter } from '../GoogleGenAPIAdapter';
import { MessagesAPIAdapter } from '../MessagesAPIAdapter';
import { ChatCompletionsAPIAdapter } from '../ChatCompletionsAPIAdapter';
import { ResponsesAPIAdapter } from '../ResponsesAPIAdapter';
import { ModelConfig } from '../../models/ModelConfig.interface';

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    resetAdapterRegistry();
    registry = new AdapterRegistry();
  });

  afterEach(() => {
    resetAdapterRegistry();
  });

  describe('constructor', () => {
    it('should register default adapters on creation', () => {
      expect(registry.hasAdapter('GenerateContentAPIAdapter')).toBe(true);
      expect(registry.hasAdapter('GoogleGenAPIAdapter')).toBe(true);
      expect(registry.hasAdapter('MessagesAPIAdapter')).toBe(true);
      expect(registry.hasAdapter('ChatCompletionsAPIAdapter')).toBe(true);
      expect(registry.hasAdapter('ResponsesAPIAdapter')).toBe(true);
    });

    it('should have 5 default adapters', () => {
      const adapters = registry.listAdapters();
      expect(adapters).toHaveLength(5);
    });
  });

  describe('registerAdapter', () => {
    it('should register a new adapter', () => {
      const customAdapter = new GenerateContentAPIAdapter();
      (customAdapter as any).name = 'CustomAdapter';

      registry.registerAdapter(customAdapter);

      expect(registry.hasAdapter('CustomAdapter')).toBe(true);
    });

    it('should allow overwriting existing adapter', () => {
      const geminiAdapter = new GenerateContentAPIAdapter();

      // Should not throw
      expect(() => registry.registerAdapter(geminiAdapter)).not.toThrow();
    });
  });

  describe('getAdapter', () => {
    it('should retrieve registered adapter by name', () => {
      const adapter = registry.getAdapter('GenerateContentAPIAdapter');

      expect(adapter).toBeInstanceOf(GenerateContentAPIAdapter);
      expect(adapter.name).toBe('GenerateContentAPIAdapter');
    });

    it('should throw error for non-existent adapter', () => {
      expect(() => registry.getAdapter('NonExistentAdapter')).toThrow();
      expect(() => registry.getAdapter('NonExistentAdapter')).toThrow(/not found/);
    });
  });

  describe('getAdapterForModel', () => {
    it('should retrieve adapter for Gemini model', () => {
      const mockConfig: ModelConfig = {
        id: 'gemini-pro',
        provider: 'google',
        tools: {
          adapter: 'GenerateContentAPIAdapter'
        }
      } as ModelConfig;

      const adapter = registry.getAdapterForModel(mockConfig);

      expect(adapter).toBeInstanceOf(GenerateContentAPIAdapter);
    });

    it('should retrieve adapter for Claude model', () => {
      const mockConfig: ModelConfig = {
        id: 'claude-3-5-sonnet',
        provider: 'anthropic',
        tools: {
          adapter: 'MessagesAPIAdapter'
        }
      } as ModelConfig;

      const adapter = registry.getAdapterForModel(mockConfig);

      expect(adapter).toBeInstanceOf(MessagesAPIAdapter);
    });

    it('should retrieve adapter for OpenAI model', () => {
      const mockConfig: ModelConfig = {
        id: 'gpt-4',
        provider: 'openai',
        tools: {
          adapter: 'ChatCompletionsAPIAdapter'
        }
      } as ModelConfig;

      const adapter = registry.getAdapterForModel(mockConfig);

      expect(adapter).toBeInstanceOf(ChatCompletionsAPIAdapter);
    });
  });

  describe('hasAdapter', () => {
    it('should return true for registered adapters', () => {
      expect(registry.hasAdapter('GenerateContentAPIAdapter')).toBe(true);
      expect(registry.hasAdapter('MessagesAPIAdapter')).toBe(true);
      expect(registry.hasAdapter('ChatCompletionsAPIAdapter')).toBe(true);
      expect(registry.hasAdapter('ResponsesAPIAdapter')).toBe(true);
    });

    it('should return false for non-registered adapters', () => {
      expect(registry.hasAdapter('FakeAdapter')).toBe(false);
    });
  });

  describe('listAdapters', () => {
    it('should list all registered adapter names', () => {
      const adapters = registry.listAdapters();

      expect(adapters).toContain('GenerateContentAPIAdapter');
      expect(adapters).toContain('MessagesAPIAdapter');
      expect(adapters).toContain('ChatCompletionsAPIAdapter');
      expect(adapters).toContain('ResponsesAPIAdapter');
      expect(adapters).toHaveLength(5);
    });
  });

  describe('getAdapterByApiPattern', () => {
    it('should retrieve adapter by generateContent pattern', () => {
      const adapter = registry.getAdapterByApiPattern('generateContent');

      expect(adapter).toBeInstanceOf(GenerateContentAPIAdapter);
    });

    it('should retrieve adapter by messages pattern', () => {
      const adapter = registry.getAdapterByApiPattern('messages');

      expect(adapter).toBeInstanceOf(MessagesAPIAdapter);
    });

    it('should retrieve adapter by chat/completions pattern', () => {
      const adapter = registry.getAdapterByApiPattern('chat/completions');

      expect(adapter).toBeInstanceOf(ChatCompletionsAPIAdapter);
    });

    it('should retrieve adapter by responses pattern', () => {
      const adapter = registry.getAdapterByApiPattern('responses');

      expect(adapter).toBeInstanceOf(ResponsesAPIAdapter);
    });

    it('should throw for unknown API pattern', () => {
      expect(() => registry.getAdapterByApiPattern('unknown-pattern')).toThrow();
    });
  });

  describe('getAvailableApiPatterns', () => {
    it('should return all supported API patterns', () => {
      const patterns = registry.getAvailableApiPatterns();

      expect(patterns).toContain('generateContent');
      expect(patterns).toContain('messages');
      expect(patterns).toContain('chat/completions');
      expect(patterns).toContain('responses');
      expect(patterns).toHaveLength(5);
    });
  });

  describe('unregisterAdapter', () => {
    it('should remove adapter from registry', () => {
      const removed = registry.unregisterAdapter('GenerateContentAPIAdapter');

      expect(removed).toBe(true);
      expect(registry.hasAdapter('GenerateContentAPIAdapter')).toBe(false);
    });

    it('should return false for non-existent adapter', () => {
      const removed = registry.unregisterAdapter('FakeAdapter');

      expect(removed).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all adapters', () => {
      registry.clear();

      expect(registry.listAdapters()).toHaveLength(0);
    });
  });

  describe('reset', () => {
    it('should restore default adapters', () => {
      registry.clear();
      expect(registry.listAdapters()).toHaveLength(0);

      registry.reset();

      expect(registry.listAdapters()).toHaveLength(5);
      expect(registry.hasAdapter('GenerateContentAPIAdapter')).toBe(true);
      expect(registry.hasAdapter('MessagesAPIAdapter')).toBe(true);
      expect(registry.hasAdapter('ChatCompletionsAPIAdapter')).toBe(true);
      expect(registry.hasAdapter('ResponsesAPIAdapter')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return registry statistics', () => {
      const stats = registry.getStats();

      expect(stats.totalAdapters).toBe(5);
      expect(stats.adapters).toHaveLength(5);
      expect(stats.adapters[0]).toHaveProperty('name');
      expect(stats.adapters[0]).toHaveProperty('apiPatterns');
    });
  });
});
