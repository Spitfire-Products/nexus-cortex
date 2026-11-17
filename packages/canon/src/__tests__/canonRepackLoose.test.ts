/** repackLooseIfNeeded (2026-11-16): packs loose objects only past the thresholds; never throws. Fake git, no real repo. */
import { describe, it, expect } from 'vitest';
import { repackLooseIfNeeded } from '../canonRepo.js';

function fakeGit(countObjects: string, failRepack = false) {
  const calls: string[][] = [];
  const git = (args: string[]) => {
    calls.push(args);
    if (args[0] === 'count-objects') return countObjects;
    if (args.includes('repack') && failRepack) throw new Error('disk quota exceeded');
    return '';
  };
  return { git, calls };
}

describe('repackLooseIfNeeded', () => {
  it('does nothing below the thresholds', () => {
    const f = fakeGit('count: 12\nsize: 4096\nin-pack: 100\n');
    repackLooseIfNeeded(f.git, 't');
    expect(f.calls.some((c) => c.includes('repack'))).toBe(false);
  });
  it('repacks (incremental -d, no -a, no prune) past the loose-count threshold', () => {
    const f = fakeGit('count: 7207\nsize: 4330000\n');
    repackLooseIfNeeded(f.git, 't');
    const r = f.calls.find((c) => c.includes('repack'))!;
    expect(r).toContain('-d'); expect(r).not.toContain('-a'); expect(r).not.toContain('--prune');
  });
  it('repacks past the size threshold even with few objects', () => {
    const f = fakeGit('count: 50\nsize: 300000\n');
    repackLooseIfNeeded(f.git, 't');
    expect(f.calls.some((c) => c.includes('repack'))).toBe(true);
  });
  it('never throws when repack fails', () => {
    const f = fakeGit('count: 9999\nsize: 9999999\n', true);
    expect(() => repackLooseIfNeeded(f.git, 't')).not.toThrow();
  });
});
