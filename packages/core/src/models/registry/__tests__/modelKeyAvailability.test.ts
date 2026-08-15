/**
 * P0 compliance: modelKeyAvailability OAuth/AUTH_TOKEN awareness.
 *
 * `hasApiKeyForModel` used to check ONLY `api.apiKeyEnvVar` (ANTHROPIC_API_KEY for
 * Claude cards) — an OAuth-only or ANTHROPIC_AUTH_TOKEN-only install failed the
 * check and Claude-pinned sub-agents were silently rerouted by
 * `modelWithKeyFallback`. Anthropic-provider cards must also count
 * ANTHROPIC_AUTH_TOKEN and a valid (non-gated) OAuth credential as availability.
 *
 * Run scoped:
 *   timeout 180 npx vitest run src/models/registry/__tests__/modelKeyAvailability.test.ts --no-coverage
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hasAnthropicAuth, hasApiKeyForModel, modelWithKeyFallback } from '../modelKeyAvailability.js';

describe('hasAnthropicAuth (pure)', () => {
  it('counts ANTHROPIC_API_KEY', () => {
    expect(hasAnthropicAuth({ ANTHROPIC_API_KEY: 'sk-ant-api03-x' }, () => false)).toBe(true);
  });
  it('counts ANTHROPIC_AUTH_TOKEN', () => {
    expect(hasAnthropicAuth({ ANTHROPIC_AUTH_TOKEN: 'gateway-bearer' }, () => false)).toBe(true);
  });
  it('counts a valid (non-gated) oauth credential', () => {
    expect(hasAnthropicAuth({}, () => true)).toBe(true);
  });
  it('false when nothing is available', () => {
    expect(hasAnthropicAuth({}, () => false)).toBe(false);
    expect(hasAnthropicAuth({ ANTHROPIC_API_KEY: '   ' }, () => false)).toBe(false);
  });
  it('a throwing oauth check reads as unavailable, not an error', () => {
    expect(hasAnthropicAuth({}, () => { throw new Error('gated'); })).toBe(false);
  });
});

describe('hasApiKeyForModel / modelWithKeyFallback (env-var behavior unchanged for other providers)', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ['DEEPSEEK_API_KEY'];

  beforeEach(() => {
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('non-anthropic model still requires its declared env var', () => {
    expect(hasApiKeyForModel('deepseek-chat')).toBe(false);
    process.env.DEEPSEEK_API_KEY = 'sk-x';
    expect(hasApiKeyForModel('deepseek-chat')).toBe(true);
  });

  it('unknown model stays permissive (no reroute)', () => {
    expect(hasApiKeyForModel('no-such-model-xyz')).toBe(true);
    expect(modelWithKeyFallback('no-such-model-xyz', 'deepseek-chat')).toBe('no-such-model-xyz');
  });

  it('missing key reroutes to the fallback', () => {
    expect(modelWithKeyFallback('deepseek-chat', 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });
});
