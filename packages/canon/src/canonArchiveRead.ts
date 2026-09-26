/**
 * canonArchiveRead — read archived canon sessions straight from the store's git objects (2026-09-26).
 *
 * The hot/archive split (canonArchive.ts) keeps `archive/` out of the local worktree, so anything that walks
 * `canon/` on disk (the project graphs) would lose every session older than the archive cutoff. This module lists
 * the archived canonical line from HEAD's tree and streams session bytes with `git cat-file` — nothing is written
 * to disk. In a partial clone a blob that is not local yet is fetched on demand by git (promisor remote).
 *
 * Archived blobs never change, so consumers can key caches on the blob ids (canonTouched does): each archived
 * session is read once per machine, then served from cache.
 *
 * @module canonArchiveRead
 */
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { CanonSession } from './canonPull.js';

/** Where an archived session's bytes live: git blob ids in the store (part order), plus the events sidecar. */
export interface ArchivedSessionRef {
  store: string;
  /** Repo path of the logical session under archive/ (e.g. archive/2026-08/canon/claude-code/<dir>/<id>.jsonl). */
  path: string;
  blobs: string[];
  sidecarBlob?: string;
}

/**
 * Archived canonical sessions (HEAD `archive/<YYYY-MM>/canon/…`) whose logical path is NOT live — a live copy
 * always wins. A session archived in more than one month bucket resolves to the newest bucket. Same grouping and
 * uuid rules as discoverCanonSessions (parts-aware, events sidecars excluded, empty mains skipped).
 */
export function discoverArchivedCanonSessions(
  store: string,
  live: Iterable<string>,
  opts: { home?: string } = {},
): CanonSession[] {
  let out = '';
  try {
    out = execFileSync('git', ['-C', store, 'ls-tree', '-r', '-l', 'HEAD', '--', 'archive'], {
      encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { return []; }
  const liveRels = new Set(live);
  type Group = { bucket: string; parts: Array<{ name: string; sha: string; size: number }>; sidecar?: string };
  const groups = new Map<string, Group>(); // key = rel under canon/ (logical .jsonl)
  const sidecars = new Map<string, { bucket: string; sha: string }>();
  for (const line of out.split('\n')) {
    const m = line.match(/^\d{6} blob ([0-9a-f]{40,64}) +(\d+|-)\t(.+)$/);
    if (!m) continue;
    const pm = m[3]!.match(/^archive\/(\d{4}-\d{2})\/canon\/(.+)$/);
    if (!pm) continue;
    const [bucket, rest] = [pm[1]!, pm[2]!];
    if (rest.endsWith('.events.jsonl')) {
      const logical = rest.replace(/\.events\.jsonl$/, '.jsonl');
      const cur = sidecars.get(logical);
      if (!cur || bucket > cur.bucket) sidecars.set(logical, { bucket, sha: m[1]! });
      continue;
    }
    const cm = rest.match(/^(.*\.jsonl)\.part-\d{4}$/);
    const logical = cm ? cm[1]! : rest;
    if (!logical.endsWith('.jsonl')) continue;
    const g = groups.get(logical);
    const part = { name: rest, sha: m[1]!, size: m[2] === '-' ? 0 : parseInt(m[2]!, 10) };
    if (!g || bucket > g.bucket) groups.set(logical, { bucket, parts: [part] });
    else if (bucket === g.bucket) g.parts.push(part);
  }

  const titles = loadTitleCache(opts.home);
  let titlesChanged = false;
  const sessions: CanonSession[] = [];
  for (const [rel, g] of groups) {
    if (liveRels.has(rel)) continue;
    g.parts.sort((a, b) => a.name.localeCompare(b.name));
    const bytes = g.parts.reduce((n, p) => n + p.size, 0);
    if (bytes === 0) continue;
    let uuid = path.basename(rel, '.jsonl');
    const parent = path.basename(path.dirname(rel));
    if (!/^[0-9a-f]{8}-/i.test(uuid) && /^[0-9a-f]{8}-[0-9a-f-]{10,}$/i.test(parent)) uuid = parent;
    const side = sidecars.get(rel);
    let title: string | undefined;
    if (side) {
      if (side.sha in titles.map) title = titles.map[side.sha] ?? undefined;
      else {
        title = titleFromEvents(store, side.sha);
        titles.map[side.sha] = title ?? null;
        titlesChanged = true;
      }
    }
    const repoPath = `archive/${g.bucket}/canon/${rel}`;
    const archived: ArchivedSessionRef = { store, path: repoPath, blobs: g.parts.map((p) => p.sha), sidecarBlob: side?.sha };
    sessions.push({
      uuid, rel, bytes, title, harness: rel.split('/')[0] ?? '?',
      parts: g.parts.map((p) => `archive/${g.bucket}/canon/${p.name}`),
      archived,
    });
  }
  if (titlesChanged) saveTitleCache(titles);
  return sessions.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Stream a session's JSONL lines — disk parts for a live session, git blobs for an archived one. */
export async function* sessionLines(s: CanonSession): AsyncGenerator<string> {
  if (!s.archived) {
    for (const part of s.parts) yield* linesOf(fs.createReadStream(part));
    return;
  }
  for (const sha of s.archived.blobs) yield* blobLines(s.archived.store, sha);
}

/** Stream the events sidecar's lines (nothing when the session has none). */
export async function* sidecarLines(s: CanonSession): AsyncGenerator<string> {
  if (s.archived) {
    if (s.archived.sidecarBlob) yield* blobLines(s.archived.store, s.archived.sidecarBlob);
    return;
  }
  const sidecar = s.parts[0]!.replace(/\.part-\d{4}$/, '').replace(/\.jsonl$/, '.events.jsonl');
  if (fs.existsSync(sidecar)) yield* linesOf(fs.createReadStream(sidecar));
}

async function* linesOf(input: NodeJS.ReadableStream): AsyncGenerator<string> {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

async function* blobLines(store: string, sha: string): AsyncGenerator<string> {
  const child = spawn('git', ['-C', store, 'cat-file', 'blob', sha], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += String(d); });
  const exited = new Promise<number>((resolve) => child.on('close', (code) => resolve(code ?? 1)));
  yield* linesOf(child.stdout);
  const code = await exited;
  if (code !== 0) throw new Error(`git cat-file blob ${sha.slice(0, 12)} failed (${code}): ${stderr.trim().slice(0, 200)}`);
}

function titleFromEvents(store: string, sha: string): string | undefined {
  let text = '';
  try {
    text = execFileSync('git', ['-C', store, 'cat-file', 'blob', sha], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { return undefined; }
  let title: string | undefined;
  for (const line of text.split('\n')) {
    if (!line.includes('ai-title')) continue;
    try { const r = JSON.parse(line); if (r.type === 'ai-title' && r.aiTitle) title = r.aiTitle; } catch { /* skip */ }
  }
  return title;
}

// Titles of archived sessions, keyed by the sidecar's blob id (immutable → never stale). Derived + disposable.
function titleCachePath(home?: string): string {
  return path.join(home ?? process.env.HOME ?? '/home/runner/workspace', '.canon', 'archived-titles.json');
}
function loadTitleCache(home?: string): { file: string; map: Record<string, string | null> } {
  const file = titleCachePath(home);
  try { return { file, map: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return { file, map: {} }; }
}
function saveTitleCache(c: { file: string; map: Record<string, string | null> }): void {
  try { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, JSON.stringify(c.map)); } catch { /* cache only */ }
}
