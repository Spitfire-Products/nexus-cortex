/**
 * Big events sidecar (2026-11-11). The 824 MB faee1cf3 claude-code session produced a 135.65 MB events sidecar (GitHub rejects
 * > 100 MB), and once the whole session was captured, translate ran V8 out of heap holding the sidecar lines in an array.
 * The sidecar now streams to a temp file and goes through the chunk-aware writer: > 50 MB → .part-NNNN files on record
 * boundaries, which reassemble to exactly the event records, in order.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonTranslate } from '../canonTranslate.js';
import { sidecarFiles } from '../sidecar.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-bigside-'));
const STORE = path.join(tmp, 'store');
const BARE = path.join(tmp, 'bare.git');
const DIR = path.join('claude-code', '-proj');
const git = (dir: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });

const N_EVENTS = 60_000;   // ~1 KB each → ~60 MB of sidecar, over the 50 MB chunking threshold
const ev = (i: number) => JSON.stringify({ type: 'api-request-blob', sessionId: 's-big', hash: `h${i}`, body: 'b'.repeat(1000) });
const lines: string[] = [];
const events: string[] = [];

beforeAll(() => {
  execFileSync('git', ['init', '-q', '-b', 'main', '--bare', BARE]);
  execFileSync('git', ['init', '-q', '-b', 'main', STORE]);
  git(STORE, ['remote', 'add', 'origin', BARE]);
  lines.push(JSON.stringify({ uuid: 'u1', timestamp: '2026-11-11T00:00:01.000Z', type: 'user', sessionId: 's-big', message: { role: 'user', content: 'hello' } }));
  for (let i = 0; i < N_EVENTS; i++) { const e = ev(i); events.push(e); lines.push(e); }
  lines.push(JSON.stringify({ uuid: 'a1', parentUuid: 'u1', timestamp: '2026-11-11T00:00:02.000Z', type: 'assistant', sessionId: 's-big', message: { role: 'assistant', id: 'm1', content: [{ type: 'text', text: 'hi' }] } }));
  const native = path.join(STORE, 'native', DIR);
  fs.mkdirSync(native, { recursive: true });
  fs.writeFileSync(path.join(native, 's-big.jsonl'), lines.join('\n') + '\n');
  git(STORE, ['add', '-A']);
  git(STORE, ['commit', '-q', '-m', 'seed']);
  git(STORE, ['push', '-q', 'origin', 'main']);
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('canonTranslate — big events sidecar', () => {
  it('splits a > 50 MB sidecar into parts that reassemble to the event records', async () => {
    const savedHome = process.env.HOME;
    process.env.HOME = tmp;
    try { await canonTranslate({ store: STORE }); }
    finally { process.env.HOME = savedHome; }

    const main = path.join(STORE, 'canon', DIR, 's-big.jsonl');
    const parts = sidecarFiles(main);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(main.replace(/\.jsonl$/, '.events.jsonl'))).toBe(false);   // no single oversized file left
    expect(fs.existsSync(main.replace(/\.jsonl$/, '.events.jsonl.tmp'))).toBe(false);
    for (const p of parts) {
      expect(fs.statSync(p).size).toBeLessThan(100 * 1024 * 1024);
      expect(fs.readFileSync(p, 'utf8').endsWith('\n')).toBe(true);
    }
    const got = parts.map((p) => fs.readFileSync(p, 'utf8')).join('').split('\n').filter(Boolean);
    expect(got).toEqual(events);
  }, 180_000);
});
