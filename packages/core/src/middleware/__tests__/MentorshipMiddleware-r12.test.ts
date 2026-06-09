/**
 * Round 12 (parallel-bench output): two fixes to MentorshipMiddleware.
 *
 * Opus: `shouldTriggerMentorship` ran medium-severity pattern scan even when
 * `threshold === 'low'` would return true unconditionally afterwards.
 *
 * Cortex: `extractErrorPattern` compiled two regex literals per call.
 * Hoisted to static fields.
 */

import { describe, it, expect } from 'vitest';
import { MentorshipMiddleware } from '../MentorshipMiddleware.js';

describe('MentorshipMiddleware — Round 12 fixes', () => {
  describe('shouldTriggerMentorship short-circuit (Opus finding)', () => {
    const mw = new MentorshipMiddleware();

    const mkCtx = (threshold: 'low' | 'medium' | 'high') => ({
      sessionId: 's1',
      conversationId: 'c1',
      turnNumber: 1,
      modelId: 'test',
      config: {
        reactiveMentorship: {
          enabled: true,
          triggerOnError: true,
          errorSeverityThreshold: threshold,
          keywordsEnabled: false,
          turnBasedEnabled: false,
          patternDetection: false,
        },
      },
    } as any);

    const errResult = (content: string) => ({
      tool_use_id: 'x',
      content,
      is_error: true,
    });

    it('low threshold: triggers on any error (no pattern scan needed)', () => {
      const result = (mw as any).shouldTriggerMentorship(
        errResult('completely benign error text with no severity words'),
        mkCtx('low'),
      );
      expect(result).toBe(true);
    });

    it('low threshold: also triggers on high-severity content (still true)', () => {
      const result = (mw as any).shouldTriggerMentorship(
        errResult('permission denied'),
        mkCtx('low'),
      );
      expect(result).toBe(true);
    });

    it('medium threshold: triggers on medium-severity word', () => {
      const result = (mw as any).shouldTriggerMentorship(
        errResult('timeout while reading file'),
        mkCtx('medium'),
      );
      expect(result).toBe(true);
    });

    it('medium threshold: does NOT trigger on benign content (no severity keywords)', () => {
      // String must avoid: error, exception, not found, enoent, invalid, timeout
      // and any high-severity keyword
      const result = (mw as any).shouldTriggerMentorship(
        errResult('the operation completed with status code 7'),
        mkCtx('medium'),
      );
      expect(result).toBe(false);
    });

    it('high threshold: triggers only on high-severity content', () => {
      expect((mw as any).shouldTriggerMentorship(
        errResult('permission denied'),
        mkCtx('high'),
      )).toBe(true);
      expect((mw as any).shouldTriggerMentorship(
        errResult('timeout occurred'),
        mkCtx('high'),
      )).toBe(false);
    });
  });

  describe('extractErrorPattern uses static regexes (Cortex finding)', () => {
    const mw = new MentorshipMiddleware();

    it('normalizes numbers to N', () => {
      const p = (mw as any).extractErrorPattern('Port 3000 in use');
      expect(p).toBe('port n in use');
    });

    it('removes quotes', () => {
      const p = (mw as any).extractErrorPattern('File "test.js" not found');
      expect(p).toBe('file test.js not found');
    });

    it('uses the same RegExp instance across calls', () => {
      // Assert the static fields exist and are RegExp instances
      const numberRe = (MentorshipMiddleware as any).NUMBER_REGEX;
      const quoteRe = (MentorshipMiddleware as any).QUOTE_REGEX;
      expect(numberRe).toBeInstanceOf(RegExp);
      expect(quoteRe).toBeInstanceOf(RegExp);
      // Identity check — same object on the class, not a new instance
      expect((MentorshipMiddleware as any).NUMBER_REGEX).toBe(numberRe);
    });
  });
});
