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
      // Non-zero exit is the primary, unambiguous failure signal.
      status = 'failed';
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
