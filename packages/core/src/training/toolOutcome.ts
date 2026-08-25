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
 *  result carries no exit metadata (older executors, remote shells). */
const FAILURE_SIGNATURES = [
  /Command failed with exit code \d+/,
  /Command timed out after/i,
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
    if (typeof exit === 'number' && exit !== 0) status = 'failed';
    else if (typeof exit === 'number') status = 'ok';
    else if (FAILURE_SIGNATURES.some((re) => re.test(content))) status = 'failed';
    else status = 'ok';
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
