/**
 * Typed empty-response classifier (grok-build sampler port). Pins the
 * reasoning_only vs no_visible_content vs not_empty distinction and the
 * kind-tailored nudge.
 */

import { describe, it, expect } from 'vitest';
import { classifyEmptyResponse, emptyResponseNudge } from '../emptyResponseClassifier.js';

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
});
