import { describe, it, expect } from 'vitest';
import { providerChoices, suggestRoles, webChoices, planToEnv, summaryLines, isOfferable } from '../setupPlan.js';
import { ModularModelRegistry } from '../../models/registry/ModularModelRegistry.js';

const cards = new ModularModelRegistry().getAllModels();

describe('cortex setup plan (pure)', () => {
  it('providers come from the registry, DeepSeek first, each with its key env and offerable cards', () => {
    const p = providerChoices(cards);
    expect(p[0]!.provider).toBe('deepseek');
    expect(p[0]!.keyEnv).toBe('DEEPSEEK_API_KEY');
    expect(p[0]!.models.some((m) => m.id === 'deepseek-flash')).toBe(true);
    expect(p[0]!.models.some((m) => m.id === 'deepseek-v4-flash')).toBe(false); // RETIRED alias not offered
    for (const row of p) expect(row.models.length).toBeGreaterThan(0);
  });
  it('retired / expired / beta cards are never offered', () => {
    expect(isOfferable({ id: 'x', provider: 'p', displayName: 'Foo (RETIRED alias → bar)' } as any)).toBe(false);
    expect(isOfferable({ id: 'x', provider: 'p', displayName: 'Foo (beta, exp 0910)' } as any)).toBe(false);
    expect(isOfferable({ id: 'x', provider: 'p', displayName: 'Foo' } as any)).toBe(true);
  });
  it('DeepSeek-only install: action = shipped default, helper = cheapest DeepSeek card, mentor = V4 Pro, vision = flash', () => {
    const p = providerChoices(cards).filter((r) => r.provider === 'deepseek');
    const r = suggestRoles(p)!;
    expect(r.action).toBe('deepseek-flash');
    expect(r.helper).toBe('deepseek-flash');
    expect(r.mentor).toBe('deepseek-v4-pro');
    expect(r.vision).toBe('deepseek-flash');
  });
  it('a provider without the shipped default still gets a full role set from its own cards', () => {
    const p = providerChoices(cards).filter((r) => r.provider === 'anthropic');
    const r = suggestRoles(p);
    expect(r).not.toBeNull();
    expect(p[0]!.models.map((m) => m.id)).toContain(r!.action);
    expect(p[0]!.models.map((m) => m.id)).toContain(r!.helper);
  });
  it('web choices follow the keys present; keyless = fetch-only auto', () => {
    expect(webChoices(new Set()).map((c) => c.value)).toEqual(['']);
    const w = webChoices(new Set(['ANTHROPIC_API_KEY', 'XAI_API_KEY'])).map((c) => c.value);
    expect(w).toEqual(['claude-haiku-4-5', 'grok-4-fast-non-reasoning', '']);
  });
  it('planToEnv writes keys + every role lever + web mode auto; blank keys are dropped', () => {
    const env = planToEnv({ keys: { DEEPSEEK_API_KEY: ' sk-1 ', OPENAI_API_KEY: '' }, action: 'deepseek-flash', helper: 'deepseek-flash', mentor: 'deepseek-v4-pro', vision: 'deepseek-flash', webToolsModel: '' });
    expect(env).toEqual({ DEEPSEEK_API_KEY: 'sk-1', DEFAULT_MODEL_ID: 'deepseek-flash', HELPER_MODEL_ID: 'deepseek-flash', MENTORSHIP_HELPER_MODEL: 'deepseek-v4-pro', VISION_HELPER_MODEL: 'deepseek-flash', WEB_TOOLS_MODEL: '', ENABLE_WEBTOOLS: 'auto' });
    const lines = summaryLines({ keys: { DEEPSEEK_API_KEY: 'x' }, action: 'deepseek-flash', helper: 'deepseek-flash', mentor: 'deepseek-v4-pro', vision: null, webToolsModel: '' }, () => undefined);
    expect(lines[0]).toContain('DEEPSEEK_API_KEY');
    expect(lines[4]).toContain('(none)');
  });
});
