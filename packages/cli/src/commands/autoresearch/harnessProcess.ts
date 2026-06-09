/**
 * harnessProcess — process lifecycle for benching a built harness.
 *
 * `cortex autoresearch experiment` needs to run TWO harness builds (base +
 * candidate) as live servers so the bench can actually exercise different code.
 * This module owns the subprocess side: build a checkout, start its server on an
 * isolated port, health-check it, and tear it down. `serverRunner` is the
 * `HarnessRunner` that POSTs prompts to a running server (shared with
 * `cortex autoresearch bench`).
 */
import { spawn } from 'node:child_process';
import * as net from 'node:net';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { HarnessRunner, HarnessRunResult } from '@nexus-cortex/core';

/** HarnessRunner that drives a running cortex server's /v1/messages endpoint. */
export function serverRunner(serverUrl: string, model: string | undefined): HarnessRunner {
  return {
    async run(prompt: string, opts?: { model?: string }): Promise<HarnessRunResult> {
      const useModel = opts?.model ?? model;
      const started = Date.now();
      const resp = await fetch(`${serverUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: useModel, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!resp.ok) throw new Error(`server ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      const data: any = await resp.json();
      const content = data.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.filter((b: any) => b?.type === 'text' || typeof b?.text === 'string').map((b: any) => b.text ?? '').join('')
          : String(content ?? '');
      // The server returns `model` as an OBJECT ({id, provider}), not a string —
      // extract the id (fall back to the requested model).
      const m = data.model;
      const modelId = typeof m === 'string' ? m
        : (m && typeof m === 'object' && typeof m.id === 'string') ? m.id
        : useModel;
      return {
        text,
        modelId,
        inputTokens: data.usage?.inputTokens ?? 0,
        outputTokens: data.usage?.outputTokens ?? 0,
        toolCallCount: Array.isArray(data.toolUses) ? data.toolUses.length : (data.metadata?.toolCallIterations ?? 0),
        latencyMs: Date.now() - started,
      };
    },
  };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Ask the OS for a free TCP port. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/** Short git SHA of a checkout (the harness version label). 'unknown' off-git. */
export function gitShortSha(dir: string): string {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || 'unknown';
  } catch { return 'unknown'; }
}

/** `npm run build` in a checkout. Rejects on non-zero exit (build.sh exits 0 on
 *  the expected/suppressed executors Pass-1 errors, so a non-zero here is real). */
export function buildDir(dir: string, log: (m: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    log(`build ${dir}`);
    const proc = spawn('npm', ['run', 'build'], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr?.on('data', d => { err += String(d); });
    proc.once('error', reject);
    proc.once('exit', code => code === 0 ? resolve() : reject(new Error(`build failed in ${dir} (exit ${code}): ${err.slice(-400)}`)));
  });
}

export interface ServerHandle {
  url: string;
  stop: () => void;
}

/**
 * Spawn a cortex server from a checkout on a given port and wait for /health.
 * MODEL_ROUTER_RECORD is forced off so the server's own auto-record (the flat-75
 * stub) never pollutes the shared experiment store — only the bench's graded
 * records count.
 */
export async function startServer(
  dir: string,
  port: number,
  log: (m: string) => void,
  opts: { healthTimeoutMs?: number } = {},
): Promise<ServerHandle> {
  const entry = path.join(dir, 'packages', 'server', 'dist', 'index.js');
  log(`serve ${dir} on :${port}`);
  const proc = spawn('node', [entry], {
    cwd: dir,
    // The server resolves the orchestrator's project context from PROJECT_PATH
    // (falling back to cwd) — NOT PROJECT_ROOT. Set both so the candidate's
    // .cortex/ (system messages, CORTEX.md, agents) resolves to its own dir
    // regardless of cwd, so a candidate's project-level config actually takes.
    env: { ...process.env, PORT: String(port), PROJECT_PATH: dir, PROJECT_ROOT: dir, MODEL_ROUTER_RECORD: 'false' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr?.on('data', d => { stderr += String(d); });
  let exited = false;
  proc.once('exit', () => { exited = true; });

  const url = `http://localhost:${port}`;
  const stop = () => { try { proc.kill('SIGTERM'); } catch { /* */ } };

  const deadline = Date.now() + (opts.healthTimeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    if (exited) { throw new Error(`server (${dir}) exited before ready: ${stderr.slice(-400)}`); }
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return { url, stop };
    } catch { /* not up yet */ }
    await sleep(500);
  }
  stop();
  throw new Error(`server (${dir}) did not become healthy within timeout: ${stderr.slice(-400)}`);
}
