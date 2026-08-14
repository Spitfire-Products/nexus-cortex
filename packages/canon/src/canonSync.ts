/**
 * canonSync — the canon local-first sync spine, graduated from
 * `scripts/canon/canon-sync.ts` (Phase C part 2; the script is a thin wrapper
 * over this module, so the cron and the CLI run ONE implementation).
 *
 * Copies changed native session files from every declared harness source into
 * the canon repo's /native/<harness>/ tree, secret-scrubbed at the push
 * boundary only (sovereignty; no deid/quality transforms — egress concerns),
 * then commits + pushes one debounced commit. Oversized JSONL chunks at line
 * boundaries; skips are visible in /native/SKIPPED.md (D8: never silent).
 *
 * Capture sources are DECLARATIVE: built-in defaults cover this environment,
 * and `<store>/HARNESSES.json` overrides/extends them — adding a harness (or
 * another machine's layout) is config, not code.
 *
 * @module canon/canonSync
 */
import { requireCanonRepo, redactRepoUrl, gitAuthArgs, canonGit } from './canonRepo.js';
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
  /** Store remote for the auto-clone (or env CANON_REPO). Unconfigured + no store = fail-fast. */
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

/**
 * Harness capture sources — DECLARATIVE. Defaults below cover this
 * environment; `<store>/HARNESSES.json` overrides/extends them:
 *   { "harnesses": { "<label>": { "exts": [".jsonl"],
 *       "roots": ["~/.claude/projects"]
 *              | [{"label":"workspace","path":"~/.cortex/sessions"}] } } }
 * `~` expands to $HOME. Labeled roots nest under /native/<harness>/<label>/.
 */
export interface HarnessSource { exts: string[]; roots: (string | { label: string; path: string })[] }

function defaultHarnessSources(H: string): Record<string, HarnessSource> {
  return {
    'claude-code': { exts: ['.jsonl'], roots: [path.join(H, '.claude', 'projects')] },
    'nexus-cortex': {
      exts: ['.jsonl', '.json'],
      roots: [
        // workspace-root sessions: cortex CLI runs launched from $HOME itself
        // (coverage gap found 2026-07-28 — sessions there were invisible).
        { label: 'workspace', path: path.join(H, '.cortex', 'sessions') },
        { label: 'omniclaude-v4', path: path.join(H, 'omniclaude-v4', '.cortex', 'sessions') },
        { label: 'server', path: path.join(H, 'omniclaude-v4', 'packages', 'server', '.cortex', 'sessions') },
        { label: 'nexus-terminal', path: path.join(H, 'nexus-terminal', '.cortex', 'sessions') },
      ],
    },
    'grok-build': { exts: ['.jsonl', '.json'], roots: [path.join(H, '.grok', 'sessions')] },
    'gemini-cli': { exts: ['.jsonl', '.json'], roots: [path.join(H, '.gemini', 'tmp')] },
  };
}

export function loadHarnessSources(store: string, H: string): Record<string, HarnessSource> {
  const sources = defaultHarnessSources(H);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(store, 'HARNESSES.json'), 'utf8'));
    for (const [label, h] of Object.entries<any>(cfg.harnesses ?? {})) {
      const expand = (p: string) => (p.startsWith('~/') ? path.join(H, p.slice(2)) : p);
      sources[label] = {
        exts: h.exts ?? ['.jsonl'],
        roots: (h.roots ?? []).map((r: any) =>
          typeof r === 'string' ? expand(r) : { label: r.label, path: expand(r.path) }),
      };
    }
  } catch { /* optional config */ }
  return sources;
}

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
  // Financial / PII (DBPEN 2026-08-08 flagged an unscrubbed value in the browser
  // canon FS). Card-prefix-anchored so we don't shred arbitrary long digit runs in
  // the lossless canon line: Visa / Mastercard(51-55) / Amex(34,37) / Discover(6011,65).
  [/\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g, '[redacted:cc]'],
  // US SSN (dash form only — bare 9-digit runs are too false-positive-prone to scrub).
  [/\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b/g, '[redacted:ssn]'],
];
function scrub(s: string): string {
  for (const [re, sub] of SECRET_PATTERNS) s = s.replace(re, sub);
  return s;
}

/**
 * The push-boundary secret-scrub, exported so DERIVED layers that surface
 * session-content-derived strings into shareable artifacts (e.g. the graph's
 * cognition dimension, whose thought labels are drawn from thinking text) route
 * through the SAME pattern set — one scrub authority, never a per-layer fork.
 */
export function scrubSecrets(s: string): string {
  return scrub(s);
}

export async function canonSync(o: CanonSyncOptions = {}): Promise<CanonSyncResult> {
  const HOME = o.home ?? process.env.HOME ?? '/home/runner/workspace';
  const DRY = o.dryRun ?? false;
  const STORE = o.store ?? '/tmp/canon-store';
  const MANIFEST_PATH = path.join(HOME, '.canon', 'manifest.json');
  const MAX_BYTES = 50 * 1024 * 1024; // GitHub hard-rejects >100MB; margin for scrub growth
  const PART_BYTES = 25 * 1024 * 1024;

  if (!fs.existsSync(path.join(STORE, '.git'))) {
    // Working clone is disposable (quota lesson 2026-07-27: keep it OFF the
    // workspace quota — pass --store /tmp/canon-store); remote is the truth.
    const CANON_REPO = requireCanonRepo(o.repoUrl, STORE, 'canon-sync');
    console.log(`[canon-sync] no store at ${STORE} — cloning ${redactRepoUrl(CANON_REPO)}`);
    try {
      // stdio piped: git's stderr must NEVER bleed into the host terminal (an
      // interactive PTY renders it as corruption); captured on the error instead.
      execFileSync('git', [...gitAuthArgs(), 'clone', '-q', CANON_REPO, STORE], {
        encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      // Surface an ACTIONABLE, redacted failure line (console → CANON_LOG_FILE in
      // hosted mode) instead of the previous silent forever-retry. The classic
      // signature `could not read Username` / 401 = missing OR REVOKED token —
      // in the hosted flow that means the vault credential is stale: re-save the
      // canon store in CORTEX -> Connections ("Save for hosted sessions").
      const stderr = redactRepoUrl(String((e as { stderr?: string }).stderr ?? (e as Error).message ?? e));
      const hint = /could not read Username|Authentication failed|401|403/.test(stderr)
        ? ' — token missing/invalid (GH_TOKEN). Hosted: re-save the canon store in CORTEX -> Connections (Save for hosted sessions) and reconnect.'
        : '';
      console.error(`[canon-sync] clone FAILED: ${stderr.trim().split('\n').pop()}${hint}`);
      throw e;
    }
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
  let copied = 0, unchanged = 0, scrubbedHits = 0, chunked = 0, tornTrimmed = 0;

  /** Sync-time parse probe (2026-08-14 — "torn snapshot" fix). A live writer can
   *  be mid-line when sync reads a session file; copying that tear poisons the
   *  store (36 torn snapshots broke the translate leg on every cron until a
   *  hand-repair sweep). Probe every line of a .jsonl source: on the FIRST
   *  unparseable line, keep only the valid prefix (store stays parseable) and
   *  signal the caller to NOT advance the manifest — the next cycle re-copies
   *  the completed file. A mid-file tear (source corruption) behaves the same:
   *  valid prefix now, retry forever until the source heals or is trimmed. */
  function probeJsonl(content: string, destRel: string): { content: string; torn: boolean } {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (!l.trim()) continue;
      try { JSON.parse(l); } catch {
        const prefix = lines.slice(0, i).join('\n');
        console.log(`[canon-sync] torn line ${i + 1} in ${destRel} — kept ${i}-line valid prefix, will retry next cycle`);
        tornTrimmed++;
        return { content: prefix.length ? prefix + '\n' : '', torn: true };
      }
    }
    return { content, torn: false };
  }

  /** Lossless line-boundary chunking: <dest>.part-NNNN files; reassembly = cat in
   *  order. Streams line-by-line (a 200MB read into one string is fine on this box,
   *  but split must respect line boundaries so no record is ever cut). */
  function syncChunked(src: string, destRel: string, st: fs.Stats) {
    if (DRY) { chunked++; copied++; return; }
    let content: string;
    try { content = fs.readFileSync(src, 'utf8'); }
    catch (e) { skipped.push(`${destRel} — read failed: ${e}`); return; }
    const probe = probeJsonl(content, destRel);
    const out = scrub(probe.content);
    if (out.length !== probe.content.length) scrubbedHits++;
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
    // Torn tail → manifest NOT advanced, so the completed file re-copies next cycle.
    if (!probe.torn) manifest[destRel] = { mtimeMs: st.mtimeMs, size: st.size };
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
      const probe = src.endsWith('.jsonl') ? probeJsonl(content, destRel) : { content, torn: false };
      const out = scrub(probe.content);
      if (out.length !== probe.content.length) scrubbedHits++;
      fs.writeFileSync(dest, out);
      // Torn tail → manifest NOT advanced (recopy next cycle picks up the completed file).
      if (probe.torn) { copied++; return; }
    }
    manifest[key] = { mtimeMs: st.mtimeMs, size: st.size };
    copied++;
  }

  // Generic capture over the declared sources.
  const HARNESS_SOURCES = loadHarnessSources(STORE, HOME);
  for (const [label, src] of Object.entries(HARNESS_SOURCES)) {
    for (const r of src.roots) {
      const rootPath = typeof r === 'string' ? r : r.path;
      const sub = typeof r === 'string' ? '' : r.label;
      for (const f of walk(rootPath)) {
        if (!src.exts.some((x) => f.endsWith(x))) continue;
        syncFile(f, path.join(label, sub, path.relative(rootPath, f)));
      }
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
    const git = canonGit(STORE, 'canon-sync');
    // BROWSER-BRANCH INTEGRATION: each browser SPA pushes its own
    // `browser-cortex-<id>` branch (its in-browser repo has UNRELATED history, so
    // it can never fast-forward main — and force would clobber the store). Fold
    // each branch's /native/browser-cortex/ tree into main's working tree here,
    // where real git lives; the add/commit/push below carries it into main.
    try {
      const heads = git(['ls-remote', '--heads', 'origin', 'browser-cortex-*']);
      for (const line of heads.split('\n')) {
        const m = line.match(/refs\/heads\/(browser-cortex-[A-Za-z0-9_-]+)$/);
        if (!m) continue;
        try {
          git(['fetch', '--depth', '1', 'origin', m[1]!]);
          git(['checkout', 'FETCH_HEAD', '--', 'native/browser-cortex']);
          console.log(`[canon-sync] integrated browser branch ${m[1]}`);
        } catch (e) {
          console.warn(`[canon-sync] browser branch ${m[1]} integration failed: ${(e as Error)?.message ?? e}`);
        }
      }
      // Torn-tail probe over the FOLDED tree: the checkout path above bypasses
      // syncFile's probe entirely, so a torn line pushed by a browser SPA would
      // enter main unprobed. Trim to the valid prefix BEFORE the add/commit; the
      // browser branch keeps its own full copy, so the next fold-in re-checkouts
      // the file and the completed line lands then (same retry semantics as the
      // manifest skip on the harness path).
      const bcRoot = path.join(STORE, 'native', 'browser-cortex');
      const walkBc = (dir: string): void => {
        let entries: fs.Dirent[] = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) { walkBc(p); continue; }
          const partMatch = e.name.match(/^(.*\.jsonl)\.part-(\d{4})$/);
          if (!e.name.endsWith('.jsonl') && !partMatch) continue;
          const rel = path.relative(STORE, p);
          const probe = probeJsonl(fs.readFileSync(p, 'utf8'), rel);
          if (!probe.torn) continue;
          // A tear is only trimmable at the END of a logical file: single-form
          // .jsonl, or the LAST part of a chunk group. Trimming a MIDDLE part
          // would corrupt reassembly — leave it (visible in translate errors,
          // heals when the browser re-pushes).
          const isMiddlePart = !!partMatch && fs.existsSync(
            path.join(dir, `${partMatch[1]}.part-${String(Number(partMatch[2]) + 1).padStart(4, '0')}`));
          if (isMiddlePart) {
            console.warn(`[canon-sync] torn MIDDLE part left untrimmed (reassembly safety): ${rel}`);
            continue;
          }
          fs.writeFileSync(p, probe.content);
        }
      };
      walkBc(bcRoot);
    } catch { /* no browser branches yet / offline — nothing to integrate */ }
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
