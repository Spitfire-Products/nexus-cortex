/**
 * DecisionStore — MVP port of nexus-terminal's `witty-tracing-narwhal`
 * lookup-before-action pattern.
 *
 * Every tool call's {tool, input, outcome} is appended to a JSONL file.
 * Before subsequent tool calls, the orchestrator queries the store for
 * matching {toolName, inputHash} and surfaces priors back to the model.
 *
 * MVP scope:
 *   • Stable JSON hashing (key-sorted) so equivalent input objects collide.
 *   • Append-only writer (`record`) + read-all-with-filter (`lookup`).
 *   • Stats aggregator that returns successes / failures + last error.
 *   • Strictly bounded — store is a JSONL file, never loaded into the
 *     orchestrator's hot path without an explicit lookup call.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { DecisionStore, stableInputHash } from '../DecisionStore.js';

describe('stableInputHash', () => {
  it('produces the same hash regardless of key order', () => {
    const a = stableInputHash({ b: 2, a: 1 });
    const b = stableInputHash({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('produces different hashes for different values', () => {
    const a = stableInputHash({ x: 1 });
    const b = stableInputHash({ x: 2 });
    expect(a).not.toBe(b);
  });

  it('handles nested objects and arrays deterministically', () => {
    const a = stableInputHash({ list: [1, 2, 3], nested: { b: 'y', a: 'x' } });
    const b = stableInputHash({ nested: { a: 'x', b: 'y' }, list: [1, 2, 3] });
    expect(a).toBe(b);
  });

  it('returns a fixed-width hex string (16+ chars)', () => {
    const h = stableInputHash({ any: 'thing' });
    expect(h).toMatch(/^[a-f0-9]{16,}$/);
  });
});

describe('DecisionStore', () => {
  let storePath: string;
  let store: DecisionStore;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'decision-store-'));
    storePath = path.join(dir, 'decisions.jsonl');
    store = new DecisionStore(storePath);
  });

  afterEach(async () => {
    await fs.rm(path.dirname(storePath), { recursive: true, force: true });
  });

  it('persists a recorded decision and reads it back via lookup', async () => {
    await store.record({
      sessionId: 's1',
      toolName: 'Read',
      input: { file_path: '/tmp/foo.txt' },
      success: true,
    });

    const hits = await store.lookup('Read', stableInputHash({ file_path: '/tmp/foo.txt' }));
    expect(hits.length).toBe(1);
    expect(hits[0]!.success).toBe(true);
    expect(hits[0]!.sessionId).toBe('s1');
  });

  it('lookup matches by tool name AND input hash, not by tool name alone', async () => {
    await store.record({
      sessionId: 's1',
      toolName: 'Read',
      input: { file_path: '/a' },
      success: true,
    });
    await store.record({
      sessionId: 's1',
      toolName: 'Read',
      input: { file_path: '/b' },
      success: false,
      errorSnippet: 'ENOENT',
    });

    const hitsA = await store.lookup('Read', stableInputHash({ file_path: '/a' }));
    const hitsB = await store.lookup('Read', stableInputHash({ file_path: '/b' }));
    expect(hitsA.length).toBe(1);
    expect(hitsA[0]!.success).toBe(true);
    expect(hitsB.length).toBe(1);
    expect(hitsB[0]!.success).toBe(false);
  });

  it('returns multiple priors for the same tool+input across sessions', async () => {
    await store.record({ sessionId: 's1', toolName: 'WebSearch', input: { q: 'x' }, success: false, errorSnippet: '429' });
    await store.record({ sessionId: 's2', toolName: 'WebSearch', input: { q: 'x' }, success: true });
    await store.record({ sessionId: 's3', toolName: 'WebSearch', input: { q: 'x' }, success: true });

    const hits = await store.lookup('WebSearch', stableInputHash({ q: 'x' }));
    expect(hits.length).toBe(3);
    expect(hits.map((h) => h.success)).toEqual([false, true, true]);
  });

  it('stats() summarises successes vs failures and surfaces the last error', async () => {
    await store.record({ sessionId: 's1', toolName: 'WebFetch', input: { url: 'http://x' }, success: false, errorSnippet: 'timeout' });
    await store.record({ sessionId: 's2', toolName: 'WebFetch', input: { url: 'http://x' }, success: false, errorSnippet: 'dns' });
    await store.record({ sessionId: 's3', toolName: 'WebFetch', input: { url: 'http://x' }, success: true });

    const s = await store.stats('WebFetch', stableInputHash({ url: 'http://x' }));
    expect(s.total).toBe(3);
    expect(s.successes).toBe(1);
    expect(s.failures).toBe(2);
    // Most recent error wins for `lastError`.
    expect(s.lastError).toBe('dns');
  });

  it('lookup returns [] when the store has no matching entries', async () => {
    const hits = await store.lookup('Glob', stableInputHash({ pattern: '*' }));
    expect(hits).toEqual([]);
  });

  it('record() creates the parent directory if missing', async () => {
    const nestedPath = path.join(path.dirname(storePath), 'deeper', 'decisions.jsonl');
    const nested = new DecisionStore(nestedPath);
    await nested.record({ sessionId: 's', toolName: 'Bash', input: { command: 'ls' }, success: true });
    const stat = await fs.stat(nestedPath);
    expect(stat.isFile()).toBe(true);
  });

  it('record() is robust to malformed earlier lines (skips them on read)', async () => {
    await store.record({ sessionId: 's1', toolName: 'Read', input: { file_path: '/a' }, success: true });
    // Corrupt the file with a junk line — earlier crashes mid-flush, etc.
    await fs.appendFile(storePath, 'NOT JSON LINE\n', 'utf-8');
    await store.record({ sessionId: 's2', toolName: 'Read', input: { file_path: '/a' }, success: true });

    const hits = await store.lookup('Read', stableInputHash({ file_path: '/a' }));
    expect(hits.length).toBe(2);
  });
});
