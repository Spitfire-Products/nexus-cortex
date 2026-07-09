/**
 * Archive-aware memory pruning for the persistent MEMORY.md doc.
 *
 * PROBLEM this fixes: `.cortex/MEMORY.md` (and the other MEMORY.md locations)
 * grow UNBOUNDED — the harness never prunes them — and are injected on every
 * turn-0 request. The only existing limiter, `SYSTEM_MESSAGE_DOC_MAX_BYTES`,
 * head-slices the doc for injection and DROPS the tail (see docTruncation.ts),
 * which silently loses the most-recent memories written at the end of the file.
 *
 * THE FIX (two-tier, same design as the external-agent auto-memory archive):
 *   - MEMORY.md      = the bounded HOT working memory (what gets injected).
 *   - MEMORY.archive.md = an append-only SUPERSET of everything ever spilled.
 * When MEMORY.md exceeds the cap, the overflow (tail) is MOVED into the archive
 * (never dropped) and MEMORY.md is rewritten to the bounded head + a pointer to
 * the archive. Invariant: nothing written to MEMORY.md is ever lost to a size
 * bound — it moves to the archive, which the model can Read on demand.
 *
 * Opt-in via `MEMORY_ARCHIVE_MAX_BYTES` (0/unset = off, unchanged behavior).
 */
import { readFile, writeFile } from 'fs/promises';
import { dirname, join, basename } from 'path';

/** Bytes reserved for the archive pointer appended to the bounded hot content. */
const POINTER_RESERVE = 240;
/** Don't keep a hot head smaller than this fraction of the budget (avoid a near-empty inject). */
const MIN_KEEP_FRACTION = 0.5;

export interface MemoryPrunePlan {
  /** Bounded head to keep in MEMORY.md (and inject). */
  hot: string;
  /** Overflow tail to move into the archive. */
  overflow: string;
}

/**
 * Decide how to split `content` into a bounded head + an overflow tail, cutting
 * on a clean markdown boundary (prefer a `## ` section header, else a blank
 * line, else any newline) so entries are never chopped mid-line.
 * Returns null when `content` already fits under `maxBytes`.
 */
export function planMemoryPrune(content: string, maxBytes: number): MemoryPrunePlan | null {
  if (!maxBytes || maxBytes <= 0) return null;
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) return null;

  const budget = Math.max(1, maxBytes - POINTER_RESERVE);
  // Work in byte space via a conservative char index, then refine to a boundary.
  // (For ASCII/most markdown, char index ≈ byte index; we re-check bytes below.)
  let cut = budget;
  if (cut >= content.length) cut = content.length - 1;

  // Prefer the last section header at/under budget.
  const headerCut = content.lastIndexOf('\n## ', cut);
  // Else the last blank line (paragraph boundary).
  const blankCut = content.lastIndexOf('\n\n', cut);
  // Else any line boundary.
  const lineCut = content.lastIndexOf('\n', cut);

  const minKeep = budget * MIN_KEEP_FRACTION;
  let split = -1;
  for (const c of [headerCut, blankCut, lineCut]) {
    if (c >= minKeep) { split = c; break; }
  }
  if (split < 0) split = lineCut >= 0 ? lineCut : cut; // last resort

  const hot = content.slice(0, split).replace(/\s+$/, '');
  const overflow = content.slice(split).replace(/^\s+/, '');
  if (!overflow) return null;
  return { hot, overflow };
}

/** Path of the sibling archive for a given MEMORY.md path. */
export function archivePathFor(memoryPath: string): string {
  return join(dirname(memoryPath), 'MEMORY.archive.md');
}

function archiveHeader(memoryPath: string): string {
  return (
    `# ${basename(memoryPath)} — Archive\n\n` +
    `Append-only overflow spilled from \`${basename(memoryPath)}\` when it exceeded the injection cap ` +
    `(\`MEMORY_ARCHIVE_MAX_BYTES\`). Nothing here was lost — it moved out of the hot memory to keep per-turn ` +
    `injection bounded. Read this file when you need older memories not in \`${basename(memoryPath)}\`.\n`
  );
}

function pointer(memoryPath: string, movedBytes: number, totalArchiveBytes: number): string {
  const ap = basename(archivePathFor(memoryPath));
  return (
    `\n\n<!-- [memory pruned: ${movedBytes.toLocaleString()} bytes of older entries moved to ${ap} ` +
    `(${totalArchiveBytes.toLocaleString()} bytes archived total). Read ${ap} for the full history.] -->\n`
  );
}

/**
 * Prune MEMORY.md at `memoryPath` to `maxBytes`, moving overflow to the sibling
 * MEMORY.archive.md (append-only). Mutates BOTH files on disk when it prunes.
 * Returns the bounded hot content to inject. When `maxBytes<=0`, or the file is
 * already under the cap, returns `content` unchanged and touches nothing.
 *
 * Idempotent: a file already at/under the cap is a no-op, so running this every
 * injection is safe and self-limiting.
 */
export async function pruneMemoryFileToArchive(
  memoryPath: string,
  content: string,
  maxBytes: number,
): Promise<string> {
  const plan = planMemoryPrune(content, maxBytes);
  if (!plan) return content;

  const archPath = archivePathFor(memoryPath);
  let archive = '';
  try {
    archive = await readFile(archPath, 'utf8');
  } catch {
    archive = archiveHeader(memoryPath);
  }

  // Dedup guard: don't re-append an overflow block already at the tail of the
  // archive (protects against a double-run before the hot file is rewritten).
  const stamp = new Date().toISOString();
  const block = `\n\n## Spilled ${stamp}\n\n${plan.overflow}\n`;
  const probe = plan.overflow.slice(0, 120);
  if (!archive.includes(probe)) {
    archive = archive.replace(/\s+$/, '') + block + '\n';
    await writeFile(archPath, archive, 'utf8');
  }

  const movedBytes = Buffer.byteLength(plan.overflow, 'utf8');
  const totalArchiveBytes = Buffer.byteLength(archive, 'utf8');
  const hot = plan.hot + pointer(memoryPath, movedBytes, totalArchiveBytes);
  await writeFile(memoryPath, hot, 'utf8');
  return hot;
}

/** Resolve the archive cap from env. 0 (off) by default — non-breaking. */
export function resolveMemoryArchiveMaxBytes(envValue: string | undefined): number {
  if (!envValue) return 0;
  const n = Number.parseInt(envValue, 10);
  if (Number.isNaN(n) || n < 0) return 0;
  return n;
}
