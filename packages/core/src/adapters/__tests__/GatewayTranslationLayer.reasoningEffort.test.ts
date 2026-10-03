import { describe, it, expect } from 'vitest';
import { translateReasoningEffort } from '../GatewayTranslationLayer.js';

// Accepted sets live-probed on /v1/responses 2026-10-03 (gpt-5.4-nano: low..xhigh, rejects minimal + max;
// gpt-5.6-luna: low..max, rejects minimal).
const nano = { id: 'gpt-5.4-nano', provider: 'openai' };
const luna = { id: 'gpt-5.6-luna', provider: 'openai' };

describe('translateReasoningEffort (gateway-owned effort vocabulary)', () => {
  it('passes accepted OpenAI levels through unchanged', () => {
    expect(translateReasoningEffort(nano, 'high')).toBe('high');
    expect(translateReasoningEffort(nano, 'xhigh')).toBe('xhigh');
    expect(translateReasoningEffort(luna, 'max')).toBe('max');
  });

  it('clamps a level the model rejects to the highest accepted level below it', () => {
    expect(translateReasoningEffort(nano, 'max')).toBe('xhigh');
    expect(translateReasoningEffort(nano, 'minimal')).toBe('none');
    expect(translateReasoningEffort({ id: 'gpt-5.5-pro', provider: 'openai' }, 'low')).toBe('medium');
  });

  it('keeps the old xhigh guard for OpenAI models with an unknown vocabulary', () => {
    expect(translateReasoningEffort({ id: 'gpt-5', provider: 'openai' }, 'xhigh')).toBe('high');
    expect(translateReasoningEffort({ id: 'gpt-5', provider: 'openai' }, 'max')).toBe('high');
  });

  it('sends nothing for empty or unknown values', () => {
    expect(translateReasoningEffort(nano, undefined)).toBeUndefined();
    expect(translateReasoningEffort(nano, '')).toBeUndefined();
    expect(translateReasoningEffort(nano, 'turbo')).toBeUndefined();
  });

  it('leaves other providers untouched', () => {
    expect(translateReasoningEffort({ id: 'deepseek-flash', provider: 'deepseek' }, 'max')).toBe('max');
    expect(translateReasoningEffort({ id: 'grok-4.7', provider: 'xai' }, 'xhigh')).toBe('xhigh');
  });
});
