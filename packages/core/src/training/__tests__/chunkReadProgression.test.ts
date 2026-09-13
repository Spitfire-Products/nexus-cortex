/**
 * HB-CHUNKED-READS (R128): a monotonic range progression over ONE file (sed -n / head|tail /
 * tail|head / awk NR / Read offset+limit) is the canonical way to read a large input, not a
 * retry. The helper recognizes the chunk forms and decides "progression vs repeat".
 */
import { describe, it, expect } from 'vitest';
import { parseChunkRead, parseChunkReadInput, isChunkProgression } from '../chunkReadProgression.js';
import { classifyToolOutcome } from '../toolOutcome.js';

describe('parseChunkRead — bash chunk-read forms', () => {
  it.each([
    ["sed -n '1,200p' /app/big.log", '/app/big.log', 1, 200, 'sed'],
    ['sed -n "201,400p" /app/big.log', '/app/big.log', 201, 400, 'sed'],
    ['sed -n 401,600p big.log', 'big.log', 401, 600, 'sed'],
    ["cd /app && sed -n '1, 200p' data.csv", 'data.csv', 1, 200, 'sed'],
    ["cat /app/big.log | sed -n '601,800p'", '/app/big.log', 601, 800, 'sed'],
    ['head -n 400 /app/big.log | tail -n 200', '/app/big.log', 201, 400, 'head-tail'],
    ['head -400 /app/big.log | tail -200', '/app/big.log', 201, 400, 'head-tail'],
    ['head -n 200 /app/big.log', '/app/big.log', 1, 200, 'head'],
    ['tail -n +201 /app/big.log | head -n 200', '/app/big.log', 201, 400, 'tail-head'],
    ['tail -n +401 /app/big.log | head -200', '/app/big.log', 401, 600, 'tail-head'],
    ["awk 'NR>=1 && NR<=200' /app/big.log", '/app/big.log', 1, 200, 'awk'],
    ['awk "NR>=201&&NR<=400" /app/big.log', '/app/big.log', 201, 400, 'awk'],
  ])('%s', (cmd, file, start, end, kind) => {
    expect(parseChunkRead(cmd)).toEqual({ file, start, end, kind });
  });

  it('is null for non-chunk commands and for invalid ranges', () => {
    expect(parseChunkRead('ls -la /app')).toBeNull();
    expect(parseChunkRead('cat /app/big.log')).toBeNull();
    expect(parseChunkRead('grep foo /app/big.log')).toBeNull();
    expect(parseChunkRead('tail -f /var/log/app.log')).toBeNull();
    expect(parseChunkRead('tail -n 20 /app/big.log')).toBeNull(); // no known start offset
    expect(parseChunkRead("sed -n '400,200p' /app/big.log")).toBeNull(); // backwards range
    expect(parseChunkRead('head -n 100 /app/big.log | tail -n 200')).toBeNull(); // tail > head
  });
});

describe('parseChunkReadInput — tool inputs', () => {
  it('Bash command input', () => {
    expect(parseChunkReadInput('Bash', { command: "sed -n '1,200p' f.txt" })).toEqual({ file: 'f.txt', start: 1, end: 200, kind: 'sed' });
  });
  it('Read {file_path, offset, limit} (offset defaults to line 1)', () => {
    expect(parseChunkReadInput('Read', { file_path: '/app/f.txt', offset: 201, limit: 200 })).toEqual({ file: '/app/f.txt', start: 201, end: 400, kind: 'read' });
    expect(parseChunkReadInput('Read', { file_path: '/app/f.txt', limit: 200 })).toEqual({ file: '/app/f.txt', start: 1, end: 200, kind: 'read' });
  });
  it('null for a whole-file Read (no limit), other tools, and non-object inputs', () => {
    expect(parseChunkReadInput('Read', { file_path: '/app/f.txt' })).toBeNull();
    expect(parseChunkReadInput('Grep', { pattern: 'x', path: '/app' })).toBeNull();
    expect(parseChunkReadInput('Bash', 'sed -n 1,2p f')).toBeNull();
  });
});

describe('isChunkProgression — disjoint increasing range over the SAME file', () => {
  const c = (file: string, start: number, end: number) => ({ file, start, end, kind: 'sed' as const });
  it('true for the next disjoint chunk (adjacent or with a gap)', () => {
    expect(isChunkProgression(c('f', 1, 200), c('f', 201, 400))).toBe(true);
    expect(isChunkProgression(c('f', 1, 200), c('f', 401, 600))).toBe(true);
  });
  it('false for an identical range (a genuine repeat)', () => {
    expect(isChunkProgression(c('f', 1, 200), c('f', 1, 200))).toBe(false);
  });
  it('false for overlapping or backwards ranges', () => {
    expect(isChunkProgression(c('f', 1, 200), c('f', 150, 350))).toBe(false);
    expect(isChunkProgression(c('f', 201, 400), c('f', 1, 200))).toBe(false);
  });
  it('false across different files and when there is no previous chunk', () => {
    expect(isChunkProgression(c('a', 1, 200), c('b', 201, 400))).toBe(false);
    expect(isChunkProgression(undefined, c('f', 201, 400))).toBe(false);
    expect(isChunkProgression(null, c('f', 201, 400))).toBe(false);
  });
  it('kind does not matter — sed then awk over the same file is still a progression', () => {
    expect(isChunkProgression(c('f', 1, 200), { file: 'f', start: 201, end: 400, kind: 'awk' })).toBe(true);
  });
});

describe('classifyToolOutcome carries chunkRead for chunk reads only', () => {
  it('Bash sed chunk and Read paging carry it; plain commands do not', () => {
    expect(classifyToolOutcome('Bash', { command: "sed -n '1,200p' f.txt" }, { content: 'x', metadata: { exitCode: 0 } }).chunkRead)
      .toEqual({ file: 'f.txt', start: 1, end: 200, kind: 'sed' });
    expect(classifyToolOutcome('Read', { file_path: 'f.txt', offset: 1, limit: 200 }, { content: 'x' }).chunkRead)
      .toEqual({ file: 'f.txt', start: 1, end: 200, kind: 'read' });
    expect(classifyToolOutcome('Bash', { command: 'ls' }, { content: 'x', metadata: { exitCode: 0 } }).chunkRead).toBeUndefined();
  });
});
