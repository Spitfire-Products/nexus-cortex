import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOrchestrator } from '../OrchestratorFactory.js';
import { APIClient, type APIResponse } from '../APIClient.js';

const TOOL = 'grep';

class ScriptedRounds extends APIClient {
  public requests: any[] = [];
  public efforts: any[] = [];
  public outTokens = 5;
  private n = 0;
  constructor(private readonly root: string) { super(); }
  private data(): any {
    this.n++;
    const tu = (id: string) => ({ type: 'tool_use', id, name: TOOL, input: { pattern: `zzz${id}`, path: this.root } });
    const usage = { input_tokens: 1000 * this.n, output_tokens: this.outTokens };
    if (this.n === 1) return { id: 'm1', type: 'message', role: 'assistant', content: [tu('t1')], stop_reason: 'tool_use', usage };
    if (this.n === 2) return { id: 'm2', type: 'message', role: 'assistant', content: [tu('t2a'), tu('t2b')], stop_reason: 'tool_use', usage };
    if (this.n === 3) return { id: 'm3', type: 'message', role: 'assistant', content: [tu('t3')], stop_reason: 'tool_use', usage };
    return { id: `m${this.n}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FINAL: nothing found.' }], stop_reason: 'end_turn', usage };
  }
  override async sendRequest(req: any): Promise<APIResponse> { this.requests.push(JSON.parse(JSON.stringify(req.messages))); this.efforts.push(req.parameters?.reasoningEffort); return { data: this.data(), status: 200, headers: {} }; }
  override streamRequest(req: any): any {
    this.requests.push(JSON.parse(JSON.stringify(req.messages))); this.efforts.push(req.parameters?.reasoningEffort);
    const d = this.data();
    async function* none(): AsyncGenerator<any> { /* finalMessage carries the content */ }
    return { chunks: none(), finalMessage: Promise.resolve(d) };
  }
}

/** Last tool_result text in a provider (Anthropic-shape) message list. */
function lastToolResultText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i]?.content;
    if (!Array.isArray(c)) continue;
    for (let j = c.length - 1; j >= 0; j--) {
      if (c[j]?.type === 'tool_result') return typeof c[j].content === 'string' ? c[j].content : JSON.stringify(c[j].content);
    }
  }
  return '';
}


/**
 * 2026-09-30 effort levers — mechanism-engagement proof in BOTH loops (scripted API, no network):
 *  HB-EFFORT-RAMP: the first N main calls carry the ramp level, then the configured effort; unset = untouched.
 *  HB-COMPUTE-NUDGE: a heavily-reasoned step puts the COMPUTE line at the newest tool_result tail; unset = never.
 */
describe('effort levers loop integration', () => {
  let dir: string;
  const PINNED: Record<string, string> = { CORTEX_LIFT_PLAN: 'false', CORTEX_ENDTURN_RESOLVER: 'false', CORTEX_LIFT_NUDGE: 'false' };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efflev-'));
    for (const [k, v] of Object.entries(PINNED)) { saved[k] = process.env[k]; process.env[k] = v; }
    if (!process.env.ANTHROPIC_API_KEY) { saved.ANTHROPIC_API_KEY = undefined; process.env.ANTHROPIC_API_KEY = 'test-placeholder-not-used'; }
  });
  afterEach(() => {
    for (const k of ['CORTEX_EFFORT_RAMP', 'CORTEX_COMPUTE_NUDGE', 'CORTEX_COMPUTE_NUDGE_TOKENS', 'CORTEX_COMPUTE_NUDGE_COOLDOWN']) delete process.env[k];
    for (const k of Object.keys(PINNED)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    if ('ANTHROPIC_API_KEY' in saved && saved.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function run(mode: 'sendMessage' | 'streamMessage', outTokens = 5) {
    const api = new ScriptedRounds(dir);
    api.outTokens = outTokens;
    const orch = await createOrchestrator({
      defaultModelId: 'claude-haiku-4-5', projectPath: dir, storageDir: path.join(dir, '.cortex/sessions'), debug: !!process.env.TS_DEBUG,
      loopControl: { maxConsecutiveErrors: 999, maxToolIterations: 50, maxLoopRepetitions: 999 },
      __apiClientOverride: api,
    } as any, { enablePermissions: false });
    await orch.createSession(dir, 'claude-haiku-4-5');
    if (mode === 'sendMessage') await orch.sendMessage('find zzz', { parameters: { reasoningEffort: 'high' } } as any);
    else for await (const _c of orch.streamMessage('find zzz', { parameters: { reasoningEffort: 'high' } } as any)) { /* drain */ }
    await orch.cleanup().catch(() => {});
    return api;
  }

  for (const mode of ['sendMessage', 'streamMessage'] as const) {
    it(`${mode}: CORTEX_EFFORT_RAMP=low:2-3 → call 1 configured, calls 2-3 low, then configured`, async () => {
      process.env.CORTEX_EFFORT_RAMP = 'low:2-3';
      const api = await run(mode);
      expect(api.efforts.length).toBeGreaterThanOrEqual(4);
      expect(api.efforts.slice(0, 3)).toEqual(['high', 'low', 'low']);
      expect(api.efforts.slice(3).every((e) => e === 'high')).toBe(true);
    });
    it(`${mode}: ramp unset → every call carries the configured effort`, async () => {
      const api = await run(mode);
      expect(api.efforts.every((e) => e === 'high')).toBe(true);
    });
    it(`${mode}: CORTEX_COMPUTE_NUDGE=on + heavy step → COMPUTE line at the tool_result tail (cooldown respected)`, async () => {
      process.env.CORTEX_COMPUTE_NUDGE = 'on';
      process.env.CORTEX_COMPUTE_NUDGE_TOKENS = '10000';
      process.env.CORTEX_COMPUTE_NUDGE_COOLDOWN = '2';
      const api = await run(mode, 34000);
      const texts = api.requests.slice(1).map((r) => lastToolResultText(r));
      expect(texts[0]).toMatch(/COMPUTE, DON'T DELIBERATE: your last step spent ~34K reasoning tokens[\s\S]*<\/system-reminder>$/);
      const all = JSON.stringify(api.requests[api.requests.length - 1]);
      expect((all.match(/COMPUTE, DON'T DELIBERATE/g) ?? []).length).toBe(2); // rounds 1 and 3 (cooldown 2 skips round 2)
    });
    it(`${mode}: compute nudge unset → never`, async () => {
      const api = await run(mode, 34000);
      for (const r of api.requests) expect(JSON.stringify(r)).not.toContain('COMPUTE, DON');
    });
  }
});
