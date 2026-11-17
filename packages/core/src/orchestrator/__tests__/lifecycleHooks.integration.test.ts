/**
 * Lifecycle hooks wired into the turn loop (docs/hooks.md, 2026-11-17). A scripted provider stands in for the model; hooks.json lives
 * in a temp CORTEX_HOME. Proves, for BOTH loops (sendMessage / streamMessage — every surface goes through one of them):
 *   - each event fires at its lifecycle point with its payload (SessionStart → UserPromptSubmit → PreToolUse → PostToolUse → Stop →
 *     SessionEnd; PreCompact / PostCompact / SessionStart(compact); resume; schedule source);
 *   - hook context reaches the NEXT model request (turn start → the user turn; tool hooks → the tool result; Stop → the next turn);
 *   - exit 2 blocks a tool call (PreToolUse) and a prompt (UserPromptSubmit — no request is sent);
 *   - dark by default: with no hooks.json the request bytes are identical to CORTEX_HOOKS=off.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOrchestrator } from '../OrchestratorFactory.js';
import { APIClient, type APIResponse } from '../APIClient.js';
import { resetHooksConfigCache } from '../../hooks/hooksConfig.js';

const MODEL = 'claude-haiku-4-5';

class ScriptedProvider extends APIClient {
  public requests: any[] = [];
  private n = 0;
  constructor(private readonly root: string) { super(); }
  private next(): any {
    this.n++;
    const usage = { input_tokens: 100, output_tokens: 7 };
    // odd requests call one tool, even ones answer — so every turn is "tool, then final"
    if (this.n % 2 === 1) return { id: `m${this.n}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: `t${this.n}`, name: 'grep', input: { pattern: `zzz${this.n}`, path: this.root } }], stop_reason: 'tool_use', usage };
    return { id: `m${this.n}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FINAL: nothing found.' }], stop_reason: 'end_turn', usage };
  }
  override async sendRequest(req: any): Promise<APIResponse> { this.requests.push(JSON.parse(JSON.stringify(req.messages))); return { data: this.next(), status: 200, headers: {} }; }
  override streamRequest(req: any): any {
    this.requests.push(JSON.parse(JSON.stringify(req.messages)));
    const d = this.next();
    async function* none(): AsyncGenerator<any> { /* finalMessage carries the content */ }
    return { chunks: none(), finalMessage: Promise.resolve(d) };
  }
}

type Mode = 'sendMessage' | 'streamMessage';
let root: string; let home: string; let log: string;
const PINNED: Record<string, string> = { CORTEX_LIFT_PLAN: 'false', CORTEX_ENDTURN_RESOLVER: 'false', CORTEX_LIFT_NUDGE: 'false', CORTEX_ENDTURN_GATE: 'false', CORTEX_AGENT_DEPTH: '0' };
const saved: Record<string, string | undefined> = {};

const logCmd = () => `cat >> ${log}; echo >> ${log}`;
function writeHooks(cfg: unknown) { fs.mkdirSync(path.join(home, '.cortex'), { recursive: true }); fs.writeFileSync(path.join(home, '.cortex', 'hooks.json'), JSON.stringify(cfg)); resetHooksConfigCache(); }
const events = (): any[] => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

async function make(dir: string, extra: Record<string, unknown> = {}) {
  const api = new ScriptedProvider(dir);
  const orch: any = await createOrchestrator({
    defaultModelId: MODEL, projectPath: dir, storageDir: path.join(dir, '.cortex/sessions'), debug: false,
    loopControl: { maxConsecutiveErrors: 999, maxToolIterations: 50, maxLoopRepetitions: 999 },
    __apiClientOverride: api, useHelperModels: false, ...extra,
  } as any, { enablePermissions: false });
  return { api, orch };
}
async function turn(orch: any, mode: Mode, text: string): Promise<any> {
  if (mode === 'sendMessage') return orch.sendMessage(text);
  const chunks: any[] = [];
  for await (const c of orch.streamMessage(text)) chunks.push(c);
  return chunks;
}
const lastUserText = (msgs: any[]) => JSON.stringify(msgs[msgs.length - 1]);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lchooks-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'lchooks-home-'));
  log = path.join(root, 'events.log');
  for (const [k, v] of Object.entries({ ...PINNED, CORTEX_HOME: home })) { saved[k] = process.env[k]; process.env[k] = v; }
  saved.CORTEX_HOOKS = process.env.CORTEX_HOOKS; delete process.env.CORTEX_HOOKS;
  saved.CORTEX_COMPACTION_THRESHOLD_TOKENS = process.env.CORTEX_COMPACTION_THRESHOLD_TOKENS;
  if (!process.env.ANTHROPIC_API_KEY) { saved.ANTHROPIC_API_KEY = undefined; process.env.ANTHROPIC_API_KEY = 'test-placeholder-not-used'; }
  resetHooksConfigCache();
});
afterEach(() => {
  for (const k of [...Object.keys(PINNED), 'CORTEX_HOME', 'CORTEX_HOOKS', 'CORTEX_COMPACTION_THRESHOLD_TOKENS']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  if ('ANTHROPIC_API_KEY' in saved && saved.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
});

describe('lifecycle hooks in the turn loop', () => {
  for (const mode of ['sendMessage', 'streamMessage'] as const) {
    it(`${mode}: every event fires in order with its payload, and hook context reaches the next request`, async () => {
      writeHooks({
        SessionStart: [{ hooks: [{ type: 'command', command: logCmd() }, { type: 'prompt', text: 'SS-CONTEXT' }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: `${logCmd()}; echo UPS-CONTEXT` }] }],
        PreToolUse: [{ matcher: 'Grep', hooks: [{ type: 'command', command: logCmd() }] }],
        PostToolUse: [{ matcher: 'Grep|Bash', hooks: [{ type: 'command', command: `${logCmd()}; echo '{"additionalContext":"POST-CONTEXT"}'` }] }],
        Stop: [{ hooks: [{ type: 'command', command: `${logCmd()}; echo STOP-CONTEXT` }] }],
        SessionEnd: [{ hooks: [{ type: 'command', command: logCmd() }] }],
      });
      const { api, orch } = await make(root);
      await orch.createSession(root, MODEL);
      expect(events()).toEqual([]);                                   // SessionStart is deferred to the first turn
      await turn(orch, mode, 'find zzz');
      const sid = orch.getSessionId();
      const ev = events();
      expect(ev.map((e) => e.hook_event_name)).toEqual(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);
      expect(ev[0]).toMatchObject({ session_id: sid, cwd: root, source: 'new' });
      expect(typeof ev[0].transcript_path).toBe('string');
      expect(ev[1]).toMatchObject({ prompt: 'find zzz' });
      expect(ev[2]).toMatchObject({ tool_name: 'Grep', tool_use_id: 't1', tool_input: { pattern: 'zzz1', path: root } });
      expect(ev[3]).toMatchObject({ tool_name: 'Grep', tool_use_id: 't1', is_error: expect.any(Boolean) });
      expect(typeof ev[3].tool_response).toBe('string');
      // request 1 carries the turn-start context in the user turn; request 2 the PostToolUse context in the tool result
      expect(lastUserText(api.requests[0])).toContain('SessionStart hook additional context: SS-CONTEXT');
      expect(lastUserText(api.requests[0])).toContain('UserPromptSubmit hook additional context: UPS-CONTEXT');
      expect(lastUserText(api.requests[1])).toContain('PostToolUse hook additional context: POST-CONTEXT');
      expect(lastUserText(api.requests[1])).not.toContain('SS-CONTEXT');   // not repeated on the tool round's newest message …
      const count = (req: any, needle: string) => JSON.stringify(req).split(needle).length - 1;
      expect(count(api.requests[1], 'SS-CONTEXT')).toBe(1);                // … but it STAYS on the turn's user message (m2 11-17: turn 2 lost it)
      // the persisted history keeps the user's ORIGINAL text (the turn-start context is request-only, like every harness note)
      const firstUser = orch.messageHistory.find((m: any) => m.type === 'user');
      expect(JSON.stringify(firstUser.message.content)).not.toContain('SS-CONTEXT');
      // turn 2: no second SessionStart; the Stop context arrives with it
      await turn(orch, mode, 'again');
      expect(events().filter((e) => e.hook_event_name === 'SessionStart')).toHaveLength(1);
      expect(lastUserText(api.requests[2])).toContain('Stop hook additional context: STOP-CONTEXT');
      expect(count(api.requests[2], 'SS-CONTEXT')).toBe(1);                // still in context on the next turn, exactly once
      expect(count(api.requests[2], 'UPS-CONTEXT')).toBe(2);                // one per turn, each kept on its own message
      await orch.cleanup();
      const end = events().at(-1);
      expect(end).toMatchObject({ hook_event_name: 'SessionEnd', reason: 'exit', session_id: sid });
    });

    it(`${mode}: PreToolUse exit 2 blocks the call — stderr comes back as the tool result; PostToolUse does not run for it`, async () => {
      writeHooks({
        PreToolUse: [{ matcher: 'Grep', hooks: [{ type: 'command', command: 'echo "grep is not allowed here" >&2; exit 2' }] }],
        PostToolUse: [{ hooks: [{ type: 'command', command: logCmd() }] }],
      });
      const { api, orch } = await make(root);
      await orch.createSession(root, MODEL);
      await turn(orch, mode, 'find zzz');
      const results = orch.messageHistory.flatMap((m: any) => Array.isArray(m?.message?.content) ? m.message.content : []).filter((b: any) => b?.type === 'tool_result');
      expect(results).toHaveLength(1);
      expect(results[0].is_error).toBe(true);
      expect(String(results[0].content)).toContain('Blocked by a PreToolUse hook: grep is not allowed here');
      expect(JSON.stringify(api.requests[1])).toContain('grep is not allowed here');
      expect(events()).toEqual([]);
      await orch.cleanup();
    });

    it(`${mode}: UserPromptSubmit exit 2 blocks the prompt — no model request, nothing in the history, the reason is shown`, async () => {
      writeHooks({ UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo "outside working hours" >&2; exit 2' }] }] });
      const { api, orch } = await make(root);
      await orch.createSession(root, MODEL);
      const out = await turn(orch, mode, 'do the thing');
      expect(api.requests).toHaveLength(0);
      expect(orch.messageHistory).toHaveLength(0);
      const text = mode === 'sendMessage' ? JSON.stringify(out.content) : out.filter((c: any) => c.type === 'text_delta').map((c: any) => c.delta).join('');
      expect(text).toContain('Prompt blocked by a UserPromptSubmit hook: outside working hours');
      if (mode === 'sendMessage') expect(out.metadata.hookBlocked).toEqual({ event: 'UserPromptSubmit', reason: 'outside working hours' });
      else expect(out.at(-1)).toMatchObject({ type: 'message_stop', data: { hookBlocked: { event: 'UserPromptSubmit', reason: 'outside working hours' } } });
      await orch.cleanup();
    });
  }

  it('dark by default: with no hooks.json the requests are byte-identical to CORTEX_HOOKS=off (and to a config whose hooks never match)', async () => {
    const run = async (sub: string) => {
      const dir = path.join(root, 'same');   // same project dir every run so paths in the requests agree
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      const { api, orch } = await make(dir);
      await orch.createSession(dir, MODEL);
      await turn(orch, 'sendMessage', 'find zzz');
      for await (const _c of orch.streamMessage('and again')) { /* drain */ }
      await orch.cleanup();
      void sub;
      return JSON.stringify(api.requests);
    };
    process.env.CORTEX_HOOKS = 'off';
    const off = await run('off');
    delete process.env.CORTEX_HOOKS;
    const none = await run('none');                              // no hooks.json anywhere
    writeHooks({ PreToolUse: [{ matcher: 'NoSuchTool', hooks: [{ type: 'command', command: 'echo never' }] }] });
    const unmatched = await run('unmatched');
    expect(none).toBe(off);
    expect(unmatched).toBe(off);
    expect(JSON.parse(off).length).toBe(4);
  });

  it('resume: a resumed session starts with SessionStart source=resume; a scheduled fresh session with source=schedule', async () => {
    writeHooks({ SessionStart: [{ hooks: [{ type: 'command', command: logCmd() }] }], SessionEnd: [{ hooks: [{ type: 'command', command: logCmd() }] }] });
    const a = await make(root);
    await a.orch.createSession(root, MODEL, { source: 'schedule' });
    await turn(a.orch, 'sendMessage', 'scheduled job');
    const sid = a.orch.getSessionId();
    await a.orch.cleanup();
    const b = await make(root);
    await b.orch.createSession(root, MODEL);       // what OrchestratorClient does before a TUI resume
    await b.orch.resumeSession(sid, root);
    await turn(b.orch, 'sendMessage', 'continue');
    await b.orch.endSession('oneshot');            // the server's /sessions/current/end
    await b.orch.cleanup();                        // already ended → no second SessionEnd
    expect(events().map((e) => [e.hook_event_name, e.source ?? e.reason, e.session_id === sid])).toEqual([
      ['SessionStart', 'schedule', true], ['SessionEnd', 'exit', true], ['SessionStart', 'resume', true], ['SessionEnd', 'oneshot', true],
    ]);
  });

  it('compaction: PreCompact, then PostCompact and SessionStart(source=compact); their context reaches the next request', async () => {
    writeHooks({
      PreCompact: [{ hooks: [{ type: 'command', command: logCmd() }] }],
      PostCompact: [{ hooks: [{ type: 'command', command: `${logCmd()}; echo POSTCOMPACT-CONTEXT` }] }],
      SessionStart: [{ matcher: 'compact', hooks: [{ type: 'command', command: logCmd() }, { type: 'prompt', text: 'REREAD-THE-ENTRY-POINT' }] }],
    });
    const { api, orch } = await make(root);
    await orch.createSession(root, MODEL);
    await turn(orch, 'sendMessage', 'find zzz');
    process.env.CORTEX_COMPACTION_THRESHOLD_TOKENS = '50';   // the next turn starts over the threshold → compaction before its request
    await turn(orch, 'sendMessage', 'and more');
    const names = events().map((e) => e.hook_event_name + (e.source ? `:${e.source}` : ''));
    expect(names.slice(0, 3)).toEqual(['PreCompact', 'PostCompact', 'SessionStart:compact']);
    expect(events()[0]).toMatchObject({ trigger: 'auto' });
    const after = JSON.stringify(api.requests.slice(2));
    expect(after).toContain('PostCompact hook additional context: POSTCOMPACT-CONTEXT');
    expect(after).toContain('SessionStart hook additional context: REREAD-THE-ENTRY-POINT');
    await orch.cleanup();
  });
});
