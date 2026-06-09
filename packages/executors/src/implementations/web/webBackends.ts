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

export type WebProvider = 'anthropic' | 'xai' | 'openai' | 'google' | 'fallback';

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
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return 'gemini-2.5-flash';
  if (process.env.ANTHROPIC_API_KEY) return 'claude-haiku-4-5';
  if (process.env.XAI_API_KEY) return 'grok-4-fast-non-reasoning';
  if (process.env.OPENAI_API_KEY) return 'gpt-4o';
  return '';
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
