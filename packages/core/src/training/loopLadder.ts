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

  constructor(thresholds: LoopLadderThresholds = {}) {
    this.remindAt = thresholds.remindAt ?? envInt('LOOP_REMIND_AT', 2);
    this.diversifyAt = thresholds.diversifyAt ?? envInt('LOOP_DIVERSIFY_AT', 4);
    this.breakAt = thresholds.breakAt ?? envInt('LOOP_BREAK_AT', 6);
  }

  observe(toolName: string, outcome: Pick<ToolOutcome, 'status' | 'approachHash' | 'family'>): LadderResult {
    const key = `${toolName}\n${outcome.approachHash}`;
    if (outcome.status === 'ok') {
      this.counts.delete(key);
      return { action: 'none', count: 0 };
    }
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
