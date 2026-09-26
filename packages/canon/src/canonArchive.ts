/**
 * canonArchive — the hot/archive split for the canon store (operator design,
 * 2026-08-31, after the local clone's unbounded growth froze the host three
 * times in one day: the /tmp per-user quota is ~5-6GB and the full store had
 * grown past 5GB).
 *
 * Model (mirrors the memory-index hot/archive pattern):
 *   - REMOTE keeps everything forever (append-only; nothing is ever deleted).
 *   - Session-class files whose last commit is older than `--days` (default 30)
 *     move to `archive/YYYY-MM/<original path>` in ONE plumbing-built commit —
 *     renames reuse blob hashes, so no content is rewritten or re-uploaded.
 *   - The local checkout becomes/stays SPARSE with `archive/` excluded, so the
 *     working store's footprint stays FLAT as months roll into the archive.
 *   - Reading an archived session still works: `canon pull` fetches the blob
 *     on demand (partial clone) — the "link" always resolves, like [[archive]].
 *
 * Safety: refuses to run on a dirty worktree (a mid-sync watcher), and only
 * touches session transcripts under native/, canon/, projections/ (isArchivablePath) —
 * scaffolding (HARNESSES.json, agents/, .github/, docs), capability artifacts, captured
 * memory, and index docs are never archived. Whole sessions move together (sessionUnit),
 * and a live session byte-identical to its archived copy is dropped (the 09-20 re-add).
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ARCHIVE_EXCLUSION_PATTERNS, ensureArchiveExclusion } from './canonRepo.js';

const SESSION_ROOTS = ['native/', 'canon/', 'projections/'];

/**
 * Only session transcripts are archivable. The session roots also hold current-state files that must stay live:
 * captured capability artifacts (`canon/artifacts/`), captured memory files (`…/memory/…`), and index docs
 * (`SKIPPED.md`, `MAPPING.md`, `PROJECTIONS.md`, `.gitkeep`). 09-26: the prefix-only filter had archived ~1.3k of them.
 */
export function isArchivablePath(p: string): boolean {
  if (!SESSION_ROOTS.some((r) => p.startsWith(r))) return false;
  if (p.startsWith('canon/artifacts/')) return false;
  if (p.split('/').includes('memory')) return false;
  return !p.endsWith('.md') && !p.endsWith('.gitkeep');
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/**
 * The files of ONE session move and dedupe together: chunks (`<id>.jsonl.part-NNNN`), sidecars (`<id>.events.jsonl`,
 * `<id>.meta.json`), and subagent files (`<id>/subagents/…`, `<id>.subagents/…`). Key = the path up to the first uuid
 * segment (its stem), else the directory + the basename's stem.
 */
export function sessionUnit(p: string): string {
  const parts = p.split('/');
  const i = parts.findIndex((s) => UUID_SEGMENT.test(s));
  if (i >= 0) return [...parts.slice(0, i), parts[i]!.match(UUID_SEGMENT)![0]].join('/');
  return [...parts.slice(0, -1), parts[parts.length - 1]!.split('.')[0]].join('/');
}

export interface CanonArchiveOptions {
  store: string;
  days?: number;
  dryRun?: boolean;
  push?: boolean;
}

function git(store: string, args: string[], input?: string): string {
  return execFileSync('git', ['-C', store, ...args], {
    encoding: 'utf-8',
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], // keep expected probe failures (ls-files --error-unmatch) out of the cron log
  });
}

/** Per-path last-commit epoch: one newest-first log walk; first sighting wins. */
function lastCommitEpochs(store: string): Map<string, number> {
  const out = git(store, ['log', '--format=C %ct', '--name-only']);
  const map = new Map<string, number>();
  let ct = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('C ')) ct = parseInt(line.slice(2), 10) || 0;
    else if (line && !map.has(line)) map.set(line, ct);
  }
  return map;
}

export async function canonArchive(opts: CanonArchiveOptions): Promise<number> {
  const days = opts.days ?? parseInt(process.env.CANON_ARCHIVE_DAYS || '30', 10);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const store = opts.store;

  // Dirty worktree = a sync may be mid-flight (the watcher) — never race it.
  if (git(store, ['status', '--porcelain']).trim()) {
    console.error('[canon-archive] store has uncommitted changes (a sync may be running) — aborting; retry when clean');
    return 1;
  }

  const epochs = lastCommitEpochs(store);
  // Current tracked files (mode + sha + path) — the plumbing inputs.
  const entries: Array<{ mode: string; sha: string; path: string }> = [];
  for (const line of git(store, ['ls-files', '-s']).split('\n')) {
    if (!line) continue;
    const m = line.match(/^(\d{6}) ([0-9a-f]{40,64}) \d\t(.+)$/);
    if (m) entries.push({ mode: m[1]!, sha: m[2]!, path: m[3]! });
  }

  // Blobs already held under archive/, by original path (a path can sit in more than one month bucket).
  const archived = new Map<string, Set<string>>();
  for (const e of entries) {
    const m = e.path.match(/^archive\/\d{4}-\d{2}\/(.+)$/);
    if (m) (archived.get(m[1]!) ?? archived.set(m[1]!, new Set()).get(m[1]!)!).add(e.sha);
  }
  const units = new Map<string, typeof entries>();
  for (const e of entries) {
    if (e.path.startsWith('archive/') || !isArchivablePath(e.path)) continue;
    const k = sessionUnit(e.path);
    (units.get(k) ?? units.set(k, []).get(k)!).push(e);
  }

  // Per session: DROP when every live file is byte-identical to an archived copy (the 09-20 re-add left ~15k such
  // sessions live — no age test, they are pure duplicates); MOVE when every file is older than the cutoff (a chunked
  // session that is still growing keeps its old parts live with the new ones). A grown or changed session stays live.
  const moves: Array<{ from: string; to: string }> = [];
  const drops: string[] = [];
  for (const files of units.values()) {
    if (files.every((e) => archived.get(e.path)?.has(e.sha))) { drops.push(...files.map((e) => e.path)); continue; }
    const cts = files.map((e) => epochs.get(e.path) ?? 0);
    if (cts.some((ct) => ct === 0 || ct >= cutoff)) continue;
    for (const [i, e] of files.entries()) {
      if (archived.get(e.path)?.has(e.sha)) { drops.push(e.path); continue; } // already archived byte-identical: no second copy
      const d = new Date(cts[i]! * 1000);
      const bucket = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      moves.push({ from: e.path, to: `archive/${bucket}/${e.path}` });
    }
  }

  if (moves.length === 0 && drops.length === 0) {
    console.log(`[canon-archive] nothing older than ${days}d to archive (${entries.length} tracked files)`);
    // Still enforce the local footprint: a fresh (re-)clone or an older build may have materialized archive/.
    if (!opts.dryRun) ensureArchiveExclusion(store, 'canon-archive');
    return 0;
  }
  console.log(`[canon-archive] archiving ${moves.length} of ${entries.length} files (last commit > ${days}d ago); ` +
    `dropping ${drops.length} live duplicate(s) of archived files`);
  if (opts.dryRun) {
    for (const m of moves.slice(0, 20)) console.log(`  ${m.from} -> ${m.to}`);
    if (moves.length > 20) console.log(`  … ${moves.length - 20} more`);
    for (const p of drops.slice(0, 20)) console.log(`  drop ${p} (identical copy under archive/)`);
    if (drops.length > 20) console.log(`  … ${drops.length - 20} more drops`);
    return 0;
  }

  // Build the new index wholesale: every entry at its final path (dropped duplicates omitted). Renames keep
  // the same blob sha — no content read, no re-upload, works in partial clones.
  const dest = new Map(moves.map((m) => [m.from, m.to]));
  const dropped = new Set(drops);
  const indexInfo = entries
    .filter((e) => !dropped.has(e.path))
    .map((e) => `${e.mode} ${e.sha} 0\t${dest.get(e.path) ?? e.path}`)
    .join('\n') + '\n';
  git(store, ['read-tree', '--empty']);
  git(store, ['update-index', '--index-info'], indexInfo);
  // 09-26 FIX: --index-info entries carry NO stat data, so git treats every file already on disk as "not uptodate" and
  // refuses to drop it when the exclusion applies (live: a store that had materialized archive/ kept all 1.6 GB).
  // Re-stat what is really on disk (identical content → uptodate); missing paths (the new archive/ entries) are fine.
  try { git(store, ['update-index', '-q', '--refresh', '--ignore-missing']); } catch { /* exit 1 = some entries differ; harmless */ }
  const tree = git(store, ['write-tree']).trim();
  const parent = git(store, ['rev-parse', 'HEAD']).trim();
  const commit = git(store, [
    '-c', 'user.email=canon-archive@local', '-c', 'user.name=canon-archive',
    'commit-tree', tree, '-p', parent,
    '-m', `canon-archive: ${moves.length} files older than ${days}d -> archive/` +
      (drops.length ? `, ${drops.length} live duplicates of archived files dropped` : '') + (moves.length ? ' (renames only; remote keeps everything)' : ' (remote keeps everything)'),
  ]).trim();
  git(store, ['update-ref', 'HEAD', commit]);

  // Sparse-exclude archive/ so the local worktree DROPS the moved files (this
  // is where the flat-forever footprint comes from), then sync the worktree.
  git(store, ['sparse-checkout', 'set', '--no-cone', ...ARCHIVE_EXCLUSION_PATTERNS]);
  git(store, ['read-tree', '-mu', 'HEAD']);
  git(store, ['sparse-checkout', 'reapply']);

  // 09-26 FIX (reproduced): the index rewrite above carries no stat data, so git leaves the moved files ON DISK
  // at their old paths as UNTRACKED files — nothing is freed, the next archive run aborts on the dirty tree,
  // and the next sync's `git add -A` would re-add every archived session at its old path. Remove each leftover
  // only when its bytes hash to the archived blob (so a file a writer touched meanwhile is never lost).
  const shaByFrom = new Map(entries.map((e) => [e.path, e.sha]));
  let removed = 0, kept = 0, freed = 0;
  const dirs = new Set<string>();
  for (const from of [...moves.map((m) => m.from), ...drops]) {
    const abs = path.join(store, from);
    if (!fs.existsSync(abs)) continue;
    let tracked = true;
    try { git(store, ['ls-files', '--error-unmatch', '--', from]); } catch { tracked = false; }
    const sha = tracked ? '' : git(store, ['hash-object', '--', from]).trim();
    if (tracked || sha !== shaByFrom.get(from)) { kept++; continue; }
    freed += fs.statSync(abs).size;
    fs.unlinkSync(abs);
    removed++;
    dirs.add(path.dirname(abs));
  }
  // Prune directories the removals emptied (deepest first), never the store root.
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    let cur = d;
    while (cur.startsWith(store + path.sep) && cur !== store) {
      try { if (fs.readdirSync(cur).length > 0) break; fs.rmdirSync(cur); } catch { break; }
      cur = path.dirname(cur);
    }
  }
  console.log(`[canon-archive] local worktree: removed ${removed} archived file(s) (${(freed / 1048576).toFixed(1)} MB freed)` +
    (kept ? `, kept ${kept} that changed since the move (review)` : ''));

  if (opts.push !== false) {
    try {
      git(store, ['push', 'origin', 'HEAD']);
      console.log(`[canon-archive] pushed ${commit.slice(0, 10)} (${moves.length} archived, ${drops.length} duplicates dropped)`);
    } catch (e: any) {
      console.error(`[canon-archive] PUSH FAILED (commit is local-only — rerun push): ${String(e?.message ?? e).slice(0, 200)}`);
      return 1;
    }
  }
  return 0;
}

/**
 * Remove UNTRACKED files that are byte-identical to an archived copy at the same original path, before a commit
 * stages them. Two writers re-create archived sessions on disk: the browser-branch fold-in (`git checkout FETCH_HEAD
 * -- native/browser-cortex` restores every file the branch holds) and harness roots whose copies are re-staged
 * unchanged. Without this, every sync re-adds them and every archive run drops them again (seen 09-26: 77 files per
 * cycle). A session that grew differs from its archived copy and stays; files tracked in HEAD are never touched.
 */
export function dropArchivedDuplicates(store: string, label: string): number {
  let tree = '';
  let untracked = '';
  let staged = '';
  try {
    tree = git(store, ['ls-tree', '-r', 'HEAD', '--', 'archive']);
    untracked = git(store, ['ls-files', '--others', '--exclude-standard', '-z']);
    // `git checkout <tree> -- <path>` (the browser fold-in) writes AND stages — those files are added in the index, not untracked.
    staged = git(store, ['diff', '--cached', '--name-only', '--diff-filter=A', '-z', 'HEAD']);
  } catch { return 0; }
  const stagedSet = new Set(staged.split('\0').filter(Boolean));
  const archived = new Map<string, Set<string>>();
  for (const line of tree.split('\n')) {
    const m = line.match(/^\d{6} blob ([0-9a-f]{40,64})\tarchive\/\d{4}-\d{2}\/(.+)$/);
    if (m && isArchivablePath(m[2]!)) (archived.get(m[2]!) ?? archived.set(m[2]!, new Set()).get(m[2]!)!).add(m[1]!);
  }
  let removed = 0;
  for (const rel of [...untracked.split('\0'), ...stagedSet]) {
    const shas = rel ? archived.get(rel) : undefined;
    if (!shas) continue;
    let sha = '';
    try { sha = git(store, ['hash-object', '--', rel]).trim(); } catch { continue; }
    if (!shas.has(sha)) continue;
    try {
      if (stagedSet.has(rel)) git(store, ['rm', '-q', '-f', '--', rel]); // unstage + delete (only ever an index-ADDED path)
      else fs.unlinkSync(path.join(store, rel));
      removed++;
    } catch { /* raced away */ }
  }
  if (removed) console.log(`[${label}] skipped ${removed} file(s) identical to their archived copy (not re-added)`);
  return removed;
}
