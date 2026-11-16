/**
 * Segments by compaction (2026-11-15). A session is stored by compaction window — `<id>.jsonl.seg-SSSS.part-PPPP` +
 * `<id>.segments.json` — instead of by size. Checks: boundaries are found by parsing (a line that merely mentions the
 * word is not one), a torn last line is kept as bytes, a session with no compaction is one segment, a growing session
 * only rewrites its open tail (closed segments keep identical bytes AND mtimes), every layout reassembles byte-identical
 * (sha256), the old size-cut layout stays readable, pull by segment returns exactly that window, and an existing session
 * can be re-chunked without deleting its old files. E2E pieces run against a LOCAL bare fixture repo (no network).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SegmentScanner, SegmentedWriter, chunkInfo, claudeCodeBoundary, groupChunkFiles, readSegmentIndex, segmentBytesOfFiles,
  segmentIndexPath, segmentsOfFiles, writeSegmentedFromFiles,
} from '../canonSegments.js';
import { canonSync } from '../canonSync.js';
import { canonTranslate } from '../canonTranslate.js';
import { canonPull, canonPullNative, canonSegments, discoverCanonSessions, findNativeSessions } from '../canonPull.js';
import { canonRechunk } from '../canonRechunk.js';
import { canonGraph } from '../canonGraph.js';
import { sidecarFiles } from '../sidecar.js';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const ts = (i: number) => new Date(Date.UTC(2026, 10, 15, 0, 0, 0) + i * 1000).toISOString();
let n = 0;
const user = (text: string) => { n++; return JSON.stringify({ type: 'user', uuid: `u${n}`, timestamp: ts(n), sessionId: 'S', message: { role: 'user', content: text } }); };
const asst = (text: string) => { n++; return JSON.stringify({ type: 'assistant', uuid: `a${n}`, timestamp: ts(n), sessionId: 'S', requestId: `r${n}`, message: { role: 'assistant', id: `m${n}`, content: [{ type: 'text', text }] } }); };
const toolResult = () => { n++; return JSON.stringify({ type: 'user', uuid: `t${n}`, timestamp: ts(n), sessionId: 'S', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } }); };
const event = (k: string) => { n++; return JSON.stringify({ type: 'attachment', uuid: `e${n}`, timestamp: ts(n), sessionId: 'S', attachment: { k } }); };
const boundary = (pre: number) => { n++; return JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid: `b${n}`, timestamp: ts(n), sessionId: 'S', content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: pre, postTokens: 900, durationMs: 7 } }); };
const summary = (k: number) => { n++; return JSON.stringify({ type: 'user', uuid: `cs${n}`, isCompactSummary: true, isVisibleInTranscriptOnly: true, timestamp: ts(n), sessionId: 'S', message: { role: 'user', content: `SUMMARY ${k}: what happened before` } }); };
// Decoys: the word appears (even as a JSON-looking string) but these records are not boundaries.
const decoys = () => [
  asst('grep found "subtype":"compact_boundary" in the transcript'),
  user('<system-reminder>{"type":"system","subtype":"compact_boundary"}</system-reminder>'),
  (n++, JSON.stringify({ type: 'system', subtype: 'informational', uuid: `d${n}`, timestamp: ts(n), content: 'compact_boundary mentioned' })),
];
/** A window: optional boundary + summary, a real prompt behind non-prompts, padding. */
const window = (k: number, pad: number) => [
  ...(k > 0 ? [boundary(100_000 + k), summary(k)] : []),
  toolResult(), user('<command-name>/x</command-name>'), user(`prompt ${k} — real work ü`),
  ...Array.from({ length: pad }, (_, i) => (i % 3 === 0 ? event(`k${i}`) : asst(`answer ${k}.${i} ` + 'z'.repeat(120)))),
  ...(k === 1 ? decoys() : []),
];
const body = (lines: string[]) => lines.join('\n') + '\n';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-seg-'));
let prevHome: string | undefined;
beforeAll(() => {
  prevHome = process.env.HOME;
  process.env.HOME = path.join(tmp, 'home-env'); // title/touched caches land in the fixture, never the real ~/.canon
});
afterAll(() => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const segFiles = (dir: string, base: string) => fs.readdirSync(dir).filter((f) => f.startsWith(base + '.seg-')).sort().map((f) => path.join(dir, f));
const cat = (files: string[]) => Buffer.concat(files.map((f) => fs.readFileSync(f)));

describe('detection + names', () => {
  it('splits only at parsed boundaries — decoys that mention the word are ignored', () => {
    const lines = [...window(0, 4), ...window(1, 4), ...window(2, 4)];
    const sc = new SegmentScanner(claudeCodeBoundary);
    for (const l of lines) sc.feed(l, Buffer.byteLength(l) + 1);
    expect(lines.filter((l) => l.includes('compact_boundary')).length).toBe(5); // 2 real + 3 decoys
    expect(sc.segments.length).toBe(3);
    const [s0, s1, s2] = sc.segments;
    expect(s0!.boundary).toBeNull();
    expect(s1!.boundary).toEqual({ trigger: 'auto', preTokens: 100_001, postTokens: 900, durationMs: 7 });
    expect(s1!.summary).toBe('SUMMARY 1: what happened before');
    expect(s1!.firstPrompt).toBe('prompt 1 — real work ü');         // summary, tool_result and <…> injections skipped
    expect(s2!.lineStart).toBe(s1!.lineEnd);
    expect(s0!.closed && s1!.closed && !s2!.closed).toBe(true);
    expect(s1!.records.system).toBe(2);                                // the boundary + the 'informational' decoy
  });

  it('a session with no compaction — or a harness without a marker — is one segment', () => {
    const lines = [...window(0, 6)];
    const sc = new SegmentScanner(claudeCodeBoundary);
    for (const l of lines) sc.feed(l, Buffer.byteLength(l) + 1);
    expect(sc.segments.length).toBe(1);
    const withBoundaries = [...window(0, 2), ...window(1, 2)];
    const none = new SegmentScanner(null);
    for (const l of withBoundaries) none.feed(l, Buffer.byteLength(l) + 1);
    expect(none.segments.length).toBe(1);
  });

  it('classifies names in both layouts; a segmented copy wins over an old layout beside it', () => {
    expect(chunkInfo('s.jsonl.seg-0003.part-0001')).toEqual({ logical: 's.jsonl', layout: 'seg', seg: 3, part: 1 });
    expect(chunkInfo('s.jsonl.part-0002')).toEqual({ logical: 's.jsonl', layout: 'part', part: 2 });
    expect(chunkInfo('s.jsonl').layout).toBe('single');
    const g = groupChunkFiles(['/d/s.jsonl.part-0001', '/d/s.jsonl.seg-0001.part-0000', '/d/s.jsonl.part-0000', '/d/s.jsonl.seg-0000.part-0000', '/d/t.jsonl']);
    expect(g.get('/d/s.jsonl')).toEqual(['/d/s.jsonl.seg-0000.part-0000', '/d/s.jsonl.seg-0001.part-0000']);
    expect(g.get('/d/t.jsonl')).toEqual(['/d/t.jsonl']);
  });
});

describe('SegmentedWriter', () => {
  it('reassembles byte-identically (sha256), torn final line kept as bytes, sub-chunks size-limited', () => {
    const dir = path.join(tmp, 'w1'); fs.mkdirSync(dir);
    const src = path.join(dir, 'src.jsonl');
    const torn = '{"type":"assistant","uuid":"tail","message":{"content":"cut mid-str';
    fs.writeFileSync(src, body([...window(0, 30), ...window(1, 30), ...window(2, 5)]) + torn);
    const logical = path.join(dir, 'out', 'S.jsonl');
    const r = writeSegmentedFromFiles([src], logical, { harness: 'claude-code', partBytes: 2000 });
    const files = segFiles(path.dirname(logical), 'S.jsonl');
    expect(sha(cat(files))).toBe(sha(fs.readFileSync(src)));
    expect(r.index.sha256).toBe(sha(fs.readFileSync(src)));
    expect(r.index.segments.length).toBe(3);
    expect(r.index.segments[0]!.parts!.length).toBeGreaterThan(1);     // a window is several sub-chunks
    for (const f of files) {
      const b = fs.readFileSync(f);
      expect(b.length <= 2000 || !b.subarray(0, -1).includes(0x0a)).toBe(true); // over the cap only for one long line
    }
    expect(cat(files).toString('utf8').endsWith(torn)).toBe(true);
    expect(readSegmentIndex(logical)!.segments.map((s) => s.parts!.map((p) => p.file)).flat()).toEqual(files.map((f) => path.basename(f)));
  });

  it('only the open tail changes as the session grows (closed segments: same bytes, same mtime)', () => {
    const dir = path.join(tmp, 'w2'); fs.mkdirSync(dir);
    const logical = path.join(dir, 'S.jsonl');
    const lines = [...window(0, 20), ...window(1, 20), ...window(2, 3)];
    const write = (ls: string[]) => { const w = new SegmentedWriter(logical, { harness: 'claude-code', partBytes: 1500 }); for (const l of ls) w.push(l + '\n'); return w.finish(); };
    const r1 = write(lines);
    const past = new Date('2026-01-01T00:00:00Z');
    for (const f of segFiles(dir, 'S.jsonl')) fs.utimesSync(f, past, past);
    const closed = r1.index.segments.filter((s) => s.closed).flatMap((s) => s.parts!.map((p) => path.join(dir, p.file)));
    const before = new Map(closed.map((f) => [f, fs.readFileSync(f)]));
    const r2 = write([...lines, asst('more'), asst('and more')]);
    for (const f of closed) {
      expect(fs.readFileSync(f).equals(before.get(f)!)).toBe(true);
      expect(fs.statSync(f).mtimeMs).toBe(past.getTime());
    }
    expect(r2.written.every((f) => !closed.includes(f))).toBe(true);
    expect(r2.written.some((f) => f.includes('.seg-0002.'))).toBe(true);
    expect(r2.unchanged.length).toBeGreaterThan(0);
  });
});

// ── E2E: sync → translate → list/pull/rechunk on a fixture store ─────────────

const g = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function fixtureStore(name: string): { store: string; home: string } {
  const root = path.join(tmp, name);
  const bare = path.join(root, 'remote.git'); const store = path.join(root, 'store'); const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['init', '-q', '-b', 'main', store]);
  g(store, ['remote', 'add', 'origin', bare]);
  g(store, ['config', 'user.email', 't@t']); g(store, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(store, 'HARNESSES.json'), JSON.stringify({ harnesses: { 'claude-code': { exts: ['.jsonl'], roots: [path.join(home, '.claude', 'projects')] } } }));
  g(store, ['add', '-A']); g(store, ['commit', '-qm', 'seed']); g(store, ['push', '-q', 'origin', 'main']);
  return { store, home };
}
const ID = '9a1b2c3d-1111-4222-8333-444455556666';

describe('sync / translate / pull / list (segmented layout)', () => {
  const { store, home } = fixtureStore('e2e');
  const src = path.join(home, '.claude', 'projects', '-proj', `${ID}.jsonl`);
  const nativeDir = path.join(store, 'native', 'claude-code', '-proj');
  const opts = { store, home, maxBytes: 1000, partBytes: 3000 };
  const w0 = window(0, 25), w1 = window(1, 25), w2 = window(2, 4);

  it('sync stores a new big session by segment; reassembly is byte-identical', async () => {
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, body([...w0, ...w1, ...w2]));
    await canonSync(opts);
    const files = segFiles(nativeDir, `${ID}.jsonl`);
    expect(files.length).toBeGreaterThan(3);
    expect(fs.existsSync(path.join(nativeDir, `${ID}.jsonl`))).toBe(false);
    expect(fs.readdirSync(nativeDir).some((f) => /\.jsonl\.part-\d{4}$/.test(f))).toBe(false);
    expect(sha(cat(files))).toBe(sha(fs.readFileSync(src)));
    const idx = readSegmentIndex(path.join(nativeDir, `${ID}.jsonl`))!;
    expect(idx.segments.length).toBe(3);
    expect(g(store, ['ls-files', '--', 'native']).split('\n')).toContain(`native/claude-code/-proj/${ID}.segments.json`);
  });

  it('a growing session: closed segments untouched, only the tail rewritten; a new boundary opens a new segment', async () => {
    const past = new Date('2026-01-01T00:00:00Z');
    for (const f of segFiles(nativeDir, `${ID}.jsonl`)) fs.utimesSync(f, past, past);
    const idx1 = readSegmentIndex(path.join(nativeDir, `${ID}.jsonl`))!;
    const closed = idx1.segments.filter((s) => s.closed).flatMap((s) => s.parts!.map((p) => path.join(nativeDir, p.file)));
    const snap = new Map(closed.map((f) => [f, sha(fs.readFileSync(f))]));
    fs.appendFileSync(src, body([asst('tail grows'), asst('tail grows more')]));
    await canonSync(opts);
    for (const f of closed) { expect(sha(fs.readFileSync(f))).toBe(snap.get(f)); expect(fs.statSync(f).mtimeMs).toBe(past.getTime()); }
    const changed = segFiles(nativeDir, `${ID}.jsonl`).filter((f) => fs.statSync(f).mtimeMs !== past.getTime());
    expect(changed.length).toBe(1);
    expect(changed[0]).toMatch(/\.seg-0002\.part-\d{4}$/);
    expect(sha(cat(segFiles(nativeDir, `${ID}.jsonl`)))).toBe(sha(fs.readFileSync(src)));

    fs.appendFileSync(src, body(window(3, 3)));
    await canonSync(opts);
    const idx3 = readSegmentIndex(path.join(nativeDir, `${ID}.jsonl`))!;
    expect(idx3.segments.length).toBe(4);
    expect(idx3.segments[2]!.closed).toBe(true);
    expect(sha(cat(segFiles(nativeDir, `${ID}.jsonl`)))).toBe(sha(fs.readFileSync(src)));
  });

  it('pull --native --segment N returns exactly that window (bytes)', async () => {
    const all = fs.readFileSync(src);
    const idx = readSegmentIndex(path.join(nativeDir, `${ID}.jsonl`))!;
    const to = path.join(tmp, 'e2e', 'pulled-native');
    const r = await canonPullNative({ session: ID.slice(0, 8), store, to, segment: 1, home });
    expect(r.code).toBe(0);
    const got = fs.readFileSync(path.join(to, `${ID}.seg-0001.jsonl`));
    expect(got.equals(all.subarray(idx.segments[1]!.byteStart, idx.segments[1]!.byteEnd))).toBe(true);
    expect(got.toString('utf8').split('\n')[0]).toContain('"compact_boundary"');
    expect((await canonPullNative({ session: ID, store, to, segment: 9, home, force: true })).code).toBe(1); // out of range
  });

  it('translate mirrors the layout: canonical line + events sidecar split by the same segments', async () => {
    const r = await canonTranslate({ store, home });
    expect(r.errors).toEqual([]);
    const canonDir = path.join(store, 'canon', 'claude-code', '-proj');
    const main = segFiles(canonDir, `${ID}.jsonl`);
    expect(main.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(canonDir, `${ID}.jsonl`))).toBe(false);
    const idx = readSegmentIndex(path.join(canonDir, `${ID}.jsonl`))!;
    expect(idx.segments.length).toBe(4);
    const ev = sidecarFiles(path.join(canonDir, `${ID}.jsonl`));
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every((f) => /\.events\.jsonl\.seg-\d{4}\.part-\d{4}$/.test(f))).toBe(true);
    // every attachment event of window k sits in events segment k
    let evCount = 0;
    for (const s of idx.segments) for (const e of s.events ?? []) {
      const next = idx.segments[s.n + 1]?.firstTs;
      for (const l of fs.readFileSync(path.join(canonDir, e.file), 'utf8').split('\n').filter(Boolean)) {
        const t = JSON.parse(l).timestamp as string;
        expect(t >= s.firstTs! && (!next || t < next)).toBe(true);
        evCount++;
      }
    }
    expect(evCount).toBe(fs.readFileSync(src, 'utf8').split('\n').filter((l) => l.includes('"attachment"')).length);
    const sessions = discoverCanonSessions(store).filter((s) => s.uuid === ID);
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.parts).toEqual(main);
  });

  it('canon list --segments + pull --segment N (canonical line) return that window only', async () => {
    const r = await canonSegments({ session: ID.slice(0, 8), store, noFetch: true });
    expect(r.code).toBe(0);
    expect(r.segments!.map((s) => s.firstPrompt)).toEqual(['prompt 0 — real work ü', 'prompt 1 — real work ü', 'prompt 2 — real work ü', 'prompt 3 — real work ü']);
    expect(r.segments![2]!.summary).toBe('SUMMARY 2: what happened before');
    const to = path.join(tmp, 'e2e', 'pulled-canon');
    const p = await canonPull({ session: ID, store, to, segment: 2 });
    expect(p.code).toBe(0);
    const lines = fs.readFileSync(path.join(to, `${ID}.seg-0002.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(lines[0].subtype).toBe('compact_boundary');
    expect(lines.filter((l) => l.subtype === 'compact_boundary').length).toBe(1);
    expect(lines.some((l) => l.message?.content === 'prompt 2 — real work ü')).toBe(true);
    expect(lines.some((l) => l.message?.content === 'prompt 1 — real work ü' || l.message?.content === 'prompt 3 — real work ü')).toBe(false);
  });

  it('canon graph: one node per segment (first prompt, line, compaction), has_segment from the session, continues_as chain', async () => {
    const prevHome = process.env.HOME; process.env.HOME = home;   // touched/title caches stay in the fixture
    try { await canonGraph({ store }); } finally { if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome; }
    const graphs = fs.readdirSync(path.join(store, 'projects')).map((p) => path.join(store, 'projects', p, 'graph.json')).filter((f) => fs.existsSync(f));
    const graph = graphs.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))).find((gr) => gr.nodes.some((n: any) => n.id === `sess:${ID}`));
    expect(graph).toBeTruthy();
    const idx = readSegmentIndex(path.join(store, 'canon', 'claude-code', '-proj', `${ID}.jsonl`))!;
    const segs = graph.nodes.filter((n: any) => String(n.id).startsWith(`seg:${ID}:`)).sort((a: any, b: any) => a.segment - b.segment);
    expect(segs.map((n: any) => n.segment)).toEqual(idx.segments.map((s) => s.n));                       // 4 windows → 4 nodes
    expect(segs.map((n: any) => n.label)).toEqual(['prompt 0 — real work ü', 'prompt 1 — real work ü', 'prompt 2 — real work ü', 'prompt 3 — real work ü']);
    expect(segs.map((n: any) => n.source_location)).toEqual(idx.segments.map((s) => `L${s.lineStart + 1}`));
    expect(segs[0].compaction).toBeUndefined();                                                            // segment 0 = session start
    expect(segs.slice(1).every((n: any) => typeof n.compaction?.preTokens === 'number')).toBe(true);
    expect(segs.every((n: any) => /\.seg-\d{4}\.part-\d{4}$/.test(n.source_file))).toBe(true);
    const rel = (r: string) => graph.links.filter((l: any) => l.relation === r);
    expect(rel('has_segment').filter((l: any) => l.source === `sess:${ID}`).map((l: any) => l.target).sort())
      .toEqual(segs.map((n: any) => n.id).sort());
    expect(rel('continues_as').filter((l: any) => String(l.source).startsWith(`seg:${ID}:`)).map((l: any) => [l.source, l.target]))
      .toEqual(segs.slice(1).map((n: any) => [`seg:${ID}:${n.segment - 1}`, n.id]));
  });
});

describe('old size-cut layout: still readable, never migrated silently, re-chunkable', () => {
  const { store, home } = fixtureStore('old');
  const OLD = '0ld00000-1111-4222-8333-444455556666';
  const nativeDir = path.join(store, 'native', 'claude-code', '-old');
  const lines = [...window(0, 10), ...window(1, 10), ...window(2, 10)];
  const whole = Buffer.from(body(lines));
  const third = whole.indexOf('\n', Math.floor(whole.length / 3)) + 1;
  const two = whole.indexOf('\n', Math.floor((2 * whole.length) / 3)) + 1;

  it('reads an old-layout session (native + canon) and segments it on the fly', async () => {
    fs.mkdirSync(nativeDir, { recursive: true });
    const parts = [whole.subarray(0, third), whole.subarray(third, two), whole.subarray(two)];
    parts.forEach((b, i) => fs.writeFileSync(path.join(nativeDir, `${OLD}.jsonl.part-000${i}`), b));
    const canonDir = path.join(store, 'canon', 'claude-code', '-old');
    fs.mkdirSync(canonDir, { recursive: true });
    parts.forEach((b, i) => fs.writeFileSync(path.join(canonDir, `${OLD}.jsonl.part-000${i}`), b));
    g(store, ['add', '-A']); g(store, ['commit', '-qm', 'old layout']); g(store, ['push', '-q', 'origin', 'main']);

    const s = discoverCanonSessions(store).find((x) => x.uuid === OLD)!;
    expect(s.parts.map((p) => path.basename(p))).toEqual([0, 1, 2].map((i) => `${OLD}.jsonl.part-000${i}`));
    const segs = segmentsOfFiles(s.parts, 'claude-code');
    expect(segs.length).toBe(3);
    expect(Buffer.concat([...segmentBytesOfFiles(s.parts, 'claude-code', 1)]).equals(whole.subarray(segs[1]!.byteStart, segs[1]!.byteEnd))).toBe(true);
    const to = path.join(tmp, 'old', 'pulled');
    expect((await canonPull({ session: OLD, store, to, segment: 1 })).code).toBe(0);
    expect(fs.readFileSync(path.join(to, `${OLD}.seg-0001.jsonl`)).equals(whole.subarray(segs[1]!.byteStart, segs[1]!.byteEnd))).toBe(true);
    const full = await canonPullNative({ session: OLD, store, to: path.join(tmp, 'old', 'full'), home });
    expect(full.code).toBe(0);
    expect(sha(fs.readFileSync(path.join(tmp, 'old', 'full', `${OLD}.jsonl`)))).toBe(sha(whole));
  });

  it('sync keeps an old-layout session in the old layout (no silent migration)', async () => {
    const src = path.join(home, '.claude', 'projects', '-old', `${OLD}.jsonl`);
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, Buffer.concat([whole, Buffer.from(body([asst('grew')]))]));
    await canonSync({ store, home, maxBytes: 1000, partBytes: 1_000_000 });
    expect(segFiles(nativeDir, `${OLD}.jsonl`)).toEqual([]);
    expect(fs.existsSync(segmentIndexPath(path.join(nativeDir, `${OLD}.jsonl`)))).toBe(false);
    const p0 = fs.readFileSync(path.join(nativeDir, `${OLD}.jsonl.part-0000`));
    expect(fs.readFileSync(src).subarray(0, p0.length).equals(p0)).toBe(true);
    // restore the 3-part fixture for the rechunk step
    for (const f of fs.readdirSync(nativeDir)) fs.unlinkSync(path.join(nativeDir, f));
    [whole.subarray(0, third), whole.subarray(third, two), whole.subarray(two)].forEach((b, i) => fs.writeFileSync(path.join(nativeDir, `${OLD}.jsonl.part-000${i}`), b));
  });

  it('rechunk: dry run writes nothing; the real run writes segments beside the old parts (kept) and readers prefer them', async () => {
    const dry = await canonRechunk({ store, session: OLD, dryRun: true });
    expect(dry.code).toBe(0);
    expect(segFiles(nativeDir, `${OLD}.jsonl`)).toEqual([]);
    expect(dry.index!.segments.length).toBe(3);

    const r = await canonRechunk({ store, session: OLD, partBytes: 2500 });
    expect(r.code).toBe(0);
    const seg = segFiles(nativeDir, `${OLD}.jsonl`);
    expect(seg.length).toBeGreaterThanOrEqual(3);
    expect(sha(cat(seg))).toBe(sha(whole));
    for (const i of [0, 1, 2]) expect(fs.existsSync(path.join(nativeDir, `${OLD}.jsonl.part-000${i}`))).toBe(true); // nothing deleted
    expect(findNativeSessions(store, OLD)[0]!.parts).toEqual(seg);
    expect((await canonRechunk({ store, session: OLD })).written).toEqual([]); // already segmented
  });
});
