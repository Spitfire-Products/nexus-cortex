/**
 * canonSegments — segments by compaction (2026-11-15, operator-approved design).
 *
 * A SEGMENT is one compaction window of a session. Claude Code writes a `{"type":"system","subtype":"compact_boundary",
 * "compactMetadata":{…}}` record at each compaction, followed by a `{"type":"user","isCompactSummary":true}` record
 * holding the summary the next context starts from. Segment 0 runs from the session start to the first boundary; every
 * later segment starts AT a boundary. Boundaries are found by PARSING each line (never by substring — a real session had
 * 245 lines mentioning "compact_boundary", only 74 of them boundaries). A harness without such a marker (or a session
 * with none yet) is one segment. Detection is a small per-harness function (registerSegmentDetector) so another
 * harness format can add its marker later.
 *
 * ON-DISK LAYOUT (replaces the size cut `<id>.jsonl.part-NNNN` for new writes):
 *   <id>.jsonl.seg-SSSS.part-PPPP          the session's bytes, segment SSSS, size-limited sub-chunk PPPP
 *   <id>.events.jsonl.seg-SSSS.part-PPPP   the canon layer's events sidecar, split along the same segments
 *   <id>.segments.json                     the index (SegmentIndex below)
 * Concatenating every sub-chunk of every segment in name order (numeric — see compareChunkNames) reproduces the stored
 * session byte-for-byte. A CLOSED segment (one followed by another boundary) never changes again, so its files are never
 * rewritten. APPEND-ONLY PARTS (2026-11-17, see "writer" below): inside the open segment, too, a sealed part is never
 * rewritten — only the small open tail part (≤ sealBytes, default 256 KB) is, and it seals once it would grow past that.
 * The old names do not end in `.jsonl` and do not match the old `.part-NNNN` grouping, so a reader that predates this
 * layout ignores the files instead of mis-grouping them.
 *
 * Readers accept both layouts (chunkInfo / groupChunkFiles); when a logical file has both (a session re-chunked with
 * rechunkSession, whose old files are deliberately kept), the segmented files win.
 *
 * @module canon/canonSegments
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, type Hash } from 'node:crypto';

export const SEGMENT_INDEX_FORMAT = 'canon-segments/1';
/** The existing chunk size (canonSync / canonTranslate PART_BYTES). */
export const DEFAULT_PART_BYTES = 25 * 1024 * 1024;

// ── boundary detection (per harness) ─────────────────────────────────────────

export interface BoundaryInfo {
  trigger: string | null;
  preTokens: number | null;
  postTokens: number | null;
  durationMs: number | null;
}
/** Returns the boundary's metadata when `rec` (a PARSED record) opens a new compaction window, else null. */
export type BoundaryDetector = (rec: any) => BoundaryInfo | null;

/** Claude Code: `{"type":"system","subtype":"compact_boundary","compactMetadata":{trigger,preTokens,postTokens,durationMs}}`. */
export const claudeCodeBoundary: BoundaryDetector = (rec) => {
  if (!rec || typeof rec !== 'object' || rec.type !== 'system' || rec.subtype !== 'compact_boundary') return null;
  const cm = rec.compactMetadata && typeof rec.compactMetadata === 'object' ? rec.compactMetadata : {};
  return { trigger: cm.trigger ?? null, preTokens: cm.preTokens ?? null, postTokens: cm.postTokens ?? null, durationMs: cm.durationMs ?? null };
};

const DETECTORS = new Map<string, BoundaryDetector>([['claude-code', claudeCodeBoundary]]);

/** Register (or replace) the boundary detector for a harness label (the first path segment under native/ and canon/). */
export function registerSegmentDetector(harness: string, detect: BoundaryDetector): void { DETECTORS.set(harness, detect); }
/** The detector for a harness, or null (= the whole session is one segment). */
export function segmentDetectorFor(harness: string | null | undefined): BoundaryDetector | null {
  return (harness && DETECTORS.get(harness)) || null;
}

// ── index model + scanner ────────────────────────────────────────────────────

export interface SegmentFile { file: string; bytes: number; sha256: string }
export interface SegmentMeta {
  n: number;
  /** False only for the last segment (still growing). */
  closed: boolean;
  /** 0-based line range [lineStart, lineEnd) and byte range [byteStart, byteEnd) in the stored session. */
  lineStart: number; lineEnd: number;
  byteStart: number; byteEnd: number;
  firstTs: string | null; lastTs: string | null;
  /** Record counts by `type` (unparseable lines are kept as bytes but not counted). */
  records: Record<string, number>;
  /** First real user prompt (200 chars): not a compaction summary, meta, sidechain, tool result or `<…>` injection. */
  firstPrompt: string | null;
  /** The boundary that opened this segment (null for segment 0). */
  boundary: BoundaryInfo | null;
  /** The compaction summary that follows the boundary (600 chars). */
  summary: string | null;
  /** Sub-chunk files (basenames, in order) — present in a written index, absent when computed on the fly. */
  parts?: SegmentFile[];
  /** Events-sidecar sub-chunks for this segment (canon layer). */
  events?: SegmentFile[];
}
export interface SegmentIndex {
  format: typeof SEGMENT_INDEX_FORMAT;
  /** Basename of the logical session file (`<id>.jsonl`). */
  logical: string;
  harness: string | null;
  partBytes: number;
  /** Seal size of the open tail part when this index was written (absent in indexes written before 2026-11-17). */
  sealBytes?: number;
  lines: number;
  bytes: number;
  /** sha256 of the whole stored session (all sub-chunks concatenated). */
  sha256: string;
  segments: SegmentMeta[];
}

function codePoints(s: string, n: number): string {
  if (s.length <= n) return s;
  return Array.from(s.slice(0, n + 1)).slice(0, n).join('');
}
function textOf(msg: any): string {
  const c = msg?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) for (const b of c) if (b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string') return b.text;
  return '';
}
/** A person's prompt (port of session-split.py is_real_prompt). */
export function isRealPrompt(r: any): boolean {
  if (!r || r.type !== 'user' || r.isCompactSummary || r.isMeta || r.isSidechain) return false;
  const c = r.message?.content;
  if (Array.isArray(c) && c.some((b: any) => b && typeof b === 'object' && b.type === 'tool_result')) return false;
  const t = textOf(r.message).trim();
  return !!t && !t.startsWith('<') && !t.startsWith('[Request interrupted');
}

function newMeta(n: number, line: number, byte: number): SegmentMeta {
  return { n, closed: false, lineStart: line, lineEnd: line, byteStart: byte, byteEnd: byte, firstTs: null, lastTs: null,
    records: {}, firstPrompt: null, boundary: null, summary: null };
}

/** Streaming segment detector + index builder: feed every line in order. Port of session-split.py split(). */
export class SegmentScanner {
  readonly segments: SegmentMeta[] = [newMeta(0, 0, 0)];
  private line = 0;
  private bytes = 0;
  private expectSummary = false;
  constructor(private readonly detect: BoundaryDetector | null) {}

  /** Feed one line: its text (terminator stripped) and its stored byte length (terminator included). True when the line
   *  opens a new segment (it is then the first line of segments[segments.length - 1]). */
  feed(text: string, byteLen: number): boolean {
    let rec: any;
    try { rec = JSON.parse(text); } catch { rec = undefined; }   // a torn/corrupt line is kept as bytes, just not counted
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) rec = undefined;
    const b = rec && this.detect ? this.detect(rec) : null;
    let opened = false;
    if (b && this.line > 0) {
      const prev = this.segments[this.segments.length - 1]!;
      prev.closed = true;
      this.segments.push(newMeta(this.segments.length, this.line, this.bytes));
      opened = true;
    }
    const m = this.segments[this.segments.length - 1]!;
    if (rec) {
      const t = typeof rec.type === 'string' ? rec.type : '?';
      m.records[t] = (m.records[t] ?? 0) + 1;
      if (typeof rec.timestamp === 'string') { m.firstTs ??= rec.timestamp; m.lastTs = rec.timestamp; }
      if (b) { m.boundary = b; this.expectSummary = true; }
      else if (this.expectSummary && rec.isCompactSummary) { m.summary = codePoints(textOf(rec.message), 600); this.expectSummary = false; }
      else if (m.firstPrompt === null && isRealPrompt(rec)) m.firstPrompt = codePoints(textOf(rec.message).trim().replace(/\n/g, ' '), 200);
    }
    this.line++; this.bytes += byteLen;
    m.lineEnd = this.line; m.byteEnd = this.bytes;
    return opened;
  }
  get lineCount(): number { return this.line; }
  get byteCount(): number { return this.bytes; }
}

function stripTerminator(b: Buffer): string {
  let end = b.length;
  if (end && b[end - 1] === 0x0a) end--;
  if (end && b[end - 1] === 0x0d) end--;
  return b.toString('utf8', 0, end);
}

/** Byte-exact line reader: yields each line WITH its '\n' (the final line may lack one). Never splits a line. */
export function* fileLinesExact(file: string, blockBytes = 8 * 1024 * 1024): Generator<Buffer> {
  const fd = fs.openSync(file, 'r');
  const block = Buffer.allocUnsafe(blockBytes);
  let carry: Buffer[] = [];
  try {
    for (;;) {
      const n = fs.readSync(fd, block, 0, block.length, null);
      if (n === 0) break;
      const view = block.subarray(0, n);
      let s = 0;
      for (;;) {
        const i = view.indexOf(0x0a, s);
        if (i < 0) { carry.push(Buffer.from(view.subarray(s))); break; }
        const piece = view.subarray(s, i + 1);
        yield carry.length ? Buffer.concat([...carry, piece]) : Buffer.from(piece);
        carry = [];
        s = i + 1;
      }
    }
    if (carry.length) { const last = Buffer.concat(carry); if (last.length) yield last; }
  } finally { fs.closeSync(fd); }
}

// ── names ────────────────────────────────────────────────────────────────────

// Part / segment numbers are written 4-digit zero-padded and WIDEN past 9999 (`part-10000`): readers accept 4+ digits and order
// chunks NUMERICALLY (compareChunkNames), so a long-lived session's 10,000th part sorts after its 9,999th. (A reader from before
// 2026-11-17 ignores a 5-digit name instead of mis-ordering it; at the 256 KB seal size that is ≥ 2.5 GB in ONE segment.)
const SEG_RE = /^(.*)\.seg-(\d{4,})\.part-(\d{4,})$/;
const PART_RE = /^(.*)\.part-(\d{4,})$/;
const pad4 = (n: number) => String(n).padStart(4, '0');

export interface ChunkInfo { logical: string; layout: 'seg' | 'part' | 'single'; seg?: number; part?: number }
/** Classify a file NAME: segmented sub-chunk, old size part, or a single file. `logical` is the logical basename. */
export function chunkInfo(name: string): ChunkInfo {
  let m = name.match(SEG_RE);
  if (m) return { logical: m[1]!, layout: 'seg', seg: Number(m[2]), part: Number(m[3]) };
  m = name.match(PART_RE);
  if (m) return { logical: m[1]!, layout: 'part', part: Number(m[2]) };
  return { logical: name, layout: 'single' };
}
/** The logical path of a stored file (`…/x.jsonl.seg-0001.part-0000` and `…/x.jsonl.part-0003` → `…/x.jsonl`). */
export function logicalPathOf(p: string): string {
  return path.join(path.dirname(p), chunkInfo(path.basename(p)).logical);
}
export function isSegmentChunk(p: string): boolean { return SEG_RE.test(path.basename(p)); }
/** Reassembly order of two stored files (paths or names): logical name, then the single form first, then segment, then part —
 *  numbers compared numerically (a plain string sort puts `part-10000` before `part-9999`). */
export function compareChunkNames(a: string, b: string): number {
  const x = chunkInfo(path.basename(a)), y = chunkInfo(path.basename(b));
  const da = path.dirname(a), db = path.dirname(b);
  if (da !== db) return da < db ? -1 : 1;
  if (x.logical !== y.logical) return x.logical < y.logical ? -1 : 1;
  const rank = (c: ChunkInfo) => (c.layout === 'single' ? 0 : 1);
  if (rank(x) !== rank(y)) return rank(x) - rank(y);
  const sx = x.seg ?? -1, sy = y.seg ?? -1;
  if (sx !== sy) return sx - sy;
  return (x.part ?? -1) - (y.part ?? -1);
}
/** A logical file's stored files in reassembly order. Segmented files win over an old layout kept beside them. */
export function orderChunks(files: string[]): string[] {
  const seg = files.filter(isSegmentChunk);
  return (seg.length ? seg : files).slice().sort(compareChunkNames);
}
/** Group stored file paths by logical path (both layouts), each group in reassembly order. */
export function groupChunkFiles(files: Iterable<string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const l = logicalPathOf(f);
    (groups.get(l) ?? groups.set(l, []).get(l)!).push(f);
  }
  for (const [l, fs_] of groups) groups.set(l, orderChunks(fs_));
  return groups;
}
/** `…/<id>.jsonl` → `…/<id>.segments.json`. */
export function segmentIndexPath(logicalAbs: string): string {
  const base = path.basename(logicalAbs).replace(/\.jsonl$/, '');
  return path.join(path.dirname(logicalAbs), `${base}.segments.json`);
}
export function readSegmentIndex(logicalAbs: string): SegmentIndex | null {
  try {
    const idx = JSON.parse(fs.readFileSync(segmentIndexPath(logicalAbs), 'utf8'));
    return idx?.format === SEGMENT_INDEX_FORMAT && Array.isArray(idx.segments) ? idx as SegmentIndex : null;
  } catch { return null; }
}
/** Old size-cut parts present for a logical file (`<logical>.part-NNNN`). */
export function hasOldParts(logicalAbs: string): boolean {
  const dir = path.dirname(logicalAbs); const base = path.basename(logicalAbs) + '.part-';
  try { return fs.readdirSync(dir).some((n) => n.startsWith(base) && /^\d{4,}$/.test(n.slice(base.length))); } catch { return false; }
}
/** The old-layout parts of a logical file (`<logical>.part-NNNN`), absolute, in numeric order. */
export function oldPartsOf(logicalAbs: string): string[] {
  const dir = path.dirname(logicalAbs); const base = path.basename(logicalAbs) + '.part-';
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.startsWith(base) && /^\d{4,}$/.test(n.slice(base.length))).map((n) => path.join(dir, n)).sort(compareChunkNames);
}

// ── writer (APPEND-ONLY parts, 2026-11-17) ───────────────────────────────────
//
// Before 2026-11-17 the open segment's last sub-chunk (up to 25 MB) — and every session under 50 MB as one whole file — was
// rewritten on EVERY sync, so each sync stored a fresh full git blob of the live transcript (measured 11-16/17: ~470 MB of native/
// blobs + ~445 MB of canon/ blobs in 6 h for a few MB of new records). Now a part file, once SEALED, is never rewritten:
//  - each run VERIFIES the bytes already stored (sha256 from the index, else the file) and appends only what lies beyond them;
//  - the last part is the OPEN tail: it takes more lines while it stays ≤ sealBytes (default 256 KB — rewritten while small), and
//    seals unchanged the moment the next line would push it past. A big existing tail (a 25 MB legacy part) therefore seals as-is;
//  - bytes beyond the store go to NEW parts cut at partBytes (25 MB), so a first capture is a few big parts, not thousands of tiny ones;
//  - a sealed part whose bytes no longer match the source (rewritten / truncated in the middle) is LOGGED and the stream is
//    rewritten from that part on (the previous bytes stay in git history) — never a silent duplicate, never a silent drop.
// Store growth per sync is therefore ≈ the new bytes + the open tail (≤ sealBytes) + the small index, not a copy of the session.

/** Default seal size of the open tail part (env CANON_SEAL_BYTES / option sealBytes override). */
export const DEFAULT_SEAL_BYTES = 256 * 1024;

/** The seal size in effect: an explicit option, else env CANON_SEAL_BYTES, else DEFAULT_SEAL_BYTES — never above partBytes. */
export function resolveSealBytes(opt: number | undefined, partBytes: number = DEFAULT_PART_BYTES): number {
  const env = Number(process.env.CANON_SEAL_BYTES);
  const v = opt !== undefined && opt > 0 ? opt : Number.isFinite(env) && env > 0 ? env : DEFAULT_SEAL_BYTES;
  return Math.max(1, Math.min(v, partBytes));
}

/** A part already in the store. `abs` overrides where its bytes are read for verification (dry-run adoption). */
export interface StoredPart { file: string; bytes: number; sha256?: string; abs?: string }

export interface AppendStats {
  /** Stored parts verified identical and left untouched. */
  verified: number;
  /** Bytes written this run (new parts + rewritten open tails). */
  bytesWritten: number;
  /** Open-tail rewrites with different content (a growing tail, or translate's still-changing tail records). */
  openRewrites: number;
  /** SEALED parts that no longer matched the source — the stream was rewritten from there (each one logged). */
  diverged: string[];
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Shared write/verify bookkeeping of one logical file (main + events streams). */
class PartStore {
  readonly keep = new Set<string>();
  readonly written: string[] = [];
  readonly unchanged: string[] = [];
  readonly removed: string[] = [];
  readonly stats: AppendStats = { verified: 0, bytesWritten: 0, openRewrites: 0, diverged: [] };
  constructor(readonly dir: string, private readonly prev: Map<string, SegmentFile>, private readonly dryRun: boolean,
    private readonly quietOpen: boolean, private readonly log: (m: string) => void) {}

  /** True when `data` equals the stored part (index sha256 + on-disk size, else a byte compare against the file). */
  matches(p: StoredPart, data: Buffer): boolean {
    if (data.length !== p.bytes) return false;
    const abs = p.abs ?? path.join(this.dir, p.file);
    let size = -1;
    try { size = fs.statSync(abs).size; } catch { return false; }
    if (size !== p.bytes) return false;
    if (p.sha256) return sha256(data) === p.sha256;
    try { return fs.readFileSync(abs).equals(data); } catch { return false; }
  }
  /** A stored part kept as-is (verified; nothing written). */
  keepPart(p: StoredPart, data: Buffer): SegmentFile {
    this.keep.add(p.file); this.unchanged.push(path.join(this.dir, p.file)); this.stats.verified++;
    return { file: p.file, bytes: p.bytes, sha256: p.sha256 ?? sha256(data) };
  }
  /** Write one part unless the stored bytes are already identical. */
  store(name: string, data: Buffer): SegmentFile {
    const sha = sha256(data);
    const abs = path.join(this.dir, name);
    this.keep.add(name);
    let size = -1;
    try { size = fs.statSync(abs).size; } catch { /* absent */ }
    const prev = this.prev.get(name);
    const same = size === data.length && (prev ? prev.sha256 === sha && prev.bytes === data.length : fs.readFileSync(abs).equals(data));
    if (same) this.unchanged.push(abs);
    else { if (!this.dryRun) fs.writeFileSync(abs, data); this.written.push(abs); this.stats.bytesWritten += data.length; }
    return { file: name, bytes: data.length, sha256: sha };
  }
  diverge(msg: string): void { this.stats.diverged.push(msg); this.log(`[canon-parts] ${msg}`); }
  openRewrite(kind: 'grew-line' | 'changed' | 'shrunk', label: string): void {
    this.stats.openRewrites++;
    if (!this.quietOpen && kind !== 'grew-line') this.log(`[canon-parts] ${label}: the open tail part ${kind === 'shrunk' ? 'is longer than the source (source shrank)' : 'changed'} — rewritten`);
  }
}

/** One append-only stream of parts (a segment's main bytes, its events, or an old-layout session). See the block comment above. */
class PartRun {
  readonly out: SegmentFile[] = [];
  private buf: Buffer[] = [];
  private bufBytes = 0;
  private mode: 'verify' | 'grow' | 'fresh';
  /** grow mode: the buffer still equals the stored open part (nothing appended, nothing changed). */
  private growIntact = false;
  /** An unstable line was pushed this run: nothing after it is sealed (except at the partBytes hard cap). */
  private unstable = false;
  private divergedHere = false;
  constructor(private readonly existing: StoredPart[], private readonly lastOpen: boolean, private readonly name: (i: number) => string,
    private readonly sealBytes: number, private readonly partBytes: number, private readonly ps: PartStore, private readonly label: string) {
    this.mode = existing.length ? 'verify' : 'fresh';
  }
  private get i(): number { return this.out.length; }
  private isOpen(i: number): boolean { return this.lastOpen && i === this.existing.length - 1; }
  private data(): Buffer { return this.buf.length === 1 ? this.buf[0]! : Buffer.concat(this.buf, this.bufBytes); }
  private append(b: Buffer, stable: boolean): void { this.buf.push(b); this.bufBytes += b.length; if (!stable) this.unstable = true; }
  private sealedMismatch(e: StoredPart, why: string): void {
    this.divergedHere = true;
    this.ps.diverge(`${this.label}: sealed part ${e.file} ${why} — the source changed in the middle; rewriting from this part (previous bytes stay in git history)`);
    this.mode = 'fresh';
  }

  push(b: Buffer, stable = true): void {
    if (this.mode === 'verify') {
      const e = this.existing[this.i];
      if (!e) this.mode = 'fresh';
      else if (this.bufBytes + b.length <= e.bytes) {
        this.append(b, stable);
        if (this.bufBytes < e.bytes) return;
        const same = this.ps.matches(e, this.data());
        if (this.isOpen(this.i)) { this.mode = 'grow'; this.growIntact = same; if (!same) this.ps.openRewrite('changed', this.label); return; }
        if (same) {
          this.out.push(this.ps.keepPart(e, this.data())); this.buf = []; this.bufBytes = 0;
          if (this.i >= this.existing.length) this.mode = 'fresh';
          return;
        }
        this.sealedMismatch(e, 'differs');
        return;
      } else if (this.isOpen(this.i)) {
        // The line runs past the stored tail's end: an unterminated last line that has since completed (normal), or a changed tail.
        this.mode = 'grow'; this.growIntact = false; this.ps.openRewrite('grew-line', this.label);
      } else this.sealedMismatch(e, 'ends mid-line');
    }
    const limit = this.mode === 'grow' ? this.sealBytes : this.partBytes;
    if (this.bufBytes > 0 && this.bufBytes + b.length > limit && (!this.unstable || this.bufBytes + b.length > this.partBytes)) this.flush();
    if (this.mode === 'grow') this.growIntact = false;
    this.append(b, stable);
  }

  private flush(): void {
    if (!this.bufBytes) return;
    const e = this.existing[this.i];
    if (this.mode === 'grow' && this.growIntact && e) this.out.push(this.ps.keepPart(e, this.data()));   // the open tail sealed unchanged
    else this.out.push(this.ps.store(this.name(this.i), this.data()));
    this.buf = []; this.bufBytes = 0; this.mode = 'fresh'; this.growIntact = false;
  }

  finish(): SegmentFile[] {
    if (this.mode === 'verify' && this.bufBytes > 0) {
      const e = this.existing[this.i]!;
      if (this.isOpen(this.i)) { this.mode = 'grow'; this.growIntact = false; this.ps.openRewrite('shrunk', this.label); }
      else this.sealedMismatch(e, `holds more bytes than the source (${e.bytes} stored, ${this.bufBytes} in the source)`);
    }
    this.flush();
    if (!this.divergedHere) {
      for (let k = this.out.length; k < this.existing.length; k++) {
        if (this.isOpen(k)) this.ps.openRewrite('shrunk', this.label);
        else { this.sealedMismatch(this.existing[k]!, 'lies past the end of the source (the source shrank); it leaves the working tree'); break; }
      }
    }
    return this.out;
  }
}

/** True when the file holds at most one compaction segment (stops reading at the second boundary). */
function holdsOneSegment(file: string, harness: string | null | undefined): boolean {
  const sc = new SegmentScanner(segmentDetectorFor(harness));
  for (const line of fileLinesExact(file)) {
    sc.feed(stripTerminator(line), line.length);
    if (sc.segments.length > 1) return false;
  }
  return true;
}
const fileSize = (abs: string): number => { try { return fs.statSync(abs).size; } catch { return -1; } };

export interface SegmentedWriteOptions {
  /** Harness label — picks the boundary detector (null/unknown = one segment). */
  harness?: string | null;
  /** Size cap of a NEW part (default 25 MB). */
  partBytes?: number;
  /** Seal size of the open tail part (default resolveSealBytes: CANON_SEAL_BYTES, else 256 KB; never above partBytes). */
  sealBytes?: number;
  /** Compute the index and the file plan; write, rename and remove nothing. */
  dryRun?: boolean;
  /** This writer owns the session's events-sidecar files too (canon layer): stale segmented events files are removed even
   *  when finish() gets no events. The native layer has no sidecar and leaves such names alone. */
  ownsEvents?: boolean;
  /** A single-file form `<logical>` already stored (no index yet): ADOPT it as segment 0's first part by renaming it — zero new
   *  bytes in git — when it is ≥ sealBytes and holds one segment (its events single too, with ownsEvents); otherwise it is
   *  replaced by the segmented files (removed once they are written). */
  adoptSingle?: boolean;
  /** Keep the session as ONE file `<logical>` while its total is ≤ this many bytes (a small session IS its open tail). */
  singleBelow?: number;
  /** Do not log open-tail rewrites (translate: its tail records legitimately change while the session grows). */
  quietOpen?: boolean;
  log?: (msg: string) => void;
}
export interface SegmentedWriteResult {
  index: SegmentIndex;
  indexPath: string;
  /** 'single' = written as one small file `<logical>` (singleBelow); no index file. */
  layout: 'segmented' | 'single';
  /** Files (abs) written this run (new or changed bytes). */
  written: string[];
  /** Files (abs) whose bytes were already identical — not touched (mtime kept). */
  unchanged: string[];
  /** Stale files of this session removed (this layout's own names, or a replaced single form). */
  removed: string[];
  stats: AppendStats;
}

/**
 * Write one session in the segmented layout, APPEND-ONLY. push() every stored line in order (WITH its '\n'; the final line may lack
 * it — its bytes are kept exactly, and it is never sealed), then finish(). `stable = false` marks a line a later run may still
 * change (translate's tail): it is never sealed this run. Closed segments and sealed parts keep identical bytes and mtimes.
 */
export class SegmentedWriter {
  private readonly scanner: SegmentScanner;
  private readonly partBytes: number;
  private readonly sealBytes: number;
  private readonly dir: string;
  private readonly base: string;
  private readonly eventsBase: string;
  private readonly prevSegs: SegmentMeta[] | null;
  private readonly whole: Hash = createHash('sha256');
  private readonly ps: PartStore;
  private readonly log: (m: string) => void;
  private adoptedMain: StoredPart | null = null;
  private adoptedEvents: StoredPart | null = null;
  private replaceSingle = false;
  private pending: { b: Buffer; stable: boolean; n: number }[] | null = null;
  private pendingBytes = 0;
  private run: PartRun | null = null;
  private runSeg = -1;

  constructor(private readonly logicalAbs: string, private readonly o: SegmentedWriteOptions = {}) {
    this.scanner = new SegmentScanner(segmentDetectorFor(o.harness));
    this.partBytes = o.partBytes ?? DEFAULT_PART_BYTES;
    this.sealBytes = resolveSealBytes(o.sealBytes, this.partBytes);
    this.dir = path.dirname(logicalAbs);
    this.base = path.basename(logicalAbs);
    this.eventsBase = this.base.replace(/\.jsonl$/, '.events.jsonl');
    this.log = o.log ?? ((m) => console.log(m));
    const prevIdx = readSegmentIndex(logicalAbs);
    this.prevSegs = prevIdx?.segments ?? null;
    const prev = new Map<string, SegmentFile>();
    for (const s of this.prevSegs ?? []) for (const f of [...(s.parts ?? []), ...(s.events ?? [])]) prev.set(f.file, f);
    this.ps = new PartStore(this.dir, prev, !!o.dryRun, !!o.quietOpen, this.log);
    if (!o.dryRun) fs.mkdirSync(this.dir, { recursive: true });
    if (!this.prevSegs && o.adoptSingle) {
      const size = fileSize(logicalAbs);
      if (size >= this.sealBytes && holdsOneSegment(logicalAbs, o.harness)) {
        this.adoptedMain = this.adopt(logicalAbs, `${this.base}.seg-${pad4(0)}.part-${pad4(0)}`, size);
        const evSingle = path.join(this.dir, this.eventsBase);
        const evSize = o.ownsEvents ? fileSize(evSingle) : -1;
        if (evSize > 0) this.adoptedEvents = this.adopt(evSingle, `${this.eventsBase}.seg-${pad4(0)}.part-${pad4(0)}`, evSize);
      } else if (size >= 0) this.replaceSingle = true;
    }
    if (!this.prevSegs && !this.adoptedMain && o.singleBelow !== undefined && o.singleBelow > 0) this.pending = [];
  }

  /** Rename a stored single file to its part name (same blob → no new bytes in git). Dry run: verify against the single in place. */
  private adopt(singleAbs: string, partName: string, bytes: number): StoredPart {
    if (this.o.dryRun) return { file: partName, bytes, abs: singleAbs };
    fs.renameSync(singleAbs, path.join(this.dir, partName));
    this.log(`[canon-parts] adopted ${path.basename(singleAbs)} as ${partName} (renamed, not rewritten)`);
    return { file: partName, bytes };
  }

  push(line: Buffer | string, stable = true): void {
    const b = typeof line === 'string' ? Buffer.from(line, 'utf8') : line;
    this.scanner.feed(stripTerminator(b), b.length);
    this.whole.update(b);
    const n = this.scanner.segments.length - 1;
    if (this.pending) {
      this.pending.push({ b, stable, n }); this.pendingBytes += b.length;
      if (this.pendingBytes <= this.o.singleBelow!) return;
      const p = this.pending; this.pending = null;
      for (const x of p) this.route(x.b, x.stable, x.n);
      return;
    }
    this.route(b, stable, n);
  }

  private route(b: Buffer, stable: boolean, n: number): void {
    if (n !== this.runSeg || !this.run) { this.closeRun(); this.startRun(n); }
    this.run!.push(b, stable);
  }
  /** Was segment n the open (last, unclosed) segment of the stored index? Its last part is then the open tail. */
  private wasOpen(n: number): boolean {
    if (this.prevSegs) return !!this.prevSegs[n] && !this.prevSegs[n]!.closed;
    return n === 0 && !!this.adoptedMain;
  }
  private startRun(n: number): void {
    const existing: StoredPart[] = this.prevSegs?.[n]?.parts ?? (n === 0 && this.adoptedMain ? [this.adoptedMain] : []);
    this.run = new PartRun(existing, this.wasOpen(n), (i) => `${this.base}.seg-${pad4(n)}.part-${pad4(i)}`,
      this.sealBytes, this.partBytes, this.ps, `${this.base} seg ${n}`);
    this.runSeg = n;
  }
  private closeRun(): void {
    if (!this.run) return;
    this.scanner.segments[this.runSeg]!.parts = this.run.finish();
    this.run = null;
  }

  /**
   * Close the session. `events` (canon layer): an events-sidecar file to split along the same segments; `cuts` are the byte offsets
   * in that file where segments 1, 2, … begin (events past the last segment go to the last one); `stableBytes`: event bytes at or
   * past this offset are never sealed this run.
   */
  finish(events?: { file: string; cuts: number[]; stableBytes?: number }): SegmentedWriteResult {
    const segs = this.scanner.segments;
    const indexPath = segmentIndexPath(this.logicalAbs);
    const mkIndex = (): SegmentIndex => ({
      format: SEGMENT_INDEX_FORMAT, logical: this.base, harness: this.o.harness ?? null, partBytes: this.partBytes, sealBytes: this.sealBytes,
      lines: this.scanner.lineCount, bytes: this.scanner.byteCount, sha256: this.whole.digest('hex'), segments: segs,
    });
    const ps = this.ps;
    if (this.pending) {
      // Small session: one file, the open tail itself (rewritten while small — the old whole-file path, but only below singleBelow).
      ps.store(this.base, Buffer.concat(this.pending.map((x) => x.b), this.pendingBytes));
      return { index: mkIndex(), indexPath, layout: 'single', written: ps.written, unchanged: ps.unchanged, removed: ps.removed, stats: ps.stats };
    }
    this.closeRun();
    for (let k = segs.length; k < (this.prevSegs?.length ?? 0); k++) {
      if (this.prevSegs![k]!.closed) { ps.diverge(`${this.base}: stored segment ${k} has no counterpart in the source (the source shrank or its compactions moved)`); break; }
    }
    if (events) {
      const stableAt = events.stableBytes ?? Infinity;
      let off = 0, cur = -1; let er: PartRun | null = null;
      const closeEv = () => { if (er) { segs[cur]!.events = er.finish(); er = null; } };
      for (const line of fileLinesExact(events.file)) {
        let k = 0;
        while (k < events.cuts.length && events.cuts[k]! <= off) k++;
        k = Math.min(k, segs.length - 1);
        if (k !== cur || !er) {
          closeEv(); cur = k;
          const existing: StoredPart[] = this.prevSegs?.[k]?.events ?? (k === 0 && this.adoptedEvents ? [this.adoptedEvents] : []);
          er = new PartRun(existing, this.wasOpen(k), (i) => `${this.eventsBase}.seg-${pad4(k)}.part-${pad4(i)}`,
            this.sealBytes, this.partBytes, ps, `${this.eventsBase} seg ${k}`);
        }
        off += line.length;
        er!.push(line, off <= stableAt);
      }
      closeEv();
    }
    const index = mkIndex();
    const body = renderSegmentIndex(index);
    let prevBody = '';
    try { prevBody = fs.readFileSync(indexPath, 'utf8'); } catch { /* none */ }
    if (prevBody !== body) { if (!this.o.dryRun) fs.writeFileSync(indexPath, body); ps.written.push(indexPath); ps.stats.bytesWritten += Buffer.byteLength(body); }
    // Stale files of THIS layout only (the session got shorter, or a segment re-cut): never an old-layout file.
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const own = new RegExp(`^(${esc(this.base)}|${esc(this.eventsBase)})\\.seg-\\d{4,}\\.part-\\d{4,}$`);
    let names: string[] = [];
    try { names = fs.readdirSync(this.dir); } catch { /* dry run on a new dir */ }
    for (const n of names) {
      if (!own.test(n) || ps.keep.has(n)) continue;
      if (this.adoptedMain?.file === n || this.adoptedEvents?.file === n) continue;   // dry run: the adoption was not performed
      if (!events && !this.o.ownsEvents && n.startsWith(this.eventsBase + '.')) continue; // a main-only writer (native) leaves events files alone
      const abs = path.join(this.dir, n);
      if (!this.o.dryRun) fs.unlinkSync(abs);
      ps.removed.push(abs);
    }
    if (this.replaceSingle) {
      const singles = [this.logicalAbs, ...(this.o.ownsEvents ? [path.join(this.dir, this.eventsBase)] : [])];
      for (const abs of singles) if (fs.existsSync(abs)) { if (!this.o.dryRun) fs.unlinkSync(abs); ps.removed.push(abs); }
    }
    return { index, indexPath, layout: 'segmented', written: ps.written, unchanged: ps.unchanged, removed: ps.removed, stats: ps.stats };
  }
}

/** The index file body: compact JSON, one segment per line (2026-11-17 — the index is rewritten on every sync of a growing
 *  session, so it is kept small; the old pretty-printed form was ~2× larger). Any JSON reader parses both forms. */
export function renderSegmentIndex(index: SegmentIndex): string {
  const { segments, ...head } = index;
  return JSON.stringify(head).slice(0, -1) + ',"segments":[\n' + segments.map((x) => JSON.stringify(x)).join(',\n') + '\n]}\n';
}

/** Write a whole file (or several old parts, concatenated in order) in the segmented layout. */
export function writeSegmentedFromFiles(sources: string[], logicalAbs: string, o: SegmentedWriteOptions = {}): SegmentedWriteResult {
  const w = new SegmentedWriter(logicalAbs, o);
  for (const src of sources) for (const line of fileLinesExact(src)) w.push(line);
  return w.finish();
}

export interface PlainWriteOptions {
  partBytes?: number;
  sealBytes?: number;
  dryRun?: boolean;
  /** A single-file form `<logical>` already stored (no parts yet): ADOPT it as `.part-0000` by renaming it when it is ≥ sealBytes,
   *  else replace it (removed once the parts are written). */
  adoptSingle?: boolean;
  quietOpen?: boolean;
  log?: (msg: string) => void;
}
export interface PlainWriteResult { files: SegmentFile[]; written: string[]; unchanged: string[]; removed: string[]; stats: AppendStats }

/**
 * The OLD size-cut layout (`<logical>.part-NNNN`, no index), continued APPEND-ONLY: the parts already stored are verified (byte
 * compare — there is no index to hold their sha256) and never rewritten; new bytes go to the open tail / new parts exactly as in
 * the segmented layout. Readers that concatenate the parts in order keep working unchanged.
 */
export class PlainPartWriter {
  private readonly ps: PartStore;
  private readonly run: PartRun;
  private readonly base: string;
  private readonly dir: string;
  private replaceSingle = false;
  private adopted: StoredPart | null = null;
  constructor(private readonly logicalAbs: string, private readonly o: PlainWriteOptions = {}) {
    const partBytes = o.partBytes ?? DEFAULT_PART_BYTES;
    const sealBytes = resolveSealBytes(o.sealBytes, partBytes);
    this.dir = path.dirname(logicalAbs); this.base = path.basename(logicalAbs);
    const log = o.log ?? ((m: string) => console.log(m));
    this.ps = new PartStore(this.dir, new Map(), !!o.dryRun, !!o.quietOpen, log);
    if (!o.dryRun) fs.mkdirSync(this.dir, { recursive: true });
    const existing: StoredPart[] = oldPartsOf(logicalAbs).map((abs) => ({ file: path.basename(abs), bytes: fileSize(abs) }));
    if (!existing.length && o.adoptSingle) {
      const size = fileSize(logicalAbs);
      if (size >= sealBytes) {
        const name = `${this.base}.part-${pad4(0)}`;
        if (o.dryRun) this.adopted = { file: name, bytes: size, abs: logicalAbs };
        else { fs.renameSync(logicalAbs, path.join(this.dir, name)); this.adopted = { file: name, bytes: size }; log(`[canon-parts] adopted ${this.base} as ${name} (renamed, not rewritten)`); }
        existing.push(this.adopted);
      } else if (size >= 0) this.replaceSingle = true;
    }
    this.run = new PartRun(existing, true, (i) => `${this.base}.part-${pad4(i)}`, sealBytes, partBytes, this.ps, this.base);
  }
  push(line: Buffer | string, stable = true): void { this.run.push(typeof line === 'string' ? Buffer.from(line, 'utf8') : line, stable); }
  finish(): PlainWriteResult {
    const files = this.run.finish();
    const ps = this.ps;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const own = new RegExp(`^${esc(this.base)}\\.part-\\d{4,}$`);
    let names: string[] = [];
    try { names = fs.readdirSync(this.dir); } catch { /* dry run on a new dir */ }
    for (const n of names) {
      if (!own.test(n) || ps.keep.has(n) || this.adopted?.file === n) continue;
      const abs = path.join(this.dir, n);
      if (!this.o.dryRun) fs.unlinkSync(abs);
      ps.removed.push(abs);
    }
    if (this.replaceSingle && files.length && fs.existsSync(this.logicalAbs)) { if (!this.o.dryRun) fs.unlinkSync(this.logicalAbs); ps.removed.push(this.logicalAbs); }
    return { files, written: ps.written, unchanged: ps.unchanged, removed: ps.removed, stats: ps.stats };
  }
}

// ── segment retrieval ────────────────────────────────────────────────────────

/** Segments of a logical session stored as `files` (either layout): the written index when the files are segmented,
 *  else computed by scanning the bytes (one pass, nothing written). */
export function segmentsOfFiles(files: string[], harness: string | null): SegmentMeta[] {
  if (files.length && files.every(isSegmentChunk)) {
    const idx = readSegmentIndex(logicalPathOf(files[0]!));
    if (idx) return idx.segments;
  }
  const sc = new SegmentScanner(segmentDetectorFor(harness));
  for (const f of files) for (const line of fileLinesExact(f)) sc.feed(stripTerminator(line), line.length);
  return sc.segments;
}

/** The exact stored bytes of segment `n`, in order (index sub-chunks when segmented, else a byte-exact scan). */
export function* segmentBytesOfFiles(files: string[], harness: string | null, n: number): Generator<Buffer> {
  if (files.length && files.every(isSegmentChunk)) {
    const logical = logicalPathOf(files[0]!);
    const idx = readSegmentIndex(logical);
    if (idx) {
      const seg = idx.segments[n];
      if (!seg) throw new Error(`segment ${n} out of range (0–${idx.segments.length - 1})`);
      for (const p of seg.parts ?? []) yield fs.readFileSync(path.join(path.dirname(logical), p.file));
      return;
    }
  }
  const sc = new SegmentScanner(segmentDetectorFor(harness));
  let found = false;
  for (const f of files) for (const line of fileLinesExact(f)) {
    sc.feed(stripTerminator(line), line.length);
    const cur = sc.segments.length - 1;
    if (cur === n) { found = true; yield line; }
    else if (cur > n) return;
  }
  if (!found) throw new Error(`segment ${n} out of range (0–${sc.segments.length - 1})`);
}

/** Same as segmentBytesOfFiles over a line stream (archived sessions read from git objects). */
export async function* segmentLinesOfStream(lines: AsyncIterable<string>, harness: string | null, n: number): AsyncGenerator<string> {
  const sc = new SegmentScanner(segmentDetectorFor(harness));
  let found = false;
  for await (const l of lines) {
    sc.feed(l, Buffer.byteLength(l) + 1);
    const cur = sc.segments.length - 1;
    if (cur === n) { found = true; yield l; }
    else if (cur > n) return;
  }
  if (!found) throw new Error(`segment ${n} out of range (0–${sc.segments.length - 1})`);
}
export async function segmentsOfStream(lines: AsyncIterable<string>, harness: string | null): Promise<SegmentMeta[]> {
  const sc = new SegmentScanner(segmentDetectorFor(harness));
  for await (const l of lines) sc.feed(l, Buffer.byteLength(l) + 1);
  return sc.segments;
}

/** One-line-per-segment table + summaries (the CLI's `list --segments`). */
export function renderSegments(segs: SegmentMeta[]): string {
  const rows: string[] = ['seg   lines              MB  from              to                compaction (pre→post)    first prompt'];
  for (const s of segs) {
    const b = s.boundary;
    const comp = b ? `${b.trigger ?? '?'} ${b.preTokens ?? '?'}→${b.postTokens ?? '?'}` : 'session start';
    rows.push(`${pad4(s.n)}  ${`${s.lineStart}–${s.lineEnd}`.padEnd(17)} ${((s.byteEnd - s.byteStart) / 1e6).toFixed(1).padStart(5)}  ` +
      `${(s.firstTs ?? '').slice(0, 16).padEnd(16)}  ${(s.lastTs ?? '').slice(0, 16).padEnd(16)}  ${comp.padEnd(23)}  ` +
      `${(s.firstPrompt ?? '').slice(0, 90)}${s.closed ? '' : '  [open]'}`);
    if (s.summary) rows.push(`      summary: ${s.summary.replace(/\s+/g, ' ').slice(0, 240)}`);
  }
  return rows.join('\n');
}
