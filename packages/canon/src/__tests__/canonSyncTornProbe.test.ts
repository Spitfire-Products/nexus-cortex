/**
 * Sync-time parse probe — the "torn snapshot" regression (2026-08-14).
 *
 * A live writer mid-line at sync time must NOT poison the store: the store copy
 * keeps only the valid JSONL prefix, and the manifest is NOT advanced so the
 * completed file re-copies on the next cycle. (36 torn snapshots broke the
 * translate leg on every cron run until a hand sweep, 2026-08-13.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonSync } from '../canonSync.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-torn-'));
const BARE = path.join(tmp, 'origin.git');
const STORE = path.join(tmp, 'store');
const HOME = path.join(tmp, 'home');

const git = (dir: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });

const GOOD1 = JSON.stringify({ uuid: 'u1', timestamp: 't', type: 'user', message: { role: 'user', content: 'hi' } });
const GOOD2 = JSON.stringify({ uuid: 'a1', timestamp: 't', type: 'assistant', message: { role: 'assistant', content: 'yo' } });
const TORN = '{"uuid":"a2","timestamp":"t","type":"assistant","message":{"role":"assistant","content":"cut mid-str';

beforeAll(() => {
  execFileSync('git', ['init', '-q', '-b', 'main', '--bare', BARE]);
  execFileSync('git', ['init', '-q', '-b', 'main', STORE]);
  git(STORE, ['remote', 'add', 'origin', BARE]);
  // Route ONLY a custom harness at our temp sessions dir (overrides defaults).
  fs.writeFileSync(path.join(STORE, 'HARNESSES.json'), JSON.stringify({
    harnesses: { 'test-harness': { exts: ['.jsonl'], roots: [path.join(HOME, 'sessions')] } },
  }));
  git(STORE, ['add', '-A']);
  git(STORE, ['commit', '-q', '-m', 'seed']);
  git(STORE, ['push', '-q', 'origin', 'main']);
  fs.mkdirSync(path.join(HOME, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'sessions', 'torn.jsonl'), `${GOOD1}\n${GOOD2}\n${TORN}`);
  fs.writeFileSync(path.join(HOME, 'sessions', 'clean.jsonl'), `${GOOD1}\n${GOOD2}\n`);
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('canonSync torn-tail probe', () => {
  it('copies only the valid prefix of a torn file and re-copies it once completed', async () => {
    await canonSync({ store: STORE, home: HOME });
    const dest = path.join(STORE, 'native', 'test-harness', 'torn.jsonl');
    const copied = fs.readFileSync(dest, 'utf8');
    expect(copied).toBe(`${GOOD1}\n${GOOD2}\n`);          // torn line trimmed
    for (const l of copied.split('\n')) if (l.trim()) JSON.parse(l); // store parseable
    // clean file untouched by the probe
    expect(fs.readFileSync(path.join(STORE, 'native', 'test-harness', 'clean.jsonl'), 'utf8'))
      .toBe(`${GOOD1}\n${GOOD2}\n`);

    // Writer completes the line (same content growth) → next sync re-copies FULL file
    const GOOD3 = JSON.stringify({ uuid: 'a2', timestamp: 't', type: 'assistant', message: { role: 'assistant', content: 'cut mid-str DONE' } });
    fs.writeFileSync(path.join(HOME, 'sessions', 'torn.jsonl'), `${GOOD1}\n${GOOD2}\n${GOOD3}\n`);
    await canonSync({ store: STORE, home: HOME });
    expect(fs.readFileSync(dest, 'utf8')).toBe(`${GOOD1}\n${GOOD2}\n${GOOD3}\n`);
  });
});

describe('browser fold-in torn probe', () => {
  it('trims a torn line arriving via a browser-cortex-* branch checkout', async () => {
    // Push a browser branch (unrelated history) carrying a torn session file.
    const bwork = path.join(tmp, 'browser-work');
    execFileSync('git', ['init', '-q', '-b', 'browser-cortex-t1', bwork]);
    const bdir = path.join(bwork, 'native', 'browser-cortex');
    fs.mkdirSync(bdir, { recursive: true });
    fs.writeFileSync(path.join(bdir, 'bc-torn.jsonl'), `${GOOD1}\n${TORN}`);
    git(bwork, ['add', '-A']);
    git(bwork, ['commit', '-q', '-m', 'browser push']);
    git(bwork, ['push', '-q', BARE, 'browser-cortex-t1']);

    await canonSync({ store: STORE, home: HOME });
    const dest = path.join(STORE, 'native', 'browser-cortex', 'bc-torn.jsonl');
    const copied = fs.readFileSync(dest, 'utf8');
    expect(copied).toBe(`${GOOD1}\n`);                       // torn tail trimmed pre-commit
    for (const l of copied.split('\n')) if (l.trim()) JSON.parse(l);
  });
});
