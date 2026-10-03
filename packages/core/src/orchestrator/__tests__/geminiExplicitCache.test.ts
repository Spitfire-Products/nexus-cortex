/**
 * HB-GEMINI-EXPLICIT-CACHE (DARK, CORTEX_GEMINI_EXPLICIT_CACHE). The REAL APIClient Gemini builders against a stubbed
 * fetch that plays the Gemini API (cachedContents create / PATCH / DELETE + generateContent). Proves: create once,
 * reuse across appended turns, re-snapshot on the tail threshold, new snapshot on a tools change, fallback on a 404,
 * a cached request never carries system/tools/toolConfig, and flag off = byte-identical.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APIClient } from '../APIClient.js';
import { GatewayTranslationLayer } from '../../adapters/GatewayTranslationLayer.js';
import { gemini37Flash } from '../../models/cards/google/gemini-3-7-flash.js';
import { gemini25FlashSDK } from '../../models/cards/google/gemini-2-5-flash-sdk.js';
import { GeminiExplicitCacheManager, geminiMinCacheTokens, geminiBaseFromEndpoint } from '../geminiExplicitCache.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';

const ENV = ['CORTEX_GEMINI_EXPLICIT_CACHE', 'CORTEX_GEMINI_CACHE_TTL_S', 'CORTEX_GEMINI_CACHE_RESNAPSHOT_TOKENS',
  'CORTEX_GEMINI_CACHE_MIN_TOKENS', 'CORTEX_GEMINI_CACHE_QUIET', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'CORTEX_GEMINI_SYSTEM_FIX'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.CORTEX_GEMINI_CACHE_QUIET = 'true';
  process.env.CORTEX_GEMINI_CACHE_MIN_TOKENS = '50';
  process.env.CORTEX_GEMINI_CACHE_RESNAPSHOT_TOKENS = '1024';
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

interface Call { method: string; url: string; body: any }
/** A fake Gemini API. `failUse` = cache names whose generateContent returns 404. */
function fakeGemini(opts: { failUse?: Set<string>; failCreate?: boolean; sse?: boolean } = {}) {
  const calls: Call[] = [];
  let n = 0;
  const live = new Set<string>();
  const spy = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    const method = (init?.method ?? input?.method ?? 'GET').toUpperCase();
    let text: string | undefined = typeof init?.body === 'string' ? init.body : undefined;
    if (text === undefined && input && typeof input === 'object' && typeof input.clone === 'function') text = await input.clone().text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ method, url, body });
    const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (/\/cachedContents(\?|$)/.test(url) && method === 'POST') {
      if (opts.failCreate) return json({ error: { code: 400, message: 'too small' } }, 400);
      const name = `cachedContents/c${++n}`;
      live.add(name);
      return json({ name, expireTime: new Date(Date.now() + 300_000).toISOString(), usageMetadata: { totalTokenCount: 5000 } });
    }
    if (/\/cachedContents\/c\d+/.test(url)) {
      const name = url.match(/cachedContents\/c\d+/)![0];
      if (method === 'DELETE') { live.delete(name); return json({}); }
      if (method === 'PATCH') return json({ name, expireTime: new Date(Date.now() + 300_000).toISOString() });
    }
    // generateContent / streamGenerateContent
    const cachedName = body?.cachedContent ?? body?.cached_content ?? body?.generationConfig?.cachedContent;
    if (cachedName && (opts.failUse?.has(cachedName) || !live.has(cachedName))) {
      return json({ error: { code: 404, message: 'CachedContent not found' } }, 404);
    }
    const resp = { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 6000, candidatesTokenCount: 1, totalTokenCount: 6001, ...(cachedName ? { cachedContentTokenCount: 5000 } : {}) } };
    if (opts.sse) return new Response(`data: ${JSON.stringify(resp)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    return json(resp);
  });
  vi.stubGlobal('fetch', spy);
  return { calls, live, gen: () => calls.filter((c) => /:(stream)?[gG]enerateContent/.test(c.url)) };
}

const SYS = 'You are a coding agent. ' + 'Rules. '.repeat(200);
const FN = [{ name: 'Bash', description: 'run a command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }];
/** Gemini contents for a k-step tool loop ending on the newest user turn. */
function history(k: number, pad = 0): any[] {
  const out: any[] = [{ role: 'user', parts: [{ text: 'Fix the bug in the repo.' }] }];
  for (let i = 0; i < k; i++) {
    out.push({ role: 'model', parts: [{ functionCall: { name: 'Bash', args: { command: `step ${i}` } } }] });
    out.push({ role: 'user', parts: [{ functionResponse: { name: 'Bash', response: { output: `out ${i} ` + 'x'.repeat(pad) } } }] });
  }
  return out;
}
function req(card: ModelConfig, contents: any[], extra: Record<string, unknown> = {}): any {
  return { messages: contents, tools: FN, systemMessage: SYS, parameters: { generationConfig: { temperature: 1 } }, headers: {}, modelId: card.id, conversationId: 'sess-1', ...extra };
}
async function run(client: any, card: ModelConfig, r: any, mode: 'send' | 'stream' = 'send') {
  if (mode === 'send') return client.sendRequest(r, card);
  const s = client.streamRequest(r, card);
  for await (const _c of s.chunks) { /* drain */ }
  return s.finalMessage;
}
const cachedOf = (b: any) => b?.cachedContent ?? b?.config?.cachedContent;

describe('CORTEX_GEMINI_EXPLICIT_CACHE — REST generateContent', () => {
  for (const mode of ['send', 'stream'] as const) {
    it(`${mode}: create once, reuse across appended turns; cached body has no system/tools/tool_config`, async () => {
      process.env.CORTEX_GEMINI_EXPLICIT_CACHE = 'on';
      process.env.CORTEX_GEMINI_SYSTEM_FIX = 'on'; // R229: the non-streaming builder only sends the system prompt with it on
      const g = fakeGemini({ sse: mode === 'stream' });
      const client: any = new APIClient();
      const finals: any[] = [];
      for (let k = 1; k <= 4; k++) finals.push(await run(client, gemini37Flash, req(gemini37Flash, history(k)), mode));
      const creates = g.calls.filter((c) => c.method === 'POST' && /\/cachedContents$/.test(c.url));
      expect(creates).toHaveLength(1);
      expect(creates[0].body.model).toBe('models/gemini-3.7-flash');
      expect(creates[0].body.systemInstruction).toEqual({ parts: [{ text: SYS }] });
      expect(creates[0].body.tools).toEqual([{ function_declarations: FN }]);
      expect(creates[0].body.contents).toEqual(history(1).slice(0, 2)); // newest turn excluded
      expect(creates[0].body.ttl).toBe('300s');
      const gens = g.gen();
      expect(gens).toHaveLength(4);
      for (const [i, c] of gens.entries()) {
        expect(c.body.cachedContent).toBe('cachedContents/c1');
        expect(c.body.system_instruction).toBeUndefined();
        expect(c.body.tools).toBeUndefined();
        expect(c.body.tool_config).toBeUndefined();
        expect(c.body.contents).toEqual(history(i + 1).slice(2)); // only the turns after the snapshot
        expect(c.body.generation_config).toEqual({ temperature: 1 });
      }
      // usage reaches the final message (stream: chunk-level usageMetadata is captured with the lever on)
      const usage = mode === 'send' ? finals[3].data.usageMetadata : finals[3].usageMetadata;
      expect(usage.cachedContentTokenCount).toBe(5000);
    });
  }

  it('re-snapshots when the uncached tail exceeds CORTEX_GEMINI_CACHE_RESNAPSHOT_TOKENS and deletes the superseded one', async () => {
    process.env.CORTEX_GEMINI_EXPLICIT_CACHE = 'on';
    const g = fakeGemini();
    const client: any = new APIClient();
    await run(client, gemini37Flash, req(gemini37Flash, history(1)));
    await run(client, gemini37Flash, req(gemini37Flash, history(2, 3000))); // tail ~ 750 tok → reuse
    await run(client, gemini37Flash, req(gemini37Flash, history(3, 3000))); // tail ~1500 tok > 1024 → re-snapshot
    await new Promise((r) => setTimeout(r, 0));
    const creates = g.calls.filter((c) => c.method === 'POST' && /\/cachedContents$/.test(c.url));
    expect(creates).toHaveLength(2);
    expect(creates[1].body.contents).toEqual(history(3, 3000).slice(0, 6));
    const gens = g.gen();
    expect(gens.map((c) => c.body.cachedContent)).toEqual(['cachedContents/c1', 'cachedContents/c1', 'cachedContents/c2']);
    expect(gens[2].body.contents).toEqual(history(3, 3000).slice(6));
    expect(g.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('cachedContents/c1'))).toBe(true);
  });

  it('a tools change (anchor lift) = new snapshot under a new head; a history rewrite = invalidate + re-snapshot', async () => {
    process.env.CORTEX_GEMINI_EXPLICIT_CACHE = 'on';
    const g = fakeGemini();
    const client: any = new APIClient();
    await run(client, gemini37Flash, req(gemini37Flash, history(2)));
    const lifted = [...FN, { name: 'Edit', description: 'edit', parameters: { type: 'object', properties: {} } }];
    await run(client, gemini37Flash, req(gemini37Flash, history(3), { tools: lifted }));
    const rewritten = history(4); rewritten[1] = { role: 'model', parts: [{ text: '[compacted]' }] };
    await run(client, gemini37Flash, req(gemini37Flash, rewritten, { tools: lifted }));
    await new Promise((r) => setTimeout(r, 0));
    const creates = g.calls.filter((c) => c.method === 'POST' && /\/cachedContents$/.test(c.url));
    expect(creates).toHaveLength(3);
    expect(creates[1].body.tools).toEqual([{ function_declarations: lifted }]);
    expect(g.gen().map((c) => c.body.cachedContent)).toEqual(['cachedContents/c1', 'cachedContents/c2', 'cachedContents/c3']);
    expect(g.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('cachedContents/c2'))).toBe(true); // prefix_changed
  });

  it('fallback: 404 on the cached request → the normal full request once, slot invalidated, next turn re-creates', async () => {
    process.env.CORTEX_GEMINI_EXPLICIT_CACHE = 'on';
    process.env.CORTEX_GEMINI_SYSTEM_FIX = 'on';
    const g = fakeGemini({ failUse: new Set(['cachedContents/c1']) });
    const client: any = new APIClient();
    const r1 = await run(client, gemini37Flash, req(gemini37Flash, history(2)));
    expect(r1.status).toBe(200);
    const gens = g.gen();
    expect(gens).toHaveLength(2);
    expect(gens[0].body.cachedContent).toBe('cachedContents/c1');
    expect(gens[1].body.cachedContent).toBeUndefined();
    expect(gens[1].body.system_instruction).toBeDefined();
    expect(gens[1].body.tools).toEqual([{ function_declarations: FN }]);
    expect(gens[1].body.contents).toEqual(history(2));
    await run(client, gemini37Flash, req(gemini37Flash, history(3)));
    expect(g.gen()[2].body.cachedContent).toBe('cachedContents/c2');
  });

  it('create failure → full request, backoff (no create storm), never both cachedContent and system/tools', async () => {
    process.env.CORTEX_GEMINI_EXPLICIT_CACHE = 'on';
    const g = fakeGemini({ failCreate: true });
    const client: any = new APIClient();
    for (let k = 1; k <= 3; k++) await run(client, gemini37Flash, req(gemini37Flash, history(k)));
    expect(g.calls.filter((c) => c.method === 'POST' && /\/cachedContents$/.test(c.url))).toHaveLength(1);
    for (const c of g.gen()) { expect(c.body.cachedContent).toBeUndefined(); expect(c.body.tools).toBeDefined(); }
  });

  it('forced tool_config bypasses the cache (full request, snapshot kept for the next turn)', async () => {
    process.env.CORTEX_GEMINI_EXPLICIT_CACHE = 'on';
    const g = fakeGemini();
    const client: any = new APIClient();
    await run(client, gemini37Flash, req(gemini37Flash, history(1)));
    await run(client, gemini37Flash, req(gemini37Flash, history(2), { toolChoice: { key: 'tool_config', value: { function_calling_config: { mode: 'ANY' } } } }));
    await run(client, gemini37Flash, req(gemini37Flash, history(3)));
    const gens = g.gen();
    expect(gens[1].body.cachedContent).toBeUndefined();
    expect(gens[1].body.tool_config).toBeDefined();
    expect(gens[2].body.cachedContent).toBe('cachedContents/c1');
  });

  it('the snapshot mirrors what the uncached request sends (non-streaming, R229 off: no system prompt in body → none in cache)', async () => {
    process.env.CORTEX_GEMINI_EXPLICIT_CACHE = 'on';
    const g = fakeGemini();
    const client: any = new APIClient();
    await run(client, gemini37Flash, req(gemini37Flash, history(2)));
    const create = g.calls.find((c) => c.method === 'POST' && /\/cachedContents$/.test(c.url))!;
    expect(create.body.systemInstruction).toBeUndefined();
    expect(create.body.tools).toEqual([{ function_declarations: FN }]);
  });

  it('below the model minimum: no snapshot, plain request', async () => {
    process.env.CORTEX_GEMINI_EXPLICIT_CACHE = 'on';
    delete process.env.CORTEX_GEMINI_CACHE_MIN_TOKENS; // 4096 for 3.x
    const g = fakeGemini();
    const client: any = new APIClient();
    await run(client, gemini37Flash, { ...req(gemini37Flash, history(2)), systemMessage: 'short' });
    expect(g.calls.filter((c) => /cachedContents/.test(c.url))).toHaveLength(0);
  });

  it('flag off = byte-identical (direct request and real gateway request; send + stream)', async () => {
    const MSGS = [{ role: 'user', content: [{ type: 'text', text: 'Fix the bug.' }] }] as any[];
    const TOOLS = [{ name: 'Bash', description: 'run', schema: { type: 'object', properties: { command: { type: 'string', description: 'c' } }, required: ['command'] } }] as any[];
    const viaGateway = () => new GatewayTranslationLayer().prepareRequest(MSGS, TOOLS, gemini37Flash, { maxTokens: 8000, staticSystemPrompt: SYS } as any);
    for (const mode of ['send', 'stream'] as const) {
      for (const make of [() => req(gemini37Flash, history(3)), viaGateway]) {
        const bodies: string[] = [];
        for (const v of [undefined, 'off']) {
          if (v === undefined) delete process.env.CORTEX_GEMINI_EXPLICIT_CACHE; else process.env.CORTEX_GEMINI_EXPLICIT_CACHE = v;
          const g = fakeGemini({ sse: mode === 'stream' });
          await run(new APIClient() as any, gemini37Flash, make(), mode);
          expect(g.calls).toHaveLength(1);
          expect(g.calls[0].url).not.toMatch(/cachedContents/);
          bodies.push(JSON.stringify(g.calls[0].body));
        }
        expect(bodies[1]).toBe(bodies[0]);
        expect(JSON.parse(bodies[0]).cachedContent).toBeUndefined();
      }
    }
  });

  it('disposeGeminiCaches DELETEs every live snapshot', async () => {
    process.env.CORTEX_GEMINI_EXPLICIT_CACHE = 'on';
    const g = fakeGemini();
    const client: any = new APIClient();
    await run(client, gemini37Flash, req(gemini37Flash, history(1)));
    expect(g.live.size).toBe(1);
    await client.disposeGeminiCaches();
    expect(g.live.size).toBe(0);
  });
});

describe('CORTEX_GEMINI_EXPLICIT_CACHE — @google/genai SDK', () => {
  const sdkReq = (contents: any[]) => ({ ...req(gemini25FlashSDK, contents), tools: [{ name: 'Bash', description: 'run', input_schema: FN[0].parameters }] });
  for (const mode of ['send', 'stream'] as const) {
    it(`${mode}: config.cachedContent + tail only; config has no systemInstruction/tools`, async () => {
      process.env.CORTEX_GEMINI_EXPLICIT_CACHE = 'on';
      process.env.CORTEX_GEMINI_SYSTEM_FIX = 'on';
      const g = fakeGemini({ sse: mode === 'stream' });
      const client: any = new APIClient();
      for (let k = 1; k <= 3; k++) await run(client, gemini25FlashSDK, sdkReq(history(k)), mode);
      const creates = g.calls.filter((c) => c.method === 'POST' && /\/cachedContents$/.test(c.url));
      expect(creates).toHaveLength(1);
      expect(creates[0].body.model).toBe('models/gemini-2.5-flash');
      expect(creates[0].body.systemInstruction).toEqual({ parts: [{ text: SYS }] });
      const gens = g.gen();
      expect(gens).toHaveLength(3);
      for (const [i, c] of gens.entries()) {
        // the SDK maps config.cachedContent → body.cachedContent and config.systemInstruction/tools → body fields
        expect(c.body.cachedContent).toBe('cachedContents/c1');
        expect(c.body.systemInstruction).toBeUndefined();
        expect(c.body.tools).toBeUndefined();
        expect(c.body.toolConfig).toBeUndefined();
        expect(c.body.contents).toHaveLength(history(i + 1).length - 2);
      }
    });
  }

  it('SDK 404 on use → full request once', async () => {
    process.env.CORTEX_GEMINI_EXPLICIT_CACHE = 'on';
    const g = fakeGemini({ failUse: new Set(['cachedContents/c1']) });
    const client: any = new APIClient();
    await run(client, gemini25FlashSDK, sdkReq(history(2)));
    const gens = g.gen();
    expect(gens).toHaveLength(2);
    expect(gens[1].body.cachedContent).toBeUndefined();
    expect(gens[1].body.tools).toBeDefined();
  });
});

describe('helpers', () => {
  it('min tokens by model + base url', () => {
    expect(geminiMinCacheTokens('gemini-3.8-flash')).toBe(50); // env override in this suite
    delete process.env.CORTEX_GEMINI_CACHE_MIN_TOKENS;
    expect(geminiMinCacheTokens('gemini-3.8-flash')).toBe(4096);
    expect(geminiMinCacheTokens('gemini-2.5-flash')).toBe(2048);
    expect(geminiBaseFromEndpoint('https://generativelanguage.googleapis.com/v1beta/models')).toBe('https://generativelanguage.googleapis.com/v1beta');
  });
  it('TTL is extended (PATCH) when used in the second half of its life', async () => {
    let t = 1_000_000;
    const calls: any[] = [];
    const f: any = async (url: string, init: any) => {
      calls.push({ url, method: init.method });
      if (init.method === 'POST') return { ok: true, status: 200, json: async () => ({ name: 'cachedContents/z' }), text: async () => '' };
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };
    const m = new GeminiExplicitCacheManager({ fetchImpl: f, now: () => t });
    const ctx = { modelId: 'gemini-3.8-flash', apiKey: 'k' };
    const body = (k: number) => ({ contents: history(k), system_instruction: { parts: [{ text: SYS }] }, tools: [{ function_declarations: FN }] });
    expect((await m.prepare(ctx, 'rest', body(1)))?.plan.mode).toBe('created');
    t += 60_000;
    await m.prepare(ctx, 'rest', body(2));
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    t += 120_000; // 180 s of 300 used
    await m.prepare(ctx, 'rest', body(3));
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    t += 400_000; // past expiry → re-create
    expect((await m.prepare(ctx, 'rest', body(4)))?.plan.mode).toBe('created');
  });
});
