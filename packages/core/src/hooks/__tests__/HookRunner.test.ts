/**
 * Lifecycle hooks — execution semantics (Claude-Code-compatible): stdin payload + env, stdout / JSON context, prompt hooks,
 * exit 2 blocking (PreToolUse / UserPromptSubmit only), other failures + timeouts logged, never thrown.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runHooks, runHooksSync, interpretCommandOutcome, type HookInvocation } from '../HookRunner.js';
import type { HooksConfig, HookEvent } from '../hooksConfig.js';
import { formatHookContext, SessionHooks } from '../SessionHooks.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookrun-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const cmd = (command: string, timeout?: number) => ({ type: 'command' as const, command, ...(timeout ? { timeout } : {}) });
const cfg = (event: HookEvent, hooks: any[], matcher?: string): HooksConfig => ({ [event]: [{ ...(matcher !== undefined ? { matcher } : {}), hooks, file: 'test' }] });
const inv = (event: HookEvent, over: Partial<HookInvocation> = {}): HookInvocation & { logs: string[] } => {
  const logs: string[] = [];
  return { event, payload: { extra: 1 }, sessionId: 'sess-1', projectDir: dir, log: (l) => logs.push(l), logs, ...over } as any;
};

describe('runHooks', () => {
  it('pipes the JSON payload on stdin and sets CORTEX_HOOK_EVENT / CORTEX_SESSION_ID / CORTEX_PROJECT_DIR (+ CLAUDE_PROJECT_DIR)', async () => {
    const out = path.join(dir, 'seen.json');
    const r = await runHooks(cfg('Stop', [cmd(`cat > ${out}; echo "$CORTEX_HOOK_EVENT $CORTEX_SESSION_ID $CORTEX_PROJECT_DIR $CLAUDE_PROJECT_DIR"`)]), inv('Stop'));
    const seen = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(seen).toEqual({ session_id: 'sess-1', cwd: dir, hook_event_name: 'Stop', extra: 1 });
    expect(r.contexts).toEqual([`Stop sess-1 ${dir} ${dir}`]);
    expect(r.ran).toBe(1);
  });

  it('plain stdout, JSON additionalContext and hookSpecificOutput.additionalContext are context; prompt hooks add their text; order kept', async () => {
    const r = await runHooks(cfg('SessionStart', [
      cmd('echo plain'),
      cmd(`echo '{"additionalContext":"from-json"}'`),
      cmd(`echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"from-hso"}}'`),
      { type: 'prompt', text: 'fixed text' },
      cmd(`echo '{"continue":true}'`),   // JSON without context → nothing
    ]), inv('SessionStart'));
    expect(r.contexts).toEqual(['plain', 'from-json', 'from-hso', 'fixed text']);
  });

  it('exit 2 blocks PreToolUse with stderr as the reason and stops the remaining hooks', async () => {
    const after = path.join(dir, 'after');
    const r = await runHooks(cfg('PreToolUse', [cmd('echo "no rm -rf" >&2; exit 2'), cmd(`touch ${after}`)]), inv('PreToolUse'));
    expect(r.blocked).toEqual({ reason: 'no rm -rf' });
    expect(fs.existsSync(after)).toBe(false);
  });

  it('JSON block decisions block too (decision:block / permissionDecision:deny)', async () => {
    const a = await runHooks(cfg('UserPromptSubmit', [cmd(`echo '{"decision":"block","reason":"not now"}'`)]), inv('UserPromptSubmit'));
    expect(a.blocked).toEqual({ reason: 'not now' });
    const b = await runHooks(cfg('PreToolUse', [cmd(`echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"policy"}}'`)]), inv('PreToolUse'));
    expect(b.blocked).toEqual({ reason: 'policy' });
  });

  it('exit 2 on a non-blocking event, other exits and spawn problems are logged, never thrown or blocking', async () => {
    const i = inv('Stop');
    const r = await runHooks(cfg('Stop', [cmd('echo nope >&2; exit 2'), cmd('exit 7'), cmd('echo still-runs')]), i);
    expect(r.blocked).toBeUndefined();
    expect(r.contexts).toEqual(['still-runs']);
    expect(i.logs.join('\n')).toMatch(/exit 2 \(only PreToolUse/);
    expect(i.logs.join('\n')).toMatch(/exit 7/);
  });

  it('a hook that outlives its timeout is killed and logged; the session goes on', async () => {
    const i = inv('PostToolUse');
    const t0 = Date.now();
    const r = await runHooks(cfg('PostToolUse', [cmd('sleep 20; echo late', 1), cmd('echo next')]), i);
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(r.contexts).toEqual(['next']);
    expect(i.logs.join('\n')).toMatch(/timed out/);
  });

  it('matchers apply to the tool name (tool events) and the source (SessionStart); other events ignore them', async () => {
    const c: HooksConfig = { PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'prompt', text: 'bash-only' }], file: 't' },
      { matcher: 'Edit|Write', hooks: [{ type: 'prompt', text: 'edits' }], file: 't' },
    ] };
    expect((await runHooks(c, inv('PreToolUse', { matchValue: 'Bash' }))).contexts).toEqual(['bash-only']);
    expect((await runHooks(c, inv('PreToolUse', { matchValue: 'Write' }))).contexts).toEqual(['edits']);
    expect((await runHooks(c, inv('PreToolUse', { matchValue: 'Read' }))).ran).toBe(0);
    const s = cfg('SessionStart', [{ type: 'prompt', text: 'on-resume' }], 'resume');
    expect((await runHooks(s, inv('SessionStart', { matchValue: 'new' }))).ran).toBe(0);
    expect((await runHooks(s, inv('SessionStart', { matchValue: 'resume' }))).contexts).toEqual(['on-resume']);
    const st = cfg('Stop', [{ type: 'prompt', text: 'stop' }], 'Bash');
    expect((await runHooks(st, inv('Stop'))).contexts).toEqual(['stop']);
  });

  it('runHooksSync (process exit) runs the command with the same payload', () => {
    const out = path.join(dir, 'end.json');
    const r = runHooksSync(cfg('SessionEnd', [cmd(`cat > ${out}`)]), inv('SessionEnd', { payload: { reason: 'exit' } }));
    expect(r.ran).toBe(1);
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toMatchObject({ hook_event_name: 'SessionEnd', reason: 'exit', session_id: 'sess-1' });
  });
});

describe('interpretCommandOutcome', () => {
  it('non-JSON that starts with { is plain text', () => {
    expect(interpretCommandOutcome('Stop', { code: 0, stdout: '{oops', stderr: '', timedOut: false })).toEqual({ context: '{oops' });
  });
});

describe('formatHookContext + SessionHooks queue', () => {
  it('wraps each context in a system-reminder naming the event, total capped', () => {
    const t = formatHookContext([{ event: 'SessionStart', text: 'hello' }], 20_000)!;
    expect(t).toBe('<system-reminder>\nSessionStart hook additional context: hello\n</system-reminder>');
    const big = formatHookContext([{ event: 'Stop', text: 'x'.repeat(5000) }], 1000)!;
    expect(big.length).toBeLessThanOrEqual(1000);
    expect(big).toMatch(/hook context truncated/);
  });

  it('CORTEX_HOOKS=off disables everything; a sub-agent (CORTEX_AGENT_DEPTH>0) never runs hooks', () => {
    const h = (env: NodeJS.ProcessEnv) => new SessionHooks({ projectDir: () => dir, env });
    expect(h({ CORTEX_HOOKS: 'off' }).enabled()).toBe(false);
    expect(h({ CORTEX_AGENT_DEPTH: '1' }).enabled()).toBe(false);
    expect(h({}).enabled()).toBe(true);
    expect(new SessionHooks({ projectDir: () => dir, env: {}, disabled: true }).enabled()).toBe(false);
  });

  it('SessionStart fires once, lazily, with the latest source; SessionEnd only for a started session, then a later turn resumes', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hookhome-'));
    const log = path.join(dir, 'events.log');
    fs.mkdirSync(path.join(home, '.cortex'));
    fs.writeFileSync(path.join(home, '.cortex', 'hooks.json'), JSON.stringify({
      SessionStart: [{ hooks: [{ type: 'command', command: `cat >> ${log}; echo >> ${log}` }] }],
      SessionEnd: [{ hooks: [{ type: 'command', command: `cat >> ${log}; echo >> ${log}` }] }],
    }));
    const h = new SessionHooks({ projectDir: () => dir, env: { ...process.env, CORTEX_HOME: home, CORTEX_AGENT_DEPTH: '0' } });
    h.sessionCreated('a', 'new');
    await h.endSession('clear');                 // never started → nothing
    h.sessionCreated('b', 'resume');             // TUI: create then resume
    await h.ensureStarted(); await h.ensureStarted();
    await h.endSession('oneshot');
    await h.ensureStarted();                     // a later turn on the same session
    await h.endSession('exit');
    const rows = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(rows.map((r) => [r.hook_event_name, r.session_id, r.source ?? r.reason])).toEqual([
      ['SessionStart', 'b', 'resume'], ['SessionEnd', 'b', 'oneshot'], ['SessionStart', 'b', 'resume'], ['SessionEnd', 'b', 'exit'],
    ]);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
