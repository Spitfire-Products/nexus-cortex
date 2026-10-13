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
    const outDir = path.join(stateRoot, 'attempts');
    const env = { ...process.env, CORTEX_SECOND_ATTEMPT: '1', CORTEX_SECOND_ATTEMPT_MAX: '2', CORTEX_SECOND_ATTEMPT_OUT_DIR: outDir, CORTEX_TURN_DEADLINE_MS: String(4 * 3600 * 1000) } as NodeJS.ProcessEnv;
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
    // R245: with an OUT_DIR the canonical trajectory files are the PICK's (pick 2 ≠ 1) — byte-equal to the attempt-2 copies
    for (const f of ['session', 'decisions']) {
      const a2 = path.join(outDir, `${f}.attempt2.jsonl`);
      if (fs.existsSync(a2)) expect(fs.readFileSync(path.join(outDir, `${f}.jsonl`), 'utf-8')).toBe(fs.readFileSync(a2, 'utf-8'));
    }
    expect(lines.some((l) => l.includes('workspace snapshot lift'))).toBe(true);
    expect(lines.some((l) => l.includes('tree reset to lift; starting attempt 2'))).toBe(true);
    // the decision events landed in attempt 1's decision store
    const dec = fs.readFileSync(path.join(stateRoot, 'decisions.jsonl'), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((d) => d.kind === 'second_attempt');
    expect(dec.filter((d) => d.detail.phase === 'decision').length).toBe(3);
    expect(dec.find((d) => d.detail.phase === 'selection')!.detail.pick).toBe(2);
    expect(snapTags).toBeDefined();
    await a1.cleanup().catch(() => {});
  }, 120_000);

  it('R251 judge mode: one comparative call ranks the attempts; the shipped-check gate stays hard; packets + reply are banked', async () => {
    const outDir = path.join(stateRoot, 'attempts');
    const env = { ...process.env, CORTEX_SECOND_ATTEMPT: '1', CORTEX_SECOND_ATTEMPT_MAX: '2', CORTEX_SECOND_ATTEMPT_SELECT: 'judge', CORTEX_SECOND_ATTEMPT_OUT_DIR: outDir, CORTEX_TURN_DEADLINE_MS: String(4 * 3600 * 1000) } as NodeJS.ProcessEnv;
    const a1 = await orch(new ScriptedWriter(ws, 'bad1', 300));
    (a1 as any).getLastResolverDecision = () => ({ action: 'accept-with-gap', confidence: 'low', namedPassed: 1, remainingFrac: 0.9, plan: '1. the answer is wrong', ts: Date.now() });
    (a1 as any).getLiftPlanText = () => 'PLAN: write good';
    const calls: Array<{ body: string; n: number }> = [];
    const r = await runWithAttempts({
      orchestrator: a1, turnContent: 'write the answer', messageOptions: {}, projectPath: ws, env, t0Ms: Date.now(), log: () => {},
      compareAttempts: async (body, n) => { calls.push({ body, n }); return 'RANKING: 1, 3, 2\nREASON: attempt 3 changed the most'; },
      createAttemptOrchestrator: async (k, spec) => {
        const o = await orch(new ScriptedWriter(ws, 'good2', 100), spec);
        (o as any).getLastResolverDecision = () => ({ action: 'accept-with-gap', confidence: 'medium', namedPassed: 0, remainingFrac: 0.9, plan: `open item ${k}`, ts: Date.now() });
        return o;
      },
    });
    expect(calls.length).toBe(1); expect(calls[0]!.n).toBe(3);
    expect(calls[0]!.body).toContain('TASK:\nwrite the answer');
    expect(calls[0]!.body).toContain('PLAN OF ATTACK (advisory; the TASK wins where they disagree):\nPLAN: write good');
    expect(calls[0]!.body).toContain('RESOLVER OPEN ITEMS (its fix plan — grade whether they are real):\n1. the answer is wrong');
    expect(calls[0]!.body).toContain('FILES CHANGED vs the task start (git diff --stat):');
    expect(calls[0]!.body).toContain('FINAL MESSAGE:\nFINAL: wrote good2.');
    // attempt 1 fails the shipped check → ineligible even though ranked first; among {2,3} the judge's order puts 3 first
    const sel = JSON.parse(fs.readFileSync(path.join(outDir, 'second-attempt.json'), 'utf-8'));
    expect(sel.selectMode).toBe('judge'); expect(sel.pick).toBe(3); expect(sel.evidencePick).toBe(2);
    expect(sel.judgeRanking).toEqual([1, 3, 2]); expect(sel.judgeParsed).toBe(true); expect(sel.judgeReason).toBe('attempt 3 changed the most');
    expect(sel.why).toBe('shipped check passes only on attempt 2,3; judge ranking 1 > 3 > 2 (attempt 3)');
    expect((r.metadata as any).secondAttempt.pick).toBe(3);
    const jp = JSON.parse(fs.readFileSync(path.join(outDir, 'judge-packets.json'), 'utf-8'));
    expect(jp.packets.map((p: any) => p.k)).toEqual([1, 2, 3]); expect(jp.packets[0].check).toBe('fail'); expect(jp.packets[2].check).toBe('pass'); expect(jp.reply).toContain('RANKING');
    const dec = fs.readFileSync(path.join(stateRoot, 'decisions.jsonl'), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((d) => d.kind === 'second_attempt');
    const j = dec.find((d) => d.detail.phase === 'judge'); expect(j.detail.pick).toBe(3); expect(j.detail.evidencePick).toBe(2);
    expect(dec.find((d) => d.detail.phase === 'selection')!.detail.selectMode).toBe('judge');
    await a1.cleanup().catch(() => {});
  }, 120_000);

  it('R251 judge mode: a blank reply keeps the evidence-order pick and says so', async () => {
    const outDir = path.join(stateRoot, 'attempts');
    const env = { ...process.env, CORTEX_SECOND_ATTEMPT: '1', CORTEX_SECOND_ATTEMPT_MAX: '1', CORTEX_SECOND_ATTEMPT_SELECT: 'judge', CORTEX_SECOND_ATTEMPT_OUT_DIR: outDir, CORTEX_TURN_DEADLINE_MS: String(4 * 3600 * 1000) } as NodeJS.ProcessEnv;
    const a1 = await orch(new ScriptedWriter(ws, 'bad1', 300));
    (a1 as any).getLastResolverDecision = () => ({ action: 'accept-with-gap', namedPassed: 1, remainingFrac: 0.9, ts: Date.now() });
    await runWithAttempts({
      orchestrator: a1, turnContent: 'write', messageOptions: {}, projectPath: ws, env, t0Ms: Date.now(), log: () => {},
      compareAttempts: async () => '',
      createAttemptOrchestrator: async (_k, spec) => { const o = await orch(new ScriptedWriter(ws, 'good2', 100), spec); (o as any).getLastResolverDecision = () => ({ action: 'accept-with-gap', namedPassed: 0, remainingFrac: 0.9, ts: Date.now() }); return o; },
    });
    const sel = JSON.parse(fs.readFileSync(path.join(outDir, 'second-attempt.json'), 'utf-8'));
    expect(sel.selectMode).toBe('judge'); expect(sel.judgeParsed).toBe(false); expect(sel.pick).toBe(2); expect(sel.evidencePick).toBe(2);
    expect(sel.why).toMatch(/^judge reply blank; evidence order: /);
    await a1.cleanup().catch(() => {});
  }, 120_000);

  it('does nothing beyond attempt 1 when the verdict is a confident accept under the NARROW trigger, or the lever is off', async () => {
    const a1 = await orch(new ScriptedWriter(ws, 'bad1', 300));
    (a1 as any).getLastResolverDecision = () => ({ action: 'accept', namedPassed: 2, remainingFrac: 0.9, ts: Date.now() });
    let made = 0;
    const env = { ...process.env, CORTEX_SECOND_ATTEMPT: '1', CORTEX_SECOND_ATTEMPT_TRIGGER: 'accept-with-gap,accept-low-confidence', CORTEX_TURN_DEADLINE_MS: String(4 * 3600 * 1000) } as NodeJS.ProcessEnv;
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

  it('R254 informed retry: attempt 2 receives the prior attempts block (verdict, open items, reading, final message); block banked + event; R252 prune count recorded', async () => {
    const outDir = path.join(stateRoot, 'attempts');
    const env = { ...process.env, CORTEX_SECOND_ATTEMPT: '1', CORTEX_SECOND_ATTEMPT_MAX: '1', CORTEX_SECOND_ATTEMPT_INFORMED: '1', CORTEX_SECOND_ATTEMPT_OUT_DIR: outDir, CORTEX_TURN_DEADLINE_MS: String(4 * 3600 * 1000) } as NodeJS.ProcessEnv;
    const a1 = await orch(new ScriptedWriter(ws, 'bad1', 300));
    (a1 as any).getLastResolverDecision = () => ({ action: 'accept-with-gap', confidence: 'low', namedPassed: 1, remainingFrac: 0.9, plan: '1. the answer is wrong', ts: Date.now() });
    (a1 as any).getLiftPlanText = () => 'PLAN: write bad';
    const seen: unknown[] = [];
    await runWithAttempts({
      orchestrator: a1, turnContent: 'write the answer', messageOptions: {}, projectPath: ws, env, t0Ms: Date.now(), log: () => {},
      createAttemptOrchestrator: async (_k, spec) => {
        const o = await orch(new ScriptedWriter(ws, 'good2', 100), spec);
        const orig = o.sendMessage.bind(o); (o as any).sendMessage = (c: unknown, m: unknown) => { seen.push(c); return orig(c as any, m as any); };
        (o as any).getLastResolverDecision = () => ({ action: 'accept', namedPassed: 0, remainingFrac: 0.9, ts: Date.now() });
        return o;
      },
    });
    expect(seen.length).toBe(1); const c = String(seen[0]);
    expect(c.startsWith('write the answer\n\n=== PRIOR INDEPENDENT ATTEMPTS AT THIS TASK (1) ===')).toBe(true);
    expect(c).toContain('--- prior attempt 1 ---\nverdict: accept-with-gap (confidence low)'); expect(c).toContain('1. the answer is wrong'); expect(c).toContain('PLAN: write bad'); expect(c).toContain('FINAL: wrote bad1.');
    expect(fs.readFileSync(path.join(outDir, 'informed.attempt2.txt'), 'utf-8')).toContain('PRIOR INDEPENDENT ATTEMPTS');
    const sel = JSON.parse(fs.readFileSync(path.join(outDir, 'second-attempt.json'), 'utf-8'));
    expect(sel.pick).toBe(2); expect(sel.informed).toBe(true); expect(typeof sel.restorePruned).toBe('number'); expect(sel.restorePruned).toBeGreaterThanOrEqual(0);
    const dec = fs.readFileSync(path.join(stateRoot, 'decisions.jsonl'), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((d) => d.kind === 'second_attempt');
    const inf = dec.find((d) => d.detail.phase === 'informed'); expect(inf.detail.k).toBe(2); expect(inf.detail.priors).toEqual([1]);
    expect(dec.find((d) => d.detail.phase === 'selection')!.detail.informed).toBe(true);
    await a1.cleanup().catch(() => {});
  }, 120_000);
});
