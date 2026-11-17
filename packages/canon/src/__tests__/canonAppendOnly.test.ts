/**
 * APPEND-ONLY parts (2026-11-17). The store grew ~1 GB in 6 h of syncs for a few MB of new records: every sync rewrote the
 * open segment's last sub-chunk (up to 25 MB), every session under 50 MB as one whole file, the canonical outputs the same
 * way, and every project graph.json. Now a sealed part is never rewritten; each sync appends only the new tail.
 *
 * Checks (local bare fixture repos, no network):
 *  - 50 syncs of a growing session: blob bytes stored ≈ source size + small overhead (NOT N × size); sealed parts' blob SHAs
 *    never change; byte-for-byte reassembly after every sync; a compaction boundary mid-tail opens a new segment; a torn last
 *    line is handled as before; a source rewritten in the middle falls back safely (logged, no duplicate, no loss);
 *  - the same for translate's canonical outputs + events sidecar, and incremental output == a from-scratch translate;
 *  - migration: a legacy open tail (index without sealBytes, a big last part), a legacy single file and an old size-cut
 *    session are continued WITHOUT rewriting what is stored (single files adopted by rename = the same git blob);
 *  - readers order part numbers > 9999 numerically;
 *  - graph cadence: the pipeline rebuilds graph.json at most once per CANON_GRAPH_MIN_INTERVAL_MS.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PlainPartWriter, SegmentedWriter, compareChunkNames, renderSegmentIndex, groupChunkFiles, orderChunks, readSegmentIndex, resolveSealBytes,
  segmentBytesOfFiles, segmentIndexPath,
} from '../canonSegments.js';
import { canonSync } from '../canonSync.js';
import { canonTranslate } from '../canonTranslate.js';
import { canonPipeline, graphMinIntervalMs } from '../canonPipeline.js';
import { sidecarFiles } from '../sidecar.js';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-append-'));
let prevHome: string | undefined;
beforeAll(() => { prevHome = process.env.HOME; process.env.HOME = path.join(tmp, 'home-env'); });
afterAll(() => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── a realistic growing Claude Code session ──────────────────────────────────
let n = 0;
const ts = () => new Date(Date.UTC(2026, 10, 17) + n * 1000).toISOString();
const pad = (k: number) => 'lorem ipsum dolor '.repeat(k);
let lastUuid: string | null = null;
const rec = (o: any) => { n++; const r = { uuid: `x${n}`, parentUuid: lastUuid, timestamp: ts(), sessionId: 'S', ...o }; if (o.type !== 'attachment') lastUuid = r.uuid; return JSON.stringify(r); };
const user = (t: string) => rec({ type: 'user', message: { role: 'user', content: t } });
const asstFrag = (req: string, block: any) => rec({ type: 'assistant', requestId: req, message: { role: 'assistant', id: `m-${req}`, model: 'claude-x', content: [block] } });
const result = (id: string) => rec({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: pad(8) }] } });
const event = () => rec({ type: 'attachment', attachment: { k: pad(4) } });
const boundary = () => rec({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: 150_000, postTokens: 9000, durationMs: 5 } });
const summary = () => rec({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'SUMMARY of the window before' } });
/** One sync's worth of new records (~10–25 KB). `openFrag` leaves an assistant message whose next fragment arrives next sync. */
function turn(k: number, o: { compact?: boolean; openFrag?: string; closeFrag?: string } = {}): string[] {
  const out: string[] = [];
  if (o.closeFrag) out.push(asstFrag(o.closeFrag, { type: 'text', text: `continued ${k} ` + pad(10) }));
  if (o.compact) out.push(boundary(), summary());
  out.push(user(`prompt ${k} ` + pad(6)));
  for (let j = 0; j < 4 + (k % 5); j++) {
    const req = `r${k}-${j}`; const id = `tu${k}-${j}`;
    out.push(asstFrag(req, { type: 'thinking', thinking: pad(12), signature: 'sig' }));
    out.push(asstFrag(req, { type: 'tool_use', id, name: 'Bash', input: { command: `echo ${k}.${j}` } }));
    out.push(result(id));
    if (j % 2 === 0) out.push(event());
  }
  if (o.openFrag) out.push(asstFrag(o.openFrag, { type: 'text', text: `starting ${k} ` + pad(10) }));
  return out;
}
const body = (ls: string[]) => ls.map((l) => l + '\n').join('');

// ── fixture store + measurement helpers ──────────────────────────────────────
const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
function fixtureStore(name: string): { store: string; home: string; projects: string } {
  const root = path.join(tmp, name);
  const bare = path.join(root, 'remote.git'); const store = path.join(root, 'store'); const home = path.join(root, 'home');
  const projects = path.join(home, '.claude', 'projects');
  fs.mkdirSync(projects, { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['init', '-q', '-b', 'main', store]);
  git(store, ['remote', 'add', 'origin', bare]);
  git(store, ['config', 'user.email', 't@t']); git(store, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(store, 'HARNESSES.json'), JSON.stringify({ harnesses: { 'claude-code': { exts: ['.jsonl'], roots: [projects] } } }));
  git(store, ['add', '-A']); git(store, ['commit', '-qm', 'seed']); git(store, ['push', '-q', 'origin', 'main']);
  return { store, home, projects };
}
/** Total size of every DISTINCT blob ever committed under `prefix` whose name matches `re` — what the store actually grew by. */
function blobBytes(store: string, prefix: string, re: RegExp = /./): number {
  const objs = git(store, ['rev-list', '--objects', '--all']).split('\n')
    .map((l) => { const i = l.indexOf(' '); return i < 0 ? null : { sha: l.slice(0, i), p: l.slice(i + 1) }; })
    .filter((x): x is { sha: string; p: string } => !!x && x.p.startsWith(prefix) && re.test(path.basename(x.p)));
  const shas = [...new Set(objs.map((o) => o.sha))];
  if (!shas.length) return 0;
  const out = execFileSync('git', ['-C', store, 'cat-file', '--batch-check=%(objecttype) %(objectsize)'], { input: shas.join('\n') + '\n', encoding: 'utf8' });
  return out.split('\n').filter((l) => l.startsWith('blob ')).reduce((s, l) => s + Number(l.split(' ')[1]), 0);
}
const filesOf = (dir: string, base: string) => orderChunks(fs.readdirSync(dir).filter((f) => f === base || f.startsWith(base + '.part-') || f.startsWith(base + '.seg-')).map((f) => path.join(dir, f)));
const cat = (files: string[]) => Buffer.concat(files.map((f) => fs.readFileSync(f)));
const shaMap = (files: string[]) => new Map(files.map((f) => [path.basename(f), sha(fs.readFileSync(f))]));

const ID = '7e570000-aaaa-4bbb-8ccc-000000000017';
const SEAL = 8 * 1024, PART = 64 * 1024;

describe('sync: 50 syncs of a growing session are append-only', () => {
  const { store, home, projects } = fixtureStore('sync50');
  const src = path.join(projects, '-proj', `${ID}.jsonl`);
  const dir = path.join(store, 'native', 'claude-code', '-proj');
  const base = `${ID}.jsonl`;
  const opts = { store, home, partBytes: PART, sealBytes: SEAL };

  it('stores ≈ the source once (not N copies); sealed parts never change; every sync reassembles byte-for-byte', async () => {
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, '');
    const sealedSeen = new Map<string, string>();   // part name → sha, recorded once the part is sealed
    let naiveBytes = 0;                               // what the OLD writer stored: the open segment's last 25 MB part (here: the whole open tail) each sync
    let writtenTotal = 0;
    let segsBefore = 1;
    for (let k = 0; k < 50; k++) {
      const compact = k > 0 && k % 12 === 0;          // a compaction boundary lands in the middle of a sync's tail
      fs.appendFileSync(src, body(turn(k, { compact })));
      const r = await canonSync(opts);
      expect(r.diverged ?? []).toEqual([]);
      writtenTotal += r.bytesWritten ?? 0;
      const files = filesOf(dir, base);
      expect(sha(cat(files))).toBe(sha(fs.readFileSync(src)));                 // byte-for-byte, every sync
      const idx = readSegmentIndex(path.join(dir, base));
      if (!idx) { naiveBytes += fs.statSync(src).size; continue; }             // still one small file (≤ seal)
      const open = idx.segments[idx.segments.length - 1]!;
      naiveBytes += open.byteEnd - open.byteStart;
      if (compact) { expect(idx.segments.length).toBe(segsBefore + 1); expect(idx.segments[idx.segments.length - 2]!.closed).toBe(true); }
      segsBefore = idx.segments.length;
      const now = shaMap(files);
      for (const [name, h] of sealedSeen) expect(now.get(name), `sealed ${name} changed at sync ${k}`).toBe(h);   // never rewritten, never removed
      const openTail = open.parts![open.parts!.length - 1]!.file;
      for (const [name, h] of now) if (name !== openTail && !sealedSeen.has(name)) sealedSeen.set(name, h);
    }
    const size = fs.statSync(src).size;
    const stored = blobBytes(store, 'native/', /\.part-\d+$/);
    // Growth = the source once + at most one open tail (≤ seal) per sync — far from the N-copies behaviour.
    expect(stored).toBeLessThanOrEqual(size + 50 * SEAL);
    expect(stored).toBeLessThan(naiveBytes / 4);
    expect(writtenTotal).toBeLessThanOrEqual(size + 50 * SEAL + blobBytes(store, 'native/', /\.segments\.json$/) + 10 * 1024);
    const idx = readSegmentIndex(path.join(dir, base))!;
    expect(idx.segments.length).toBe(5);                                       // compactions at syncs 12, 24, 36, 48
    expect(idx.sealBytes).toBe(SEAL);
    console.log(`[test] 50 syncs: source ${size} B, part blobs stored ${stored} B (${(stored / size).toFixed(2)}×), ` +
      `index blobs ${blobBytes(store, 'native/', /\.segments\.json$/)} B, old-writer equivalent ≥ ${naiveBytes} B`);
  }, 120_000);

  it('a torn last line keeps the valid prefix (manifest not advanced) and completes next sync, sealed parts untouched', async () => {
    const before = shaMap(filesOf(dir, base));
    const good = fs.readFileSync(src);
    const tail = user('torn ' + pad(4));
    fs.appendFileSync(src, tail.slice(0, 40));                                   // a writer mid-line
    await canonSync(opts);
    expect(cat(filesOf(dir, base)).equals(good)).toBe(true);
    fs.appendFileSync(src, tail.slice(40) + '\n');
    await canonSync(opts);
    expect(sha(cat(filesOf(dir, base)))).toBe(sha(fs.readFileSync(src)));
    const after = shaMap(filesOf(dir, base));
    const idx = readSegmentIndex(path.join(dir, base))!;
    const open = idx.segments[idx.segments.length - 1]!; const openTail = open.parts![open.parts!.length - 1]!.file;
    for (const [name, h] of before) if (name !== openTail) expect(after.get(name)).toBe(h);
  });

  it('an unterminated last line is stored as-is and never sealed; its completion only touches the open tail', async () => {
    fs.appendFileSync(src, user('no newline yet ' + pad(3)));
    await canonSync(opts);
    expect(sha(cat(filesOf(dir, base)))).toBe(sha(fs.readFileSync(src)));
    const before = shaMap(filesOf(dir, base));
    fs.appendFileSync(src, '\n' + body(turn(99)));
    const r = await canonSync(opts);
    expect(r.diverged ?? []).toEqual([]);
    expect(sha(cat(filesOf(dir, base)))).toBe(sha(fs.readFileSync(src)));
    const after = shaMap(filesOf(dir, base));
    const changed = [...before].filter(([name, h]) => after.get(name) !== h).map(([name]) => name);
    expect(changed.length).toBeLessThanOrEqual(1);                              // at most the open tail
  });

  it('a source rewritten in the middle falls back safely: logged, rewritten from there, no duplicate, no loss', async () => {
    const before = shaMap(filesOf(dir, base));
    const idx0 = readSegmentIndex(path.join(dir, base))!;
    const buf = fs.readFileSync(src);
    // change one record inside segment 2 (a closed window)
    const at = idx0.segments[2]!.byteStart + 200;
    const ls = buf.indexOf(0x0a, at) + 1; const le = buf.indexOf(0x0a, ls);
    const edited = JSON.parse(buf.subarray(ls, le).toString('utf8')); edited.rewritten = 'yes — a different, longer record';
    fs.writeFileSync(src, Buffer.concat([buf.subarray(0, ls), Buffer.from(JSON.stringify(edited)), buf.subarray(le)]));
    const logs: string[] = []; const orig = console.log; console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
    let r; try { r = await canonSync(opts); } finally { console.log = orig; }
    expect(r!.diverged!.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.includes('[canon-parts]') && l.includes('sealed part') && l.includes('seg 2'))).toBe(true);
    const files = filesOf(dir, base);
    expect(sha(cat(files))).toBe(sha(fs.readFileSync(src)));                   // exactly the source: nothing doubled, nothing lost
    const after = shaMap(files);
    for (const s of idx0.segments.slice(0, 2)) for (const p of s.parts!) expect(after.get(p.file)).toBe(before.get(p.file)); // windows before it untouched
  });
});

describe('in-place redaction keeps sealed parts (append-only)', () => {
  it('a secret redacted inside sealed parts: parts kept as stored, logged, new lines appended, no deletions', async () => {
    const { store, home, projects } = fixtureStore('redact');
    const src = path.join(projects, '-proj', `${ID}.jsonl`);
    const dir = path.join(store, 'native', 'claude-code', '-proj'); const base = `${ID}.jsonl`;
    const opts = { store, home, partBytes: PART, sealBytes: SEAL };
    const secret = 'sk-ant-' + 'A'.repeat(40);
    const recs = Array.from({ length: 1200 }, (_, k) => JSON.stringify({ type: 'user', k, text: (k % 50 === 7 ? `key ${secret} ` : '') + 'x'.repeat(300) }) + '\n');
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, recs.join(''));
    await canonSync(opts);
    const before = shaMap(filesOf(dir, base));
    const sealed = readSegmentIndex(path.join(dir, base))!.segments.flatMap((s) => s.parts!.slice(0, -1).map((p) => p.file));
    expect(sealed.length).toBeGreaterThan(2);
    // the scrub hook's shape: a different-length placeholder, rewritten in place, plus new lines appended
    const red = recs.map((l) => l.split(secret).join('[redacted:sk:0123456789]'));
    const more = Array.from({ length: 20 }, (_, k) => JSON.stringify({ type: 'user', k: 1200 + k, text: 'y'.repeat(300) }) + '\n');
    fs.writeFileSync(src, red.join('') + more.join(''));
    const logs: string[] = []; const orig = console.log; console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
    let r; try { r = await canonSync(opts); } finally { console.log = orig; }
    expect(r!.diverged ?? []).toEqual([]);
    expect(logs.some((l) => l.includes('redacted in place'))).toBe(true);
    const after = shaMap(filesOf(dir, base));
    for (const f of sealed) expect(after.get(f), `sealed ${f} rewritten`).toBe(before.get(f));
    const whole = cat(filesOf(dir, base)).toString('utf8');
    expect(whole.endsWith(more.join(''))).toBe(true);                         // the new lines were appended once
    expect(whole.split('\n').filter(Boolean).length).toBe(1220);               // nothing doubled, nothing dropped
  });
});

describe('translate: canonical outputs + events are append-only too', () => {
  const { store, home, projects } = fixtureStore('translate');
  const src = path.join(projects, '-proj', `${ID}.jsonl`);
  const cdir = path.join(store, 'canon', 'claude-code', '-proj');
  const base = `${ID}.jsonl`, evBase = `${ID}.events.jsonl`;
  const opts = { store, home, partBytes: PART, sealBytes: SEAL };

  it('30 sync+translate rounds: sealed canonical/events parts never change, growth ≈ output once, == a from-scratch translate', async () => {
    const savedHome = process.env.HOME; process.env.HOME = home;   // translate manifest lives under HOME
    try {
      fs.mkdirSync(path.dirname(src), { recursive: true });
      fs.writeFileSync(src, '');
      const sealed = new Map<string, string>();
      let naive = 0;
      for (let k = 0; k < 30; k++) {
        // an assistant message left open at the end of a sync (its next fragment arrives next sync) — the EOF-merge tail case
        const lines = turn(k, { compact: k > 0 && k % 10 === 0, openFrag: k % 3 === 0 ? `open${k}` : undefined, closeFrag: k % 3 === 1 ? `open${k - 1}` : undefined });
        fs.appendFileSync(src, body(lines));
        await canonSync(opts);
        const t = await canonTranslate({ store, sealBytes: SEAL });
        expect(t.diverged ?? []).toEqual([]);
        expect(t.errors).toEqual([]);
        const files = [...filesOf(cdir, base), ...sidecarFiles(path.join(cdir, base))];
        const idx = readSegmentIndex(path.join(cdir, base));
        naive += cat(files).length;
        const now = shaMap(files);
        for (const [name, h] of sealed) expect(now.get(name), `sealed canonical ${name} changed at round ${k}`).toBe(h);
        if (idx) {
          const last = idx.segments[idx.segments.length - 1]!;
          const open = new Set([last.parts?.at(-1)?.file, last.events?.at(-1)?.file]);
          for (const [name, h] of now) if (!open.has(name) && !sealed.has(name)) sealed.set(name, h);
        }
      }
      expect(sealed.size).toBeGreaterThan(5);
      const outNow = cat(filesOf(cdir, base)); const evNow = cat(sidecarFiles(path.join(cdir, base)));
      const stored = blobBytes(store, 'canon/', /\.part-\d+$/);
      expect(stored).toBeLessThan(naive / 3);
      expect(stored).toBeLessThanOrEqual(outNow.length + evNow.length + 30 * 3 * SEAL);
      console.log(`[test] 30 translates: canonical+events ${outNow.length + evNow.length} B, part blobs stored ${stored} B, old-writer equivalent ≥ ${naive} B`);
      // incremental == from scratch: drop the outputs + manifest, re-translate the same native parts
      for (const f of fs.readdirSync(cdir)) fs.rmSync(path.join(cdir, f));
      fs.rmSync(path.join(home, '.canon', 'translate-manifest.json'), { force: true });
      git(store, ['add', '-A']); git(store, ['commit', '-qm', 'drop canon']);
      await canonTranslate({ store, sealBytes: SEAL });
      expect(sha(cat(filesOf(cdir, base)))).toBe(sha(outNow));
      expect(sha(cat(sidecarFiles(path.join(cdir, base))))).toBe(sha(evNow));
      expect(fs.readdirSync(cdir).some((f) => f.startsWith(evBase + '.seg-'))).toBe(true);
    } finally { if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome; }
  }, 180_000);
});

describe('migration: existing data is continued, never rewritten', () => {
  it('a legacy index (no sealBytes) with a big open tail: the tail seals as-is, new bytes go to the next part', () => {
    const dir = path.join(tmp, 'legacy-seg'); fs.mkdirSync(dir);
    const logical = path.join(dir, 'L.jsonl');
    const lines = turn(1).concat(turn(2), turn(3));
    // the OLD writer: 25 MB parts → here one part far over the seal size
    const w0 = new SegmentedWriter(logical, { harness: 'claude-code', partBytes: 1 << 20, sealBytes: 1 << 20 });
    for (const l of lines) w0.push(l + '\n');
    w0.finish();
    const idx = JSON.parse(fs.readFileSync(segmentIndexPath(logical), 'utf8')); delete idx.sealBytes;
    fs.writeFileSync(segmentIndexPath(logical), JSON.stringify(idx, null, 1) + '\n');
    const tail = path.join(dir, idx.segments[0].parts[0].file); const tailSha = sha(fs.readFileSync(tail));
    const more = turn(4);
    const w = new SegmentedWriter(logical, { harness: 'claude-code', partBytes: PART, sealBytes: SEAL });
    for (const l of [...lines, ...more]) w.push(l + '\n');
    const r = w.finish();
    expect(sha(fs.readFileSync(tail))).toBe(tailSha);
    expect(r.written.filter((f) => f !== r.indexPath).map((f) => path.basename(f))).toEqual(['L.jsonl.seg-0000.part-0001']);
    expect(r.stats.bytesWritten - Buffer.byteLength(renderSegmentIndex(r.index))).toBe(Buffer.byteLength(body(more)));
    expect(JSON.parse(fs.readFileSync(r.indexPath, 'utf8'))).toEqual(JSON.parse(JSON.stringify(r.index)));
  });

  it('sync adopts a legacy single file by RENAME (same git blob) and appends after it; an old size-cut session stays in its layout', async () => {
    const { store, home, projects } = fixtureStore('adopt');
    const dir = path.join(store, 'native', 'claude-code', '-proj');
    fs.mkdirSync(dir, { recursive: true });
    const one = '0ne00000-aaaa-4bbb-8ccc-000000000001', multi = 'mu170000-aaaa-4bbb-8ccc-000000000002', old = '01d00000-aaaa-4bbb-8ccc-000000000003';
    const oneLines = [...turn(10), ...turn(11), ...turn(12)];
    const multiLines = [...turn(13), ...turn(14, { compact: true }), ...turn(15)];
    const oldLines = [...turn(16), ...turn(17), ...turn(18), ...turn(19)];
    // what an OLD sync left behind: whole-file copies (sessions < 50 MB) and an old size-cut session
    fs.writeFileSync(path.join(dir, `${one}.jsonl`), body(oneLines));
    fs.writeFileSync(path.join(dir, `${multi}.jsonl`), body(multiLines));
    const oldBuf = Buffer.from(body(oldLines)); const cut = oldBuf.indexOf(0x0a, Math.floor(oldBuf.length / 2)) + 1;
    fs.writeFileSync(path.join(dir, `${old}.jsonl.part-0000`), oldBuf.subarray(0, cut));
    fs.writeFileSync(path.join(dir, `${old}.jsonl.part-0001`), oldBuf.subarray(cut));
    git(store, ['add', '-A']); git(store, ['commit', '-qm', 'legacy layout']);
    const blobOf = (rel: string) => git(store, ['ls-files', '-s', '--', rel]).split(' ')[1];
    const b1 = blobOf(`native/claude-code/-proj/${one}.jsonl`), b2 = blobOf(`native/claude-code/-proj/${multi}.jsonl`);
    const p0 = blobOf(`native/claude-code/-proj/${old}.jsonl.part-0000`), p1 = blobOf(`native/claude-code/-proj/${old}.jsonl.part-0001`);
    fs.mkdirSync(path.join(projects, '-proj'), { recursive: true });
    const srcs = { [one]: [...oneLines, ...turn(20)], [multi]: [...multiLines, ...turn(21)], [old]: [...oldLines, ...turn(22)] };
    for (const [id, ls] of Object.entries(srcs)) fs.writeFileSync(path.join(projects, '-proj', `${id}.jsonl`), body(ls));
    const r = await canonSync({ store, home, partBytes: PART, sealBytes: SEAL });
    expect(r.diverged).toEqual([]);
    // one window → segmented, its single file renamed to seg-0000.part-0000 (identical blob)
    expect(blobOf(`native/claude-code/-proj/${one}.jsonl.seg-0000.part-0000`)).toBe(b1);
    expect(fs.existsSync(path.join(dir, `${one}.jsonl`))).toBe(false);
    // several windows → kept as the plain layout's .part-0000 (identical blob), new bytes in .part-0001
    expect(blobOf(`native/claude-code/-proj/${multi}.jsonl.part-0000`)).toBe(b2);
    expect(fs.existsSync(path.join(dir, `${multi}.jsonl.part-0001`))).toBe(true);
    // old size-cut layout: both parts untouched, appended after
    expect(blobOf(`native/claude-code/-proj/${old}.jsonl.part-0000`)).toBe(p0);
    expect(blobOf(`native/claude-code/-proj/${old}.jsonl.part-0001`)).toBe(p1);
    expect(fs.existsSync(segmentIndexPath(path.join(dir, `${old}.jsonl`)))).toBe(false);
    for (const [id, ls] of Object.entries(srcs)) expect(sha(cat(filesOf(dir, `${id}.jsonl`)))).toBe(sha(body(ls)));
    // only the new tails were stored
    expect(r.bytesWritten! - blobBytes(store, 'native/', /\.segments\.json$/)).toBeLessThanOrEqual(
      Buffer.byteLength(body(turn(20))) + Buffer.byteLength(body(turn(21))) + Buffer.byteLength(body(turn(22))) + 10 * 1024);
  });

  it('a small session stays ONE file while ≤ the seal size (rewritten while small), then continues in parts', async () => {
    const { store, home, projects } = fixtureStore('small');
    const id = '5ma11000-aaaa-4bbb-8ccc-000000000004';
    const src = path.join(projects, '-p', `${id}.jsonl`); fs.mkdirSync(path.dirname(src), { recursive: true });
    const dir = path.join(store, 'native', 'claude-code', '-p');
    fs.writeFileSync(src, body([user('hi'), asstFrag('r', { type: 'text', text: 'hello' })]));
    await canonSync({ store, home, sealBytes: SEAL, partBytes: PART });
    expect(fs.readdirSync(dir)).toEqual([`${id}.jsonl`]);
    for (let k = 0; k < 3; k++) fs.appendFileSync(src, body(turn(30 + k)));
    await canonSync({ store, home, sealBytes: SEAL, partBytes: PART });
    expect(fs.existsSync(path.join(dir, `${id}.jsonl`))).toBe(false);
    expect(sha(cat(filesOf(dir, `${id}.jsonl`)))).toBe(sha(fs.readFileSync(src)));
  });

  it('the seal size defaults to 256 KB, honours CANON_SEAL_BYTES and never exceeds the part size', () => {
    const saved = process.env.CANON_SEAL_BYTES;
    try {
      delete process.env.CANON_SEAL_BYTES;
      expect(resolveSealBytes(undefined)).toBe(256 * 1024);
      process.env.CANON_SEAL_BYTES = '4096';
      expect(resolveSealBytes(undefined)).toBe(4096);
      expect(resolveSealBytes(1 << 30, 1000)).toBe(1000);
    } finally { if (saved === undefined) delete process.env.CANON_SEAL_BYTES; else process.env.CANON_SEAL_BYTES = saved; }
  });
});

describe('readers: part numbers past 9999 order numerically', () => {
  it('compareChunkNames / orderChunks / groupChunkFiles / sidecarFiles', () => {
    const names = ['x.jsonl.part-10000', 'x.jsonl.part-9999', 'x.jsonl.part-0002', 'x.jsonl.part-10001'];
    expect(orderChunks(names.map((f) => `/d/${f}`)).map((f) => path.basename(f))).toEqual(['x.jsonl.part-0002', 'x.jsonl.part-9999', 'x.jsonl.part-10000', 'x.jsonl.part-10001']);
    const seg = ['x.jsonl.seg-0001.part-0000', 'x.jsonl.seg-0000.part-10000', 'x.jsonl.seg-0000.part-9999', 'x.jsonl.seg-10000.part-0000', 'x.jsonl.seg-9999.part-0003'];
    expect(groupChunkFiles(seg.map((f) => `/d/${f}`)).get('/d/x.jsonl')!.map((f) => path.basename(f)))
      .toEqual(['x.jsonl.seg-0000.part-9999', 'x.jsonl.seg-0000.part-10000', 'x.jsonl.seg-0001.part-0000', 'x.jsonl.seg-9999.part-0003', 'x.jsonl.seg-10000.part-0000']);
    expect(compareChunkNames('/d/x.jsonl', '/d/x.jsonl.part-0000')).toBeLessThan(0);
    const dir = path.join(tmp, 'side10k'); fs.mkdirSync(dir);
    for (const p of ['9999', '10000', '0001']) fs.writeFileSync(path.join(dir, `x.events.jsonl.seg-0000.part-${p}`), p + '\n');
    expect(sidecarFiles(path.join(dir, 'x.jsonl')).map((f) => path.basename(f))).toEqual(['x.events.jsonl.seg-0000.part-0001', 'x.events.jsonl.seg-0000.part-9999', 'x.events.jsonl.seg-0000.part-10000']);
  });

  it('a segment of 10,050 parts writes, reads back and reassembles in order', () => {
    const dir = path.join(tmp, 'w10k'); fs.mkdirSync(dir);
    const logical = path.join(dir, 'Z.jsonl');
    const lines = Array.from({ length: 10_050 }, (_, i) => JSON.stringify({ type: 'user', i }) + '\n');
    const w = new SegmentedWriter(logical, { harness: 'claude-code', partBytes: 1, sealBytes: 1 });   // one line per part
    for (const l of lines) w.push(l);
    const r = w.finish();
    expect(r.index.segments[0]!.parts!.length).toBe(10_050);
    expect(r.index.segments[0]!.parts!.at(-1)!.file).toBe('Z.jsonl.seg-0000.part-10049');
    const files = orderChunks(fs.readdirSync(dir).filter((f) => f.startsWith('Z.jsonl.seg-')).map((f) => path.join(dir, f)));
    expect(cat(files).toString()).toBe(lines.join(''));
    expect(Buffer.concat([...segmentBytesOfFiles(files, 'claude-code', 0)]).toString()).toBe(lines.join(''));
    // and the plain layout past 9999
    const pl = path.join(dir, 'P.jsonl');
    const pw = new PlainPartWriter(pl, { partBytes: 1, sealBytes: 1 });
    for (const l of lines) pw.push(l);
    expect(pw.finish().files.length).toBe(10_050);
    expect(cat(orderChunks(fs.readdirSync(dir).filter((f) => f.startsWith('P.jsonl.part-')).map((f) => path.join(dir, f)))).toString()).toBe(lines.join(''));
  }, 60_000);
});

describe('graph cadence: derived graph.json at most once per interval', () => {
  it('pipeline rebuilds the graph on the first pass, skips within the interval, rebuilds after it; 0 = every pass', async () => {
    const { store, home, projects } = fixtureStore('graph');
    const src = path.join(projects, '-proj', `${ID}.jsonl`); fs.mkdirSync(path.dirname(src), { recursive: true });
    const savedHome = process.env.HOME; process.env.HOME = home;
    try {
      let now = Date.UTC(2026, 10, 17, 12);
      const pass = async (o: { every?: number } = {}) => {
        fs.appendFileSync(src, body(turn(n)));
        return canonPipeline({ store, home, sealBytes: SEAL, partBytes: PART, now: () => now, graphMinIntervalMs: o.every });
      };
      const graphCommits = () => git(store, ['log', '--format=%s']).split('\n').filter((s) => s.startsWith('canon-graph:')).length;
      const p1 = await pass(); expect(p1.translated).toBe(true); expect(p1.graphed).toBe(true);
      const c1 = graphCommits();
      now += 60 * 60 * 1000;
      const p2 = await pass(); expect(p2.graphed).toBe(false); expect(p2.graphSkipped).toMatch(/cadence/);
      now += 60 * 60 * 1000;
      const p3 = await pass(); expect(p3.graphed).toBe(false);
      expect(graphCommits()).toBe(c1);                                   // no graph.json rewrite while only the tail grew
      now += 24 * 60 * 60 * 1000;
      const p4 = await pass(); expect(p4.graphed).toBe(true);
      const p5 = await pass({ every: 0 }); expect(p5.graphed).toBe(true);
      expect(graphMinIntervalMs(undefined, {})).toBe(24 * 60 * 60 * 1000);
      expect(graphMinIntervalMs(undefined, { CANON_GRAPH_MIN_INTERVAL_MS: '0' })).toBe(0);
      expect(graphMinIntervalMs(5, { CANON_GRAPH_MIN_INTERVAL_MS: '9' })).toBe(5);
    } finally { if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome; }
  }, 120_000);
});
