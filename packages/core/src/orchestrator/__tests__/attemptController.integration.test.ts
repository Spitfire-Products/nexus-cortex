/**
 * R239 / P4 — runWithAttempts through the REAL turn loop: two scripted orchestrators (attempt 1 on the caller's instance, attempt 2 on
 * a fresh one from the factory), each writing a different answer with a real Bash tool call; the verdict is stubbed on each instance
 * (the resolver path is covered elsewhere). Asserts: the lift snapshot, the tree reset between attempts (attempt 2 starts from lift),
 * per-attempt state dirs, the selection (shipped check decides), the restored tree, the summed usage, the banked artifacts, the events.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOrchestrator } from '../OrchestratorFactory.js';
import { APIClient, type APIResponse } from '../APIClient.js';
import { runWithAttempts } from '../attemptController.js';
import { WorkspaceSnapshot } from '../../utils/workspaceSnapshot.js';
import { resetCortexStateDirCache } from '../../utils/stateDir.js';

/** call 1 = one Bash tool call that writes `answer.txt` (and records what it saw first), call 2 = end_turn. */
class ScriptedWriter extends APIClient {
  public requests = 0;
  constructor(private readonly ws: string, private readonly content: string, private readonly outTokens: number) { super(); }
  private data(): any {
    this.requests++;
    const usage = { input_tokens: 1000, output_tokens: this.outTokens };
    if (this.requests === 1) return { id: 'm1', type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `cat ${this.ws}/answer.txt > ${this.ws}/seen.txt; printf '${this.content}' > ${this.ws}/answer.txt` } }], stop_reason: 'tool_use', usage };
    return { id: `m${this.requests}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: `FINAL: wrote ${this.content}.` }], stop_reason: 'end_turn', usage };
  }
  override async sendRequest(_req: any): Promise<APIResponse> { return { data: this.data(), status: 200, headers: {} } as any; }
  override streamRequest(_req: any): any { const d = this.data(); async function* none(): AsyncGenerator<any> { /* final carries content */ } return { chunks: none(), finalMessage: Promise.resolve(d) }; }
}

const hasGit = WorkspaceSnapshot.gitAvailable();

describe.skipIf(!hasGit)('R239 runWithAttempts through the turn loop', () => {
  let root: string; let ws: string; let stateRoot: string;
  const PINNED: Record<string, string> = { CORTEX_LIFT_PLAN: 'false', CORTEX_ENDTURN_RESOLVER: 'false', CORTEX_LIFT_NUDGE: 'false', CORTEX_WORKSPACE_CLEAN: '1' };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-int-')); ws = path.join(root, 'ws'); stateRoot = path.join(root, 'state');
    fs.mkdirSync(ws); fs.mkdirSync(stateRoot);
    fs.writeFileSync(path.join(ws, 'answer.txt'), 'lift'); fs.writeFileSync(path.join(ws, 'Makefile'), 'test:\n\tgrep -q good answer.txt\n');
    for (const [k, v] of Object.entries({ ...PINNED, CORTEX_STATE_DIR: stateRoot })) { saved[k] = process.env[k]; process.env[k] = v; }
    if (!process.env.ANTHROPIC_API_KEY) { saved.ANTHROPIC_API_KEY = undefined; process.env.ANTHROPIC_API_KEY = 'test-placeholder-not-used'; }
    resetCortexStateDirCache();
  });
  afterEach(() => {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    if ('ANTHROPIC_API_KEY' in saved && saved.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    resetCortexStateDirCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function orch(api: ScriptedWriter, spec?: { stateDir: string; storageDir: string; turnDeadlineMs: number }) {
    const o = await createOrchestrator({
      defaultModelId: 'claude-haiku-4-5', projectPath: ws, workingDirectory: ws,
      storageDir: spec?.storageDir ?? path.join(stateRoot, 'sessions'), ...(spec ? { stateDir: spec.stateDir } : {}),
      loopControl: { maxConsecutiveErrors: 999, maxToolIterations: 50, maxLoopRepetitions: 999, ...(spec ? { turnDeadlineMs: spec.turnDeadlineMs } : {}) },
      __apiClientOverride: api,
    } as any, { enablePermissions: false });
    await o.createSession(ws, 'claude-haiku-4-5');
    return o;
  }

  it('opens a second attempt on a gap-accept, resets the tree between attempts, picks by the shipped check, restores + merges', async () => {
    const env = { ...process.env, CORTEX_SECOND_ATTEMPT: '1', CORTEX_SECOND_ATTEMPT_MAX: '2', CORTEX_TURN_DEADLINE_MS: String(4 * 3600 * 1000) } as NodeJS.ProcessEnv;
    const a1 = await orch(new ScriptedWriter(ws, 'bad1', 300));
    (a1 as any).getLastResolverDecision = () => ({ action: 'accept-with-gap', namedPassed: 1, remainingFrac: 0.9, ts: Date.now() });
    const made: Array<{ k: number; stateDir: string; storageDir: string; turnDeadlineMs: number }> = [];
    const lines: string[] = [];
    const t0 = Date.now();
    const r = await runWithAttempts({
      orchestrator: a1, turnContent: 'write the answer', messageOptions: {}, projectPath: ws, env, t0Ms: t0, log: (l) => lines.push(l),
      createAttemptOrchestrator: async (k, spec) => {
        made.push({ k, ...spec });
        const o = await orch(new ScriptedWriter(ws, 'good2', 100), spec);
        (o as any).getLastResolverDecision = () => ({ action: 'accept-with-gap', namedPassed: 0, remainingFrac: 0.9, ts: Date.now() });
        return o;
      },
    });
    // attempt 2 ran once (MAX=2 but attempt 2's gap → attempt 3 would need the cap: extraSoFar 1 < 2 → it DOES continue → attempt 3)
    // so: attempts 1, 2, 3 — attempt 3 also writes good2 from a lift tree
    expect(made.map((m) => m.k)).toEqual([2, 3]);
    expect(made[0]!.stateDir).toBe(path.join(stateRoot, 'attempts', 'state-2'));
    expect(made[0]!.turnDeadlineMs).toBeGreaterThan(3 * 3600 * 1000);
    // every extra attempt started from the LIFT tree (seen.txt = what the tool read before writing)
    const snapTags = new WorkspaceSnapshot({ workspace: ws, gitDir: path.join(stateRoot, 'attempts', 'shadow.git') });
    expect(fs.existsSync(path.join(stateRoot, 'attempts', 'shadow.git'))).toBe(true);
    expect(fs.readFileSync(path.join(ws, 'answer.txt'), 'utf-8')).toBe('good2'); // the shipped check passes only on attempts 2,3 → fewest turns tie → earliest = 2
    expect(fs.readFileSync(path.join(ws, 'seen.txt'), 'utf-8')).toBe('lift');
    const sel = JSON.parse(fs.readFileSync(path.join(stateRoot, 'attempts', 'second-attempt.json'), 'utf-8'));
    expect(sel.pick).toBe(2); expect(sel.why).toContain('shipped check passes only on attempt 2,3'); expect(sel.shippedCheck).toBe('make test');
    expect(sel.attempts.map((a: any) => a.check)).toEqual(['fail', 'pass', 'pass']);
    expect((r.metadata as any).secondAttempt.pick).toBe(2);
    expect(r.usage.session!.requests).toBe(6); // 2 requests per attempt × 3
    expect(r.usage.session!.outputTokens).toBe(300 * 2 + 100 * 2 + 100 * 2);
    for (const k of [1, 2, 3]) {
      expect(fs.existsSync(path.join(stateRoot, 'attempts', `response.attempt${k}.json`)), `response ${k}`).toBe(true);
      expect(fs.existsSync(path.join(stateRoot, 'attempts', `a${k}.json`)), `decision ${k}`).toBe(true);
    }
    expect(fs.existsSync(path.join(stateRoot, 'attempts', 'state-2', 'sessions'))).toBe(true);
    expect(lines.some((l) => l.includes('workspace snapshot lift'))).toBe(true);
    expect(lines.some((l) => l.includes('tree reset to lift; starting attempt 2'))).toBe(true);
    // the decision events landed in attempt 1's decision store
    const dec = fs.readFileSync(path.join(stateRoot, 'decisions.jsonl'), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((d) => d.kind === 'second_attempt');
    expect(dec.filter((d) => d.detail.phase === 'decision').length).toBe(3);
    expect(dec.find((d) => d.detail.phase === 'selection')!.detail.pick).toBe(2);
    expect(snapTags).toBeDefined();
    await a1.cleanup().catch(() => {});
  }, 120_000);

  it('does nothing beyond attempt 1 when the verdict is a confident accept (default trigger) or the lever is off', async () => {
    const a1 = await orch(new ScriptedWriter(ws, 'bad1', 300));
    (a1 as any).getLastResolverDecision = () => ({ action: 'accept', namedPassed: 2, remainingFrac: 0.9, ts: Date.now() });
    let made = 0;
    const env = { ...process.env, CORTEX_SECOND_ATTEMPT: '1', CORTEX_TURN_DEADLINE_MS: String(4 * 3600 * 1000) } as NodeJS.ProcessEnv;
    const r = await runWithAttempts({ orchestrator: a1, turnContent: 'write', messageOptions: {}, projectPath: ws, env, log: () => {}, createAttemptOrchestrator: async () => { made++; throw new Error('must not be called'); } });
    expect(made).toBe(0); expect(fs.readFileSync(path.join(ws, 'answer.txt'), 'utf-8')).toBe('bad1');
    expect((r.metadata as any).secondAttempt).toBeUndefined();
    expect(fs.existsSync(path.join(stateRoot, 'attempts', 'second-attempt.json'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(stateRoot, 'attempts', 'a1.json'), 'utf-8')).why).toBe('action not in trigger set');
    await a1.cleanup().catch(() => {});
    // lever off: no snapshot at all
    const a2 = await orch(new ScriptedWriter(ws, 'plain', 10));
    const r2 = await runWithAttempts({ orchestrator: a2, turnContent: 'write', messageOptions: {}, projectPath: ws, env: { ...process.env } as NodeJS.ProcessEnv, log: () => {}, createAttemptOrchestrator: async () => { throw new Error('no'); } });
    expect(r2.usage.session!.requests).toBe(2);
    expect(fs.readFileSync(path.join(ws, 'answer.txt'), 'utf-8')).toBe('plain');
    await a2.cleanup().catch(() => {});
  }, 120_000);
});
