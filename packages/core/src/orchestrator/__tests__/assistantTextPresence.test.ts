/**
 * regression: the tool loop could exit (MAX_CONSECUTIVE_ERRORS,
 * loop-detection, etc.) with the final assistant turn being a bare tool_use
 * and ZERO text — the orchestrator then returned content=[tool_use],
 * ansLen=0 (deepseek-chat produced no deliverable in the 6-surface
 * benchmark). The post-loop synthesis net uses this predicate to detect
 * "no visible text" regardless of WHY the loop ended; the original inline check is
 * de-duplicated onto it too.
 */
import { describe, it, expect } from 'vitest';
import {
  hasVisibleAssistantText,
  hasUnexecutedToolUse,
  shouldForceSynthesis,
} from '../assistantTextPresence.js';

describe('hasVisibleAssistantText', () => {
  it('true when a non-empty text block is present', () => {
    expect(hasVisibleAssistantText([{ type: 'text', text: 'the answer is 4' }])).toBe(true);
    expect(hasVisibleAssistantText([
      { type: 'tool_use', toolUse: { name: 'Read' } },
      { type: 'text', text: 'done' },
    ])).toBe(true);
  });

  it('false for a bare tool_use turn (the deepseek failure shape)', () => {
    expect(hasVisibleAssistantText([{ type: 'tool_use', toolUse: { name: 'Grep' } }])).toBe(false);
  });

  it('false for thinking-only / empty / whitespace-only text (historical bug shape)', () => {
    expect(hasVisibleAssistantText([{ type: 'thinking', thinking: 'hmm' }])).toBe(false);
    expect(hasVisibleAssistantText([{ type: 'text', text: '   \n\t ' }])).toBe(false);
    expect(hasVisibleAssistantText([{ type: 'text', text: '' }])).toBe(false);
    expect(hasVisibleAssistantText([])).toBe(false);
  });

  it('tolerates missing/odd content without throwing', () => {
    expect(hasVisibleAssistantText(undefined as any)).toBe(false);
    expect(hasVisibleAssistantText(null as any)).toBe(false);
    expect(hasVisibleAssistantText([{ type: 'text' }] as any)).toBe(false);
    expect(hasVisibleAssistantText([{ type: 'text', text: 123 }] as any)).toBe(false);
  });
});

describe('hasUnexecutedToolUse', () => {
  it('true when a tool_use block is present (interrupted mid-action)', () => {
    expect(hasUnexecutedToolUse([{ type: 'tool_use', toolUse: { name: 'Grep' } }])).toBe(true);
    expect(hasUnexecutedToolUse([{ type: 'text', text: 'Let me search...' }, { type: 'tool_use' }])).toBe(true);
  });
  it('false for a concluded turn (text/thinking only, no tool_use)', () => {
    expect(hasUnexecutedToolUse([{ type: 'text', text: 'the answer is 4' }])).toBe(false);
    expect(hasUnexecutedToolUse([{ type: 'thinking', thinking: 'hmm' }])).toBe(false);
    expect(hasUnexecutedToolUse([])).toBe(false);
    expect(hasUnexecutedToolUse(null as any)).toBe(false);
  });
});

describe('shouldForceSynthesis (force-synthesis trigger incl. the preamble edge case)', () => {
  it('fires on a bare tool_use turn (original no-text case)', () => {
    expect(shouldForceSynthesis([{ type: 'tool_use', toolUse: { name: 'Grep' } }], false)).toBe(true);
  });
  it('fires on SHORT PREAMBLE + tool_use (the edge case being fixed)', () => {
    // Previously this returned a preamble to the user instead of an answer:
    // visible text present, so the bare !hasVisibleAssistantText check missed it.
    const preambleThenTools = [
      { type: 'text', text: 'Let me grep for those settings.' },
      { type: 'tool_use', toolUse: { name: 'Grep' } },
    ];
    expect(shouldForceSynthesis(preambleThenTools, false)).toBe(true);
  });
  it('does NOT fire on a normal concluded answer (text, no tool_use)', () => {
    expect(shouldForceSynthesis([{ type: 'text', text: 'The value is 15.' }], false)).toBe(false);
  });
  it('does NOT fire if synthesis was already attempted (no infinite retry)', () => {
    expect(shouldForceSynthesis([{ type: 'tool_use' }], true)).toBe(false);
  });
});
