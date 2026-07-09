import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  planMemoryPrune,
  pruneMemoryFileToArchive,
  archivePathFor,
  resolveMemoryArchiveMaxBytes,
} from '../memoryArchive.js';

function bigDoc(): string {
  let doc = '# Memory\n\n## Project Patterns\n' + 'a'.repeat(500) + '\n\n';
  for (let i = 0; i < 40; i++) doc += `## Section ${i}\n- entry ${i}: ${'x'.repeat(400)}\n\n`;
  return doc;
}

describe('planMemoryPrune', () => {
  it('returns null when under cap', () => {
    expect(planMemoryPrune('small doc', 8000)).toBeNull();
    expect(planMemoryPrune(bigDoc(), 0)).toBeNull(); // 0 = off
  });

  it('splits into a bounded head + overflow tail on a boundary', () => {
    const p = planMemoryPrune(bigDoc(), 8000)!;
    expect(p).not.toBeNull();
    expect(Buffer.byteLength(p.hot, 'utf8')).toBeLessThanOrEqual(8000);
    expect(p.hot).toContain('## Project Patterns'); // keeps the head
    expect(p.overflow).toContain('entry 39'); // tail moved to overflow
    expect(p.hot).not.toContain('entry 39'); // moved, not duplicated
  });
});

describe('pruneMemoryFileToArchive', () => {
  it('moves overflow to MEMORY.archive.md and bounds the hot file (nothing lost)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memarch-'));
    const mp = join(dir, 'MEMORY.md');
    const doc = bigDoc();
    writeFileSync(mp, doc);

    const hot = await pruneMemoryFileToArchive(mp, doc, 8000);
    expect(Buffer.byteLength(hot, 'utf8')).toBeLessThanOrEqual(8000 + 300); // head + pointer
    expect(existsSync(archivePathFor(mp))).toBe(true);
    expect(readFileSync(archivePathFor(mp), 'utf8')).toContain('entry 39'); // overflow archived
    expect(readFileSync(mp, 'utf8')).toContain('MEMORY.archive.md'); // pointer written
  });

  it('is idempotent: a file already under cap is untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memarch-'));
    const mp = join(dir, 'MEMORY.md');
    writeFileSync(mp, bigDoc());
    // first prune
    await pruneMemoryFileToArchive(mp, readFileSync(mp, 'utf8'), 8000);
    const afterFirst = readFileSync(mp, 'utf8');
    // second prune on the now-bounded file → no change
    const afterSecond = await pruneMemoryFileToArchive(mp, afterFirst, 8000);
    expect(afterSecond).toBe(afterFirst);
  });

  it('returns content unchanged when cap is 0/off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memarch-'));
    const mp = join(dir, 'MEMORY.md');
    const doc = bigDoc();
    writeFileSync(mp, doc);
    expect(await pruneMemoryFileToArchive(mp, doc, 0)).toBe(doc);
    expect(existsSync(archivePathFor(mp))).toBe(false); // never created when off
  });
});

describe('resolveMemoryArchiveMaxBytes', () => {
  it('defaults to 0 (off)', () => {
    expect(resolveMemoryArchiveMaxBytes(undefined)).toBe(0);
    expect(resolveMemoryArchiveMaxBytes('')).toBe(0);
    expect(resolveMemoryArchiveMaxBytes('-5')).toBe(0);
    expect(resolveMemoryArchiveMaxBytes('abc')).toBe(0);
  });
  it('parses a positive integer', () => {
    expect(resolveMemoryArchiveMaxBytes('10000')).toBe(10000);
  });
});
