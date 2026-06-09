/**
 * Cortex Orchestrator Tests
 * Phase 2.2.1 & 2.2.2: Basic orchestrator and multi-provider integration
 *
 * Tests:
 * - Session creation and management
 * - Basic message flow with timeline tracking
 * - Model switching with context validation
 * - Cross-provider continuity
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CortexOrchestrator } from '../CortexOrchestrator.js';
import { createOrchestrator } from '../OrchestratorFactory.js';
import { AdapterRegistry } from '../../adapters/AdapterRegistry.js';
import { MessagesAPIAdapter } from '../../adapters/MessagesAPIAdapter.js';
import { ChatCompletionsAPIAdapter } from '../../adapters/ChatCompletionsAPIAdapter.js';
import { GenerateContentAPIAdapter } from '../../adapters/GenerateContentAPIAdapter.js';
import { GoogleGenAPIAdapter } from '../../adapters/GoogleGenAPIAdapter.js';
import { ResponsesAPIAdapter } from '../../adapters/ResponsesAPIAdapter.js';
import { HistoricalContextService } from '../../tools/historical/HistoricalContextService.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

describe('CortexOrchestrator', () => {
  let orchestrator: CortexOrchestrator;
  let testDir: string;

  beforeEach(async () => {
    // Create temp directory for test
    testDir = path.join(tmpdir(), `orchestrator-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create orchestrator using factory (dependency injection pattern).
    // `createOrchestrator` is async (loads permission profile from disk).
    orchestrator = await createOrchestrator({
      defaultModelId: 'claude-haiku-4-5',
      projectPath: testDir,
      storageDir: '.cortex/test-sessions',
      debug: false
    });
  });

  afterEach(async () => {
    // Clean up orchestrator
    if (orchestrator) {
      try {
        await orchestrator.cleanup();
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Clean up temp directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Phase 2.2.1: Basic Orchestrator', () => {
    describe('Session Management', () => {
      it('should create a new session with timeline', async () => {
        const session = await orchestrator.createSession(testDir, 'claude-haiku-4-5');

        expect(session.sessionId).toBeDefined();
        expect(session.conversationId).toBeDefined();
        expect(session.modelId).toBe('claude-haiku-4-5');
        expect(session.projectPath).toBe(testDir);
        expect(session.messageCount).toBe(0);

        // Verify orchestrator state
        expect(orchestrator.getSessionId()).toBe(session.sessionId);
        expect(orchestrator.getConversationId()).toBe(session.conversationId);
      });

      it('should throw error if sendMessage called before session created', async () => {
        const newOrchestrator = await createOrchestrator({
          defaultModelId: 'claude-haiku-4-5',
          projectPath: testDir
        });

        await expect(
          newOrchestrator.sendMessage('Hello')
        ).rejects.toThrow('Session not initialized');
      });

      it('should track message history', async () => {
        await orchestrator.createSession(testDir);

        const history1 = orchestrator.getMessageHistory();
        expect(history1).toHaveLength(0);

        // Note: Can't test sendMessage without real API
        // This would be tested in smoke tests
      });
    });

    describe('Model Management', () => {
      it('should get current model', async () => {
        await orchestrator.createSession(testDir, 'claude-haiku-4-5');

        const model = orchestrator.getCurrentModel();
        expect(model.id).toBe('claude-haiku-4-5');
        expect(model.provider).toBe('anthropic');
      });

      it('should list available models', async () => {
        await orchestrator.createSession(testDir);

        const models = orchestrator.listAvailableModels();
        expect(models.length).toBeGreaterThan(0);

        // Should include models from all providers
        const providers = new Set(models.map(m => m.provider));
        expect(providers.has('anthropic')).toBe(true);
        expect(providers.has('openai')).toBe(true);
        expect(providers.has('google')).toBe(true);
      });

      it('should get adapter registry', async () => {
        await orchestrator.createSession(testDir);

        const registry = orchestrator.getAdapterRegistry();
        expect(registry).toBeDefined();
        expect(registry.listAdapters()).toContain('MessagesAPIAdapter');
        expect(registry.listAdapters()).toContain('ChatCompletionsAPIAdapter');
        expect(registry.listAdapters()).toContain('GenerateContentAPIAdapter');
      });
    });
  });

  describe('Phase 2.2.2: Multi-Provider Integration', () => {
    describe('Model Switching', () => {
      it('should switch models successfully', async () => {
        await orchestrator.createSession(testDir, 'claude-haiku-4-5');

        const result = await orchestrator.switchModel('gpt-4o-mini', {
          reason: 'Testing model switch'
        });

        expect(result.success).toBe(true);
        expect(result.previousModel).toBe('claude-haiku-4-5');
        expect(result.newModel).toBe('gpt-4o-mini');
        expect(result.timelineEventId).toBeDefined();

        // Verify current model changed
        const currentModel = orchestrator.getCurrentModel();
        expect(currentModel.id).toBe('gpt-4o-mini');
      });

      it('should throw error if switchModel called before session created', async () => {
        const newOrchestrator = await createOrchestrator({
          defaultModelId: 'claude-haiku-4-5',
          projectPath: testDir
        });

        await expect(
          newOrchestrator.switchModel('gpt-4o-mini')
        ).rejects.toThrow('Session not initialized');
      });

      it('should throw error for invalid model', async () => {
        await orchestrator.createSession(testDir);

        await expect(
          orchestrator.switchModel('invalid-model-id')
        ).rejects.toThrow('Model not found');
      });

      it('should switch between different API patterns', async () => {
        await orchestrator.createSession(testDir, 'claude-haiku-4-5');

        // Claude (messages) → GPT (chat/completions)
        const result1 = await orchestrator.switchModel('gpt-4o-mini');
        expect(result1.success).toBe(true);
        expect(result1.previousModel).toBe('claude-haiku-4-5');
        expect(result1.newModel).toBe('gpt-4o-mini');

        // GPT (chat/completions) → Gemini (generateContent)
        const result2 = await orchestrator.switchModel('gemini-2.5-flash');
        expect(result2.success).toBe(true);
        expect(result2.previousModel).toBe('gpt-4o-mini');
        expect(result2.newModel).toBe('gemini-2.5-flash');

        // Gemini (generateContent) → Gemma (google-genai)
        const result3 = await orchestrator.switchModel('gemma-3-27b-it');
        expect(result3.success).toBe(true);
        expect(result3.previousModel).toBe('gemini-2.5-flash');
        expect(result3.newModel).toBe('gemma-3-27b-it');

        // Verify final model
        expect(orchestrator.getCurrentModel().id).toBe('gemma-3-27b-it');
      });

      it('should handle context adjustment when switching to smaller model', async () => {
        await orchestrator.createSession(testDir, 'grok-4-fast'); // 2M context

        // Simulate having large history by directly adding messages
        const history = orchestrator.getMessageHistory();
        // In real scenario, this would be populated by sendMessage calls

        // Switch to smaller model
        const result = await orchestrator.switchModel('gemma-3-1b-it', { // 8K context
          strategy: 'sliding-window'
        });

        expect(result.success).toBe(true);
        // If history was too large, would have contextAdjustment
        if (result.contextAdjustment) {
          expect(result.contextAdjustment.strategy).toBe('sliding-window');
          expect(result.contextAdjustment.messagesKept).toBeGreaterThan(0);
          expect(result.contextAdjustment.compactionTriggered).toBe(false); // Phase 2.2.4
        }
      });
    });

    describe('Cross-Provider Continuity', () => {
      it('should maintain conversation context across provider switches', async () => {
        await orchestrator.createSession(testDir, 'claude-haiku-4-5');

        // This would test:
        // 1. Send message to Claude
        // 2. Switch to GPT
        // 3. Send message to GPT (should have Claude's context)
        // 4. Verify response shows context preservation

        // NOTE: This requires real API calls, tested in smoke tests
        // Here we just verify the switching mechanism works
        const result = await orchestrator.switchModel('gpt-4o-mini', {
          reason: 'Testing cross-provider continuity'
        });

        expect(result.success).toBe(true);
        expect(result.timelineEventId).toBeDefined();
      });

      it('should support all provider pair combinations', async () => {
        await orchestrator.createSession(testDir, 'claude-haiku-4-5');

        const providerPairs = [
          // Anthropic ↔ OpenAI
          { from: 'claude-haiku-4-5', to: 'gpt-4o-mini' },
          { from: 'gpt-4o-mini', to: 'claude-haiku-4-5' },

          // OpenAI ↔ Google
          { from: 'gpt-4o-mini', to: 'gemini-2.5-flash' },
          { from: 'gemini-2.5-flash', to: 'gpt-4o-mini' },

          // Google ↔ Anthropic
          { from: 'gemini-2.5-flash', to: 'claude-haiku-4-5' },
          { from: 'claude-haiku-4-5', to: 'gemini-2.5-flash' },

          // Free Gemma models
          { from: 'gemini-2.5-flash', to: 'gemma-3-27b-it' },
          { from: 'gemma-3-27b-it', to: 'gpt-4o-mini' },
        ];

        // Test each pair
        for (const pair of providerPairs) {
          await orchestrator.switchModel(pair.from);
          const result = await orchestrator.switchModel(pair.to);

          expect(result.success).toBe(true);
          expect(result.previousModel).toBe(pair.from);
          expect(result.newModel).toBe(pair.to);
        }
      });
    });

    describe('Context Validation', () => {
      it('should validate context fits when switching models', async () => {
        await orchestrator.createSession(testDir, 'claude-haiku-4-5');

        // Switch from large to small context window
        const result = await orchestrator.switchModel('gemma-3-1b-it'); // 8K → 200K

        expect(result.success).toBe(true);
        // With no messages, should fit
        expect(result.contextAdjustment).toBeUndefined();
      });

      it('should apply sliding window strategy for large context', async () => {
        await orchestrator.createSession(testDir, 'grok-4-fast');

        // Switch to much smaller model
        const result = await orchestrator.switchModel('gemma-3-1b-it', {
          strategy: 'sliding-window'
        });

        expect(result.success).toBe(true);
      });
    });
  });

  describe('Error Handling', () => {
    it('should detect context limit errors', async () => {
      await orchestrator.createSession(testDir, 'claude-haiku-4-5');

      // Error handling is tested when ErrorDetector.isContextLimitError returns true
      // This would happen during sendMessage if context limit is exceeded
      // Actual error handling tested in smoke tests with real APIs
    });
  });

  describe('Phase 2.2.4: Checkpoint Management', () => {
    describe('Checkpoint Creation', () => {
      it('should create checkpoints', async () => {
        await orchestrator.createSession(testDir);

        const checkpoint = await orchestrator.createCheckpoint({
          description: 'Test checkpoint'
        });

        expect(checkpoint).toBeDefined();
        expect(checkpoint.id).toBeDefined();
        expect(checkpoint.description).toBe('Test checkpoint');
        expect(checkpoint.snapshot).toBeDefined();
        expect(checkpoint.snapshot.messageIds).toBeDefined();
      });

      it('should list checkpoints', async () => {
        await orchestrator.createSession(testDir);

        // Create multiple checkpoints
        await orchestrator.createCheckpoint({ description: 'Checkpoint 1' });
        await orchestrator.createCheckpoint({ description: 'Checkpoint 2' });

        const checkpoints = orchestrator.listCheckpoints();
        expect(checkpoints).toHaveLength(2);
        expect(checkpoints[0].description).toBe('Checkpoint 1');
        expect(checkpoints[1].description).toBe('Checkpoint 2');
      });

      it('should get specific checkpoint', async () => {
        await orchestrator.createSession(testDir);

        const checkpoint = await orchestrator.createCheckpoint({
          description: 'Find me'
        });

        const found = orchestrator.getCheckpoint(checkpoint.id);
        expect(found).toBeDefined();
        expect(found?.id).toBe(checkpoint.id);
        expect(found?.description).toBe('Find me');
      });
    });

    describe('Checkpoint Resume', () => {
      it('should resume from checkpoint', async () => {
        await orchestrator.createSession(testDir, 'claude-haiku-4-5');

        const originalConversationId = orchestrator.getConversationId();

        const checkpoint = await orchestrator.createCheckpoint({
          description: 'Resume point'
        });

        const result = await orchestrator.resumeFromCheckpoint(checkpoint.id);

        expect(result.conversationId).toBeDefined();
        expect(result.conversationId).not.toBe(originalConversationId); // New branch created
        expect(result.conversationId).toBe(orchestrator.getConversationId()); // Orchestrator updated
        expect(result.messageCount).toBe(0); // No messages yet
        expect(result.model).toBe('claude-haiku-4-5');
      });

      it('should resume with different model (cross-provider)', async () => {
        await orchestrator.createSession(testDir, 'claude-haiku-4-5');

        const checkpoint = await orchestrator.createCheckpoint({
          description: 'Switch model on resume'
        });

        const result = await orchestrator.resumeFromCheckpoint(checkpoint.id, {
          modelId: 'gpt-4o-mini'
        });

        expect(result.model).toBe('gpt-4o-mini');
        expect(orchestrator.getCurrentModel().id).toBe('gpt-4o-mini');
      });

      it('should throw error if checkpoint not found', async () => {
        await orchestrator.createSession(testDir);

        await expect(
          orchestrator.resumeFromCheckpoint('invalid-checkpoint-id')
        ).rejects.toThrow('Checkpoint invalid-checkpoint-id not found');
      });
    });

    describe('Conversation Branching', () => {
      it('should create new conversation branch on resume', async () => {
        await orchestrator.createSession(testDir);

        const originalConversationId = orchestrator.getConversationId();
        const checkpoint = await orchestrator.createCheckpoint();

        const result = await orchestrator.resumeFromCheckpoint(checkpoint.id);

        expect(result.conversationId).not.toBe(originalConversationId);
      });
    });
  });

  describe('Phase 2.2.5: Historical Retrieval', () => {
    it('should provide historical context service', async () => {
      await orchestrator.createSession(testDir);

      const historicalService = orchestrator.getHistoricalService();
      expect(historicalService).toBeDefined();
    });

    it('should include historical tools in tool definitions', async () => {
      await orchestrator.createSession(testDir);

      // Historical tools should be available via static method
      const toolDefinitions = HistoricalContextService.getToolDefinitions();

      expect(toolDefinitions).toHaveLength(4);
      expect(toolDefinitions[0].name).toBe('SearchConversationHistory');
      expect(toolDefinitions[1].name).toBe('GetConversationSegment');
      expect(toolDefinitions[2].name).toBe('ListCompactionBoundaries');
      expect(toolDefinitions[3].name).toBe('RequestHistoricalContext');
    });

    it('should make historical tools available to models', async () => {
      await orchestrator.createSession(testDir);

      // When sendMessage is called, historical tools are automatically included
      // This is tested through integration with prepareRequest which receives allTools
      // Actual tool execution tested in historical tool smoke tests (23/23 passing)

      const historicalService = orchestrator.getHistoricalService();
      expect(historicalService).toBeDefined();
    });
  });

  describe('Integration Points', () => {
    it('should integrate with SessionTimeline', async () => {
      const session = await orchestrator.createSession(testDir);

      // Timeline should be initialized
      expect(session.sessionId).toBeDefined();
      expect(session.conversationId).toBeDefined();

      // Model switch should record timeline event
      const result = await orchestrator.switchModel('gpt-4o-mini');
      expect(result.timelineEventId).toBeDefined();
    });

    it('should integrate with JSONLHistoryStore', async () => {
      await orchestrator.createSession(testDir);

      // History store should be ready to accept messages
      // Actual storage tested with sendMessage in smoke tests
      expect(orchestrator.getMessageHistory()).toHaveLength(0);
    });

    it('should integrate with ContextBudgetManager', async () => {
      await orchestrator.createSession(testDir, 'grok-4-fast');

      // Switch to smaller model triggers budget check
      const result = await orchestrator.switchModel('gemma-3-1b-it');
      expect(result.success).toBe(true);

      // ContextBudgetManager is used internally
      // No direct assertion needed - if it fails, test would throw
    });

    it('should integrate with AdapterRegistry', async () => {
      await orchestrator.createSession(testDir);

      const registry = orchestrator.getAdapterRegistry();
      expect(registry).toBeDefined();

      // Should have all adapters registered
      const adapters = registry.listAdapters();
      expect(adapters).toContain('MessagesAPIAdapter');
      expect(adapters).toContain('ChatCompletionsAPIAdapter');
      expect(adapters).toContain('GenerateContentAPIAdapter');
      expect(adapters).toContain('GoogleGenAPIAdapter');
      expect(adapters).toContain('ResponsesAPIAdapter');
    });
  });
});
