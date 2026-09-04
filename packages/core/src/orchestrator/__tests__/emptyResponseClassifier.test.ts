/**
 * Typed empty-response classifier (grok-build sampler port). Pins the
 * reasoning_only vs no_visible_content vs not_empty distinction and the
 * kind-tailored nudge.
 */

import { describe, it, expect } from 'vitest';
import { classifyEmptyResponse, emptyResponseNudge, nudgeForbidsTools } from '../emptyResponseClassifier.js';

describe('classifyEmptyResponse', () => {
  it('not_empty when visible text is present', () => {
    const c = classifyEmptyResponse([{ type: 'text', text: 'here is the answer' }]);
    expect(c.kind).toBe('not_empty');
  });

  it('not_empty when an (unexecuted) tool_use is present', () => {
    const c = classifyEmptyResponse([{ type: 'tool_use', toolUse: { id: '1', name: 'Read', input: {} } }]);
    expect(c.kind).toBe('not_empty');
    expect(c.hadToolUse).toBe(true);
  });

  it('reasoning_only when thinking present but no text/tool', () => {
    const c = classifyEmptyResponse([{ type: 'thinking', thinking: 'let me work through this...' }]);
    expect(c.kind).toBe('reasoning_only');
    expect(c.hadReasoning).toBe(true);
  });

  it('reasoning_only for redacted_thinking too', () => {
    expect(classifyEmptyResponse([{ type: 'redacted_thinking', data: 'xxx' }]).kind).toBe('reasoning_only');
  });

  it('no_visible_content when nothing meaningful', () => {
    expect(classifyEmptyResponse([]).kind).toBe('no_visible_content');
    expect(classifyEmptyResponse([{ type: 'text', text: '   ' }]).kind).toBe('no_visible_content');
  });

  it('blank text alongside thinking is reasoning_only', () => {
    const c = classifyEmptyResponse([
      { type: 'thinking', thinking: 'reasoning' },
      { type: 'text', text: '' },
    ]);
    expect(c.kind).toBe('reasoning_only');
  });

  it('nudge is tailored per kind', () => {
    expect(emptyResponseNudge('reasoning_only').toLowerCase()).toContain('reasoning');
    expect(emptyResponseNudge('no_visible_content').toLowerCase()).toContain('no content');
  });

  // D-E (2026-09-04): max_tokens truncation must be distinguished from "done reasoning".
  it('D-E: reasoning cut off by max_tokens is truncated, not reasoning_only', () => {
    const c = classifyEmptyResponse([{ type: 'thinking', thinking: 'a very long unfinished thought...' }], 'max_tokens');
    expect(c.kind).toBe('truncated');
    expect(c.hadReasoning).toBe(true);
  });

  it('D-E: length/model_length/max_output_tokens also map to truncated (provider dialects)', () => {
    for (const sr of ['length', 'max_output_tokens', 'model_length', 'MAX_TOKENS']) {
      expect(classifyEmptyResponse([{ type: 'thinking', thinking: 'x' }], sr).kind).toBe('truncated');
    }
  });

  it('D-E: a normal stop reason (end_turn) still classifies reasoning_only', () => {
    expect(classifyEmptyResponse([{ type: 'thinking', thinking: 'x' }], 'end_turn').kind).toBe('reasoning_only');
    expect(classifyEmptyResponse([{ type: 'thinking', thinking: 'x' }]).kind).toBe('reasoning_only'); // no stopReason
  });

  it('D-E: visible text with max_tokens is still not_empty (partial answer is usable)', () => {
    expect(classifyEmptyResponse([{ type: 'text', text: 'partial answer' }], 'max_tokens').kind).toBe('not_empty');
  });

  it('D-E: the truncated nudge says continue and does NOT forbid tools', () => {
    expect(emptyResponseNudge('truncated').toLowerCase()).toContain('continue');
    expect(nudgeForbidsTools('truncated')).toBe(false);
    expect(nudgeForbidsTools('reasoning_only')).toBe(true);
  });
});
