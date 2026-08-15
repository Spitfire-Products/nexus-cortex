/**
 * P0 compliance: subscription-token prefix gate.
 *
 * Anthropic subscription OAuth tokens (`sk-ant-oat01-…`, minted by Claude Code
 * `/login` / `claude setup-token`) are ToS-restricted to Claude Code / claude.ai.
 * The harness must REFUSE to put one on a raw Messages call unless the operator
 * has the Anthropic-approval flag `CORTEX_SUBSCRIPTION_AUTH_APPROVED` set.
 *
 * Run scoped:
 *   timeout 180 npx vitest run src/config/__tests__/subscription-token-gate.test.ts --no-coverage
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SUBSCRIPTION_TOKEN_PREFIX,
  isSubscriptionToken,
  isSubscriptionAuthApproved,
  assertSubscriptionTokenAllowed,
  AnthropicCredentialService,
  CredentialError,
} from '../AnthropicCredentialService.js';

// Fixture suffixes kept <24 chars so the deploy-script secret scan
// (sk-ant-[A-Za-z0-9_-]{24,}) never flags them as real keys.
const OAT = 'sk-ant-oat01-FAKE-TOKEN';
const PLATFORM_BEARER = 'sk-ant-oap-FAKE-OAUTH'; // platform-OAuth style bearer (NOT oat01)
const API_KEY = 'sk-ant-api03-FAKE-KEY';

describe('isSubscriptionToken (pure)', () => {
  it('matches the sk-ant-oat01 prefix only', () => {
    expect(SUBSCRIPTION_TOKEN_PREFIX).toBe('sk-ant-oat01');
    expect(isSubscriptionToken(OAT)).toBe(true);
    expect(isSubscriptionToken(API_KEY)).toBe(false);
    expect(isSubscriptionToken(PLATFORM_BEARER)).toBe(false);
    expect(isSubscriptionToken('')).toBe(false);
    expect(isSubscriptionToken(undefined)).toBe(false);
  });
});

describe('isSubscriptionAuthApproved (pure)', () => {
  it('is false by default and only true for 1/true', () => {
    expect(isSubscriptionAuthApproved({})).toBe(false);
    expect(isSubscriptionAuthApproved({ CORTEX_SUBSCRIPTION_AUTH_APPROVED: '0' })).toBe(false);
    expect(isSubscriptionAuthApproved({ CORTEX_SUBSCRIPTION_AUTH_APPROVED: 'yes' })).toBe(false);
    expect(isSubscriptionAuthApproved({ CORTEX_SUBSCRIPTION_AUTH_APPROVED: '1' })).toBe(true);
    expect(isSubscriptionAuthApproved({ CORTEX_SUBSCRIPTION_AUTH_APPROVED: 'true' })).toBe(true);
    expect(isSubscriptionAuthApproved({ CORTEX_SUBSCRIPTION_AUTH_APPROVED: 'TRUE' })).toBe(true);
  });
});

describe('assertSubscriptionTokenAllowed (pure)', () => {
  it('throws SUBSCRIPTION_TOKEN_BLOCKED for an unapproved oat01 token', () => {
    try {
      assertSubscriptionTokenAllowed(OAT, {});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CredentialError);
      expect((err as CredentialError).code).toBe('SUBSCRIPTION_TOKEN_BLOCKED');
      expect((err as CredentialError).message).toMatch(/Claude Code/i);
    }
  });

  it('allows an oat01 token when the approval flag is set', () => {
    expect(() =>
      assertSubscriptionTokenAllowed(OAT, { CORTEX_SUBSCRIPTION_AUTH_APPROVED: '1' })
    ).not.toThrow();
  });

  it('never blocks non-subscription tokens (API keys, platform bearers)', () => {
    expect(() => assertSubscriptionTokenAllowed(API_KEY, {})).not.toThrow();
    expect(() => assertSubscriptionTokenAllowed(PLATFORM_BEARER, {})).not.toThrow();
  });
});

describe('AnthropicCredentialService gate integration', () => {
  const service = AnthropicCredentialService.getInstance();
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CORTEX_SUBSCRIPTION_AUTH_APPROVED',
    'ANTHROPIC_AUTH_METHOD',
  ];

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    // Neutralize the real ~/.claude/.credentials.json on this machine.
    vi.spyOn(service, 'getCredentialsPath').mockReturnValue('/nonexistent/.claude/.credentials.json');
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.restoreAllMocks();
  });

  it('blocks an env oat01 token on the oauth path (unapproved)', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = OAT;
    try {
      service.loadCredential('oauth');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as CredentialError).code).toBe('SUBSCRIPTION_TOKEN_BLOCKED');
    }
  });

  it('auto mode: gated oat01 token falls back to ANTHROPIC_API_KEY when present', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = OAT;
    process.env.ANTHROPIC_API_KEY = API_KEY;
    const cred = service.loadCredential('auto');
    expect(cred.type).toBe('api-key');
    expect(cred.token).toBe(API_KEY);
  });

  it('auto mode: gated oat01 token with NO api key surfaces the gate error (not a misleading NO_CREDENTIALS)', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = OAT;
    try {
      service.loadCredential('auto');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as CredentialError).code).toBe('SUBSCRIPTION_TOKEN_BLOCKED');
    }
  });

  it('approval flag opens the oauth path for oat01 tokens', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = OAT;
    process.env.CORTEX_SUBSCRIPTION_AUTH_APPROVED = '1';
    const cred = service.loadCredential('oauth');
    expect(cred.type).toBe('oauth');
    expect(cred.token).toBe(OAT);
  });

  it('platform-style bearer tokens in CLAUDE_CODE_OAUTH_TOKEN remain allowed (not oat01)', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = PLATFORM_BEARER;
    const cred = service.loadCredential('oauth');
    expect(cred.token).toBe(PLATFORM_BEARER);
  });

  it('ANTHROPIC_AUTH_TOKEN counts as a bearer credential on the api-key path', () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'gateway-bearer-token';
    const cred = service.loadCredential('auto');
    expect(cred.type).toBe('bearer');
    expect(cred.source).toBe('env-auth-token');
    expect(cred.token).toBe('gateway-bearer-token');
  });

  it('ANTHROPIC_API_KEY takes priority over ANTHROPIC_AUTH_TOKEN', () => {
    process.env.ANTHROPIC_API_KEY = API_KEY;
    process.env.ANTHROPIC_AUTH_TOKEN = 'gateway-bearer-token';
    const cred = service.loadCredential('api-key');
    expect(cred.type).toBe('api-key');
  });
});
