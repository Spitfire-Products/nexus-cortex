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
import { defaultCanonStore } from './storePath.js';
import { requireCanonRepo, redactRepoUrl, canonGit, guardedAddAll, atomicClone, guardedPush, isScopedStore, sparseAdd, withStoreLock, repackAllIfNeeded } from './canonRepo.js';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import * as path from 'node:path';
import { dropArchivedDuplicates, dropEchoedSessions } from './canonArchive.js';
import { PlainPartWriter, SegmentedWriter, hasOldParts, resolveSealBytes, segmentIndexPath, segmentsOfFiles } from './canonSegments.js';

export interface CanonSyncOptions {
  /** Canon store working clone (default: defaultCanonStore() in storePath.ts — CANON_STORE, an existing /tmp/canon-store, else ~/.cache/nexus-canon/store; auto-cloned). */
  store?: string;
  /** Home dir for harness roots + the mtime/size manifest (default $HOME). */
  home?: string;
  /** Report what would copy; write nothing. */
  dryRun?: boolean;
  /** Store remote for the auto-clone (or env CANON_REPO). Unconfigured + no store = fail-fast. */
  repoUrl?: string;
  /** SCOPED sync (or env CANON_SYNC_SCOPE): 'auto' = clone/materialize only the
   *  legs whose harness roots exist on THIS machine (a container capturing its
   *  own sessions gets ~its leg, not the whole multi-GB surface); or an explicit
   *  comma list of harness labels ('nexus-cortex,browser-cortex'). Unset = full
   *  surface (repl default — translate/graph need everything and REFUSE scoped
   *  stores). Scoped stores are cone-mode sparse clones; root config files and
   *  native/SKIPPED.md remain present (cone semantics). */
  scope?: string;
  /** Tuning/test hooks: the cap for non-JSONL files (default 50 MB) and the size cap of a NEW part (default 25 MB). */
  maxBytes?: number;
  partBytes?: number;
  /** Seal size of a session's open tail part (default env CANON_SEAL_BYTES, else 256 KB; never above partBytes). A part that
   *  reached it is never rewritten again; a session at or under it is stored as one file. */
  sealBytes?: number;
}

export interface CanonSyncResult {
  copied: number;
  unchanged: number;
  skipped: string[];
  chunked: number;
  scrubbedHits: number;
  pushed: boolean;
  /** Bytes the session writers wrote into the store this sync (new parts + open tails + indexes) — the store's growth before git compression. */
  bytesWritten?: number;
  /** Sealed parts that no longer matched their source (rewritten from there; each logged). Normally empty. */
  diverged?: string[];
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

const BINARY_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.zip', '.gz', '.tgz', '.bin', '.sqlite', '.db', '.wasm', '.ico'];
/** Binary = a known binary extension, or a NUL byte in the first 8 KB (extensionless file-history backups of binaries). */
export function isBinaryFile(file: string): boolean {
  const lower = file.toLowerCase();
  if (BINARY_EXTS.some((x) => lower.endsWith(x))) return true;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(8192);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      return buf.subarray(0, n).includes(0);
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

/** Every nexus-cortex state root under HOME, as labelled roots for one leaf (`sessions` dir or `decisions.jsonl`): HOME itself
 *  ('workspace'), each HOME/<project> and each HOME/<project>/packages/<pkg> that carries a `.cortex/` dir. Labels are the dir
 *  basenames (a repeated basename is prefixed with its parent). Discovered, never hard-coded: the published package must not know
 *  the author's workspace layout. Hidden dirs and node_modules are skipped; an unreadable HOME yields the workspace root only. */
/** The label for THIS machine's own `$HOME/.cortex` root. Was the fixed string 'workspace', which collided across machines: home, m2
 *  and macbook each wrote their OWN decisions.jsonl to native/nexus-cortex-decisions/workspace/, so every sync clobbered the last and
 *  a two-writer chunk migration produced an add/add rebase conflict that wedged the clients' stores (m2 stuck 11-17). Now machine-unique:
 *  env CANON_MACHINE_LABEL, else ~/.agent-home-name (clients set it: 'm2', 'macbook'), else 'workspace' (home, which has no name file —
 *  so home's existing path is unchanged and the clients' decisions move to their own namespace). */
export function machineCortexLabel(H: string, env: NodeJS.ProcessEnv = process.env): string {
  const e = (env.CANON_MACHINE_LABEL || '').trim();
  if (e) return e;
  try { const n = fs.readFileSync(path.join(H, '.agent-home-name'), 'utf8').trim(); if (n) return n.replace(/[^A-Za-z0-9_.-]/g, '-'); } catch { /* no name file: home */ }
  return 'workspace';
}

export function discoverCortexRoots(H: string, leaf: string): Array<{ label: string; path: string }> {
  const root = machineCortexLabel(H);
  const out: Array<{ label: string; path: string }> = [{ label: root, path: path.join(H, '.cortex', leaf) }];
  const seen = new Set<string>([root]);
  const subdirs = (dir: string): string[] => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map((e) => e.name).sort();
    } catch { return []; }
  };
  const push = (name: string, dir: string, parent: string) => {
    if (!fs.existsSync(path.join(dir, '.cortex'))) return;
    const label = seen.has(name) ? `${parent}/${name}` : name;
    seen.add(label);
    out.push({ label, path: path.join(dir, '.cortex', leaf) });
  };
  for (const p of subdirs(H)) {
    const dir = path.join(H, p);
    push(p, dir, path.basename(H));
    for (const q of subdirs(path.join(dir, 'packages'))) push(q, path.join(dir, 'packages', q), p);
  }
  return out;
}

function defaultHarnessSources(H: string): Record<string, HarnessSource> {
  return {
    // .md rides too: the per-project auto-memory (memory/MEMORY.md + topic
    // files) is the continuity layer a handoff needs — sessions without the
    // memories that interpret them are half a handoff. Secret-scrubbed like
    // everything else; canonTranslate ignores non-.jsonl natives.
    // 2026-09-26 coverage audit: the projects tree also holds what the transcripts POINT TO — tool-results/ (large
    // outputs, screenshots, PDFs) and workflows/ (wf_*.json run definitions + the scripts that spawned multi-agent
    // runs, per-agent .meta.json). Without them an image-bearing session replays incomplete and a workflow run keeps
    // its agents but loses the plan. Binary files are copied byte-exact (no scrub — see syncFile).
    'claude-code': {
      exts: ['.jsonl', '.md', '.json', '.js', '.txt', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'],
      roots: [path.join(H, '.claude', 'projects')],
    },
    // Claude Code's per-edit file backups (~/.claude/file-history/<session>/<hash>@vN): the ground truth of what each
    // edit changed, keyed by session — the step-level signal credit assignment needs. Extensionless → '*'. Text is
    // secret-scrubbed like everything else (backups of .env-style files are exactly where secrets would sit).
    'claude-code-file-history': { exts: ['*'], roots: [path.join(H, '.claude', 'file-history')] },
    'nexus-cortex': {
      exts: ['.jsonl', '.json'],
      // Roots are DISCOVERED: $HOME itself (cortex runs launched from HOME — coverage gap 2026-07-28), every $HOME/<project> and every
      // $HOME/<project>/packages/<pkg> that carries a .cortex/ dir (CLI/TUI runs launched from their package dirs — 2026-09-26 audit).
      // 1.11.8 hard-coded the author's project names here; a store's HARNESSES.json still overrides (loadHarnessSources).
      roots: discoverCortexRoots(H, 'sessions'),
    },
    // Decision stores ride canon BY DEFAULT (data-lake rule, 2026-08-25):
    // sessions alone mislabel exit-masked failures as successes (wire is_error
    // is false for failing bash) and strip post-persist steering causes
    // (loop_escalation / gate-fallback / inaction event rows live ONLY here).
    // File roots — the sync loop handles single-file roots directly.
    'nexus-cortex-decisions': {
      exts: ['.jsonl'],
      roots: discoverCortexRoots(H, 'decisions.jsonl'),
    },
    // Autoresearch campaign transcripts (2026-09-26): the nexus-autoresearch executor stages each finished job's agent
    // sessions + decision stores under ~/.cortex/autoresearch-stage/<jobId>/ and syncs with --scope autoresearch, so a
    // container clones only this small leg of the caller's canon store (never the multi-GB whole).
    'autoresearch': { exts: ['.jsonl', '.json'], roots: [path.join(H, '.cortex', 'autoresearch-stage')] },
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
  [/gho_[A-Za-z0-9]{20,}/g, '[redacted:gho]'], // OAuth token (`gh auth token`) — missing until 2026-09-26, one was printed into a transcript
  [/ghr_[A-Za-z0-9]{20,}/g, '[redacted:ghr]'],
  [/hf_[A-Za-z0-9]{20,}/g, '[redacted:hf]'],
  [/AIza[A-Za-z0-9_-]{20,}/g, '[redacted:aiza]'],
  [/AQ\.[A-Za-z0-9_-]{30,}/g, '[redacted:google-aq]'],   // Google's newer API key format (2026-11-06 Gemini rotation)
  [/xai-[A-Za-z0-9]{20,}/g, '[redacted:xai]'],
  [/nar_[A-Za-z0-9]{16,}/g, '[redacted:nar]'],
  // Our own platform key/token prefixes (2026-09-26, autoresearch transcripts start riding canon): per-job proxy tokens,
  // nexus-cortex user keys, the sandbox admin bearer, relay + browser keys.
  [/narjob_[A-Fa-f0-9]{24,}/g, '[redacted:narjob]'],
  [/ncx_[A-Za-z0-9]{16,}/g, '[redacted:ncx]'],
  [/ncsb_[A-Za-z0-9]{16,}/g, '[redacted:ncsb]'],
  [/nrl_[A-Za-z0-9]{16,}/g, '[redacted:nrl]'],
  [/\bnb_[A-Za-z0-9]{16,}/g, '[redacted:nb]'],
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

async function canonSyncUnlocked(o: CanonSyncOptions = {}): Promise<CanonSyncResult> {
  const HOME = o.home ?? process.env.HOME ?? os.homedir();
  const DRY = o.dryRun ?? false;
  const STORE = o.store ?? defaultCanonStore();
  const MANIFEST_PATH = path.join(HOME, '.canon', 'manifest.json');
  const MAX_BYTES = o.maxBytes ?? 50 * 1024 * 1024; // GitHub hard-rejects >100MB; margin for scrub growth
  const PART_BYTES = o.partBytes ?? 25 * 1024 * 1024;
  const SEAL_BYTES = resolveSealBytes(o.sealBytes, PART_BYTES);   // open tail part seal size (CANON_SEAL_BYTES; default 256 KB)

  // Scoped-sync mode (see CanonSyncOptions.scope): 'auto' | 'label,label' | unset.
  const SCOPE_RAW = (o.scope ?? process.env.CANON_SYNC_SCOPE ?? '').trim();
  const SCOPE_AUTO = SCOPE_RAW === 'auto';
  const SCOPE_LABELS = !SCOPE_AUTO && SCOPE_RAW
    ? SCOPE_RAW.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  if (!fs.existsSync(path.join(STORE, '.git'))) {
    // Working clone is disposable — the remote is the truth. Where it lives: defaultCanonStore() (storePath.ts);
    // on a quota'd workspace, point CANON_STORE / --store at a disk with room.
    const CANON_REPO = requireCanonRepo(o.repoUrl, STORE, 'canon-sync');
    console.log(`[canon-sync] no store at ${STORE} — cloning ${redactRepoUrl(CANON_REPO)}${SCOPE_RAW ? ` (scoped: ${SCOPE_RAW})` : ''}`);
    // Atomic clone (temp dir + rename): the store path never holds a .git over
    // a partial checkout, so a concurrent canon verb can't operate on (and
    // commit!) a half tree — the 08-18/08-20 mass-deletion race. Auth-failure
    // hint (`could not read Username`/401 = missing/REVOKED GH_TOKEN; hosted:
    // re-save the canon store in CORTEX -> Connections) surfaces from the
    // helper's redacted error line.
    if (SCOPE_AUTO) {
      // Bootstrap for auto-scope: root files only (HARNESSES.json travels in the
      // store) — the discovered legs are sparse-added after config load below.
      atomicClone(CANON_REPO, STORE, 'canon-sync', []);
    } else if (SCOPE_LABELS) {
      atomicClone(CANON_REPO, STORE, 'canon-sync', SCOPE_LABELS.map((l) => `native/${l}`));
    } else {
      atomicClone(CANON_REPO, STORE, 'canon-sync');
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
  let copied = 0, unchanged = 0, scrubbedHits = 0, chunked = 0, tornTrimmed = 0, unparseableCarried = 0;
  let appendWritten = 0; const diverged: string[] = [];

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

  /** Every .jsonl session (any size, 2026-11-17) is stored APPEND-ONLY through canonSegments' part writers: the bytes already
   *  in the store are verified and never rewritten, only the new tail is appended (a small open tail part, sealed at SEAL_BYTES),
   *  so a sync stores the new records — not another full copy of the live transcript. Reassembly = the parts in order. */
  function syncChunked(src: string, destRel: string, st: fs.Stats) {
    if (DRY) { chunked++; copied++; return; }
    // STREAMED (2026-11-11): a session past V8's max string length (~512 MB) threw "Cannot create a string longer than
    // 0x1fffffe8 characters" on readFileSync and was skipped every cycle (faee1cf3, 824 MB, stuck since 10-29). Read in
    // byte blocks through a UTF-8 StringDecoder, keep only complete lines, scrub per line (every SECRET_PATTERN is line-local).
    let fd: number;
    try { fd = fs.openSync(src, 'r'); }
    catch (e) { skipped.push(`${destRel} — read failed: ${e}`); return; }
    const destBase = path.join(STORE, 'native', destRel);
    fs.mkdirSync(path.dirname(destBase), { recursive: true });
    // LAYOUT (canonSegments): a session with an index continues segmented; an OLD size-cut session (`.part-NNNN`, no index)
    // continues in that layout, append-only (no migration, no duplicate copy); a single-file session is ADOPTED by rename when
    // it is ≥ SEAL_BYTES (segmented when it holds one compaction window, else as `.part-0000`) — zero new bytes in git; a new or
    // small session is written segmented, staying ONE file while it is ≤ SEAL_BYTES (it is then its own open tail).
    const harness = destRel.split(path.sep)[0] ?? null;
    const wopts = { harness, partBytes: PART_BYTES, sealBytes: SEAL_BYTES };
    let sink: SegmentedWriter | PlainPartWriter;
    if (fs.existsSync(segmentIndexPath(destBase))) sink = new SegmentedWriter(destBase, wopts);
    else if (hasOldParts(destBase)) sink = new PlainPartWriter(destBase, wopts);
    else {
      let single = -1; try { single = fs.statSync(destBase).size; } catch { /* none */ }
      if (single >= SEAL_BYTES && segmentsOfFiles([destBase], harness).length > 1) sink = new PlainPartWriter(destBase, { ...wopts, adoptSingle: true });
      else sink = new SegmentedWriter(destBase, { ...wopts, adoptSingle: true, singleBelow: SEAL_BYTES });
    }
    let held: string | null = null; // the last line, pushed once we know whether it is the unterminated final one
    const dec = new StringDecoder('utf8'); const block = Buffer.allocUnsafe(8 * 1024 * 1024);
    let pending = '', lineNo = 0, torn = false, scrubbedAny = false;
    // A bad record FOLLOWED by valid records is mid-file corruption (2026-11-11: faee1cf3 line 197,556, a malformed 141 KB
    // api-request-blob after a crash) — never a writer race. Treating it as a torn tail froze the copy at that line forever.
    // It is carried losslessly as a marker record holding the raw line as a JSON string; only a bad LAST line is a torn tail.
    let suspect: { no: number; text: string } | null = null; let trail: string[] = [];   // blank lines after a suspect keep their order
    const corrupt = (s: { no: number; text: string }) => {
      console.log(`[canon-sync] unparseable record at line ${s.no} in ${destRel} (valid records follow) — carried as canon-unparseable-line`);
      unparseableCarried++;
      return JSON.stringify({ type: 'canon-unparseable-line', line: s.no, raw: s.text });
    };
    const emit = (l: string) => {   // scrub one stored line; a scrub that breaks the JSON is a SCRUB BUG — carried as a marker, loudly
      let out = scrub(l);
      if (out !== l) {
        scrubbedAny = true;
        if (l.trim()) { try { JSON.parse(out); } catch {
          console.log(`[canon-sync] POST-SCRUB unparseable line in ${destRel} (scrub-pattern bug, report it) — carried as canon-unparseable-line`);
          out = JSON.stringify({ type: 'canon-unparseable-line', postScrub: true, raw: out });
        } }
      }
      if (held !== null) sink.push(held + '\n');
      held = out;
    };
    const take = (lines: string[]) => {   // complete lines → validate → scrub → writer
      for (const l of lines) {
        lineNo++;
        if (!l.trim()) { if (suspect) trail.push(l); else emit(l); continue; }
        let valid = true; try { JSON.parse(l); } catch { valid = false; }
        if (!valid) { if (suspect) { emit(corrupt(suspect)); for (const t of trail) emit(t); trail = []; } suspect = { no: lineNo, text: l }; continue; }
        if (suspect) { emit(corrupt(suspect)); for (const t of trail) emit(t); trail = []; suspect = null; }
        emit(l);
      }
    };
    try {
      for (;;) {
        const n = fs.readSync(fd, block, 0, block.length, null);
        if (n === 0) break;
        pending += dec.write(block.subarray(0, n));
        const nl = pending.lastIndexOf('\n'); if (nl < 0) continue;
        const lines = pending.slice(0, nl).split('\n'); pending = pending.slice(nl + 1); take(lines);
      }
      pending += dec.end(); if (pending.length) take([pending]);
      if (suspect) {   // the LAST record is bad → torn tail: keep the valid prefix, do not advance the manifest
        const s = suspect as { no: number; text: string };
        console.log(`[canon-sync] torn line ${s.no} in ${destRel} — kept ${s.no - 1}-line valid prefix, will retry next cycle`);
        tornTrimmed++; torn = true;
      }
      // An unterminated last line keeps the file's bytes as-is — and is UNSTABLE (its '\n' is still coming): never sealed.
      if (held !== null) { if (!torn && pending.length) sink.push(held as string, false); else sink.push(held + '\n'); }
      const r = sink.finish();
      appendWritten += r.stats.bytesWritten;
      if (r.stats.diverged.length) diverged.push(...r.stats.diverged.map((d) => `${destRel}: ${d}`));
    } catch (e) { skipped.push(`${destRel} — read failed: ${e}`); return; }
    finally { fs.closeSync(fd); }
    if (scrubbedAny) scrubbedHits++;
    // Torn tail → manifest NOT advanced, so the completed file re-copies next cycle.
    if (!torn) manifest[destRel] = { mtimeMs: st.mtimeMs, size: st.size };
    chunked++; copied++;
  }

  function syncFile(src: string, destRel: string) {
    let st: fs.Stats;
    try { st = fs.statSync(src); } catch (e) { skipped.push(`${destRel} — unreadable: ${e}`); return; }
    const key = destRel;
    const prev = manifest[key];
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) { unchanged++; return; }
    // Every .jsonl goes through the append-only part writer, whatever its size (2026-11-17: the whole-file path re-stored every
    // session under 50 MB in full on each sync). Other oversized files cannot be line-split: visible skips (D8).
    if (src.endsWith('.jsonl')) { syncChunked(src, destRel, st); return; }
    if (st.size > MAX_BYTES) {
      skipped.push(`${destRel} — ${(st.size / 1e6).toFixed(0)}MB > 50MB cap, not line-splittable`);
      manifest[key] = { mtimeMs: st.mtimeMs, size: st.size };
      return;
    }
    const dest = path.join(STORE, 'native', destRel);
    if (!DRY && isBinaryFile(src)) {
      // Images / PDFs / any file with NUL bytes: a UTF-8 read + text scrub would CORRUPT them. Copy byte-exact;
      // the scrub is a text-pattern pass and cannot apply (the store is private, same as every other native).
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try { fs.copyFileSync(src, dest); }
      catch (e) { skipped.push(`${destRel} — copy failed: ${e}`); return; }
      manifest[key] = { mtimeMs: st.mtimeMs, size: st.size };
      copied++;
      return;
    }
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
  let HARNESS_SOURCES = loadHarnessSources(STORE, HOME);
  let scopedLegs: string[] | undefined; // the active legs of a scoped sync (undefined = full-surface)
  if (SCOPE_AUTO || SCOPE_LABELS) {
    // Resolve the active scope: 'auto' = harnesses with >=1 root present on THIS
    // machine (a container only has its own); explicit = the listed labels.
    const rootExists = (r: string | { label: string; path: string }) => {
      const p = typeof r === 'string' ? r : r.path;
      try { fs.statSync(p); return true; } catch { return false; }
    };
    const active = SCOPE_LABELS
      ?? Object.entries(HARNESS_SOURCES)
        .filter(([, src]) => src.roots.some(rootExists))
        .map(([label]) => label);
    scopedLegs = active;
    // Widen the cone to the active legs (idempotent — safe on every run, and it
    // heals a pre-existing scoped store whose local harness set grew).
    if (isScopedStore(STORE)) sparseAdd(STORE, active.map((l) => `native/${l}`), 'canon-sync');
    // Only capture in-scope harnesses: writes stay inside the sparse cone (an
    // out-of-cone write would fight cone-mode `add -A` semantics).
    const dropped = Object.keys(HARNESS_SOURCES).filter((l) => !active.includes(l));
    if (dropped.length) console.log(`[canon-sync] scoped mode — capturing [${active.join(', ')}], skipping [${dropped.join(', ')}]`);
    HARNESS_SOURCES = Object.fromEntries(Object.entries(HARNESS_SOURCES).filter(([l]) => active.includes(l)));
  }
  for (const [label, src] of Object.entries(HARNESS_SOURCES)) {
    for (const r of src.roots) {
      const rootPath = typeof r === 'string' ? r : r.path;
      const sub = typeof r === 'string' ? '' : r.label;
      // A root may be a single FILE (e.g. .cortex/decisions.jsonl) — sync it
      // directly; walk() only descends directories.
      let rootIsFile = false;
      try { rootIsFile = fs.statSync(rootPath).isFile(); } catch { /* absent */ }
      if (rootIsFile) {
        if (src.exts.includes('*') || src.exts.some((x) => rootPath.endsWith(x))) {
          syncFile(rootPath, path.join(label, sub, path.basename(rootPath)));
        }
        continue;
      }
      const anyExt = src.exts.includes('*');
      for (const f of walk(rootPath)) {
        if (!anyExt && !src.exts.some((x) => f.endsWith(x))) continue;
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
    // A SCOPED writer (autoresearch sandbox, hosted container) owns only its own legs: folding the browser branches into
    // it staged every browser-cortex file OUTSIDE its sparse cone, where the archived-duplicate guard's `git rm` is
    // refused — so each scoped sync re-committed the archived browser sessions (09-26: 75 files per autoresearch job,
    // dropped again by the next archive run). The full-surface writer (the repl watcher/cron) integrates them.
    if (scopedLegs && !scopedLegs.includes('browser-cortex')) {
      // scoped store without the browser leg — nothing to integrate here
    } else try {
      // 2026-11-17 GROWTH FIX: these browser-cortex branches have UNRELATED history and used to re-download ~600 MB of already-held
      // objects on every sync (first via `--depth 1`, then via a `--filter=blob:none` + checkout lazy over-fetch — see the fetch below).
      // Now: (1) a branch is folded only when its tip moved since the last fold-in (tips from this ls-remote, remembered in
      // ~/.canon/browser-branch-tips.json per store); (2) the fetch is a plain have-negotiated fetch, so the server dedups against the
      // browser blobs already in main and sends only the genuinely-new ones.
      const TIPS_PATH = path.join(HOME, '.canon', 'browser-branch-tips.json');
      let tipsAll: Record<string, Record<string, string>> = {};
      try { tipsAll = JSON.parse(fs.readFileSync(TIPS_PATH, 'utf8')); } catch { /* none yet */ }
      const tips: Record<string, string> = tipsAll[STORE] ?? {};
      const heads = git(['ls-remote', '--heads', 'origin', 'browser-cortex-*']);
      for (const line of heads.split('\n')) {
        const m = line.match(/^([0-9a-f]{40})\s+refs\/heads\/(browser-cortex-[A-Za-z0-9_-]+)$/);
        if (!m) continue;
        const [, sha, branch] = m as unknown as [string, string, string];
        if (tips[branch] === sha) continue;   // unchanged since the last fold-in — nothing to fetch
        try {
          // NO --depth, NO --filter (2026-11-17, THIRD growth root cause). Two earlier variants both over-fetched:
          //  - `--depth 1` made the store SHALLOW; the grafts rode every later `fetch` of main and GitHub re-sent ~600 MB of already-held
          //    objects on each rebase-after-rejected-push.
          //  - `--filter=blob:none` fetched only commits/trees, so the `checkout … native/browser-cortex` below had to LAZILY fetch the
          //    browser blobs — and the promisor lazy-fetch over-sent a ~629 MB pack, 99.6% objects already local (14 such packs on 11-17).
          // A plain, full, have-negotiated fetch is the fix: git sends `have` lines for our refs (prior fold-ins put the browser blobs in
          // main), so the server returns ONLY the genuinely-new blobs of this branch; the checkout then finds every blob locally — no
          // lazy fetch, no shallow grafts. The tips-file skip above means this runs only when a branch tip actually moved.
          git(['fetch', 'origin', branch]);
          git(['checkout', 'FETCH_HEAD', '--', 'native/browser-cortex']);
          tips[branch] = sha;
          console.log(`[canon-sync] integrated browser branch ${branch} @ ${sha.slice(0, 10)}`);
        } catch (e) {
          console.warn(`[canon-sync] browser branch ${branch} integration failed: ${(e as Error)?.message ?? e}`);
        }
      }
      if (!DRY) {   // the folded files are in the working tree now; the add/commit below carries them even if this push fails
        try {
          tipsAll[STORE] = tips;
          fs.mkdirSync(path.dirname(TIPS_PATH), { recursive: true });
          fs.writeFileSync(TIPS_PATH, JSON.stringify(tipsAll));
        } catch { /* best effort: a lost tips file only costs one extra fetch per branch */ }
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
          const partMatch = e.name.match(/^(.*\.jsonl)\.part-(\d{4,})$/);
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
    dropArchivedDuplicates(STORE, 'canon-sync'); // archived sessions re-created by the browser fold-in / re-staged copies
    dropEchoedSessions(STORE, 'canon-sync'); // pulled sessions captured back under the puller's project dir (hosted -root)
    const stageOk = guardedAddAll(git, 'canon-sync');
    if (!stageOk && git(['status', '--porcelain']).trim()) {
      skipped.push('COMMIT ABORTED — mass-deletion guard (staged deletions reset)');
    } else if (stageOk) {
      git(['commit', '-q', '-m', `canon-sync: ${copied} file(s) updated, ${skipped.length} skipped`]);
      pushed = guardedPush(git, 'canon-sync');
      if (pushed) console.log(`[canon-sync] pushed: ${copied} copied, ${unchanged} unchanged, ${skipped.length} skipped, ${chunked} chunked, ${scrubbedHits} files had secrets scrubbed${unparseableCarried ? `, ${unparseableCarried} corrupt record(s) carried as canon-unparseable-line` : ''}, ${(appendWritten / 1e6).toFixed(2)} MB session bytes written${diverged.length ? `, ${diverged.length} DIVERGED sealed part(s)` : ''}`);
      else console.log(`[canon-sync] committed locally, push deferred to next cycle: ${copied} copied, ${unchanged} unchanged, ${skipped.length} skipped, ${chunked} chunked, ${scrubbedHits} files had secrets scrubbed${unparseableCarried ? `, ${unparseableCarried} corrupt record(s) carried as canon-unparseable-line` : ''}`);
    } else {
      console.log(`[canon-sync] no changes (${unchanged} unchanged, ${skipped.length} previously-skipped)`);
    }
    // Reclaim DUPLICATE packs left by the lazy over-fetch on `pull --rebase` (guardedPush): repackLooseIfNeeded only packs
    // LOOSE objects and auto-gc is disabled, so nothing else consolidates them (store ballooned 1.9 → 6.2 GB in ~4 h of pulls,
    // 11-18). Runs on every non-dry pass but is internally gated by size + a 6 h interval, so it fires rarely; it is INSIDE
    // the writer lock here (canonSync wraps canonSyncUnlocked in withStoreLock), so it never collides with the watcher/cron/CLI
    // — the collision that made every hand repack unusable. See repackAllIfNeeded.
    repackAllIfNeeded(STORE, 'canon-sync');
  } else {
    console.log(`[canon-sync DRY] would copy ${copied}, unchanged ${unchanged}, skip ${skipped.length}`);
    for (const s of skipped.slice(0, 10)) console.log('  skip:', s);
  }
  return { copied, unchanged, skipped, chunked, scrubbedHits, pushed, bytesWritten: appendWritten, diverged };
}

/** Sync under the store's single-writer lock (withStoreLock). */
export async function canonSync(o: CanonSyncOptions = {}): Promise<CanonSyncResult> {
  return withStoreLock(o.store ?? defaultCanonStore(), 'canon-sync', () => canonSyncUnlocked(o),
    () => ({ copied: 0, unchanged: 0, skipped: ['store busy — another canon writer held the lock'], chunked: 0, scrubbedHits: 0, pushed: false }));
}
