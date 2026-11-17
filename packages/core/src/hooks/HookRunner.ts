/**
 * Lifecycle hooks — execution (2026-11-17). Semantics follow Claude Code so hooks port 1:1:
 *   - the event payload is JSON on the command's stdin; env carries CORTEX_HOOK_EVENT, CORTEX_SESSION_ID, CORTEX_PROJECT_DIR
 *     (and CLAUDE_PROJECT_DIR, so a ported script keeps working);
 *   - exit 0: stdout is context for the next model request — plain text, or JSON {"additionalContext": "…"} /
 *     {"hookSpecificOutput": {"additionalContext": "…"}}; JSON {"decision": "block", "reason"} or
 *     {"hookSpecificOutput": {"permissionDecision": "deny", "permissionDecisionReason"}} blocks like exit 2;
 *   - exit 2 on PreToolUse / UserPromptSubmit blocks (stderr = the reason); on other events it is logged;
 *   - any other exit, a spawn error or a timeout (default 60 s) is logged and never breaks the session;
 *   - a `prompt` hook adds its text as context;
 *   - hooks run one after another in config order; a block stops the rest of that event's hooks.
 */
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { cortexUserDir, matcherMatches, type HookEvent, type HooksConfig } from './hooksConfig.js';

export const DEFAULT_HOOK_TIMEOUT_S = 60;
/** Events where exit 2 (or a JSON block decision) blocks. */
export const BLOCKING_EVENTS: ReadonlySet<HookEvent> = new Set(['PreToolUse', 'UserPromptSubmit']);
const MAX_CAPTURE = 1_000_000;   // bytes kept from a hook's stdout / stderr

export interface HookInvocation {
  event: HookEvent;
  /** the value the matcher tests: tool name for tool events, `source` for SessionStart; others ignore matchers */
  matchValue?: string;
  payload: Record<string, unknown>;
  sessionId: string;
  projectDir: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
}

export interface HookRunResult {
  /** context texts in config order (stdout / additionalContext / prompt text) */
  contexts: string[];
  blocked?: { reason: string };
  /** hooks that ran */
  ran: number;
}

export interface CommandOutcome { code: number | null; stdout: string; stderr: string; timedOut: boolean; error?: string }

/** Turn one command's outcome into context / a block. Exported for tests. */
export function interpretCommandOutcome(event: HookEvent, o: CommandOutcome): { context?: string; block?: string; problem?: string } {
  if (o.error) return { problem: `spawn failed: ${o.error}` };
  if (o.timedOut) return { problem: 'timed out' };
  const blocking = BLOCKING_EVENTS.has(event);
  if (o.code === 2) {
    const reason = o.stderr.trim() || 'blocked by hook';
    return blocking ? { block: reason } : { problem: `exit 2 (only PreToolUse / UserPromptSubmit can block): ${reason.slice(0, 300)}` };
  }
  if (o.code !== 0) return { problem: `exit ${o.code}: ${o.stderr.trim().slice(0, 300)}` };
  const out = o.stdout.trim();
  if (!out) return {};
  if (out.startsWith('{')) {
    let j: any;
    try { j = JSON.parse(out); } catch { return { context: out }; }   // not JSON after all — plain text
    const hso = j && typeof j.hookSpecificOutput === 'object' ? j.hookSpecificOutput : {};
    if (blocking && (j?.decision === 'block' || hso?.permissionDecision === 'deny')) {
      return { block: String(j?.reason ?? hso?.permissionDecisionReason ?? 'blocked by hook') };
    }
    const ctx = typeof j?.additionalContext === 'string' ? j.additionalContext : typeof hso?.additionalContext === 'string' ? hso.additionalContext : '';
    return ctx.trim() ? { context: ctx.trim() } : {};
  }
  return { context: out };
}

function hookEnv(inv: HookInvocation): NodeJS.ProcessEnv {
  return {
    ...(inv.env ?? process.env),
    CORTEX_HOOK_EVENT: inv.event,
    CORTEX_SESSION_ID: inv.sessionId,
    CORTEX_PROJECT_DIR: inv.projectDir,
    CLAUDE_PROJECT_DIR: inv.projectDir,
  };
}

const hookCwd = (dir: string): string => { try { return fs.statSync(dir).isDirectory() ? dir : process.cwd(); } catch { return process.cwd(); } };

function runCommandAsync(command: string, input: string, timeoutS: number, inv: HookInvocation): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    let stdout = ''; let stderr = ''; let timedOut = false; let settled = false;
    const done = (o: CommandOutcome) => { if (!settled) { settled = true; resolve(o); } };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, { shell: true, cwd: hookCwd(inv.projectDir), env: hookEnv(inv), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e: any) { done({ code: null, stdout: '', stderr: '', timedOut: false, error: e?.message ?? String(e) }); return; }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* gone */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 2000).unref?.();
      done({ code: null, stdout, stderr, timedOut: true });
    }, Math.max(1, timeoutS) * 1000);
    child.stdout?.on('data', (d) => { if (stdout.length < MAX_CAPTURE) stdout += d.toString(); });
    child.stderr?.on('data', (d) => { if (stderr.length < MAX_CAPTURE) stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); done({ code: null, stdout, stderr, timedOut, error: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr, timedOut }); });
    child.stdin?.on('error', () => { /* the hook did not read stdin — fine */ });
    child.stdin?.end(input);
  });
}

function runCommandSync(command: string, input: string, timeoutS: number, inv: HookInvocation): CommandOutcome {
  const r = spawnSync(command, { shell: true, cwd: hookCwd(inv.projectDir), env: hookEnv(inv), input, encoding: 'utf8', timeout: Math.max(1, timeoutS) * 1000, maxBuffer: MAX_CAPTURE });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  return { code: r.status, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), timedOut, ...(r.error && !timedOut ? { error: r.error.message } : {}) };
}

function matchingHandlers(config: HooksConfig, inv: HookInvocation) {
  const groups = config[inv.event] ?? [];
  const usesMatcher = inv.event === 'PreToolUse' || inv.event === 'PostToolUse' || inv.event === 'SessionStart';
  return groups.filter((g) => !usesMatcher || matcherMatches(g.matcher, inv.matchValue)).flatMap((g) => g.hooks.map((h) => ({ h, file: g.file })));
}

function payloadJson(inv: HookInvocation): string {
  return JSON.stringify({ session_id: inv.sessionId, cwd: inv.projectDir, hook_event_name: inv.event, ...inv.payload });
}

function record(result: HookRunResult, inv: HookInvocation, label: string, outcome: ReturnType<typeof interpretCommandOutcome>): boolean {
  if (outcome.context) result.contexts.push(outcome.context);
  if (outcome.problem) inv.log?.(`${inv.event} ${label}: ${outcome.problem}`);
  if (outcome.block) { result.blocked = { reason: outcome.block }; inv.log?.(`${inv.event} ${label}: blocked — ${outcome.block.slice(0, 300)}`); return true; }
  return false;
}

/** Run every matching hook for one event, in order. Never throws. */
export async function runHooks(config: HooksConfig, inv: HookInvocation): Promise<HookRunResult> {
  const result: HookRunResult = { contexts: [], ran: 0 };
  const input = payloadJson(inv);
  for (const { h } of matchingHandlers(config, inv)) {
    result.ran++;
    if (h.type === 'prompt') { result.contexts.push(h.text.trim()); continue; }
    let outcome: ReturnType<typeof interpretCommandOutcome>;
    try { outcome = interpretCommandOutcome(inv.event, await runCommandAsync(h.command, input, h.timeout ?? DEFAULT_HOOK_TIMEOUT_S, inv)); }
    catch (e: any) { outcome = { problem: `failed: ${e?.message ?? e}` }; }
    if (record(result, inv, JSON.stringify(h.command.slice(0, 80)), outcome)) break;
  }
  return result;
}

/** Synchronous twin for process exit (SessionEnd from an `exit` listener, where nothing async can run). Never throws. */
export function runHooksSync(config: HooksConfig, inv: HookInvocation): HookRunResult {
  const result: HookRunResult = { contexts: [], ran: 0 };
  const input = payloadJson(inv);
  for (const { h } of matchingHandlers(config, inv)) {
    result.ran++;
    if (h.type === 'prompt') { result.contexts.push(h.text.trim()); continue; }
    let outcome: ReturnType<typeof interpretCommandOutcome>;
    try { outcome = interpretCommandOutcome(inv.event, runCommandSync(h.command, input, h.timeout ?? DEFAULT_HOOK_TIMEOUT_S, inv)); }
    catch (e: any) { outcome = { problem: `failed: ${e?.message ?? e}` }; }
    if (record(result, inv, JSON.stringify(h.command.slice(0, 80)), outcome)) break;
  }
  return result;
}

/** Append one line to <CORTEX_HOME or ~>/.cortex/hooks.log (best-effort). */
export function appendHooksLog(line: string, env: NodeJS.ProcessEnv = process.env): void {
  try {
    const file = path.join(cortexUserDir(env), 'hooks.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging must never affect a session */ }
}
