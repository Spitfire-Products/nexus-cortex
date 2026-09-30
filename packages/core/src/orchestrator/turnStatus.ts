/**
 * HB-TURN-STATUS (CORTEX_TURN_STATUS, DARK): a one-line STATUS tail on EVERY tool-result round.
 *
 * Evidence (r-tb4-early-finish-rootcause-2026-09-29): on TB4.0 the model's sense of elapsed time ran 6-10x fast and it
 * gave up "out of time" at < 1 h of an 8 h budget. The only clock it saw was the R151 WALL BUDGET line, injected once per
 * 10% band. This lever gives it an accurate clock (plus context pressure and running background shells) on every round.
 *
 * Cache safety: the line is appended ONLY to the tail of the newest tool_result content of the round, in the in-memory
 * history (same carrier as the R151 band line), so it becomes part of that message for every later request — earlier
 * requests' prefixes stay byte-identical and only the new tail varies.
 *
 *   CORTEX_TURN_STATUS = off (default; unset = byte-identical requests) | auto (on when a turn deadline exists) | on (always)
 */

export type TurnStatusMode = 'off' | 'auto' | 'on';

export function resolveTurnStatusMode(env: NodeJS.ProcessEnv = process.env): TurnStatusMode {
  const v = (env.CORTEX_TURN_STATUS ?? '').trim().toLowerCase();
  if (v === 'auto') return 'auto';
  if (v === 'on' || v === 'true' || v === '1') return 'on';
  return 'off';
}

/** Whether the status tail fires this turn: auto needs a deadline (the bench always sets CORTEX_TURN_DEADLINE_MS). */
export function turnStatusActive(mode: TurnStatusMode, deadlineMs: number): boolean {
  if (mode === 'on') return true;
  if (mode === 'auto') return deadlineMs > 0;
  return false;
}

/** Always-hours clock form: 0h12m, 7h12m. */
export function formatStatusHM(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}m`;
}

/** Compact token count: 840 / 84K / 1M / 1.05M. */
export function formatStatusTokens(n: number): string {
  if (!(n > 0)) return '0';
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

/** Background-shell age: 0m40s / 4m12s / 1h04m. */
export function formatShellAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/** The subset of executors' BackgroundProcess the status line reads (the registry is wired in by OrchestratorFactory). */
export interface StatusShell {
  shellId: string;
  command: string;
  startTime: Date | number;
  isRunning: boolean;
  exitCode: number | null;
}

const BG_MAX_SHELLS = 3;
const BG_CMD_CHARS_TOTAL = 80;

/** `bg: <id> "<cmd>" 4m12s running, <id> "<cmd>" 0m40s exited 1` — the 3 most recent shells; '' when none. */
export function backgroundShellsSegment(shells: readonly StatusShell[] | null | undefined, nowMs: number): string {
  if (!shells || shells.length === 0) return '';
  const recent = [...shells]
    .map((s) => ({ s, t: s.startTime instanceof Date ? s.startTime.getTime() : Number(s.startTime) }))
    .sort((a, b) => b.t - a.t)
    .slice(0, BG_MAX_SHELLS);
  const perCmd = Math.max(12, Math.floor(BG_CMD_CHARS_TOTAL / recent.length));
  const parts = recent.map(({ s, t }) => {
    let cmd = String(s.command ?? '').replace(/\s+/g, ' ').trim().replace(/"/g, "'");
    if (cmd.length > perCmd) cmd = cmd.slice(0, perCmd - 1) + '…';
    const state = s.isRunning ? 'running' : `exited ${s.exitCode ?? '?'}`;
    return `${s.shellId} "${cmd}" ${formatShellAge(nowMs - t)} ${state}`;
  });
  return `bg: ${parts.join(', ')}`;
}

export interface TurnStatusInput {
  elapsedMs: number;
  /** <= 0 = no deadline: elapsed only. */
  deadlineMs: number;
  /** Best estimate of the next request's prompt tokens; <= 0/undefined = unknown (segment omitted). */
  contextTokens?: number;
  contextWindow?: number;
  shells?: readonly StatusShell[] | null;
  nowMs?: number;
}

export function buildTurnStatusLine(input: TurnStatusInput): string {
  const segs: string[] = [];
  const { elapsedMs, deadlineMs } = input;
  if (deadlineMs > 0) {
    const pct = Math.min(100, Math.max(0, Math.round((elapsedMs / deadlineMs) * 100)));
    segs.push(`elapsed ${formatStatusHM(elapsedMs)} of ${formatStatusHM(deadlineMs)} (${pct}%), ~${formatStatusHM(Math.max(0, deadlineMs - elapsedMs))} left`);
  } else {
    segs.push(`elapsed ${formatStatusHM(elapsedMs)}`);
  }
  const tok = Number(input.contextTokens ?? 0);
  if (tok > 0) {
    const win = Number(input.contextWindow ?? 0);
    segs.push(win > 0
      ? `context ~${formatStatusTokens(tok)} of ${formatStatusTokens(win)} tokens (${Math.min(100, Math.round((tok / win) * 100))}%)`
      : `context ~${formatStatusTokens(tok)} tokens`);
  }
  const bg = backgroundShellsSegment(input.shells, input.nowMs ?? Date.now());
  if (bg) segs.push(bg);
  return `<system-reminder>STATUS: ${segs.join('; ')}</system-reminder>`;
}

/**
 * Append `line` to the TAIL of the newest tool_result content of the current round (walks back from the end of history,
 * stopping at the assistant message that issued the round). Mutates that block in place; every earlier message is left
 * untouched. Returns false when the round has no tool_result (nothing appended).
 */
export function appendStatusToNewestToolResult(history: any[], line: string): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const role = msg?.message?.role ?? msg?.role;
    if (role === 'assistant') return false;
    const content = msg?.message?.content ?? msg?.content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j];
      if (block?.type !== 'tool_result') continue;
      if (typeof block.content === 'string') {
        block.content = block.content + '\n\n' + line;
      } else if (Array.isArray(block.content)) {
        block.content.push({ type: 'text', text: line });
      } else {
        block.content = (block.content == null ? '' : JSON.stringify(block.content)) + '\n\n' + line;
      }
      return true;
    }
  }
  return false;
}
