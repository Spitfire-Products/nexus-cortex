/**
 * P0 — TURN-LOOP PARITY RATCHET (turn-loop unification plan, 2026-10-06).
 *
 * The library IS the harness; sendMessage (non-streaming) and streamMessage (streaming) must be the same harness differing only in how
 * bytes arrive. This test replays IDENTICAL scripted provider responses through both loops and diffs what the harness did:
 * request count, per-request message counts, final history, and the multiset of decision-event kinds.
 *
 * It is a RATCHET, not a wish: the divergences it finds today are pinned in KNOWN_GAPS (deficiencies R234–R237). A NEW divergence fails
 * the build (a feature landed on one loop only). A pinned gap that stops diverging ALSO fails (remove it from the list — the gap is fixed).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOrchestrator } from '../OrchestratorFactory.js';
import { APIClient, type APIResponse } from '../APIClient.js';

const TOOL = 'grep';
type Script = 'tools-then-final' | 'wall-mid-turn';

class ScriptedProvider extends APIClient {
  public requests: any[] = [];
  private n = 0;
  constructor(private readonly root: string, private readonly script: Script) { super(); }
  private next(): any {
    this.n++;
    const tu = (id: string) => ({ type: 'tool_use', id, name: TOOL, input: { pattern: `zzz${id}`, path: this.root } });
    const usage = { input_tokens: 1000 * this.n, output_tokens: 7 };
    const wall = { id: 'mw', type: 'message', role: 'assistant', content: [{ type: 'thinking', thinking: 'spiral '.repeat(4000), signature: 'sig' }], stop_reason: 'max_tokens', usage: { input_tokens: 1000, output_tokens: 65536 } };
    if (this.script === 'wall-mid-turn') {
      if (this.n === 1) return { id: 'm1', type: 'message', role: 'assistant', content: [tu('t1')], stop_reason: 'tool_use', usage };
      if (this.n === 2) return wall;
      if (this.n === 3) return { id: 'm3', type: 'message', role: 'assistant', content: [tu('t3')], stop_reason: 'tool_use', usage };
      return { id: `m${this.n}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FINAL: nothing found.' }], stop_reason: 'end_turn', usage };
    }
    if (this.n === 1) return { id: 'm1', type: 'message', role: 'assistant', content: [tu('t1')], stop_reason: 'tool_use', usage };
    if (this.n === 2) return { id: 'm2', type: 'message', role: 'assistant', content: [tu('t2a'), tu('t2b')], stop_reason: 'tool_use', usage };
    return { id: `m${this.n}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FINAL: nothing found.' }], stop_reason: 'end_turn', usage };
  }
  override async sendRequest(req: any): Promise<APIResponse> { this.requests.push(JSON.parse(JSON.stringify(req.messages))); return { data: this.next(), status: 200, headers: {} }; }
  override streamRequest(req: any): any {
    this.requests.push(JSON.parse(JSON.stringify(req.messages)));
    const d = this.next();
    async function* none(): AsyncGenerator<any> { /* finalMessage carries the content — same bytes as the non-streaming body */ }
    return { chunks: none(), finalMessage: Promise.resolve(d) };
  }
}

interface Trace { requests: number; messageCounts: number[]; historyLen: number; events: Record<string, number> }

async function trace(mode: 'sendMessage' | 'streamMessage', script: Script, dir: string): Promise<Trace> {
  const api = new ScriptedProvider(dir, script);
  const orch: any = await createOrchestrator({
    defaultModelId: 'claude-haiku-4-5', projectPath: dir, storageDir: path.join(dir, '.cortex/sessions'), debug: false,
    loopControl: { maxConsecutiveErrors: 999, maxToolIterations: 50, maxLoopRepetitions: 999 },
    __apiClientOverride: api,
  } as any, { enablePermissions: false });
  await orch.createSession(dir, 'claude-haiku-4-5');
  if (mode === 'sendMessage') await orch.sendMessage('find zzz');
  else for await (const _c of orch.streamMessage('find zzz')) { /* drain */ }
  const events: Record<string, number> = {};
  // The loops bank their last events (endturn_gate_fallback, session_usage) with `void store.recordEvent(...)` — async appends that can
  // land AFTER the turn returns. Read the store only once it has stopped growing (CI 2026-10-07: the race read 2 events short on one loop
  // and reported a phantom one-loop divergence).
  await settleDecisions(orch);
  try {
    const rows = await orch.decisionStore?.readEvents?.();
    for (const r of rows ?? []) { const k = String((r as any).kind ?? (r as any).eventKind ?? 'unknown'); events[k] = (events[k] ?? 0) + 1; }
  } catch { /* no store → no events */ }
  const historyLen = (await orch.getHistory?.())?.length ?? (orch.history?.length ?? -1);
  await orch.cleanup().catch(() => {});
  return { requests: api.requests.length, messageCounts: api.requests.map((m: any[]) => m.length), historyLen, events };
}

/** Wait until the orchestrator's decision store stops growing (quiet for 250 ms; at most 5 s). */
async function settleDecisions(orch: any): Promise<void> {
  let storePath: string | undefined;
  try { storePath = orch.decisionStore?.storePath ?? orch.decisionsStorePath?.(); } catch { storePath = undefined; }
  const size = () => { try { return storePath ? fs.statSync(storePath).size : -1; } catch { return -1; } };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const t0 = Date.now();
  let last = size(); let quietSince = Date.now();
  while (Date.now() - t0 < 5000) {
    await sleep(50);
    const now = size();
    if (now !== last) { last = now; quietSince = Date.now(); }
    else if (Date.now() - quietSince >= 250) return;
  }
}

function diverge(a: Trace, b: Trace): string[] {
  const out: string[] = [];
  if (a.requests !== b.requests) out.push(`requests:${a.requests}!=${b.requests}`);
  if (a.messageCounts.join(',') !== b.messageCounts.join(',')) out.push(`messageCounts:${a.messageCounts.join(',')}!=${b.messageCounts.join(',')}`);
  if (a.historyLen !== b.historyLen) out.push(`historyLen:${a.historyLen}!=${b.historyLen}`);
  for (const k of new Set([...Object.keys(a.events), ...Object.keys(b.events)])) if ((a.events[k] ?? 0) !== (b.events[k] ?? 0)) out.push(`event:${k}:${a.events[k] ?? 0}!=${b.events[k] ?? 0}`);
  return out.sort();
}

/** Pinned divergences = the parity debt (R234–R237). Keys are divergence labels WITHOUT the counts (prefix match). Update only when the gap is fixed. */
const KNOWN_GAPS: Record<Script, string[]> = {
  'tools-then-final': [],
  // R234 (discovery run 2026-10-06): after a max_tokens wall the non-streaming loop classifies it (reasoning_exhaustion), drops the walled
  // turn (wall_drop), nudges and retries (6 requests); the streaming loop's `while (hasToolUse && …)` (CortexOrchestrator ~5381) exits on
  // the no-tool turn and the empty-continue fallback classifies with an undefined stop reason (~6401): 3 requests, no wall events, turn over.
  // + endturn_gate_fallback (2026-10-07, same R234 root): the non-streaming loop reaches the end-turn gate after its retry and banks the
  // fallback; the streaming loop never gets there because it already exited at the wall. (Pinned once the ratchet's store read waited
  // for the async event appends to land — the race had hidden it.)
  'wall-mid-turn': ['event:reasoning_exhaustion', 'event:wall_drop', 'event:endturn_gate_fallback', 'messageCounts', 'requests'],
};

describe('turn-loop parity ratchet (sendMessage vs streamMessage, identical scripted provider)', () => {
  let dir: string;
  const PINNED: Record<string, string> = { CORTEX_LIFT_PLAN: 'false', CORTEX_ENDTURN_RESOLVER: 'false', CORTEX_LIFT_NUDGE: 'false', CORTEX_WALL_DROP: 'on', CORTEX_EMPTY_TURN_CONTINUE: 'true' };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
    for (const [k, v] of Object.entries(PINNED)) { saved[k] = process.env[k]; process.env[k] = v; }
    if (!process.env.ANTHROPIC_API_KEY) { saved.ANTHROPIC_API_KEY = undefined; process.env.ANTHROPIC_API_KEY = 'test-placeholder-not-used'; }
  });
  afterEach(() => {
    for (const k of Object.keys(PINNED)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    if ('ANTHROPIC_API_KEY' in saved && saved.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (const script of ['tools-then-final', 'wall-mid-turn'] as const) {
    it(`${script}: divergences == KNOWN_GAPS (new divergence = a one-loop feature; vanished divergence = fixed gap, unpin it)`, async () => {
      const a = await trace('sendMessage', script, fs.mkdtempSync(path.join(dir, 'a-')));
      const b = await trace('streamMessage', script, fs.mkdtempSync(path.join(dir, 'b-')));
      const d = diverge(a, b);
      const labels = d.map((x) => x.replace(/:\d+!=\d+$/, '').replace(/:[\d,]+!=[\d,]+$/, ''));
      // eslint-disable-next-line no-console
      console.log(`[parity:${script}] sendMessage=${JSON.stringify(a)} streamMessage=${JSON.stringify(b)} divergences=${JSON.stringify(d)}`);
      const known = KNOWN_GAPS[script];
      const unexpected = labels.filter((l) => !known.includes(l));
      const vanished = known.filter((l) => !labels.includes(l));
      expect(unexpected, `NEW one-loop divergence(s) — a feature landed on one transport only: ${unexpected.join(' | ')}`).toEqual([]);
      expect(vanished, `pinned gap(s) no longer diverge — remove from KNOWN_GAPS: ${vanished.join(' | ')}`).toEqual([]);
    });
  }
});
