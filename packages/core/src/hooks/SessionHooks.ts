/**
 * Lifecycle hooks — per-orchestrator session state (2026-11-17). CortexOrchestrator owns one instance; every surface (fuzzycortex /
 * neoncortex through OrchestratorClient, the server, the headless `cortex "…"` one-shot through the server, scheduled turns) reaches
 * hooks only through it — no surface has its own copy (library first).
 *
 *   SessionStart  fires right before the FIRST model request after a session is created (source new|schedule), resumed (resume), or
 *                 ended-and-continued (resume) — lazily, so a TUI that creates a session and then resumes another fires once, as
 *                 `resume`. After a compaction it fires immediately with source `compact`.
 *   SessionEnd    fires once per started session: when another session replaces it (reason clear|resume), on endSession() (the server's
 *                 one-shot route, reason as given), on cleanup() (exit) and, synchronously, from a process `exit` listener.
 * Context from hooks is queued here and delivered by the orchestrator into the next model request (drain()).
 */
import { agentDepth } from '../orchestrator/toolAllowlist.js';
import { loadHooksConfig, type HookEvent, type HooksConfig, type SessionStartSource } from './hooksConfig.js';
import { appendHooksLog, runHooks, runHooksSync, type HookRunResult } from './HookRunner.js';

export const DEFAULT_MAX_HOOK_CONTEXT_CHARS = 20_000;
/** Longest tool_response a PostToolUse payload carries (the rest is cut, marked). */
export const MAX_TOOL_RESPONSE_CHARS = 10_000;

export function resolveMaxHookContextChars(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(String(env.CORTEX_HOOKS_MAX_CONTEXT_CHARS ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_HOOK_CONTEXT_CHARS;
}

/** Hooks are on unless CORTEX_HOOKS=off, and never inside a sub-agent (its parent session owns the lifecycle). */
export function hooksEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.CORTEX_HOOKS ?? '').trim().toLowerCase() === 'off') return false;
  return agentDepth(env) === 0;
}

export function truncateForPayload(text: string, max = MAX_TOOL_RESPONSE_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

/** The text block delivered into the next request: one <system-reminder> per context, total capped. */
export function formatHookContext(items: Array<{ event: HookEvent; text: string }>, maxChars: number): string | null {
  if (!items.length) return null;
  const parts = items.map((i) => `<system-reminder>\n${i.event} hook additional context: ${i.text}\n</system-reminder>`);
  let out = parts.join('\n');
  if (out.length > maxChars) {
    const note = `\n…[hook context truncated: ${out.length - maxChars} of ${out.length} chars dropped (CORTEX_HOOKS_MAX_CONTEXT_CHARS)]\n</system-reminder>`;
    out = out.slice(0, Math.max(0, maxChars - note.length)) + note;
  }
  return out;
}

export interface SessionHooksOptions {
  projectDir: () => string;
  transcriptPath?: (sessionId: string) => string | undefined;
  debug?: boolean;
  env?: NodeJS.ProcessEnv;
  /** OrchestratorConfig.hooks === false */
  disabled?: boolean;
}

// One process `exit` listener for every live session (attempt orchestrators etc. must not stack listeners).
const liveSessions = new Set<SessionHooks>();
let exitListenerInstalled = false;
function trackLive(h: SessionHooks, live: boolean): void {
  if (live) {
    liveSessions.add(h);
    if (!exitListenerInstalled) {
      exitListenerInstalled = true;
      process.on('exit', () => { for (const s of [...liveSessions]) s.endSessionSync('exit'); });
    }
  } else liveSessions.delete(h);
}

export class SessionHooks {
  private pending: Array<{ event: HookEvent; text: string }> = [];
  private sessionId = '';
  private pendingStart: SessionStartSource | null = null;
  private started = false;

  constructor(private readonly o: SessionHooksOptions) {}

  private get env(): NodeJS.ProcessEnv { return this.o.env ?? process.env; }

  enabled(): boolean { return !this.o.disabled && hooksEnabled(this.env); }

  config(): HooksConfig {
    if (!this.enabled()) return {};
    return loadHooksConfig({ projectDir: this.o.projectDir(), env: this.env });
  }

  /** True when at least one group is configured for the event (cheap: two stats, cached parse). */
  has(event: HookEvent): boolean { return !!this.config()[event]?.length; }

  hasPending(): boolean { return this.pending.length > 0; }

  get currentSessionId(): string { return this.sessionId; }
  get isStarted(): boolean { return this.started; }
  get pendingStartSource(): SessionStartSource | null { return this.pendingStart; }

  private log = (line: string): void => {
    appendHooksLog(`[${this.sessionId.slice(0, 8)}] ${line}`, this.env);
    if (this.o.debug) console.warn(`[hooks] ${line}`);
  };

  private payloadBase(): Record<string, unknown> {
    const t = this.sessionId ? this.o.transcriptPath?.(this.sessionId) : undefined;
    return t ? { transcript_path: t } : {};
  }

  /** Run one event's hooks and queue their context. Returns the run (blocked → the caller refuses the prompt / tool). */
  async fire(event: HookEvent, payload: Record<string, unknown> = {}, matchValue?: string): Promise<HookRunResult> {
    const config = this.config();
    if (!config[event]?.length) return { contexts: [], ran: 0 };
    const r = await runHooks(config, {
      event, matchValue, payload: { ...this.payloadBase(), ...payload }, sessionId: this.sessionId, projectDir: this.o.projectDir(), env: this.env, log: this.log,
    });
    if (!r.blocked && event !== 'SessionEnd') for (const text of r.contexts) if (text) this.pending.push({ event, text });
    return r;
  }

  /** A session became current (createSession → 'new' | 'schedule' …, resumeSession → 'resume'). End the previous one first (endSession). */
  sessionCreated(sessionId: string, source: SessionStartSource): void {
    this.sessionId = sessionId;
    this.pendingStart = source;
    this.started = false;
    this.pending = [];
  }

  /** Called at the start of every turn: fires the deferred SessionStart once. */
  async ensureStarted(): Promise<void> {
    if (this.pendingStart === null || !this.sessionId || !this.enabled()) return;
    const source = this.pendingStart;
    this.pendingStart = null;
    this.started = true;
    trackLive(this, true);
    await this.fire('SessionStart', { source }, source);
  }

  /** SessionStart after a compaction (fires now; context lands in the next request). */
  async compacted(): Promise<void> {
    if (!this.enabled()) return;
    await this.fire('SessionStart', { source: 'compact' }, 'compact');
  }

  /** SessionEnd for the current session if it started. A later turn on the same session fires SessionStart(resume) again. */
  async endSession(reason: string): Promise<void> {
    if (!this.started) return;
    this.started = false;
    trackLive(this, false);
    this.pendingStart = 'resume';
    await this.fire('SessionEnd', { reason });
    this.pending = [];
  }

  /** Exit-time twin of endSession (process `exit` listener: nothing async runs there). */
  endSessionSync(reason: string): void {
    if (!this.started) return;
    this.started = false;
    trackLive(this, false);
    const config = this.config();
    if (!config.SessionEnd?.length) return;
    runHooksSync(config, {
      event: 'SessionEnd', payload: { ...this.payloadBase(), reason }, sessionId: this.sessionId, projectDir: this.o.projectDir(), env: this.env, log: this.log,
    });
  }

  /** Take every queued context as ONE text block for the next model request (null when nothing is queued). */
  drain(): string | null {
    if (!this.pending.length) return null;
    const items = this.pending;
    this.pending = [];
    return formatHookContext(items, resolveMaxHookContextChars(this.env));
  }
}
