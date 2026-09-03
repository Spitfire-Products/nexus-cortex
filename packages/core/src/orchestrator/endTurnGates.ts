/**
 * EndTurn gates — ONE implementation shared by the non-streaming and streaming tool loops.
 *
 * 4.91.0 (2026-09-03, v4 audit): until now Stages 2/4/5 (citation grounding, requirements attestation,
 * integrity) and the per-turn evidence they verify against lived inline in sendMessage() only, so every
 * streaming client ran ungated. This module holds the per-turn evidence (`TurnEvidence`) and the gate
 * evaluation, exception-safe: a gate fault becomes an is_error EndTurn result and NEVER escapes to the
 * tool loop (whose catch re-loops into re-executing the batch — def-7f510b5635).
 *
 * Grounding corpus (v4 doctrine-mine: 17/43 findings were Stage-2 rejections on text the model had
 * legitimately produced or run this turn):
 *   - citations   ground against tool OUTPUTS + Write.content / Edit.new_string (text authored THIS turn)
 *   - verified_how (strict) additionally against Bash commands run this turn (an executed check)
 */
import { verifyCitationsGrounded } from './citationVerification.js';
import {
  verifyRequirements,
  resolveEndTurnRequirementsMode,
  resolveEndTurnRequirementsStrict,
} from './requirementsVerification.js';
import { verifyIntegrity, resolveEndTurnIntegrityMode } from './integrityVerification.js';

export interface GateToolResult { tool_use_id: string; tool_name: string; content: any; is_error?: boolean; metadata?: any }
export interface GateToolUse { id: string; name: string; input: any }

export const MUTATING_TOOLS = ['Edit', 'Write', 'Bash', 'NotebookEdit'];
export const READISH_TOOLS = ['Read', 'Grep', 'Glob'];

/** Per-turn evidence the EndTurn gates verify against. One instance per user turn. */
export class TurnEvidence {
  /** Successful tool outputs this turn (quotable observations). */
  outputs: string[] = [];
  /** Write.content / Edit.new_string this turn — text the model authored; quotable. */
  writeInputs: string[] = [];
  /** Bash commands executed this turn — proof a check RAN (not an observation). */
  commands: string[] = [];
  webQueries: string[] = [];
  webContent: string[] = [];
  usedTools = false;
  usedMutatingTool = false;
  usedReadishTool = false;
  lastCitations: Array<{ reference: string; verbatim_source: string }> | undefined;
  endTurnCalled = false;
  effortTailBounced = false;

  /** Call once per executed batch with the tool_use blocks (before or after execution). */
  noteToolUses(toolUses: GateToolUse[]): void {
    for (const tu of toolUses) {
      if (tu.name === 'EndTurn') continue;
      this.usedTools = true;
      if (MUTATING_TOOLS.includes(tu.name)) this.usedMutatingTool = true;
      if (READISH_TOOLS.includes(tu.name)) this.usedReadishTool = true;
      const input: any = tu.input ?? {};
      if (tu.name === 'WebSearch') {
        if (typeof input.query === 'string' && input.query) this.webQueries.push(input.query);
      } else if (tu.name === 'Browse') {
        if (typeof input.task === 'string' && input.task) this.webQueries.push(input.task);
      } else if (tu.name === 'Write') {
        if (typeof input.content === 'string' && input.content) this.writeInputs.push(input.content);
      } else if (tu.name === 'Edit') {
        if (typeof input.new_string === 'string' && input.new_string) this.writeInputs.push(input.new_string);
      } else if (tu.name === 'Bash') {
        if (typeof input.command === 'string' && input.command) this.commands.push(input.command);
      }
    }
  }

  /** Call once per executed batch with the results. */
  noteToolResults(results: GateToolResult[]): void {
    for (const tr of results) {
      if (tr.tool_name === 'EndTurn' || tr.is_error) continue;
      const txt = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content);
      if (!txt) continue;
      this.outputs.push(txt);
      if (tr.tool_name === 'WebSearch' || tr.tool_name === 'WebFetch' || tr.tool_name === 'Browse') this.webContent.push(txt);
    }
  }

  /** What a citation may be grounded in: observations + text the model wrote this turn. */
  citationCorpus(): string { return [...this.outputs, ...this.writeInputs].join('\n'); }
  /** What a strict `verified_how` may be grounded in: the above + the commands actually run. */
  verificationCorpus(): string { return [...this.outputs, ...this.writeInputs, ...this.commands].join('\n'); }
}

export interface GateDeps {
  userTaskText: string;
  env?: NodeJS.ProcessEnv;
  debug?: boolean;
  /** Bank a decision-store event (fire-and-forget). */
  recordEvent: (kind: string, detail: Record<string, unknown>, toolName?: string) => void;
  /** Effort-tail hooks (CORTEX_EFFORT_TAIL): remaining elevated continuations + arm N more. */
  effortTail?: { remaining: () => number; arm: (turns: number) => void };
  log?: (msg: string) => void;
}

/**
 * Evaluate Stages 2/4/5 (+ the effort tail) over this batch's EndTurn result(s). Mutates `tr.is_error`
 * / `tr.content` on rejection and `ev.endTurnCalled` on acceptance. Never throws.
 */
export function evaluateEndTurnGates(
  ev: TurnEvidence,
  toolResults: GateToolResult[],
  toolUses: GateToolUse[],
  deps: GateDeps,
): void {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((m: string) => console.warn(m));
  try {
    for (const tr of toolResults) {
      if (tr.tool_name !== 'EndTurn') continue;
      const etUse = toolUses.find((t) => t.name === 'EndTurn');
      // EFFORT TAIL (def-efdbb67fd8): bounce the FIRST EndTurn once, arm elevated effort for N continuations.
      if (env.CORTEX_EFFORT_TAIL === 'true' && !ev.effortTailBounced && deps.effortTail && deps.effortTail.remaining() <= 0) {
        ev.effortTailBounced = true;
        const tailTurns = Math.max(1, parseInt(env.CORTEX_EFFORT_TAIL_TURNS || '2', 10) || 2);
        deps.effortTail.arm(tailTurns);
        deps.recordEvent('effort_pulse', { trigger: 'tail', cumFailures: 0, turns: tailTurns, level: env.CORTEX_EFFORT_PULSE_LEVEL || 'high' }, 'EndTurn');
        tr.is_error = true;
        tr.content =
          'Before finishing: verify at depth. Re-read the original task statement; ' +
          're-open and check each requirement against the ACTUAL files/outputs you produced this turn ' +
          '(do not rely on memory of them); fix anything that does not match; then call EndTurn again ' +
          'with the verified attestation.';
        if (deps.debug) log(`[EffortTail] first EndTurn bounced — re-attestation at elevated effort (${tailTurns} continuation(s))`);
        continue;
      }
      const input: any = etUse?.input ?? {};
      const cits = input.citations;
      ev.lastCitations = Array.isArray(cits) ? cits : undefined; // Stage 3 baseline
      const verdict = verifyCitationsGrounded(cits, ev.citationCorpus());
      if (!verdict.grounded) {
        const bad = verdict.ungrounded
          .map((u: any) => ` - "${u.reference}" — not found in this turn's tool output: ${String(u.verbatim_source).slice(0, 120)}`)
          .join('\n');
        tr.is_error = true;
        tr.content =
          `EndTurn REJECTED — these citations are not grounded in anything you read this turn:\n${bad}\n\n` +
          `A quote or coordinate you did not transcribe from this turn's tool output is a fabrication (a regurgitated guess), exactly like a non-matching edit old_string. ` +
          `Either RE-READ the exact region and copy the real text, or DELETE that reference from your answer (quote only code you can ground), then call EndTurn again. ` +
          `Grounding is per-TURN: if the line you want to cite is not in THIS turn's tool output (you read it earlier), RE-RUN the command that displays it now (cat/grep/sed the file, run the test) and copy the line from THAT output — do not resubmit the same citations. Text you WROTE this turn (Write/Edit content) counts as grounded.`;
        log(`[Orchestrator] Stage2: EndTurn rejected — ${verdict.ungrounded.length} ungrounded citation(s).`);
        continue;
      }
      let accepted = true;
      if (resolveEndTurnRequirementsMode(env)) {
        const s4 = verifyRequirements({
          requirements: input.requirements,
          verification: input.verification,
          userTaskText: deps.userTaskText,
          turnUsedMutatingTool: ev.usedMutatingTool,
          strict: resolveEndTurnRequirementsStrict(env),
          toolOutputs: ev.verificationCorpus(),
        });
        if (!s4.ok) {
          accepted = false;
          tr.is_error = true;
          tr.content = s4.nudge!;
          log('[Orchestrator] Stage4: EndTurn rejected — requirements attestation unsatisfied.');
        }
      }
      if (accepted && resolveEndTurnIntegrityMode(env)) {
        const s5 = verifyIntegrity({
          webQueries: ev.webQueries,
          webContent: ev.webContent,
          writeInputs: ev.writeInputs,
          userTaskText: deps.userTaskText,
          sourcesAttestation: input.sources,
        });
        for (const f of s5.flags) deps.recordEvent('integrity_flag', { check: f.check, detail: f.detail });
        if (!s5.ok) {
          accepted = false;
          tr.is_error = true;
          tr.content = s5.nudge!;
          log(`[Orchestrator] Stage5: EndTurn rejected — ${s5.flags.length} integrity flag(s).`);
        }
      }
      if (accepted) ev.endTurnCalled = true;
    }
  } catch (gateErr: any) {
    const msg = String(gateErr?.message ?? gateErr).slice(0, 200);
    console.error(`[Orchestrator] EndTurn gate evaluation threw (converted to an error result, batch NOT re-run): ${msg}`);
    for (const tr of toolResults) {
      if (tr.tool_name !== 'EndTurn') continue;
      tr.is_error = true;
      tr.content =
        `EndTurn gate evaluation failed internally (${msg}). This is a harness fault, not your attestation. ` +
        'Call EndTurn again with well-formed arrays: citations [{reference, verbatim_source}], verification [{command, observed_result}], requirements [{requirement, satisfied_by, verified_how}].';
    }
  }
}

/** Stage-1 reminder for a turn that used tools but has not (validly) called EndTurn. */
export function buildMissingEndTurnReminder(ev: TurnEvidence, env: NodeJS.ProcessEnv = process.env): string {
  const citEmphasis = ev.usedReadishTool
    ? ' You read code/files this turn: for EACH reference in your draft give the EXACT verbatim source you copied it from; if you cannot, DELETE the reference (quote the code instead of asserting a coordinate).'
    : '';
  const verEmphasis = ev.usedMutatingTool
    ? ' You ran edit/write/bash this turn: in `verification` list every build/test/lint command you ACTUALLY ran with the real result line you saw — never a command you did not run.'
    : '';
  const reqEmphasis = resolveEndTurnRequirementsMode(env)
    ? ' Also include `requirements` (array of {requirement, satisfied_by, verified_how}): copy each requirement in the task\'s OWN words and make verified_how a pasted output line.'
    : '';
  return (
    '<system-reminder>You used tools this turn but have not called EndTurn. ' +
    'You MUST call EndTurn before any final answer. It is generative, not a checkbox: ' +
    'reconstruct `citations` (array of {reference, verbatim_source}), `verification` ' +
    '(array of {command, observed_result}), `summary`, `open_items`, and a skeptical ' +
    '`self_review` (what you did NOT check, what is assumed/possibly wrong, what one ' +
    'more tool call would verify).' +
    citEmphasis + verEmphasis + reqEmphasis +
    ' Call EndTurn now — do not produce a final answer until you have.</system-reminder>'
  );
}
