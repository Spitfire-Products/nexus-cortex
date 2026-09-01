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
 * touches session-class roots (native/, canon/, projections/) — scaffolding
 * (HARNESSES.json, agents/, .github/, docs) is never archived.
 */
import { execFileSync } from 'child_process';

const SESSION_ROOTS = ['native/', 'canon/', 'projections/'];

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

  const moves: Array<{ from: string; to: string }> = [];
  for (const e of entries) {
    if (e.path.startsWith('archive/')) continue;
    if (!SESSION_ROOTS.some((r) => e.path.startsWith(r))) continue;
    const ct = epochs.get(e.path) ?? 0;
    if (ct === 0 || ct >= cutoff) continue;
    const d = new Date(ct * 1000);
    const bucket = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    moves.push({ from: e.path, to: `archive/${bucket}/${e.path}` });
  }

  if (moves.length === 0) {
    console.log(`[canon-archive] nothing older than ${days}d to archive (${entries.length} tracked files)`);
    return 0;
  }
  console.log(`[canon-archive] archiving ${moves.length} of ${entries.length} files (last commit > ${days}d ago)`);
  if (opts.dryRun) {
    for (const m of moves.slice(0, 20)) console.log(`  ${m.from} -> ${m.to}`);
    if (moves.length > 20) console.log(`  … ${moves.length - 20} more`);
    return 0;
  }

  // Build the new index wholesale: every entry at its final path. Renames keep
  // the same blob sha — no content read, no re-upload, works in partial clones.
  const dest = new Map(moves.map((m) => [m.from, m.to]));
  const indexInfo = entries
    .map((e) => `${e.mode} ${e.sha} 0\t${dest.get(e.path) ?? e.path}`)
    .join('\n') + '\n';
  git(store, ['read-tree', '--empty']);
  git(store, ['update-index', '--index-info'], indexInfo);
  const tree = git(store, ['write-tree']).trim();
  const parent = git(store, ['rev-parse', 'HEAD']).trim();
  const commit = git(store, [
    '-c', 'user.email=canon-archive@local', '-c', 'user.name=canon-archive',
    'commit-tree', tree, '-p', parent,
    '-m', `canon-archive: ${moves.length} sessions older than ${days}d -> archive/ (renames only; remote keeps everything)`,
  ]).trim();
  git(store, ['update-ref', 'HEAD', commit]);

  // Sparse-exclude archive/ so the local worktree DROPS the moved files (this
  // is where the flat-forever footprint comes from), then sync the worktree.
  git(store, ['sparse-checkout', 'set', '--no-cone', '/*', '!archive/']);
  git(store, ['read-tree', '-mu', 'HEAD']);

  if (opts.push !== false) {
    try {
      git(store, ['push', 'origin', 'HEAD']);
      console.log(`[canon-archive] pushed ${commit.slice(0, 10)} (${moves.length} archived)`);
    } catch (e: any) {
      console.error(`[canon-archive] PUSH FAILED (commit is local-only — rerun push): ${String(e?.message ?? e).slice(0, 200)}`);
      return 1;
    }
  }
  return 0;
}
