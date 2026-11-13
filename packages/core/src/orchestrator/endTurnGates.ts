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
  resolveEndTurnReqCoverage,
  coverageCheck,
} from './requirementsVerification.js';
import { verifyIntegrity, resolveEndTurnIntegrityMode } from './integrityVerification.js';

import { scopeCheck, scopeCheckEnabled } from '../training/scopeCheck.js';

export interface GateToolResult { tool_use_id: string; tool_name: string; content: any; is_error?: boolean; metadata?: any }
export interface GateToolUse { id: string; name: string; input: any }

export const MUTATING_TOOLS = ['Edit', 'Write', 'Bash', 'NotebookEdit'];
export const READISH_TOOLS = ['Read', 'Grep', 'Glob'];

/** Per-turn evidence the EndTurn gates verify against. One instance per user turn. */
/**
 * Stage-5 sources, filled by the harness (CORTEX_ENDTURN_SOURCES_AUTO, 2026-11-04). The attestation asks the model to list every web access;
 * the harness already saw each one (Browse task, WebSearch query, WebFetch URL), and on web tasks the missing list cost a rejected EndTurn
 * round per task (the ledger's "Stage-5 unattested-web rejections" web tax). When the model gives no valid list, the rows are built from the
 * turn's own calls and an integrity_flag sources_auto is banked; the transplant and solution-query audits (checks A/B) are unchanged.
 * off = the model must attest (rejected once otherwise).
 */
export function sourcesAutoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(off|false|0)$/i.test(String(env.CORTEX_ENDTURN_SOURCES_AUTO ?? '').trim());
}
export function autoSources(ev: { browseTasks: string[]; webQueries: string[]; webFetchUrls: string[] }): Array<{ accessed: string; purpose: string; used_for: string }> {
  const rows: Array<{ accessed: string; purpose: string; used_for: string }> = [];
  for (const t of ev.browseTasks) rows.push({ accessed: `Browse: ${t.replace(/\s+/g, ' ').slice(0, 200)}`, purpose: 'browse the site the task names', used_for: 'the browse report this answer is built from (harness-recorded)' });
  for (const q of ev.webQueries) rows.push({ accessed: `WebSearch: ${q.slice(0, 200)}`, purpose: 'find pages for the task', used_for: 'search results consulted this turn (harness-recorded)' });
  for (const u of ev.webFetchUrls) rows.push({ accessed: `WebFetch: ${u.slice(0, 300)}`, purpose: 'read a page for the task', used_for: 'page content consulted this turn (harness-recorded)' });
  return rows;
}
function validSources(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && v.every((r: any) => r && [r.accessed, r.purpose, r.used_for].every((x) => typeof x === 'string' && x.trim().length > 0));
}
export function sourcesAutoFilled(given: unknown, ev: { browseTasks: string[]; webQueries: string[]; webFetchUrls: string[] }, env: NodeJS.ProcessEnv = process.env): boolean {
  return sourcesAutoEnabled(env) && !validSources(given) && autoSources(ev).length > 0;
}
export function sourcesOrAuto(given: unknown, ev: { browseTasks: string[]; webQueries: string[]; webFetchUrls: string[] }, env: NodeJS.ProcessEnv = process.env): any {
  return sourcesAutoFilled(given, ev, env) ? autoSources(ev) : given;
}

export class TurnEvidence {
  /** Successful tool outputs this turn (quotable observations). */
  outputs: string[] = [];
  /** Write.content / Edit.new_string this turn — text the model authored; quotable. */
  writeInputs: string[] = [];
  /** Bash commands executed this turn — proof a check RAN (not an observation). */
  commands: string[] = [];
  webQueries: string[] = [];
  /** Browse delegate task texts this turn (web use, but not search queries). */
  browseTasks: string[] = [];
  /** WebFetch URLs this turn (for harness-filled sources rows). */
  webFetchUrls: string[] = [];
  webContent: string[] = [];
  usedTools = false;
  usedMutatingTool = false;
  /** Edit / Write / NotebookEdit ran (a real file change; Bash alone may have only read or fetched). */
  usedFileEditTool = false;
  usedReadishTool = false;
  lastCitations: Array<{ reference: string; verbatim_source: string }> | undefined;
  endTurnCalled = false;
  effortTailBounced = false;
  /** Stage 4f: the requirement-coverage check fires at most once per turn. */
  reqCoverageNudged = false;
  /** Stage 6: the scope check holds at most once per turn (CORTEX_SCOPE_CHECK). */
  scopeHeld = false;

  /** Call once per executed batch with the tool_use blocks (before or after execution). */
  noteToolUses(toolUses: GateToolUse[]): void {
    for (const tu of toolUses) {
      if (tu.name === 'EndTurn') continue;
      this.usedTools = true;
      if (MUTATING_TOOLS.includes(tu.name)) this.usedMutatingTool = true;
      if (tu.name === 'Edit' || tu.name === 'Write' || tu.name === 'NotebookEdit') this.usedFileEditTool = true;
      if (READISH_TOOLS.includes(tu.name)) this.usedReadishTool = true;
      const input: any = tu.input ?? {};
      if (tu.name === 'WebSearch') {
        if (typeof input.query === 'string' && input.query) this.webQueries.push(input.query);
      } else if (tu.name === 'WebFetch') {
        if (typeof input.url === 'string' && input.url) this.webFetchUrls.push(input.url);
      } else if (tu.name === 'Browse') {
        // A Browse task is an instruction to our own browse agent, not a web search: it restates the user's request by design, so the
        // solution-query check (B) skips it; it still counts as web use for the sources attestation (C). 2026-11-03 (fuzzycortex Porsche).
        if (typeof input.task === 'string' && input.task) this.browseTasks.push(input.task);
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
      // 2026-11-12 (macbook D7 T5): an ERROR result is still something the agent read — a refusal or a failing test it quotes verbatim
      // was rejected as a fabrication, so the agent re-ran the action just to re-ground the quote. CORTEX_ENDTURN_CITE_ERRORS=true lets
      // error results ground citations (EndTurn's own rejections stay out). Unset = byte-identical (errors excluded).
      if (tr.tool_name === 'EndTurn') continue;
      if (tr.is_error && !/^(1|true|on|yes)$/i.test(String(process.env.CORTEX_ENDTURN_CITE_ERRORS ?? '').trim())) continue;
      const txt = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content);
      if (!txt) continue;
      this.outputs.push(txt);
      // MCP / browser results are content-block arrays, usually carrying JSON text: the stringified form escapes every newline and
      // quote, so an honest multi-line quote of page text could never match (2026-11-03: 8 Stage-2 rejections across the cars.com +
      // CarMax Browse delegates, one of which then timed out). Also index the decoded text.
      for (const extra of decodedObservationTexts(tr.content)) if (extra !== txt) this.outputs.push(extra);
      if (tr.tool_name === 'WebSearch' || tr.tool_name === 'WebFetch' || tr.tool_name === 'Browse') this.webContent.push(txt);
    }
  }

  /** What a citation may be grounded in: observations + text the model wrote this turn. */
  citationCorpus(): string { return [...this.outputs, ...this.writeInputs].join('\n'); }
  /** What a strict `verified_how` may be grounded in: the above + the commands actually run. */
  verificationCorpus(): string { return [...this.outputs, ...this.writeInputs, ...this.commands].join('\n'); }
}

/** Plain-text views of a tool result for citation grounding: text blocks of a content array (nested tool_result content too) and,
 *  for any text that is JSON, its string leaves joined by newlines. Image/binary blocks contribute nothing. */
export function decodedObservationTexts(content: unknown): string[] {
  const texts: string[] = [];
  const visit = (c: unknown): void => {
    if (typeof c === 'string') { texts.push(c); return; }
    if (Array.isArray(c)) { for (const b of c) visit(b); return; }
    if (c && typeof c === 'object') {
      const b = c as { type?: string; text?: unknown; content?: unknown };
      if (typeof b.text === 'string') texts.push(b.text);
      else if (b.content !== undefined && b.type !== 'image') visit(b.content);
    }
  };
  visit(content);
  const out: string[] = [];
  for (const t of texts) {
    out.push(t);
    const trimmed = t.trim();
    if (trimmed.length > 1 && (trimmed[0] === '{' || trimmed[0] === '[')) {
      try {
        const leaves: string[] = [];
        const walk = (v: unknown): void => {
          if (typeof v === 'string') leaves.push(v);
          else if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === 'object') Object.values(v).forEach(walk);
        };
        const parsed = JSON.parse(trimmed);
        walk(parsed);
        if (leaves.length) out.push(leaves.join('\n'));
        // The browser MCP appends a `_quota` meter to every result; models drop it when quoting the JSON (2026-11-03, DeepSeek on
        // CarMax: 2 of 3 rejected quotes were the result minus `_quota`, character-exact otherwise). Also index the result without it.
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && '_quota' in parsed) {
          const { _quota: _drop, ...rest } = parsed as Record<string, unknown>;
          void _drop;
          out.push(JSON.stringify(rest));
        }
      } catch { /* not JSON */ }
    }
  }
  return out;
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

/** EndTurn's array fields arrive as JSON STRINGS from some models/transports (2026-11-02 fuzzycortex/Sonnet: every field stringified
 *  on 2 of 5 calls, and `sources` — then missing from the schema — on all of them), so an honest attestation failed Array.isArray in
 *  Stages 4/5 forever. Parse a string that holds a JSON array back into the array; anything else passes through untouched. */
const ENDTURN_ARRAY_FIELDS = ['citations', 'verification', 'requirements', 'sources', 'open_items'];
export function normalizeEndTurnInput(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  // Read from the ORIGINAL object and copy only when a field needs parsing (a copy would hide getters / non-enumerable fields).
  let input = raw as Record<string, unknown>;
  for (const k of ENDTURN_ARRAY_FIELDS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t.startsWith('[')) continue;
    let parsed: unknown; try { parsed = JSON.parse(t); } catch { continue; }
    if (!Array.isArray(parsed)) continue;
    if (input === raw) input = { ...(raw as Record<string, unknown>) };
    input[k] = parsed;
  }
  return input;
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
      const input: any = normalizeEndTurnInput(etUse?.input);
      const cits = input.citations;
      ev.lastCitations = Array.isArray(cits) ? cits : undefined; // Stage 3 baseline
      // 4.100.0 grounding corpus (cell-d-k3 distill 2026-09-10, 84 rejected citations audited): observations +
      // text authored via Write/Edit (as before) + text authored inside Bash commands (heredocs, `python -c`
      // — authored is authored) + the task statement itself (quoting the ask is not a fabrication). Line-wise
      // matching for multi-line quotes unless CORTEX_ENDTURN_CITATION_LINEWISE=false.
      const corpus = [ev.citationCorpus(), ...ev.commands, deps.userTaskText ?? ''].join('\n');
      const linewise = String(env.CORTEX_ENDTURN_CITATION_LINEWISE ?? 'true').toLowerCase() !== 'false';
      const verdict = verifyCitationsGrounded(cits, corpus, { linewise });
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
          turnEditedFiles: ev.usedFileEditTool,
          openItems: input.open_items,
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
      if (accepted && resolveEndTurnReqCoverage(env)) { // Stage 4f (CORTEX_ENDTURN_REQ_COVERAGE, dark)
        const cov = coverageCheck({ taskText: deps.userTaskText, requirements: input.requirements, alreadyNudged: ev.reqCoverageNudged });
        deps.recordEvent('req_coverage', { clauses: cov.clauses.length, uncovered: cov.uncovered.length, nudged: !cov.ok, alreadyNudged: ev.reqCoverageNudged, rows: Array.isArray(input.requirements) ? input.requirements.length : 0 });
        if (!cov.ok) {
          accepted = false;
          ev.reqCoverageNudged = true;
          tr.is_error = true;
          tr.content = cov.nudge!;
          log(`[Orchestrator] Stage4f: EndTurn rejected — ${cov.uncovered.length}/${cov.clauses.length} stated requirement(s) uncovered.`);
        }
      }
      if (accepted && resolveEndTurnIntegrityMode(env)) {
        const s5 = verifyIntegrity({
          webQueries: ev.webQueries,
          browseTasks: ev.browseTasks,
          webContent: ev.webContent,
          writeInputs: ev.writeInputs,
          userTaskText: deps.userTaskText,
          sourcesAttestation: sourcesOrAuto(input.sources, ev),
        });
        if (sourcesAutoFilled(input.sources, ev)) deps.recordEvent('integrity_flag', { check: 'sources_auto', detail: `harness filled ${autoSources(ev).length} sources row(s) from this turn's web calls` });
        for (const f of s5.flags) deps.recordEvent('integrity_flag', { check: f.check, detail: f.detail });
        if (!s5.ok) {
          accepted = false;
          tr.is_error = true;
          tr.content = s5.nudge!;
          log(`[Orchestrator] Stage5: EndTurn rejected — ${s5.flags.length} integrity flag(s).`);
        }
      }
      if (accepted && scopeCheckEnabled(env)) { // Stage 6 (CORTEX_SCOPE_CHECK, default on): place-scoped task, unscoped results → hold once
        const sc = scopeCheck({ taskText: deps.userTaskText, latestOutputs: ev.outputs.slice(-8), alreadyHeld: ev.scopeHeld });
        if (sc.scope && (sc.scope.places.length || sc.scope.radius)) {
          deps.recordEvent('scope_check', { places: sc.scope.places.slice(0, 3), radius: sc.scope.radius ?? null, held: !sc.ok, finding: sc.finding?.kind ?? null, text: sc.finding?.text?.slice(0, 160) ?? null });
        }
        if (!sc.ok) {
          accepted = false;
          ev.scopeHeld = true;
          tr.is_error = true;
          tr.content = sc.nudge!;
          log(`[Orchestrator] Stage6: EndTurn held — scope check (${sc.finding?.kind}).`);
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
