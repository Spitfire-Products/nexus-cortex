/**
 * DecisionStore was unbounded: record() append-only, lookup() readFile(WHOLE
 * FILE) on every tool call → O(history) per call, monotonic growth. This
 * pins the size-cap + single-generation rotation: main file bounded; one
 * rotated `.1` generation preserved so priors survive the rotation boundary;
 * lookup/recent/stats still find pre-rotation records; total ≤ ~2×cap.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DecisionStore } from '../DecisionStore.js';

describe('DecisionStore — size cap + rotation', () => {
  let dir: string;
  let storePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dstore-rot-'));
    storePath = join(dir, 'decisions.jsonl');
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const rec = (s: DecisionStore, n: number) =>
    s.record({ sessionId: 's1', toolName: 'Read', input: { file_path: `/x/${n}.ts`, pad: 'y'.repeat(50) }, success: true });

  it('stays in one file below the cap (no .1)', async () => {
    const s = new DecisionStore(storePath, 100_000);
    const { stableInputHash } = await import('../DecisionStore.js');
    await rec(s, 1);
    await rec(s, 2);
    expect(existsSync(storePath)).toBe(true);
    expect(existsSync(storePath + '.1')).toBe(false);
    const found = await s.lookup('Read', stableInputHash({ file_path: '/x/1.ts', pad: 'y'.repeat(50) }));
    expect(found.length).toBe(1);
  });

  it('rotates to .1 when the cap is exceeded and bounds total size', async () => {
    const cap = 300; // tiny → force rotation fast
    const s = new DecisionStore(storePath, cap);
    for (let i = 0; i < 30; i++) await rec(s, i);
    expect(existsSync(storePath + '.1')).toBe(true);
    // main file is bounded near the cap (not 30 records' worth)
    expect(statSync(storePath).size).toBeLessThanOrEqual(cap * 2);
    // exactly one rotated generation (no .2)
    expect(existsSync(storePath + '.2')).toBe(false);
  });

  it('the most recent record is ALWAYS retained, however much history precedes it', async () => {
    // The stable continuity guarantee: rotation never drops the newest
    // write (it lives in main, written after the rotate check). This is the
    // contract the prior-injector depends on.
    const s = new DecisionStore(storePath, 300);
    const { stableInputHash } = await import('../DecisionStore.js');
    for (let i = 0; i < 80; i++) await rec(s, i); // lots of rotations
    await s.record({ sessionId: 's1', toolName: 'Grep', input: { q: 'newest' }, success: false, errorSnippet: 'boom' });
    const found = await s.lookup('Grep', stableInputHash({ q: 'newest' }));
    expect(found.length).toBe(1);
    expect(found[0]!.errorSnippet).toBe('boom');
  });

  it('intentionally evicts history older than the retained window', async () => {
    // The whole point of the cap: very old decisions are dropped, not kept.
    const s = new DecisionStore(storePath, 300);
    const { stableInputHash } = await import('../DecisionStore.js');
    await s.record({ sessionId: 's1', toolName: 'Grep', input: { q: 'ancient' }, success: true });
    for (let i = 0; i < 60; i++) await rec(s, i); // many rotations
    const found = await s.lookup('Grep', stableInputHash({ q: 'ancient' }));
    expect(found.length).toBe(0); // evicted by design — store is bounded
  });

  it('lookup works when .1 is absent (normal case)', async () => {
    const s = new DecisionStore(storePath, 100_000);
    const { stableInputHash } = await import('../DecisionStore.js');
    await s.record({ sessionId: 's1', toolName: 'Read', input: { file_path: '/a.ts' }, success: true });
    const found = await s.lookup('Read', stableInputHash({ file_path: '/a.ts' }));
    expect(found.length).toBe(1);
  });

  it('recent() returns newest-first across the rotation boundary', async () => {
    // Cap big enough that the retained window (.1 + main) holds ≥3 of the
    // same input, so ordering across the boundary is meaningfully testable.
    const s = new DecisionStore(storePath, 1500);
    const { stableInputHash } = await import('../DecisionStore.js');
    const input = { file_path: '/same.ts' };
    const hash = stableInputHash(input);
    for (let i = 0; i < 60; i++) {
      await s.record({ sessionId: 's1', toolName: 'Read', input, success: i % 2 === 0 });
    }
    expect(existsSync(storePath + '.1')).toBe(true);
    const r = await s.recent('Read', hash, 3);
    expect(r.length).toBe(3);
    // newest first → timestamps non-increasing (continuity across .1→main)
    expect(r[0]!.ts).toBeGreaterThanOrEqual(r[1]!.ts);
    expect(r[1]!.ts).toBeGreaterThanOrEqual(r[2]!.ts);
  });
});
