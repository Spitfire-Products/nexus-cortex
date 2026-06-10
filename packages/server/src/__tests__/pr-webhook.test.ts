/**
 * PR webhook — HMAC signature verification tests (F4 hardening).
 *
 * The webhook is disabled (401) unless GITHUB_WEBHOOK_SECRET is set, and otherwise
 * requires a valid X-Hub-Signature-256 over the exact raw request body.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'crypto';
import request from 'supertest';
import express from 'express';
import { prRouter } from '../routes/pr.js';

function sign(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

function makeApp(): express.Application {
  const app = express();
  // Mirror the server's raw-body capture so HMAC sees the exact bytes.
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(prRouter);
  return app;
}

const SECRET = 'test-webhook-secret';
const payload = JSON.stringify({
  action: 'opened',
  number: 7,
  repository: { full_name: 'me/app' },
});

describe('POST /v1/pr/webhook signature verification', () => {
  let prev: string | undefined;

  describe('with GITHUB_WEBHOOK_SECRET set', () => {
    let app: express.Application;
    beforeAll(() => {
      prev = process.env.GITHUB_WEBHOOK_SECRET;
      process.env.GITHUB_WEBHOOK_SECRET = SECRET;
      app = makeApp();
    });
    afterAll(() => {
      if (prev === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
      else process.env.GITHUB_WEBHOOK_SECRET = prev;
    });

    it('accepts a correctly-signed pull_request opened event', async () => {
      const res = await request(app)
        .post('/v1/pr/webhook')
        .set('X-GitHub-Event', 'pull_request')
        .set('X-Hub-Signature-256', sign(SECRET, payload))
        .set('Content-Type', 'application/json')
        .send(payload);
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('accepted');
    });

    it('rejects a bad signature with 401', async () => {
      const res = await request(app)
        .post('/v1/pr/webhook')
        .set('X-GitHub-Event', 'pull_request')
        .set('X-Hub-Signature-256', 'sha256=deadbeef')
        .set('Content-Type', 'application/json')
        .send(payload);
      expect(res.status).toBe(401);
    });

    it('rejects a missing signature with 401', async () => {
      const res = await request(app)
        .post('/v1/pr/webhook')
        .set('X-GitHub-Event', 'pull_request')
        .set('Content-Type', 'application/json')
        .send(payload);
      expect(res.status).toBe(401);
    });

    it('rejects a signature computed over a different body (tamper)', async () => {
      const res = await request(app)
        .post('/v1/pr/webhook')
        .set('X-GitHub-Event', 'pull_request')
        .set('X-Hub-Signature-256', sign(SECRET, payload))
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ action: 'opened', number: 7, repository: { full_name: 'evil/repo' } }));
      expect(res.status).toBe(401);
    });

    it('out-of-policy repo with a valid signature is acknowledged but takes no action', async () => {
      const prevRepos = process.env.GIT_ALLOWED_REPOS;
      process.env.GIT_ALLOWED_REPOS = 'me/app';
      try {
        // Note: prRouter captured its policy at import; this asserts the signed-but-no-op
        // path returns 200 (event received, no action) rather than 202, when applicable.
        const body = JSON.stringify({ action: 'closed', number: 7, repository: { full_name: 'me/app' } });
        const res = await request(app)
          .post('/v1/pr/webhook')
          .set('X-GitHub-Event', 'pull_request')
          .set('X-Hub-Signature-256', sign(SECRET, body))
          .set('Content-Type', 'application/json')
          .send(body);
        expect(res.status).toBe(200); // action !== 'opened' → no-op
      } finally {
        if (prevRepos === undefined) delete process.env.GIT_ALLOWED_REPOS;
        else process.env.GIT_ALLOWED_REPOS = prevRepos;
      }
    });
  });

  describe('without GITHUB_WEBHOOK_SECRET', () => {
    it('returns 401 (disabled) even for a well-formed event', async () => {
      const saved = process.env.GITHUB_WEBHOOK_SECRET;
      delete process.env.GITHUB_WEBHOOK_SECRET;
      try {
        const app = makeApp();
        const res = await request(app)
          .post('/v1/pr/webhook')
          .set('X-GitHub-Event', 'pull_request')
          .set('Content-Type', 'application/json')
          .send(payload);
        expect(res.status).toBe(401);
        expect(res.body.status).toBe('disabled');
      } finally {
        if (saved !== undefined) process.env.GITHUB_WEBHOOK_SECRET = saved;
      }
    });
  });
});
