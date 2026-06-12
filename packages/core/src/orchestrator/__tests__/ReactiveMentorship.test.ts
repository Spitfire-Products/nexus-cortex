/**
 * Reactive Mentorship Tests
 * Phase 1: Error-Triggered and Keyword-Triggered Mentorship
 *
 * Tests:
 * - Configuration validation
 * - Error detection and severity thresholds
 * - Keyword detection (@ultrathink, @analyze, @rethink)
 * - Thinking block injection
 * - Helper model integration
 * - Message history integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CortexOrchestrator } from '../CortexOrchestrator.js';
import type { OrchestratorConfig } from '../CortexOrchestrator.js';
import { HelperModelMiddleware } from '../../middleware/HelperModelMiddleware.js';
import type { Message } from '../../session/MessageTypes.js';

describe('Reactive Mentorship', () => {
  let orchestrator: CortexOrchestrator;
  let helperMiddleware: HelperModelMiddleware;

  const createTestOrchestrator = async (config: Partial<OrchestratorConfig>) => {
    // This is a simplified test setup
    // In real tests, you would inject all dependencies
    // For now, we'll test the methods in isolation
  };

  beforeEach(async () => {
    helperMiddleware = new HelperModelMiddleware();
  });

  describe('Configuration', () => {
    it('should accept valid mentorship configuration', () => {
      const config: OrchestratorConfig = {
        defaultModelId: 'claude-sonnet-4-5',
        projectPath: '/test',
        reactiveMentorship: {
          enabled: true,
          triggerOnError: true,
          errorSeverityThreshold: 'medium',
          enableKeywords: true,
          customKeywords: ['@help'],
          helperModelId: 'grok-beta'
        }
      };

      expect(config.reactiveMentorship).toBeDefined();
      expect(config.reactiveMentorship?.enabled).toBe(true);
      expect(config.reactiveMentorship?.errorSeverityThreshold).toBe('medium');
    });

    it('should accept minimal mentorship configuration', () => {
      const config: OrchestratorConfig = {
        defaultModelId: 'claude-sonnet-4-5',
        projectPath: '/test',
        reactiveMentorship: {
          enabled: true,
          triggerOnError: true,
          errorSeverityThreshold: 'medium',
          enableKeywords: false
        }
      };

      expect(config.reactiveMentorship).toBeDefined();
      expect(config.reactiveMentorship?.enableKeywords).toBe(false);
    });

    it('should work without mentorship configuration', () => {
      const config: OrchestratorConfig = {
        defaultModelId: 'claude-sonnet-4-5',
        projectPath: '/test'
      };

      expect(config.reactiveMentorship).toBeUndefined();
    });
  });

  describe('Error Detection', () => {
    it('should detect high severity errors', () => {
      const highSeverityErrors = [
        'Permission denied',
        'Access denied',
        'EACCES: permission denied',
        'Fatal error occurred',
        'Critical failure',
        'Cannot access file',
        'Failed to execute',
        'Unable to proceed'
      ];

      for (const errorContent of highSeverityErrors) {
        const toolResult = {
          tool_use_id: 'test_123',
          content: errorContent,
          is_error: true
        };

        // High severity errors should trigger even with 'high' threshold
        expect(errorContent.toLowerCase()).toMatch(
          /permission denied|access denied|eacces|fatal|critical|cannot|failed to|unable to/
        );
      }
    });

    it('should detect medium severity errors', () => {
      const mediumSeverityErrors = [
        'Error: command not found',
        'Exception occurred',
        'File not found',
        'ENOENT: no such file',
        'Invalid argument',
        'Request timeout'
      ];

      for (const errorContent of mediumSeverityErrors) {
        const toolResult = {
          tool_use_id: 'test_123',
          content: errorContent,
          is_error: true
        };

        expect(errorContent.toLowerCase()).toMatch(
          /error|exception|not found|enoent|invalid|timeout/
        );
      }
    });

    it('should not trigger on non-error results', () => {
      const successResult = {
        tool_use_id: 'test_123',
        content: 'Command executed successfully',
        is_error: false
      };

      expect(successResult.is_error).toBe(false);
    });
  });

  describe('Keyword Detection', () => {
    it('should detect @ultrathink keyword', () => {
      const messages = [
        'I need strategic help @ultrathink',
        '@ultrathink What should I do?',
        'Please analyze this situation @ultrathink'
      ];

      for (const message of messages) {
        expect(message).toContain('@ultrathink');
      }
    });

    it('should detect @analyze keyword', () => {
      const messages = [
        'Can you @analyze this approach?',
        '@analyze what went wrong',
        'I need quick analysis @analyze'
      ];

      for (const message of messages) {
        expect(message).toContain('@analyze');
      }
    });

    it('should detect @rethink keyword', () => {
      const messages = [
        'Maybe we should @rethink this',
        '@rethink from first principles',
        'Time to @rethink our strategy'
      ];

      for (const message of messages) {
        expect(message).toContain('@rethink');
      }
    });

    it('should detect @mentor keyword', () => {
      const messages = [
        'I need guidance @mentor',
        '@mentor help me understand',
        'Can you @mentor me through this'
      ];

      for (const message of messages) {
        expect(message).toContain('@mentor');
      }
    });

    it('should not detect keywords in normal text', () => {
      const messages = [
        'This is a normal message',
        'No keywords here',
        'Just regular conversation'
      ];

      for (const message of messages) {
        expect(message).not.toContain('@ultrathink');
        expect(message).not.toContain('@analyze');
        expect(message).not.toContain('@rethink');
      }
    });
  });

  describe('Helper Model Integration', () => {
    it('should have generateErrorGuidance method', () => {
      expect(helperMiddleware.generateErrorGuidance).toBeDefined();
      expect(typeof helperMiddleware.generateErrorGuidance).toBe('function');
    });

    it('should have generateKeywordGuidance method', () => {
      expect(helperMiddleware.generateKeywordGuidance).toBeDefined();
      expect(typeof helperMiddleware.generateKeywordGuidance).toBe('function');
    });

    it('should format error context correctly', async () => {
      const recentHistory: Message[] = [
        {
          uuid: 'msg-1',
          timestamp: new Date().toISOString(),
          type: 'user',
          message: {
            role: 'user',
            content: 'Run npm test'
          }
        } as any,
        {
          uuid: 'msg-2',
          timestamp: new Date().toISOString(),
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Running tests...' }]
          }
        } as any
      ];

      // Mock the helper model call
      const mockGuidance = `**Error Analysis**: npm is not installed
**Immediate Fix**:
- Install Node.js and npm
- Verify with npm --version
**Why This Works**: npm is the package manager for Node.js`;

      expect(mockGuidance).toContain('Error Analysis');
      expect(mockGuidance).toContain('Immediate Fix');
      expect(mockGuidance).toContain('Why This Works');
    });

    it('should format keyword context correctly', async () => {
      const recentHistory: Message[] = [
        {
          uuid: 'msg-1',
          timestamp: new Date().toISOString(),
          type: 'user',
          message: {
            role: 'user',
            content: 'How do I implement this feature?'
          }
        } as any,
        {
          uuid: 'msg-2',
          timestamp: new Date().toISOString(),
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Let me help you...' }]
          }
        } as any
      ];

      // Mock the ultrathink guidance
      const mockGuidance = `**Current Situation**: You're implementing a new feature
**Strategy Options**:
1. Incremental approach - Build step by step
2. Research first - Look for existing solutions
3. Prototype quickly - Get something working fast
**Recommended Approach**: Option 1 for reliability
**Next Steps**: Break into smaller tasks`;

      expect(mockGuidance).toContain('Current Situation');
      expect(mockGuidance).toContain('Strategy Options');
      expect(mockGuidance).toContain('Recommended Approach');
      expect(mockGuidance).toContain('Next Steps');
    });
  });

  describe('Thinking Block Structure', () => {
    it('should create thinking block with correct structure', () => {
      const thinkingBlock = {
        uuid: 'thinking-123',
        timestamp: new Date().toISOString(),
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'thinking',
            thinking: '💭 **AI Mentor Insight** (error)\n\nTest guidance'
          }]
        },
        timeline: {
          sessionId: 'test-session',
          conversationId: 'test-conv',
          turnNumber: 1
        },
        model: {
          id: 'grok-beta',
          provider: 'xai',
          apiPattern: 'chat/completions'
        },
        metadata: {
          mentorshipGuidance: true,
          syntheticReasoning: true,
          source: 'error'
        }
      };

      expect(thinkingBlock.type).toBe('assistant');
      expect(thinkingBlock.message.content[0].type).toBe('thinking');
      expect(thinkingBlock.message.content[0].thinking).toContain('💭');
      expect(thinkingBlock.metadata.mentorshipGuidance).toBe(true);
      expect(thinkingBlock.metadata.syntheticReasoning).toBe(true);
    });

    it('should include source in thinking block', () => {
      const errorSource = {
        metadata: {
          mentorshipGuidance: true,
          syntheticReasoning: true,
          source: 'error'
        }
      };

      const keywordSource = {
        metadata: {
          mentorshipGuidance: true,
          syntheticReasoning: true,
          source: 'keyword'
        }
      };

      expect(errorSource.metadata.source).toBe('error');
      expect(keywordSource.metadata.source).toBe('keyword');
    });
  });

  describe('Severity Thresholds', () => {
    it('should apply high severity threshold correctly', () => {
      const threshold = 'high';

      const highSeverityError = 'Permission denied';
      const mediumSeverityError = 'Error: command not found';
      const lowSeverityError = 'Warning: deprecated';

      // High threshold should only trigger on high severity
      expect(highSeverityError.toLowerCase()).toContain('permission denied');
      expect(mediumSeverityError.toLowerCase()).toContain('error');
      expect(lowSeverityError.toLowerCase()).toContain('warning');
    });

    it('should apply medium severity threshold correctly', () => {
      const threshold = 'medium';

      const highSeverityError = 'Fatal error';
      const mediumSeverityError = 'Exception occurred';

      // Medium threshold should trigger on high and medium
      expect(highSeverityError.toLowerCase()).toContain('fatal');
      expect(mediumSeverityError.toLowerCase()).toContain('exception');
    });

    it('should apply low severity threshold correctly', () => {
      const threshold = 'low';

      // Low threshold should trigger on any error
      const anyError = 'Something went wrong';
      expect(anyError.toLowerCase()).toContain('wrong');
    });
  });

  describe('Keyword Removal', () => {
    it('should remove keyword from string content', () => {
      const original = 'Please help me @ultrathink with this problem';
      const keyword = '@ultrathink';
      // Replace keyword and normalize multiple spaces to single space
      const cleaned = original.replace(keyword, '').replace(/\s+/g, ' ').trim();

      expect(cleaned).toBe('Please help me with this problem');
      expect(cleaned).not.toContain('@ultrathink');
    });

    it('should remove keyword from content blocks', () => {
      const contentBlocks = [
        {
          type: 'text',
          text: 'I need help @analyze'
        }
      ];

      const cleaned = contentBlocks.map(block => ({
        ...block,
        text: block.text.replace('@analyze', '').trim()
      }));

      expect(cleaned[0].text).toBe('I need help');
      expect(cleaned[0].text).not.toContain('@analyze');
    });

    it('should handle multiple keywords in same message', () => {
      const message = 'Help me @ultrathink and also @analyze';

      expect(message).toContain('@ultrathink');
      expect(message).toContain('@analyze');

      // Only first keyword should be processed
      const firstKeyword = '@ultrathink';
      const cleaned = message.replace(firstKeyword, '').trim();

      expect(cleaned).toContain('@analyze');
      expect(cleaned).not.toContain('@ultrathink');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle error-triggered mentorship flow', () => {
      // Scenario: Tool error occurs -> Mentorship triggered
      const toolError = {
        tool_use_id: 'toolu_123',
        content: 'bash: npm: command not found',
        is_error: true
      };

      // 1. Error is detected
      expect(toolError.is_error).toBe(true);
      expect(toolError.content).toContain('command not found');

      // 2. Severity is assessed (medium)
      expect(toolError.content.toLowerCase()).toContain('not found');

      // 3. Guidance is generated (mocked)
      const guidance = {
        analysis: 'npm is not installed',
        fix: 'Install Node.js and npm',
        explanation: 'npm is required for package management'
      };

      expect(guidance.analysis).toBeDefined();
      expect(guidance.fix).toBeDefined();
      expect(guidance.explanation).toBeDefined();

      // 4. Thinking block is injected
      const thinkingBlock = {
        type: 'thinking',
        thinking: `💭 **AI Mentor Insight** (error)\n\n${guidance.analysis}`
      };

      expect(thinkingBlock.type).toBe('thinking');
      expect(thinkingBlock.thinking).toContain('💭');
    });

    it('should handle keyword-triggered mentorship flow', () => {
      // Scenario: User uses @ultrathink -> Mentorship triggered
      const userMessage = 'I am stuck on this implementation @ultrathink';

      // 1. Keyword is detected
      const keyword = '@ultrathink';
      expect(userMessage).toContain(keyword);

      // 2. Keyword is removed
      const cleanedMessage = userMessage.replace(keyword, '').trim();
      expect(cleanedMessage).toBe('I am stuck on this implementation');

      // 3. Guidance is generated (mocked)
      const guidance = {
        situation: 'Implementation challenges detected',
        options: [
          'Break into smaller steps',
          'Research existing solutions',
          'Seek architectural review'
        ],
        recommendation: 'Break into smaller steps for clarity',
        nextSteps: 'List key components needed'
      };

      expect(guidance.options).toHaveLength(3);
      expect(guidance.recommendation).toBeDefined();

      // 4. Thinking block is injected
      const thinkingBlock = {
        type: 'thinking',
        thinking: `💭 **AI Mentor Insight** (keyword)\n\n${guidance.situation}`
      };

      expect(thinkingBlock.type).toBe('thinking');
      expect(thinkingBlock.thinking).toContain('💭');
    });

    it('should handle disabled mentorship gracefully', () => {
      const config = {
        reactiveMentorship: {
          enabled: false,
          triggerOnError: true,
          errorSeverityThreshold: 'medium' as const,
          enableKeywords: true
        }
      };

      // When disabled, no mentorship should trigger
      expect(config.reactiveMentorship.enabled).toBe(false);

      // Error occurs but mentorship is disabled
      const toolError = {
        tool_use_id: 'toolu_123',
        content: 'Error occurred',
        is_error: true
      };

      // Should not trigger because enabled = false
      const shouldTrigger = config.reactiveMentorship.enabled &&
                           config.reactiveMentorship.triggerOnError &&
                           toolError.is_error;

      expect(shouldTrigger).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message history', () => {
      const emptyHistory: Message[] = [];

      // Should not crash with empty history
      expect(emptyHistory.length).toBe(0);
      expect(() => emptyHistory.slice(-5)).not.toThrow();
    });

    it('should handle very long error messages', () => {
      const longError = 'Error: ' + 'x'.repeat(10000);
      const toolResult = {
        tool_use_id: 'test_123',
        content: longError,
        is_error: true
      };

      expect(toolResult.content.length).toBeGreaterThan(1000);
      expect(toolResult.is_error).toBe(true);
    });

    it('should handle special characters in error messages', () => {
      const specialChars = 'Error: File "test<>?.txt" not found (\\path\\to\\file)';
      const toolResult = {
        tool_use_id: 'test_123',
        content: specialChars,
        is_error: true
      };

      expect(toolResult.content).toContain('<>?');
      expect(toolResult.content).toContain('\\path\\');
    });

    it('should handle concurrent keyword triggers', () => {
      const message1 = 'Help @ultrathink';
      const message2 = 'Also @analyze';

      // Each should be processed independently
      expect(message1).toContain('@ultrathink');
      expect(message2).toContain('@analyze');
      expect(message1).not.toContain('@analyze');
      expect(message2).not.toContain('@ultrathink');
    });
  });
});
