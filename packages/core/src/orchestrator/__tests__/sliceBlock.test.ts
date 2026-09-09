import { describe, it, expect } from 'vitest';
import {
  sliceReadFile,
  isAppendLog,
  isPathLike,
  decideSliceBlock,
  SLICE_BLOCK_AT_DEFAULT,
  SLICE_BLOCK_MAX_DEFAULT,
} from '../sliceBlock.js';

describe('sliceReadFile — extract the sliced file (same shape as applySliceNudge)', () => {
  it('matches sed -n N,Mp', () => {
    expect(sliceReadFile("sed -n '1,50p' /app/x.c")).toBe('/app/x.c');
    expect(sliceReadFile('sed -n 100,200p /tmp/vm.js')).toBe('/tmp/vm.js');
  });
  it('matches head/tail with and without -n', () => {
    expect(sliceReadFile('head -50 /app/y.py')).toBe('/app/y.py');
    expect(sliceReadFile('head -n 50 /app/y.py')).toBe('/app/y.py');
    expect(sliceReadFile('tail -n 20 /tmp/z.log')).toBe('/tmp/z.log');
  });
  it('is null for non-slice bash', () => {
    expect(sliceReadFile('ls -la /app')).toBeNull();
    expect(sliceReadFile('cat /app/x')).toBeNull();
    expect(sliceReadFile('grep foo /app/x')).toBeNull();
  });
  it('is null for a FOLLOWED log (tail -f, no number = not a re-slice)', () => {
    expect(sliceReadFile('tail -f /var/log/app.log')).toBeNull();
  });
});

describe('isAppendLog — exempt legit re-tailing of growing logs', () => {
  it('true for log/output/progress/download files', () => {
    for (const f of ['build.log', '/app/install2.log', 'training_output.txt', 'progress.log', 'cifar_download.log', 'run.out']) {
      expect(isAppendLog(f)).toBe(true);
    }
  });
  it('false for static source/data files', () => {
    for (const f of ['/app/shared_heap.c', 'tasks.py', 'text.gcode', 'gates.txt', 'doom.asm', 'bottle.py']) {
      expect(isAppendLog(f)).toBe(false);
    }
  });
});

describe('isPathLike — reject command keywords over-captured from pipelines', () => {
  it('true for real file paths', () => {
    for (const f of ['/app/vm.js', 'text.gcode', 'gates.txt', '../rel.py', '/tmp/x']) expect(isPathLike(f)).toBe(true);
  });
  it('false for bare command keywords (the pipeline false-positives: `| tail -1\\npython3`)', () => {
    for (const f of ['echo', 'python3', 'true', 'sleep']) expect(isPathLike(f)).toBe(false);
  });
});

describe('decideSliceBlock — coercive, scoped, bounded', () => {
  const AT = SLICE_BLOCK_AT_DEFAULT, MAX = SLICE_BLOCK_MAX_DEFAULT;

  it('NEVER blocks a command keyword over-captured from a pipeline (echo/python3), even at high count', () => {
    expect(decideSliceBlock('echo', AT + 20, 0).action).toBe('none');
    expect(decideSliceBlock('python3', AT + 20, 0).action).toBe('none');
  });

  it('blocks a static file once priorSlices >= AT and priorBlocks < MAX', () => {
    const d = decideSliceBlock('/app/text.gcode', AT, 0);
    expect(d.action).toBe('block');
    expect(d.message).toContain('/app/text.gcode');
    expect(d.message).toContain('DISABLED');
    expect(d.message).toContain('Read');
  });

  it('never blocks an append-log even at high slice counts', () => {
    expect(decideSliceBlock('/app/build.log', AT + 10, 0).action).toBe('none');
  });

  it('does not block below the threshold (soft nudge owns earlier slices)', () => {
    expect(decideSliceBlock('/app/x.c', AT - 1, 0).action).toBe('none');
  });

  it('is bounded — stops blocking once priorBlocks >= MAX (no infinite loop)', () => {
    expect(decideSliceBlock('/app/x.c', AT + 5, MAX).action).toBe('none');
    expect(decideSliceBlock('/app/x.c', AT + 5, MAX + 1).action).toBe('none');
    // still blocks at MAX-1 prior blocks
    expect(decideSliceBlock('/app/x.c', AT, MAX - 1).action).toBe('block');
  });

  it('respects custom at/max thresholds', () => {
    expect(decideSliceBlock('/app/x.c', 3, 0, 3, 1).action).toBe('block'); // at=3
    expect(decideSliceBlock('/app/x.c', 2, 0, 3, 1).action).toBe('none');  // below custom at
    expect(decideSliceBlock('/app/x.c', 9, 1, 3, 1).action).toBe('none');  // priorBlocks >= custom max
  });
});
