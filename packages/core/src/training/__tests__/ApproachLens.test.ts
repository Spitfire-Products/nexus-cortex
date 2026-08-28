/**
 * BUILD 1a — approachHash cross-turn lens (the ×98 varied-retry class).
 * Covers: DecisionStore persists approachHash + approachFailures groups by
 * command-shape across distinct inputs; formatApproachReminder gating.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DecisionStore } from '../DecisionStore.js';
import { formatApproachReminder } from '../DecisionPriorInjector.js';
import type { Decision } from '../DecisionStore.js';

describe('BUILD 1a — approachFailures (varied-retry lens)', () => {
  let dir: string;
  let store: DecisionStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'approach-lens-'));
    store = new DecisionStore(path.join(dir, 'decisions.jsonl'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('persists approachHash and groups failures by command-shape across DISTINCT inputs', async () => {
    // same approach "AH1", two DIFFERENT exact inputs, both failed
    await store.record({ sessionId: 's', toolName: 'Bash', input: { command: 'sed -i s/a/b/ f1' }, success: false, errorSnippet: 'no match', approachHash: 'AH1' });
    await store.record({ sessionId: 's', toolName: 'Bash', input: { command: 'sed -i s/a/b/ f2' }, success: false, errorSnippet: 'no match either', approachHash: 'AH1' });

    const af = await store.approachFailures('Bash', 'AH1');
    expect(af.count).toBe(2);
    expect(af.distinctInputs).toBe(2);
    expect(af.recent[0].errorSnippet).toBe('no match either'); // newest first
  });

  it('ignores successes and mismatched approach hashes', async () => {
    await store.record({ sessionId: 's', toolName: 'Bash', input: { command: 'x1' }, success: true, approachHash: 'AH1' });
    await store.record({ sessionId: 's', toolName: 'Bash', input: { command: 'x2' }, success: false, approachHash: 'AH2' });
    const af = await store.approachFailures('Bash', 'AH1');
    expect(af.count).toBe(0);
    expect(af.distinctInputs).toBe(0);
  });

  it('never matches rows written without an approachHash (pre-1a graceful degrade)', async () => {
    await store.record({ sessionId: 's', toolName: 'Bash', input: { command: 'legacy' }, success: false, errorSnippet: 'boom' });
    const af = await store.approachFailures('Bash', 'AH1');
    expect(af.count).toBe(0);
  });

  it('returns empty for a blank approachHash (never fires on unfingerprinted calls)', async () => {
    await store.record({ sessionId: 's', toolName: 'Bash', input: { command: 'y' }, success: false, approachHash: 'AH1' });
    const af = await store.approachFailures('Bash', '');
    expect(af).toEqual({ count: 0, distinctInputs: 0, recent: [] });
  });

  it('distinctInputs stays 1 for IDENTICAL retries (leaves them to the exact-input reminder)', async () => {
    await store.record({ sessionId: 's', toolName: 'Bash', input: { command: 'same' }, success: false, approachHash: 'AH1' });
    await store.record({ sessionId: 's', toolName: 'Bash', input: { command: 'same' }, success: false, approachHash: 'AH1' });
    const af = await store.approachFailures('Bash', 'AH1');
    expect(af.count).toBe(2);
    expect(af.distinctInputs).toBe(1); // formatApproachReminder will return null → no double-fire
  });
});

describe('BUILD 1a — formatApproachReminder gating', () => {
  const rec: Decision[] = [
    { ts: 2, sessionId: 's', toolName: 'Bash', inputHash: 'b', inputSummary: '', success: false, errorSnippet: 'e2' },
    { ts: 1, sessionId: 's', toolName: 'Bash', inputHash: 'a', inputSummary: '', success: false, errorSnippet: 'e1' },
  ];

  it('null below 2 failures', () => {
    expect(formatApproachReminder('Bash', 1, 1, rec)).toBeNull();
  });
  it('null when only 1 distinct input (identical retries — exact reminder owns it)', () => {
    expect(formatApproachReminder('Bash', 3, 1, rec)).toBeNull();
  });
  it('fires on >=2 failures across >=2 distinct inputs, tells the model to CHANGE STRATEGY', () => {
    const out = formatApproachReminder('Bash', 2, 2, rec);
    expect(out).toContain('REPEATED APPROACH');
    expect(out).toContain('change strategy');
    expect(out).toContain('2 tweaked variations');
  });
});
