/**
 * R210 HB-PLATEAU-STOP loop integration (CORTEX_PLATEAU_STOP). Scripted API: four rounds, each one Bash call that echoes a flat
 * `PLATEAU_METRIC score=100 dir=max`, then an answer. Off: no instruction, no plateau reminder, STATUS line carries no score segment
 * (byte-identical to the pre-R210 line shape). On (WINDOW=1, MIN_POINTS=2): the boot instruction rides the first tool_result, the
 * plateau reminder arrives on the budget-steering channel, and STATUS carries the score segment with the PLATEAU suffix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOrchestrator } from '../OrchestratorFactory.js';
import { APIClient, type APIResponse } from '../APIClient.js';

class ScriptedRounds extends APIClient {
  public requests: any[] = [];
  private n = 0;
  private data(): any {
    this.n++;
    const usage = { input_tokens: 1000 * this.n, output_tokens: 5 };
    if (this.n <= 4) return { id: `m${this.n}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: `t${this.n}`, name: 'Bash', input: { command: 'echo "PLATEAU_METRIC score=100 dir=max"', description: 'eval' } }], stop_reason: 'tool_use', usage };
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

function statusLines(messages: any[]): string[] {
  return [...JSON.stringify(messages).matchAll(/<system-reminder>STATUS: [^<]*<\/system-reminder>/g)].map((m) => m[0]);
}

describe('R210 HB-PLATEAU-STOP loop integration', () => {
  let dir: string;
  const PINNED: Record<string, string> = { CORTEX_LIFT_PLAN: 'false', CORTEX_ENDTURN_RESOLVER: 'false', CORTEX_LIFT_NUDGE: 'false', CORTEX_TURN_STATUS: 'on', CORTEX_TURN_DEADLINE_MS: '3600000' };
  const LEVERS = ['CORTEX_PLATEAU_STOP', 'CORTEX_PLATEAU_WINDOW', 'CORTEX_PLATEAU_MIN_POINTS'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plateau-'));
    for (const [k, v] of Object.entries(PINNED)) { saved[k] = process.env[k]; process.env[k] = v; }
    if (!process.env.ANTHROPIC_API_KEY) { saved.ANTHROPIC_API_KEY = undefined; process.env.ANTHROPIC_API_KEY = 'test-placeholder-not-used'; }
  });
  afterEach(() => {
    for (const k of LEVERS) delete process.env[k];
    for (const k of Object.keys(PINNED)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    if ('ANTHROPIC_API_KEY' in saved && saved.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function run(mode: 'sendMessage' | 'streamMessage') {
    const api = new ScriptedRounds();
    const orch = await createOrchestrator({
      defaultModelId: 'claude-haiku-4-5', projectPath: dir, storageDir: path.join(dir, '.cortex/sessions'), debug: !!process.env.TS_DEBUG,
      loopControl: { maxConsecutiveErrors: 999, maxToolIterations: 50, maxLoopRepetitions: 999 },
      __apiClientOverride: api,
    } as any, { enablePermissions: false });
    await orch.createSession(dir, 'claude-haiku-4-5');
    if (mode === 'sendMessage') await orch.sendMessage('optimize the score');
    else for await (const _c of orch.streamMessage('optimize the score')) { /* drain */ }
    await orch.cleanup().catch(() => {});
    return api.requests;
  }

  for (const mode of ['sendMessage', 'streamMessage'] as const) {
    it(`${mode}: off → no instruction, no reminder, STATUS without a score segment`, async () => {
      const reqs = await run(mode);
      expect(reqs.length).toBeGreaterThanOrEqual(5);
      const last = JSON.stringify(reqs[reqs.length - 1]);
      expect(last).toContain('PLATEAU_METRIC score=100 dir=max'); // the metric really reached the tool results
      for (const r of reqs) {
        const j = JSON.stringify(r);
        expect(j).not.toContain('If you are tuning');
        expect(j).not.toContain('PLATEAU:');
      }
      const lines = statusLines(reqs[reqs.length - 1]);
      expect(lines.length).toBe(4);
      for (const l of lines) expect(l).toMatch(/^<system-reminder>STATUS: elapsed 0h0\dm of 1h00m \(\d+%\), ~\d+h\d\dm left(; context ~[^;<]+)?<\/system-reminder>$/);
    });

    it(`${mode}: on → boot instruction, one plateau reminder, STATUS score segment with PLATEAU`, async () => {
      process.env.CORTEX_PLATEAU_STOP = 'on';
      process.env.CORTEX_PLATEAU_WINDOW = '1';
      process.env.CORTEX_PLATEAU_MIN_POINTS = '2';
      const reqs = await run(mode);
      expect(JSON.stringify(reqs[1])).toContain('If you are tuning a continuous objective');
      const last = JSON.stringify(reqs[reqs.length - 1]);
      expect((last.match(/If you are tuning/g) ?? []).length).toBe(1);
      // flat 100s: plateau at point 2 (firing 1), second firing at point 3 (>= window more points), then capped
      expect((last.match(/PLATEAU: your score improved only 0% over the last 1 evaluations/g) ?? []).length).toBe(2);
      const lines = statusLines(reqs[reqs.length - 1]);
      expect(lines[0]).toContain('; score score: best 100 (1 eval)</system-reminder>');
      expect(lines[lines.length - 1]).toContain('; score score: best 100 (4 evals); +0% over last 1 (target ≥0.2%) — PLATEAU</system-reminder>');
    });
  }
});
