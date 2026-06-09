/**
 * DecisionStore.recent(toolName, inputHash, limit) — returns the most
 * recent N matching decisions in reverse chronological order.
 *
 * Used by the prior-injector to surface up to 3 specific recent outcomes
 * (matching the nexus-terminal cortex pattern) instead of an aggregate
 * success/failure count. Specific recent outcomes give the model more
 * actionable signal — "the last 2 attempts both timed out" vs "1 of 3
 * historical calls failed at some point".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { DecisionStore, stableInputHash } from '../DecisionStore.js';

describe('DecisionStore.recent', () => {
  let storePath: string;
  let store: DecisionStore;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'decision-recent-'));
    storePath = path.join(dir, 'decisions.jsonl');
    store = new DecisionStore(storePath);
  });

  afterEach(async () => {
    await fs.rm(path.dirname(storePath), { recursive: true, force: true });
  });

  it('returns matching decisions in reverse chronological order', async () => {
    // Record three calls with non-overlapping timestamps. Hand-craft ts so we
    // don't depend on Date.now() being monotonic within microseconds.
    const hash = stableInputHash({ url: 'http://x' });
    await store.record({ sessionId: 's1', toolName: 'WebFetch', input: { url: 'http://x' }, success: false, errorSnippet: 'a' });
    await new Promise((r) => setTimeout(r, 2));
    await store.record({ sessionId: 's2', toolName: 'WebFetch', input: { url: 'http://x' }, success: false, errorSnippet: 'b' });
    await new Promise((r) => setTimeout(r, 2));
    await store.record({ sessionId: 's3', toolName: 'WebFetch', input: { url: 'http://x' }, success: true });

    const recent = await store.recent('WebFetch', hash, 3);
    expect(recent.length).toBe(3);
    // Most recent first
    expect(recent[0]!.sessionId).toBe('s3');
    expect(recent[1]!.sessionId).toBe('s2');
    expect(recent[2]!.sessionId).toBe('s1');
  });

  it('respects the limit parameter', async () => {
    const hash = stableInputHash({ k: 1 });
    for (let i = 0; i < 5; i++) {
      await store.record({ sessionId: `s${i}`, toolName: 'X', input: { k: 1 }, success: i % 2 === 0 });
      await new Promise((r) => setTimeout(r, 1));
    }

    const r2 = await store.recent('X', hash, 2);
    expect(r2.length).toBe(2);

    const r0 = await store.recent('X', hash, 0);
    expect(r0.length).toBe(0);
  });

  it('returns [] when no entries match', async () => {
    await store.record({ sessionId: 's', toolName: 'A', input: { x: 1 }, success: true });
    const recent = await store.recent('B', stableInputHash({ x: 1 }), 3);
    expect(recent).toEqual([]);
  });

  it('filters by toolName AND inputHash (not OR)', async () => {
    await store.record({ sessionId: 's', toolName: 'Read', input: { p: '/a' }, success: true });
    await store.record({ sessionId: 's', toolName: 'Read', input: { p: '/b' }, success: false, errorSnippet: 'nope' });
    await store.record({ sessionId: 's', toolName: 'Write', input: { p: '/a' }, success: true });

    const recent = await store.recent('Read', stableInputHash({ p: '/a' }), 5);
    expect(recent.length).toBe(1);
    expect(recent[0]!.success).toBe(true);
  });
});
