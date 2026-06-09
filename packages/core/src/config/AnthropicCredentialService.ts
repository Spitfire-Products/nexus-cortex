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
 */
export interface AnthropicCredential {
  type: 'oauth' | 'api-key';
  token: string;
  source: 'claude-credentials-file' | 'env-oauth' | 'env-api-key';
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
  ) {
    super(message);
    this.name = 'CredentialError';
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
      // Fall back to API key
      return this.loadApiKey();
    }
  }

  /**
   * Load OAuth credential from available sources
   */
  private loadOAuthCredential(): AnthropicCredential {
    // Source 1: ~/.claude/.credentials.json
    const fileCredentials = this.loadOAuthFromFile();
    if (fileCredentials) {
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
   * Load API key from environment
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

    throw new CredentialError(
      'No Anthropic credentials found. Set ANTHROPIC_API_KEY environment variable, ' +
        'or run `claude login` to use your Claude.ai Max subscription.',
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
