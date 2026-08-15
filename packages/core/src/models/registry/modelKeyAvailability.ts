/**
 * Key-aware model fallback for sub-agent dispatch.
 *
 * A sub-agent (or the model router) can resolve to a model whose provider API key
 * isn't configured on this install — e.g. an agent profile pinned to `sonnet` on a
 * DeepSeek-only setup. Running it would fail with "API key not found". This lets the
 * resolver fall back to the orchestrator's model (which is necessarily usable — the
 * orchestrator is running) instead of failing.
 *
 * Deliberately permissive: if the model is unknown or has no declared key env var,
 * we DON'T reroute — only an explicit, known, missing key triggers the fallback.
 */
import { ModularModelRegistry } from './ModularModelRegistry.js';
import { anthropicCredentialService } from '../../config/AnthropicCredentialService.js';
import { logger } from '../../utils/logger.js';

let _registry: ModularModelRegistry | undefined;
function registry(): ModularModelRegistry {
  if (!_registry) _registry = new ModularModelRegistry();
  return _registry;
}

/**
 * Anthropic-aware availability (P0 fix): an install can be authorized for
 * Claude without ANTHROPIC_API_KEY — via a gateway bearer (ANTHROPIC_AUTH_TOKEN)
 * or a valid, non-gated OAuth credential (~/.claude/.credentials.json /
 * CLAUDE_CODE_OAUTH_TOKEN). Counting only the env var silently rerouted
 * Claude-pinned sub-agents on OAuth-only installs.
 *
 * `oauthAvailable` is injectable for tests; the default asks the credential
 * service, whose subscription-token compliance gate makes a blocked
 * `sk-ant-oat01` token read as UNavailable (correct — we won't send it).
 */
export function hasAnthropicAuth(
  env: NodeJS.ProcessEnv = process.env,
  oauthAvailable: () => boolean = () =>
    anthropicCredentialService.hasValidCredentials('oauth')
): boolean {
  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim()) return true;
  if (env.ANTHROPIC_AUTH_TOKEN && env.ANTHROPIC_AUTH_TOKEN.trim()) return true;
  try {
    return oauthAvailable();
  } catch {
    return false;
  }
}

/** True if the model's provider API key is present in the environment, or can't be determined. */
export function hasApiKeyForModel(modelId: string): boolean {
  try {
    const cfg = registry().getModel(modelId) as
      | { provider?: string; api?: { apiKeyEnvVar?: string } }
      | undefined;
    const envVar = cfg?.api?.apiKeyEnvVar;
    if (!envVar) return true; // no declared key requirement → assume usable
    const v = process.env[envVar];
    if (v && v.trim()) return true;
    // Anthropic cards accept OAuth / gateway-bearer credentials too — the env
    // var being empty doesn't mean the install can't run Claude.
    if (cfg?.provider === 'anthropic' || envVar === 'ANTHROPIC_API_KEY') {
      return hasAnthropicAuth();
    }
    return false;
  } catch {
    return true; // unknown model → let the downstream API call decide, don't silently reroute
  }
}

/**
 * Return `modelId` if its provider key is available; otherwise `fallback`.
 * No-op when `modelId` already equals `fallback` (or is empty).
 */
export function modelWithKeyFallback(modelId: string, fallback: string): string {
  if (!modelId || !fallback || modelId === fallback) return modelId;
  if (hasApiKeyForModel(modelId)) return modelId;
  logger.warn(
    `[SubAgent] model '${modelId}' has no API key configured on this install — ` +
    `falling back to the orchestrator model '${fallback}'. Set the provider key, or use the ` +
    `model router for key-aware selection.`,
  );
  return fallback;
}
