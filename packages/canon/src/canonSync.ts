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
import { requireCanonRepo, redactRepoUrl, canonGit, guardedAddAll, atomicClone, guardedPush } from './canonRepo.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
    // .md rides too: the per-project auto-memory (memory/MEMORY.md + topic
    // files) is the continuity layer a handoff needs — sessions without the
    // memories that interpret them are half a handoff. Secret-scrubbed like
    // everything else; canonTranslate ignores non-.jsonl natives.
    'claude-code': { exts: ['.jsonl', '.md'], roots: [path.join(H, '.claude', 'projects')] },
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
    // Decision stores ride canon BY DEFAULT (data-lake rule, 2026-08-25):
    // sessions alone mislabel exit-masked failures as successes (wire is_error
    // is false for failing bash) and strip post-persist steering causes
    // (loop_escalation / gate-fallback / inaction event rows live ONLY here).
    // File roots — the sync loop handles single-file roots directly.
    'nexus-cortex-decisions': {
      exts: ['.jsonl'],
      roots: [
        { label: 'workspace', path: path.join(H, '.cortex', 'decisions.jsonl') },
        { label: 'omniclaude-v4', path: path.join(H, 'omniclaude-v4', '.cortex', 'decisions.jsonl') },
        { label: 'server', path: path.join(H, 'omniclaude-v4', 'packages', 'server', '.cortex', 'decisions.jsonl') },
        { label: 'nexus-terminal', path: path.join(H, 'nexus-terminal', '.cortex', 'decisions.jsonl') },
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
  // (?<![.\d]) / (?!\.\d): \b treats '.' as a boundary, so the FRACTION digits of
  // a float ("cacheHitRate":0.4106091035703747) matched the Visa pattern and the
  // redaction TORE the JSON line (store-verify failures 2026-08-14). A card number
  // never sits directly after a decimal point or continues into one.
  [/(?<![.\d])(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b(?!\.\d)/g, '[redacted:cc]'],
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
    // Atomic clone (temp dir + rename): the store path never holds a .git over
    // a partial checkout, so a concurrent canon verb can't operate on (and
    // commit!) a half tree — the 08-18/08-20 mass-deletion race. Auth-failure
    // hint (`could not read Username`/401 = missing/REVOKED GH_TOKEN; hosted:
    // re-save the canon store in CORTEX -> Connections) surfaces from the
    // helper's redacted error line.
    atomicClone(CANON_REPO, STORE, 'canon-sync');
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
      let out = scrub(probe.content);
      if (out.length !== probe.content.length) scrubbedHits++;
      // POST-scrub re-probe: a scrub pattern that mangles JSON (the 2026-08-14
      // cc-vs-float incident) is a SCRUB BUG, not a writer race — flag loudly
      // and ship the parseable prefix so the store never fails verify; the
      // manifest still advances (retrying would loop forever on a scrub bug).
      if (src.endsWith('.jsonl')) {
        const post = probeJsonl(out, `${destRel} (POST-SCRUB — scrub-pattern bug, report it)`);
        if (post.torn) out = post.content;
      }
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
      // A root may be a single FILE (e.g. .cortex/decisions.jsonl) — sync it
      // directly; walk() only descends directories.
      let rootIsFile = false;
      try { rootIsFile = fs.statSync(rootPath).isFile(); } catch { /* absent */ }
      if (rootIsFile) {
        if (src.exts.some((x) => rootPath.endsWith(x))) {
          syncFile(rootPath, path.join(label, sub, path.basename(rootPath)));
        }
        continue;
      }
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
    // CHUNK-GATE HOLE (2026-08-17 incident): canonTranslate stages output as
    // `<dest>.jsonl.tmp` INSIDE the store; a mid-write kill orphans it, and the
    // blanket `git add -A` below then commits the oversized artifact (147MB tmp
    // → GitHub 100MB push rejection; required collapsing 30 store commits).
    // The syncFile chunk gate never sees it — it isn't a harness source file.
    // Guard both ways: (a) keep `*.tmp` out of the index via the store
    // .gitignore; (b) purge stale staging files (>10 min old — a live translate
    // in the same pipeline pass is younger) so the tree stays clean.
    try {
      const giPath = path.join(STORE, '.gitignore');
      const gi = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
      if (!gi.split('\n').some((l) => l.trim() === '*.tmp')) {
        fs.writeFileSync(giPath, (gi && !gi.endsWith('\n') ? gi + '\n' : gi) + '*.tmp\n');
      }
      const purgeStaleTmp = (dir: string): void => {
        let entries: fs.Dirent[] = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (e.name === '.git') continue;
          const p = path.join(dir, e.name);
          if (e.isDirectory()) { purgeStaleTmp(p); continue; }
          if (!e.name.endsWith('.tmp')) continue;
          try {
            if (Date.now() - fs.statSync(p).mtimeMs > 10 * 60 * 1000) {
              fs.unlinkSync(p);
              console.warn(`[canon-sync] purged stale staging file: ${path.relative(STORE, p)}`);
            }
          } catch { /* raced away — fine */ }
        }
      };
      purgeStaleTmp(STORE);
    } catch { /* guard must never block the sync */ }
    // MASS-DELETION GUARD (incidents 3ee5fa95 + 3949c39d — the second one came
    // through the TRANSLATE commit path while only sync was guarded): shared
    // guardedAddAll refuses to commit a staged set with >10 deletions (partial
    // clone/checkout tree). ALL canon commit paths stage through it now.
    const stageOk = guardedAddAll(git, 'canon-sync');
    if (!stageOk && git(['status', '--porcelain']).trim()) {
      skipped.push('COMMIT ABORTED — mass-deletion guard (staged deletions reset)');
    } else if (stageOk) {
      git(['commit', '-q', '-m', `canon-sync: ${copied} file(s) updated, ${skipped.length} skipped`]);
      pushed = guardedPush(git, 'canon-sync');
      if (pushed) console.log(`[canon-sync] pushed: ${copied} copied, ${unchanged} unchanged, ${skipped.length} skipped, ${chunked} chunked, ${scrubbedHits} files had secrets scrubbed`);
      else console.log(`[canon-sync] committed locally, push deferred to next cycle: ${copied} copied, ${unchanged} unchanged, ${skipped.length} skipped, ${chunked} chunked, ${scrubbedHits} files had secrets scrubbed`);
    } else {
      console.log(`[canon-sync] no changes (${unchanged} unchanged, ${skipped.length} previously-skipped)`);
    }
  } else {
    console.log(`[canon-sync DRY] would copy ${copied}, unchanged ${unchanged}, skip ${skipped.length}`);
    for (const s of skipped.slice(0, 10)) console.log('  skip:', s);
  }
  return { copied, unchanged, skipped, chunked, scrubbedHits, pushed };
}
