/**
 * toolOutcome — the SINGLE failure semantics every guard consumes.
 * (docs/UNIFIED_OUTCOME_LADDER.md; TB2 root cause: ShellTool returns a
 * success result for exit!=0 commands, so consecutive-error breaking,
 * decision-store priors, and the family lens all recorded thrash as wins.)
 *
 * status:
 *   ok     — the tool ran and succeeded (exitCode 0, or no exit semantics
 *            and not an error result)
 *   failed — the tool RAN but did not succeed (nonzero exitCode in result
 *            metadata, or a recognized failure signature in content)
 *   error  — transport/abort/exception results (wire is_error; untouched
 *            semantics — we never rewrite what the model sees)
 */
import { createHash } from 'crypto';
import { classifyErrorFamily } from './errorFamily.js';
import { stableInputHash } from './DecisionStore.js';

export interface ToolOutcome {
  status: 'ok' | 'failed' | 'error';
  /** Normalized failure fingerprint (present when status !== 'ok'). */
  family?: string;
  /** Normalized "same approach" hash — near-duplicate retries collide. */
  approachHash: string;
  /** Byte-sensitive input hash (the existing exact-prior key). */
  exactHash: string;
  /** HB-LOOP-NEARDUP (2026-09-10): for EXECUTING tools (Bash/Write/Edit/…), the normalized command/content
   *  text the similarity near-dup lens compares (the approachHash is too fine: `python3 -c "…"` retries
   *  with an edited script never collide, the 12-in-30 rung was unreachable on every real loop replayed). */
  approachText?: string;
}

export const EXEC_TOOLS = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
/** Slice-reads (sed -n / head / tail paging) are inspection, handled by CORTEX_SLICE_BLOCK — excluded from the loop lens. */
export const SLICE_READ_RE = /\b(sed\s+-n|head\s+-[nc]|tail\s+-[nc])\b/;

/** The text the similarity lens compares for an executing tool; '' for non-executing tools / slice-reads. */
export function approachText(toolName: string, input: unknown): string {
  if (!EXEC_TOOLS.has(toolName) || !input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;
  let raw = '';
  if (toolName === 'Bash') {
    raw = String(i.command ?? '');
    if (SLICE_READ_RE.test(raw)) return '';
  } else if (toolName === 'Write') raw = `${i.file_path ?? ''}\n${i.content ?? ''}`;
  else if (toolName === 'Edit') raw = `${i.file_path ?? ''}\n${i.old_string ?? ''}\n${i.new_string ?? ''}`;
  else raw = JSON.stringify(i);
  return raw.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 400);
}

/** Bigram Dice similarity in [0,1] (the distiller's ≥0.9 "near-identical call" criterion, dependency-free). */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => { const g = new Map<string, number>(); for (let k = 0; k < s.length - 1; k++) { const x = s.slice(k, k + 2); g.set(x, (g.get(x) ?? 0) + 1); } return g; };
  const ga = grams(a), gb = grams(b);
  let inter = 0;
  for (const [k, v] of ga) inter += Math.min(v, gb.get(k) ?? 0);
  return (2 * inter) / ((a.length - 1) + (b.length - 1));
}

interface ToolResultLike {
  content: string;
  is_error?: boolean;
  metadata?: { exitCode?: number | null } & Record<string, unknown>;
}

/** Content signatures that mean "the command ran and failed" even when the
 *  result carries no exit metadata (older executors, remote shells). These are
 *  ShellTool-EMITTED markers — they appear ONLY when the tool detected a real
 *  failure, so they are trusted regardless of the overall exit code (a
 *  `fail | tail` pipe or `fail; echo` trailer can reset the script exit to 0
 *  while the inner command genuinely failed). Zero false-positive: our own
 *  tool's output, never arbitrary user text. */
const FAILURE_SIGNATURES = [
  /Command failed with exit code \d+/,
  /Command timed out after/i,
];

/** SHELL-emitted signatures of an unrecoverable inner failure that a masking
 *  construct (for-loop capturing `ec=$?`, `|| true`, `cmd | tail` WITHOUT
 *  pipefail) hid from the overall exit code (which reads 0). Deliberately
 *  NARROW — only forms a genuine success would essentially never print — to
 *  avoid the over-classification the guards are sensitive to
 *  (docs/UNIFIED_OUTCOME_LADDER.md). Extend only with equally-unambiguous
 *  shell-emitted forms. */
const MASKED_FAILURE_SIGNATURES = [
  // bash/sh exit-127: "<cmd>: command not found" (the colon-prefixed shell
  // form). A legit `|| echo "not found"` fallback lacks the colon-prefixed
  // shell message, so it does NOT misfire.
  /^[^\n]*: command not found\b/m,
  // Hard crashes the shell surfaces on a line of their own.
  /^[^\n]*: Segmentation fault\b/m,
];

/** PROBE commands whose exit code 1 means INFORMATION ("no match" / "differs" /
 *  "condition false" / "absent"), NOT a failure. exit>=2 IS a real error (bad
 *  regex, unreadable file) and stays 'failed'. Verified against 11k banked Bash
 *  calls (2026-09-07 census): models write `&&`-coupled bash 52% of the time vs
 *  `if/then/fi` 1.2%, and bare probes exit-1 in ~0.3% of calls; classifying that
 *  as 'failed' pollutes the failure semantics every guard consumes. NARROW by
 *  design (same discipline as MASKED_FAILURE_SIGNATURES): ONLY a BARE probe with
 *  NO `&&`/`||` chain — a gated chain's exit could carry a real downstream
 *  failure, so those stay 'failed'. */
const PROBE_COMMANDS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'test', '[', '[[', 'diff', 'cmp']);
function isBareProbeInfoExit(toolName: string, input: unknown, exit: number): boolean {
  if (toolName !== 'Bash' && toolName !== 'Shell') return false;
  if (exit !== 1) return false; // exit>=2 = real probe error; keep 'failed'
  const cmd = String(
    (input && typeof input === 'object' ? ((input as any).command ?? (input as any).cmd) : input) ?? '',
  ).trim();
  if (!cmd) return false;
  if (/&&|\|\|/.test(cmd)) return false; // a gated chain — exit-1 may carry a real downstream failure
  // First token = the command. Set membership (not a regex prefix) so `grepfoo`
  // does not match and `[` (the test builtin, a non-word char) does.
  return PROBE_COMMANDS.has(cmd.split(/\s+/)[0] ?? '');
}

/** Normalize an input's text the way errorFamily normalizes error snippets:
 *  quoted strings, hex ids, paths, and digit runs collapse so "retry with a
 *  tweaked flag/version/path" lands on the same approach bucket. */
function normalizeApproachText(text: string): string {
  return text
    .toLowerCase()
    .replace(/(["'])(?:\\.|(?!\1).)*\1/g, '<q>')
    .replace(/\b0x[0-9a-f]+\b/g, '<hex>')
    .replace(/(?:^|[\s='"([{:,])((?:\/|(?:[a-z]:)?\\)[^\s'")\]},:]*)/g, ' <path>')
    // Version-pin skeletons and option flags are RETRY VARIATION, not a new
    // approach (probe-3 finding: `pkg`, `pkg==2.1`, `pkg --no-cache-dir` must
    // land in one bucket or the ladder never counts past 1).
    .replace(/[=<>!~]=[\w.*]+/g, '')
    .replace(/(?:^|\s)--?[\w-]+(=\S*)?/g, ' ')
    .replace(/\d+/g, '#')
    // A standalone number token is a flag argument or count, not an approach.
    .replace(/(?:^|\s)#+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export function approachHash(toolName: string, input: unknown): string {
  let text: string;
  if (input && typeof input === 'object') {
    // Sort keys so property order can't split a bucket; normalize each value.
    const entries = Object.entries(input as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${normalizeApproachText(typeof v === 'string' ? v : JSON.stringify(v))}`);
    text = entries.join('|');
  } else {
    text = normalizeApproachText(String(input));
  }
  return createHash('sha256').update(`${toolName}\n${text}`).digest('hex').slice(0, 16);
}

export function classifyToolOutcome(
  toolName: string,
  input: unknown,
  result: ToolResultLike,
): ToolOutcome {
  const exactHash = stableInputHash(input);
  const aHash = approachHash(toolName, input);
  const content = String(result.content ?? '');

  let status: ToolOutcome['status'];
  if (result.is_error) {
    status = 'error';
  } else {
    const exit = result.metadata?.exitCode;
    if (typeof exit === 'number' && exit !== 0) {
      if (isBareProbeInfoExit(toolName, input, exit)) {
        // Bare probe exit-1 (grep/test/[/diff/cmp with no match / false / differ,
        // no chain) = INFORMATION, not a failure — do not feed the failure guards.
        status = 'ok';
      } else {
        // Non-zero exit is the primary, unambiguous failure signal.
        status = 'failed';
      }
    } else if (FAILURE_SIGNATURES.some((re) => re.test(content))) {
      // ShellTool's own failure marker present — trust it even when the overall
      // exit is 0 (a pipe/wrapper reset it). Zero false-positive (our text).
      status = 'failed';
    } else if (MASKED_FAILURE_SIGNATURES.some((re) => re.test(content))) {
      // Exit 0 (or absent) but the shell reported an unrecoverable inner failure
      // a masking construct hid from the exit code. Narrow, shell-emitted forms.
      status = 'failed';
    } else {
      status = 'ok';
    }
  }

  return {
    status,
    ...(status !== 'ok'
      ? { family: classifyErrorFamily(stripLeadingReminders(content).slice(0, 200)) || 'unclassified' }
      : {}),
    approachHash: aHash,
    exactHash,
    ...(EXEC_TOOLS.has(toolName) ? { approachText: approachText(toolName, input) } : {}),
  };
}

/** Loop-level classification sees results ALREADY augmented with prepended
 *  <system-reminder> blocks (processToolTraining runs first) — strip them so
 *  the family fingerprint reflects the tool's own output, not our reminder. */
function stripLeadingReminders(content: string): string {
  let out = content;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = out.replace(/^\s*<system-reminder>[\s\S]*?<\/system-reminder>\s*/, '');
    if (next === out) return out;
    out = next;
  }
}
