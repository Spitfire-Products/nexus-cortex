/**
 * Orchestrator Real API Integration Smoke Tests
 *
 * Phase 2.1: Real API Integration Validation
 *
 * These tests make REAL API calls to validate the orchestrator works
 * with actual provider APIs (Anthropic, OpenAI, Google).
 *
 * Run with: ENABLE_SMOKE_TESTS=true npm test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { CortexOrchestrator } from '../../CortexOrchestrator.js';
import { createOrchestrator } from '../../OrchestratorFactory.js';

// Only run if smoke tests are enabled
const SMOKE_ENABLED = process.env.ENABLE_SMOKE_TESTS === 'true';
const describeSmoke = SMOKE_ENABLED ? describe : describe.skip;

describeSmoke('Orchestrator Real API Integration (Smoke Tests)', () => {
  let orchestrator: CortexOrchestrator;

  beforeAll(async () => {
    // Initialize orchestrator with factory (includes all dependencies)
    orchestrator = await createOrchestrator({
      defaultModelId: 'claude-3-haiku-20240307',
      projectPath: '/tmp/tests/orchestrator-smoke',
      storageDir: '/tmp/tests/.cortex/orchestrator-smoke',
      debug: true
    });

    // Create test session
    await orchestrator.createSession('/tmp/tests/orchestrator-smoke');
  });

  describe('Claude (Anthropic)', () => {
    it('should send a simple message to Claude and get a response', async () => {
      const response = await orchestrator.sendMessage('Say hello in one word');

      expect(response).toBeDefined();
      expect(response.messageId).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.model.id).toBe('claude-3-haiku-20240307');
      expect(response.model.provider).toBe('anthropic');
      expect(response.usage.totalTokens).toBeGreaterThan(0);

      console.log('[Smoke Test - Claude] Response:', response.content);
    }, 30000); // 30 second timeout

    it('should maintain conversation context', async () => {
      // First message
      const response1 = await orchestrator.sendMessage('My favorite color is blue.');
      expect(response1).toBeDefined();

      // Follow-up that requires context
      const response2 = await orchestrator.sendMessage('What is my favorite color?');
      expect(response2).toBeDefined();
      expect(response2.content).toBeDefined();

      console.log('[Smoke Test - Claude Context] Response:', response2.content);
    }, 30000);
  });

  describe('GPT-4 (OpenAI)', () => {
    it('should send a simple message to GPT-4o Mini and get a response', async () => {
      const response = await orchestrator.sendMessage(
        'Say hello in one word',
        { modelId: 'gpt-4o-mini' }
      );

      expect(response).toBeDefined();
      expect(response.messageId).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.model.id).toBe('gpt-4o-mini');
      expect(response.model.provider).toBe('openai');
      expect(response.usage.totalTokens).toBeGreaterThan(0);

      console.log('[Smoke Test - GPT-4o Mini] Response:', response.content);
    }, 30000);
  });

  describe('Gemini (Google)', () => {
    it('should send a simple message to Gemini 2.0 Flash and get a response', async () => {
      const response = await orchestrator.sendMessage(
        'Say hello in one word',
        { modelId: 'gemini-2.0-flash' }
      );

      expect(response).toBeDefined();
      expect(response.messageId).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.model.id).toBe('gemini-2.0-flash');
      expect(response.model.provider).toBe('google');

      console.log('[Smoke Test - Gemini 2.0 Flash] Response:', response.content);
      console.log('[Smoke Test - Gemini 2.0 Flash] Usage:', response.usage);

      // FIXED: Gemini usage metadata now extracted correctly
      // Based on gemini-cli implementation and official docs
      expect(response.usage.totalTokens).toBeGreaterThan(0);
    }, 30000);
  });

  describe('XAI (Grok)', () => {
    it('should send a simple message to Grok 4 and get a response', async () => {
      const response = await orchestrator.sendMessage(
        'Say hello in one word',
        { modelId: 'grok-4-0709' }
      );

      expect(response).toBeDefined();
      expect(response.messageId).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.model.id).toBe('grok-4-0709');
      expect(response.model.provider).toBe('xai');
      expect(response.usage.totalTokens).toBeGreaterThan(0);

      console.log('[Smoke Test - Grok 4] Response:', response.content);
    }, 30000);

    it('should send a simple message to Grok Code Fast and get a response', async () => {
      const response = await orchestrator.sendMessage(
        'Say hello in one word',
        { modelId: 'grok-code-fast-1' }
      );

      expect(response).toBeDefined();
      expect(response.messageId).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.model.id).toBe('grok-code-fast-1');
      expect(response.model.provider).toBe('xai');
      expect(response.usage.totalTokens).toBeGreaterThan(0);

      console.log('[Smoke Test - Grok Code Fast] Response:', response.content);
    }, 30000);
  });

  describe('DeepSeek', () => {
    it('should send a simple message to DeepSeek Chat and get a response', async () => {
      const response = await orchestrator.sendMessage(
        'Say hello in one word',
        { modelId: 'deepseek-v4-flash' }
      );

      expect(response).toBeDefined();
      expect(response.messageId).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.model.id).toBe('deepseek-v4-flash');
      expect(response.model.provider).toBe('deepseek');
      expect(response.usage.totalTokens).toBeGreaterThan(0);

      console.log('[Smoke Test - DeepSeek Chat] Response:', response.content);
    }, 30000);
  });

  describe('Session Management', () => {
    it('should create a new session', async () => {
      const session = await orchestrator.createSession('/tmp/tests/new-session');

      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();
      expect(session.conversationId).toBeDefined();
      expect(session.projectPath).toBe('/tmp/tests/new-session');
    });

    it('should track message history', async () => {
      await orchestrator.sendMessage('Test message 1');
      await orchestrator.sendMessage('Test message 2');

      const history = orchestrator.getMessageHistory();
      expect(history.length).toBeGreaterThanOrEqual(4); // 2 user + 2 assistant messages
    }, 30000);

    it('should get current session and conversation IDs', () => {
      const sessionId = orchestrator.getSessionId();
      const conversationId = orchestrator.getConversationId();

      expect(sessionId).toBeDefined();
      expect(sessionId).not.toBe('');
      expect(conversationId).toBeDefined();
      expect(conversationId).not.toBe('');
    });
  });

  describe('Model Registry', () => {
    it('should list available models', () => {
      const models = orchestrator.listAvailableModels();

      expect(models).toBeDefined();
      expect(models.length).toBeGreaterThan(0);
    });

    it('should get current model', () => {
      const model = orchestrator.getCurrentModel();

      expect(model).toBeDefined();
      expect(model.id).toBeDefined();
      expect(model.provider).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should throw error for invalid model ID', async () => {
      await expect(
        orchestrator.sendMessage('Test', { modelId: 'invalid-model' })
      ).rejects.toThrow('Model not found');
    });
  });
});
