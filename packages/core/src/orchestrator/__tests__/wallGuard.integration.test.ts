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
  public params: any[] = [];
  public wallAt = 0;
  private n = 0;
  constructor(private readonly root: string) { super(); }
  private data(): any {
    this.n++;
    const tu = (id: string) => ({ type: 'tool_use', id, name: TOOL, input: { pattern: `zzz${id}`, path: this.root } });
    const usage = { input_tokens: 1000 * this.n, output_tokens: this.outTokens };
    if (this.wallAt && this.n === this.wallAt) return { id: 'mw', type: 'message', role: 'assistant', content: [{ type: 'thinking', thinking: 'spiral '.repeat(4000), signature: 'sig' }], stop_reason: 'max_tokens', usage: { input_tokens: 1000 * this.n, output_tokens: 65536 } };
    if (this.wallAt && this.n > this.wallAt) this.n = this.n; // continue the script after the wall
    if (this.n === 1) return { id: 'm1', type: 'message', role: 'assistant', content: [tu('t1')], stop_reason: 'tool_use', usage };
    if (this.n === 2) return { id: 'm2', type: 'message', role: 'assistant', content: [tu('t2a'), tu('t2b')], stop_reason: 'tool_use', usage };
    if (this.n === 3) return { id: 'm3', type: 'message', role: 'assistant', content: [tu('t3')], stop_reason: 'tool_use', usage };
    return { id: `m${this.n}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FINAL: nothing found.' }], stop_reason: 'end_turn', usage };
  }
  override async sendRequest(req: any): Promise<APIResponse> { this.requests.push(JSON.parse(JSON.stringify(req.messages))); this.efforts.push(req.parameters?.reasoningEffort); this.params.push(JSON.parse(JSON.stringify(req.parameters ?? {}))); return { data: this.data(), status: 200, headers: {} }; }
  override streamRequest(req: any): any {
    this.requests.push(JSON.parse(JSON.stringify(req.messages))); this.efforts.push(req.parameters?.reasoningEffort); this.params.push(JSON.parse(JSON.stringify(req.parameters ?? {})));
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



describe('wall levers loop integration', () => {
  let dir: string;
  const PINNED: Record<string, string> = { CORTEX_LIFT_PLAN: 'false', CORTEX_ENDTURN_RESOLVER: 'false', CORTEX_LIFT_NUDGE: 'false' };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wall-'));
    for (const [k, v] of Object.entries(PINNED)) { saved[k] = process.env[k]; process.env[k] = v; }
    if (!process.env.ANTHROPIC_API_KEY) { saved.ANTHROPIC_API_KEY = undefined; process.env.ANTHROPIC_API_KEY = 'test-placeholder-not-used'; }
  });
  afterEach(() => {
    for (const k of ['CORTEX_WALL_DROP', 'CORTEX_OUTPUT_CAP_TOKENS', 'CORTEX_WALL_SUMMARY']) delete process.env[k];
    for (const k of Object.keys(PINNED)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    if ('ANTHROPIC_API_KEY' in saved && saved.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function run(mode: 'sendMessage' | 'streamMessage', patch?: (orch: any) => void) {
    const api = new ScriptedRounds(dir);
    api.wallAt = 2; // call 1 = tool round, call 2 = the wall, call 3 = the retry
    const orch = await createOrchestrator({
      defaultModelId: 'claude-haiku-4-5', projectPath: dir, storageDir: path.join(dir, '.cortex/sessions'), debug: !!process.env.TS_DEBUG,
      loopControl: { maxConsecutiveErrors: 999, maxToolIterations: 50, maxLoopRepetitions: 999 },
      __apiClientOverride: api,
    } as any, { enablePermissions: false });
    await orch.createSession(dir, 'claude-haiku-4-5');
    if (patch) patch(orch);
    if (mode === 'sendMessage') await orch.sendMessage('find zzz');
    else for await (const _c of orch.streamMessage('find zzz')) { /* drain */ }
    await orch.cleanup().catch(() => {});
    return api;
  }
  const stubHelper = (orch: any, fn: (ctx: any) => Promise<string>) => {
    if (!orch.helperMiddleware) orch.helperMiddleware = {};
    orch.helperMiddleware.summarizeWalledThinking = fn;
  };
  const hasWalled = (msgs: any[]) => JSON.stringify(msgs).includes('spiral spiral');
  for (const mode of ['sendMessage', 'streamMessage'] as const) {
    // The scripted streaming client delivers only a finalMessage (no reasoning deltas), so the streaming loop never classifies the turn as a
    // reasoning-exhaustion wall — the wall cases run on sendMessage (the bench's /v1/messages path); streamMessage carries the same three
    // edits (applyWallDrop at the R153 retry, text: wallNudge, carrier-gated push) and is covered by the cap case below.
    (mode === 'sendMessage' ? it : it.skip)(`${mode}: CORTEX_WALL_DROP=on → the retry carries no walled turn; the nudge sits at the tail of the newest tool_result`, async () => {
      process.env.CORTEX_WALL_DROP = 'on';
      const api = await run(mode);
      expect(api.requests.length).toBeGreaterThanOrEqual(3);
      const retry = api.requests[2];
      expect(hasWalled(retry)).toBe(false);
      expect(lastToolResultText(retry)).toMatch(/ENTIRE output budget[\s\S]*<\/system-reminder>$/);
      // the retry's messages are the pre-wall request's messages (prefix) with only the tool_result tail extended
      expect(retry.length).toBe(api.requests[1].length);
    });
    (mode === 'sendMessage' ? it : it.skip)(`${mode}: wall drop unset → the walled turn stays in the retry (pre-existing behaviour)`, async () => {
      const api = await run(mode);
      expect(api.requests.length).toBeGreaterThanOrEqual(3);
      expect(hasWalled(api.requests[2]) || JSON.stringify(api.requests[2]).includes('(no output)')).toBe(true);
      expect(api.requests[2].length).toBeGreaterThan(api.requests[1].length);
    });
    (mode === 'sendMessage' ? it : it.skip)(`${mode}: CORTEX_WALL_SUMMARY=on + DROP → the attributed summary rides inside the nudge on the tool_result tail`, async () => {
      process.env.CORTEX_WALL_DROP = 'on'; process.env.CORTEX_WALL_SUMMARY = 'on';
      let seen = '';
      const api = await run(mode, (o) => stubHelper(o, async (ctx) => { seen = ctx.reasoning; return 'CONCLUDED: grep found nothing\nSTUCK ON: which dir\nNEXT: run ls -R'; }));
      const tail = lastToolResultText(api.requests[2]);
      expect(seen).toContain('spiral');
      expect(seen).toContain('characters omitted'); // the 28K-char walled reasoning was clipped head + tail
      expect(tail).toMatch(/summary written by the harness/i);
      expect(tail).toContain('NEXT: run ls -R');
      expect(tail).toMatch(/ENTIRE output budget[\s\S]*<\/system-reminder>$/);
      expect(hasWalled(api.requests[2])).toBe(false);
    });
    (mode === 'sendMessage' ? it : it.skip)(`${mode}: summary helper throws → plain nudge (fail-open)`, async () => {
      process.env.CORTEX_WALL_DROP = 'on'; process.env.CORTEX_WALL_SUMMARY = 'on';
      const api = await run(mode, (o) => stubHelper(o, async () => { throw new Error('helper down'); }));
      const tail = lastToolResultText(api.requests[2]);
      expect(tail).toMatch(/ENTIRE output budget/);
      expect(tail).not.toMatch(/summary written by the harness/i);
    });
    it(`${mode}: CORTEX_OUTPUT_CAP_TOKENS=48000 → every action request carries the cap`, async () => {
      process.env.CORTEX_OUTPUT_CAP_TOKENS = '48000';
      const api = await run(mode);
      for (const p of api.params) expect(JSON.stringify(p)).toContain('48000');
    });
  }
});
