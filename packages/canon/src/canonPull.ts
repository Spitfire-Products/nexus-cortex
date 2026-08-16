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
import { requireCanonRepo, redactRepoUrl, canonGit } from './canonRepo.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderCapsule, renderCompat, sessionToolCalls, sessionToolNames, toolCompatibility, type HarnessName } from './canonTools.js';

export interface CanonStoreOptions {
  /** Canon store working clone (default /tmp/canon-store — off-quota; auto-cloned). */
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
}

export interface CanonPullOptions extends CanonStoreOptions {
  /** Session uuid (or unique prefix) to materialize. */
  session: string;
  /** Target harness for the tool-compatibility report (default nexus-cortex — where pull lands). */
  target?: HarnessName;
  /** Destination directory (default {home}/omniclaude-v4/.cortex/sessions). */
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
  home?: string;
}

export interface CanonPullResult {
  /** 0 = materialized; 1 = not found / ambiguous / exists-without-force. */
  code: 0 | 1;
  dest?: string;
  session?: CanonSession;
}

/** Clone the store if absent, else pull — rehydrate freshness on arrival. */
function ensureFreshStore(store: string, repoUrl?: string, label = 'canon-pull'): void {
  if (!fs.existsSync(path.join(store, '.git'))) {
    const repo = requireCanonRepo(repoUrl, store, label);
    console.log(`[${label}] no store at ${store} — cloning ${redactRepoUrl(repo)}`);
    canonGit(null, label)(['clone', '-q', repo, store]);
  } else {
    canonGit(store, label)(['pull', '-q', 'origin', 'main']);
  }
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
      const m = e.name.match(/^(.*\.jsonl)\.part-\d{4}$/);
      const logical = m ? path.join(dir, m[1]!) : p;
      if (!logical.endsWith('.jsonl') || logical.endsWith('.events.jsonl')) continue;
      const g = groups.get(logical) ?? [];
      g.push(p);
      groups.set(logical, g);
    }
  };
  walk(root);
  const out: CanonSession[] = [];
  for (const [logical, parts] of groups) {
    parts.sort();
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
    const eventsPath = logical.replace(/\.jsonl$/, '.events.jsonl');
    if (fs.existsSync(eventsPath)) {
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
  const store = o.store ?? '/tmp/canon-store';
  ensureFreshStore(store, o.repoUrl);
  const sessions = discoverCanonSessions(store);
  const rows = sessions.filter((s) => o.all || s.bytes > 4096);
  for (const s of rows) {
    const kb = (s.bytes / 1024).toFixed(0).padStart(7);
    console.log(`${s.uuid}  ${kb}KB  ${s.harness.padEnd(12)}  ${s.title ?? ''}`);
  }
  console.log(`\n[canon-pull] ${rows.length} session(s)${o.all ? '' : ' >4KB (--all for every one)'} in ${store}/canon`);
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
  const store = o.store ?? '/tmp/canon-store';
  const home = o.home ?? process.env.HOME ?? '/home/runner/workspace';
  ensureFreshStore(store, o.repoUrl, 'canon-pull-native');
  const nativeRoot = path.join(store, 'native');

  // Discover logical native files (part-aware) whose path references the uuid.
  const groups = new Map<string, string[]>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;
      const m = e.name.match(/^(.*)\.part-\d{4}$/);
      const logical = m ? path.join(dir, m[1]!) : p;
      const g = groups.get(logical) ?? [];
      g.push(p);
      groups.set(logical, g);
    }
  };
  walk(nativeRoot);

  // A session = the `<uuid>.jsonl` main file + everything under `<uuid>/`.
  // Match by uuid (or prefix) on the main-file basename, like canonPull.
  const mains = [...groups.keys()].filter((logical) => {
    const rel = path.relative(nativeRoot, logical);
    if (o.harness && rel.split(path.sep)[0] !== o.harness) return false;
    const base = path.basename(rel);
    return base === `${o.session}.jsonl`
      || (base.endsWith('.jsonl') && !base.endsWith('.events.jsonl')
          && path.basename(base, '.jsonl').startsWith(o.session)
          && path.dirname(rel).split(path.sep).length <= 2);
  });
  if (mains.length === 0) {
    console.error(`[canon-pull-native] no native session matches '${o.session}'${o.harness ? ` in ${o.harness}` : ''}`);
    return { code: 1 };
  }
  if (mains.length > 1) {
    console.error(`[canon-pull-native] ambiguous — ${mains.length} matches:`);
    for (const m of mains) console.error(`  ${path.relative(nativeRoot, m)}`);
    return { code: 1 };
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
    const parts = groups.get(logical)!.slice().sort();
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

export interface CanonPullNativeAllOptions extends CanonStoreOptions {
  /** Harness whose native sessions to materialize (default claude-code). */
  harness?: string;
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
  const store = o.store ?? '/tmp/canon-store';
  const harness = o.harness ?? 'claude-code';
  const maxBytes = (o.maxMb ?? 25) * 1024 * 1024;
  ensureFreshStore(store, o.repoUrl, 'canon-pull-native');
  const sessions = discoverCanonSessions(store).filter((s) => s.harness === harness);
  // discoverCanonSessions walks /canon; sizes there track the native tree
  // closely enough for the cap. The per-session pull itself reads /native.
  const out: CanonPullNativeAllResult = { pulled: [], skippedLarge: [], skippedExisting: [], failed: [], memoryFiles: 0 };
  const seen = new Set<string>();
  for (const s of sessions) {
    if (seen.has(s.uuid)) continue; // subagent rows resolve to the parent uuid
    seen.add(s.uuid);
    // Subagent transcripts are NOT top-level sessions: in the real layout they
    // live under <session>/subagents/ and the parent's pull carries them.
    // Materializing them individually promoted background-worker transcripts
    // (often full of another machine's paths) into the resume picker — the
    // "resumed a session and it was some worker's context" report (2026-08-16).
    if (s.rel.split(path.sep).includes('subagents')) continue;
    if (s.bytes > maxBytes) {
      out.skippedLarge.push({ uuid: s.uuid, mb: Math.round(s.bytes / 1048576) });
      console.log(`[canon-pull-native] SKIP ${s.uuid} — ${Math.round(s.bytes / 1048576)}MB > --max-mb ${o.maxMb ?? 25}`);
      continue;
    }
    const r = await canonPullNative({
      session: s.uuid, harness, to: o.to, project: o.project,
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
    const home2 = o.home ?? process.env.HOME ?? '/home/runner/workspace';
    const slug = claudeProjectSlug(path.resolve(o.project ?? process.cwd()));
    return path.join(home2, '.claude', 'projects', slug);
  })();
  try { out.memoryFiles = hydrateProjectMemory(path.join(store, 'native'), harness, firstDest, o.force); } catch { /* memory is best-effort */ }
  console.log(`[canon-pull-native] hydrated ${out.pulled.length} session(s) + ${out.memoryFiles} memory file(s); ${out.skippedExisting.length} already present, ${out.skippedLarge.length} oversized, ${out.failed.length} failed`);
  return out;
}

/** Materialize one canon session into a native session directory. */
export async function canonPull(o: CanonPullOptions): Promise<CanonPullResult> {
  const store = o.store ?? '/tmp/canon-store';
  const home = o.home ?? process.env.HOME ?? '/home/runner/workspace';
  ensureFreshStore(store, o.repoUrl);
  const sessions = discoverCanonSessions(store);
  const matches = sessions.filter((s) => s.uuid === o.session || s.uuid.startsWith(o.session));
  if (matches.length === 0) {
    console.error(`[canon-pull] no canon session matches '${o.session}'`);
    return { code: 1 };
  }
  if (matches.length > 1) {
    console.error(`[canon-pull] ambiguous — ${matches.length} matches:`);
    for (const m of matches) console.error(`  ${m.uuid}  (${m.rel})`);
    return { code: 1 };
  }
  const s = matches[0]!;
  const destDir = o.to ?? path.join(home, 'omniclaude-v4', '.cortex', 'sessions');
  const dest = path.join(destDir, `${s.uuid}.jsonl`);
  if (fs.existsSync(dest) && !o.force) {
    console.error(`[canon-pull] ${dest} already exists — resuming elsewhere is a BRANCH; use --force to overwrite the local copy`);
    return { code: 1, dest, session: s };
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(dest, '');
  for (const p of s.parts) fs.appendFileSync(dest, fs.readFileSync(p));
  if (o.stripSignatures) {
    const { stripped, dropped } = stripThinkingSignatures(dest);
    if (stripped || dropped) {
      console.log(`[canon-pull]   G1: ${stripped} thinking block(s) → <prior_reasoning> text, ${dropped} redacted block(s) dropped (foreign-account replay safety)`);
    }
  }
  const lines = fs.readFileSync(dest, 'utf8').split('\n').filter(Boolean).length;
  console.log(`[canon-pull] materialized ${s.uuid} (${s.harness}${s.title ? ` — "${s.title}"` : ''})`);
  console.log(`[canon-pull]   ${lines} canonical message(s), ${(s.bytes / 1024).toFixed(0)}KB → ${dest}`);
  console.log(`[canon-pull]   resume with: cortex --resume ${s.uuid} "..."`);
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
