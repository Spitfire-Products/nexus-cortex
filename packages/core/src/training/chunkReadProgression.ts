/**
 * chunkReadProgression — HB-CHUNKED-READS (R128, 2026-09-13).
 *
 * The anti-loop stack (approachHash strips digits → `sed -n '1,200p'` ≡ `sed -n '201,400p'`; the
 * near-dup hash lens; the poll guard; the per-file slice_read nudge/block) fought a task that read a
 * 1200-line file in ≤200-line chunks: loop_escalation remind(4)/diversify(12) on ONE hash,
 * steering_injected slice_read, then loop_tool_block neardup-hash pushed the model off Bash. A
 * monotonic range progression over one file is the canonical way to read a large input.
 *
 * ONE pure helper shared by the ladder (hash lens + poll guard + similarity lens), the near-dup
 * trigger downstream of it, and the slice_read nudge/block: recognize a chunk read and decide
 * whether two chunk reads of the same file form a DISJOINT, INCREASING progression (a new approach)
 * or a repeat/overlap/backwards read (still a retry — real loop detection stays intact).
 */

export type ChunkReadKind = 'sed' | 'head' | 'head-tail' | 'tail-head' | 'awk' | 'read';

export interface ChunkRead {
  file: string;
  /** 1-based inclusive line range. */
  start: number;
  end: number;
  kind: ChunkReadKind;
}

const FILE = String.raw`([^\s;|&><'"]+)`;
const Q = String.raw`['"]?`;
// sed -n 'A,Bp' FILE  |  sed -n "A,Bp" FILE  |  sed -n A,Bp FILE
const SED_FILE_RE = new RegExp(String.raw`sed\s+-n\s+${Q}(\d+)\s*,\s*(\d+)\s*p${Q}\s+${FILE}`);
// cat FILE | sed -n 'A,Bp'
const CAT_SED_RE = new RegExp(String.raw`cat\s+${FILE}\s*\|\s*sed\s+-n\s+${Q}(\d+)\s*,\s*(\d+)\s*p${Q}`);
// head -n N FILE | tail -n M   (also head -N / tail -M)
const HEAD_TAIL_RE = new RegExp(String.raw`head\s+-n?\s*(\d+)\s+${FILE}\s*\|\s*tail\s+-n?\s*(\d+)(?!\d)`);
// tail -n +A FILE | head -n B   (also head -B)
const TAIL_HEAD_RE = new RegExp(String.raw`tail\s+-n?\s*\+(\d+)\s+${FILE}\s*\|\s*head\s+-n?\s*(\d+)`);
// bare head -n N FILE (lines 1..N)
const HEAD_RE = new RegExp(String.raw`head\s+-n?\s*(\d+)\s+${FILE}`);
// awk 'NR>=A && NR<=B' FILE
const AWK_RE = new RegExp(String.raw`awk\s+${Q}\s*NR\s*>=\s*(\d+)\s*&&\s*NR\s*<=\s*(\d+)\s*${Q}\s+${FILE}`);

function chunk(file: string, start: number, end: number, kind: ChunkReadKind): ChunkRead | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) return null;
  return { file, start, end, kind };
}

/** Parse a bash command as a chunk read of one file, or null when it is not one (or the range is invalid). */
export function parseChunkRead(command: string): ChunkRead | null {
  const cmd = String(command ?? '');
  let m: RegExpExecArray | null;
  if ((m = SED_FILE_RE.exec(cmd))) return chunk(m[3]!, Number(m[1]), Number(m[2]), 'sed');
  if ((m = CAT_SED_RE.exec(cmd))) return chunk(m[1]!, Number(m[2]), Number(m[3]), 'sed');
  if ((m = TAIL_HEAD_RE.exec(cmd))) {
    const start = Number(m[1]);
    return chunk(m[2]!, start, start + Number(m[3]) - 1, 'tail-head');
  }
  if ((m = HEAD_TAIL_RE.exec(cmd))) {
    const end = Number(m[1]);
    return chunk(m[2]!, end - Number(m[3]) + 1, end, 'head-tail');
  }
  if ((m = AWK_RE.exec(cmd))) return chunk(m[3]!, Number(m[1]), Number(m[2]), 'awk');
  if ((m = HEAD_RE.exec(cmd))) return chunk(m[2]!, 1, Number(m[1]), 'head');
  return null;
}

/** Parse a tool input (Bash {command} or Read {file_path, offset, limit}) as a chunk read. */
export function parseChunkReadInput(toolName: string, input: unknown): ChunkRead | null {
  if (!input || typeof input !== 'object') return null;
  const i = input as Record<string, unknown>;
  if (toolName === 'Bash') return parseChunkRead(String(i.command ?? ''));
  if (toolName === 'Read') {
    const file = typeof i.file_path === 'string' ? i.file_path : '';
    const limit = typeof i.limit === 'number' ? i.limit : NaN;
    if (!file || !Number.isFinite(limit) || limit < 1) return null; // whole-file Read is not a chunk
    const start = typeof i.offset === 'number' && i.offset >= 1 ? i.offset : 1;
    return chunk(file, start, start + limit - 1, 'read');
  }
  return null;
}

/** True when `next` is a DISJOINT, INCREASING chunk of the same file after `prev` — a progression,
 *  not a retry. Identical, overlapping and backwards ranges (and different files) are NOT. */
export function isChunkProgression(prev: ChunkRead | null | undefined, next: ChunkRead | null | undefined): boolean {
  if (!prev || !next) return false;
  return prev.file === next.file && next.start > prev.end && next.end >= next.start;
}
