import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { keyedProviders, resolveSearchProviders, mergeComparative, resolveRedirectSources } from '../webBackends.js';
import { vi } from 'vitest';

const KEYS = ['DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'OPENAI_API_KEY'];
const saved: Record<string, string | undefined> = {};

describe('multi-provider comparative search (2026-10-19)', () => {
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('resolves specs against the keys present, in canonical order, with aliases', () => {
    process.env.DEEPSEEK_API_KEY = 'a'; process.env.XAI_API_KEY = 'b'; process.env.GEMINI_API_KEY = 'c';
    expect(keyedProviders()).toEqual(['google', 'deepseek', 'xai']);
    expect(resolveSearchProviders(undefined)).toEqual([]);
    expect(resolveSearchProviders('auto')).toEqual([]);
    expect(resolveSearchProviders('all')).toEqual(['google', 'deepseek', 'xai']);
    expect(resolveSearchProviders('grok, gemini')).toEqual(['google', 'xai']);
    expect(resolveSearchProviders(['ds', 'anthropic'])).toEqual(['deepseek']); // anthropic has no key → dropped
    expect(resolveSearchProviders(['deepseek'])).toEqual(['deepseek']); // a single provider is a valid explicit pick
  });

  it('merges outcomes into per-provider sections plus the agreed sources (URL-normalized), tolerating a failed provider', () => {
    const r = mergeComparative('q', [
      { provider: 'google', ms: 4000, result: { text: 'G answer', backend: 'gemini-googleSearch', sources: [{ title: 'Docs', url: 'https://www.example.com/docs/' }, { url: 'https://a.io/x' }] } },
      { provider: 'deepseek', ms: 500, result: { text: 'D answer', backend: 'deepseek-search', sources: [{ title: 'Docs page', url: 'https://example.com/docs' }, { url: 'https://b.io/y' }] } },
      { provider: 'xai', ms: 1200, error: 'XAI 429: slow down' },
    ]);
    expect(r.backend).toBe('multi:google+deepseek');
    expect(r.text).toContain('## google (gemini-googleSearch, 2 sources, 4000 ms)');
    expect(r.text).toContain('## deepseek (deepseek-search, 2 sources, 500 ms)');
    expect(r.text).toContain('## xai (failed, 1200 ms)\n[XAI 429: slow down]');
    expect(r.text).toContain('Docs (https://www.example.com/docs/) — google, deepseek');
    expect(r.sources).toHaveLength(3); // docs (deduped) + a.io + b.io
  });

  it('treats a page and its doc-site spellings (index.md, .html, trailing slash, fragment) as the same source', () => {
    const r = mergeComparative('q', [
      { provider: 'google', ms: 1, result: { text: 'a', backend: 'g', sources: [{ url: 'https://developers.cloudflare.com/containers/platform/limits/' }] } },
      { provider: 'deepseek', ms: 1, result: { text: 'b', backend: 'd', sources: [{ url: 'https://developers.cloudflare.com/containers/platform/limits/index.md#1' }] } },
    ]);
    expect(r.text).toContain('(https://developers.cloudflare.com/containers/platform/limits/) — google, deepseek');
    expect(r.sources).toHaveLength(1);
  });

  it('says so when nothing overlaps', () => {
    const r = mergeComparative('q', [
      { provider: 'google', ms: 1, result: { text: 'a', backend: 'g', sources: [{ url: 'https://a.io' }] } },
      { provider: 'deepseek', ms: 1, result: { text: 'b', backend: 'd', sources: [{ url: 'https://b.io' }] } },
    ]);
    expect(r.text).toContain('(none — the providers returned disjoint sources');
  });
});

describe('resolveRedirectSources', () => {
  it('follows grounding redirect links to their Location and leaves other URLs untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ headers: new Map([['location', 'https://developers.cloudflare.com/containers/platform/limits/']]) as any })));
    const out = await resolveRedirectSources([
      { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZ1' },
      { url: 'https://example.com/x' },
    ]);
    expect(out[0].url).toBe('https://developers.cloudflare.com/containers/platform/limits/');
    expect(out[1].url).toBe('https://example.com/x');
    vi.restoreAllMocks();
  });
});
