/**
 * MentorshipMiddleware Test Suite
 *
 * Comprehensive tests for mentorship system including:
 * - Pattern detection from tool errors
 * - Mentorship triggering conditions
 * - Thinking block injection
 * - Pattern count tracking
 * - Session isolation
 * - Error pattern matching
 * - Multiple patterns per session
 * - Pattern clearing and retrieval
 *
 * Target: 100% code coverage
 *
 * @version 1.0.0
 * @author Agent 4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MentorshipMiddleware } from '../MentorshipMiddleware.js';
import type {
  MentorshipToolResult,
  MiddlewareContext
} from '../contracts/MiddlewareContracts.js';
import type { OrchestratorConfig } from '../../orchestrator/CortexOrchestrator.js';

describe('MentorshipMiddleware', () => {
  let middleware: MentorshipMiddleware;
  let baseContext: MiddlewareContext;

  beforeEach(() => {
    middleware = new MentorshipMiddleware();

    // Base context with mentorship enabled
    baseContext = {
      sessionId: 'test-session-001',
      conversationId: 'conv-001',
      turnNumber: 1,
      modelId: 'claude-4-5-sonnet',
      config: {
        defaultModelId: 'claude-4-5-sonnet',
        projectPath: '/test',
        reactiveMentorship: {
          enabled: true,
          triggerOnError: true,
          errorSeverityThreshold: 'medium',
          enableKeywords: true,
          helperModelId: 'grok-beta'
        }
      } as OrchestratorConfig
    };
  });

  describe('shouldTriggerMentorship', () => {
    it('should trigger on high severity error with medium threshold', () => {
      const toolResult: MentorshipToolResult = {
        tool_use_id: 'test_001',
        content: 'Permission denied: cannot access /root',
        is_error: true
      };

      const result = middleware.shouldTriggerMentorship(toolResult, baseContext);
      expect(result).toBe(true);
    });

    it('should trigger on medium severity error with medium threshold', () => {
      const toolResult: MentorshipToolResult = {
        tool_use_id: 'test_002',
        content: 'Error: file not found',
        is_error: true
      };

      const result = middleware.shouldTriggerMentorship(toolResult, baseContext);
      expect(result).toBe(true);
    });

    it('should NOT trigger on low severity error with high threshold', () => {
      const toolResult: MentorshipToolResult = {
        tool_use_id: 'test_003',
        content: 'Warning: deprecated function',
        is_error: true
      };

      const context = {
        ...baseContext,
        config: {
          ...baseContext.config,
          reactiveMentorship: {
            ...baseContext.config.reactiveMentorship!,
            errorSeverityThreshold: 'high' as const
          }
        }
      };

      const result = middleware.shouldTriggerMentorship(toolResult, context);
      expect(result).toBe(false);
    });

    it('should NOT trigger on success result', () => {
      const toolResult: MentorshipToolResult = {
        tool_use_id: 'test_004',
        content: 'Command executed successfully',
        is_error: false
      };

      const result = middleware.shouldTriggerMentorship(toolResult, baseContext);
      expect(result).toBe(false);
    });

    it('should NOT trigger when mentorship is disabled', () => {
      const toolResult: MentorshipToolResult = {
        tool_use_id: 'test_005',
        content: 'Fatal error occurred',
        is_error: true
      };

      const context = {
        ...baseContext,
        config: {
          ...baseContext.config,
          reactiveMentorship: {
            ...baseContext.config.reactiveMentorship!,
            enabled: false
          }
        }
      };

      const result = middleware.shouldTriggerMentorship(toolResult, context);
      expect(result).toBe(false);
    });

    it('should NOT trigger when triggerOnError is disabled', () => {
      const toolResult: MentorshipToolResult = {
        tool_use_id: 'test_006',
        content: 'Fatal error occurred',
        is_error: true
      };

      const context = {
        ...baseContext,
        config: {
          ...baseContext.config,
          reactiveMentorship: {
            ...baseContext.config.reactiveMentorship!,
            triggerOnError: false
          }
        }
      };

      const result = middleware.shouldTriggerMentorship(toolResult, context);
      expect(result).toBe(false);
    });

    it('should trigger on any error with low threshold', () => {
      const toolResult: MentorshipToolResult = {
        tool_use_id: 'test_007',
        content: 'Some random error message',
        is_error: true
      };

      const context = {
        ...baseContext,
        config: {
          ...baseContext.config,
          reactiveMentorship: {
            ...baseContext.config.reactiveMentorship!,
            errorSeverityThreshold: 'low' as const
          }
        }
      };

      const result = middleware.shouldTriggerMentorship(toolResult, context);
      expect(result).toBe(true);
    });

    it('should detect all high severity patterns', () => {
      const highSeverityErrors = [
        'permission denied',
        'access denied',
        'EACCES error',
        'fatal crash',
        'critical failure',
        'cannot proceed',
        'failed to execute',
        'unable to continue'
      ];

      for (const errorContent of highSeverityErrors) {
        const toolResult: MentorshipToolResult = {
          tool_use_id: 'test_high',
          content: errorContent,
          is_error: true
        };

        const result = middleware.shouldTriggerMentorship(toolResult, baseContext);
        expect(result).toBe(true);
      }
    });

    it('should detect all medium severity patterns', () => {
      const mediumSeverityErrors = [
        'error occurred',
        'exception thrown',
        'file not found',
        'ENOENT error',
        'invalid input',
        'timeout reached'
      ];

      for (const errorContent of mediumSeverityErrors) {
        const toolResult: MentorshipToolResult = {
          tool_use_id: 'test_medium',
          content: errorContent,
          is_error: true
        };

        const result = middleware.shouldTriggerMentorship(toolResult, baseContext);
        expect(result).toBe(true);
      }
    });
  });

  describe('trackErrorPattern', () => {
    it('should track error pattern with count', () => {
      const error = 'Error: file not found at line 42';
      const sessionId = 'session-001';

      middleware.trackErrorPattern(error, sessionId);

      const patterns = middleware.getErrorPatterns(sessionId);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].count).toBe(1);
    });

    it('should increment count for repeated patterns', () => {
      const error = 'Error: file not found';
      const sessionId = 'session-002';

      middleware.trackErrorPattern(error, sessionId);
      middleware.trackErrorPattern(error, sessionId);
      middleware.trackErrorPattern(error, sessionId);

      const patterns = middleware.getErrorPatterns(sessionId);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].count).toBe(3);
    });

    it('should normalize numbers in patterns', () => {
      const sessionId = 'session-003';

      middleware.trackErrorPattern('Port 3000 in use', sessionId);
      middleware.trackErrorPattern('Port 8080 in use', sessionId);

      const patterns = middleware.getErrorPatterns(sessionId);
      expect(patterns).toHaveLength(1); // Both should match same pattern
      expect(patterns[0].count).toBe(2);
      expect(patterns[0].pattern).toContain('port n in use');
    });

    it('should remove quotes from patterns', () => {
      const sessionId = 'session-004';

      middleware.trackErrorPattern('file "config.json" not found', sessionId);
      middleware.trackErrorPattern("file 'config.json' not found", sessionId);

      const patterns = middleware.getErrorPatterns(sessionId);
      expect(patterns).toHaveLength(1); // Both should match same file
      expect(patterns[0].pattern).not.toContain('"');
      expect(patterns[0].pattern).not.toContain("'");
      expect(patterns[0].count).toBe(2);
    });

    it('should be case-insensitive', () => {
      const sessionId = 'session-005';

      middleware.trackErrorPattern('ERROR: File Not Found', sessionId);
      middleware.trackErrorPattern('error: file not found', sessionId);

      const patterns = middleware.getErrorPatterns(sessionId);
      expect(patterns).toHaveLength(1); // Both should match
      expect(patterns[0].count).toBe(2);
    });

    it('should handle error objects', () => {
      const sessionId = 'session-006';
      const error = new Error('Test error message');

      middleware.trackErrorPattern(error, sessionId);

      const patterns = middleware.getErrorPatterns(sessionId);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].pattern).toContain('test error message');
    });

    it('should truncate long error messages', () => {
      const sessionId = 'session-007';
      const longError = 'A'.repeat(200); // 200 characters

      middleware.trackErrorPattern(longError, sessionId);

      const patterns = middleware.getErrorPatterns(sessionId);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].pattern.length).toBeLessThanOrEqual(100);
    });

    it('should track firstSeen and lastSeen timestamps', () => {
      const sessionId = 'session-008';
      const error = 'Test error';

      const beforeFirst = new Date();
      middleware.trackErrorPattern(error, sessionId);
      const afterFirst = new Date();

      const patterns = middleware.getErrorPatterns(sessionId);
      expect(patterns[0].firstSeen.getTime()).toBeGreaterThanOrEqual(beforeFirst.getTime());
      expect(patterns[0].firstSeen.getTime()).toBeLessThanOrEqual(afterFirst.getTime());

      // Track again after a delay
      const beforeSecond = new Date();
      middleware.trackErrorPattern(error, sessionId);
      const afterSecond = new Date();

      const updatedPatterns = middleware.getErrorPatterns(sessionId);
      expect(updatedPatterns[0].lastSeen.getTime()).toBeGreaterThanOrEqual(beforeSecond.getTime());
      expect(updatedPatterns[0].lastSeen.getTime()).toBeLessThanOrEqual(afterSecond.getTime());
      expect(updatedPatterns[0].lastSeen.getTime()).toBeGreaterThanOrEqual(
        updatedPatterns[0].firstSeen.getTime()
      );
    });
  });

  describe('session isolation', () => {
    it('should isolate patterns between sessions', () => {
      const error = 'Error: connection failed';

      middleware.trackErrorPattern(error, 'session-A');
      middleware.trackErrorPattern(error, 'session-B');

      const patternsA = middleware.getErrorPatterns('session-A');
      const patternsB = middleware.getErrorPatterns('session-B');

      expect(patternsA).toHaveLength(1);
      expect(patternsB).toHaveLength(1);
      expect(patternsA[0].count).toBe(1);
      expect(patternsB[0].count).toBe(1);
    });

    it('should NOT leak patterns across sessions', () => {
      middleware.trackErrorPattern('Error A', 'session-1');
      middleware.trackErrorPattern('Error B', 'session-2');

      const patterns1 = middleware.getErrorPatterns('session-1');
      const patterns2 = middleware.getErrorPatterns('session-2');

      expect(patterns1).toHaveLength(1);
      expect(patterns2).toHaveLength(1);
      expect(patterns1[0].pattern).not.toBe(patterns2[0].pattern);
    });

    it('should track multiple patterns in same session', () => {
      const sessionId = 'session-multi';

      middleware.trackErrorPattern('Error: file not found', sessionId);
      middleware.trackErrorPattern('Error: permission denied', sessionId);
      middleware.trackErrorPattern('Error: timeout', sessionId);

      const patterns = middleware.getErrorPatterns(sessionId);
      expect(patterns).toHaveLength(3);
    });

    it('should return empty array for unknown session', () => {
      const patterns = middleware.getErrorPatterns('unknown-session');
      expect(patterns).toEqual([]);
    });
  });

  describe('pattern clearing', () => {
    it('should clear patterns for specific session', () => {
      middleware.trackErrorPattern('Error 1', 'session-X');
      middleware.trackErrorPattern('Error 2', 'session-Y');

      middleware.clearPatterns('session-X');

      const patternsX = middleware.getErrorPatterns('session-X');
      const patternsY = middleware.getErrorPatterns('session-Y');

      expect(patternsX).toHaveLength(0);
      expect(patternsY).toHaveLength(1);
    });

    it('should be safe to clear non-existent session', () => {
      expect(() => {
        middleware.clearPatterns('non-existent-session');
      }).not.toThrow();
    });

    it('should allow re-tracking after clear', () => {
      const sessionId = 'session-clear';
      const error = 'Test error';

      middleware.trackErrorPattern(error, sessionId);
      middleware.clearPatterns(sessionId);
      middleware.trackErrorPattern(error, sessionId);

      const patterns = middleware.getErrorPatterns(sessionId);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].count).toBe(1); // Count resets after clear
    });
  });

  describe('injectThinkingBlock', () => {
    it('should inject thinking block into array content', () => {
      const response = {
        content: [
          { type: 'text', text: 'Original response' }
        ]
      };

      const guidance = 'Consider using a different approach';
      const result = middleware.injectThinkingBlock(response, guidance);

      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe('thinking');
      expect(result.content[0].thinking).toContain('AI Mentor Insight');
      expect(result.content[0].thinking).toContain(guidance);
      expect(result.content[1]).toEqual({ type: 'text', text: 'Original response' });
    });

    it('should wrap string content in array with thinking block', () => {
      const response = {
        content: 'Original response text'
      };

      const guidance = 'Think about edge cases';
      const result = middleware.injectThinkingBlock(response, guidance);

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe('thinking');
      expect(result.content[1].type).toBe('text');
      expect(result.content[1].text).toBe('Original response text');
    });

    it('should preserve existing response properties', () => {
      const response = {
        id: 'msg_123',
        model: 'claude-4-5-sonnet',
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 }
      };

      const result = middleware.injectThinkingBlock(response, 'Guidance');

      expect(result.id).toBe('msg_123');
      expect(result.model).toBe('claude-4-5-sonnet');
      expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
    });

    it('should handle null/undefined response gracefully', () => {
      expect(middleware.injectThinkingBlock(null, 'Guidance')).toBeNull();
      expect(middleware.injectThinkingBlock(undefined, 'Guidance')).toBeUndefined();
    });

    it('should handle response without content', () => {
      const response = { id: 'msg_123' };
      const result = middleware.injectThinkingBlock(response, 'Guidance');
      expect(result).toEqual(response);
    });
  });

  describe('handlePatternDetection', () => {
    it('should handle pattern detection for existing pattern', async () => {
      const sessionId = 'session-detect';
      const error = 'File not found';

      // Track pattern
      middleware.trackErrorPattern(error, sessionId);

      const context = { ...baseContext, sessionId };
      const pattern = middleware.getErrorPatterns(sessionId)[0].pattern;

      // Should not throw
      await expect(
        middleware.handlePatternDetection(pattern, context)
      ).resolves.not.toThrow();
    });

    it('should handle non-existent pattern gracefully', async () => {
      const context = { ...baseContext, sessionId: 'session-none' };

      await expect(
        middleware.handlePatternDetection('non-existent-pattern', context)
      ).resolves.not.toThrow();
    });
  });

  describe('utility methods', () => {
    it('should check threshold correctly', () => {
      const sessionId = 'session-threshold';
      const error = 'Test error';

      // Track twice (below threshold of 3)
      middleware.trackErrorPattern(error, sessionId);
      middleware.trackErrorPattern(error, sessionId);

      const pattern = middleware.getErrorPatterns(sessionId)[0].pattern;

      expect(middleware.hasReachedThreshold(pattern, sessionId, 3)).toBe(false);

      // Track once more (meets threshold)
      middleware.trackErrorPattern(error, sessionId);

      expect(middleware.hasReachedThreshold(pattern, sessionId, 3)).toBe(true);
    });

    it('should reset pattern count', () => {
      const sessionId = 'session-reset';
      const error = 'Test error';

      middleware.trackErrorPattern(error, sessionId);
      middleware.trackErrorPattern(error, sessionId);
      middleware.trackErrorPattern(error, sessionId);

      const pattern = middleware.getErrorPatterns(sessionId)[0].pattern;
      expect(middleware.getErrorPatterns(sessionId)[0].count).toBe(3);

      middleware.resetPatternCount(pattern, sessionId);

      expect(middleware.getErrorPatterns(sessionId)[0].count).toBe(0);
    });

    it('should get total error count', () => {
      const sessionId = 'session-total';

      middleware.trackErrorPattern('Error 1', sessionId);
      middleware.trackErrorPattern('Error 1', sessionId);
      middleware.trackErrorPattern('Error 2', sessionId);

      expect(middleware.getTotalErrorCount(sessionId)).toBe(3);
    });

    it('should get unique pattern count', () => {
      const sessionId = 'session-unique';

      middleware.trackErrorPattern('error type a', sessionId);
      middleware.trackErrorPattern('error type a', sessionId);
      middleware.trackErrorPattern('error type b', sessionId);
      middleware.trackErrorPattern('error type c', sessionId);

      expect(middleware.getUniquePatternCount(sessionId)).toBe(3);
    });

    it('should check if session has patterns', () => {
      const sessionId = 'session-has';

      expect(middleware.hasPatterns(sessionId)).toBe(false);

      middleware.trackErrorPattern('Error', sessionId);

      expect(middleware.hasPatterns(sessionId)).toBe(true);
    });

    it('should return zero counts for non-existent session', () => {
      expect(middleware.getTotalErrorCount('non-existent')).toBe(0);
      expect(middleware.getUniquePatternCount('non-existent')).toBe(0);
    });

    it('should handle threshold check on non-existent session', () => {
      expect(middleware.hasReachedThreshold('pattern', 'non-existent', 3)).toBe(false);
    });

    it('should handle reset on non-existent session', () => {
      expect(() => {
        middleware.resetPatternCount('pattern', 'non-existent');
      }).not.toThrow();
    });
  });

  describe('pattern sorting', () => {
    it('should sort patterns by count descending', () => {
      const sessionId = 'session-sort';

      // Track different errors with different counts
      middleware.trackErrorPattern('Error A', sessionId); // 1
      middleware.trackErrorPattern('Error B', sessionId); // 3
      middleware.trackErrorPattern('Error B', sessionId);
      middleware.trackErrorPattern('Error B', sessionId);
      middleware.trackErrorPattern('Error C', sessionId); // 2
      middleware.trackErrorPattern('Error C', sessionId);

      const patterns = middleware.getErrorPatterns(sessionId);

      expect(patterns).toHaveLength(3);
      expect(patterns[0].count).toBe(3); // Error B first
      expect(patterns[1].count).toBe(2); // Error C second
      expect(patterns[2].count).toBe(1); // Error A last
    });
  });

  describe('edge cases', () => {
    it('should handle empty error message', () => {
      const sessionId = 'session-empty';
      middleware.trackErrorPattern('', sessionId);

      const patterns = middleware.getErrorPatterns(sessionId);
      expect(patterns).toHaveLength(1);
    });

    it('should handle error with special characters', () => {
      const sessionId = 'session-special';
      const error = 'Error: $PATH/file@123.txt (user#456) failed!';

      middleware.trackErrorPattern(error, sessionId);

      const patterns = middleware.getErrorPatterns(sessionId);
      expect(patterns).toHaveLength(1);
    });

    it('should handle very long session IDs', () => {
      const longSessionId = 'x'.repeat(1000);
      const error = 'Test error';

      middleware.trackErrorPattern(error, longSessionId);

      const patterns = middleware.getErrorPatterns(longSessionId);
      expect(patterns).toHaveLength(1);
    });

    it('should handle concurrent error tracking', () => {
      const sessionId = 'session-concurrent';
      const error = 'Concurrent error';

      // Simulate concurrent tracking
      Promise.all([
        Promise.resolve(middleware.trackErrorPattern(error, sessionId)),
        Promise.resolve(middleware.trackErrorPattern(error, sessionId)),
        Promise.resolve(middleware.trackErrorPattern(error, sessionId))
      ]);

      const patterns = middleware.getErrorPatterns(sessionId);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].count).toBe(3);
    });
  });

  describe('checkSequentialToolCalls', () => {
    it('should return null for calls below threshold', () => {
      const result1 = middleware.checkSequentialToolCalls('s1', 'ReadFile', true);
      const result2 = middleware.checkSequentialToolCalls('s1', 'WriteFile', true);
      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });

    it('should return nudge when threshold reached and code execution enabled', () => {
      middleware.checkSequentialToolCalls('s1', 'ReadFile', true);
      middleware.checkSequentialToolCalls('s1', 'WriteFile', true);
      const result = middleware.checkSequentialToolCalls('s1', 'Glob', true);
      expect(result).toBeTruthy();
      expect(result).toContain('CodeExecute');
      expect(result).toContain('3');
    });

    it('should return null when code execution is disabled', () => {
      middleware.checkSequentialToolCalls('s1', 'a', false);
      middleware.checkSequentialToolCalls('s1', 'b', false);
      const result = middleware.checkSequentialToolCalls('s1', 'c', false);
      expect(result).toBeNull();
    });

    it('should reset counter after nudge', () => {
      middleware.checkSequentialToolCalls('s1', 'a', true);
      middleware.checkSequentialToolCalls('s1', 'b', true);
      middleware.checkSequentialToolCalls('s1', 'c', true); // triggers nudge, resets

      // Next two should not trigger
      const r1 = middleware.checkSequentialToolCalls('s1', 'd', true);
      const r2 = middleware.checkSequentialToolCalls('s1', 'e', true);
      expect(r1).toBeNull();
      expect(r2).toBeNull();
    });

    it('should isolate counts between sessions', () => {
      middleware.checkSequentialToolCalls('s1', 'a', true);
      middleware.checkSequentialToolCalls('s1', 'b', true);
      middleware.checkSequentialToolCalls('s2', 'a', true);

      // s1 has 2 calls, s2 has 1 — neither should trigger yet
      const r1 = middleware.checkSequentialToolCalls('s1', 'c', true);
      const r2 = middleware.checkSequentialToolCalls('s2', 'b', true);
      expect(r1).toBeTruthy(); // s1 hits 3
      expect(r2).toBeNull();   // s2 only at 2
    });
  });

  describe('resetSequentialCalls', () => {
    it('should reset counter for specific session', () => {
      middleware.checkSequentialToolCalls('s1', 'a', true);
      middleware.checkSequentialToolCalls('s1', 'b', true);
      middleware.resetSequentialCalls('s1');

      // After reset, need 3 more to trigger
      middleware.checkSequentialToolCalls('s1', 'c', true);
      middleware.checkSequentialToolCalls('s1', 'd', true);
      const result = middleware.checkSequentialToolCalls('s1', 'e', true);
      expect(result).toBeTruthy(); // 3 calls after reset
    });

    it('should not affect other sessions', () => {
      middleware.checkSequentialToolCalls('s1', 'a', true);
      middleware.checkSequentialToolCalls('s2', 'a', true);
      middleware.checkSequentialToolCalls('s2', 'b', true);

      middleware.resetSequentialCalls('s1');

      // s2 still has 2 calls
      const result = middleware.checkSequentialToolCalls('s2', 'c', true);
      expect(result).toBeTruthy(); // s2 hits 3
    });

    it('should handle resetting non-existent session', () => {
      expect(() => {
        middleware.resetSequentialCalls('non-existent');
      }).not.toThrow();
    });
  });
});
