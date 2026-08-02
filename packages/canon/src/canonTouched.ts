/**
 * canonTouched — the session-content scan behind the graph's `touched` edges.
 *
 * Streams canon session JSONL (parts-aware, readline — sessions run to 170MB+)
 * and extracts the file paths each session's tool calls touched: `file_path` /
 * `notebook_path` from tool_use inputs always (Read/Edit/Write — explicit,
 * EXTRACTED-grade), `path` only when it names a file rather than a directory
 * (Grep/Glob pass dirs). Counts per (session, absolute path).
 *
 * Incremental by construction: results cache at ~/.canon/touched-cache.json
 * keyed by the session's parts signature (size:mtime per part) — a session is
 * re-scanned only when its canon bytes change, so the first graph build pays
 * the full read and every later build is cheap. The cache is derived and
 * disposable (delete = full re-scan).
 *
 * @module canonTouched
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { CanonSession } from './canonPull.js';

export interface TouchedIndex {
  /** session REL (unique — uuids repeat across dual-lineage copies) → absolute file path → touch count */
  byRel: Map<string, Map<string, number>>;
  /** sessions actually re-scanned this run (rest served from cache) */
  scanned: number;
  cached: number;
}

interface CacheEntry { sig: string; files: Record<string, number> }

const looksLikeFile = (p: string): boolean =>
  !p.endsWith('/') && /\.[A-Za-z0-9]{1,8}$/.test(path.basename(p));

/** Extract touched absolute paths from one canon record's tool_use blocks. */
function recordPaths(rec: any, out: Map<string, number>): void {
  const c = rec?.message?.content;
  if (!Array.isArray(c)) return;
  for (const b of c) {
    if (b?.type !== 'tool_use' || !b.input || typeof b.input !== 'object') continue;
    const candidates: string[] = [];
    if (typeof b.input.file_path === 'string') candidates.push(b.input.file_path);
    if (typeof b.input.notebook_path === 'string') candidates.push(b.input.notebook_path);
    if (typeof b.input.path === 'string' && looksLikeFile(b.input.path)) candidates.push(b.input.path);
    for (const p of candidates) {
      if (!p.startsWith('/')) continue; // relative tool paths lack a reliable base — skip
      out.set(p, (out.get(p) ?? 0) + 1);
    }
  }
}

/**
 * Build (or refresh) the touched index for the given sessions.
 * Streams each changed session once; unchanged sessions come from cache.
 */
export async function buildTouchedIndex(
  sessions: CanonSession[],
  opts: { home?: string } = {},
): Promise<TouchedIndex> {
  const home = opts.home ?? process.env.HOME ?? '/home/runner/workspace';
  const cachePath = path.join(home, '.canon', 'touched-cache.json');
  let cache: Record<string, CacheEntry> = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { /* fresh */ }

  const byRel = new Map<string, Map<string, number>>();
  let scanned = 0, cached = 0;

  for (const s of sessions) {
    const sig = s.parts
      .map((p) => { const st = fs.statSync(p); return `${st.size}:${Math.round(st.mtimeMs)}`; })
      .join('|');
    const hit = cache[s.rel];
    if (hit && hit.sig === sig) {
      byRel.set(s.rel, new Map(Object.entries(hit.files)));
      cached++;
      continue;
    }
    const files = new Map<string, number>();
    for (const part of s.parts) {
      const rl = readline.createInterface({ input: fs.createReadStream(part), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.includes('tool_use')) continue; // cheap pre-filter before JSON.parse
        try { recordPaths(JSON.parse(line), files); } catch { /* verify's job */ }
      }
    }
    byRel.set(s.rel, files);
    cache[s.rel] = { sig, files: Object.fromEntries(files) };
    scanned++;
  }

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache));
  return { byRel, scanned, cached };
}
