/** R238 (2026-10-06): breaking out of a chat-completions stream must SETTLE finalMessage with the partial message instead of hanging. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { APIClient, type PreparedRequest } from '../APIClient.js';
import type { ModelConfig } from '../../types/index.js';

let server: http.Server; let port = 0; let served = 0;
const sse = (obj: any) => `data: ${JSON.stringify(obj)}\n\n`;
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    served++;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const base = { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'deepseek-chat' };
    res.write(sse({ ...base, choices: [{ index: 0, delta: { reasoning_content: 'thinking one ' }, finish_reason: null }] }));
    await new Promise((r) => setTimeout(r, 150));
    if (res.destroyed) return;
    res.write(sse({ ...base, choices: [{ index: 0, delta: { reasoning_content: 'thinking two ' }, finish_reason: null }] }));
    await new Promise((r) => setTimeout(r, 150));
    if (res.destroyed) return;
    res.write(sse({ ...base, choices: [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }] }));
    res.write('data: [DONE]\n\n'); res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as any).port;
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-ds-key';
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const model = (): ModelConfig => ({
  id: 'deepseek-v4-flash', modelId: 'deepseek-chat', provider: 'deepseek',
  reasoning: { supported: true }, tools: { supported: true },
  limits: { contextWindow: 1000000, outputTokens: 393216 },
  parameters: { maxTokens: { supported: true, paramName: 'max_tokens' } },
  api: { pattern: 'chat/completions', endpoint: `http://127.0.0.1:${port}/chat/completions`, apiKeyEnvVar: 'DEEPSEEK_API_KEY' },
} as unknown as ModelConfig);
const req = (): PreparedRequest => ({ messages: [{ role: 'user', content: 'hi' }] as any, tools: [], headers: {}, parameters: { max_tokens: 64 }, modelId: 'deepseek-v4-flash' } as any);
const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms))]);

describe('R238 stream abort settles finalMessage', () => {
  it('breaking out after the first chunk resolves finalMessage with finish_reason aborted and the partial reasoning', async () => {
    const client = new APIClient();
    const resp = client.streamRequest(req(), model());
    for await (const _c of resp.chunks) { break; } // the consumer aborts (tail-loop guard / ESC pattern)
    const fm = await withTimeout(resp.finalMessage, 3000);
    expect(fm.choices[0].finish_reason).toBe('aborted');
    expect(fm.x_partial).toBe(true);
    expect(String(fm.choices[0].message.reasoning_content ?? '')).toContain('thinking one');
    expect(fm.x_estimated_output_tokens).toBeGreaterThan(0);
  });
  it('a stream that runs to the end is untouched: finish_reason stop, no partial marker', async () => {
    const client = new APIClient();
    const resp = client.streamRequest(req(), model());
    for await (const _c of resp.chunks) { /* drain */ }
    const fm = await withTimeout(resp.finalMessage, 3000);
    expect(fm.choices[0].finish_reason).toBe('stop');
    expect(fm.x_partial).toBeUndefined();
    expect(fm.choices[0].message.content).toBe('done');
  });
});
