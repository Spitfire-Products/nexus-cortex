/**
 * WebFetch on the LOCAL browser (@nexus-cortex/browser, NEXUS_BROWSER_MODE=local and installed) — no outside web-tool provider
 * (operator 2026-11-02: "we are no longer reliant on an outside web tool provider"). FETCH only: a real Chrome renders the page
 * (JavaScript, bot walls). Search stays on the plain DuckDuckGo HTML page (measured better). Summarizing stays with the harness's helper model.
 *
 * Transport: the library's stdio MCP server, started ONCE per harness process on the first fetch (with its sandbox, so a walled page can
 * be retried on the real headful Chrome) and reached through the MCP protocol, so tool schemas and defaults apply exactly as for any MCP client. Calls are
 * serialized: one browser page serves one call at a time.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveBrowserBackend } from '@nexus-cortex/core';
import type { BackendResult } from './webBackends.js';

const MAX_FETCH_CHARS = 100_000;
const CALL_TIMEOUT_MS = 150_000;
let clientPromise: Promise<Client> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** The local browser is installed, ready, and chosen (NEXUS_BROWSER_MODE=local). */
export const localBrowserReady = (): boolean => resolveBrowserBackend().using === 'local';

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const b = resolveBrowserBackend();
      if (b.using !== 'local' || !b.serverJs) throw new Error(`local browser not available: ${b.reason}`);
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
      const transport = new StdioClientTransport({ command: process.execPath, args: [b.serverJs], env, stderr: 'ignore' });
      const client = new Client({ name: 'nexus-cortex-web-tools', version: '1' });
      await client.connect(transport);
      process.once('exit', () => { void client.close().catch(() => {}); });
      return client;
    })();
    clientPromise.catch(() => { clientPromise = null; });   // a failed start can be retried later
  }
  return clientPromise;
}

async function call(name: string, args: Record<string, unknown>): Promise<{ text: string; json: any; isError: boolean }> {
  const run = async () => {
    const c = await getClient();
    // The SDK's default request timeout is 60 s; a sandbox escalation with its captcha step can take longer (the library allows browse 240 s).
    const r: any = await c.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
    const text = (r?.content ?? []).map((p: any) => p?.text ?? '').join('');
    let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
    return { text, json, isError: !!r?.isError };
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

/** A bot wall / challenge page rather than the content (measured 2026-11-03: npm Cloudflare, Reddit network block, Zillow press-and-hold). */
export const CHALLENGE_TEXT = /performing security verification|verify(ing)? you are (a )?human|not a bot|blocked by network security|press (&|and) hold|just a moment\.\.\.|attention required|access denied|captcha|unusual traffic/i;

async function browse(url: string, backend?: 'sandbox'): Promise<{ walled: boolean }> {
  const r = await call('browse', { url, ...(backend ? { backend } : {}) });
  if (r.isError || r.json?.success === false) throw new Error(`browse failed: ${(r.json?.error ?? r.text).toString().slice(0, 200)}`);
  return { walled: !!r.json?._wall };
}

async function content(): Promise<string> {
  const r = await call('get_content', {});
  if (r.isError) throw new Error(`get_content failed: ${r.text.slice(0, 200)}`);
  return String(r.json?.content ?? r.json?.markdown ?? r.json?.text ?? r.text);
}

const looksWalled = (text: string) => text.length < 2000 && CHALLENGE_TEXT.test(text);

/**
 * NEXUS_BROWSER_PROXY_URL = http(s)://[user[:password]@]host:port — the user's own (residential) proxy for walled pages. The password
 * may be a vault reference («secret:NAME» or {{secret:NAME}}, URL-encoded or not): the browser library resolves it for secrets opted in
 * with `cortex secrets bind NAME NAME --tool nexus-browser`, so the value never sits in an env file.
 */
function proxyRule(url: string): Record<string, unknown> | null {
  const raw = process.env.NEXUS_BROWSER_PROXY_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = new URL(url).hostname;
    return { type: 'external', server: `${u.protocol}//${u.host}`, ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
      ...(u.password ? { password: decodeURIComponent(u.password) } : {}), domainPattern: host };
  } catch { return null; }
}

/** Fetch a page through the local browser: rendered, as markdown (get_content). */
export async function localBrowserFetch(url: string): Promise<BackendResult> {
  let walled = (await browse(url)).walled;
  let page = await content();
  let backend = 'local-browser';
  // Walled on the default backend → once more on the sandbox's real headful Chrome (stealthier; the library's auto-captcha runs there).
  if (walled || looksWalled(page)) {
    try { walled = (await browse(url, 'sandbox')).walled; page = await content(); backend = 'local-browser-sandbox'; } catch { /* keep the first result */ }
  }
  // Still walled → the user's OWN proxy, when configured (the local counterpart of the hosted residential-pool escalation; a datacenter
  // IP — VM, cloud repl — is what search engines and sites like Reddit block). Scoped to this site only.
  if ((walled || looksWalled(page)) && proxyRule(url)) {
    try {
      const set = await call('set_proxy', { rules: [proxyRule(url)!] });
      if (!set.isError && !(set.json?.errors?.length)) { walled = (await browse(url)).walled; page = await content(); backend = 'local-browser-proxy'; }
    } catch { /* keep the previous result */ }
    // Clear the rule AND end the session: the proxied Chrome must not carry over into the next fetch (2026-11-03: it did).
    finally { try { await call('set_proxy', { clear: true }); await call('close_session', {}); } catch { /* best effort */ } }
  }
  // Still a wall → fail, so WebFetch moves on rather than returning a challenge page as the content.
  if (walled || looksWalled(page)) throw new Error(`bot wall at ${url}: ${page.replace(/\s+/g, ' ').slice(0, 120)}`);
  const text = page.length > MAX_FETCH_CHARS ? page.slice(0, MAX_FETCH_CHARS) + '\n\n[Content truncated]' : page;
  return { text: `URL: ${url}\n\n${text}`, sources: [{ url }], backend };
}

// Search deliberately does NOT use the browser (measured 2026-11-03: search engines wall or mis-localize a headless browser; the plain
// DuckDuckGo HTML page in webBackends.ts beat it 7/8 vs ≤2/8). See .cortex/bench/r-web-tools-local-browser-2026-11-03.md.
