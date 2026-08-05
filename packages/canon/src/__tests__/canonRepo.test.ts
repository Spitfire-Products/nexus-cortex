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
