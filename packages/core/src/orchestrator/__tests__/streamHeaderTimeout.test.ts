import { describe, it, expect, afterEach } from 'vitest';
import { cortexProxyFetch, streamHeaderTimeoutMs } from '../cortexProxyFetch.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.CORTEX_STREAM_HEADER_TIMEOUT_MS; });

// A provider that never sends headers: resolves only when aborted (then rejects like fetch does).
function hangingFetch(): typeof fetch {
  return ((_u: any, init?: any) => new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(init.signal.reason ?? new Error('aborted'))); })) as any;
}

describe('streaming header deadline', () => {
  it('defaults to 120 s; 0 disables', () => {
    expect(streamHeaderTimeoutMs({} as any)).toBe(120000);
    expect(streamHeaderTimeoutMs({ CORTEX_STREAM_HEADER_TIMEOUT_MS: '0' } as any)).toBe(0);
  });
  it('aborts a streaming request that sends no headers', async () => {
    process.env.CORTEX_STREAM_HEADER_TIMEOUT_MS = '50';
    globalThis.fetch = hangingFetch();
    const t0 = Date.now();
    await expect(cortexProxyFetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'x', stream: true }) })).rejects.toThrow(/no response headers/);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('leaves non-streaming requests alone', async () => {
    process.env.CORTEX_STREAM_HEADER_TIMEOUT_MS = '50';
    globalThis.fetch = ((_u: any) => new Promise((res) => setTimeout(() => res(new Response('{}')), 150))) as any;
    const r = await cortexProxyFetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'x', stream: false }) });
    expect(r.status).toBe(200);
  });
  it('a caller abort still propagates', async () => {
    process.env.CORTEX_STREAM_HEADER_TIMEOUT_MS = '5000';
    globalThis.fetch = hangingFetch();
    const ac = new AbortController();
    const p = cortexProxyFetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST', body: '{"stream":true}', signal: ac.signal });
    ac.abort(new Error('user abort'));
    await expect(p).rejects.toThrow(/user abort/);
  });
});
