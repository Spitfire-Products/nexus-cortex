/**
 * LoopLadder — escalation over repeated FAILING approaches (per tool +
 * approachHash), replacing independent blunt guards with teach-then-break:
 *   remind(2) → diversify(4) → break(6); an ok on the approach resets it.
 * (docs/UNIFIED_OUTCOME_LADDER.md. The exact-hash MAX_LOOP_REPETITIONS
 * detector remains as the fast path for byte-identical spam.)
 */
import type { ToolOutcome } from './toolOutcome.js';

export type LadderAction = 'none' | 'remind' | 'diversify' | 'break';

export interface LadderResult {
  action: LadderAction;
  /** Consecutive not-ok observations for this (tool, approach). */
  count: number;
  family?: string;
}

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

  constructor(thresholds: LoopLadderThresholds = {}) {
    this.remindAt = thresholds.remindAt ?? envInt('LOOP_REMIND_AT', 2);
    this.diversifyAt = thresholds.diversifyAt ?? envInt('LOOP_DIVERSIFY_AT', 4);
    this.breakAt = thresholds.breakAt ?? envInt('LOOP_BREAK_AT', 6);
    this.pollAt = envInt('POLL_REMIND_AT', 4);
    this.pollEnabled = (process.env.CORTEX_POLL_GUARD ?? '').trim().toLowerCase() === 'true';
  }

  observe(toolName: string, outcome: Pick<ToolOutcome, 'status' | 'approachHash' | 'family'>): LadderResult {
    const key = `${toolName}\n${outcome.approachHash}`;
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
