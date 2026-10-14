/**
 * contextPressure — R258 (4.124.79, 2026-10-14): the two context-pressure mechanisms ported from Claude Code's compaction stack after the
 * claude-code-variables deep dive (binary 2.1.299; flags tengu_time_based_microcompact / tengu_zany_pike, the autocompact thrash detector).
 *
 *  1. TOOL-RESULT PRUNE GATE. Claude Code clears OLD tool results (keep the last 5 tool uses, only when >= 20 K tokens would be saved)
 *     long before it compacts, because old tool results are the bulk of a long agent session and the least useful part. Our pruner
 *     (ToolResultPruner, grok-build port) existed but was gated at 50 % of the RAW context window — on the 10-05..10-13 DeepSeek card that
 *     was 500 K, ABOVE the 470 K compaction threshold, so it never ran before compaction. The gate is now a fraction of the compaction
 *     THRESHOLD (CORTEX_TOOL_RESULT_PRUNE_AT, default 0.5) with the keep-window and hard-clear age as levers.
 *  2. THRASH DETECTOR. Claude Code warns "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous
 *     compact, 3 times in a row". payments (t4in) compacted 57 times in 60 minutes with nobody noticing until the cost ledger. The
 *     tracker records a `compaction_thrash` event on the same rule so a bench / operator sees it live.
 */

export interface ToolResultPruneGate {
  /** fraction of the compaction threshold (or of the window when no threshold is known) above which the request copy is pruned */
  atFraction: number;
  /** turns whose tool results are never touched, counting back from the newest */
  keepLastNTurns: number;
  /** turn age at which an aged tool result is fully elided */
  hardClearAgeTurns: number;
}

export function resolveToolResultPruneGate(env: NodeJS.ProcessEnv = process.env): ToolResultPruneGate {
  const frac = Number(String(env.CORTEX_TOOL_RESULT_PRUNE_AT ?? '').trim());
  const keep = Number(String(env.CORTEX_TOOL_RESULT_PRUNE_KEEP_TURNS ?? '').trim());
  const hard = Number(String(env.CORTEX_TOOL_RESULT_PRUNE_HARD_AGE ?? '').trim());
  return {
    atFraction: Number.isFinite(frac) && frac > 0 ? Math.min(1.5, Math.max(0.05, frac)) : 0.5,
    keepLastNTurns: Number.isFinite(keep) && keep >= 1 ? Math.floor(keep) : 3,
    hardClearAgeTurns: Number.isFinite(hard) && hard >= 2 ? Math.floor(hard) : 10,
  };
}

/** The token level at which pruning starts: fraction × compaction threshold when known, else fraction × window. Pure. */
export function pruneGateTokens(gate: ToolResultPruneGate, threshold: number | undefined, window: number): number {
  const base = threshold && threshold > 0 ? threshold : window;
  return Math.floor(base * gate.atFraction);
}

/** Claude Code's rule: thrashing = the context refilled to the limit within 3 turns of the previous compaction, 3 times in a row. */
export class CompactionThrashTracker {
  private lastTurn: number | undefined;
  private rapidStreak = 0;
  constructor(private readonly withinTurns = 3, private readonly streakToTrip = 3) {}
  /** Record a compaction at `turn`; returns true when the thrash rule trips (and resets the streak). */
  record(turn: number): boolean {
    if (this.lastTurn !== undefined && turn - this.lastTurn <= this.withinTurns) this.rapidStreak += 1;
    else this.rapidStreak = 0;
    this.lastTurn = turn;
    if (this.rapidStreak >= this.streakToTrip) { this.rapidStreak = 0; return true; }
    return false;
  }
  get streak(): number { return this.rapidStreak; }
}
