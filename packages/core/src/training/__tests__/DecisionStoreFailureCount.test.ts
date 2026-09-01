/**
 * DecisionStore.failureCount(sessionId) — session-scoped cumulative failure
 * count, the dilution-immune thrash signal (thrashDetector cumFailThreshold).
 *
 * 🔴 Session scoping is the load-bearing property: a long-lived LOCAL store
 * holds cross-session history — an unscoped count would trip the cumulative
 * thrash threshold instantly on the next session. (Bench containers get a
 * fresh store per task, where the scope is a no-op.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { DecisionStore } from '../DecisionStore.js';

describe('DecisionStore.failureCount', () => {
  let storePath: string;
  let store: DecisionStore;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'decision-failcount-'));
    storePath = path.join(dir, 'decisions.jsonl');
    store = new DecisionStore(storePath);
  });

  afterEach(async () => {
    await fs.rm(path.dirname(storePath), { recursive: true, force: true });
  });

  it('counts only THIS session failures — cross-session rows excluded', async () => {
    // prior session: 3 failures (would false-trip an unscoped count)
    for (let i = 0; i < 3; i++) {
      await store.record({ sessionId: 'old', toolName: 'Bash', input: { command: `x${i}` }, success: false, errorSnippet: 'e' });
    }
    // current session: 2 failures + 1 success
    await store.record({ sessionId: 'cur', toolName: 'Bash', input: { command: 'a' }, success: false, errorSnippet: 'e' });
    await store.record({ sessionId: 'cur', toolName: 'Bash', input: { command: 'b' }, success: true });
    await store.record({ sessionId: 'cur', toolName: 'Edit', input: { file_path: 'f' }, success: false, errorSnippet: 'e' });

    expect(await store.failureCount('cur')).toBe(2);
    expect(await store.failureCount('old')).toBe(3);
  });

  it('excludes event rows (kind set) and successes', async () => {
    await store.record({ sessionId: 's', toolName: 'Bash', input: { command: 'a' }, success: false, errorSnippet: 'e' });
    await store.recordEvent({ sessionId: 's', kind: 'loop_escalation', detail: { n: 1 } });
    await store.record({ sessionId: 's', toolName: 'Bash', input: { command: 'b' }, success: true });
    expect(await store.failureCount('s')).toBe(1);
  });

  it('returns 0 for an empty/absent store and for a blank sessionId', async () => {
    expect(await store.failureCount('nobody')).toBe(0);
    expect(await store.failureCount('')).toBe(0);
  });
});
