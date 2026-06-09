import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ResearchBacklog, computePriority } from '../ResearchBacklog.js';

describe('ResearchBacklog — deficiency triage lifecycle', () => {
  let root: string;
  let bl: ResearchBacklog;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-'));
    bl = new ResearchBacklog(root);
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('computePriority: (severityWeight × impact × confidence) / effort', () => {
    expect(computePriority('critical', 5, 1, 1)).toBe(25);   // 5*5*1/1
    expect(computePriority('low', 1, 5, 1)).toBe(0.2);        // 1*1*1/5
    expect(computePriority('high', 4, 2, 0.5)).toBe(3);       // 3*4*0.5/2
    expect(computePriority('medium', 3, 0, 1)).toBe(6);       // effort clamped to 1
  });

  it('add() auto-triages and computes priority; idempotent by title', () => {
    const a = bl.add({ title: 'Streaming dedup missing', description: 'dup tool_use', bugClass: 'Streaming', severity: 'high', impact: 4, effort: 2, confidence: 0.9 });
    expect(a.id).toMatch(/^def-/);
    expect(a.status).toBe('triaged');
    expect(a.priorityScore).toBe(computePriority('high', 4, 2, 0.9));
    // re-finding the same title updates, doesn't duplicate
    bl.add({ title: 'Streaming dedup missing', description: 'still happening', confidence: 0.95 });
    const all = bl.list({ sortByPriority: false });
    expect(all.filter(r => r.title === 'Streaming dedup missing')).toHaveLength(1);
    expect(bl.get(a.id)!.confidence).toBe(0.95);
  });

  it('next() returns the highest-priority open/triaged item', () => {
    bl.add({ title: 'low one', description: '', severity: 'low', impact: 1, effort: 5, confidence: 0.5 });
    const hi = bl.add({ title: 'critical one', description: '', severity: 'critical', impact: 5, effort: 1, confidence: 1 });
    bl.add({ title: 'mid one', description: '', severity: 'medium', impact: 3, effort: 3, confidence: 0.6 });
    expect(bl.next()!.id).toBe(hi.id);
  });

  it('lifecycle + OVERFITTING GUARD: fixed != verified; verified needs held-out round', () => {
    const d = bl.add({ title: 'loop exits early', description: '', severity: 'high', impact: 4, effort: 2, confidence: 0.8 });
    bl.markInProgress(d.id, 'r60-loopfix');
    expect(bl.get(d.id)!.status).toBe('in_progress');
    bl.markFixed(d.id, 'abc1234');                 // passes discovery task only
    const fixed = bl.get(d.id)!;
    expect(fixed.status).toBe('fixed');            // NOT verified — overfitting risk
    expect(fixed.fixedRef).toBe('abc1234');
    expect(fixed.verifiedRound).toBeUndefined();
    bl.markVerified(d.id, 'r60-holdout');          // held-out confirmation
    const verified = bl.get(d.id)!;
    expect(verified.status).toBe('verified');
    expect(verified.verifiedRound).toBe('r60-holdout');
    // a fixed-but-not-verified item is excluded from next() (no longer open/triaged)
    expect(bl.next()).toBeUndefined();
  });

  it('regression reopens a verified deficiency', () => {
    const d = bl.add({ title: 'cache hit rate flat', description: '' });
    bl.markVerified(d.id, 'r10');
    bl.reopenRegressed(d.id);
    expect(bl.get(d.id)!.status).toBe('regressed');
  });

  it('append-only store survives across instances (concurrent-safe pattern)', () => {
    bl.add({ title: 'persisted', description: '', severity: 'high', impact: 3, effort: 1, confidence: 0.7 });
    const bl2 = new ResearchBacklog(root); // fresh instance reads the same jsonl
    expect(bl2.list().map(r => r.title)).toContain('persisted');
  });
});
