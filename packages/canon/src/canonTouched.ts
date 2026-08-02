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
  /** tier-3 (Bash command-string parsing) — heuristic, INFERRED-grade; structured evidence wins */
  inferredByRel: Map<string, Map<string, number>>;
  /** sessions actually re-scanned this run (rest served from cache) */
  scanned: number;
  cached: number;
}

interface CacheEntry { sig: string; files: Record<string, number>; inferred?: Record<string, number> }

const looksLikeFile = (p: string): boolean =>
  !p.endsWith('/') && /\.[A-Za-z0-9]{1,8}$/.test(path.basename(p));

/** Strip shell quoting from a token. */
const unquote = (t: string): string => t.replace(/^['"]|['"]$/g, '');

/** Resolve a candidate path against the record's cwd; reject non-paths. */
function resolveCandidate(tok: string, cwd: string | undefined): string | undefined {
  let p = unquote(tok).replace(/[)\]};,:]+$/, '');
  if (!p || p === '-' || p.startsWith('-')) return undefined; // flags
  if (p.startsWith('$') || p.includes('$(') || p.includes('`')) return undefined; // unexpanded
  if (p.startsWith('~/')) return undefined; // $HOME unknown at scan time — skip, not guess
  if (!p.startsWith('/')) {
    if (!cwd || !(p.includes('/') || looksLikeFile(p))) return undefined;
    p = path.join(cwd, p);
  }
  if (p.startsWith('/dev/') || p === '/dev/null' || p.startsWith('/proc/')) return undefined;
  if (!looksLikeFile(p)) return undefined; // extension-bearing files only (conservative)
  return path.normalize(p);
}

/**
 * Tier 3 — parse a Bash `command` string for file paths the command reads or
 * mutates. Deliberately CONSERVATIVE (heuristic ⇒ INFERRED-grade downstream):
 * only unambiguous idioms, only extension-bearing paths, relative paths only
 * when the record carries a cwd, no expansion of variables/substitutions.
 * Idioms: redirection targets (>, >>), tee, sed -i targets, cp/mv source+dest,
 * touch targets, and direct cat/head/tail read args.
 */
export function bashCommandPaths(cmd: string, cwd: string | undefined, out: Map<string, number>): void {
  const add = (tok: string) => {
    const p = resolveCandidate(tok, cwd);
    if (p) out.set(p, (out.get(p) ?? 0) + 1);
  };
  // Preprocess — the two systematic noise sources are heredoc BODIES and
  // quoted inline-code (node -e / python -c), where >, =>, and path-like
  // fragments abound. (1) Truncate at the first heredoc marker: the command
  // line before it (incl. `cat > file <<EOF`) is real shell; the body is not.
  // (2) Strip quoted spans entirely — quoted redirection targets are rare in
  // agent commands, and losing them is the conservative direction.
  let text = cmd;
  const hd = text.search(/<<-?\s*['"]?\w+/);
  if (hd >= 0) text = text.slice(0, hd);
  text = text.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ');

  const TOKEN = String.raw`([^\s;&|<>'"]+)`;
  for (const m of text.matchAll(new RegExp(String.raw`(?<![<>=0-9-])>{1,2}\s*` + TOKEN, 'g'))) add(m[1]!);
  for (const m of text.matchAll(new RegExp(String.raw`\btee\b(?:\s+-a)?\s+` + TOKEN, 'g'))) add(m[1]!);
  // sed -i: after quote-stripping the script arg may be gone or unquoted —
  // add every remaining token of the invocation; resolveCandidate's
  // extension filter drops script/flag tokens naturally.
  for (const m of text.matchAll(/\bsed\s[^;&|]*?-i\S*\s+([^;&|]+)/g)) {
    for (const tok of m[1]!.trim().split(/\s+/)) add(tok);
  }
  for (const m of text.matchAll(new RegExp(String.raw`\b(?:cp|mv)\s+(?:-\S+\s+)*` + TOKEN + String.raw`\s+` + TOKEN, 'g'))) { add(m[1]!); add(m[2]!); }
  for (const m of text.matchAll(new RegExp(String.raw`\btouch\s+` + TOKEN, 'g'))) add(m[1]!);
  for (const m of text.matchAll(new RegExp(String.raw`\b(?:cat|head|tail)\s+(?:-\S+\s+)*` + TOKEN, 'g'))) add(m[1]!);
}

/** Extract touched absolute paths from one canon record. Tiers here:
 *  tier 1 — structured tool_use inputs (Read/Edit/Write file_path etc.);
 *  tier 2 — file-history-snapshot trackedFileBackups: the harness's own
 *  checkpoint tracker, which records EVERY mutated file regardless of
 *  mechanism (incl. Bash heredocs/redirections/sed -i that tier 1 cannot
 *  see). Harness-recorded fact => EXTRACTED-grade; `version` = intensity. */
function recordPaths(rec: any, out: Map<string, number>, inferred: Map<string, number>): void {
  const tf = rec?.snapshot?.trackedFileBackups;
  if (tf && typeof tf === 'object') {
    for (const [key, v] of Object.entries<any>(tf)) {
      let abs = key;
      if (!abs.startsWith('/')) {
        const parent = v?.realParentDir;
        if (typeof parent === 'string' && parent.startsWith('/')) abs = path.join(parent, path.basename(key));
        else continue; // unresolvable relative key — skip rather than guess
      }
      const w = typeof v?.version === 'number' && v.version > 0 ? v.version : 1;
      out.set(abs, Math.max(out.get(abs) ?? 0, w));
    }
  }
  const c = rec?.message?.content;
  if (!Array.isArray(c)) return;
  for (const b of c) {
    if (b?.type !== 'tool_use' || !b.input || typeof b.input !== 'object') continue;
    const candidates: string[] = [];
    if (typeof b.input.file_path === 'string') candidates.push(b.input.file_path);
    if (typeof b.input.notebook_path === 'string') candidates.push(b.input.notebook_path);
    if (typeof b.input.path === 'string' && looksLikeFile(b.input.path)) candidates.push(b.input.path);
    if (typeof b.input.command === 'string') bashCommandPaths(b.input.command, typeof rec.cwd === 'string' ? rec.cwd : undefined, inferred);
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
  const inferredByRel = new Map<string, Map<string, number>>();
  let scanned = 0, cached = 0;

  for (const s of sessions) {
    // Sidecar participates in the signature: tier 2b mines file-history-delta
    // events from <session>.events.jsonl, so sidecar changes must invalidate.
    const logicalAbs = s.parts[0]!.replace(/\.part-\d{4}$/, '');
    const sidecar = logicalAbs.replace(/\.jsonl$/, '.events.jsonl');
    let sidecarSig = '0:0';
    try { const st = fs.statSync(sidecar); sidecarSig = `${st.size}:${Math.round(st.mtimeMs)}`; } catch { /* none */ }
    const sig = 'v4|' + s.parts
      .map((p) => { const st = fs.statSync(p); return `${st.size}:${Math.round(st.mtimeMs)}`; })
      .join('|') + '|' + sidecarSig;
    const hit = cache[s.rel];
    if (hit && hit.sig === sig) {
      byRel.set(s.rel, new Map(Object.entries(hit.files)));
      inferredByRel.set(s.rel, new Map(Object.entries(hit.inferred ?? {})));
      cached++;
      continue;
    }
    const files = new Map<string, number>();
    const inferred = new Map<string, number>();
    for (const part of s.parts) {
      const rl = readline.createInterface({ input: fs.createReadStream(part), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.includes('tool_use') && !line.includes('trackedFileBackups')) continue; // cheap pre-filter
        try { recordPaths(JSON.parse(line), files, inferred); } catch { /* verify's job */ }
      }
    }
    // Tier 2b — file-history-delta sidecar events: the harness's per-file
    // change tracker fires for ANY mutation of a tracked file, including
    // Bash/interpreter-body writes tier 3 cannot see. Harness-recorded fact
    // => EXTRACTED-grade; one count per delta event.
    if (fs.existsSync(sidecar)) {
      const rl2 = readline.createInterface({ input: fs.createReadStream(sidecar), crlfDelay: Infinity });
      for await (const line of rl2) {
        if (!line.includes('file-history-delta')) continue;
        try {
          const r = JSON.parse(line);
          const p = r?.trackingPath;
          if (typeof p === 'string' && p.startsWith('/')) files.set(p, (files.get(p) ?? 0) + 1);
        } catch { /* verify's job */ }
      }
    }
    for (const k of files.keys()) inferred.delete(k); // structured evidence wins
    byRel.set(s.rel, files);
    inferredByRel.set(s.rel, inferred);
    cache[s.rel] = { sig, files: Object.fromEntries(files), inferred: Object.fromEntries(inferred) };
    scanned++;
  }

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache));
  return { byRel, inferredByRel, scanned, cached };
}
