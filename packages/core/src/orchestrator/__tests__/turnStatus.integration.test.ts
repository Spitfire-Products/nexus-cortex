/**
 * HB-TURN-STATUS (CORTEX_TURN_STATUS): the STATUS tail must fire on EVERY tool-result round in BOTH loops (sendMessage and
 * streamMessage), sit at the tail of the newest tool_result, and leave every earlier request's message prefix byte-identical.
 * Unset = no STATUS anywhere. Scripted API: round 1 one tool, round 2 two parallel tools, round 3 one tool, then an answer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOrchestrator } from '../OrchestratorFactory.js';
import { APIClient, type APIResponse } from '../APIClient.js';

const TOOL = 'grep';

class ScriptedRounds extends APIClient {
  public requests: any[] = [];
  private n = 0;
  constructor(private readonly root: string) { super(); }
  private data(): any {
    this.n++;
    const tu = (id: string) => ({ type: 'tool_use', id, name: TOOL, input: { pattern: `zzz${id}`, path: this.root } });
    const usage = { input_tokens: 1000 * this.n, output_tokens: 5 };
    if (this.n === 1) return { id: 'm1', type: 'message', role: 'assistant', content: [tu('t1')], stop_reason: 'tool_use', usage };
    if (this.n === 2) return { id: 'm2', type: 'message', role: 'assistant', content: [tu('t2a'), tu('t2b')], stop_reason: 'tool_use', usage };
    if (this.n === 3) return { id: 'm3', type: 'message', role: 'assistant', content: [tu('t3')], stop_reason: 'tool_use', usage };
    return { id: `m${this.n}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FINAL: nothing found.' }], stop_reason: 'end_turn', usage };
  }
  override async sendRequest(req: any): Promise<APIResponse> { this.requests.push(JSON.parse(JSON.stringify(req.messages))); return { data: this.data(), status: 200, headers: {} }; }
  override streamRequest(req: any): any {
    this.requests.push(JSON.parse(JSON.stringify(req.messages)));
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

// The API client is scripted (no request leaves the process): its canned rounds are Anthropic Messages-format responses, so the
// session card must be a Messages-API card; that card only needs a key PRESENT to construct. A placeholder keeps this suite
// running everywhere (it used to skipIf the key was absent — silently skipped in CI and on this repl).
describe('HB-TURN-STATUS loop integration', () => {
  let dir: string;
  // Real helper/mentor calls are out of scope here (and would make network calls from a unit test): pin them off.
  const PINNED: Record<string, string> = { CORTEX_LIFT_PLAN: 'false', CORTEX_ENDTURN_RESOLVER: 'false', CORTEX_LIFT_NUDGE: 'false' };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turnstatus-'));
    for (const [k, v] of Object.entries(PINNED)) { saved[k] = process.env[k]; process.env[k] = v; }
    if (!process.env.ANTHROPIC_API_KEY) { saved.ANTHROPIC_API_KEY = undefined; process.env.ANTHROPIC_API_KEY = 'test-placeholder-not-used'; }
  });
  afterEach(() => {
    delete process.env.CORTEX_TURN_STATUS; delete process.env.CORTEX_TURN_DEADLINE_MS;
    for (const k of Object.keys(PINNED)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    if ('ANTHROPIC_API_KEY' in saved && saved.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function run(mode: 'sendMessage' | 'streamMessage') {
    const api = new ScriptedRounds(dir);
    const orch = await createOrchestrator({
      defaultModelId: 'claude-haiku-4-5', projectPath: dir, storageDir: path.join(dir, '.cortex/sessions'), debug: !!process.env.TS_DEBUG,
      loopControl: { maxConsecutiveErrors: 999, maxToolIterations: 50, maxLoopRepetitions: 999 },
      __apiClientOverride: api,
    } as any, { enablePermissions: false });
    await orch.createSession(dir, 'claude-haiku-4-5');
    if (mode === 'sendMessage') await orch.sendMessage('find zzz');
    else for await (const _c of orch.streamMessage('find zzz')) { /* drain */ }
    await orch.cleanup().catch(() => {});
    return api.requests;
  }

  for (const mode of ['sendMessage', 'streamMessage'] as const) {
    it(`${mode}: on → every continuation ends with STATUS; earlier prefixes byte-identical`, async () => {
      process.env.CORTEX_TURN_STATUS = 'on';
      process.env.CORTEX_TURN_DEADLINE_MS = '3600000';
      const reqs = await run(mode);
      expect(reqs.length).toBeGreaterThanOrEqual(4); // initial + 3 continuations
      expect(JSON.stringify(reqs[0])).not.toContain('STATUS:');
      for (let k = 1; k <= 3; k++) {
        expect(lastToolResultText(reqs[k])).toMatch(/<system-reminder>STATUS: elapsed 0h0\dm of 1h00m \(\d+%\), ~\d+h\d\dm left[^<]*<\/system-reminder>$/);
        // the whole previous request is a byte-identical prefix of this one (message-by-message)
        const prev = reqs[k - 1];
        for (let i = 0; i < prev.length; i++) {
          if (i === prev.length - 1 && k === 1) continue; // initial user message may be merged with nothing — compare below
          expect(JSON.stringify(reqs[k][i])).toBe(JSON.stringify(prev[i]));
        }
      }
      // round 2 had two parallel tool results: exactly one STATUS for that round, on the newest (t2b)
      const r2 = JSON.stringify(reqs[2]);
      expect((r2.match(/STATUS:/g) ?? []).length).toBe(2); // round-1 tail (persisted) + round-2 tail
    });

    it(`${mode}: unset → no STATUS in any request`, async () => {
      process.env.CORTEX_TURN_DEADLINE_MS = '3600000';
      const reqs = await run(mode);
      expect(reqs.length).toBeGreaterThanOrEqual(4);
      for (const r of reqs) expect(JSON.stringify(r)).not.toContain('STATUS:');
    });

    it(`${mode}: auto without a deadline → no STATUS`, async () => {
      process.env.CORTEX_TURN_STATUS = 'auto';
      const reqs = await run(mode);
      for (const r of reqs) expect(JSON.stringify(r)).not.toContain('STATUS:');
    });
  }
});
