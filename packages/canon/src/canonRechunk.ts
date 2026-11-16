/**
 * canonRechunk — re-chunk ONE existing native session into the segmented layout (canonSegments), on demand.
 *
 * Existing sessions are never migrated automatically. This writes `<id>.jsonl.seg-SSSS.part-PPPP` + `<id>.segments.json`
 * BESIDE the session's current files (single `<id>.jsonl` or old `<id>.jsonl.part-NNNN`), verifies that the new files
 * reassemble to exactly the old bytes (sha256), and deletes nothing. From then on every reader prefers the segmented
 * copy, the next sync continues that session in the segmented layout (closed segments untouched), and the next
 * translate re-derives its canonical line segmented (its old canon/ `.part-NNNN` outputs are left too). The old files stay
 * until the operator removes them (`git -C <store> rm <listed paths>`, plus the matching canon/ parts), after review —
 * a bulk delete in a sync/translate commit would trip the mass-deletion guard (> 10 deletions). Nothing is committed
 * here: the next sync commits the new files.
 *
 * @module canon/canonRechunk
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { defaultCanonStore } from './storePath.js';
import { withStoreLock } from './canonRepo.js';
import { findNativeSessions } from './canonPull.js';
import { DEFAULT_PART_BYTES, isSegmentChunk, renderSegments, writeSegmentedFromFiles, type SegmentIndex } from './canonSegments.js';

export interface CanonRechunkOptions {
  store?: string;
  /** Session uuid (or unique prefix) under native/. */
  session: string;
  harness?: string;
  /** Exact store-relative native path (under native/), e.g. claude-code/<dir>/<uuid>.jsonl. */
  rel?: string;
  /** Plan only: print the segments and the files that would be written; write nothing. */
  dryRun?: boolean;
  partBytes?: number;
}
export interface CanonRechunkResult {
  code: 0 | 1;
  index?: SegmentIndex;
  /** Files written (or, dry run, that would be written). */
  written?: string[];
  /** The old-layout files left in place. */
  oldFiles?: string[];
}

async function rechunkUnlocked(o: CanonRechunkOptions): Promise<CanonRechunkResult> {
  const store = o.store ?? defaultCanonStore();
  let matches = findNativeSessions(store, o.session, { harness: o.harness, rel: o.rel });
  if (!o.rel) matches = matches.filter((m) => !m.rel.split(path.sep).includes('subagents'));
  if (matches.length !== 1) {
    console.error(matches.length ? `[canon-rechunk] ambiguous — ${matches.length} matches (pin one with --rel <path>):` : `[canon-rechunk] no live native session matches '${o.session}' (archived sessions are not re-chunked)`);
    for (const m of matches) console.error(`  ${m.rel}`);
    return { code: 1 };
  }
  const s = matches[0]!;
  if (s.parts.every(isSegmentChunk)) { console.log(`[canon-rechunk] ${s.rel} is already stored by segment — nothing to do`); return { code: 0, written: [], oldFiles: [] }; }
  const logicalAbs = path.join(store, 'native', s.rel);
  const old = s.parts.slice();
  const oldSha = createHash('sha256');
  for (const p of old) oldSha.update(fs.readFileSync(p));
  const expect = oldSha.digest('hex');
  const r = writeSegmentedFromFiles(old, logicalAbs, { harness: s.harness, partBytes: o.partBytes ?? DEFAULT_PART_BYTES, dryRun: o.dryRun });
  if (r.index.sha256 !== expect) { console.error(`[canon-rechunk] INTERNAL: segmented bytes differ from the stored session (${s.rel})`); return { code: 1 }; }
  if (!o.dryRun) {
    const h = createHash('sha256');
    for (const seg of r.index.segments) for (const f of seg.parts ?? []) h.update(fs.readFileSync(path.join(path.dirname(logicalAbs), f.file)));
    if (h.digest('hex') !== expect) { console.error(`[canon-rechunk] VERIFY FAILED: the written segments do not reassemble to ${s.rel} — old files untouched`); return { code: 1 }; }
  }
  console.log(`[canon-rechunk] ${o.dryRun ? 'DRY RUN — would write' : 'wrote'} ${r.written.length} file(s) for ${s.rel}: ${r.index.segments.length} segment(s), ${(r.index.bytes / 1e6).toFixed(1)} MB, sha256 ${expect.slice(0, 16)}… ${o.dryRun ? '' : 'verified'}`);
  console.log(renderSegments(r.index.segments));
  console.log(`[canon-rechunk] old layout left in place (${old.length} file(s)); readers now prefer the segmented copy. Remove after review:\n` +
    old.map((p) => `  git -C ${store} rm -q -- ${path.relative(store, p)}`).join('\n') +
    `\n  (after the next translate, also its old canon/ outputs: git -C ${store} rm -q -- 'canon/${s.rel}.part-*' 'canon/${s.rel.replace(/\.jsonl$/, '.events.jsonl')}.part-*')`);
  return { code: 0, index: r.index, written: r.written, oldFiles: old };
}

/** Re-chunk one native session into the segmented layout under the store's single-writer lock. */
export async function canonRechunk(o: CanonRechunkOptions): Promise<CanonRechunkResult> {
  return withStoreLock(o.store ?? defaultCanonStore(), 'canon-rechunk', () => rechunkUnlocked(o), () => {
    console.error('[canon-rechunk] store busy — another canon writer holds the lock; retry');
    return { code: 1 as const };
  });
}
