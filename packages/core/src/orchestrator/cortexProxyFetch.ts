/**
 * Cortex proxy-fetch installer.
 *
 * When `CORTEX_PROXY_BASE_URL` is set (e.g. inside the nexus-autoresearch sandbox
 * container for a USER-FUNDED job), route ALL outbound AI-provider HTTP through
 * that proxy using its `?url=<target>` contract — so the container never holds a
 * raw provider key. The provider API key (which, for user-funded jobs, is a
 * short-lived per-job proxy token) is forwarded opaquely in the request headers
 * and resolved to the user's real key at the proxy.
 *
 * INERT unless the env var is set — zero behavior change otherwise. Covers every
 * provider SDK (Anthropic, OpenAI, Google) AND the raw `fetch` paths, because
 * they all dispatch through `globalThis.fetch`. Mirrors the browser CORTEX
 * `createProxyFetch` pattern (which routes through ai.spitfire-products.com).
 *
 * This module self-installs on import; import it FIRST (before the provider SDKs)
 * so the wrapper is in place before any SDK captures `globalThis.fetch`.
 */

// AI-provider hostnames whose calls get rewritten to the proxy. Everything else
// (git, npm, the proxy itself, telemetry) passes through untouched.
const AI_PROVIDER_HOSTS = new Set<string>([
  'api.anthropic.com',
  'api.openai.com',
  'api.deepseek.com',
  'api.x.ai',
  'generativelanguage.googleapis.com',
  'api.groq.com',
  'api.mistral.ai',
]);

let installed = false;

/**
 * Standalone, call-time proxy-aware fetch. Reads `CORTEX_PROXY_BASE_URL` on EVERY call (not at
 * install time) and rewrites AI-provider URLs to the proxy `?url=` contract; passes everything
 * else through untouched, and is a plain fetch when the env var is unset.
 *
 * Pass this EXPLICITLY as the `fetch` option to every provider SDK client
 * (`new OpenAI({ fetch: cortexProxyFetch })`, `new Anthropic({ fetch: cortexProxyFetch })`, …).
 * That makes proxy routing DETERMINISTIC per-client — independent of `globalThis.fetch` patch
 * timing and of any SDK that snapshots the original `fetch` at construction. This is the fix for
 * the confirmed bug where the DeepSeek OpenAI-SDK client sent the raw job token to api.deepseek.com
 * because the global patch didn't apply to its calls.
 */
export const cortexProxyFetch: typeof fetch = ((input: any, init?: any): Promise<Response> => {
  const orig = globalThis.fetch;
  const raw = process.env.CORTEX_PROXY_BASE_URL;
  if (!raw || !raw.trim()) return orig(input, init);
  const base = raw.trim().replace(/\/+$/, '');
  let url: string | null = null;
  try {
    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.href;
    else if (typeof Request !== 'undefined' && input instanceof Request) url = input.url;
    else if (input && typeof input.url === 'string') url = input.url;
  } catch { url = null; }
  if (url) {
    try {
      if (AI_PROVIDER_HOSTS.has(new URL(url).hostname)) {
        const proxied = `${base}/?url=${encodeURIComponent(url)}`;
        if (typeof Request !== 'undefined' && input instanceof Request) {
          return orig(new Request(proxied, input), init);
        }
        return orig(proxied, init);
      }
    } catch { /* not absolute — pass through */ }
  }
  return orig(input, init);
}) as typeof fetch;

export function installCortexProxyFetch(): void {
  if (installed) return;
  const raw = process.env.CORTEX_PROXY_BASE_URL;
  if (!raw || !raw.trim()) return;
  const orig = globalThis.fetch;
  if (typeof orig !== 'function') return;

  const base = raw.trim().replace(/\/+$/, '');
  installed = true;

  const wrapped = ((input: any, init?: any): Promise<Response> => {
    let url: string | null = null;
    try {
      if (typeof input === 'string') url = input;
      else if (input instanceof URL) url = input.href;
      else if (typeof Request !== 'undefined' && input instanceof Request) url = input.url;
      else if (input && typeof input.url === 'string') url = input.url;
    } catch {
      url = null;
    }

    if (url) {
      try {
        if (AI_PROVIDER_HOSTS.has(new URL(url).hostname)) {
          const proxied = `${base}/?url=${encodeURIComponent(url)}`;
          // Preserve method/headers/body when the caller passed a Request object.
          if (typeof Request !== 'undefined' && input instanceof Request) {
            return orig(new Request(proxied, input), init);
          }
          return orig(proxied, init);
        }
      } catch {
        // not a parseable absolute URL — fall through to the original call
      }
    }
    return orig(input, init);
  }) as typeof fetch;

  globalThis.fetch = wrapped;
  if (process.env.DEBUG === 'true') {
    console.log(`[cortexProxyFetch] AI-provider calls routed through ${base}/?url=`);
  }
}

// Self-install on import (gated + idempotent).
installCortexProxyFetch();
