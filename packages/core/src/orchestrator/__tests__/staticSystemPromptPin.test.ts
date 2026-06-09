/**
 * regression: xAI cross-turn prompt-cache floor.
 *
 * The "static" system prompt is built from a turn-conditional system-message
 * loader. A large first-turn-only block (project context / onboarding,
 * measured ~56K chars) drops out by the next turn, so the provider `system`
 * field collapsed 68854 -> 12134 within ONE conversation. xAI prefix caching
 * requires a byte-identical `system` across turns; the collapse capped every
 * cross-turn request at the ~128-token floor.
 *
 * pinStaticSystemPrompt pins the first non-empty computed system prompt per
 * conversation and replays it byte-identically on every later turn, so the
 * cached prefix survives. Cross-harness bug class — nexus CORTEX has the same
 * turn-conditional injector.
 */
import { describe, it, expect } from 'vitest';
import { pinStaticSystemPrompt } from '../staticSystemPromptPin.js';

describe('pinStaticSystemPrompt', () => {
  it('pins the first non-empty value and replays it byte-identically as later turns shrink', () => {
    const store = new Map<string, string>();
    const big = 'X'.repeat(68854);
    const small = 'Y'.repeat(12134);

    const t1 = pinStaticSystemPrompt(store, 'conv-1', big);
    const t2 = pinStaticSystemPrompt(store, 'conv-1', big);
    const t3 = pinStaticSystemPrompt(store, 'conv-1', small); // loader dropped the 56K block

    expect(t1).toBe(big);
    expect(t2).toBe(big);
    expect(t3).toBe(big); // <- the fix: NOT `small`. byte-identical across turns.
    expect(t3).toHaveLength(68854);
  });

  it('keeps conversations independent', () => {
    const store = new Map<string, string>();
    const a = pinStaticSystemPrompt(store, 'conv-a', 'AAA');
    const b = pinStaticSystemPrompt(store, 'conv-b', 'BBB');
    expect(a).toBe('AAA');
    expect(b).toBe('BBB');
    expect(pinStaticSystemPrompt(store, 'conv-a', 'shrunk')).toBe('AAA');
    expect(pinStaticSystemPrompt(store, 'conv-b', 'shrunk')).toBe('BBB');
  });

  it('passes through unchanged when there is no conversation id (cannot memoize)', () => {
    const store = new Map<string, string>();
    expect(pinStaticSystemPrompt(store, '', 'first')).toBe('first');
    expect(pinStaticSystemPrompt(store, '', 'second')).toBe('second');
    expect(pinStaticSystemPrompt(store, undefined, 'third')).toBe('third');
    expect(store.size).toBe(0);
  });

  it('does not pin undefined/empty — a later turn establishes the baseline', () => {
    const store = new Map<string, string>();
    expect(pinStaticSystemPrompt(store, 'conv-x', undefined)).toBeUndefined();
    expect(pinStaticSystemPrompt(store, 'conv-x', '')).toBe('');
    // First DEFINED non-empty value becomes the pinned baseline.
    expect(pinStaticSystemPrompt(store, 'conv-x', 'BASELINE')).toBe('BASELINE');
    expect(pinStaticSystemPrompt(store, 'conv-x', 'changed')).toBe('BASELINE');
  });

  it('is idempotent for repeated identical turns', () => {
    const store = new Map<string, string>();
    const v = 'stable-system';
    for (let i = 0; i < 5; i++) {
      expect(pinStaticSystemPrompt(store, 'conv-r', v)).toBe(v);
    }
    expect(store.size).toBe(1);
  });
});
