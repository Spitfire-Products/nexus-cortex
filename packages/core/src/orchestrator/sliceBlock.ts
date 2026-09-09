/**
 * Slice-read block decision (CORTEX_SLICE_BLOCK — the coercive escalation of the slice-nudge).
 *
 * CORTEX_SLICE_NUDGE fires ONE <system-reminder> at the 3rd bash slice-read of a file, then goes
 * silent. Full-sample compliance mining (k5 @4.91.1, 66 fires) proves that reminder is IGNORED ~80%
 * of the time it is re-tested — 93% of ignored files are NEVER Read (the model declines the reminder,
 * it does not miss it), and the harm concentrates in a 39% tail of deep-grinders (up to 23 extra
 * slices of one file). A re-fire of the same channel is therefore not supported; a HARD, non-ignorable
 * block is. This is the exact "soft nudge ignored → coercive block" doctrine of loopToolBlock.ts.
 *
 * When the model calls Bash with a slice-read of a STATIC/SOURCE file it has already sliced
 * `at` times, the slice is NOT executed — the caller returns an append-only tool_result redirect
 * (tools array unchanged → cache-safe) steering it to Read. Bounded to `max` blocks per file (then
 * let through: no infinite loop, no expensive mentor consult — the block itself is the intervention).
 *
 * APPEND-LOG EXEMPTION (evidence-scoped): 16/28 ignored files were .log/.txt where re-`tail`-ing a
 * GROWING log is legitimate and Read-once is the wrong fix. Those are never blocked; only static/source
 * re-slicing is (shared_heap.c, tasks.py, doom.asm, text.gcode, …).
 *
 * PURE + deterministic — all state (per-file slice count, per-file block count) lives in the orchestrator.
 */

export type SliceBlockAction = 'block' | 'none';

export interface SliceBlockDecision {
  action: SliceBlockAction;
  /** The tool_result error text the model gets when the slice is blocked. */
  message: string;
}

/** Default: block once the model is ATTEMPTING the (at+1)th slice — leaves the soft nudge at 3 and the
 *  ~60% shallow-stoppers (1-2 extra slices) alone, coercing only the sustained grinders. Env-tunable. */
export const SLICE_BLOCK_AT_DEFAULT = 5;
/** Default: at most this many blocks per file, then let it through (bounded). Env-tunable. */
export const SLICE_BLOCK_MAX_DEFAULT = 2;

// The SAME slice-read shape applySliceNudge matches (sed -n 'N,Mp' / head -n N / tail -n N + a file).
// A followed log (`tail -f x`) has no number → intentionally does NOT match (it is not a re-slice).
const SLICE_RE = /(?:sed\s+-n\s+['"]?\d+\s*,\s*\d+\s*p['"]?|head\s+-n?\s*\d+|tail\s+-n?\s*\d+)\s+([^\s;|&>]+)/;

/** Extract the file a bash command slice-reads, or null if the command is not a slice-read. */
export function sliceReadFile(cmd: string): string | null {
  const m = SLICE_RE.exec(cmd);
  return m ? m[1]! : null;
}

/** Append-mostly log/output files — re-tailing these is legitimate, never block them. */
export function isAppendLog(file: string): boolean {
  const base = file.split('/').pop() ?? file;
  return /\.log$|log|output|progress|download|\.out$/i.test(base);
}

/**
 * Is the captured token an actual FILE PATH (has a `/` or a `.`), vs a command keyword the shared
 * slice-regex over-captured from a pipeline (`| tail -1\npython3`, `| head -40\necho`)? A block must
 * NEVER fire on `echo`/`python3`/etc. Under-blocking a bare-name file (Makefile) is SAFE (the soft
 * nudge still applies); over-blocking a real command is not. So the block is gated to path-like tokens.
 */
export function isPathLike(file: string): boolean {
  return /[/.]/.test(file);
}

/**
 * Decide whether to coercively block a slice-read of `file`, given how many times it has already been
 * sliced (`priorSlices`) and blocked (`priorBlocks`) this task. Caller has already gated on
 * CORTEX_SLICE_BLOCK and confirmed this is a slice-read (via sliceReadFile).
 */
export function decideSliceBlock(
  file: string,
  priorSlices: number,
  priorBlocks: number,
  at: number = SLICE_BLOCK_AT_DEFAULT,
  max: number = SLICE_BLOCK_MAX_DEFAULT,
): SliceBlockDecision {
  if (!isPathLike(file)) return { action: 'none', message: '' };   // command keyword over-captured from a pipeline — never block
  if (isAppendLog(file)) return { action: 'none', message: '' };   // legit re-tail — never block
  if (priorSlices < at) return { action: 'none', message: '' };     // soft nudge (n=3) owns earlier slices
  if (priorBlocks >= max) return { action: 'none', message: '' };   // bounded — never infinite-loop
  const message =
    `You have read ${file} in ${priorSlices} bash slices (sed/head/tail) — it is a static file, and ` +
    `re-slicing it loses context and burns turns. Slice-read of ${file} is DISABLED this turn: Read it ` +
    `ONCE with the Read tool (use offset/limit for long files) instead of another slice. ` +
    `${file} can be sliced again next turn.`;
  return { action: 'block', message };
}
