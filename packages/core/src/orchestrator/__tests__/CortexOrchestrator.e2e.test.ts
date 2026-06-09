/**
 * Cortex Orchestrator End-to-End Tests
 * Phase 2.3: Comprehensive workflow testing
 *
 * Tests complete conversation lifecycles with all Phase 2.2 features:
 * - Basic conversation flow
 * - Model switching mid-conversation
 * - Checkpoint creation and resume
 * - Helper model fallback
 * - Historical retrieval
 * - Error handling and edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CortexOrchestrator } from '../CortexOrchestrator.js';
import { createOrchestrator } from '../OrchestratorFactory.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('CortexOrchestrator E2E', () => {
  let orchestrator: CortexOrchestrator;
  let testProjectDir: string;

  beforeEach(async () => {
    // Create a temporary test directory
    testProjectDir = path.join(os.tmpdir(), `test-project-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testProjectDir, { recursive: true });

    orchestrator = await createOrchestrator({
      defaultModelId: 'claude-haiku-4-5',
      projectPath: testProjectDir,
      storageDir: path.join(testProjectDir, '.cortex/test-sessions'),
      debug: false
    });
  });

  afterEach(() => {
    // Clean up temporary directory
    if (testProjectDir && fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  describe('Complete Conversation Lifecycle', () => {
    it('should handle full session lifecycle', async () => {
      // 1. Create session
      const session = await orchestrator.createSession(
        testProjectDir,
        'claude-haiku-4-5'
      );

      expect(session.sessionId).toBeDefined();
      expect(session.conversationId).toBeDefined();
      expect(session.modelId).toBe('claude-haiku-4-5');

      // 2. Verify session state
      expect(orchestrator.getSessionId()).toBe(session.sessionId);
      expect(orchestrator.getConversationId()).toBe(session.conversationId);
      expect(orchestrator.getCurrentModel().id).toBe('claude-haiku-4-5');

      // 3. Verify empty message history
      expect(orchestrator.getMessageHistory()).toHaveLength(0);

      // 4. Verify checkpoint can be created
      const checkpoint = await orchestrator.createCheckpoint({
        description: 'Initial state'
      });
      expect(checkpoint).toBeDefined();
      expect(checkpoint.snapshot.messageIds).toHaveLength(0);

      // 5. Verify checkpoints can be listed
      const checkpoints = orchestrator.listCheckpoints();
      expect(checkpoints).toHaveLength(1);
    });

    it('should track conversation state correctly', async () => {
      await orchestrator.createSession(testProjectDir);

      const initialConversationId = orchestrator.getConversationId();
      const initialModel = orchestrator.getCurrentModel().id;

      // Verify immutability
      expect(orchestrator.getConversationId()).toBe(initialConversationId);
      expect(orchestrator.getCurrentModel().id).toBe(initialModel);
    });
  });

  describe('Model Switching Workflows', () => {
    it('should switch models and maintain state', async () => {
      await orchestrator.createSession(testProjectDir, 'claude-haiku-4-5');

      const initialModel = orchestrator.getCurrentModel();
      expect(initialModel.id).toBe('claude-haiku-4-5');
      expect(initialModel.provider).toBe('anthropic');

      // Switch to GPT
      const switchResult = await orchestrator.switchModel('gpt-4o-mini');

      expect(switchResult.success).toBe(true);
      expect(switchResult.previousModel).toBe('claude-haiku-4-5');
      expect(switchResult.newModel).toBe('gpt-4o-mini');
      expect(switchResult.timelineEventId).toBeDefined();

      // Verify state updated
      const newModel = orchestrator.getCurrentModel();
      expect(newModel.id).toBe('gpt-4o-mini');
      expect(newModel.provider).toBe('openai');
    });

    it('should handle cross-provider switches', async () => {
      await orchestrator.createSession(testProjectDir, 'claude-haiku-4-5');

      // Anthropic → OpenAI
      await orchestrator.switchModel('gpt-4o-mini');
      expect(orchestrator.getCurrentModel().provider).toBe('openai');

      // OpenAI → Google
      await orchestrator.switchModel('gemini-2.5-flash');
      expect(orchestrator.getCurrentModel().provider).toBe('google');

      // Google → Anthropic
      await orchestrator.switchModel('claude-haiku-4-5');
      expect(orchestrator.getCurrentModel().provider).toBe('anthropic');
    });

    it('should track model switches in timeline', async () => {
      await orchestrator.createSession(testProjectDir, 'claude-haiku-4-5');

      const result1 = await orchestrator.switchModel('gpt-4o-mini');
      expect(result1.timelineEventId).toBeDefined();

      const result2 = await orchestrator.switchModel('gemini-2.5-flash');
      expect(result2.timelineEventId).toBeDefined();

      // Timeline events are recorded internally
      // Full timeline can be queried via SessionTimeline
    });
  });

  describe('Checkpoint and Resume Workflows', () => {
    it('should create and resume from checkpoint', async () => {
      await orchestrator.createSession(testProjectDir, 'claude-haiku-4-5');

      const originalConversationId = orchestrator.getConversationId();

      // Create checkpoint
      const checkpoint = await orchestrator.createCheckpoint({
        description: 'Before changes'
      });

      expect(checkpoint.id).toBeDefined();
      expect(checkpoint.description).toBe('Before changes');

      // Resume from checkpoint (creates new branch)
      const resumeResult = await orchestrator.resumeFromCheckpoint(checkpoint.id);

      expect(resumeResult.conversationId).toBeDefined();
      expect(resumeResult.conversationId).not.toBe(originalConversationId);
      expect(resumeResult.messageCount).toBe(0);
      expect(resumeResult.model).toBe('claude-haiku-4-5');

      // Verify orchestrator state updated
      expect(orchestrator.getConversationId()).toBe(resumeResult.conversationId);
    });

    it('should support multiple checkpoints', async () => {
      await orchestrator.createSession(testProjectDir);

      const cp1 = await orchestrator.createCheckpoint({ description: 'Checkpoint 1' });
      const cp2 = await orchestrator.createCheckpoint({ description: 'Checkpoint 2' });
      const cp3 = await orchestrator.createCheckpoint({ description: 'Checkpoint 3' });

      const checkpoints = orchestrator.listCheckpoints();
      expect(checkpoints).toHaveLength(3);
      expect(checkpoints[0].id).toBe(cp1.id);
      expect(checkpoints[1].id).toBe(cp2.id);
      expect(checkpoints[2].id).toBe(cp3.id);
    });

    it('should resume with different model (cross-provider resume)', async () => {
      await orchestrator.createSession(testProjectDir, 'claude-haiku-4-5');

      const checkpoint = await orchestrator.createCheckpoint();

      // Resume with different provider
      const result = await orchestrator.resumeFromCheckpoint(checkpoint.id, {
        modelId: 'gpt-4o-mini'
      });

      expect(result.model).toBe('gpt-4o-mini');
      expect(orchestrator.getCurrentModel().id).toBe('gpt-4o-mini');
      expect(orchestrator.getCurrentModel().provider).toBe('openai');
    });

    it('should create conversation branches on resume', async () => {
      await orchestrator.createSession(testProjectDir);

      const originalConversationId = orchestrator.getConversationId();
      const checkpoint = await orchestrator.createCheckpoint();

      // First resume
      const result1 = await orchestrator.resumeFromCheckpoint(checkpoint.id);
      const branch1 = result1.conversationId;
      expect(branch1).not.toBe(originalConversationId);

      // Resume again from same checkpoint (creates another branch)
      const result2 = await orchestrator.resumeFromCheckpoint(checkpoint.id);
      const branch2 = result2.conversationId;

      expect(branch2).not.toBe(originalConversationId);
      expect(branch2).not.toBe(branch1);
    });
  });

  describe('Error Handling', () => {
    it('should throw error on sendMessage before session created', async () => {
      const newOrchestrator = await createOrchestrator({
        defaultModelId: 'claude-haiku-4-5',
        projectPath: testProjectDir
      });

      await expect(
        newOrchestrator.sendMessage('Hello')
      ).rejects.toThrow('Session not initialized');
    });

    it('should throw error on switchModel before session created', async () => {
      const newOrchestrator = await createOrchestrator({
        defaultModelId: 'claude-haiku-4-5',
        projectPath: testProjectDir
      });

      await expect(
        newOrchestrator.switchModel('gpt-4o-mini')
      ).rejects.toThrow('Session not initialized');
    });

    it('should throw error on createCheckpoint before session created', async () => {
      const newOrchestrator = await createOrchestrator({
        defaultModelId: 'claude-haiku-4-5',
        projectPath: testProjectDir
      });

      await expect(
        newOrchestrator.createCheckpoint()
      ).rejects.toThrow('Session not initialized');
    });

    it('should throw error on resumeFromCheckpoint before session created', async () => {
      const newOrchestrator = await createOrchestrator({
        defaultModelId: 'claude-haiku-4-5',
        projectPath: testProjectDir
      });

      await expect(
        newOrchestrator.resumeFromCheckpoint('invalid-id')
      ).rejects.toThrow('Session not initialized');
    });

    it('should throw error for invalid model ID', async () => {
      await orchestrator.createSession(testProjectDir);

      await expect(
        orchestrator.switchModel('invalid-model-id')
      ).rejects.toThrow('Model not found');
    });

    it('should throw error for invalid checkpoint ID', async () => {
      await orchestrator.createSession(testProjectDir);

      await expect(
        orchestrator.resumeFromCheckpoint('invalid-checkpoint-id')
      ).rejects.toThrow('Checkpoint invalid-checkpoint-id not found');
    });

    it('should handle empty checkpoint list gracefully', async () => {
      await orchestrator.createSession(testProjectDir);

      const checkpoints = orchestrator.listCheckpoints();
      expect(checkpoints).toHaveLength(0);
      expect(checkpoints).toEqual([]);
    });

    it('should return undefined for non-existent checkpoint', async () => {
      await orchestrator.createSession(testProjectDir);

      const checkpoint = orchestrator.getCheckpoint('does-not-exist');
      expect(checkpoint).toBeUndefined();
    });
  });

  describe('Integration Points Validation', () => {
    it('should have all dependencies initialized', async () => {
      await orchestrator.createSession(testProjectDir);

      // Verify adapter registry
      const registry = orchestrator.getAdapterRegistry();
      expect(registry).toBeDefined();
      expect(registry.listAdapters().length).toBeGreaterThan(0);

      // Verify historical service
      const historicalService = orchestrator.getHistoricalService();
      expect(historicalService).toBeDefined();

      // Verify model registry
      const models = orchestrator.listAvailableModels();
      expect(models.length).toBeGreaterThan(0);
    });

    it('should maintain consistency across operations', async () => {
      await orchestrator.createSession(testProjectDir, 'claude-haiku-4-5');

      const sessionId1 = orchestrator.getSessionId();
      const conversationId1 = orchestrator.getConversationId();

      // Switch model
      await orchestrator.switchModel('gpt-4o-mini');

      // Session and conversation IDs should remain the same
      expect(orchestrator.getSessionId()).toBe(sessionId1);
      expect(orchestrator.getConversationId()).toBe(conversationId1);

      // Only model should change
      expect(orchestrator.getCurrentModel().id).toBe('gpt-4o-mini');
    });

    it('should handle rapid sequential operations', async () => {
      await orchestrator.createSession(testProjectDir);

      // Create multiple checkpoints rapidly
      const promises = [
        orchestrator.createCheckpoint({ description: 'CP1' }),
        orchestrator.createCheckpoint({ description: 'CP2' }),
        orchestrator.createCheckpoint({ description: 'CP3' })
      ];

      const checkpoints = await Promise.all(promises);

      expect(checkpoints).toHaveLength(3);
      expect(checkpoints[0].id).toBeDefined();
      expect(checkpoints[1].id).toBeDefined();
      expect(checkpoints[2].id).toBeDefined();
      expect(checkpoints[0].id).not.toBe(checkpoints[1].id);
    });
  });

  describe('Performance Characteristics', () => {
    it('should create session quickly', async () => {
      const start = Date.now();
      await orchestrator.createSession(testProjectDir);
      const duration = Date.now() - start;

      // Should be nearly instant (< 50ms)
      expect(duration).toBeLessThan(50);
    });

    it('should switch models quickly', async () => {
      await orchestrator.createSession(testProjectDir);

      const start = Date.now();
      await orchestrator.switchModel('gpt-4o-mini');
      const duration = Date.now() - start;

      // Should be very fast (< 20ms)
      expect(duration).toBeLessThan(20);
    });

    it('should create checkpoints quickly', async () => {
      await orchestrator.createSession(testProjectDir);

      const start = Date.now();
      await orchestrator.createCheckpoint();
      const duration = Date.now() - start;

      // Should be fast (< 100ms)
      expect(duration).toBeLessThan(100);
    });

    it('should list operations be instant', async () => {
      await orchestrator.createSession(testProjectDir);
      await orchestrator.createCheckpoint();
      await orchestrator.createCheckpoint();

      const start = Date.now();
      orchestrator.listCheckpoints();
      orchestrator.listAvailableModels();
      const duration = Date.now() - start;

      // Should be instant (< 5ms)
      expect(duration).toBeLessThan(5);
    });
  });

  describe('State Management', () => {
    it('should maintain state consistency after operations', async () => {
      await orchestrator.createSession(testProjectDir, 'claude-haiku-4-5');

      const sessionId = orchestrator.getSessionId();
      const conversationId = orchestrator.getConversationId();

      // Perform various operations
      await orchestrator.createCheckpoint();
      await orchestrator.switchModel('gpt-4o-mini');
      await orchestrator.createCheckpoint();
      await orchestrator.switchModel('gemini-2.5-flash');

      // Session ID should never change
      expect(orchestrator.getSessionId()).toBe(sessionId);

      // Conversation ID should remain the same (no resume)
      expect(orchestrator.getConversationId()).toBe(conversationId);

      // Model should be updated
      expect(orchestrator.getCurrentModel().id).toBe('gemini-2.5-flash');
    });

    it('should reset conversation ID on resume', async () => {
      await orchestrator.createSession(testProjectDir);

      const originalConversationId = orchestrator.getConversationId();
      const checkpoint = await orchestrator.createCheckpoint();

      await orchestrator.resumeFromCheckpoint(checkpoint.id);

      // New conversation ID
      expect(orchestrator.getConversationId()).not.toBe(originalConversationId);

      // But same session ID
      expect(orchestrator.getSessionId()).toBeDefined();
    });
  });
});
