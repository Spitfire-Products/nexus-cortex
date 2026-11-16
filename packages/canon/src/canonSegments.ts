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
 * Concatenating every sub-chunk of every segment in name order reproduces the stored session byte-for-byte. A CLOSED
 * segment (one followed by another boundary) never changes again, so its files are never rewritten; only the open
 * last segment's last sub-chunk grows. The old names do not end in `.jsonl` and do not match the old `.part-NNNN`
 * grouping, so a reader that predates this layout ignores the files instead of mis-grouping them.
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

const SEG_RE = /^(.*)\.seg-(\d{4})\.part-(\d{4})$/;
const PART_RE = /^(.*)\.part-(\d{4})$/;
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
/** A logical file's stored files in reassembly order. Segmented files win over an old layout kept beside them. */
export function orderChunks(files: string[]): string[] {
  const seg = files.filter(isSegmentChunk);
  return (seg.length ? seg : files).slice().sort();
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
  try { return fs.readdirSync(dir).some((n) => n.startsWith(base) && /^\d{4}$/.test(n.slice(base.length))); } catch { return false; }
}

// ── writer ───────────────────────────────────────────────────────────────────

export interface SegmentedWriteOptions {
  /** Harness label — picks the boundary detector (null/unknown = one segment). */
  harness?: string | null;
  partBytes?: number;
  /** Compute the index and the file plan; write and remove nothing. */
  dryRun?: boolean;
  /** This writer owns the session's events-sidecar files too (canon layer): stale segmented events files are removed even
   *  when finish() gets no events. The native layer has no sidecar and leaves such names alone. */
  ownsEvents?: boolean;
}
export interface SegmentedWriteResult {
  index: SegmentIndex;
  indexPath: string;
  /** Files (abs) written this run (new or changed bytes). */
  written: string[];
  /** Files (abs) whose bytes were already identical — not touched (mtime kept). */
  unchanged: string[];
  /** Stale segmented files of this session removed (only ever this layout's own names). */
  removed: string[];
}

/**
 * Write one session in the segmented layout. push() every stored line in order (WITH its '\n'; the final line may lack
 * it — its bytes are kept exactly), then finish(). Sub-chunks whose bytes are unchanged (sha256 vs the previous index,
 * else a byte compare) are not rewritten, so closed segments keep identical bytes and mtimes across syncs.
 */
export class SegmentedWriter {
  private readonly scanner: SegmentScanner;
  private readonly partBytes: number;
  private readonly dir: string;
  private readonly base: string;
  private readonly prev = new Map<string, SegmentFile>();
  private readonly whole: Hash = createHash('sha256');
  private buf: Buffer[] = [];
  private bufBytes = 0;
  private seg = 0;
  private part = 0;
  private readonly keep = new Set<string>();
  private readonly result: Omit<SegmentedWriteResult, 'index' | 'indexPath'> = { written: [], unchanged: [], removed: [] };

  constructor(private readonly logicalAbs: string, private readonly o: SegmentedWriteOptions = {}) {
    this.scanner = new SegmentScanner(segmentDetectorFor(o.harness));
    this.partBytes = o.partBytes ?? DEFAULT_PART_BYTES;
    this.dir = path.dirname(logicalAbs);
    this.base = path.basename(logicalAbs);
    const prev = readSegmentIndex(logicalAbs);
    for (const s of prev?.segments ?? []) for (const f of [...(s.parts ?? []), ...(s.events ?? [])]) this.prev.set(f.file, f);
    if (!o.dryRun) fs.mkdirSync(this.dir, { recursive: true });
  }

  push(line: Buffer | string): void {
    const b = typeof line === 'string' ? Buffer.from(line, 'utf8') : line;
    if (this.scanner.feed(stripTerminator(b), b.length)) {
      this.flush();
      this.seg = this.scanner.segments.length - 1;
      this.part = 0;
    }
    if (this.bufBytes > 0 && this.bufBytes + b.length > this.partBytes) this.flush();
    this.buf.push(b); this.bufBytes += b.length;
    this.whole.update(b);
  }

  private flush(): void {
    if (!this.bufBytes) return;
    const name = `${this.base}.seg-${pad4(this.seg)}.part-${pad4(this.part)}`;
    const data = Buffer.concat(this.buf, this.bufBytes);
    (this.scanner.segments[this.seg]!.parts ??= []).push(this.store(name, data));
    this.part++;
    this.buf = []; this.bufBytes = 0;
  }

  private store(name: string, data: Buffer): SegmentFile {
    const sha256 = createHash('sha256').update(data).digest('hex');
    const abs = path.join(this.dir, name);
    this.keep.add(name);
    let size = -1;
    try { size = fs.statSync(abs).size; } catch { /* absent */ }
    const prev = this.prev.get(name);
    const same = size === data.length && (prev ? prev.sha256 === sha256 && prev.bytes === data.length : fs.readFileSync(abs).equals(data));
    if (same) this.result.unchanged.push(abs);
    else { if (!this.o.dryRun) fs.writeFileSync(abs, data); this.result.written.push(abs); }
    return { file: name, bytes: data.length, sha256 };
  }

  /**
   * Close the session. `events` (canon layer): an events-sidecar file to split along the same segments; `cuts` are the
   * byte offsets in that file where segments 1, 2, … begin (events past the last segment go to the last one).
   */
  finish(events?: { file: string; cuts: number[] }): SegmentedWriteResult {
    this.flush();
    const segs = this.scanner.segments;
    const eventsBase = this.base.replace(/\.jsonl$/, '.events.jsonl');
    if (events) {
      let off = 0, cur = 0, part = 0;
      let eb: Buffer[] = []; let ebBytes = 0;
      const flushEv = () => {
        if (!ebBytes) return;
        const name = `${eventsBase}.seg-${pad4(cur)}.part-${pad4(part)}`;
        (segs[cur]!.events ??= []).push(this.store(name, Buffer.concat(eb, ebBytes)));
        part++; eb = []; ebBytes = 0;
      };
      for (const line of fileLinesExact(events.file)) {
        let k = 0;
        while (k < events.cuts.length && events.cuts[k]! <= off) k++;
        k = Math.min(k, segs.length - 1);
        if (k !== cur) { flushEv(); cur = k; part = 0; }
        if (ebBytes > 0 && ebBytes + line.length > this.partBytes) flushEv();
        eb.push(line); ebBytes += line.length; off += line.length;
      }
      flushEv();
    }
    const index: SegmentIndex = {
      format: SEGMENT_INDEX_FORMAT, logical: this.base, harness: this.o.harness ?? null, partBytes: this.partBytes,
      lines: this.scanner.lineCount, bytes: this.scanner.byteCount, sha256: this.whole.digest('hex'), segments: segs,
    };
    const indexPath = segmentIndexPath(this.logicalAbs);
    const body = JSON.stringify(index, null, 1) + '\n';
    let prevBody = '';
    try { prevBody = fs.readFileSync(indexPath, 'utf8'); } catch { /* none */ }
    if (prevBody !== body) { if (!this.o.dryRun) fs.writeFileSync(indexPath, body); this.result.written.push(indexPath); }
    // Stale files of THIS layout only (the session got shorter, or a segment re-cut): never an old-layout file.
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const own = new RegExp(`^(${esc(this.base)}|${esc(eventsBase)})\\.seg-\\d{4}\\.part-\\d{4}$`);
    let names: string[] = [];
    try { names = fs.readdirSync(this.dir); } catch { /* dry run on a new dir */ }
    for (const n of names) {
      if (!own.test(n) || this.keep.has(n)) continue;
      if (!events && !this.o.ownsEvents && n.startsWith(eventsBase + '.')) continue; // a main-only writer (native) leaves events files alone
      const abs = path.join(this.dir, n);
      if (!this.o.dryRun) fs.unlinkSync(abs);
      this.result.removed.push(abs);
    }
    return { index, indexPath, ...this.result };
  }
}

/** Write a whole file (or several old parts, concatenated in order) in the segmented layout. */
export function writeSegmentedFromFiles(sources: string[], logicalAbs: string, o: SegmentedWriteOptions = {}): SegmentedWriteResult {
  const w = new SegmentedWriter(logicalAbs, o);
  for (const src of sources) for (const line of fileLinesExact(src)) w.push(line);
  return w.finish();
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
