/**
 * R217 CORTEX_HELPER_MATCH_PROVIDER — helper/mentor role resolution matrix.
 * Explicit env wins; a defaulted id maps from the ACTION provider; off = unchanged.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { matchHelperToActionProvider, isDefaultedRoleModel, resolveHelperMatchProviderFlag } from '../helperProviderMatch.js';
import { HelperModelMiddleware, HELPER_MODEL_REGISTRY } from '../../HelperModelMiddleware.js';

const R = HELPER_MODEL_REGISTRY;
const ON = { CORTEX_HELPER_MATCH_PROVIDER: 'on' };

describe('matchHelperToActionProvider (pure)', () => {
  it('flag parse', () => {
    for (const v of ['on', 'true', '1', ' On ']) expect(resolveHelperMatchProviderFlag({ CORTEX_HELPER_MATCH_PROVIDER: v })).toBe(true);
    for (const v of [undefined, '', 'off', 'false', '0', 'yes']) expect(resolveHelperMatchProviderFlag(v === undefined ? {} : { CORTEX_HELPER_MATCH_PROVIDER: v })).toBe(false);
  });

  it('off: the id passes through unchanged for every provider', () => {
    for (const p of ['anthropic', 'openai', 'google', 'xai', 'deepseek', undefined]) {
      for (const id of ['deepseek-flash', 'deepseek-v4-pro', 'claude-haiku-4-5']) {
        expect(matchHelperToActionProvider({ resolvedId: id, actionProvider: p, registry: R, env: {} })).toBe(id);
      }
    }
  });

  it('on + defaulted id: provider mapping; deepseek keeps deepseek-flash', () => {
    const exp: Record<string, string> = {
      anthropic: 'claude-haiku-4-5', openai: 'gpt-4.1-mini', google: 'gemini-2.5-flash-lite', xai: 'grok-4.3',
      deepseek: 'deepseek-flash', DeepSeek: 'deepseek-flash', ANTHROPIC: 'claude-haiku-4-5',
    };
    for (const [p, want] of Object.entries(exp)) {
      expect(matchHelperToActionProvider({ resolvedId: 'deepseek-flash', actionProvider: p, registry: R, env: ON })).toBe(want);
      expect(matchHelperToActionProvider({ resolvedId: '', actionProvider: p, registry: R, env: ON })).toBe(want);
    }
  });

  it('on + explicit id: explicit always wins', () => {
    for (const id of ['deepseek-v4-pro', 'gpt-4.1-mini', 'claude-haiku-4-5', 'local']) {
      for (const p of ['anthropic', 'openai', 'deepseek']) {
        expect(matchHelperToActionProvider({ resolvedId: id, actionProvider: p, registry: R, env: ON })).toBe(id);
      }
    }
  });

  it('on + unknown/unmapped provider: defaulted id unchanged', () => {
    for (const p of [undefined, '', 'zhipu', 'moonshot', 'hf-space']) {
      expect(matchHelperToActionProvider({ resolvedId: 'deepseek-flash', actionProvider: p, registry: R, env: ON })).toBe('deepseek-flash');
    }
  });

  it('a shipped default other than the code default also counts as defaulted', () => {
    expect(isDefaultedRoleModel('deepseek-v4-flash', ['deepseek-v4-flash'])).toBe(true);
    expect(isDefaultedRoleModel('deepseek-v4-flash', [])).toBe(false);
    expect(matchHelperToActionProvider({ resolvedId: 'deepseek-v4-flash', actionProvider: 'openai', registry: R, shippedDefaults: ['deepseek-v4-flash'], env: ON })).toBe('gpt-4.1-mini');
  });
});

describe('HelperModelMiddleware.resolveRoleModelId (wired)', () => {
  const prev = process.env.CORTEX_HELPER_MATCH_PROVIDER;
  beforeEach(() => { delete process.env.CORTEX_HELPER_MATCH_PROVIDER; });
  afterEach(() => { if (prev === undefined) delete process.env.CORTEX_HELPER_MATCH_PROVIDER; else process.env.CORTEX_HELPER_MATCH_PROVIDER = prev; });

  it('off: unchanged even with a resolver bound', () => {
    const mw = new HelperModelMiddleware();
    mw.setActionProviderResolver(() => 'anthropic');
    expect(mw.resolveRoleModelId('deepseek-flash')).toBe('deepseek-flash');
  });

  it('on: follows the LIVE action provider (model switch) and keeps explicit ids', () => {
    process.env.CORTEX_HELPER_MATCH_PROVIDER = 'on';
    const mw = new HelperModelMiddleware();
    let provider = 'anthropic';
    mw.setActionProviderResolver(() => provider);
    expect(mw.resolveRoleModelId('deepseek-flash')).toBe('claude-haiku-4-5');
    provider = 'openai';
    expect(mw.resolveRoleModelId('deepseek-flash')).toBe('gpt-4.1-mini');
    provider = 'deepseek';
    expect(mw.resolveRoleModelId('deepseek-flash')).toBe('deepseek-flash');
    provider = 'anthropic';
    expect(mw.resolveRoleModelId('deepseek-v4-pro')).toBe('deepseek-v4-pro');
  });

  it('on: no resolver bound / resolver throws → unchanged', () => {
    process.env.CORTEX_HELPER_MATCH_PROVIDER = 'on';
    const mw = new HelperModelMiddleware();
    expect(mw.resolveRoleModelId('deepseek-flash')).toBe('deepseek-flash');
    mw.setActionProviderResolver(() => { throw new Error('no model'); });
    expect(mw.resolveRoleModelId('deepseek-flash')).toBe('deepseek-flash');
  });

  it('on: generateSessionTitle calls the provider-matched helper card', async () => {
    process.env.CORTEX_HELPER_MATCH_PROVIDER = 'on';
    const prevHelper = process.env.HELPER_MODEL_ID;
    delete process.env.HELPER_MODEL_ID;
    try {
      const mw = new HelperModelMiddleware();
      mw.setActionProviderResolver(() => 'anthropic');
      const seen: string[] = [];
      (mw as any).getHelperModelConfig = (id: string) => { seen.push(id); return { id }; };
      (mw as any).helperAdapterRegistry = { getAdapterForModel: () => ({ generate: async () => 'A title' }) };
      (mw as any).generateTracked = async () => 'A title';
      await mw.generateSessionTitle('hello');
      expect(seen).toEqual(['claude-haiku-4-5']);
    } finally {
      if (prevHelper === undefined) delete process.env.HELPER_MODEL_ID; else process.env.HELPER_MODEL_ID = prevHelper;
    }
  });
});
