import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveProvider, getWebToolsModel, deepseekQuery, deepseekSearch, deepseekFetch } from '../webBackends.js';

const saved: Record<string, string | undefined> = {};
const KEYS = ['DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'OPENAI_API_KEY', 'WEB_TOOLS_MODEL'];

describe('DeepSeek Search/Fetch backend (2026-10-18)', () => {
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } vi.restoreAllMocks(); });

  it('resolves deepseek-* ids to the deepseek provider and auto-picks deepseek-flash when only a DeepSeek key is present', () => {
    expect(resolveProvider('deepseek-flash')).toBe('deepseek');
    expect(resolveProvider('deepseek-v4-pro')).toBe('deepseek');
    expect(getWebToolsModel()).toBe('');
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    expect(getWebToolsModel()).toBe('deepseek-flash');
    process.env.XAI_API_KEY = 'xai-test';
    expect(getWebToolsModel()).toBe('deepseek-flash'); // DeepSeek outranks the $5-10/1k server tools
    process.env.GEMINI_API_KEY = 'g-test';
    expect(getWebToolsModel()).toBe('gemini-2.5-flash'); // Gemini stays first
  });

  it('trims queries to the 128-char API limit on a word boundary', () => {
    const long = 'word '.repeat(60).trim();
    const q = deepseekQuery(long);
    expect(q.length).toBeLessThanOrEqual(128);
    expect(q.endsWith('word')).toBe(true);
    expect(deepseekQuery('  a   b  ')).toBe('a b');
  });

  it('search: posts to /v1/tools/search and renders results with sources', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ results: [
        { rerank_score: 1.3, title: 'sgrep', url: 'https://github.com/context-dot-dev/sgrep', snippet: 's', summary: 'Semantic grep.', site_name: 'GitHub', date: '2026-09-05T16:00:00+00:00', authority: 3 },
      ] }) } as any;
    }));
    const r = await deepseekSearch('semantic code search', 3);
    expect(calls[0].url).toBe('https://api.deepseek.com/v1/tools/search');
    expect(calls[0].body).toEqual({ query: 'semantic code search', count: 3, need_content: false });
    expect(r.backend).toBe('deepseek-search');
    expect(r.sources).toEqual([{ title: 'sgrep', url: 'https://github.com/context-dot-dev/sgrep' }]);
    expect(r.text).toContain('[1] sgrep');
    expect(r.text).toContain('GitHub · 2026-09-05 · authority 3');
  });

  it('search: clips each summary to the payload cap and defaults to 6 results', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ results: [{ title: 'T', url: 'https://e.com/a', summary: 'word '.repeat(400) }] }) } as any;
    }));
    const r = await deepseekSearch('q');
    expect(calls[0].count).toBe(6);
    expect(r.text.length).toBeLessThan(900);
    expect(r.text.endsWith('…')).toBe(true);
  });

  it('fetch: posts each URL to /v1/tools/fetch and returns the page Markdown; a failed URL is reported, not thrown', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.url.includes('bad')) return { ok: false, status: 404, text: async () => '{"error":{"message":"no usable content"}}' } as any;
      return { ok: true, json: async () => ({ title: 'Page', content: '# Hello\n\nbody' }) } as any;
    }));
    const r = await deepseekFetch(['https://example.com/ok', 'https://example.com/bad']);
    expect(r.backend).toBe('deepseek-fetch');
    expect(r.text).toContain('Title: Page');
    expect(r.text).toContain('# Hello');
    expect(r.text).toContain('[fetch failed: DeepSeek fetch 404');
    expect(r.sources).toEqual([{ title: 'Page', url: 'https://example.com/ok' }]);
  });

  it('throws without a key', async () => {
    await expect(deepseekSearch('x')).rejects.toThrow('DEEPSEEK_API_KEY');
  });
});
