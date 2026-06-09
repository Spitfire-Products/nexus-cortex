/**
 * CredentialResolver Interface
 *
 * Abstracts API key and credential resolution for AI providers.
 * The orchestrator needs credentials to authenticate with provider APIs.
 *
 * Node.js impl: wraps AnthropicCredentialService (reads files, env vars, OAuth tokens)
 * Browser impl: wraps SecretsService (reads from encrypted storage / user input)
 *
 * @module interfaces/CredentialResolver
 */

/**
 * Authentication method preference.
 *
 * - 'oauth': Prefer OAuth token (e.g., OAuth token flow)
 * - 'api-key': Use API key from environment or secrets
 * - 'auto': Try OAuth first, fall back to API key
 */
export type AuthMethod = 'oauth' | 'api-key' | 'auto';

/**
 * Resolved credential — the result of credential lookup.
 */
export interface CredentialResult {
  /** How the credential authenticates */
  type: 'oauth' | 'api-key';
  /** The credential value (API key or OAuth token) */
  token: string;
  /** Where the credential was found (for debugging) */
  source: string;
  /** Expiration timestamp in ms (for OAuth tokens that expire) */
  expiresAt?: number;
}

/**
 * Credential Resolver — API key / token resolution abstraction.
 *
 * Resolves credentials for AI providers. Each implementation handles
 * its own storage mechanism (env vars, files, encrypted stores, etc.).
 */
export interface CredentialResolver {
  /**
   * Load a credential for a provider.
   *
   * @param provider - Provider name (e.g., 'anthropic', 'openai', 'google', 'xai')
   * @param authMethod - Authentication method preference (default: 'auto')
   * @returns Resolved credential
   * @throws Error if no credential is available
   */
  loadCredential(provider: string, authMethod?: AuthMethod): Promise<CredentialResult>;

  /**
   * Check if a credential is available for a provider (without loading it).
   *
   * @param provider - Provider name
   * @returns true if a credential can be resolved
   */
  hasCredential(provider: string): Promise<boolean>;
}
