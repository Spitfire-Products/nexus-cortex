/**
 * R187 HB-REQUIREMENT-LEDGER (2026-09-23) — the consistency lever the top-7 read named.
 *
 * Field (tb4-consistency-top7-2026-09-23.md): five of the seven tasks flash passes ≥50% of the time fail on a requirement the TASK TEXT
 * STATES — a contract branch, a numeric threshold, an exactness rule, a latency bound, a do-not-change constraint — and the failing run
 * finishes EARLIER than the passing run with more budget left, the resolver accepting, because the writer's own checks test the path it
 * chose and the stated requirement was never exercised.
 *
 * The ledger: at lift the mentor extracts each stated requirement as a typed LINE with a read-only shell CHECK where one exists; the writer
 * sees the ledger with its plan; at every finish the harness runs the checks, marks each line exercised / failed / open / unverifiable;
 * a FAILED line is evidence for the normal veto (R166), and a finish that would otherwise stand while a line is still OPEN is held ONCE
 * with the open lines named. Sibling of the R174 blind spec checks (commands only, no lines, no hold on "unexercised").
 * Everything decision-shaped is pure here; the orchestrator does the wiring.
 */

import { TASK_TEXT_CAP } from './endTurnResolver.js';

export type ReqKind = 'threshold' | 'contract' | 'exactness' | 'constraint' | 'latency' | 'artifact' | 'command' | 'other';
export interface RequirementLine { id: string; kind: ReqKind; text: string; check: string | null }
export type ReqStatus = 'open' | 'exercised' | 'failed' | 'unverifiable';
export interface LedgerEntry extends RequirementLine { status: ReqStatus; runs: number; lastResult?: string }

const KINDS: ReqKind[] = ['threshold', 'contract', 'exactness', 'constraint', 'latency', 'artifact', 'command', 'other'];

export const REQ_LEDGER_SYSTEM =
  'You extract the REQUIREMENT LEDGER of a task in a real terminal container BEFORE any solution exists. You are given only the TASK text ' +
  'and an ENVIRONMENT REPORT. List every requirement the task STATES that a hidden grader could check: numeric thresholds, contract ' +
  'branches (what must or must not happen on a second call, a bad input, a duplicate), exactness rules, do-not-change constraints on ' +
  'named files or state, latency bounds, required artifacts (a file at a path in a format), commands that must work. One line per ' +
  'requirement, most discriminating first, quoting or closely paraphrasing THIS task. Every line must come from the TASK text: never ' +
  'invent a requirement, never copy the example (it is from an unrelated task). SKIP instructions about the agent\'s own conduct — time ' +
  'limits, "do not cheat", "no online solutions or hints", honesty rules — a grader cannot check them and they waste lines. For each ' +
  'requirement give a read-only shell CHECK that EXITS NON-ZERO with a printed reason when it is NOT met (prefer the task\'s own artifacts, ' +
  'paths, commands and numbers; a check may run a program twice, diff against a baseline, or time a command; never create, modify or delete ' +
  'anything; no installs; under 20 seconds), or the word NONE when no shell check can decide it. When the task or the environment names a ' +
  'checker, test or verification script, invoke it EXACTLY as the task text or the environment report shows it invoked; never guess ' +
  'arguments it does not document — a wrongly-invoked checker is a false failure that misleads the writer. Output ONLY lines of the form ' +
  '`REQ <n> | <kind> | <requirement> | CHECK: <command or NONE>` where <kind> is one of threshold, contract, exactness, constraint, latency, ' +
  'artifact, command, other. Nothing else.';

/** R191: lines about the agent's conduct (time budget, no cheating, no online hints, honesty) are instructions, not gradable requirements. Pure. */
export const REQ_BOILERPLATE_RE = /\b(within|in under|complete(?:d)?\s+(?:the\s+)?(?:task\s+)?within)\s+\d[\d,]*\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?)\b|\b(?:do not|don't|must not|never)\s+cheat\b|\bonline solutions?\b|\bhints? specific to (?:this|the) task\b|\bbe honest\b|\bhonest(?:ly)? report\b/i;
export function isBoilerplateRequirement(text: string): boolean { return REQ_BOILERPLATE_RE.test(String(text ?? '')); }

/** R191: a check whose failure is the CHECK's own defect (usage error, missing script/tool, syntax error in the one-liner), not the work's. Pure. */
const BROKEN_CHECK_RE = /^usage:|\busage: |unrecognized arguments|the following arguments are required|invalid choice:|error: argument |command not found|: not found\b|can't open file|No module named|\bSyntaxError\b|\bNameError\b|\bIndentationError\b|unexpected EOF while looking for matching|Syntax error: /im;
export function looksLikeBrokenCheck(result: string): boolean {
  const r = String(result ?? ''); const head = r.split('\n', 1)[0] ?? '';
  if (/→ PASSED/.test(head)) return false;
  return BROKEN_CHECK_RE.test(r.slice(head.length));
}

export function buildRequirementLedgerPrompt(task: string, envReport: string | undefined, max: number): string {
  const parts = [`TASK:\n${(task || '').trim().slice(0, TASK_TEXT_CAP)}`];
  if (envReport && envReport.trim()) parts.push(`ENVIRONMENT REPORT (at task start):\n${envReport.trim().slice(0, 2500)}`);
  parts.push(`Write at most ${max} REQ lines. Format example (from an UNRELATED task — never copy it):\nREQ 1 | contract | a second identical submission must not rewrite crm_leads.json | CHECK: cp /app/data/crm_leads.json /tmp/a.json && npm run -s submit >/dev/null 2>&1; cmp -s /app/data/crm_leads.json /tmp/a.json || { echo "ledger rewritten by a duplicate submit"; exit 1; }`);
  return parts.join('\n\n');
}

/** Parse `REQ <n> | <kind> | <text> | CHECK: <cmd|NONE>` lines; tolerant of bullets/backticks; dedup by text; cap. Pure. */
export function parseRequirementLedger(text: string, max = 8): RequirementLine[] {
  const out: RequirementLine[] = []; const seen = new Set<string>();
  for (const raw of (text || '').split('\n')) {
    const m = raw.match(/^\s*(?:[-*]|\d+[.)])?\s*REQ\s*[-#]?\s*(\w+)\s*\|\s*([a-zA-Z_-]+)\s*\|\s*(.+?)\s*\|\s*CHECK:\s*(.*?)\s*$/i);
    if (!m) continue;
    const kindRaw = m[2]!.toLowerCase(); const kind = (KINDS.includes(kindRaw as ReqKind) ? kindRaw : 'other') as ReqKind;
    const reqText = m[3]!.replace(/^`+|`+$/g, '').trim().slice(0, 240);
    let check: string | null = m[4]!.replace(/^`+|`+$/g, '').trim();
    if (!check || /^none\b/i.test(check)) check = null;
    if (check && check.length > 400) check = check.slice(0, 400);
    const key = reqText.toLowerCase();
    if (!reqText || seen.has(key)) continue;
    if (isBoilerplateRequirement(reqText)) continue; // R191
    seen.add(key);
    out.push({ id: `R${out.length + 1}`, kind, text: reqText, check });
    if (out.length >= max) break;
  }
  return out;
}

export function initLedger(lines: RequirementLine[]): LedgerEntry[] {
  return lines.map((l) => ({ ...l, status: l.check ? 'open' : 'unverifiable', runs: 0 }));
}

/** Apply one round of check results. passed → exercised; failed → failed; inconclusive (timeout, refused, no exit) leaves the status;
 *  broken (R191: the CHECK itself is defective — usage error, missing script, syntax error) → the line becomes UNVERIFIABLE with its check
 *  dropped, so it is never re-run, never counted as a failure, and falls to Jev like any other line without a shell check. Pure. */
export type CheckOutcome = 'passed' | 'failed' | 'inconclusive' | 'broken';
export function updateLedger(entries: LedgerEntry[], results: Array<{ id: string; result: string; cls: CheckOutcome }>): LedgerEntry[] {
  const by = new Map(results.map((r) => [r.id, r]));
  return entries.map((e) => {
    const r = by.get(e.id);
    if (!r || !e.check) return e;
    if (r.cls === 'broken') return { ...e, status: 'unverifiable' as ReqStatus, check: null, runs: e.runs + 1, lastResult: `harness check was malformed and has been dropped (${(r.result.split('\n')[1] ?? '').trim().slice(0, 160)})` };
    const status: ReqStatus = r.cls === 'passed' ? 'exercised' : r.cls === 'failed' ? 'failed' : e.status;
    return { ...e, status, runs: e.runs + 1, lastResult: r.result.slice(0, 1200) };
  });
}

export function ledgerCounts(entries: LedgerEntry[]): { lines: number; open: number; exercised: number; failed: number; unverifiable: number } {
  const c = { lines: entries.length, open: 0, exercised: 0, failed: 0, unverifiable: 0 };
  for (const e of entries) c[e.status] += 1;
  return c;
}

/** May an OPEN (never exercised) line hold a finish that would otherwise stand? Once per session by default, never below the budget floor. Pure. */
export function ledgerHoldable(input: { open: number; holdsUsed: number; maxHolds: number; remainingFrac: number | null; minRemaining: number }): boolean {
  if (input.open <= 0) return false;
  if (input.holdsUsed >= input.maxHolds) return false;
  if (input.minRemaining > 0 && input.remainingFrac !== null && input.remainingFrac < input.minRemaining) return false;
  return true;
}

/** The ledger as the writer sees it at lift (with the plan). Pure. */
export function formatLedgerForWriter(entries: LedgerEntry[]): string {
  if (!entries.length) return '';
  const lines = entries.map((e) => `${e.id} [${e.kind}] ${e.text}${e.check ? `\n    harness check: ${e.check}` : '\n    (no shell check — prove it in your EndTurn attestation with the command you ran and its output)'}`);
  return `REQUIREMENT LEDGER — every requirement the task STATES, extracted before your work. Each line must be EXERCISED (run the thing it names ` +
    `and see the result) before you finish; the harness runs the checks at your finish and holds a finish with a line still open.\n${lines.join('\n')}`;
}

/** The ledger block the judge sees among the harness-run checks. Pure. */
export function formatLedgerForJudge(entries: LedgerEntry[]): string {
  if (!entries.length) return '';
  return `REQUIREMENT LEDGER (stated requirements, extracted from the TASK before any work; harness-run checks just now):\n` +
    entries.map((e) => `${e.id} [${e.kind}] ${e.status.toUpperCase()} — ${e.text}${e.lastResult ? `\n    ${e.lastResult.split('\n').slice(0, 3).join(' / ').slice(0, 300)}` : ''}`).join('\n');
}

/** The hold message when a finish would stand with OPEN lines. Pure. */
export function formatLedgerHoldMessage(input: { entries: LedgerEntry[]; holdIndex: number; maxHolds: number; remainingFrac: number | null }): string {
  const open = input.entries.filter((e) => e.status === 'open'); const failed = input.entries.filter((e) => e.status === 'failed');
  const pct = input.remainingFrac === null ? '' : ` (${Math.round(input.remainingFrac * 100)}% of the budget remains)`;
  const body = open.map((e) => `- ${e.id} [${e.kind}] ${e.text}\n  exercise it now: ${e.check}${e.lastResult ? `\n  last harness run: ${e.lastResult.split('\n').slice(0, 2).join(' / ').slice(0, 240)}` : ''}`).join('\n');
  const failedBody = failed.length ? `\n\nAlready FAILED by a harness run (fix these too):\n${failed.map((e) => `- ${e.id} ${e.text}`).join('\n')}` : '';
  return `EndTurn HELD (requirement ledger, hold ${input.holdIndex}/${input.maxHolds})${pct} — the task states requirements you have not exercised yet. ` +
    `Run each one, read the result, fix what it shows, then call EndTurn again with the command and its output in your attestation.\n\n${body}${failedBody}`;
}

/* ---------- R187b: Jev as the per-line verifier (operator 2026-09-23: "use jev in additional one-shot calls to verify the end turn meets the
 *  requirements of the task"). E0 measured Jev as a whole-task doneness judge at AUC 0.64 (weak) but as a typed gate on concrete evidence at
 *  0.98 (repeat detection). The ledger turns doneness into typed per-line questions with concrete evidence: the requirement text, the writer's
 *  attestation for that requirement, and the harness's own check output. One Jev call per finish; it closes OPEN and UNVERIFIABLE lines the
 *  shell alone could not decide. Gate independence: Jev sees the writer's claim and the harness output, never the judge's verdict. ---------- */

export interface LedgerJevInput { task: string; entries: LedgerEntry[]; attestation: string; workProduct: string }

/** The state Jev reads: the task, the ledger lines to decide, the writer's attestation, and the harness outputs. Pure. */
export function buildLedgerJevState(input: LedgerJevInput): Record<string, unknown> {
  const pending = input.entries.filter((e) => e.status === 'open' || e.status === 'unverifiable');
  return {
    task_instruction: String(input.task ?? '').slice(0, TASK_TEXT_CAP),
    requirements_to_decide: pending.map((e) => ({ id: e.id, kind: e.kind, requirement: e.text, harness_check: e.check ?? 'none (no shell check possible)', harness_result: e.lastResult ? e.lastResult.slice(0, 600) : 'not run / inconclusive' })),
    writer_attestation: String(input.attestation ?? '').slice(0, 4000),
    work_product_tail: String(input.workProduct ?? '').slice(-3000),
  };
}

/** One noul per pending line: exercised AND met, on the evidence shown. Pure. */
export function buildLedgerJevQuestions(entries: LedgerEntry[]): Record<string, { type: 'noul'; instructions: string }> {
  const q: Record<string, { type: 'noul'; instructions: string }> = {};
  for (const e of entries) {
    if (e.status !== 'open' && e.status !== 'unverifiable') continue;
    q[`met_${e.id}`] = { type: 'noul', instructions: `Requirement ${e.id} (${e.kind}): "${e.text.slice(0, 200)}". Judging ONLY from the writer's attestation, the work product tail and the harness result shown, was this requirement actually EXERCISED (the writer ran the thing it names and observed the result) AND is it MET? Answer no if the attestation merely asserts it, names no command or output, or the evidence contradicts it.` };
  }
  return q;
}

/** Apply Jev's answers: a pending line at or above the threshold becomes exercised (provenance jev). Pure. */
export function applyLedgerJevAnswers(entries: LedgerEntry[], answers: Record<string, number> | null, threshold = 0.7): { entries: LedgerEntry[]; closed: string[]; asked: number } {
  if (!answers) return { entries, closed: [], asked: 0 };
  const closed: string[] = []; let asked = 0;
  const out = entries.map((e) => {
    if (e.status !== 'open' && e.status !== 'unverifiable') return e;
    const p = answers[`met_${e.id}`]; if (typeof p !== 'number') return e;
    asked += 1;
    if (p >= threshold) { closed.push(e.id); return { ...e, status: 'exercised' as ReqStatus, lastResult: `${e.lastResult ? e.lastResult + '\n' : ''}jev: met (${p.toFixed(2)}) on the attestation + harness evidence` }; }
    return { ...e, lastResult: `${e.lastResult ? e.lastResult + '\n' : ''}jev: not shown met (${p.toFixed(2)})` };
  });
  return { entries: out, closed, asked };
}
