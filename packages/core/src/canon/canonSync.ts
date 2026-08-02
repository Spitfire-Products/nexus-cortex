/**
 * canonSync — the canon local-first sync spine, graduated from
 * `scripts/canon/canon-sync.ts` (Phase C part 2; the script is now a thin
 * wrapper over this module, so the cron and the CLI run ONE implementation).
 *
 * Copies changed native session files from every registered harness store into
 * the canon repo's /native/<harness>/ tree, secret-scrubbed at the push
 * boundary only (sovereignty; no deid/quality transforms — egress concerns),
 * then commits + pushes one debounced commit. Oversized JSONL chunks at line
 * boundaries; skips are visible in /native/SKIPPED.md (D8: never silent).
 * Bodies transplanted verbatim from the proven script.
 *
 * @module canon/canonSync
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface CanonSyncOptions {
  /** Canon store working clone (default /tmp/canon-store — off-quota; auto-cloned). */
  store?: string;
  /** Home dir for harness roots + the mtime/size manifest (default $HOME). */
  home?: string;
  /** Report what would copy; write nothing. */
  dryRun?: boolean;
  /** Store remote for the auto-clone (default env CANON_REPO or the canonical repo). */
  repoUrl?: string;
}

export interface CanonSyncResult {
  copied: number;
  unchanged: number;
  skipped: string[];
  chunked: number;
  scrubbedHits: number;
  pushed: boolean;
}

export async function canonSync(o: CanonSyncOptions = {}): Promise<CanonSyncResult> {
  const HOME = o.home ?? process.env.HOME ?? '/home/runner/workspace';
  const DRY = o.dryRun ?? false;
  const STORE = o.store ?? '/tmp/canon-store';
const MANIFEST_PATH = path.join(HOME, '.canon', 'manifest.json');
const MAX_BYTES = 50 * 1024 * 1024; // GitHub hard-rejects >100MB; margin for scrub growth

/** harness label -> { root, include (ext allowlist), maxDepth } */
const SOURCES: Record<string, { root: string; exts: string[] }> = {
  'claude-code':  { root: path.join(HOME, '.claude', 'projects'), exts: ['.jsonl'] },
  'nexus-cortex': { root: '', exts: ['.jsonl', '.json'] }, // multi-root, see below
  'grok-build':   { root: path.join(HOME, '.grok', 'sessions'), exts: ['.jsonl', '.json'] },
  'gemini-cli':   { root: path.join(HOME, '.gemini', 'tmp'), exts: ['.jsonl', '.json'] },
};
const CORTEX_ROOTS: [string, string][] = [
  // workspace-root sessions: cortex CLI runs launched from /home/runner/workspace
  // itself (coverage gap found 2026-07-28 — the grok freeze investigation's
  // sessions lived here, invisible to canon)
  ['workspace', path.join(HOME, '.cortex', 'sessions')],
  ['omniclaude-v4', path.join(HOME, 'omniclaude-v4', '.cortex', 'sessions')],
  ['server', path.join(HOME, 'omniclaude-v4', 'packages', 'server', '.cortex', 'sessions')],
  ['nexus-terminal', path.join(HOME, 'nexus-terminal', '.cortex', 'sessions')],
];

// ── Secret scrub (push-boundary only; patterns = ETL's set MINUS blanket hex64) ──
const SECRET_PATTERNS: [RegExp, string][] = [
  [/sk-[A-Za-z0-9_-]{16,}/g, '[redacted:sk]'],
  [/ghp_[A-Za-z0-9]{20,}/g, '[redacted:ghp]'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, '[redacted:ghpat]'],
  [/ghu_[A-Za-z0-9]{20,}/g, '[redacted:ghu]'],
  [/ghs_[A-Za-z0-9]{20,}/g, '[redacted:ghs]'],
  [/hf_[A-Za-z0-9]{20,}/g, '[redacted:hf]'],
  [/AIza[A-Za-z0-9_-]{20,}/g, '[redacted:aiza]'],
  [/xai-[A-Za-z0-9]{20,}/g, '[redacted:xai]'],
  [/nar_[A-Za-z0-9]{16,}/g, '[redacted:nar]'],
  [/gsk_[A-Za-z0-9]{20,}/g, '[redacted:gsk]'],
  [/xox[bpars]-[A-Za-z0-9-]{10,}/g, '[redacted:slack]'],
  [/AKIA[A-Z0-9]{16}/g, '[redacted:akia]'],
  [/eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, '[redacted:jwt]'],
];
function scrub(s: string): string {
  for (const [re, sub] of SECRET_PATTERNS) s = s.replace(re, sub);
  return s;
}

  const CANON_REPO = o.repoUrl ?? process.env.CANON_REPO ?? 'https://github.com/Spitfire-Products/nexus-canon-store';
if (!fs.existsSync(path.join(STORE, '.git'))) {
  // Working clone is disposable (quota lesson 2026-07-27: keep it OFF the
  // workspace quota — pass --store /tmp/canon-store); remote is the truth.
  console.log(`[canon-sync] no store at ${STORE} — cloning ${CANON_REPO}`);
  execFileSync('git', ['clone', '-q', CANON_REPO, STORE], {
    encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

type Manifest = Record<string, { mtimeMs: number; size: number }>;
const manifest: Manifest = fs.existsSync(MANIFEST_PATH)
  ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  : {};

function* walk(dir: string): Generator<string> {
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

const skipped: string[] = [];
let copied = 0, unchanged = 0, scrubbedHits = 0, chunked = 0;

const PART_BYTES = 25 * 1024 * 1024;

/** Lossless line-boundary chunking: <dest>.part-NNNN files; reassembly = cat in
 *  order. Streams line-by-line (a 200MB read into one string is fine on this box,
 *  but split must respect line boundaries so no record is ever cut). */
function syncChunked(src: string, destRel: string, st: fs.Stats) {
  if (DRY) { chunked++; copied++; return; }
  let content: string;
  try { content = fs.readFileSync(src, 'utf8'); }
  catch (e) { skipped.push(`${destRel} — read failed: ${e}`); return; }
  const out = scrub(content);
  if (out.length !== content.length) scrubbedHits++;
  const destBase = path.join(STORE, 'native', destRel);
  fs.mkdirSync(path.dirname(destBase), { recursive: true });
  // Remove any prior single-file copy (upgraded to parts).
  try { fs.unlinkSync(destBase); } catch { /* none */ }
  let part = 0, offset = 0;
  while (offset < out.length) {
    let end = Math.min(offset + PART_BYTES, out.length);
    if (end < out.length) {
      const nl = out.lastIndexOf('\n', end);
      if (nl > offset) end = nl + 1; // never cut a record
    }
    const partPath = `${destBase}.part-${String(part).padStart(4, '0')}`;
    const slice = out.slice(offset, end);
    // Skip rewriting identical immutable earlier parts (delta-cheap growth).
    const same = fs.existsSync(partPath) && fs.statSync(partPath).size === Buffer.byteLength(slice)
      && fs.readFileSync(partPath, 'utf8') === slice;
    if (!same) fs.writeFileSync(partPath, slice);
    offset = end; part++;
  }
  manifest[destRel] = { mtimeMs: st.mtimeMs, size: st.size };
  chunked++; copied++;
}

function syncFile(src: string, destRel: string) {
  let st: fs.Stats;
  try { st = fs.statSync(src); } catch (e) { skipped.push(`${destRel} — unreadable: ${e}`); return; }
  const key = destRel;
  const prev = manifest[key];
  if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) { unchanged++; return; }
  // Oversized JSONL: chunk at LINE boundaries into ~25MB parts (lossless: cat
  // parts = original; growing sessions only rewrite the LAST part, so git deltas
  // stay cheap). LFS rejected: no delta on growing blobs + 1GB/mo bandwidth cap.
  // Non-splittable oversized files remain visible skips (D8).
  if (st.size > MAX_BYTES) {
    if (src.endsWith('.jsonl')) { syncChunked(src, destRel, st); return; }
    skipped.push(`${destRel} — ${(st.size / 1e6).toFixed(0)}MB > 50MB cap, not line-splittable`);
    manifest[key] = { mtimeMs: st.mtimeMs, size: st.size };
    return;
  }
  const dest = path.join(STORE, 'native', destRel);
  if (!DRY) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let content: string;
    try { content = fs.readFileSync(src, 'utf8'); }
    catch (e) { skipped.push(`${destRel} — read failed: ${e}`); return; }
    const out = scrub(content);
    if (out.length !== content.length) scrubbedHits++;
    fs.writeFileSync(dest, out);
  }
  manifest[key] = { mtimeMs: st.mtimeMs, size: st.size };
  copied++;
}

// claude-code
for (const f of walk(SOURCES['claude-code']!.root)) {
  if (!f.endsWith('.jsonl')) continue;
  syncFile(f, path.join('claude-code', path.relative(SOURCES['claude-code']!.root, f)));
}
// nexus-cortex (multi-root)
for (const [label, root] of CORTEX_ROOTS) {
  for (const f of walk(root)) {
    if (!['.jsonl', '.json'].some((x) => f.endsWith(x))) continue;
    syncFile(f, path.join('nexus-cortex', label, path.relative(root, f)));
  }
}
// grok-build + gemini-cli
for (const h of ['grok-build', 'gemini-cli'] as const) {
  const s = SOURCES[h]!;
  for (const f of walk(s.root)) {
    if (!s.exts.some((x) => f.endsWith(x))) continue;
    syncFile(f, path.join(h, path.relative(s.root, f)));
  }
}

  let pushed = false;
  if (!DRY) {
    // D8: skips are VISIBLE, committed alongside the sync.
    const skipMd = path.join(STORE, 'native', 'SKIPPED.md');
    if (skipped.length) {
      const prev = fs.existsSync(skipMd) ? fs.readFileSync(skipMd, 'utf8') : '# Skipped files (visible, never silent — D8)\n';
      const news = skipped.filter((s) => !prev.includes(s));
      if (news.length) fs.writeFileSync(skipMd, prev + news.map((s) => `- ${new Date().toISOString()} ${s}\n`).join(''));
    }
    fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest));
    const git = (a: string[]) => execFileSync('git', a, { cwd: STORE, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    git(['add', '-A']);
    const status = git(['status', '--porcelain']);
    if (status.trim()) {
      git(['commit', '-q', '-m', `canon-sync: ${copied} file(s) updated, ${skipped.length} skipped`]);
      git(['push', '-q', 'origin', 'main']);
      console.log(`[canon-sync] pushed: ${copied} copied, ${unchanged} unchanged, ${skipped.length} skipped, ${chunked} chunked, ${scrubbedHits} files had secrets scrubbed`);
      pushed = true;
    } else {
      console.log(`[canon-sync] no changes (${unchanged} unchanged, ${skipped.length} previously-skipped)`);
    }
  } else {
    console.log(`[canon-sync DRY] would copy ${copied}, unchanged ${unchanged}, skip ${skipped.length}`);
    for (const s of skipped.slice(0, 10)) console.log('  skip:', s);
  }
  return { copied, unchanged, skipped, chunked, scrubbedHits, pushed };
}
