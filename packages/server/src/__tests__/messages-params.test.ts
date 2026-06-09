/**
 * Request-level sampling params (temperature / max_tokens / top_p) must reach
 * the orchestrator under `options.parameters.*` — the orchestrator only reads
 * `options.parameters?.temperature` / `?.maxTokens`. They were being placed at
 * the top level of messageOptions and silently dropped, so every server
 * request ran at the model-card default regardless of what the client sent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { messagesRouter, setServerOrchestrator } from '../routes/messages.js';

describe('/v1/messages — request sampling params propagation', () => {
  let app: express.Application;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(messagesRouter);
    sendMessage = vi.fn().mockResolvedValue({
      messageId: 'm1', content: [{ type: 'text', text: 'ok' }],
      toolUses: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      model: { id: 'grok-4.3', provider: 'xai' }, metadata: {},
    });
    setServerOrchestrator({
      getCurrentModelId: () => 'grok-4.3',
      sendMessage,
    } as any);
  });

  afterEach(() => setServerOrchestrator(null as any));

  it('forwards temperature / max_tokens / top_p under options.parameters', async () => {
    await request(app).post('/v1/messages').send({
      model: 'grok-4.3',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.4,
      max_tokens: 123,
      top_p: 0.9,
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const opts = sendMessage.mock.calls[0][1];
    expect(opts.parameters?.temperature).toBe(0.4);
    expect(opts.parameters?.maxTokens).toBe(123);
    expect(opts.parameters?.topP).toBe(0.9);
  });

  it('omits a param when the request does not send it (card default applies)', async () => {
    await request(app).post('/v1/messages').send({
      model: 'grok-4.3',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
    });

    const opts = sendMessage.mock.calls[0][1];
    expect(opts.parameters?.temperature).toBe(0.7);
    // No max_tokens/top_p in the request → must NOT be forced (was hard-coded
    // 4096 / 1.0 before; that never reached the model and would override the
    // card default if it now did).
    expect(opts.parameters?.maxTokens).toBeUndefined();
    expect(opts.parameters?.topP).toBeUndefined();
  });
});
