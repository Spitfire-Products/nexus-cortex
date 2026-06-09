/**
 * R28f hybrid: classify a system message as turn-varying vs turn-0-static.
 *
 * R28f pins the static system prompt per conversation for xAI cross-turn
 * cache stability. That correctly handles content gated to turnNumber:0 /
 * sessionPhase purely as a token-saving heuristic (it stays cached). But a
 * genuinely periodic message (turnNumberModulo — e.g. periodic_reminder, every
 * 10 turns) must re-evaluate per turn; freezing it defeats its purpose. Such
 * messages are routed to the moving user turn (after every provider's cache
 * boundary) instead of the pinned system field, so they vary as authored
 * without busting the cache.
 *
 * static  -> stays in the cached/pinned `system` field
 * varying -> moving tail (uncached, free to change per turn)
 */
import { describe, it, expect } from 'vitest';
import { isTurnVaryingSystemMessage } from '../turnVaryingClassifier.js';

describe('isTurnVaryingSystemMessage', () => {
  it('turnNumberModulo is turn-varying (genuinely periodic)', () => {
    expect(isTurnVaryingSystemMessage({ turnNumberModulo: { divisor: 10, remainder: 0 } })).toBe(true);
    expect(isTurnVaryingSystemMessage({ hasTools: true, turnNumberModulo: { divisor: 5, remainder: 2 } })).toBe(true);
  });

  it('a specific later turn (turnNumber > 0) is turn-varying', () => {
    expect(isTurnVaryingSystemMessage({ turnNumber: 5 })).toBe(true);
    expect(isTurnVaryingSystemMessage({ turnNumber: 1 })).toBe(true);
  });

  it('turnNumber:0 is static — the pin correctly keeps it cached every turn', () => {
    expect(isTurnVaryingSystemMessage({ turnNumber: 0 })).toBe(false);
    expect(isTurnVaryingSystemMessage({ turnNumber: 0, sessionPhase: 'start' })).toBe(false);
  });

  it('sessionPhase alone is static — content is stable, gating is coarse', () => {
    expect(isTurnVaryingSystemMessage({ sessionPhase: 'start' })).toBe(false);
    expect(isTurnVaryingSystemMessage({ sessionPhase: ['start', 'ongoing'] })).toBe(false);
  });

  it('no/empty conditions is static', () => {
    expect(isTurnVaryingSystemMessage(undefined)).toBe(false);
    expect(isTurnVaryingSystemMessage({})).toBe(false);
    expect(isTurnVaryingSystemMessage({ hasTools: true })).toBe(false);
    expect(isTurnVaryingSystemMessage({ modelCapabilities: ['reasoning'] })).toBe(false);
  });

  it('the registry buckets resolve as analyzed (11 static, 1 varying)', () => {
    // Bucket A — static, stays pinned
    expect(isTurnVaryingSystemMessage({ turnNumber: 0, sessionPhase: 'start' })).toBe(false); // system_prompt
    expect(isTurnVaryingSystemMessage({ hasTools: true, sessionPhase: ['start', 'ongoing'] })).toBe(false); // tool_usage_guide
    expect(isTurnVaryingSystemMessage({ hasTools: true, turnNumber: 0 })).toBe(false); // tool_examples
    expect(isTurnVaryingSystemMessage({ turnNumber: 0 })).toBe(false); // cortex / claude_md / memory
    // Bucket B — varying, routed to moving tail
    expect(isTurnVaryingSystemMessage({ hasTools: true, turnNumberModulo: { divisor: 10, remainder: 0 } })).toBe(true); // periodic_reminder
  });
});
