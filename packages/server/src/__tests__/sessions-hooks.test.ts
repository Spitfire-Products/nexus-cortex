/**
 * Lifecycle-hook routes (docs/hooks.md, 2026-11-17): POST /sessions/new forwards a valid SessionStart `source` (a scheduled one-shot
 * sends "schedule"); POST /sessions/current/end runs SessionEnd for the current session (the headless one-shot calls it after each reply).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { sessionsRouter } from '../routes/sessions.js';
import { setServerOrchestrator } from '../routes/messages.js';

describe('session lifecycle-hook routes', () => {
  let app: express.Application;
  let createSession: ReturnType<typeof vi.fn>;
  let endSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express(); app.use(express.json()); app.use(sessionsRouter);
    createSession = vi.fn().mockResolvedValue({});
    endSession = vi.fn().mockResolvedValue(undefined);
    setServerOrchestrator({
      createSession, endSession, currentSessionId: 's1', getSessionId: () => 's1',
      getCurrentModel: () => ({ id: 'm', displayName: 'M', provider: 'p', limits: { contextWindow: 1 } }),
    } as any);
  });
  afterEach(() => setServerOrchestrator(null as any));

  it('POST /sessions/new passes source=schedule; an unknown or missing source falls back to the default', async () => {
    await request(app).post('/sessions/new').send({ source: 'schedule' }).expect(200);
    expect(createSession.mock.calls[0][2]).toEqual({ source: 'schedule' });
    await request(app).post('/sessions/new').send({ source: 'rm -rf' }).expect(200);
    expect(createSession.mock.calls[1][2]).toEqual({});
    await request(app).post('/sessions/new').expect(200);
    expect(createSession.mock.calls[2][2]).toEqual({});
  });

  it('POST /sessions/current/end calls endSession with the reason (default "other")', async () => {
    const r = await request(app).post('/sessions/current/end').send({ reason: 'oneshot' }).expect(200);
    expect(endSession).toHaveBeenCalledWith('oneshot');
    expect(r.body).toMatchObject({ success: true, sessionId: 's1', reason: 'oneshot' });
    await request(app).post('/sessions/current/end').expect(200);
    expect(endSession).toHaveBeenLastCalledWith('other');
  });
});
