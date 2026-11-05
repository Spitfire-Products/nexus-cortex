/**
 * canonRepo — fail-fast remote resolution. No built-in default remote may exist:
 * unconfigured + no store must throw an actionable error, never fall back to a
 * hardcoded store URL (cross-contamination guard).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveCanonRepo, requireCanonRepo } from '../canonRepo.js';

const saved = process.env.CANON_REPO;
beforeEach(() => { delete process.env.CANON_REPO; });
afterEach(() => {
  if (saved === undefined) delete process.env.CANON_REPO;
  else process.env.CANON_REPO = saved;
});

describe('resolveCanonRepo', () => {
  it('returns null when nothing is configured — no hardcoded default', () => {
    expect(resolveCanonRepo()).toBeNull();
  });

  it('explicit option wins over CANON_REPO env', () => {
    process.env.CANON_REPO = 'https://example.com/env-repo';
    expect(resolveCanonRepo('https://example.com/explicit')).toBe('https://example.com/explicit');
    expect(resolveCanonRepo()).toBe('https://example.com/env-repo');
  });
});

describe('requireCanonRepo', () => {
  it('throws an actionable error when unconfigured (names init/CANON_REPO, not a repo URL)', () => {
    expect(() => requireCanonRepo(undefined, '/tmp/x', 'canon-sync')).toThrow(/canon init/);
    expect(() => requireCanonRepo(undefined, '/tmp/x')).toThrow(/CANON_REPO/);
    try {
      requireCanonRepo(undefined, '/tmp/x');
    } catch (e) {
      expect(String(e)).not.toMatch(/github\.com/); // never leaks any default store URL
    }
  });

  it('returns the configured remote', () => {
    process.env.CANON_REPO = 'https://example.com/mine';
    expect(requireCanonRepo(undefined, '/tmp/x')).toBe('https://example.com/mine');
  });
});

describe('credential-free store remote (2026-11-06, macbook report)', () => {
  it('splitRepoCredentials strips a token from the URL and returns it', async () => {
    const { splitRepoCredentials } = await import('../canonRepo.js');
    expect(splitRepoCredentials('https://x-access-token:abc123@github.com/o/r.git')).toEqual({ url: 'https://github.com/o/r.git', token: 'abc123' });
    expect(splitRepoCredentials('https://abc123@github.com/o/r.git')).toEqual({ url: 'https://github.com/o/r.git', token: 'abc123' });
    expect(splitRepoCredentials('https://github.com/o/r.git')).toEqual({ url: 'https://github.com/o/r.git', token: '' });
  });
  it('gitAuthArgs falls back to the URL token when no GH_TOKEN is set', async () => {
    const { gitAuthArgs } = await import('../canonRepo.js');
    const a = gitAuthArgs({ CANON_REPO: 'https://x:tok9@github.com/o/r' } as any);
    expect(a.join(' ')).toContain(Buffer.from('x-access-token:tok9').toString('base64'));
  });
  it('scrubStoreRemote rewrites an existing origin without the token', async () => {
    const { scrubStoreRemote } = await import('../canonRepo.js');
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path'); const { execFileSync } = await import('node:child_process');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-scrub-'));
    execFileSync('git', ['init', '-q', d]); execFileSync('git', ['-C', d, 'remote', 'add', 'origin', 'https://x:secret@github.com/o/r.git']);
    scrubStoreRemote(d);
    expect(execFileSync('git', ['-C', d, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim()).toBe('https://github.com/o/r.git');
    fs.rmSync(d, { recursive: true, force: true });
  });
});
