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
 * `createProxyFetch` pattern (which routes through the deployment's AI proxy host).
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

/**
 * User-Agent forced onto every request we rewrite to the proxy. Provider SDKs
 * (notably the OpenAI SDK, used for DeepSeek + all OpenAI-compatible providers)
 * send a bot-flagged UA — e.g. `OpenAI/JS` — which Cloudflare's Bot Fight Mode /
 * "Block AI bots" on the proxy's OWN zone rejects with 403 "Your request was
 * blocked" before the proxy Worker even runs. The ai-proxy is our own
 * infrastructure and does not care about the client UA, so we overwrite it with a
 * benign identifier. This makes harness→proxy traffic immune to the proxy zone's
 * AI-bot filtering regardless of its (auto-updating) managed-bot ruleset — a fix
 * that needs no Cloudflare config change and survives future rule updates.
 */
const PROXY_USER_AGENT = 'nexus-cortex-proxy/1.0';

/** Clone the caller's headers (from an init object or a Request) and force our
 *  benign User-Agent, so the proxied request never carries the SDK's bot signature. */
function proxyHeaders(source?: any): Headers {
  const h = new Headers(source ?? undefined);
  h.set('User-Agent', PROXY_USER_AGENT);
  return h;
}

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
/**
 * Streaming header deadline (2026-11-03). A STREAMING provider request answers with headers at once and then streams; one that has not
 * sent headers after CORTEX_STREAM_HEADER_TIMEOUT_MS (default 120 s; 0 = off) is dead. A DeepSeek browse delegate's request sat with no
 * response for ~8 min until the delegate's 10-min limit (the client's total timeout derives from max_tokens: 393,216 × 20 ms ≈ 131 min).
 * Aborting that attempt lets the SDK's own retry send it again. Non-streaming requests are untouched (a long thinking turn legitimately
 * returns headers only when it is done); once headers arrive the timer is cleared and the body streams as before.
 */
export function streamHeaderTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.CORTEX_STREAM_HEADER_TIMEOUT_MS ?? '').trim();
  if (raw === '') return 120_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 120_000;
}
function isStreamingBody(body: unknown): boolean {
  return typeof body === 'string' && /"stream"\s*:\s*true/.test(body);
}
export const cortexProxyFetch: typeof fetch = ((input: any, init?: any): Promise<Response> => {
  const ms = streamHeaderTimeoutMs();
  if (!(ms > 0) || !isStreamingBody(init?.body)) return proxyFetchCore(input, init);
  const ctl = new AbortController();
  const outer: AbortSignal | undefined = init?.signal ?? undefined;
  if (outer) { if (outer.aborted) ctl.abort(outer.reason); else outer.addEventListener('abort', () => ctl.abort(outer.reason), { once: true }); }
  const timer = setTimeout(() => ctl.abort(new Error(`no response headers after ${Math.round(ms / 1000)} s (CORTEX_STREAM_HEADER_TIMEOUT_MS)`)), ms);
  return proxyFetchCore(input, { ...(init || {}), signal: ctl.signal }).finally(() => clearTimeout(timer));
}) as typeof fetch;

const proxyFetchCore: typeof fetch = ((input: any, init?: any): Promise<Response> => {
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
          // Override the SDK's bot UA (headers live on the Request) via the fetch init.
          return orig(new Request(proxied, input), { ...(init || {}), headers: proxyHeaders((input as Request).headers) });
        }
        return orig(proxied, { ...(init || {}), headers: proxyHeaders(init && init.headers) });
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
          // Preserve method/headers/body when the caller passed a Request object,
          // but force our benign UA so the proxy zone's bot rules don't block us.
          if (typeof Request !== 'undefined' && input instanceof Request) {
            return orig(new Request(proxied, input), { ...(init || {}), headers: proxyHeaders((input as Request).headers) });
          }
          return orig(proxied, { ...(init || {}), headers: proxyHeaders(init && init.headers) });
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
