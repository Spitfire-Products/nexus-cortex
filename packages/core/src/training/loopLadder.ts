/**
 * LoopLadder — escalation over repeated FAILING approaches (per tool +
 * approachHash), replacing independent blunt guards with teach-then-break:
 *   remind(2) → diversify(4) → break(6); an ok on the approach resets it.
 * (docs/UNIFIED_OUTCOME_LADDER.md. The exact-hash MAX_LOOP_REPETITIONS
 * detector remains as the fast path for byte-identical spam.)
 */
import { diceSimilarity, type ToolOutcome } from './toolOutcome.js';

export type LadderAction = 'none' | 'remind' | 'diversify' | 'break';

export interface LadderResult {
  action: LadderAction;
  /** Consecutive not-ok observations for this (tool, approach). */
  count: number;
  family?: string;
  /** Which lens produced a 'neardup' result: 'hash' (approachHash equality) or 'similarity' (HB-LOOP-NEARDUP). */
  trigger?: 'hash' | 'similarity';
}

const RANK: Record<LadderAction, number> = { none: 0, remind: 1, diversify: 2, break: 3 };

export interface LoopLadderThresholds {
  remindAt?: number;
  diversifyAt?: number;
  breakAt?: number;
}

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isNaN(v) || v <= 0 ? fallback : v;
}

export class LoopLadder {
  private readonly remindAt: number;
  private readonly diversifyAt: number;
  private readonly breakAt: number;
  private readonly counts = new Map<string, { count: number; family?: string }>();
  // Poll detector (run3 busy-wait deficiency class, 2026-08-26): repeated
  // SUCCEEDING near-identical calls — the ladder's inverse case (nothing else
  // fires on ok results; observed: status commands re-run 3-5x, sleep+
  // BashOutput polling while a background task runs). Env-gated
  // CORTEX_POLL_GUARD=true; one remind per streak at POLL_REMIND_AT (default
  // 4) consecutive identical-approach ok calls, family 'poll' so the signal
  // text and the banked event are distinguishable from failure escalation.
  private readonly pollAt: number;
  private readonly pollEnabled: boolean;
  private lastOkKey: string | null = null;
  private okStreak = 0;
  private pollNudged = false;
  // Item 14b (mini-distill: near-identical cluster x65, max 4 CONSECUTIVE —
  // varied-param polling invisible to the exact tracker AND the poll guard):
  // sliding-window counter over the normalized approachHash, outcome-agnostic
  // and interleaving-proof. N same-approach calls within the last M calls →
  // one diversify nudge; 2N → break. Env-gated CORTEX_NEARDUP_BREAKER.
  private readonly nearDupEnabled: boolean;
  private readonly nearDupWindow: number;
  private readonly nearDupNudgeAt: number;
  // HB-LOOP-NEARDUP (2026-09-10): SIMILARITY lens for EXECUTING tools. Replay of 47 real sessions
  // (cell-l loops + cell-d-k3): the hash lens peaked at 7-in-30 on every genuine loop (the 12 rung was
  // structurally unreachable — each loop iteration is 3-5 distinct calls) and its top hits were paging
  // Reads with different offsets. Bigram-Dice ≥ NEARDUP_SIM over the last NEARDUP_WINDOW executing
  // calls (slice-reads excluded): every real loop (dna-assembly ×2, gcode python -c ×1 at 7/7/18) crossed
  // 7; no PASSING session did (max 6 = healthy test iteration). Diversify at NEARDUP_SIM_AT (7), break at 2×.
  private readonly nearDupSim: number;
  private readonly nearDupSimAt: number;
  private readonly recentSim: Array<{ tool: string; text: string }> = [];
  private readonly simNudged = new Set<string>();
  private readonly recentKeys: string[] = [];
  private readonly nearDupNudged = new Set<string>();

  constructor(thresholds: LoopLadderThresholds = {}) {
    this.remindAt = thresholds.remindAt ?? envInt('LOOP_REMIND_AT', 2);
    this.diversifyAt = thresholds.diversifyAt ?? envInt('LOOP_DIVERSIFY_AT', 4);
    this.breakAt = thresholds.breakAt ?? envInt('LOOP_BREAK_AT', 6);
    this.pollAt = envInt('POLL_REMIND_AT', 4);
    this.pollEnabled = (process.env.CORTEX_POLL_GUARD ?? '').trim().toLowerCase() === 'true';
    this.nearDupEnabled = (process.env.CORTEX_NEARDUP_BREAKER ?? '').trim().toLowerCase() === 'true';
    // Window 30 (was 20) scales WITH nudgeAt 12 (was 8) so DENSITY semantics are
    // preserved exactly: nudge at 40% of window (8/20 -> 12/30), break at 80%
    // (16/20 -> 24/30). Without this, break (2*12=24) could never fit a 20-window
    // — the break rung would be structurally unreachable (caught by CI 2026-09-01).
    this.nearDupWindow = envInt('NEARDUP_WINDOW', 30);
    // Default 12 (was 8): the tb21g guarded run proved the diversify nudge MISFIRES on
    // persistence-wins grinds (rstan-to-pystan regressed on BOTH arms: baseline passed
    // via an 87-call grind; nudged runs got steered off it and failed). 12 gives
    // genuine grinds more rope while still catching runaway loops (engaged help:harm
    // was 3.75:1 at 8 — the tune trims the harm side). Ledger: r-tb21g-guarded.
    this.nearDupNudgeAt = envInt('NEARDUP_NUDGE_AT', 12);
    this.nearDupSimAt = envInt('NEARDUP_SIM_AT', 7);
    const sim = parseFloat(process.env.NEARDUP_SIM ?? '');
    this.nearDupSim = Number.isFinite(sim) && sim > 0 && sim <= 1 ? sim : 0.9;
  }

  /** HB-LOOP-NEARDUP: windowed similarity count for an executing tool's normalized text. */
  private observeSimilar(toolName: string, text: string | undefined): LadderResult | null {
    if (!this.nearDupEnabled || !text) return null;
    const count = 1 + this.recentSim.filter((e) => e.tool === toolName && (e.text === text || diceSimilarity(e.text, text) >= this.nearDupSim)).length;
    this.recentSim.push({ tool: toolName, text });
    if (this.recentSim.length > this.nearDupWindow) this.recentSim.shift();
    if (count >= this.nearDupSimAt * 2) return { action: 'break', count, family: 'neardup', trigger: 'similarity' };
    const nudgeKey = `${toolName}\n${text.slice(0, 80)}`;
    if (count >= this.nearDupSimAt && !this.simNudged.has(nudgeKey)) {
      this.simNudged.add(nudgeKey);
      return { action: 'diversify', count, family: 'neardup', trigger: 'similarity' };
    }
    return null;
  }

  /** 14b: outcome-agnostic windowed near-dup check. Returns a result when the
   *  same normalized approach recurs >= nudgeAt (diversify, once per key) or
   *  >= 2x nudgeAt (break) within the sliding window. */
  private observeNearDup(key: string): LadderResult | null {
    if (!this.nearDupEnabled) return null;
    this.recentKeys.push(key);
    if (this.recentKeys.length > this.nearDupWindow) this.recentKeys.shift();
    const count = this.recentKeys.filter(k => k === key).length;
    if (count >= this.nearDupNudgeAt * 2) {
      return { action: 'break', count, family: 'neardup', trigger: 'hash' };
    }
    if (count >= this.nearDupNudgeAt && !this.nearDupNudged.has(key)) {
      this.nearDupNudged.add(key);
      return { action: 'diversify', count, family: 'neardup', trigger: 'hash' };
    }
    return null;
  }

  observe(toolName: string, outcome: Pick<ToolOutcome, 'status' | 'approachHash' | 'family' | 'approachText'>): LadderResult {
    const key = `${toolName}\n${outcome.approachHash}`;
    const hashDup = this.observeNearDup(key);
    const simDup = this.observeSimilar(toolName, outcome.approachText);
    // the more severe of the two near-dup lenses
    const nearDup = hashDup && simDup ? (RANK[simDup.action] >= RANK[hashDup.action] ? simDup : hashDup) : (simDup ?? hashDup);
    if (outcome.status === 'ok') {
      this.counts.delete(key);
      if (this.pollEnabled) {
        if (key === this.lastOkKey) {
          this.okStreak += 1;
        } else {
          this.lastOkKey = key;
          this.okStreak = 1;
          this.pollNudged = false;
        }
        if (this.okStreak >= this.pollAt && !this.pollNudged) {
          this.pollNudged = true;
          return { action: 'remind', count: this.okStreak, family: 'poll' };
        }
      }
      if (nearDup) return nearDup;
      return { action: 'none', count: 0 };
    }
    this.lastOkKey = null;
    this.okStreak = 0;
    const entry = this.counts.get(key) ?? { count: 0 };
    entry.count += 1;
    if (outcome.family) entry.family = outcome.family;
    this.counts.set(key, entry);

    let action: LadderAction = 'none';
    if (entry.count >= this.breakAt) action = 'break';
    else if (entry.count >= this.diversifyAt) action = 'diversify';
    else if (entry.count >= this.remindAt) action = 'remind';
    // HB-LOOP-NEARDUP masking fix: a near-dup diversify/break is never dropped because a LOWER
    // failure-ladder rung (remind) fired on the same call — return the more severe signal.
    if (nearDup && RANK[nearDup.action] > RANK[action]) return nearDup;
    return { action, count: entry.count, ...(entry.family ? { family: entry.family } : {}) };
  }
}

/**
 * Format the tool-result signal text for a ladder escalation. `null` for
 * none/remind — the exact-prior and family reminders (processToolTraining)
 * already cover the remind rung; the ladder speaks only when it must.
 */
export function formatLadderSignal(toolName: string, result: LadderResult): string | null {
  // Poll guard (run3 busy-wait class): a remind with family 'poll' is a
  // SUCCEEDING-repeat nudge, not a failure escalation — inject its own text.
  if (result.action === 'remind' && result.family === 'poll') {
    return (
      `<system-reminder>\nBUSY-WAIT: you have run the same succeeding ${toolName} command ` +
      `${result.count} times in a row. Repeated polling burns turns without progress. Do other ` +
      `useful work, then check the result ONCE (BashOutput for background tasks) — or if nothing ` +
      `remains but waiting, conclude with what you have.\n</system-reminder>`
    );
  }
  if (result.action === 'diversify' && result.family === 'neardup') {
    return (
      `<system-reminder>\nNEAR-DUPLICATE PATTERN: ${result.count} of your recent ${result.count >= 8 ? 'calls' : 'tool calls'} are minor variations of the same ${toolName} command. ` +
      `Re-running variations does not create progress. Either wait properly (ONE blocking call with a timeout), ` +
      `take a genuinely different diagnostic step, or proceed with your fallback plan.\n</system-reminder>`
    );
  }
  if (result.action === 'break' && result.family === 'neardup') {
    return (
      `<system-reminder>\nNEAR-DUPLICATE BREAK: the same ${toolName} approach has recurred ${result.count} times in your recent calls despite a prior warning. ` +
      `Stop issuing variants of this command. Summarize what is known, then either execute ONE clearly different strategy or conclude with your best final answer.\n</system-reminder>`
    );
  }
  if (result.action === 'diversify') {
    const fam = result.family ? ` (failure family: "${result.family}")` : '';
    return (
      `<system-reminder>\nLOOP ESCALATION: this ${toolName} approach has failed ${result.count} ` +
      `consecutive times${fam}. STOP retrying variants of the same command. Take a genuinely ` +
      `different approach: state what has been ruled out, run ONE diagnostic to test a new ` +
      `hypothesis, or check the built-in skill guides for this domain (list them via the Skill ` +
      `tool or \`ls "$CORTEX_ROOT/.cortex/skills"\`).\n</system-reminder>`
    );
  }
  if (result.action === 'break') {
    return (
      `<system-reminder>\nLOOP BREAK: this approach has failed ${result.count} consecutive times ` +
      `and further retries are not productive. Do not call tools for this approach again. ` +
      `Summarize honestly what was attempted, what is known, and why it is stuck — then either ` +
      `attempt ONE clearly different strategy or conclude with your best final answer.\n</system-reminder>`
    );
  }
  return null;
}

/**
 * ExactRepeatTracker — CONSECUTIVE byte-identical call detection for the
 * MAX_LOOP_REPETITIONS hard killer (2026-08-26 fix). The legacy check counted
 * occurrences over the WHOLE turn (unbounded window), so legitimate scattered
 * repeats — identical `npm test` after each of four fixes — blunt-killed the
 * turn exactly like spam (the turns=1000 sentinel class; prime suspect in the
 * train-fasttext forensics). Consecutive-only semantics keep the killer's real
 * job (uninterrupted byte-identical spam — which is always consecutive) and
 * layer cleanly under the poll guard: nudge at POLL_REMIND_AT consecutive
 * succeeding repeats, hard kill at MAX_LOOP_REPETITIONS consecutive repeats.
 * Known v1 limitation (shared with the poll guard): strict alternation
 * (sleep → status → sleep → status) resets both trackers — covered by the
 * budget-pressure system, not by repeat detection.
 */
export class ExactRepeatTracker {
  private lastKey: string | null = null;
  private count = 0;

  /** Returns the CONSECUTIVE occurrence count for this exact call. */
  observe(toolName: string, inputHash: string): number {
    const key = `${toolName}\u0000${inputHash}`;
    if (key === this.lastKey) {
      this.count += 1;
    } else {
      this.lastKey = key;
      this.count = 1;
    }
    return this.count;
  }
}
