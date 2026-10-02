/**
 * R219 — the lift-plan session gate through the real tool loop (both loops): headless plans, an interactive session
 * does not (bench-lite keeps it closed), and the explicit CORTEX_LIFT_PLAN_INTERACTIVE=true opt-in still opens it.
 * The planner call is stubbed on the orchestrator's own HelperModelMiddleware; the plan's delivery is read off the wire.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOrchestrator } from '../OrchestratorFactory.js';
import { APIClient, type APIResponse } from '../APIClient.js';
import { applyInteractiveProfile } from '../../config/interactiveProfile.js';

const PLAN = 'R219-STUB-PLAN: step one';

class ScriptedRounds extends APIClient {
  public requests: any[] = [];
  private n = 0;
  private data(): any {
    this.n++;
    const usage = { input_tokens: 1000 * this.n, output_tokens: 5 };
    if (this.n === 1) return { id: 'm1', type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo hi', description: 'look' } }], stop_reason: 'tool_use', usage };
    return { id: `m${this.n}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FINAL: done.' }], stop_reason: 'end_turn', usage };
  }
  override async sendRequest(req: any): Promise<APIResponse> { this.requests.push(JSON.parse(JSON.stringify(req.messages))); return { data: this.data(), status: 200, headers: {} }; }
  override streamRequest(req: any): any {
    this.requests.push(JSON.parse(JSON.stringify(req.messages)));
    const d = this.data();
    async function* none(): AsyncGenerator<any> { /* finalMessage carries the content */ }
    return { chunks: none(), finalMessage: Promise.resolve(d) };
  }
}

describe('R219 lift-plan session gate (loop integration)', () => {
  let dir: string;
  const PINNED: Record<string, string> = { CORTEX_LIFT_PLAN: 'true', CORTEX_ENDTURN_RESOLVER: 'false', CORTEX_ENDTURN_GATE: 'false', CORTEX_LIFT_NUDGE: 'false', CORTEX_INVENTORY: '0', CORTEX_LIFT_PLAN_TOOL_ROUNDS: '1' };
  const LEVERS = ['CORTEX_LIFT_PLAN_INTERACTIVE', 'CORTEX_INTERACTIVE_PROFILE', 'CORTEX_INTERACTIVE_PROFILE_APPLIED', 'CORTEX_LOOP_TOOL_BLOCK', 'CORTEX_EMPTY_TURN_CONTINUE', 'CORTEX_WALL_DROP', 'CORTEX_WALL_SUMMARY', 'CORTEX_REASONING_EXHAUST_BACKOFF', 'CORTEX_STEER_INPUTS', 'CORTEX_ORIENT_V2'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r219-gate-'));
    for (const k of [...Object.keys(PINNED), ...LEVERS]) saved[k] = process.env[k];
    for (const [k, v] of Object.entries(PINNED)) process.env[k] = v;
    for (const k of LEVERS) delete process.env[k];
    if (!process.env.ANTHROPIC_API_KEY) { saved.ANTHROPIC_API_KEY = undefined; process.env.ANTHROPIC_API_KEY = 'test-placeholder-not-used'; }
  });
  afterEach(() => {
    for (const k of [...Object.keys(PINNED), ...LEVERS]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    if ('ANTHROPIC_API_KEY' in saved && saved.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function run(mode: 'sendMessage' | 'streamMessage', autoApproveActions: boolean) {
    const api = new ScriptedRounds();
    const orch = await createOrchestrator({
      defaultModelId: 'claude-haiku-4-5', projectPath: dir, storageDir: path.join(dir, '.cortex/sessions'), debug: !!process.env.TS_DEBUG,
      loopControl: { maxConsecutiveErrors: 999, maxToolIterations: 20, maxLoopRepetitions: 999 },
      __apiClientOverride: api,
    } as any, { enablePermissions: false });
    await orch.createSession(dir, 'claude-haiku-4-5');
    orch.setApprovalMode({ autoApproveActions }); // false = the interactive-TTY default
    const planSpy = vi.spyOn((orch as any).helperMiddleware, 'generateTaskPlan').mockResolvedValue(PLAN);
    if (mode === 'sendMessage') await orch.sendMessage('do the task');
    else for await (const _c of orch.streamMessage('do the task')) { /* drain */ }
    await orch.cleanup().catch(() => {});
    return { calls: planSpy.mock.calls.length, delivered: api.requests.some((r) => JSON.stringify(r).includes(PLAN)) };
  }

  for (const mode of ['sendMessage', 'streamMessage'] as const) {
    it(`${mode}: headless → the planner fires once and the plan rides the wire`, async () => {
      expect(await run(mode, true)).toEqual({ calls: 1, delivered: true });
    }, 60_000); // the planner path gathers the env report (recon commands) before the stubbed call

    it(`${mode}: interactive, bench-lite profile applied → no planner call`, async () => {
      process.env.CORTEX_INTERACTIVE_PROFILE = 'bench-lite';
      applyInteractiveProfile(process.env, { interactive: true });
      expect(process.env.CORTEX_WALL_DROP).toBe('on'); // the profile really applied
      expect(await run(mode, false)).toEqual({ calls: 0, delivered: false });
    }, 60_000);

    it(`${mode}: interactive + explicit CORTEX_LIFT_PLAN_INTERACTIVE=true → plans`, async () => {
      process.env.CORTEX_LIFT_PLAN_INTERACTIVE = 'true';
      expect(await run(mode, false)).toEqual({ calls: 1, delivered: true });
    }, 60_000);
  }
});
