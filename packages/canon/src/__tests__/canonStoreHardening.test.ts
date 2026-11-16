/**
 * Store hardening (2026-11-15 "mystery writes"): in a blob-less partial clone, (1) every fetch / lazy fetch / commit spawned a DETACHED
 * `git maintenance run --auto` whose gc repacked GBs, and (2) rename detection across another machine's archive MOVES lazily downloaded
 * the moved sessions' old blobs. atomicClone must leave a store where a fetch spawns no maintenance and a `pull --rebase` across a remote
 * archive move fetches no blob — and the hardening must be idempotent and skip rename settings on a full clone.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { atomicClone, hardenStoreConfig, STORE_HARDENING, PARTIAL_STORE_HARDENING } from '../canonRepo.js';

const g = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
const cfg = (store: string, k: string) => { try { return g(store, ['config', '--get', k]).trim(); } catch { return ''; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-harden-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** git children started while running `args` (GIT_TRACE2_EVENT), excluding the command itself. */
function children(store: string, args: string[], name: string): string[] {
  const trace = path.join(tmp, `${name}.json`);
  g(store, args, { GIT_TRACE2_EVENT: trace });
  const seen = new Set<string>();
  for (const line of fs.readFileSync(trace, 'utf8').split('\n')) {
    try { const ev = JSON.parse(line); if (ev.event === 'start' && Array.isArray(ev.argv)) seen.add(ev.argv.slice(1).join(' ')); } catch { /* partial line */ }
  }
  return [...seen].filter((a) => a !== args.join(' '));
}

describe('canon store hardening', () => {
  const bare = path.join(tmp, 'remote.git'); const mac = path.join(tmp, 'mac'); const store = path.join(tmp, 'store');

  it('atomicClone hardens a partial store: settings written, idempotent', () => {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    g(bare, ['config', 'uploadpack.allowFilter', 'true']); g(bare, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
    execFileSync('git', ['clone', '-q', bare, mac], { stdio: 'ignore' });
    g(mac, ['config', 'user.email', 't@t']); g(mac, ['config', 'user.name', 't']); g(mac, ['checkout', '-q', '-b', 'main']);
    fs.mkdirSync(path.join(mac, 'native/h'), { recursive: true });
    for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(mac, `native/h/s${i}.jsonl`), JSON.stringify({ i, pad: 'x'.repeat(20000) }) + '\n');
    g(mac, ['add', '-A']); g(mac, ['commit', '-qm', 'init']); g(mac, ['push', '-q', 'origin', 'main']);

    atomicClone(`file://${bare}`, store, 'test');
    expect(cfg(store, 'remote.origin.partialclonefilter')).toBe('blob:none');
    for (const [k, v] of [...STORE_HARDENING, ...PARTIAL_STORE_HARDENING]) expect(cfg(store, k)).toBe(v);
    const before = fs.readFileSync(path.join(store, '.git/config'), 'utf8');
    hardenStoreConfig(store);                                   // second call: no change
    expect(fs.readFileSync(path.join(store, '.git/config'), 'utf8')).toBe(before);
  });

  it('fetch / commit / pull spawn no detached maintenance; a pull across remote archive moves downloads no ARCHIVED blob', () => {
    // production layout: the store excludes archive/ (non-cone sparse), like ensureArchiveExclusion leaves it
    g(store, ['sparse-checkout', 'set', '--no-cone', '/*', '!archive/']);
    // the other machine: a session the store never saw arrives, then it and s0 are ARCHIVED (moves); s1 grows (live)
    fs.writeFileSync(path.join(mac, 'native/h/s9.jsonl'), JSON.stringify({ unseen: 'y'.repeat(20000) }) + '\n');
    g(mac, ['add', '-A']); g(mac, ['commit', '-qm', 'mac: new session s9']); g(mac, ['push', '-q', 'origin', 'main']);
    fs.mkdirSync(path.join(mac, 'archive/native/h'), { recursive: true });
    g(mac, ['mv', 'native/h/s0.jsonl', 'archive/native/h/s0.jsonl']);
    g(mac, ['mv', 'native/h/s9.jsonl', 'archive/native/h/s9.jsonl']);
    fs.appendFileSync(path.join(mac, 'native/h/s1.jsonl'), '{"more":1}\n');
    g(mac, ['add', '-A']); g(mac, ['commit', '-qm', 'mac: archive s0 + s9, grow s1']); g(mac, ['push', '-q', 'origin', 'main']);
    g(store, ['config', 'user.email', 't@t']); g(store, ['config', 'user.name', 't']);
    fs.appendFileSync(path.join(store, 'native/h/s2.jsonl'), '{"local":1}\n');
    const commitKids = children(store, ['commit', '-qam', 'local append'], 'commit');
    expect(commitKids.filter((a) => a.startsWith('maintenance'))).toEqual([]);

    const fetchKids = children(store, ['fetch', '-q', 'origin'], 'fetch');
    expect(fetchKids.filter((a) => a.startsWith('maintenance'))).toEqual([]);

    const blobs = () => new Set(g(store, ['cat-file', '--batch-all-objects', '--batch-check=%(objecttype) %(objectname)'], { GIT_NO_LAZY_FETCH: '1' })
      .split('\n').filter((l) => l.startsWith('blob ')).map((l) => l.slice(5)));
    const before = blobs();
    const pullKids = children(store, ['pull', '--rebase', '-q', 'origin', 'main'], 'pull');
    expect(pullKids.filter((a) => a.startsWith('maintenance'))).toEqual([]);
    const fetched = [...blobs()].filter((s) => !before.has(s));
    const pathOf = new Map(g(store, ['ls-tree', '-r', '--format=%(objectname) %(path)', 'HEAD']).trim().split('\n').map((l) => [l.slice(0, 40), l.slice(41)] as [string, string]));
    expect(fetched.map((s) => pathOf.get(s) ?? `?${s}`).filter((p) => !p.startsWith('native/'))).toEqual([]);   // only LIVE files came down
    const s9 = pathOf.size ? [...pathOf].find(([, p]) => p === 'archive/native/h/s9.jsonl')?.[0] : undefined;
    expect(s9 && before.has(s9)).toBeFalsy();
    expect(s9 && blobs().has(s9)).toBeFalsy();                // the never-seen archived session stays remote-only
    const tree = g(store, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean);
    expect(tree).toContain('archive/native/h/s0.jsonl');
    expect(tree).not.toContain('native/h/s0.jsonl');
    expect(g(store, ['log', '-1', '--format=%s'])).toContain('local append');
  });

  it('a FULL clone keeps rename detection (nothing to fetch) but still gets the maintenance settings', () => {
    const full = path.join(tmp, 'full');
    const prev = process.env.CANON_FULL_CLONE; process.env.CANON_FULL_CLONE = 'true';
    try { atomicClone(`file://${bare}`, full, 'test'); } finally { if (prev === undefined) delete process.env.CANON_FULL_CLONE; else process.env.CANON_FULL_CLONE = prev; }
    for (const [k, v] of STORE_HARDENING) expect(cfg(full, k)).toBe(v);
    for (const [k] of PARTIAL_STORE_HARDENING) expect(cfg(full, k)).toBe('');
  });
});
