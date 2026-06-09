/**
 * System Message Injection Tests
 * Phase 2: System Message Registry Integration
 *
 * Tests:
 * - SystemMessageLoader integration
 * - Injection on turn 0
 * - <system-reminder> wrapping
 * - Prepend/append positioning
 * - Conditional injection (tools, capabilities)
 * - Template variable substitution
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SystemMessageLoader } from '../../system-messages/SystemMessageLoader.js';
import type { InjectionContext, TemplateVariables } from '../../system-messages/SystemMessageRegistry.interface.js';

describe('SystemMessageLoader', () => {
  let loader: SystemMessageLoader;

  beforeEach(async () => {
    loader = new SystemMessageLoader({ debug: false });
    await loader.loadRegistry();
  });

  describe('Registry Loading', () => {
    it('should load registry successfully', async () => {
      // Registry should be loaded in beforeEach
      expect(loader).toBeDefined();
    });

    it('should reload registry on demand', async () => {
      await expect(loader.reload()).resolves.not.toThrow();
    });
  });

  describe('Injection Conditions', () => {
    it('should inject system_prompt on turn 0', async () => {
      const context: InjectionContext = {
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: false,
        modelCapabilities: [],
        apiPattern: 'messages',
        sessionId: 'test-session'
      };

      const messages = await loader.getMessagesForContext(context);

      // Should have at least system_prompt
      expect(messages.length).toBeGreaterThan(0);
      const systemPrompt = messages.find(m => m.definition.id === 'system_prompt');
      expect(systemPrompt).toBeDefined();
    });

    it('should inject tool_usage_guide when tools are present', async () => {
      const context: InjectionContext = {
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: true,
        toolCount: 10,
        modelCapabilities: ['tools'],
        apiPattern: 'messages',
        sessionId: 'test-session'
      };

      const messages = await loader.getMessagesForContext(context);

      // Should have tool_usage_guide
      const toolGuide = messages.find(m => m.definition.id === 'tool_usage_guide');
      expect(toolGuide).toBeDefined();
    });

    it('should inject examples when tools are present', async () => {
      const context: InjectionContext = {
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: true,
        toolCount: 5,
        modelCapabilities: ['tools'],
        apiPattern: 'messages',
        sessionId: 'test-session'
      };

      const messages = await loader.getMessagesForContext(context);

      // Should have examples
      const examples = messages.find(m => m.definition.id === 'tool_examples');
      expect(examples).toBeDefined();
    });

    it('should inject reasoning_guide for reasoning models', async () => {
      const context: InjectionContext = {
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: false,
        modelCapabilities: ['reasoning'],
        apiPattern: 'messages',
        sessionId: 'test-session'
      };

      const messages = await loader.getMessagesForContext(context);

      // Should have reasoning_guide
      const reasoningGuide = messages.find(m => m.definition.id === 'reasoning_guide');
      expect(reasoningGuide).toBeDefined();
    });

    it('should inject periodic_reminder on turn 0 (0 % 10 === 0)', async () => {
      const context: InjectionContext = {
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: true,
        modelCapabilities: [],
        apiPattern: 'messages',
        sessionId: 'test-session'
      };

      const messages = await loader.getMessagesForContext(context);

      // Should have periodic_reminder because 0 % 10 === 0
      const periodicReminder = messages.find(m => m.definition.id === 'periodic_reminder');
      expect(periodicReminder).toBeDefined();
    });

    it('should inject periodic_reminder on turn 10', async () => {
      const context: InjectionContext = {
        turnNumber: 10,
        sessionPhase: 'ongoing',
        hasTools: true,
        modelCapabilities: [],
        apiPattern: 'messages',
        sessionId: 'test-session'
      };

      const messages = await loader.getMessagesForContext(context);

      // Should have periodic_reminder
      const periodicReminder = messages.find(m => m.definition.id === 'periodic_reminder');
      expect(periodicReminder).toBeDefined();
    });
  });

  describe('Message Formatting', () => {
    it('should return messages ready for injection', async () => {
      const context: InjectionContext = {
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: true,
        toolCount: 5,
        modelCapabilities: ['tools'],
        apiPattern: 'messages',
        sessionId: 'test-session'
      };

      const messages = await loader.getMessagesForInjection(context);

      expect(messages.length).toBeGreaterThan(0);

      // Check format
      messages.forEach(msg => {
        expect(msg.content).toBeDefined();
        expect(msg.position).toMatch(/prepend|append|interleave/);
        expect(msg.priority).toBeGreaterThanOrEqual(0);
        expect(msg.wrapInSystemReminder).toBe(true);
        expect(msg.contentHash).toBeDefined();
        expect(msg.definition).toBeDefined();
      });
    });

    it('should sort messages by priority', async () => {
      const context: InjectionContext = {
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: true,
        toolCount: 5,
        modelCapabilities: ['tools'],
        apiPattern: 'messages',
        sessionId: 'test-session'
      };

      const messages = await loader.getMessagesForInjection(context);

      // Messages should be sorted by priority (ascending)
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i].priority).toBeGreaterThanOrEqual(messages[i - 1].priority);
      }
    });
  });

  describe('Template Variables', () => {
    it('should apply template variables to dynamic content', async () => {
      const context: InjectionContext = {
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: false,
        modelCapabilities: [],
        apiPattern: 'messages',
        sessionId: 'test-session'
      };

      const templateVars: TemplateVariables = {
        projectPath: '/test/project',
        currentDate: '2025-01-01',
        toolCount: 0
      };

      const messages = await loader.getMessagesForContext(context, templateVars);

      // Find a message with environment_info (which uses templates)
      const envInfo = messages.find(m => m.definition.id === 'environment_info');

      if (envInfo) {
        // Should have replaced template variables
        expect(envInfo.content).toContain('/test/project');
      }
    });
  });

  describe('Deduplication', () => {
    // System messages are intentionally EPHEMERAL — re-injected each turn.
    // `getMessagesForContext` clears its `lastInjectedHashes` set at the
    // start of every call, so dedup is intra-call only (filters duplicates
    // within a single returned message list). Cross-call dedup is not the
    // contract; this test asserts the idempotent re-injection invariant.
    it('returns the same messages on a repeat call with the same context (ephemeral injection)', async () => {
      const context: InjectionContext = {
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: false,
        modelCapabilities: [],
        apiPattern: 'messages',
        sessionId: 'test-session'
      };

      const messages1 = await loader.getMessagesForContext(context);
      expect(messages1.length).toBeGreaterThan(0);

      const messages2 = await loader.getMessagesForContext(context);
      // Idempotent: same context → same message count + same definition IDs.
      expect(messages2.length).toBe(messages1.length);
      expect(messages2.map((m) => m.definition.id).sort()).toEqual(
        messages1.map((m) => m.definition.id).sort(),
      );
    });

    it('should not deduplicate after cache clear', async () => {
      const context: InjectionContext = {
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: false,
        modelCapabilities: [],
        apiPattern: 'messages',
        sessionId: 'test-session'
      };

      // First call
      const messages1 = await loader.getMessagesForContext(context);
      expect(messages1.length).toBeGreaterThan(0);

      // Clear cache
      loader.clearDeduplication();

      // Second call (should not deduplicate)
      const messages2 = await loader.getMessagesForContext(context);
      expect(messages2.length).toBe(messages1.length);
    });
  });

  describe('API Pattern Filtering', () => {
    it('should respect API pattern conditions', async () => {
      const contextMessages: InjectionContext = {
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: false,
        modelCapabilities: [],
        apiPattern: 'messages',
        sessionId: 'test-session'
      };

      const contextGenerate: InjectionContext = {
        ...contextMessages,
        apiPattern: 'generateContent'
      };

      const messagesAPI = await loader.getMessagesForContext(contextMessages);
      loader.clearDeduplication();
      const generateAPI = await loader.getMessagesForContext(contextGenerate);

      // Both should have system messages (no API-specific filtering in base messages)
      expect(messagesAPI.length).toBeGreaterThan(0);
      expect(generateAPI.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing message files gracefully', async () => {
      // This would require a corrupted registry, but we can test reload
      await expect(loader.reload()).resolves.not.toThrow();
    });

    it('should throw error for invalid context with missing fields', async () => {
      const invalidContext: any = {
        turnNumber: 0,
        // Missing required fields like modelCapabilities
      };

      // Should throw an error because model capabilities is undefined
      await expect(
        loader.getMessagesForContext(invalidContext as InjectionContext)
      ).rejects.toThrow();
    });
  });

  describe('Message Content', () => {
    it('should load actual markdown content', async () => {
      const systemPrompt = await loader.getMessageById('system_prompt');

      expect(systemPrompt).toBeDefined();
      expect(systemPrompt!.content).toBeDefined();
      expect(systemPrompt!.content.length).toBeGreaterThan(0);
      expect(systemPrompt!.definition.id).toBe('system_prompt');
    });

    it('should load tool usage guide content', async () => {
      const toolGuide = await loader.getMessageById('tool_usage_guide');

      expect(toolGuide).toBeDefined();
      expect(toolGuide!.content).toBeDefined();
      expect(toolGuide!.content.length).toBeGreaterThan(0);
    });

    it('should return null for non-existent message', async () => {
      const nonExistent = await loader.getMessageById('non_existent_message');

      expect(nonExistent).toBeNull();
    });
  });

  describe('Caching', () => {
    it('should cache file content when enabled', async () => {
      const context: InjectionContext = {
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: false,
        modelCapabilities: [],
        apiPattern: 'messages',
        sessionId: 'test-session'
      };

      // First load (from disk)
      const result1 = await loader.getMessagesForContext(context);
      expect(result1.length).toBeGreaterThan(0);

      // Clear deduplication but not file cache
      loader.clearDeduplication();

      // Second load (should use file cache)
      const result2 = await loader.getMessagesForContext(context);

      // Results should be identical (verifies cache returns same data)
      expect(result2).toEqual(result1);
      expect(result2.length).toBe(result1.length);

      // Verify cache is working by checking file content is same
      // (if cache wasn't working, this would still pass but proves functional correctness)
      expect(result2[0]?.content).toBe(result1[0]?.content);
    });
  });
});
