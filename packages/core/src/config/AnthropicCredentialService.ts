/**
 * AnthropicCredentialService
 *
 * Manages Anthropic API credentials with support for:
 * - Claude.ai Max OAuth tokens (from ~/.claude/.credentials.json)
 * - Environment variable OAuth tokens (CLAUDE_CODE_OAUTH_TOKEN)
 * - Traditional API keys (ANTHROPIC_API_KEY)
 *
 * Priority order (configurable via ANTHROPIC_AUTH_METHOD):
 * 1. ~/.claude/.credentials.json (OAuth)
 * 2. CLAUDE_CODE_OAUTH_TOKEN environment variable (OAuth)
 * 3. ANTHROPIC_API_KEY environment variable (API Key fallback)
 * 4. ANTHROPIC_AUTH_TOKEN environment variable (gateway bearer fallback)
 *
 * COMPLIANCE GATE (P0, see docs/AGENT_SDK_TRANSPORT_STRATEGY.md §0):
 * Anthropic SUBSCRIPTION OAuth tokens (`sk-ant-oat01-…`, minted by Claude Code
 * `/login` / `claude setup-token`) are ToS-restricted to Claude Code and
 * claude.ai — they may NOT be sent to /v1/messages by this harness. The loader
 * hard-blocks them by prefix unless the Anthropic-approval flag
 * `CORTEX_SUBSCRIPTION_AUTH_APPROVED=1` is set. Platform-OAuth bearers
 * (`ant auth login` profiles) and gateway bearers are NOT oat01-prefixed and
 * remain allowed — they are API-legal.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Claude.ai OAuth credentials structure (from .claude/.credentials.json)
 */
export interface ClaudeOAuthCredentials {
  accessToken: string; // sk-ant-oat01-...
  refreshToken: string; // sk-ant-ort01-...
  expiresAt: number; // Unix timestamp (ms)
  scopes: string[]; // ["user:inference"]
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
}

/**
 * Full credentials file structure
 */
interface CredentialsFile {
  claudeAiOauth?: ClaudeOAuthCredentials;
}

/**
 * Unified credential result
 *
 * type 'bearer' = a gateway bearer token (ANTHROPIC_AUTH_TOKEN) — sent as
 * `Authorization: Bearer` exactly like 'oauth', but it is not a Claude.ai
 * OAuth credential and carries no expiry.
 */
export interface AnthropicCredential {
  type: 'oauth' | 'api-key' | 'bearer';
  token: string;
  source: 'claude-credentials-file' | 'env-oauth' | 'env-api-key' | 'env-auth-token';
  expiresAt?: number;
}

/**
 * Authentication method preference
 */
export type AuthMethod = 'oauth' | 'api-key' | 'auto';

/**
 * Credential loading error with helpful message
 */
export class CredentialError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NO_CREDENTIALS'
      | 'EXPIRED_TOKEN'
      | 'INVALID_FILE'
      | 'FILE_NOT_FOUND'
      | 'SUBSCRIPTION_TOKEN_BLOCKED'
  ) {
    super(message);
    this.name = 'CredentialError';
  }
}

/**
 * Prefix identifying Anthropic SUBSCRIPTION OAuth access tokens (Claude Code
 * `/login` / `claude setup-token`). ToS-restricted to Claude Code / claude.ai.
 */
export const SUBSCRIPTION_TOKEN_PREFIX = 'sk-ant-oat01';

/** True iff the token is a Claude subscription OAuth token (`sk-ant-oat01-…`). */
export function isSubscriptionToken(token: string | undefined | null): boolean {
  return typeof token === 'string' && token.startsWith(SUBSCRIPTION_TOKEN_PREFIX);
}

/**
 * True iff the operator has set the Anthropic-approval flag
 * `CORTEX_SUBSCRIPTION_AUTH_APPROVED` to `1` or `true` (case-insensitive).
 * This flag must ONLY be set once Anthropic's third-party subscription-auth
 * approval has been granted (June-2026 program).
 */
export function isSubscriptionAuthApproved(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const v = (env.CORTEX_SUBSCRIPTION_AUTH_APPROVED || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * Compliance gate: throw if `token` is a subscription OAuth token and the
 * approval flag is not set. Non-subscription tokens (API keys, platform-OAuth
 * bearers, gateway bearers) always pass.
 */
export function assertSubscriptionTokenAllowed(
  token: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (isSubscriptionToken(token) && !isSubscriptionAuthApproved(env)) {
    throw new CredentialError(
      'Anthropic subscription OAuth tokens (sk-ant-oat01-…) are restricted by ' +
        'Anthropic\'s terms to Claude Code and claude.ai — this harness will not ' +
        'send one to the Messages API. Use an sk-ant API key (ANTHROPIC_API_KEY) ' +
        'or a gateway bearer (ANTHROPIC_AUTH_TOKEN) instead. Once Anthropic ' +
        'approval is granted, the Agent SDK transport can be enabled with ' +
        'CORTEX_SUBSCRIPTION_AUTH_APPROVED=1.',
      'SUBSCRIPTION_TOKEN_BLOCKED'
    );
  }
}

/**
 * Service for loading and managing Anthropic credentials
 */
export class AnthropicCredentialService {
  private static instance: AnthropicCredentialService;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): AnthropicCredentialService {
    if (!AnthropicCredentialService.instance) {
      AnthropicCredentialService.instance = new AnthropicCredentialService();
    }
    return AnthropicCredentialService.instance;
  }

  /**
   * Get the path to Claude credentials file
   * Default: ~/.claude/.credentials.json
   */
  getCredentialsPath(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, '.claude', '.credentials.json');
  }

  /**
   * Load OAuth credentials from ~/.claude/.credentials.json
   */
  private loadOAuthFromFile(): ClaudeOAuthCredentials | null {
    const credPath = this.getCredentialsPath();

    if (!fs.existsSync(credPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(credPath, 'utf-8');
      const parsed: CredentialsFile = JSON.parse(content);

      if (parsed.claudeAiOauth?.accessToken) {
        return parsed.claudeAiOauth;
      }

      return null;
    } catch (error) {
      // Invalid JSON or file read error
      return null;
    }
  }

  /**
   * Check if an OAuth token is expired
   * Returns true if expired, false if still valid
   */
  isTokenExpired(expiresAt: number | undefined): boolean {
    if (!expiresAt) {
      return false; // No expiry set, assume valid
    }

    // Add 5 minute buffer to avoid edge cases
    const bufferMs = 5 * 60 * 1000;
    return Date.now() > expiresAt - bufferMs;
  }

  /**
   * Check OAuth token expiry and throw if expired
   */
  checkOAuthExpiry(credential: AnthropicCredential): void {
    if (credential.type === 'oauth' && credential.expiresAt) {
      if (this.isTokenExpired(credential.expiresAt)) {
        const expiryDate = new Date(credential.expiresAt).toLocaleString();
        throw new CredentialError(
          `OAuth token expired on ${expiryDate}. Run \`claude login\` to refresh your credentials.`,
          'EXPIRED_TOKEN'
        );
      }
    }
  }

  /**
   * Load credentials based on auth method preference
   *
   * Priority (for 'auto' mode):
   * 1. ~/.claude/.credentials.json (OAuth)
   * 2. CLAUDE_CODE_OAUTH_TOKEN env var (OAuth)
   * 3. ANTHROPIC_API_KEY env var (API Key)
   *
   * @param authMethod - 'oauth', 'api-key', or 'auto' (default)
   * @returns AnthropicCredential or throws CredentialError
   */
  loadCredential(authMethod: AuthMethod = 'auto'): AnthropicCredential {
    // If explicitly requesting API key, skip OAuth sources
    if (authMethod === 'api-key') {
      return this.loadApiKey();
    }

    // If explicitly requesting OAuth, only check OAuth sources
    if (authMethod === 'oauth') {
      return this.loadOAuthCredential();
    }

    // Auto mode: try in priority order
    try {
      return this.loadOAuthCredential();
    } catch (error) {
      if (
        error instanceof CredentialError &&
        error.code === 'EXPIRED_TOKEN'
      ) {
        // Re-throw expired token errors - user needs to fix this
        throw error;
      }
      // Fall back to API key / gateway bearer. If that also fails and the OAuth
      // failure was the subscription-token compliance gate, surface the gate
      // error — it is the actionable one (a plain NO_CREDENTIALS would
      // misleadingly suggest `claude login`, which mints the very token class
      // the gate blocks).
      try {
        return this.loadApiKey();
      } catch (apiKeyError) {
        if (
          error instanceof CredentialError &&
          error.code === 'SUBSCRIPTION_TOKEN_BLOCKED'
        ) {
          throw error;
        }
        throw apiKeyError;
      }
    }
  }

  /**
   * Load OAuth credential from available sources
   */
  private loadOAuthCredential(): AnthropicCredential {
    // Source 1: ~/.claude/.credentials.json
    const fileCredentials = this.loadOAuthFromFile();
    if (fileCredentials) {
      // Compliance gate: subscription tokens (sk-ant-oat01-…) may not go to
      // the raw Messages path without Anthropic approval.
      assertSubscriptionTokenAllowed(fileCredentials.accessToken);

      const credential: AnthropicCredential = {
        type: 'oauth',
        token: fileCredentials.accessToken,
        source: 'claude-credentials-file',
        expiresAt: fileCredentials.expiresAt,
      };

      // Check if expired
      this.checkOAuthExpiry(credential);
      return credential;
    }

    // Source 2: CLAUDE_CODE_OAUTH_TOKEN environment variable
    const envOAuthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (envOAuthToken) {
      // Same compliance gate as the file source. Platform-OAuth bearers
      // (ant-auth profiles, non-oat01) pass through — they are API-legal.
      assertSubscriptionTokenAllowed(envOAuthToken);

      return {
        type: 'oauth',
        token: envOAuthToken,
        source: 'env-oauth',
        // No expiry info available from env var
      };
    }

    throw new CredentialError(
      'No OAuth credentials found. Run `claude login` to authenticate with your Claude.ai account, ' +
        'or set CLAUDE_CODE_OAUTH_TOKEN environment variable.',
      'NO_CREDENTIALS'
    );
  }

  /**
   * Load API key (or gateway bearer) from environment
   */
  private loadApiKey(): AnthropicCredential {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      return {
        type: 'api-key',
        token: apiKey,
        source: 'env-api-key',
      };
    }

    // Gateway bearer fallback: ANTHROPIC_AUTH_TOKEN is the SDK-standard bearer
    // env var (proxies/gateways). Sent as `Authorization: Bearer`.
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    if (authToken) {
      return {
        type: 'bearer',
        token: authToken,
        source: 'env-auth-token',
      };
    }

    throw new CredentialError(
      'No Anthropic credentials found. Set ANTHROPIC_API_KEY (or a gateway ' +
        'ANTHROPIC_AUTH_TOKEN) environment variable.',
      'NO_CREDENTIALS'
    );
  }

  /**
   * Get credential summary for logging (no sensitive data)
   */
  getCredentialSummary(credential: AnthropicCredential): string {
    const tokenPreview = credential.token.slice(0, 12) + '...';
    const expiryInfo = credential.expiresAt
      ? ` (expires: ${new Date(credential.expiresAt).toLocaleDateString()})`
      : '';

    return `[${credential.type}] from ${credential.source}${expiryInfo} - ${tokenPreview}`;
  }

  /**
   * Check if we have any valid credentials available
   */
  hasValidCredentials(authMethod: AuthMethod = 'auto'): boolean {
    try {
      this.loadCredential(authMethod);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get days until token expiry (for warnings)
   */
  getDaysUntilExpiry(credential: AnthropicCredential): number | null {
    if (!credential.expiresAt) {
      return null;
    }

    const msUntilExpiry = credential.expiresAt - Date.now();
    return Math.floor(msUntilExpiry / (1000 * 60 * 60 * 24));
  }
}

// Export singleton instance for convenience
export const anthropicCredentialService =
  AnthropicCredentialService.getInstance();
