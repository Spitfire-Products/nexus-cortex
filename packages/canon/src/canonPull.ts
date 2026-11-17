/**
 * canonPull — the canon rehydration leg, graduated from
 * `scripts/canon/canon-pull.ts` (Phase C part 2; the script is now a thin
 * wrapper over this module).
 *
 * Materializes a canon session into the RECEIVING harness's native session
 * directory, where that harness's own resume UI already looks — no proxy
 * layer, the filesystem is the interface. For nexus-cortex the projection is
 * identity (canon IS the cortex dialect): pull = freshen store + reassemble
 * parts + copy. Pull refuses to overwrite an existing local session unless
 * forced — resuming elsewhere is a BRANCH of the canonical line, never a
 * clobber. Discovery/materialization bodies transplanted from the proven
 * script; exit codes become return codes for library use.
 *
 * @module canon/canonPull
 */
import { defaultCanonStore } from './storePath.js';
import { sidecarFiles } from './sidecar.js';
import { groupChunkFiles, logicalPathOf, orderChunks, segmentBytesOfFiles, segmentLinesOfStream, segmentsOfFiles, segmentsOfStream, renderSegments, type SegmentMeta } from './canonSegments.js';
import { discoverArchivedCanonSessions, sessionLines } from './canonArchiveRead.js';
import { requireCanonRepo, redactRepoUrl, canonGit, atomicClone, gitAuthArgs, withStoreLock } from './canonRepo.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { renderCapsule, renderCompat, sessionToolCalls, sessionToolNames, toolCompatibility, type HarnessName } from './canonTools.js';

export interface CanonStoreOptions {
  /** Canon store working clone (default: defaultCanonStore() in storePath.ts — CANON_STORE, an existing /tmp/canon-store, else ~/.cache/nexus-canon/store; auto-cloned). */
  store?: string;
  /** Store remote for the auto-clone (or env CANON_REPO). Unconfigured + no store = fail-fast. */
  repoUrl?: string;
}

export interface CanonSession {
  uuid: string;
  rel: string;
  parts: string[];
  bytes: number;
  harness: string;
  title?: string;
  /** Set for a session read from the store's archive/ history (not on disk) — see canonArchiveRead.ts. */
  archived?: import('./canonArchiveRead.js').ArchivedSessionRef;
}

export interface CanonPullOptions extends CanonStoreOptions {
  /** Session uuid (or unique prefix) to materialize. */
  session: string;
  /** Target harness for the tool-compatibility report (default nexus-cortex — where pull lands). */
  target?: HarnessName;
  /** Destination directory (default <cwd>/.cortex/sessions — the current project's sessions dir). */
  to?: string;
  /** Overwrite an existing local session file (default false — pull is a branch, never a clobber). */
  force?: boolean;
  /**
   * G1 (signature portability): strip provider thinking signatures from the
   * MATERIALIZED COPY — thinking blocks become `<prior_reasoning>` text (the
   * harness's own text-fallback convention), redacted_thinking is dropped.
   * Use when pulling a session recorded under a DIFFERENT provider account/org
   * (signatures validate against the originating org; foreign replay fails).
   * The canonical line in the store is never modified — pull is a branch.
   */
  stripSignatures?: boolean;
  /** Exact canon rel path (e.g. claude-code/<dir>/<uuid>.jsonl) — pins one copy when a uuid is stored under several dirs. */
  rel?: string;
  /** Only consider copies stored under this harness (claude-code, nexus-cortex, …). */
  harness?: string;
  home?: string;
  /** Materialize only this compaction window (canonSegments) as `<uuid>.seg-NNNN.jsonl` instead of the whole session. */
  segment?: number;
}

export interface CanonPullResult {
  /** 0 = materialized; 1 = not found / ambiguous / exists-without-force. */
  code: 0 | 1;
  dest?: string;
  session?: CanonSession;
}

/** Clone the store if absent, else pull — rehydrate freshness on arrival. */
/**
 * Bring the store up to date before a read — UNDER the single-writer lock (2026-11-15). Two reads that pulled at once raced on
 * refs/remotes/origin/main and the loser left a 555 MB orphan tmp_pack that filled the disk quota. When another canon writer holds the
 * lock (a sync, a watcher cycle, another read's pull), that writer is already updating the store: this read uses the store as it is
 * instead of waiting or pulling twice. A missing store is still cloned (nothing to read otherwise).
 */
async function ensureFreshStore(store: string, repoUrl?: string, label = 'canon-pull'): Promise<void> {
  const fresh = async () => {
    if (!fs.existsSync(path.join(store, '.git'))) {
      const repo = requireCanonRepo(repoUrl, store, label);
      console.log(`[${label}] no store at ${store} — cloning ${redactRepoUrl(repo)}`);
      atomicClone(repo, store, label); // 09-26: shared clone — partial + archive/ excluded (was a raw full clone)
    } else {
      canonGit(store, label)(['pull', '-q', 'origin', 'main']);
    }
  };
  if (!fs.existsSync(path.join(store, '.git'))) { await fresh(); return; }
  await withStoreLock(store, label, fresh, () => { console.log(`[${label}] another canon writer is updating the store — reading it as it is`); }, 0);
}

/**
 * ARCHIVED-SESSION PULL (2026-09-26). The local store excludes `archive/` (canonArchive + the clone exclusion), so an
 * archived session is not on disk and the file-walking discovery below cannot see it. This finds the session in HEAD's
 * `archive/YYYY-MM/<section>/…` tree, writes just its files into a temp root with the SAME layout (`<root>/<section>/…`)
 * — git fetches the blobs on demand in a partial clone — and returns the root so the unchanged discovery/placement logic
 * runs against it. Caller deletes the root. Returns null when nothing archived matches.
 */
export function hydrateArchived(store: string, section: 'canon' | 'native', session: string, label: string): string | null {
  let listing = '';
  try {
    listing = execFileSync('git', ['-C', store, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'archive/'], {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { return null; }
  const re = /^archive\/\d{4}-\d{2}\/(canon|native)\/(.+)$/;
  const hits: Array<{ src: string; rel: string }> = [];
  for (const p of listing.split('\n')) {
    const m = p.match(re);
    if (!m || m[1] !== section) continue;
    if (m[2]!.split('/').some((seg) => seg.startsWith(session))) hits.push({ src: p, rel: m[2]! });
  }
  if (hits.length === 0) return null;
  if (hits.length > 200) {
    console.error(`[${label}] '${session}' matches ${hits.length} archived files — give more of the uuid`);
    return null;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-archived-'));
  for (const h of hits) {
    const dest = path.join(root, section, h.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const buf = execFileSync('git', [...gitAuthArgs(), '-C', store, 'cat-file', 'blob', `HEAD:${h.src}`], {
      maxBuffer: 1024 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    fs.writeFileSync(dest, buf);
  }
  console.log(`[${label}] '${session}' is archived — fetched ${hits.length} file(s) from the store history`);
  return root;
}

/** Count archived sessions of a section (main .jsonl files) without fetching content. */
export function countArchived(store: string, section: 'canon' | 'native'): number {
  try {
    const out = execFileSync('git', ['-C', store, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'archive/'], {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const live = new Set(execFileSync('git', ['-C', store, 'ls-tree', '-r', '--name-only', 'HEAD', '--', `${section}/`], {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }).split('\n').map((l) => logicalPathOf(l.replace(new RegExp(`^${section}/`), ''))));
    const mains = new Set<string>();
    for (const p of out.split('\n')) {
      const m = p.match(/^archive\/\d{4}-\d{2}\/(canon|native)\/(.+?\.jsonl)(\.seg-\d{4,}\.part-\d{4,}|\.part-\d{4,})?$/);
      // Archived-only sessions: a copy also present in the live tree is already listed above.
      if (m && m[1] === section && !m[2]!.endsWith('.events.jsonl') && !live.has(m[2]!)) mains.add(m[2]!);
    }
    return mains.size;
  } catch { return 0; }
}

/** Discover canon sessions (part-aware; titles recovered from event sidecars). */
export function discoverCanonSessions(store: string): CanonSession[] {
  const root = path.join(store, 'canon');
  const groups = new Map<string, string[]>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;
      const logical = logicalPathOf(p); // both layouts: size parts and segmented sub-chunks (canonSegments)
      if (!logical.endsWith('.jsonl') || logical.endsWith('.events.jsonl')) continue;
      const g = groups.get(logical) ?? [];
      g.push(p);
      groups.set(logical, g);
    }
  };
  walk(root);
  const out: CanonSession[] = [];
  for (const [logical, files] of groups) {
    const parts = orderChunks(files);
    const rel = path.relative(root, logical);
    let uuid = path.basename(rel, '.jsonl');
    // Dir-per-session envelopes (grok-build: <uuid>/chat_history.jsonl) name
    // the session by DIRECTORY; adopt the parent when the basename isn't
    // uuid-ish and the parent is. (claude-code subagents live under a
    // 'subagents' dir — non-uuid parent — and keep their basename ids.)
    const parent = path.basename(path.dirname(rel));
    if (!/^[0-9a-f]{8}-/i.test(uuid) && /^[0-9a-f]{8}-[0-9a-f-]{10,}$/i.test(parent)) uuid = parent;
    const bytes = parts.reduce((n, p) => n + fs.statSync(p).size, 0);
    if (bytes === 0) continue; // empty canon mains (telemetry-only grok sessions) — nothing to pull
    let title: string | undefined;
    for (const eventsPath of sidecarFiles(logical)) {
      for (const line of fs.readFileSync(eventsPath, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const r = JSON.parse(line); if (r.type === 'ai-title' && r.aiTitle) title = r.aiTitle; } catch { /* skip */ }
      }
    }
    out.push({ uuid, rel, parts, bytes, harness: rel.split(path.sep)[0] ?? '?', title });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** List canon sessions (prints rows; returns them). `all` includes <4KB sessions. */
export async function canonList(o: CanonStoreOptions & { all?: boolean } = {}): Promise<CanonSession[]> {
  const store = o.store ?? defaultCanonStore();
  await ensureFreshStore(store, o.repoUrl);
  const sessions = discoverCanonSessions(store);
  const rows = sessions.filter((s) => o.all || s.bytes > 4096);
  for (const s of rows) {
    const kb = (s.bytes / 1024).toFixed(0).padStart(7);
    console.log(`${s.uuid}  ${kb}KB  ${s.harness.padEnd(12)}  ${s.title ?? ''}`);
  }
  console.log(`\n[canon-pull] ${rows.length} session(s)${o.all ? '' : ' >4KB (--all for every one)'} in ${store}/canon`);
  const archived = countArchived(store, 'canon');
  if (archived) console.log(`[canon-pull] + ${archived} archived session(s) not listed — \`canon pull <uuid>\` still materializes them from the store history`);
  return rows;
}

/**
 * G1 signature-strip on a materialized session file (pull-side lossy projection,
 * explicit and counted — never silent). Thinking blocks (signed or not) become
 * the harness text-fallback shape `<prior_reasoning>…</prior_reasoning>` — same
 * convention as THINKING_AS_TEXT_FALLBACK — so a foreign-org replay can never
 * hit signature validation; `redacted_thinking` (opaque, org-bound) is dropped.
 * Unparseable lines pass through verbatim.
 */
export function stripThinkingSignatures(file: string): { stripped: number; dropped: number } {
  let stripped = 0, dropped = 0;
  const out = fs.readFileSync(file, 'utf8').split('\n').map((line) => {
    if (!line.trim()) return line;
    try {
      const rec = JSON.parse(line);
      const content = rec?.message?.content;
      if (!Array.isArray(content)) return line;
      let changed = false;
      const blocks = content.flatMap((b: any) => {
        if (b?.type === 'thinking' && typeof b.thinking === 'string') {
          stripped++; changed = true;
          return [{ type: 'text', text: `<prior_reasoning>\n${b.thinking}\n</prior_reasoning>` }];
        }
        if (b?.type === 'redacted_thinking') { dropped++; changed = true; return []; }
        return [b];
      });
      if (!changed) return line;
      // A message left empty by dropping its only (redacted) block keeps a stub —
      // an empty content array is invalid on replay.
      rec.message.content = blocks.length ? blocks : [{ type: 'text', text: '[canon G1: redacted thinking removed for foreign-account replay]' }];
      return JSON.stringify(rec);
    } catch { return line; }
  });
  fs.writeFileSync(file, out.join('\n'));
  return { stripped, dropped };
}

// ── Native pull (reverse materialization) ────────────────────────────────────

export interface CanonPullNativeOptions extends CanonStoreOptions {
  /** Session uuid (or unique prefix) to materialize from /native. */
  session: string;
  /** Restrict the uuid match to one harness (native tree top-level dir). */
  harness?: string;
  /** Pin the match to one exact store-relative main file (disambiguates
   *  duplicate uuids across project dirs — the bulk loop always passes it). */
  rel?: string;
  /**
   * Destination PROJECT DIRECTORY — the dir that holds `<uuid>.jsonl` (+ the
   * `<uuid>/` sidecar tree). Default for claude-code sessions:
   * `~/.claude/projects/<original-project-slug>/` — where `claude --resume`
   * already looks. Other harnesses have no safe default yet and require --to.
   */
  to?: string;
  /**
   * Re-home the session under a DIFFERENT project cwd: the destination slug is
   * derived from this path (Claude Code derives its per-project dir from the
   * cwd with every non-alphanumeric char replaced by '-'), so the session shows
   * up in `claude --resume`'s picker when run from THAT directory. Ignored when
   * --to is given.
   */
  project?: string;
  /** Overwrite existing destination files (default false — pull is a branch). */
  force?: boolean;
  home?: string;
  /** Materialize only this compaction window of the main transcript (byte-exact) as `<uuid>.seg-NNNN.jsonl`. */
  segment?: number;
}

export interface CanonPullNativeResult {
  code: 0 | 1;
  /** Directory the session landed in. */
  destDir?: string;
  /** Materialized logical files (dest paths). */
  files?: string[];
  harness?: string;
}

/** Claude Code's project-dir slug: cwd with each non-alphanumeric char → '-'. */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Materialize a session's NATIVE files (byte-exact, part-reassembled) from the
 * store's /native tree into the target harness's own session location — the
 * reverse leg of canon capture. For claude-code the store layout mirrors
 * `~/.claude/projects/<slug>/…`, so a native pull IS a `claude --resume`-able
 * session: no translation, just placement. The canonical line is untouched —
 * like canonPull, this is a branch, never a clobber.
 */
export async function canonPullNative(o: CanonPullNativeOptions): Promise<CanonPullNativeResult> {
  const store = o.store ?? defaultCanonStore();
  await ensureFreshStore(store, o.repoUrl, 'canon-pull-native');
  const live = await pullNativeFrom(o, path.join(store, 'native'));
  if (!live.noMatch || o.rel) return live;
  // Not in the live tree — the session may be archived (not on disk by design): hydrate it and retry.
  const archiveRoot = hydrateArchived(store, 'native', o.session, 'canon-pull-native');
  if (!archiveRoot) {
    console.error(`[canon-pull-native] no native session matches '${o.session}'${o.harness ? ` in ${o.harness}` : ''} (live or archived)`);
    return { code: 1 };
  }
  try {
    const r = await pullNativeFrom(o, path.join(archiveRoot, 'native'));
    if (r.noMatch) console.error(`[canon-pull-native] no native session matches '${o.session}' (live or archived)`);
    return r;
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
}

async function pullNativeFrom(o: CanonPullNativeOptions, nativeRoot: string): Promise<CanonPullNativeResult & { noMatch?: boolean }> {
  const home = o.home ?? process.env.HOME ?? os.homedir();

  // Discover logical native files (part-aware) whose path references the uuid.
  const groups = new Map<string, string[]>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;
      if (e.name.endsWith('.segments.json')) continue; // a store-side segment index (canonSegments), not a harness file
      const logical = logicalPathOf(p);
      const g = groups.get(logical) ?? [];
      g.push(p);
      groups.set(logical, g);
    }
  };
  walk(nativeRoot);
  for (const [l, files] of groups) groups.set(l, orderChunks(files));

  // A session = the `<uuid>.jsonl` main file + everything under `<uuid>/`.
  // Match by uuid (or prefix) on the main-file basename, like canonPull.
  const mains = [...groups.keys()].filter((logical) => {
    const rel = path.relative(nativeRoot, logical);
    if (o.rel) return rel === o.rel; // exact pin from the bulk loop
    if (o.harness && rel.split(path.sep)[0] !== o.harness) return false;
    const base = path.basename(rel);
    return base === `${o.session}.jsonl`
      || (base.endsWith('.jsonl') && !base.endsWith('.events.jsonl')
          && path.basename(base, '.jsonl').startsWith(o.session)
          && path.dirname(rel).split(path.sep).length <= 2);
  });
  if (mains.length === 0) {
    return { code: 1, noMatch: true };
  }
  if (mains.length > 1) {
    const sameId = new Set(mains.map((m) => path.basename(m))).size === 1;
    const harnesses = [...new Set(mains.map((m) => path.relative(nativeRoot, m).split(path.sep)[0]!))];
    const r = sameId && harnesses.length === 1 ? resolveCopies(mains, (m) => orderChunks(groups.get(m) ?? [])) : undefined;
    if (!r) {
      console.error(harnesses.length > 1
        ? `[canon-pull-native] stored under ${harnesses.length} harnesses (${harnesses.join(', ')}) — a session continued in another harness; choose with --harness <name> (or --rel <path>):`
        : `[canon-pull-native] ambiguous — ${mains.length} matches (pin one with --rel <path>):`);
      for (const m of mains) console.error(`  ${path.relative(nativeRoot, m)}`);
      return { code: 1 };
    }
    console.log(`[canon-pull-native] ${mains.length} stored copies are ${r.why === 'identical' ? 'identical' : 'one session continued in the longest'}; using ${path.relative(nativeRoot, r.pick)}`);
    mains.splice(0, mains.length, r.pick);
  }
  const main = mains[0]!;
  const mainRel = path.relative(nativeRoot, main);
  const harness = mainRel.split(path.sep)[0]!;
  const uuid = path.basename(mainRel, '.jsonl');
  const sessionDirPrefix = main.slice(0, -'.jsonl'.length) + path.sep; // <…>/<uuid>/

  // Destination project dir.
  let destDir = o.to;
  if (!destDir) {
    if (harness !== 'claude-code') {
      console.error(`[canon-pull-native] no default destination for harness '${harness}' — pass --to <dir>`);
      return { code: 1 };
    }
    const slug = o.project
      ? claudeProjectSlug(path.resolve(o.project))
      : path.basename(path.dirname(mainRel)); // original project slug from the store layout
    destDir = path.join(home, '.claude', 'projects', slug);
  }

  if (o.segment !== undefined) {
    const dest = path.join(destDir, `${uuid}.seg-${String(o.segment).padStart(4, '0')}.jsonl`);
    if (fs.existsSync(dest) && !o.force) {
      console.error(`[canon-pull-native] ${dest} already exists — use --force to overwrite`);
      return { code: 1, destDir };
    }
    fs.mkdirSync(destDir, { recursive: true });
    try { writeChunks(dest, segmentBytesOfFiles(groups.get(main)!, harness, o.segment)); }
    catch (e) { try { fs.rmSync(dest, { force: true }); } catch { /* none */ } console.error(`[canon-pull-native] ${(e as Error).message}`); return { code: 1, destDir }; }
    console.log(`[canon-pull-native] materialized segment ${o.segment} of ${uuid} (${harness}) — ${(fs.statSync(dest).size / 1024).toFixed(0)}KB → ${dest}`);
    return { code: 0, destDir, files: [dest], harness };
  }

  // Collect the session's logical files: main + sidecars (events) + <uuid>/ tree.
  const eventsLogical = main.replace(/\.jsonl$/, '.events.jsonl');
  const logicals = [...groups.keys()].filter((l) =>
    l === main || l === eventsLogical || l.startsWith(sessionDirPrefix));

  const written: string[] = [];
  for (const logical of logicals) {
    const relInSession = logical === main || logical === eventsLogical
      ? path.basename(logical)
      : path.join(uuid, path.relative(sessionDirPrefix, logical));
    const dest = path.join(destDir, relInSession);
    if (fs.existsSync(dest) && !o.force) {
      console.error(`[canon-pull-native] ${dest} already exists — resuming elsewhere is a BRANCH; use --force to overwrite`);
      return { code: 1, destDir };
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const parts = orderChunks(groups.get(logical)!);
    fs.writeFileSync(dest, '');
    for (const p of parts) fs.appendFileSync(dest, fs.readFileSync(p));
    written.push(dest);
  }

  // Stamp every materialized file with the session's LAST-ACTIVITY time (the
  // final record timestamp in the main transcript). Resume pickers sort by
  // file mtime — freshly-written files would all carry "now" in write order,
  // shuffling the list (live report 2026-08-16). With true mtimes the picker
  // shows newest-worked-on first, across every origin project/device.
  const mainDest = written.find((f) => f.endsWith(`${uuid}.jsonl`)) ?? written[0];
  if (mainDest) {
    try {
      const fd = fs.openSync(mainDest, 'r');
      const size = fs.fstatSync(fd).size;
      const span = Math.min(size, 64 * 1024);
      const buf = Buffer.alloc(span);
      fs.readSync(fd, buf, 0, span, size - span);
      fs.closeSync(fd);
      const tail = buf.toString('utf8');
      const matches = tail.match(/"timestamp":"([^"]+)"/g);
      const last = matches?.length ? matches[matches.length - 1]!.slice(13, -1) : null;
      const ts = last ? new Date(last) : null;
      if (ts && !Number.isNaN(ts.getTime())) {
        for (const f of written) { try { fs.utimesSync(f, ts, ts); } catch { /* per-file best-effort */ } }
      }
    } catch { /* stamping is cosmetic ordering — never block a pull */ }
  }

  const bytes = written.reduce((n, f) => n + fs.statSync(f).size, 0);
  console.log(`[canon-pull-native] materialized ${uuid} (${harness}) — ${written.length} file(s), ${(bytes / 1024).toFixed(0)}KB → ${destDir}`);
  if (harness === 'claude-code') {
    console.log(`[canon-pull-native]   resume with: claude --resume ${uuid}`);
    console.log(`[canon-pull-native]   (run claude from the project whose path slugifies to '${path.basename(destDir)}' so the session is in scope)`);
  }
  return { code: 0, destDir, files: written, harness };
}

/** Last-activity time from the tail of a session's FINAL part (cheap 64KB read). */
export function sessionLastActivity(parts: string[]): Date | null {
  const last = parts[parts.length - 1];
  if (!last) return null;
  try {
    const fd = fs.openSync(last, 'r');
    const size = fs.fstatSync(fd).size;
    const span = Math.min(size, 64 * 1024);
    const buf = Buffer.alloc(span);
    fs.readSync(fd, buf, 0, span, size - span);
    fs.closeSync(fd);
    const m = buf.toString('utf8').match(/"timestamp":"([^"]+)"/g);
    if (!m?.length) return null;
    const d = new Date(m[m.length - 1]!.slice(13, -1));
    return Number.isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

export interface CanonPullNativeAllOptions extends CanonStoreOptions {
  /** Harness whose native sessions to materialize (default claude-code). */
  harness?: string;
  /** Hydrate only the N most-recently-active sessions (lazy default for the
   *  container startup routines — bulk-everything does not scale). Unset/0 =
   *  every session (the explicit escape hatch). */
  recent?: number;
  /** Size cap for sessions INSIDE the recency window (default 200 MB). The
   *  user's most recent sessions are precisely the ones worth paying for —
   *  a mega-session skipped by the bulk cap is exactly what they came to
   *  resume ("not seeing recent sessions", 2026-08-16). maxMb still governs
   *  outside the window. */
  recentMaxMb?: number;
  /** Re-home every session under this cwd's project slug (claude-code default: required for the resume picker to list them). */
  project?: string;
  /** Explicit destination dir (overrides project-slug derivation). */
  to?: string;
  /** Skip sessions whose total native bytes exceed this (default 25 MB — mega-sessions hydrate slowly and drown the picker). */
  maxMb?: number;
  force?: boolean;
  home?: string;
}

export interface CanonPullNativeAllResult {
  pulled: string[];
  skippedLarge: { uuid: string; mb: number }[];
  skippedExisting: string[];
  failed: string[];
  /** Memory files materialized (continuity layer — see hydrateProjectMemory). */
  memoryFiles: number;
}

/**
 * Materialize the captured per-project auto-memory (memory/MEMORY.md + topic
 * files) alongside the sessions — the continuity half of a handoff: same
 * memories and working context, not just transcripts. Donor policy: the origin
 * project with the LARGEST total memory bytes provides MEMORY.md (the loaded
 * index must be one coherent file, not a merge); topic files from EVERY origin
 * project are copied skip-existing (index links resolve; collisions keep the
 * donor's copy). Nothing is overwritten unless force.
 */
function hydrateProjectMemory(nativeRoot: string, harness: string, destDir: string, force?: boolean): number {
  const harnessRoot = path.join(nativeRoot, harness);
  let projects: string[] = [];
  try {
    projects = fs.readdirSync(harnessRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(harnessRoot, e.name, 'memory')))
      .map((e) => e.name);
  } catch { return 0; }
  if (projects.length === 0) return 0;
  const sizeOf = (p: string): number => {
    let n = 0;
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name);
        if (e.isDirectory()) walk(q);
        else n += fs.statSync(q).size;
      }
    };
    try { walk(p); } catch { /* partial */ }
    return n;
  };
  projects.sort((a, b) => sizeOf(path.join(harnessRoot, b, 'memory')) - sizeOf(path.join(harnessRoot, a, 'memory')));
  const destMem = path.join(destDir, 'memory');
  fs.mkdirSync(destMem, { recursive: true });
  let copied = 0;
  for (const [i, proj] of projects.entries()) {
    const src = path.join(harnessRoot, proj, 'memory');
    const copyTree = (from: string, to: string) => {
      for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        const s = path.join(from, e.name);
        const d = path.join(to, e.name);
        if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d); continue; }
        // MEMORY.md comes ONLY from the donor (largest) project.
        if (e.name === 'MEMORY.md' && i > 0) continue;
        if (fs.existsSync(d) && !force) continue;
        fs.copyFileSync(s, d);
        copied++;
      }
    };
    try { copyTree(src, destMem); } catch { /* partial memory beats none */ }
  }
  if (copied > 0) {
    console.log(`[canon-pull-native] memory: ${copied} file(s) from ${projects.length} project(s) → ${destMem} (index donor: ${projects[0]})`);
  }
  return copied;
}

/**
 * Bulk native materialization — hydrate EVERY stored native session of a
 * harness (default claude-code) for the local resume picker. The container
 * `claude-hydrate` entry point: sessions are re-homed under the CURRENT
 * project's slug so `claude --resume` run there lists them all. Existing
 * files are skipped (pull is a branch, never a clobber); oversized sessions
 * are skipped loudly with their size.
 */
export async function canonPullNativeAll(o: CanonPullNativeAllOptions = {}): Promise<CanonPullNativeAllResult> {
  const store = o.store ?? defaultCanonStore();
  const harness = o.harness ?? 'claude-code';
  const maxBytes = (o.maxMb ?? 25) * 1024 * 1024;
  await ensureFreshStore(store, o.repoUrl, 'canon-pull-native');
  const sessions = discoverCanonSessions(store).filter((s) => s.harness === harness);
  // discoverCanonSessions walks /canon; sizes there track the native tree
  // closely enough for the cap. The per-session pull itself reads /native.
  const out: CanonPullNativeAllResult = { pulled: [], skippedLarge: [], skippedExisting: [], failed: [], memoryFiles: 0 };
  // Subagent transcripts are NOT top-level sessions (their parent's pull
  // carries them); and duplicate uuids across project dirs (a session pulled
  // into another slug, then re-captured) resolve to the LARGEST copy — the
  // most complete line, and pulls are pinned to that exact rel below.
  const byUuid = new Map<string, CanonSession>();
  for (const s of sessions) {
    if (s.rel.split(path.sep).includes('subagents')) continue;
    const prev = byUuid.get(s.uuid);
    if (!prev || s.bytes > prev.bytes) byUuid.set(s.uuid, s);
  }
  let list = [...byUuid.values()];
  const inWindow = new Set<string>();
  if (o.recent && o.recent > 0 && list.length > o.recent) {
    const dated = list.map((s) => ({ s, t: sessionLastActivity(s.parts)?.getTime() ?? 0 }));
    dated.sort((a, b) => b.t - a.t);
    list = dated.slice(0, o.recent).map((x) => x.s);
    console.log(`[canon-pull-native] recency window: ${list.length}/${dated.length} most-recent sessions (--recent ${o.recent}; omit it to hydrate everything)`);
    for (const s of list) inWindow.add(s.uuid);
  }
  const recentMaxBytes = (o.recentMaxMb ?? 200) * 1024 * 1024;
  for (const s of list) {
    const cap = inWindow.has(s.uuid) ? Math.max(maxBytes, recentMaxBytes) : maxBytes;
    if (s.bytes > cap) {
      out.skippedLarge.push({ uuid: s.uuid, mb: Math.round(s.bytes / 1048576) });
      console.log(`[canon-pull-native] SKIP ${s.uuid} — ${Math.round(s.bytes / 1048576)}MB > cap ${Math.round(cap / 1048576)}MB`);
      continue;
    }
    const r = await canonPullNative({
      session: s.uuid, harness, rel: s.rel, to: o.to, project: o.project,
      force: o.force, store, home: o.home,
    });
    if (r.code === 0) out.pulled.push(s.uuid);
    else if (r.destDir) out.skippedExisting.push(s.uuid); // exists-without-force
    else out.failed.push(s.uuid);
  }
  // Continuity layer: the origin projects' auto-memory follows the sessions
  // into the destination project, so the receiving Claude Code starts with the
  // same memories — not just the transcripts.
  const firstDest = (() => {
    if (o.to) return o.to;
    const home2 = o.home ?? process.env.HOME ?? os.homedir();
    const slug = claudeProjectSlug(path.resolve(o.project ?? process.cwd()));
    return path.join(home2, '.claude', 'projects', slug);
  })();
  try { out.memoryFiles = hydrateProjectMemory(path.join(store, 'native'), harness, firstDest, o.force); } catch { /* memory is best-effort */ }
  console.log(`[canon-pull-native] hydrated ${out.pulled.length} session(s) + ${out.memoryFiles} memory file(s); ${out.skippedExisting.length} already present, ${out.skippedLarge.length} oversized, ${out.failed.length} failed`);
  return out;
}

/**
 * One session id stored as several copies (a hosted box's hydrate→sync echo lands the same session under its own
 * project dir): IDENTICAL copies are one session → the first; if every other copy is a byte-PREFIX of one copy (the
 * session continued elsewhere) → the longest; otherwise undefined (genuinely divergent — the caller asks for --rel).
 * `normalize` (canon copies only) neutralizes each copy's own provenance stamp before comparing.
 */
export function resolveCopies<T>(
  cands: T[],
  partsOf: (c: T) => string[],
  normalize?: (c: T, text: string) => string,
): { pick: T; why: 'identical' | 'prefix' } | undefined {
  if (normalize) {
    // Canonical copies differ by their own provenance stamp (`provenance.native` names the project dir) — compare
    // the text with each copy's stamp neutralized.
    const texts = cands.map((c) => ({ c, t: normalize(c, partsOf(c).map((p) => fs.readFileSync(p, 'utf8')).join('')) }))
      .sort((a, b) => b.t.length - a.t.length);
    const top = texts[0]!;
    if (!texts.slice(1).every((o) => top.t.startsWith(o.t))) return undefined;
    return { pick: top.c, why: texts.every((x) => x.t.length === top.t.length) ? 'identical' : 'prefix' };
  }
  const size = (c: T) => partsOf(c).reduce((n, p) => n + fs.statSync(p).size, 0);
  const hashPrefix = (parts: string[], n: number): string => {
    const h = createHash('sha256');
    const buf = Buffer.alloc(1 << 20);
    let left = n;
    for (const p of parts) {
      if (left <= 0) break;
      const fd = fs.openSync(p, 'r');
      try {
        let r = 0;
        while (left > 0 && (r = fs.readSync(fd, buf, 0, Math.min(buf.length, left), null)) > 0) { h.update(buf.subarray(0, r)); left -= r; }
      } finally { fs.closeSync(fd); }
    }
    return h.digest('hex');
  };
  const sized = cands.map((c) => ({ c, n: size(c) })).sort((a, b) => b.n - a.n);
  const top = sized[0]!;
  for (const o of sized.slice(1)) {
    if (hashPrefix(partsOf(o.c), o.n) !== hashPrefix(partsOf(top.c), o.n)) return undefined;
  }
  return { pick: top.c, why: sized.every((x) => x.n === top.n) ? 'identical' : 'prefix' };
}

/** Materialize one canon session into a native session directory. */
export async function canonPull(o: CanonPullOptions): Promise<CanonPullResult> {
  const store = o.store ?? defaultCanonStore();
  const home = o.home ?? process.env.HOME ?? os.homedir();
  await ensureFreshStore(store, o.repoUrl);
  let sessions = discoverCanonSessions(store);
  let matches = sessions.filter((s) => s.uuid === o.session || s.uuid.startsWith(o.session));
  let archiveRoot: string | null = null;
  if (matches.length === 0) {
    archiveRoot = hydrateArchived(store, 'canon', o.session, 'canon-pull');
    if (archiveRoot) {
      sessions = discoverCanonSessions(archiveRoot);
      matches = sessions.filter((s) => s.uuid === o.session || s.uuid.startsWith(o.session));
    }
  }
  try {
    return await pullOne(o, matches, home);
  } finally {
    if (archiveRoot) fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
}

async function pullOne(o: CanonPullOptions, matches: CanonSession[], _home: string): Promise<CanonPullResult> {
  if (matches.length === 0) {
    console.error(`[canon-pull] no canon session matches '${o.session}' (live or archived)`);
    return { code: 1 };
  }
  if (o.rel) matches = matches.filter((m) => m.rel === o.rel);
  if (o.harness) matches = matches.filter((m) => m.harness === o.harness);
  if (matches.length === 0) {
    console.error(`[canon-pull] no copy of '${o.session}'${o.rel ? ` at --rel ${o.rel}` : ''}${o.harness ? ` under --harness ${o.harness}` : ''}`);
    return { code: 1 };
  }
  if (matches.length > 1) {
    const harnesses = [...new Set(matches.map((m) => m.harness))];
    const r = new Set(matches.map((m) => m.uuid)).size === 1 && harnesses.length === 1
      ? resolveCopies(matches, (m) => m.parts, (m, text) => text.split(`${path.posix.dirname(m.rel.split(path.sep).join('/'))}/`).join('<dir>/'))
      : undefined;
    if (!r) {
      console.error(harnesses.length > 1
        ? `[canon-pull] ${matches[0]!.uuid.slice(0, 8)} is stored under ${harnesses.length} harnesses (${harnesses.join(', ')}) — a session continued in another harness; choose with --harness <name> (or --rel <path>):`
        : `[canon-pull] ambiguous — ${matches.length} matches (pin one with --rel <path>):`);
      for (const m of matches) console.error(`  ${m.uuid}  (${m.rel})`);
      return { code: 1 };
    }
    console.log(`[canon-pull] ${matches.length} stored copies of ${r.pick.uuid} are ${r.why === 'identical' ? 'identical' : 'one session continued in the longest'}; using ${r.pick.rel}`);
    matches = [r.pick];
  }
  const s = matches[0]!;
  const destDir = o.to ?? path.join(process.cwd(), '.cortex', 'sessions'); // the CURRENT project's sessions dir (1.11.10 defaulted to the author's monorepo)
  const seg = o.segment;
  const dest = path.join(destDir, seg === undefined ? `${s.uuid}.jsonl` : `${s.uuid}.seg-${String(seg).padStart(4, '0')}.jsonl`);
  if (fs.existsSync(dest) && !o.force) {
    console.error(`[canon-pull] ${dest} already exists — resuming elsewhere is a BRANCH; use --force to overwrite the local copy`);
    return { code: 1, dest, session: s };
  }
  fs.mkdirSync(destDir, { recursive: true });
  if (seg === undefined) {
    fs.writeFileSync(dest, '');
    for (const p of s.parts) fs.appendFileSync(dest, fs.readFileSync(p));
  } else {
    try {
      if (s.archived) {
        const fd = fs.openSync(dest, 'w');
        try { for await (const l of segmentLinesOfStream(sessionLines(s), s.harness, seg)) fs.writeSync(fd, l + '\n'); } finally { fs.closeSync(fd); }
      } else writeChunks(dest, segmentBytesOfFiles(s.parts, s.harness, seg));
    } catch (e) {
      try { fs.rmSync(dest, { force: true }); } catch { /* none */ }
      console.error(`[canon-pull] ${(e as Error).message}`);
      return { code: 1, session: s };
    }
    console.log(`[canon-pull] segment ${seg} only (one compaction window; \`canon list --segments ${s.uuid.slice(0, 8)}\` lists them)`);
  }
  if (o.stripSignatures) {
    const { stripped, dropped } = stripThinkingSignatures(dest);
    if (stripped || dropped) {
      console.log(`[canon-pull]   G1: ${stripped} thinking block(s) → <prior_reasoning> text, ${dropped} redacted block(s) dropped (foreign-account replay safety)`);
    }
  }
  const lines = fs.readFileSync(dest, 'utf8').split('\n').filter(Boolean).length;
  // A segment is its own session id (`<uuid>.seg-NNNN` = the file name) and its own size — 11-15: the hint resumed the whole session.
  const resumeId = path.basename(dest, '.jsonl');
  console.log(`[canon-pull] materialized ${s.uuid}${seg === undefined ? '' : ` segment ${seg}`} (${s.harness}${s.title ? ` — "${s.title}"` : ''})`);
  console.log(`[canon-pull]   ${lines} canonical message(s), ${(fs.statSync(dest).size / 1024).toFixed(0)}KB → ${dest}`);
  console.log(`[canon-pull]   resume with: cortex --resume ${resumeId} "..."`);
  // Phase E rung 1: the pull-time tool-ontology compatibility report — the
  // receiving side learns up front which referenced tools are native, which
  // map by name, and which need relay/re-expression (P4 ladder).
  try {
    const names = await sessionToolNames(dest);
    if (names.length) {
      const report = toolCompatibility(names, o.target ?? 'nexus-cortex');
      console.log(renderCompat(report));
      // Phase E rung 4: the capsule — compat report + original calls for every
      // unmapped tool, written NEXT TO the pulled session so the receiving
      // model can re-express intent against its local menu (§27c).
      const capsule = path.join(destDir, `${s.uuid}.tools.md`);
      fs.writeFileSync(capsule, renderCapsule(report, await sessionToolCalls(dest), { uuid: s.uuid, harness: s.harness }));
      console.log(`[canon-pull]   tool capsule → ${capsule}`);
    }
  } catch { /* report is best-effort — never block a pull */ }
  return { code: 0, dest, session: s };
}

function writeChunks(dest: string, chunks: Iterable<Buffer>): void {
  const fd = fs.openSync(dest, 'w');
  try { for (const b of chunks) fs.writeSync(fd, b); } finally { fs.closeSync(fd); }
}

/** Native sessions (live /native tree) whose main file matches `session` — the same match rule as `pull --native`. */
export function findNativeSessions(store: string, session: string, o: { harness?: string; rel?: string } = {}): CanonSession[] {
  const nativeRoot = path.join(store, 'native');
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files.push(p);
    }
  };
  walk(nativeRoot);
  const out: CanonSession[] = [];
  for (const [logical, parts] of groupChunkFiles(files)) {
    const rel = path.relative(nativeRoot, logical);
    const base = path.basename(rel);
    if (!base.endsWith('.jsonl') || base.endsWith('.events.jsonl')) continue;
    if (o.rel ? rel !== o.rel : !(path.basename(base, '.jsonl').startsWith(session) && path.dirname(rel).split(path.sep).length <= 2)) continue;
    const harness = rel.split(path.sep)[0]!;
    if (o.harness && harness !== o.harness) continue;
    out.push({ uuid: path.basename(base, '.jsonl'), rel, parts, harness, bytes: parts.reduce((n, p) => n + fs.statSync(p).size, 0) });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export interface CanonSegmentsOptions extends CanonStoreOptions {
  /** Session uuid (or unique prefix). */
  session: string;
  /** Read the byte-exact /native copy instead of the canonical line. */
  native?: boolean;
  harness?: string;
  rel?: string;
  /** Print JSON instead of the table. */
  json?: boolean;
  /** Skip the store freshen (git pull) — for local/offline reads. */
  noFetch?: boolean;
}
export interface CanonSegmentsResult { code: 0 | 1; session?: CanonSession; segments?: SegmentMeta[] }

/**
 * List one session's compaction segments (canonSegments): the written index for a segmented session, else computed
 * from the stored bytes (nothing written). Each row: window lines/bytes, time span, the boundary's token counts, the
 * first real prompt, and the compaction summary — the map an agent reads before `pull <uuid> --segment N`.
 */
export async function canonSegments(o: CanonSegmentsOptions): Promise<CanonSegmentsResult> {
  const store = o.store ?? defaultCanonStore();
  if (!o.noFetch) await ensureFreshStore(store, o.repoUrl, 'canon-segments');
  let matches: CanonSession[];
  if (o.native) matches = findNativeSessions(store, o.session, { harness: o.harness, rel: o.rel });
  else {
    const live = discoverCanonSessions(store);
    const pick = (ss: CanonSession[]) => ss.filter((s) => (o.rel ? s.rel === o.rel : s.uuid.startsWith(o.session)) && (!o.harness || s.harness === o.harness));
    matches = pick(live);
    if (!matches.length) matches = pick(discoverArchivedCanonSessions(store, live.map((s) => s.rel)));
  }
  if (!o.rel) matches = matches.filter((m) => !m.rel.split(path.sep).includes('subagents'));
  if (matches.length !== 1) {
    console.error(matches.length ? `[canon-segments] ambiguous — ${matches.length} matches (pin one with --rel <path> or --harness <h>):` : `[canon-segments] no ${o.native ? 'native' : 'canon'} session matches '${o.session}'`);
    for (const m of matches) console.error(`  ${m.uuid}  (${m.rel})`);
    return { code: 1 };
  }
  const s = matches[0]!;
  if (s.archived && !s.archived.local) { console.error(`[canon-segments] ${s.uuid} is archived and its blobs are not local — \`canon pull ${s.uuid}\` fetches it`); return { code: 1, session: s }; }
  const segments = s.archived ? await segmentsOfStream(sessionLines(s), s.harness) : segmentsOfFiles(s.parts, s.harness);
  if (o.json) console.log(JSON.stringify({ session: s.uuid, rel: s.rel, harness: s.harness, segments }, null, 1));
  else {
    console.log(`${s.uuid}  ${s.harness}  ${s.rel}  — ${segments.length} segment(s)${s.title ? `  "${s.title}"` : ''}`);
    console.log(renderSegments(segments));
    console.log(`\n[canon-segments] pull one window: canon pull ${s.uuid.slice(0, 8)}${o.native ? ' --native' : ''} --segment <n>`);
  }
  return { code: 0, session: s, segments };
}
