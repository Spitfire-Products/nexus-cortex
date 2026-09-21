/**
 * R176 HB-INDEPENDENT-DERIVATION — pure policy + parsers (design: docs/R176_INDEPENDENT_DERIVATION_DESIGN.md).
 *
 * The largest never-passed class on TB4.0 (~14 tasks) is a computed value or exact artifact checked against a golden answer with
 * NO ground truth in the container: the agent's own test passes, the judge sees a consistent story, holds return the same wrong
 * value (cell g1: foodstuff-beta-activity held 6×). The only lever left is to make the agent produce its own disagreement: before
 * such a finish stands, the harness elicits a SECOND derivation by a DIFFERENT method, runs it, and treats disagreement as evidence
 * for one hold. Everything here is pure so the policy is unit-testable; the orchestrator does the model call + the runCheck.
 */

/** The persona of the second-method author. Sees the task, the agent's deliverable and its stated method — and must pick a
 *  DIFFERENT method. */
export const DERIVATION_SYSTEM =
  'You are an independent checker in a real terminal container. A junior agent has produced a computed result for a TASK. Your job ' +
  'is NOT to review its reasoning: it is to RECOMPUTE the result by a genuinely different route and print the value(s). First state the ' +
  'agent\'s method in one line (METHOD_AGENT:). Then name a different method (METHOD_INDEPENDENT:) — a different algorithm, a different ' +
  'library or tool, a first-principles/analytic route, a brute-force or sampling route, or a bounds/consistency check — never a re-run of ' +
  'the same code. Then write shell command(s) that execute the independent method in this container and print ONLY the value(s), one ' +
  'per line prefixed `VALUE <name>=`. Rules: read-only on the workspace (write scratch under /tmp only); use the task\'s own input files; ' +
  'keep each command under 60 seconds; no installs. Prefer one-liners (python3 -c, awk, sort); if you need a script, write it under /tmp ' +
  'with a heredoc (`cat > /tmp/d.py <<\'EOF\' … EOF; python3 /tmp/d.py`) — writes anywhere else are refused. Output exactly: METHOD_AGENT: … / ' +
  'METHOD_INDEPENDENT: … / one or more `CHECK: <cmd>` lines.';

export function buildDerivationPrompt(input: { task: string; deliverable: string; agentSummary: string; envReport?: string; values: string[] }): string {
  const parts = [`TASK:\n${(input.task || '').trim().slice(0, 6000)}`];
  parts.push(`THE AGENT'S DELIVERABLE (the file(s) the task names, read by the harness just now):\n${(input.deliverable || '').trim().slice(0, 3000)}`);
  parts.push(`THE AGENT'S OWN SUMMARY OF WHAT IT DID:\n${(input.agentSummary || '').trim().slice(0, 2500)}`);
  if (input.envReport?.trim()) parts.push(`ENVIRONMENT REPORT:\n${input.envReport.trim().slice(0, 2000)}`);
  parts.push(`VALUES TO RECOMPUTE (names as the task uses them): ${input.values.join(', ') || 'the primary result the task asks for'}.`);
  return parts.join('\n\n');
}

export interface DerivationPlan { methodAgent: string; methodIndependent: string; checks: string[] }
/** Parse the author's reply. Pure. A CHECK may span several lines (the persona asks for heredocs under /tmp): its command is the
 *  rest of its line plus every following line up to the next CHECK:/METHOD_* marker, with ``` fences stripped. R176b (cell r176, 2026-09-21):
 *  the line-based v1 kept only `python3 -c "` of a heredoc, the check failed with a shell syntax error, and the printed-numbers fallback
 *  read the "1" in `/bin/sh: 1: Syntax error` as the derived value. */
export function parseDerivationReply(text: string, maxChecks = 3): DerivationPlan {
  let methodAgent = ''; let methodIndependent = ''; const checks: string[] = [];
  const lines = (text || '').split('\n');
  let cur: string[] | null = null;
  const flush = () => {
    if (!cur) return;
    const cmd = cur.join('\n').replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?\s*```\s*$/, '').replace(/^`+|`+$/g, '').trim();
    if (cmd && cmd.length <= 2000 && !checks.includes(cmd) && checks.length < maxChecks) checks.push(cmd);
    cur = null;
  };
  for (const line of lines) {
    const ma = line.match(/^\s*METHOD_AGENT:\s*(.+?)\s*$/i); if (ma) { flush(); methodAgent = ma[1]!.slice(0, 300); continue; }
    const mi = line.match(/^\s*METHOD_INDEPENDENT:\s*(.+?)\s*$/i); if (mi) { flush(); methodIndependent = mi[1]!.slice(0, 300); continue; }
    const c = line.match(/^\s*(?:[-*]|\d+[.)])?\s*CHECK:\s*(.*?)\s*$/i);
    if (c) { flush(); cur = [c[1]!]; continue; }
    if (cur) cur.push(line);
  }
  flush();
  // R176d (cell r176c): some replies name the methods and put the recomputation in fenced code blocks with no CHECK: prefix — treat each
  // fenced block as a check when no CHECK line was found (a heredoc-wrapped script or a shell one-liner both run through the same runner).
  if (!checks.length) {
    for (const m of (text || '').matchAll(/```[a-z]*\s*\n([\s\S]*?)```/gi)) {
      const body = m[1]!.trim();
      if (!body || body.length > 2000 || checks.length >= maxChecks) continue;
      const cmd = /^(python3?|awk|sort|grep|cat|jq|sqlite3|bash|sh)\b/.test(body) || body.includes('<<') ? body : `python3 - <<'EOF'\n${body}\nEOF`;
      if (!checks.includes(cmd)) checks.push(cmd);
    }
  }
  return { methodAgent, methodIndependent, checks };
}

/** The harness header is `CHECK RUN: \`<cmd>\` → <verdict> in <ms> ms\n<body>` — and <cmd> may span lines (heredocs), so the verdict is
 *  found by its marker, not on line 1 (R176c: with the line-1 rule every multi-line check read as failed in cell r176b). Pure. */
const VERDICT_RE = /` → (PASSED in \d+ ms|FAILED \(exit -?\d+\) in \d+ ms|TIMED OUT[^\n]*)\n?/;
export function checkRunPassed(output: string): boolean {
  const m = String(output || '').match(VERDICT_RE);
  return !!m && m[1]!.startsWith('PASSED');
}

/** The body of a runCheck output (everything after the verdict line). Pure. */
export function checkRunBody(output: string): string {
  const s = String(output || ''); const m = s.match(VERDICT_RE);
  return m ? s.slice((m.index ?? 0) + m[0].length) : s.split('\n').slice(1).join('\n');
}

/** Is the independent method actually different from the agent's? A cheap token-overlap test the orchestrator banks (the field read
 *  grades a sample by hand). Pure. */
export function methodsDiffer(methodAgent: string, methodIndependent: string): boolean {
  const tok = (s: string) => new Set((s || '').toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? []);
  const A = tok(methodAgent), B = tok(methodIndependent);
  if (!A.size || !B.size) return B.size > 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.min(A.size, B.size) < 0.6;
}

/** `VALUE <name>=<text>` lines from a check's output → {name: raw}. Pure. */
export function parseValueLines(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (output || '').split('\n')) {
    const m = line.match(/^\s*VALUE\s+([A-Za-z0-9_.\-/]+)\s*=\s*(.+?)\s*$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

/** Extract candidate numbers from a deliverable text (JSON, CSV, key=value, prose). Pure. */
export function extractNumbers(text: string, max = 64): number[] {
  const out: number[] = [];
  for (const m of (text || '').matchAll(/(?<![A-Za-z0-9_])[-+]?(?:\d+\.\d+|\d+)(?:[eE][-+]?\d+)?(?![A-Za-z0-9_])/g)) {
    const v = Number(m[0]); if (Number.isFinite(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

export type Agreement = 'agree' | 'disagree' | 'inconclusive';
export interface Reconciliation { agreement: Agreement; compared: Array<{ name: string; derived: string; matched: string | null; rel: number | null }>; }

/** Compare each derived value with the agent's deliverable: a numeric derived value agrees when SOME number in the deliverable is
 *  within `tol` (relative; absolute for values near 0); a string value agrees when it appears verbatim (case-insensitive, trimmed).
 *  No derived values → inconclusive. Pure. */
export function reconcile(deliverable: string, derived: Record<string, string>, tol = 1e-3): Reconciliation {
  const names = Object.keys(derived);
  if (!names.length) return { agreement: 'inconclusive', compared: [] };
  const nums = extractNumbers(deliverable);
  const lower = (deliverable || '').toLowerCase();
  const compared: Reconciliation['compared'] = [];
  let disagree = 0; let agree = 0;
  for (const name of names) {
    const raw = derived[name]!.trim();
    const v = Number(raw.replace(/,/g, ''));
    if (raw !== '' && Number.isFinite(v)) {
      let best: { n: number; rel: number } | null = null;
      for (const n of nums) {
        const rel = Math.abs(n - v) / Math.max(Math.abs(v), Math.abs(n), 1e-9);
        const abs = Math.abs(n - v);
        const score = Math.abs(v) < 1e-6 ? abs : rel;
        if (best === null || score < best.rel) best = { n, rel: score };
      }
      const ok = best !== null && best.rel <= tol;
      compared.push({ name, derived: raw, matched: ok ? String(best!.n) : null, rel: best ? Number(best.rel.toFixed(6)) : null }); // matched only within tolerance; rel = nearest candidate's distance
      if (ok) agree += 1; else disagree += 1;
    } else {
      const ok = raw.length > 0 && lower.includes(raw.toLowerCase());
      compared.push({ name, derived: raw, matched: ok ? raw : null, rel: null });
      if (ok) agree += 1; else disagree += 1;
    }
  }
  // Numeric values decide when any exist (a descriptive string such as a key list must not override matching numbers);
  // string values decide only when the derivation printed no numbers.
  const numeric = compared.filter((c) => c.rel !== null);
  const pool = numeric.length ? numeric : compared;
  const nDis = pool.filter((c) => c.matched === null).length; const nAgr = pool.length - nDis;
  return { agreement: nDis > 0 ? 'disagree' : nAgr > 0 ? 'agree' : 'inconclusive', compared };
}

/** The hold text the junior sees on disagreement. Pure. */
export function buildDerivationHoldMessage(input: { methodIndependent: string; compared: Reconciliation['compared']; remainingFrac: number | null }): string {
  const rows = input.compared.filter((c) => c.matched === null)
    .map((c) => `- ${c.name}: your deliverable contains no value matching it; an independent recomputation gives ${c.derived}`);
  const pct = input.remainingFrac === null ? '' : ` You have ${Math.round(input.remainingFrac * 100)}% of the wall budget left.`;
  return (
    `EndTurn HELD (independent check) — a recomputation of your result by a DIFFERENT method (${input.methodIndependent.slice(0, 200)}) does not ` +
    `agree with what you delivered:\n${rows.join('\n')}\n\nOne of the two is wrong. Re-derive the disputed value(s) from the task's inputs, ` +
    `find which method is right and why, fix the deliverable if needed, then call EndTurn again (it will stand).${pct}`
  );
}

/** Is the task value-shaped (its correctness reduces to computed values / exact outputs)? Heuristic v1.1 (a typed Jev noul can replace
 *  it): the text names an OUTPUT artifact (a path or file name that follows write/save/create/produce/output… language within the
 *  preceding ~160 chars) AND uses computation/answer language. Pure. Measured 2026-09-21 on the 64 TB4.0 task texts
 *  (`.bench/tb4-value-shaped-2026-09-21.json`): v1 matched INPUT paths (`/app/data/x.csv`) as artifacts and missed `save it as
 *  /app/score.musicxml` / `named X.csv and save it inside /results/` / `Create:\n- /app/rules.json`. */
const VALUE_WORDS = /\b(compute|calculat\w*|determine|estimate|derive|predict\w*|transcrib\w*|recover(?:ed)? (?:the|all|every)|recovered|reconstruct\w*|report (the|a|an|each) (value|number|result|answer)|numeric\w*|tolerance|within \d|exact(ly)? match|the answer|final answer|answers?|the value of|total|ratio|percent\w*|probability|coefficient|energy|activity|distance|frequency|pitch\w*|decrypt\w*|cipher|flag|golden)\b/i;
const OUTPUT_VERB = /\b(report(s|ed|ing)?|record(s|ed)?|print(s|ed)?|writ(e|es|ten|ing)|sav(e|es|ed|ing)|creat(e|es|ed|ing)|produc(e|es|ed|ing)|output(s|ting)?|generat(e|es|ed|ing)|emit(s|ted)?|export(s|ed)?|stor(e|es|ed)|put|plac(e|es|ed)|deliver\w*|provide\w*|submit\w*)\b/i;
const DATA_EXT = 'json|jsonl|csv|tsv|txt|yaml|yml|md|out|dat|xlsx|xml|musicxml|npz|npy|mol|pdb|fasta|fa|wav|mp3|png|svg';
const ARTIFACT_RE = new RegExp(`(?:^|[\\s\`'"(])((?:\\/[A-Za-z0-9_.-]+)*\\/(?:[A-Za-z0-9_.-]+\\.(?:${DATA_EXT}))?)(?=[\\s\`'"),.;:]|$)`, 'g'); // a DATA file (code files are not values) or a directory
export function isValueShapedTask(task: string): { valueShaped: boolean; artifacts: string[]; reason: string } {
  const text = task || '';
  const artifacts: string[] = [];
  for (const m of text.matchAll(ARTIFACT_RE)) {
    const path = m[1]!; const at = m.index! + m[0].indexOf(path);
    const isDir = path.endsWith('/');
    if (path === '/' || (isDir && !/\b(inside|into|in|under|to|at)[\s`'"(]*$/i.test(text.slice(Math.max(0, at - 14), at)))) continue; // a bare dir counts only as "save it inside /results/"
    const before = text.slice(Math.max(0, at - 160), at);
    if (!OUTPUT_VERB.test(before)) continue;                       // an INPUT path ("the data in /app/data/x.csv") is not a deliverable
    if (/\b(read|from|given|provided|input|using|use|described|documented|per|according to|reference|are in|is in|lives? in|located|available|found|match(es)?|identical to|compare\w*)\b[\s\S]{0,40}$/i.test(before)) continue;
    if (!artifacts.includes(path)) artifacts.push(path);
    if (artifacts.length >= 6) break;
  }
  const words = text.match(VALUE_WORDS);
  const valueShaped = artifacts.length > 0 && !!words;
  return { valueShaped, artifacts, reason: valueShaped ? `artifact ${artifacts[0]} + "${words![0]}"` : (artifacts.length ? 'no value language' : 'no output artifact named') };
}

/** R176: the derivation runner allows writes ONLY under /tmp (scratch scripts/outputs); everything else follows the R170 read-only
 *  denylist. Pure: strips `> /tmp/…` / `>> /tmp/…` / `tee /tmp/…` targets before delegating. */
export function isDerivationCommandAllowed(cmd: string, base: (c: string) => boolean): boolean {
  const scrubbed = String(cmd ?? '')
    .replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\b/g, ' heredoc ') // a heredoc BODY is data (python `a > b`), not a shell redirect
    .replace(/\s>{1,2}\s*\/tmp\/[^\s;&|)]+/g, ' ')
    .replace(/\btee\s+(-a\s+)?\/tmp\/[^\s;&|)]+/g, ' tee_tmp ')
    .replace(/([A-Za-z0-9_)\]])\s*>=?\s*(\d)/g, '$1 GT $2'); // awk/python comparisons (NR>1, x>=0) are not redirects
  if (/(^|[^<>&|])>(?!&|>&)\s*(?!\/tmp\/)[^&\s]/.test(scrubbed)) return false; // any other redirect target
  return base(scrubbed);
}

