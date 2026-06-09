/**
 * Helper Middleware Adapters - Unit Tests
 * Phase 1.5: Week 2
 *
 * Tests the core logic of all 5 helper adapters without making real API calls.
 * For real API integration tests, see smoke/ directory.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessagesAPIHelperAdapter } from '../adapters/MessagesAPIHelperAdapter.js';
import { ChatCompletionsAPIHelperAdapter } from '../adapters/ChatCompletionsAPIHelperAdapter.js';
import { GoogleGenAPIHelperAdapter } from '../adapters/GoogleGenAPIHelperAdapter.js';
import { GenerateContentAPIHelperAdapter } from '../adapters/GenerateContentAPIHelperAdapter.js';
import { ResponsesAPIHelperAdapter } from '../adapters/ResponsesAPIHelperAdapter.js';
import { HelperModelMiddlewareRegistry } from '../HelperModelMiddlewareRegistry.js';
import { registerDefaultHelperAdapters } from '../adapters/index.js';
import type { ModelConfig } from '../../../models/ModelConfig.interface.js';
import type { HelperCanonicalMessage } from '../HelperMiddlewareAdapter.interface.js';

// Mock ModelConfigs for testing
const mockClaudeHaikuConfig: Partial<ModelConfig> = {
  id: 'claude-haiku-4-5',
  provider: 'anthropic',
  family: 'claude-3.5',
  api: {
    pattern: 'messages',
    endpoint: 'https://api.anthropic.com/v1/messages',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    authHeader: 'x-api-key',
    authPrefix: '',
    versionHeader: { name: 'anthropic-version', value: '2023-06-01' }
  },
  limits: {
    contextWindow: 200000,
    outputTokens: 8192,
    requestsPerMinute: 4000,
    tokensPerMinute: 400000
  }
};

const mockGPT35Config: Partial<ModelConfig> = {
  id: 'gpt-3.5-turbo',
  provider: 'openai',
  family: 'gpt-3.5',
  api: {
    pattern: 'chat/completions',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    authHeader: 'Authorization',
    authPrefix: 'Bearer'
  },
  limits: {
    contextWindow: 16385,
    outputTokens: 4096,
    requestsPerMinute: 10000,
    tokensPerMinute: 2000000
  }
};

const mockGemma27BConfig: Partial<ModelConfig> = {
  id: 'gemma-3-27b-it',
  provider: 'google',
  family: 'gemma-3',
  api: {
    pattern: 'google-genai',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent',
    apiKeyEnvVar: 'GOOGLE_API_KEY',
    authHeader: 'x-goog-api-key',
    authPrefix: ''
  },
  limits: {
    contextWindow: 128000,
    outputTokens: 8192,
    requestsPerMinute: 60,
    tokensPerMinute: 1000000
  }
};

const mockGeminiFlashConfig: Partial<ModelConfig> = {
  id: 'gemini-2.0-flash-lite',
  provider: 'google',
  family: 'gemini-2.0',
  api: {
    pattern: 'generateContent',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
    apiKeyEnvVar: 'GOOGLE_API_KEY',
    authHeader: 'x-goog-api-key',
    authPrefix: ''
  },
  limits: {
    contextWindow: 1000000,
    outputTokens: 8192,
    requestsPerMinute: 1000,
    tokensPerMinute: 4000000
  }
};

const mockGPT5CodexConfig: Partial<ModelConfig> = {
  id: 'gpt-5-codex',
  provider: 'openai',
  family: 'gpt-5',
  api: {
    pattern: 'responses',
    endpoint: 'https://api.openai.com/v1/responses',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    authHeader: 'Authorization',
    authPrefix: 'Bearer'
  },
  limits: {
    contextWindow: 400000,
    outputTokens: 128000,
    requestsPerMinute: 500,
    tokensPerMinute: 1000000
  }
};

// Sample messages for testing
const sampleMessages: HelperCanonicalMessage[] = [
  {
    role: 'user',
    content: 'What is the capital of France?',
    timestamp: '2024-01-01T10:00:00Z'
  },
  {
    role: 'assistant',
    content: 'The capital of France is Paris.',
    timestamp: '2024-01-01T10:00:01Z'
  },
  {
    role: 'user',
    content: 'Tell me about its history.',
    timestamp: '2024-01-01T10:00:02Z'
  },
  {
    role: 'assistant',
    content: 'Paris has a rich history dating back over 2000 years...',
    timestamp: '2024-01-01T10:00:03Z'
  }
];

describe('Helper Middleware Adapters - Unit Tests', () => {
  describe('MessagesAPIHelperAdapter', () => {
    let adapter: MessagesAPIHelperAdapter;

    beforeEach(() => {
      adapter = new MessagesAPIHelperAdapter();
    });

    it('should have correct API pattern', () => {
      expect(adapter.apiPattern).toBe('messages');
      expect(adapter.name).toBe('MessagesAPIHelperAdapter');
    });

    it('should support Messages API models', () => {
      expect(adapter.supportsModel(mockClaudeHaikuConfig as ModelConfig)).toBe(true);
      expect(adapter.supportsModel(mockGPT35Config as ModelConfig)).toBe(false);
    });

    it('should estimate tokens correctly', () => {
      const text = 'Hello world, this is a test message.';
      const tokens = adapter.estimateTokens(text);
      // ~4 chars per token heuristic
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(text.length);
    });
  });

  describe('ChatCompletionsAPIHelperAdapter', () => {
    let adapter: ChatCompletionsAPIHelperAdapter;

    beforeEach(() => {
      adapter = new ChatCompletionsAPIHelperAdapter();
    });

    it('should have correct API pattern', () => {
      expect(adapter.apiPattern).toBe('chat/completions');
      expect(adapter.name).toBe('ChatCompletionsAPIHelperAdapter');
    });

    it('should support Chat Completions API models', () => {
      expect(adapter.supportsModel(mockGPT35Config as ModelConfig)).toBe(true);
      expect(adapter.supportsModel(mockClaudeHaikuConfig as ModelConfig)).toBe(false);
    });
  });

  describe('GoogleGenAPIHelperAdapter', () => {
    let adapter: GoogleGenAPIHelperAdapter;

    beforeEach(() => {
      adapter = new GoogleGenAPIHelperAdapter();
    });

    it('should have correct API pattern', () => {
      expect(adapter.apiPattern).toBe('google-genai');
      expect(adapter.name).toBe('GoogleGenAPIHelperAdapter');
    });

    it('should support Google GenAI models', () => {
      expect(adapter.supportsModel(mockGemma27BConfig as ModelConfig)).toBe(true);
      expect(adapter.supportsModel(mockGPT35Config as ModelConfig)).toBe(false);
    });

    it('should return zero cost for Gemma models', () => {
      // Access protected method via type assertion
      const cost = (adapter as any).calculateCost(1000, 500, mockGemma27BConfig);
      expect(cost).toBe(0);
    });
  });

  describe('GenerateContentAPIHelperAdapter', () => {
    let adapter: GenerateContentAPIHelperAdapter;

    beforeEach(() => {
      adapter = new GenerateContentAPIHelperAdapter();
    });

    it('should have correct API pattern', () => {
      expect(adapter.apiPattern).toBe('generateContent');
      expect(adapter.name).toBe('GenerateContentAPIHelperAdapter');
    });

    it('should support GenerateContent API models', () => {
      expect(adapter.supportsModel(mockGeminiFlashConfig as ModelConfig)).toBe(true);
      expect(adapter.supportsModel(mockGemma27BConfig as ModelConfig)).toBe(false);
    });

    it('should calculate cost for paid Gemini models', () => {
      const cost = (adapter as any).calculateCost(1000000, 500000, mockGeminiFlashConfig);
      expect(cost).toBeGreaterThan(0);
      // Flash pricing: ~$0.075/1M input, $0.30/1M output
      // 1M input + 0.5M output = $0.075 + $0.15 = $0.225
      expect(cost).toBeCloseTo(0.225, 3);
    });
  });

  describe('ResponsesAPIHelperAdapter', () => {
    let adapter: ResponsesAPIHelperAdapter;

    beforeEach(() => {
      adapter = new ResponsesAPIHelperAdapter();
    });

    it('should have correct API pattern', () => {
      expect(adapter.apiPattern).toBe('responses');
      expect(adapter.name).toBe('ResponsesAPIHelperAdapter');
    });

    it('should support Responses API models', () => {
      expect(adapter.supportsModel(mockGPT5CodexConfig as ModelConfig)).toBe(true);
      expect(adapter.supportsModel(mockGPT35Config as ModelConfig)).toBe(false);
    });

    it('should calculate cost for Codex models', () => {
      const cost = (adapter as any).calculateCost(1000000, 500000, mockGPT5CodexConfig);
      expect(cost).toBeGreaterThan(0);
      // Codex pricing: ~$2.50/1M input, $10/1M output
      // 1M input + 0.5M output = $2.50 + $5.00 = $7.50
      expect(cost).toBeCloseTo(7.50, 2);
    });
  });

  describe('HelperModelMiddlewareRegistry', () => {
    let registry: HelperModelMiddlewareRegistry;

    beforeEach(() => {
      registry = new HelperModelMiddlewareRegistry();
    });

    it('should register adapters', () => {
      const adapter = new MessagesAPIHelperAdapter();
      registry.register(adapter);

      expect(registry.hasAdapter('messages')).toBe(true);
      expect(registry.getAdapter('messages')).toBe(adapter);
    });

    it('should prevent duplicate registration without force flag', () => {
      const adapter1 = new MessagesAPIHelperAdapter();
      const adapter2 = new MessagesAPIHelperAdapter();

      registry.register(adapter1);
      registry.register(adapter2); // Should warn, not replace

      expect(registry.getAdapter('messages')).toBe(adapter1);
    });

    it('should allow forced override', () => {
      const adapter1 = new MessagesAPIHelperAdapter();
      const adapter2 = new MessagesAPIHelperAdapter();

      registry.register(adapter1);
      registry.register(adapter2, true); // Force replace

      expect(registry.getAdapter('messages')).toBe(adapter2);
    });

    it('should get adapter by model config', () => {
      const adapter = new MessagesAPIHelperAdapter();
      registry.register(adapter);

      const retrieved = registry.getAdapterForModel(mockClaudeHaikuConfig as ModelConfig);
      expect(retrieved).toBe(adapter);
    });

    it('should throw error for unknown pattern', () => {
      expect(() => {
        registry.getAdapter('unknown-pattern');
      }).toThrow(/No helper adapter found/);
    });

    it('should list registered patterns', () => {
      registry.register(new MessagesAPIHelperAdapter());
      registry.register(new ChatCompletionsAPIHelperAdapter());

      const patterns = registry.getRegisteredPatterns();
      expect(patterns).toContain('messages');
      expect(patterns).toContain('chat/completions');
      expect(patterns).toHaveLength(2);
    });

    it('should provide registry statistics', () => {
      registry.register(new MessagesAPIHelperAdapter());
      registry.register(new ChatCompletionsAPIHelperAdapter());
      registry.register(new GoogleGenAPIHelperAdapter());

      const stats = registry.getStats();
      expect(stats.totalAdapters).toBe(3);
      expect(stats.patterns).toHaveLength(3);
      expect(stats.adapterNames).toHaveLength(3);
    });

    it('should unregister adapters', () => {
      registry.register(new MessagesAPIHelperAdapter());
      expect(registry.hasAdapter('messages')).toBe(true);

      const removed = registry.unregister('messages');
      expect(removed).toBe(true);
      expect(registry.hasAdapter('messages')).toBe(false);
    });

    it('should clear all adapters', () => {
      registry.register(new MessagesAPIHelperAdapter());
      registry.register(new ChatCompletionsAPIHelperAdapter());

      registry.clear();
      expect(registry.getRegisteredPatterns()).toHaveLength(0);
    });
  });

  describe('Default Registration', () => {
    it('should register all 5 adapters', () => {
      const registry = new HelperModelMiddlewareRegistry();
      registerDefaultHelperAdapters(registry);

      const patterns = registry.getRegisteredPatterns();
      expect(patterns).toContain('messages');
      expect(patterns).toContain('chat/completions');
      expect(patterns).toContain('google-genai');
      expect(patterns).toContain('generateContent');
      expect(patterns).toContain('responses');
      expect(patterns).toHaveLength(5);
    });

    it('should make adapters accessible by pattern', () => {
      const registry = new HelperModelMiddlewareRegistry();
      registerDefaultHelperAdapters(registry);

      expect(registry.getAdapter('messages')).toBeInstanceOf(MessagesAPIHelperAdapter);
      expect(registry.getAdapter('chat/completions')).toBeInstanceOf(ChatCompletionsAPIHelperAdapter);
      expect(registry.getAdapter('google-genai')).toBeInstanceOf(GoogleGenAPIHelperAdapter);
      expect(registry.getAdapter('generateContent')).toBeInstanceOf(GenerateContentAPIHelperAdapter);
      expect(registry.getAdapter('responses')).toBeInstanceOf(ResponsesAPIHelperAdapter);
    });
  });

  describe('Base Helper Adapter Functionality', () => {
    let adapter: MessagesAPIHelperAdapter;

    beforeEach(() => {
      adapter = new MessagesAPIHelperAdapter();
    });

    it('should extract text content from messages', () => {
      const extracted = (adapter as any).extractTextContent(sampleMessages);
      expect(extracted).toContain('capital of France');
      expect(extracted).toContain('Paris');
      expect(extracted).toContain('history');
    });

    it('should create compaction prompt', () => {
      const prompt = (adapter as any).createCompactionPrompt(sampleMessages, 200);
      expect(prompt).toContain('Summarize');
      expect(prompt).toContain('~200 tokens');
      expect(prompt).toContain('CONVERSATION HISTORY');
      expect(prompt).toContain('PRIMARY REQUEST');
      expect(prompt).toContain('PENDING WORK');
    });

    it('should create tool summary prompt', () => {
      const toolResult = 'File content: This is a long file with lots of data...';
      const prompt = (adapter as any).createToolSummaryPrompt(toolResult, 100);
      expect(prompt).toContain('summarize');
      expect(prompt).toContain('100 tokens');
      expect(prompt).toContain('TOOL RESULT');
    });

    it('should calculate cost for helper models', () => {
      const cost = (adapter as any).calculateCost(1000000, 500000, mockClaudeHaikuConfig);
      expect(cost).toBeGreaterThan(0);
      // Default rates: $0.50/1M input, $1.50/1M output
      // 1M input + 0.5M output = $0.50 + $0.75 = $1.25
      expect(cost).toBeCloseTo(1.25, 2);
    });
  });
});
