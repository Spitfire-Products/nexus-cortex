/**
 * Regression test: two fixes to HelperModelMiddleware.
 *
 * Finding: `analyzeRejection` double-counted tool_result tokens
 * (historyTokens already included them, then toolResultTokens was added
 * AGAIN). Inflated total by ~30-40% on tool-heavy turns, skewed the
 * rejection-reason classifier.
 *
 * Finding: `getHelperModelConfig` rebuilt the ~140-line nested
 * fallback config literal on every call (interleaved-thinking
 * continuation fires it per tool-call iteration).
 */

import { describe, it, expect, vi } from 'vitest';
import { HelperModelMiddleware } from '../HelperModelMiddleware.js';
import { TokenCounter } from '../../utils/TokenCounter.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';

// Stable per-call token count so we can verify exact math
const COUNT_PER_MSG = 100;

const FAKE_MODEL: ModelConfig = {
  id: 'test', provider: 'anthropic', displayName: 'T', family: 't',
  api: { pattern: 'messages', endpoint: 'x', apiKeyEnvVar: 'X', authHeader: 'x' },
  limits: { contextWindow: 1000, outputTokens: 100, requestsPerMinute: 10, tokensPerMinute: 1000 },
  tools: { supported: true } as any,
  reasoning: { supported: false } as any,
  streaming: { supported: true } as any,
  compaction: { thresholdCalculation: { method: 'percentage' } } as any,
} as any;

describe('HelperModelMiddleware — Round 11 fixes', () => {
  describe('analyzeRejection token math (cortex finding)', () => {
    it('does NOT double-count tool_result messages', async () => {
      vi.spyOn(TokenCounter, 'count').mockReturnValue({ tokens: COUNT_PER_MSG } as any);
      const mw = new HelperModelMiddleware({} as any, {} as any);

      const request = {
        messages: [
          { role: 'user', content: 'q1' },
          { role: 'assistant', content: 'a1' },
          { role: 'tool', content: 'r1' },          // 1 tool result
          { role: 'tool', content: 'r2' },          // 2 tool result
          { role: 'user', content: 'q2' },
        ],
      } as any;

      const analysis = (mw as any).analyzeRejection(request, new Error('limit'), FAKE_MODEL);
      // 5 messages × 100 = 500. Pre-fix would have been 500 + 200 = 700.
      expect(analysis.historyTokens).toBe(500);
      expect(analysis.toolResultTokens).toBe(200); // 2 tool results × 100
      expect(analysis.totalTokens).toBe(500); // NOT 700
      vi.restoreAllMocks();
    });

    it('classifier reason reflects the correct totals (not inflated)', async () => {
      vi.spyOn(TokenCounter, 'count').mockReturnValue({ tokens: COUNT_PER_MSG } as any);
      const mw = new HelperModelMiddleware({} as any, {} as any);

      // 5 history messages, no tool results → reason should be history_too_large
      const request = {
        messages: [
          { role: 'user', content: 'q1' },
          { role: 'assistant', content: 'a1' },
          { role: 'user', content: 'q2' },
          { role: 'assistant', content: 'a2' },
          { role: 'user', content: 'q3' },
        ],
      } as any;
      // Use a tight context window so we trigger rejection
      const tight = { ...FAKE_MODEL, limits: { ...FAKE_MODEL.limits, contextWindow: 400 } };
      const analysis = (mw as any).analyzeRejection(request, new Error('limit'), tight);
      expect(analysis.reason).toBe('history_too_large');
      vi.restoreAllMocks();
    });
  });

  describe('getHelperConfigsCached (opus finding)', () => {
    it('returns the same object reference across calls (cache hit)', () => {
      // Force at least one call so the cache is warmed
      const a = (HelperModelMiddleware as any).getHelperConfigsCached();
      const b = (HelperModelMiddleware as any).getHelperConfigsCached();
      expect(a).toBe(b); // identity, not just equality
    });

    it('cached dictionary contains expected helper model ids', () => {
      const cfg = (HelperModelMiddleware as any).getHelperConfigsCached();
      expect(cfg).toHaveProperty('claude-haiku-4-5');
      expect(cfg).toHaveProperty('gemini-2.0-flash-lite');
      expect(cfg).toHaveProperty('grok-4.3'); // grok-4-fast deprecated → grok-4.3 (live)
    });
  });
});
