/**
 * The provider catalog for the secrets vault UI — the Nexus Terminal SPA's own catalog (spaSecretTypes.ts, synced from
 * nexus-terminal/services/secrets/types.ts), plus the helpers the /secrets dialogs need: provider auto-detect from a pasted key (the
 * SPA's keyPatterns), a suggested env-style name (the SPA's PROVIDER_TYPE convention), the icon.
 */
import { PROVIDER_CONFIGS, type KnownProvider, type ProviderConfig, type SecretType } from './spaSecretTypes.js';

export type { KnownProvider, ProviderConfig, SecretType };
export const SECRET_PROVIDERS: ProviderConfig[] = Object.values(PROVIDER_CONFIGS);

/** The provider a pasted value most likely belongs to (first keyPattern match), or null. */
export function detectProvider(value: string): ProviderConfig | null {
  const v = value.trim();
  for (const p of SECRET_PROVIDERS) if (p.keyPatterns?.some((re) => re.test(v))) return p;
  return null;
}

/** DEEPSEEK_API_KEY-style name for a provider + secret type (the SPA stores keys as PROVIDER_TYPE). */
export function suggestSecretName(provider: string, type: SecretType | string = 'api-key'): string {
  return `${provider}_${type}`.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** The provider a stored name belongs to, by its prefix (GITHUB_TOKEN → github). */
export function providerForName(name: string): ProviderConfig | null {
  const n = name.toLowerCase();
  return SECRET_PROVIDERS.find((p) => p.id !== 'custom' && (n.startsWith(`${p.id.replace(/-/g, '_')}_`) || n === p.id)) ?? null;
}

export const providerIcon = (id?: string | null): string => (id && (PROVIDER_CONFIGS as Record<string, ProviderConfig>)[id]?.icon) || '🔑';
