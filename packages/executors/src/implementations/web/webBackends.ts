/**
 * Web Tool Backends — Multi-provider implementations for WebSearch / WebFetch.
 *
 * Resolution order (per call):
 *   1. Provider-native server-side web tool, selected by WEB_TOOLS_MODEL env var:
 *        - Anthropic Claude → Messages API + `web_search_20250305` server tool
 *        - XAI Grok        → Responses API + `web_search` server tool
 *        - Google Gemini   → GenerateContent + `googleSearch` grounding (default)
 *   2. DuckDuckGo HTML fallback (no API key required) — last resort when:
 *        - WEB_TOOLS_MODEL is unset, OR
 *        - the configured provider's API key is missing.
 *
 * Provider is inferred from the model ID prefix; this matches the
 * AdapterRegistry's pattern detection. nexus-browser is intentionally NOT a
 * backend here — it is exposed via MCP only, with auth gating at the protocol
 * layer (see nexus-cortex OSS / nexus-browser monetization boundary).
 */

import { convert as htmlToText } from 'html-to-text';

export type WebProvider = 'anthropic' | 'xai' | 'openai' | 'google' | 'deepseek' | 'fallback';

export interface BackendResult {
  /** Combined text body */
  text: string;
  /** Source links for citation */
  sources: Array<{ title?: string; url: string }>;
  /** Which backend produced this */
  backend: string;
}

/** Resolve which provider serves a given model ID. */
export function resolveProvider(modelId: string | undefined): WebProvider {
  if (!modelId) return 'fallback';
  const id = modelId.toLowerCase();
  if (id.startsWith('claude-') || id.startsWith('claude_')) return 'anthropic';
  if (id.startsWith('grok-') || id.startsWith('grok_')) return 'xai';
  if (id.startsWith('gemini-') || id.startsWith('gemma-')) return 'google';
  if (id.startsWith('deepseek')) return 'deepseek';
  if (
    id.startsWith('gpt-') ||
    id.startsWith('o1-') || id === 'o1' || id === 'o1-pro' ||
    id.startsWith('o3-') || id === 'o3' || id === 'o3-pro' ||
    id.startsWith('o4-') || id === 'o4-mini'
  ) {
    return 'openai';
  }
  return 'fallback';
}

/** Resolve and return env API key for a provider; null if missing. */
function getApiKey(provider: WebProvider): string | null {
  switch (provider) {
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY ?? null;
    case 'xai':
      return process.env.XAI_API_KEY ?? null;
    case 'openai':
      return process.env.OPENAI_API_KEY ?? null;
    case 'google':
      return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? null;
    case 'deepseek':
      return process.env.DEEPSEEK_API_KEY ?? null;
    default:
      return null;
  }
}

// ── Anthropic backend ─────────────────────────────────────────────────────────

async function anthropicCall(
  modelId: string,
  apiKey: string,
  userMessage: string,
  maxTokens: number,
): Promise<{ text: string; sources: Array<{ title?: string; url: string }> }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const textParts: string[] = [];
  const sources: Array<{ title?: string; url: string }> = [];

  for (const block of data.content ?? []) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const item of block.content) {
        if (item.type === 'web_search_result' && item.url) {
          sources.push({ title: item.title, url: item.url });
        }
      }
    }
  }

  return { text: textParts.join('\n\n'), sources };
}

export async function anthropicSearch(query: string, modelId: string): Promise<BackendResult> {
  const apiKey = getApiKey('anthropic');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { text, sources } = await anthropicCall(
    modelId,
    apiKey,
    `Search the web for: ${query}\n\nReturn a comprehensive, factual summary citing your sources.`,
    16000,
  );
  return { text, sources, backend: 'anthropic-web_search' };
}

export async function anthropicFetch(prompt: string, modelId: string): Promise<BackendResult> {
  const apiKey = getApiKey('anthropic');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { text, sources } = await anthropicCall(
    modelId,
    apiKey,
    `Fetch and process the URL(s) in the following prompt. Preserve structure (headings, lists, paragraphs).\n\n${prompt}`,
    32000,
  );
  return { text, sources, backend: 'anthropic-web_search' };
}

// ── XAI backend (Responses API) ───────────────────────────────────────────────

async function xaiCall(
  modelId: string,
  apiKey: string,
  input: string,
  maxOutputTokens: number,
): Promise<{ text: string; sources: Array<{ title?: string; url: string }> }> {
  const res = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      tools: [{ type: 'web_search' }],
      input,
      temperature: 0.3,
      max_output_tokens: maxOutputTokens,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`XAI ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const textParts: string[] = [];
  const sources: Array<{ title?: string; url: string }> = [];

  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === 'output_text' || part.type === 'text') {
            textParts.push(part.text);
            for (const ann of part.annotations ?? []) {
              if (ann.type === 'url_citation' && ann.url) {
                sources.push({ title: ann.title, url: ann.url });
              }
            }
          }
        }
      }
    }
  }
  if (textParts.length === 0 && typeof data.output_text === 'string') {
    textParts.push(data.output_text);
  }

  // Deduplicate by URL — XAI repeats annotations per citation position.
  const seen = new Set<string>();
  const uniqueSources = sources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });

  return { text: textParts.join('\n\n'), sources: uniqueSources };
}

export async function xaiSearch(query: string, modelId: string): Promise<BackendResult> {
  const apiKey = getApiKey('xai');
  if (!apiKey) throw new Error('XAI_API_KEY not set');

  const { text, sources } = await xaiCall(
    modelId,
    apiKey,
    `Search the web comprehensively for: ${query}\n\nReturn detailed, factual results with sources.`,
    16000,
  );
  return { text, sources, backend: 'xai-web_search' };
}

export async function xaiFetch(prompt: string, modelId: string): Promise<BackendResult> {
  const apiKey = getApiKey('xai');
  if (!apiKey) throw new Error('XAI_API_KEY not set');

  const { text, sources } = await xaiCall(
    modelId,
    apiKey,
    `Read and extract content from the URL(s) in the following prompt. Preserve structure.\n\n${prompt}`,
    32000,
  );
  return { text, sources, backend: 'xai-web_search' };
}

// ── DeepSeek backend (Search / Fetch API, 2026-10-18) ─────────────────────────
// api-docs.deepseek.com/guides/search: POST /v1/tools/search {query ≤128 chars, count 1–50, need_content} → {results[]: rerank_score,
// title, url, snippet, summary, content, site_name, date, authority}; POST /v1/tools/fetch {url} → {title, content (Markdown)}.
// Billed per SUCCESSFUL request ($0.75 / 1,000; free through the DeepSeek harness until 2026-11-01), 5 QPS per account. No model in the
// loop: the backend returns the engine's own summaries / the page's Markdown and the calling model reads them. This is what makes a
// single-key DeepSeek install a real web-tools provider (it had only the DuckDuckGo HTML scrape before).
const DEEPSEEK_TOOLS_BASE = process.env.DEEPSEEK_TOOLS_BASE_URL?.trim() || 'https://api.deepseek.com/v1/tools';
const DEEPSEEK_QUERY_MAX = 128;
const DEEPSEEK_FETCH_MAX_CHARS = 60_000;
// Search payload cap (2026-10-18 probe): 8 raw engine summaries ran 4–27k chars per search — context the CALLING model pays for on every
// search, where Gemini returns a 2–8k synthesized answer. 6 results × ≤700-char summaries keeps a search under ~5k chars.
const DEEPSEEK_SEARCH_COUNT = 6;
const DEEPSEEK_SUMMARY_MAX_CHARS = 700;

async function deepseekToolCall(path: 'search' | 'fetch', apiKey: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${DEEPSEEK_TOOLS_BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`DeepSeek ${path} ${res.status}: ${errBody.slice(0, 300)}`);
  }
  return res.json();
}

/** Trim a query to DeepSeek's 128-character limit on a word boundary. */
export function deepseekQuery(query: string): string {
  const q = query.replace(/\s+/g, ' ').trim();
  if (q.length <= DEEPSEEK_QUERY_MAX) return q;
  const cut = q.slice(0, DEEPSEEK_QUERY_MAX);
  const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).trim();
}

export async function deepseekSearch(query: string, count = DEEPSEEK_SEARCH_COUNT): Promise<BackendResult> {
  const apiKey = getApiKey('deepseek');
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');
  const data = await deepseekToolCall('search', apiKey, { query: deepseekQuery(query), count: Math.max(1, Math.min(50, count)), need_content: false });
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  const sources = results.filter((r) => typeof r?.url === 'string').map((r) => ({ title: r.title, url: r.url }));
  const text = results.length === 0
    ? `No results for: ${query}`
    : results.map((r, i) => {
        const meta = [r.site_name, r.date ? String(r.date).slice(0, 10) : null, typeof r.authority === 'number' && r.authority >= 0 ? `authority ${r.authority}` : null].filter(Boolean).join(' · ');
        const body = String(r.summary || r.snippet || '').replace(/^\s*#+\s*/gm, '').replace(/\s+/g, ' ').trim(); // engine summaries carry their own '#' headings
        const clipped = body.length > DEEPSEEK_SUMMARY_MAX_CHARS ? `${body.slice(0, DEEPSEEK_SUMMARY_MAX_CHARS).replace(/\s+\S*$/, '')}…` : body;
        return `[${i + 1}] ${r.title ?? 'Untitled'}\n${r.url}${meta ? `\n${meta}` : ''}\n${clipped}`;
      }).join('\n\n');
  return { text, sources, backend: 'deepseek-search' };
}

/** Fetch each URL (≤5) through DeepSeek's fetch endpoint; returns the pages' Markdown (the calling model does the reading). */
export async function deepseekFetch(urls: string[]): Promise<BackendResult> {
  const apiKey = getApiKey('deepseek');
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');
  if (urls.length === 0) throw new Error('No URLs supplied for DeepSeek fetch');
  const parts: string[] = [];
  const sources: Array<{ title?: string; url: string }> = [];
  for (const u of urls.slice(0, 5)) {
    try {
      const data = await deepseekToolCall('fetch', apiKey, { url: u });
      const title = typeof data?.title === 'string' ? data.title : '';
      let content = typeof data?.content === 'string' ? data.content : '';
      if (content.length > DEEPSEEK_FETCH_MAX_CHARS) content = `${content.slice(0, DEEPSEEK_FETCH_MAX_CHARS)}\n\n[truncated at ${DEEPSEEK_FETCH_MAX_CHARS} chars]`;
      parts.push(`URL: ${u}${title ? `\nTitle: ${title}` : ''}\n\n${content}`);
      sources.push({ title: title || undefined, url: u });
    } catch (err: any) {
      parts.push(`URL: ${u}\n[fetch failed: ${err.message}]`);
    }
  }
  return { text: parts.join('\n\n---\n\n'), sources, backend: 'deepseek-fetch' };
}

// ── OpenAI backend (Responses API) ────────────────────────────────────────────

async function openaiCall(
  modelId: string,
  apiKey: string,
  input: string,
  maxOutputTokens: number,
): Promise<{ text: string; sources: Array<{ title?: string; url: string }> }> {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      tools: [{ type: 'web_search_preview' }],
      input,
      max_output_tokens: maxOutputTokens,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const textParts: string[] = [];
  const sources: Array<{ title?: string; url: string }> = [];

  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === 'output_text' || part.type === 'text') {
            textParts.push(part.text);
            // OpenAI inlines URL annotations within output_text parts.
            for (const ann of part.annotations ?? []) {
              if (ann.type === 'url_citation' && ann.url) {
                sources.push({ title: ann.title, url: ann.url });
              }
            }
          }
        }
      }
    }
  }
  if (textParts.length === 0 && typeof data.output_text === 'string') {
    textParts.push(data.output_text);
  }

  return { text: textParts.join('\n\n'), sources };
}

export async function openaiSearch(query: string, modelId: string): Promise<BackendResult> {
  const apiKey = getApiKey('openai');
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const { text, sources } = await openaiCall(
    modelId,
    apiKey,
    `Search the web comprehensively for: ${query}\n\nReturn detailed, factual results with sources.`,
    16000,
  );
  return { text, sources, backend: 'openai-web_search' };
}

export async function openaiFetch(prompt: string, modelId: string): Promise<BackendResult> {
  const apiKey = getApiKey('openai');
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const { text, sources } = await openaiCall(
    modelId,
    apiKey,
    `Read and extract content from the URL(s) in the following prompt. Preserve structure.\n\n${prompt}`,
    32000,
  );
  return { text, sources, backend: 'openai-web_search' };
}

// ── DuckDuckGo HTML fallback (no API key required) ────────────────────────────

const FALLBACK_TIMEOUT_MS = 10_000;
const FALLBACK_USER_AGENT =
  'Mozilla/5.0 (compatible; CortexV4/4.0; +https://github.com/Spitfire-Products/nexus-cortex)';

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FALLBACK_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: { 'user-agent': FALLBACK_USER_AGENT, ...(init.headers ?? {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function duckDuckGoSearch(query: string): Promise<BackendResult> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
  const html = await res.text();

  const sources: Array<{ title?: string; url: string }> = [];
  const resultRegex =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  let match: RegExpExecArray | null;
  let count = 0;
  const lines: string[] = [];
  while ((match = resultRegex.exec(html)) !== null && count < 10) {
    const rawUrl = match[1] ?? '';
    const titleHtml = match[2] ?? '';
    const snippetHtml = match[3] ?? '';
    if (!rawUrl) continue;
    const title = htmlToText(titleHtml, { wordwrap: false }).trim();
    const snippet = htmlToText(snippetHtml, { wordwrap: false }).trim();
    // DDG wraps URLs as /l/?uddg=ENCODED&...
    const decodedUrl = decodeDdgUrl(rawUrl);
    sources.push({ title, url: decodedUrl });
    lines.push(`[${count + 1}] ${title}\n    ${decodedUrl}\n    ${snippet}`);
    count += 1;
  }

  if (count === 0) {
    return {
      text: `No results found for: "${query}"`,
      sources: [],
      backend: 'duckduckgo-html',
    };
  }

  return {
    text: `Search results for "${query}" (${count} results):\n\n${lines.join('\n\n')}`,
    sources,
    backend: 'duckduckgo-html',
  };
}

function decodeDdgUrl(href: string): string {
  if (!href.startsWith('//') && !href.startsWith('/l/')) return href;
  try {
    const u = new URL(href.startsWith('//') ? `https:${href}` : `https://duckduckgo.com${href}`);
    const real = u.searchParams.get('uddg');
    return real ? decodeURIComponent(real) : href;
  } catch {
    return href;
  }
}

const MAX_DIRECT_FETCH_BYTES = 100_000;

/** Direct HTTP fetch + html-to-text. URL must be public. */
export async function directFetch(url: string): Promise<BackendResult> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Direct fetch ${res.status} for ${url}`);

  const contentType = res.headers.get('content-type') ?? '';
  let body = await res.text();
  if (body.length > MAX_DIRECT_FETCH_BYTES) {
    body = body.slice(0, MAX_DIRECT_FETCH_BYTES) + '\n\n[Content truncated]';
  }

  const isHtml = contentType.includes('html') || /<html[\s>]/i.test(body.slice(0, 500));
  const text = isHtml
    ? htmlToText(body, {
        wordwrap: false,
        selectors: [
          { selector: 'script', format: 'skip' },
          { selector: 'style', format: 'skip' },
          { selector: 'nav', format: 'skip' },
          { selector: 'footer', format: 'skip' },
        ],
      })
    : body;

  return {
    text: `URL: ${url}\n\n${text}`,
    sources: [{ url }],
    backend: 'direct-fetch',
  };
}

// ── Selector ──────────────────────────────────────────────────────────────────

/**
 * Selected web tools model ID. Reads `WEB_TOOLS_MODEL` and, if unset,
 * picks a sensible default based on which provider key is present:
 *   GEMINI/GOOGLE → gemini-2.5-flash (free tier-friendly)
 *   ANTHROPIC     → claude-haiku-4-5
 *   XAI           → grok-4-fast-non-reasoning
 *   none          → '' (DuckDuckGo fallback for search, direct fetch for fetch)
 *
 * Verified Gemini models with googleSearch + urlContext (2026-05-27):
 *   gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.5-pro,
 *   gemini-3-flash-preview (= gemini-3.5-flash preview), gemini-3.5-flash, gemini-3.1-pro-preview
 */
export function getWebToolsModel(): string {
  const explicit = process.env.WEB_TOOLS_MODEL?.trim();
  if (explicit) return explicit;
  // Auto-pick order (operator decision 2026-10-18, ledger .cortex/bench/r-web-backend-order-2026-10-18.md): Gemini first (Google ranking,
  // free tier covers daily use), DeepSeek SECOND ($0.75 / 1k calls — 7-47x cheaper than the per-call tools below, fresh/niche recall,
  // weaker canonical-docs ranking), then the $5-10 / 1k server tools. WEB_TOOLS_MODEL pins any backend explicitly.
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return 'gemini-2.5-flash';
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek-flash';
  if (process.env.ANTHROPIC_API_KEY) return 'claude-haiku-4-5';
  if (process.env.XAI_API_KEY) return 'grok-4-fast-non-reasoning';
  if (process.env.OPENAI_API_KEY) return 'gpt-4o';
  return '';
}

// ── Multi-provider comparative search (2026-10-19) ───────────────────────────
// WEB_SEARCH_PROVIDERS=auto (default: the single auto-picked backend) | all (every keyed backend) | csv of google,deepseek,anthropic,xai,openai.
// The WebSearch tool also takes `providers: [...]` per call. Each keyed provider is queried in parallel; the merged answer shows every
// provider's section plus the sources two or more providers agree on. Cost = the sum of the providers' per-search prices; latency = the slowest.

export type KeyedWebProvider = Exclude<WebProvider, 'fallback'>;
/** The model each provider's search runs on (the WEB_TOOLS_MODEL auto-pick defaults). */
export const WEB_PROVIDER_MODELS: Record<KeyedWebProvider, string> = {
  google: 'gemini-2.5-flash',
  deepseek: 'deepseek-flash',
  anthropic: 'claude-haiku-4-5',
  xai: 'grok-4-fast-non-reasoning',
  openai: 'gpt-4o',
};
const PROVIDER_ORDER: KeyedWebProvider[] = ['google', 'deepseek', 'anthropic', 'xai', 'openai'];
const PROVIDER_ALIASES: Record<string, KeyedWebProvider> = { gemini: 'google', google: 'google', deepseek: 'deepseek', ds: 'deepseek', anthropic: 'anthropic', claude: 'anthropic', xai: 'xai', grok: 'xai', openai: 'openai', gpt: 'openai' };

/** Providers that have a key in `env`, in the canonical order. */
export function keyedProviders(env: NodeJS.ProcessEnv = process.env): KeyedWebProvider[] {
  const has = (p: KeyedWebProvider) => {
    switch (p) {
      case 'google': return !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
      case 'deepseek': return !!env.DEEPSEEK_API_KEY;
      case 'anthropic': return !!env.ANTHROPIC_API_KEY;
      case 'xai': return !!env.XAI_API_KEY;
      case 'openai': return !!env.OPENAI_API_KEY;
    }
  };
  return PROVIDER_ORDER.filter(has);
}

/** Resolve a providers spec ('auto' | 'all' | csv | array) to the keyed providers to fan out to. Fewer than 2 → the single-backend path. */
export function resolveSearchProviders(spec: string | string[] | undefined, env: NodeJS.ProcessEnv = process.env): KeyedWebProvider[] {
  const items = (Array.isArray(spec) ? spec : String(spec ?? '').split(',')).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (items.length === 0 || items.includes('auto') || items.includes('off')) return [];
  const keyed = keyedProviders(env);
  if (items.includes('all')) return keyed;
  const out: KeyedWebProvider[] = [];
  for (const it of items) {
    const p = PROVIDER_ALIASES[it];
    if (p && keyed.includes(p) && !out.includes(p)) out.push(p);
  }
  return PROVIDER_ORDER.filter((p) => out.includes(p));
}

/** One provider's search through the backend functions (google is SDK-driven inside WebSearchTool, so the caller supplies it). */
export async function searchWithProvider(
  provider: KeyedWebProvider,
  query: string,
  google?: (query: string, modelId: string) => Promise<BackendResult>,
): Promise<BackendResult> {
  const model = WEB_PROVIDER_MODELS[provider];
  switch (provider) {
    case 'anthropic': return anthropicSearch(query, model);
    case 'xai': return xaiSearch(query, model);
    case 'openai': return openaiSearch(query, model);
    case 'deepseek': return deepseekSearch(query);
    case 'google':
      if (!google) throw new Error('google search requires the Gemini SDK path');
      return google(query, model);
  }
}

/** Gemini grounding returns opaque vertexaisearch redirect links; follow them (HEAD, parallel, short cap) so URL agreement across providers can
 *  be computed. A link that does not resolve in time is kept as-is. */
export async function resolveRedirectSources(
  sources: Array<{ title?: string; url: string }>,
  capMs = 3000,
): Promise<Array<{ title?: string; url: string }>> {
  return Promise.all(sources.map(async (s) => {
    if (!/grounding-api-redirect/.test(s.url)) return s;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), capMs);
      const res = await fetch(s.url, { method: 'HEAD', redirect: 'manual', signal: ctl.signal });
      clearTimeout(t);
      const loc = res.headers.get('location');
      return loc && /^https?:\/\//.test(loc) ? { ...s, url: loc } : s;
    } catch { return s; }
  }));
}

export interface ProviderSearchOutcome { provider: KeyedWebProvider; ms: number; result?: BackendResult; error?: string }

function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    // same page in its doc-site spellings: /limits/, /limits/index.md, /limits.html, /limits/index.html → /limits
    const path = x.pathname.replace(/\/+$/, '').replace(/\/index\.(?:md|html?)$/i, '').replace(/\.(?:md|html?)$/i, '');
    return `${x.hostname.toLowerCase().replace(/^www\./, '')}${path}`;
  } catch { return u.trim().toLowerCase(); }
}

/** Merge per-provider outcomes into one comparative answer: a section per provider, then the sources ≥2 providers agree on, then the union. Pure. */
export function mergeComparative(query: string, outcomes: ProviderSearchOutcome[]): BackendResult {
  const ok = outcomes.filter((o) => o.result);
  const sections = outcomes.map((o) => {
    const head = `## ${o.provider} (${o.result ? `${o.result.backend}, ${o.result.sources.length} sources` : 'failed'}, ${o.ms} ms)`;
    return o.result ? `${head}\n${o.result.text.trim()}` : `${head}\n[${o.error ?? 'no result'}]`;
  });
  const byUrl = new Map<string, { url: string; title?: string; providers: Set<KeyedWebProvider> }>();
  for (const o of ok) {
    for (const s of o.result!.sources) {
      const k = normalizeUrl(s.url);
      const e = byUrl.get(k) ?? { url: s.url, title: s.title, providers: new Set<KeyedWebProvider>() };
      e.providers.add(o.provider); if (!e.title && s.title) e.title = s.title; byUrl.set(k, e);
    }
  }
  const all = [...byUrl.values()];
  const agreed = all.filter((e) => e.providers.size >= 2).sort((a, b) => b.providers.size - a.providers.size);
  const agreedText = agreed.length
    ? `## Sources cited by ${agreed.length === 1 ? 'more than one provider' : 'several providers'}\n` + agreed.map((e, i) => `[${i + 1}] ${e.title ?? 'Untitled'} (${e.url}) — ${[...e.providers].join(', ')}`).join('\n')
    : '## Sources cited by more than one provider\n(none — the providers returned disjoint sources; weigh the sections above against each other)';
  const text = `# Comparative web search: ${query}\nProviders: ${outcomes.map((o) => o.provider + (o.result ? '' : ' (failed)')).join(', ')}\n\n${sections.join('\n\n')}\n\n${agreedText}`;
  const sources = all.map((e) => ({ title: e.title, url: e.url }));
  return { text, sources, backend: `multi:${ok.map((o) => o.provider).join('+')}` };
}

/**
 * Run a web search with provider-native backends, falling back to DuckDuckGo
 * when no provider is configured or its API key is missing.
 */
export async function runWebSearch(query: string): Promise<BackendResult> {
  const modelId = getWebToolsModel();
  const provider = resolveProvider(modelId);

  if (provider !== 'fallback' && getApiKey(provider)) {
    try {
      switch (provider) {
        case 'anthropic':
          return await anthropicSearch(query, modelId);
        case 'xai':
          return await xaiSearch(query, modelId);
        case 'openai':
          return await openaiSearch(query, modelId);
        case 'deepseek':
          return await deepseekSearch(query);
        case 'google':
          // Gemini googleSearch is implemented in WebSearchTool itself
          // because it uses the @google/genai SDK and citation-byte logic.
          throw new Error('__USE_GEMINI_SDK__');
      }
    } catch (err: any) {
      if (err.message === '__USE_GEMINI_SDK__') throw err;
      console.warn(`[web-tools] ${provider} search failed: ${err.message}`);
    }
  }

  return duckDuckGoSearch(query);
}

/**
 * Run a web fetch with provider-native backends, falling back to direct
 * HTTP + html-to-text. The `prompt` parameter contains the URL(s) and
 * processing instructions (matching the WebFetch tool schema).
 */
export async function runWebFetch(prompt: string, urls: string[]): Promise<BackendResult> {
  const modelId = getWebToolsModel();
  const provider = resolveProvider(modelId);

  if (provider !== 'fallback' && getApiKey(provider)) {
    try {
      switch (provider) {
        case 'anthropic':
          return await anthropicFetch(prompt, modelId);
        case 'xai':
          return await xaiFetch(prompt, modelId);
        case 'openai':
          return await openaiFetch(prompt, modelId);
        case 'deepseek':
          return await deepseekFetch(urls);
        case 'google':
          throw new Error('__USE_GEMINI_SDK__');
      }
    } catch (err: any) {
      if (err.message === '__USE_GEMINI_SDK__') throw err;
      console.warn(`[web-tools] ${provider} fetch failed: ${err.message}`);
    }
  }

  // Direct fetch each URL in the prompt; concatenate results.
  if (urls.length === 0) {
    throw new Error('No URLs supplied for direct fetch fallback');
  }

  const parts: string[] = [];
  const sources: Array<{ title?: string; url: string }> = [];
  for (const u of urls.slice(0, 5)) {
    try {
      const r = await directFetch(u);
      parts.push(r.text);
      sources.push(...r.sources);
    } catch (err: any) {
      parts.push(`URL: ${u}\n[fetch failed: ${err.message}]`);
    }
  }

  return {
    text: parts.join('\n\n---\n\n'),
    sources,
    backend: 'direct-fetch',
  };
}
