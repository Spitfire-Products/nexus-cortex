/**
 * LoopLadder — escalation over repeated FAILING approaches (per tool +
 * approachHash), replacing independent blunt guards with teach-then-break:
 *   remind(2) → diversify(4) → break(6); an ok on the approach resets it.
 * (docs/UNIFIED_OUTCOME_LADDER.md. The exact-hash MAX_LOOP_REPETITIONS
 * detector remains as the fast path for byte-identical spam.)
 */
import { diceSimilarity, type ToolOutcome } from './toolOutcome.js';
import { isChunkProgression, type ChunkRead } from './chunkReadProgression.js';
import { commandIdentityDiffers, commandIdentityDigest, type CommandIdentity } from './commandIdentity.js';

export type LadderAction = 'none' | 'remind' | 'diversify' | 'break' | 'poll_steer';

export interface LadderResult {
  action: LadderAction;
  /** Consecutive not-ok observations for this (tool, approach). */
  count: number;
  family?: string;
  /** Which lens produced a 'neardup' result: 'hash' (approachHash equality) or 'similarity' (HB-LOOP-NEARDUP). */
  trigger?: 'hash' | 'similarity';
  /** R135 HB-POLL-LOOP: set on a 'poll_steer' result — the probe identity and the consecutive poll streak. */
  poll?: { probe: string; waits: number; waitSec?: number };
}

const RANK: Record<LadderAction, number> = { none: 0, remind: 1, diversify: 2, break: 3, poll_steer: 1 };

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
  // R136 HB-NEARDUP-SCRIPT-SHAPE: each entry carries the command identity (script paths / inline body);
  // a DIFFERENT identity is never a near-duplicate no matter how similar the shared shell wrapper is.
  private readonly recentSim: Array<{ tool: string; text: string; identity?: CommandIdentity }> = [];
  private readonly simNudged = new Set<string>();
  private readonly recentKeys: string[] = [];
  private readonly nearDupNudged = new Set<string>();
  // HB-CHUNKED-READS (R128): last chunk read per (tool, file). A disjoint increasing progression
  // gets a range-suffixed key (a NEW approach for the hash lens, poll guard and failure ladder) and
  // skips the similarity lens; an identical/overlapping/backwards range keeps the plain hash key.
  private readonly lastChunk = new Map<string, ChunkRead>();
  // R135 HB-POLL-LOOP (2026-09-13): an OK poll-and-wait (sleep N; read-only probe — classifyToolOutcome's
  // outcome.poll) is monitoring, not a stuck approach. It feeds NEITHER near-dup lens NOR the failure
  // ladder; consecutive same-probe polls are counted here and answered with a 'poll_steer' nudge at the
  // 3rd (then every 10th): move the wait into a background job + BashOutput. A bare read-only probe that
  // immediately repeats the previous probe of the same tool is a poll too. Failing polls (curl exit 7)
  // still climb the failure ladder as before. The old CORTEX_POLL_GUARD busy-wait remind is untouched.
  private lastPollKey: string | null = null;
  private pollStreak = 0;
  private pollWaitSum = 0;
  private pollWaitN = 0;
  private readonly lastProbe = new Map<string, string>();

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

  /** HB-LOOP-NEARDUP: windowed similarity count for an executing tool's normalized text. R136: script identity
   *  dominates wrapper shape — entries whose identity differs are skipped before the text comparison. */
  private observeSimilar(toolName: string, text: string | undefined, identity?: CommandIdentity): LadderResult | null {
    if (!this.nearDupEnabled || !text) return null;
    const count = 1 + this.recentSim.filter((e) =>
      e.tool === toolName && !commandIdentityDiffers(e.identity, identity, this.nearDupSim) && (e.text === text || diceSimilarity(e.text, text) >= this.nearDupSim),
    ).length;
    this.recentSim.push({ tool: toolName, text, ...(identity ? { identity } : {}) });
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

  /** R135: true when this observation is a poll (a wait + read-only probe, or a bare probe repeating the tool's previous probe). */
  private notePoll(toolName: string, poll: ToolOutcome['poll']): boolean {
    const probe = poll?.probe;
    const bareRepeat = !!poll && !poll.isPoll && !!probe && this.lastProbe.get(toolName) === probe;
    if (probe) this.lastProbe.set(toolName, probe); else this.lastProbe.delete(toolName);
    return !!poll && (poll.isPoll || bareRepeat);
  }

  observe(toolName: string, outcome: Pick<ToolOutcome, 'status' | 'approachHash' | 'family' | 'approachText' | 'chunkRead' | 'commandIdentity' | 'poll'>): LadderResult {
    let key = `${toolName}\n${outcome.approachHash}`;
    // R136b: script identity (executed file / inline body) is part of the approach for the hash lens and the
    // failure ladder — different scripts under one wrapper are different approaches; no identity = plain key.
    const ident = commandIdentityDigest(outcome.commandIdentity);
    if (ident) key += `\n@${ident}`;
    let progression = false;
    if (outcome.chunkRead) {
      const chunkKey = `${toolName}\n${outcome.chunkRead.file}`;
      progression = isChunkProgression(this.lastChunk.get(chunkKey), outcome.chunkRead);
      this.lastChunk.set(chunkKey, outcome.chunkRead);
      if (progression) key += `\n${outcome.chunkRead.start}-${outcome.chunkRead.end}`;
    }
    const isPoll = this.notePoll(toolName, outcome.poll);
    if (isPoll && outcome.status === 'ok') {
      this.counts.delete(key); // an ok still resets the failure rung of this approach
      const pkey = `${toolName}\n${outcome.poll!.probe}`;
      if (pkey === this.lastPollKey) this.pollStreak += 1;
      else { this.lastPollKey = pkey; this.pollStreak = 1; this.pollWaitSum = 0; this.pollWaitN = 0; }
      if (typeof outcome.poll!.waitSec === 'number') { this.pollWaitSum += outcome.poll!.waitSec; this.pollWaitN += 1; }
      if (this.pollStreak === 3 || (this.pollStreak > 3 && this.pollStreak % 10 === 0)) {
        return {
          action: 'poll_steer', count: this.pollStreak, family: 'poll',
          poll: { probe: outcome.poll!.probe!, waits: this.pollStreak, ...(this.pollWaitN ? { waitSec: Math.round(this.pollWaitSum / this.pollWaitN) } : {}) },
        };
      }
      return { action: 'none', count: 0 };
    }
    // A non-poll call of the same tool ends the consecutive streak (a failing poll keeps it).
    if (!isPoll && this.lastPollKey?.startsWith(`${toolName}\n`)) this.lastPollKey = null;
    const hashDup = this.observeNearDup(key);
    const simDup = this.observeSimilar(toolName, progression ? undefined : outcome.approachText, outcome.commandIdentity);
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
  // R135 HB-POLL-LOOP: a poll-and-wait streak — steer the wait off the turn; the executor stays available.
  if (result.action === 'poll_steer') {
    const p = result.poll;
    const waits = p?.waitSec !== undefined ? `${p.waits} waits of ~${p.waitSec} s on ${p.probe}` : `${p?.waits ?? result.count} repeats of ${p?.probe ?? toolName}`;
    return (
      `<system-reminder>\nPolling pattern detected (${waits}). Move the wait off the turn: launch the probe loop with ` +
      `run_in_background (or \`persistentSession\`) and poll it with BashOutput wait_seconds/wait_for (a side-effect-free wait that returns on new output, exit, or match) instead of sleep; keep any foreground wait <= 60 s. ` +
      `${toolName} stays available.\n</system-reminder>`
    );
  }
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
/**
 * R137 HB-POLL-REPEAT-BREAKER: tools whose whole purpose is to RE-READ a handle. An identical
 * call is the expected shape of a poll (BashOutput {bash_id} after TOOL_TIMEOUT_MODE=auto promoted
 * a long job — exactly what the promote steering tells the model to do), so byte-identical INPUT is
 * not evidence of a stall; only byte-identical OUTPUT is. TB4.0 validation: 5 identical BashOutput
 * polls on a live `timeout 580 python3 fit.py` tripped the exact-repeat breaker, ending the turn
 * with the final-answer nudge while the job was still running (and banking toolCallIterations=1000).
 */
export const POLL_TOOL_NAMES: ReadonlySet<string> = new Set(['BashOutput', 'InspectSandbox']);

/** True when a poll tool's result says the polled process is still alive (BashOutput: the
 *  `Status: Running` line from BashOutputTool, or its `isRunning` metadata). Never true for
 *  non-poll tools. */
export function isPollResultRunning(toolName: string, content: string, metadata?: Record<string, unknown>): boolean {
  if (!POLL_TOOL_NAMES.has(toolName)) return false;
  if (metadata && metadata.isRunning === true) return true;
  return /^Status: Running$/m.test(content);
}

/** Small stable text hash (djb2) — keeps the tracker from retaining whole tool outputs. */
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}:${text.length}`;
}

export class ExactRepeatTracker {
  private lastKey: string | null = null;
  private count = 0;
  // R137 poll-tool state for the CURRENT key only (a different call resets everything).
  private lastResultHash: string | null = null;
  /** Length of the trailing run of byte-identical, not-running results for the current key. */
  private resultStreak = 0;
  /** A poll was observed and its result has not been reported yet (noteResult never called). */
  private pendingResult = false;
  /** R135b: the current key is poll-shaped — a POLL_TOOL_NAMES tool, or a Bash poll-and-wait (observe hint). */
  private lastIsPoll = false;

  /** Returns the CONSECUTIVE occurrence count for this exact call. For poll tools
   *  (POLL_TOOL_NAMES) the count is the trailing run of byte-identical stalled results + 1 —
   *  a live process or changing output never accumulates (falls back to the raw consecutive
   *  count when results were never reported via noteResult). */
  observe(toolName: string, inputHash: string, opts?: { isPoll?: boolean }): number {
    const key = `${toolName}\u0000${inputHash}`;
    if (key === this.lastKey) {
      this.count += 1;
    } else {
      this.lastKey = key;
      this.count = 1;
      this.lastResultHash = null;
      this.resultStreak = 0;
      this.pendingResult = false;
    }
    // R135b HB-POLL-LOOP: a Bash poll-and-wait (outcome.poll.isPoll, hinted by the caller) gets the same
    // result-aware count as BashOutput — identical polls with CHANGING results are progress, not a repeat.
    this.lastIsPoll = POLL_TOOL_NAMES.has(toolName) || opts?.isPoll === true;
    if (!this.lastIsPoll) return this.count;
    const effective = this.count > 1 && this.pendingResult ? this.count : this.resultStreak + 1;
    this.pendingResult = true;
    return effective;
  }

  /** Report the RESULT of the most recently observed call (poll-shaped keys only; other keys are ignored). */
  noteResult(toolName: string, inputHash: string, content: string, metadata?: Record<string, unknown>): void {
    if (`${toolName}\u0000${inputHash}` !== this.lastKey || !this.lastIsPoll) return;
    this.pendingResult = false;
    if (isPollResultRunning(toolName, content, metadata)) {
      this.lastResultHash = null;
      this.resultStreak = 0;
      return;
    }
    const h = hashText(content);
    this.resultStreak = h === this.lastResultHash ? this.resultStreak + 1 : 1;
    this.lastResultHash = h;
  }
}

/** Orchestrator glue (both tool loops): feed a batch's results back to the tracker. Non-poll keys
 *  (neither a POLL_TOOL_NAMES tool nor a Bash poll hinted at observe) are ignored inside noteResult;
 *  the inputHash must be the same JSON.stringify(input) the observe() call used. */
export function notePollResults(
  tracker: ExactRepeatTracker,
  toolUseBlocks: ReadonlyArray<{ id: string; name: string; input: unknown }>,
  toolResults: ReadonlyArray<{ tool_use_id: string; tool_name: string; content: string; metadata?: Record<string, unknown> }>,
): void {
  const inputById = new Map(toolUseBlocks.map((b) => [b.id, b.input]));
  for (const tr of toolResults) {
    if (!POLL_TOOL_NAMES.has(tr.tool_name) && tr.tool_name !== 'Bash') continue;
    if (!inputById.has(tr.tool_use_id)) continue;
    tracker.noteResult(tr.tool_name, JSON.stringify(inputById.get(tr.tool_use_id)), tr.content ?? '', tr.metadata);
  }
}
