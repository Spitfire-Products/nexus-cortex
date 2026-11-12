/**
 * Streamed chunked copy (2026-11-11). A session past V8's max string length (~512 MB) was skipped every cycle
 * ("Cannot create a string longer than 0x1fffffe8 characters"), and a malformed record in the MIDDLE of a session
 * (faee1cf3 line 197,556, after a crash) was treated as a torn tail, freezing the copy at that line forever.
 *
 * This drives the real >50 MB chunked path with a ~52 MB file and checks:
 *  - the parts reassemble to the source, with the mid-file corrupt record carried as a canon-unparseable-line marker
 *    (raw text kept verbatim) and every stored line parseable;
 *  - every part ends on a record boundary;
 *  - a torn LAST line still keeps only the valid prefix and does not advance the manifest.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonSync } from '../canonSync.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-stream-'));
const BARE = path.join(tmp, 'origin.git');
const STORE = path.join(tmp, 'store');
const HOME = path.join(tmp, 'home');
const SRC = path.join(HOME, 'sessions', 'big.jsonl');
const DEST = path.join(STORE, 'native', 'test-harness', 'big.jsonl');

const git = (dir: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });

const rec = (i: number) => JSON.stringify({ uuid: `u${i}`, timestamp: 't', type: 'user', message: { role: 'user', content: 'x'.repeat(1000) + ` ü${i}` } });
const N = 52_000;            // ~52 MB of ~1 KB records → over the 50 MB chunking threshold
const BAD_AT = 30_000;       // 0-based index of the mid-file corrupt record
const CORRUPT = '{"type":"api-request-blob","hash":"abc" "broken":';

const parts = () => fs.readdirSync(path.dirname(DEST)).filter((n) => n.startsWith('big.jsonl.part-')).sort()
  .map((n) => path.join(path.dirname(DEST), n));

beforeAll(() => {
  execFileSync('git', ['init', '-q', '-b', 'main', '--bare', BARE]);
  execFileSync('git', ['init', '-q', '-b', 'main', STORE]);
  git(STORE, ['remote', 'add', 'origin', BARE]);
  fs.writeFileSync(path.join(STORE, 'HARNESSES.json'), JSON.stringify({
    harnesses: { 'test-harness': { exts: ['.jsonl'], roots: [path.join(HOME, 'sessions')] } },
  }));
  git(STORE, ['add', '-A']);
  git(STORE, ['commit', '-q', '-m', 'seed']);
  git(STORE, ['push', '-q', 'origin', 'main']);
  fs.mkdirSync(path.join(HOME, 'sessions'), { recursive: true });
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('canonSync streamed chunked copy', () => {
  it('carries a mid-file corrupt record as a marker and reassembles losslessly', async () => {
    const lines: string[] = [];
    for (let i = 0; i < N; i++) lines.push(i === BAD_AT ? CORRUPT : rec(i));
    fs.writeFileSync(SRC, lines.join('\n') + '\n');
    await canonSync({ store: STORE, home: HOME });

    const ps = parts();
    expect(ps.length).toBeGreaterThanOrEqual(2);
    for (const p of ps) expect(fs.readFileSync(p, 'utf8').endsWith('\n')).toBe(true);   // record-boundary cuts
    const stored = ps.map((p) => fs.readFileSync(p, 'utf8')).join('').split('\n');
    expect(stored.pop()).toBe('');
    expect(stored.length).toBe(N);
    for (let i = 0; i < N; i++) {
      const r = JSON.parse(stored[i]!);                                                   // every stored line parses
      if (i === BAD_AT) expect(r).toEqual({ type: 'canon-unparseable-line', line: BAD_AT + 1, raw: CORRUPT });
      else expect(stored[i]).toBe(lines[i]);
    }
  }, 120_000);

  it('keeps only the valid prefix when the LAST record is torn', async () => {
    const lines: string[] = [];
    for (let i = 0; i < N; i++) lines.push(rec(i));
    fs.writeFileSync(SRC, lines.join('\n') + '\n' + '{"uuid":"tail","content":"cut mid-str');
    await canonSync({ store: STORE, home: HOME });
    const stored = parts().map((p) => fs.readFileSync(p, 'utf8')).join('');
    expect(stored).toBe(lines.join('\n') + '\n');

    // writer completes the tail → the next cycle re-copies it (manifest was not advanced)
    const done = JSON.stringify({ uuid: 'tail', content: 'done' });
    fs.writeFileSync(SRC, lines.join('\n') + '\n' + done + '\n');
    await canonSync({ store: STORE, home: HOME });
    expect(parts().map((p) => fs.readFileSync(p, 'utf8')).join('')).toBe(lines.join('\n') + '\n' + done + '\n');
  }, 120_000);
});
