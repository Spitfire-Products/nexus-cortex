/**
 * Regression test: JSONLHistoryStore memoizes mkdir per
 * directory. Before this, every `appendMessage` made a redundant
 * `fs.mkdir({recursive:true})` syscall — once-per-session is enough.
 *
 * This test mocks `fs.mkdir` so we can count syscalls without touching
 * the real filesystem.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// `vi.mock` is hoisted before imports, so the factory has to construct its
// own vi.fn() refs and expose them via a stable name. We resolve them
// AFTER the mock by importing fs/promises (which now returns our mocks).
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn(async () => undefined),
    appendFile: vi.fn(async () => undefined),
  };
});

import * as fs from 'fs/promises';
import { JSONLHistoryStore } from '../JSONLHistoryStore.js';
import { tmpdir } from 'os';
import { join } from 'path';

const mkdirSpy = fs.mkdir as unknown as ReturnType<typeof vi.fn>;
const appendSpy = fs.appendFile as unknown as ReturnType<typeof vi.fn>;

describe('JSONLHistoryStore — mkdir memoization (Round 3)', () => {
  let store: JSONLHistoryStore;

  beforeEach(() => {
    mkdirSpy.mockClear();
    appendSpy.mockClear();
    const baseDir = join(tmpdir(), `jsonl-mkdir-test-${Date.now()}-${Math.random()}`);
    store = new JSONLHistoryStore({ baseDir });
  });

  const msg = (uuid: string) => ({
    uuid,
    parentUuid: null,
    timestamp: new Date().toISOString(),
    sessionId: 's1',
    type: 'user' as const,
    message: { role: 'user', content: 'hi' },
  } as any);

  it('calls mkdir exactly ONCE for the first appendMessage in a session', async () => {
    await store.appendMessage('s1', msg('m1'), '/workspace/x');
    expect(mkdirSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT call mkdir again for subsequent appends in the same session', async () => {
    await store.appendMessage('s1', msg('m1'), '/workspace/x');
    await store.appendMessage('s1', msg('m2'), '/workspace/x');
    await store.appendMessage('s1', msg('m3'), '/workspace/x');
    expect(mkdirSpy).toHaveBeenCalledTimes(1); // memoized
    expect(appendSpy).toHaveBeenCalledTimes(3); // every message still gets persisted
  });

  it('calls mkdir again for a different session-dir (different workspace)', async () => {
    await store.appendMessage('s1', msg('m1'), '/workspace/a');
    await store.appendMessage('s2', msg('m2'), '/workspace/b');
    // Different workspaces → different parent dirs → both need mkdir
    expect(mkdirSpy).toHaveBeenCalledTimes(2);
  });

  it('appendMessages batch path also benefits from the memo set', async () => {
    await store.appendMessage('s1', msg('m1'), '/workspace/x');
    await store.appendMessages('s1', [msg('m2'), msg('m3')], '/workspace/x');
    expect(mkdirSpy).toHaveBeenCalledTimes(1); // same dir, already ensured
  });

  it('crash safety: each appendMessage still calls fs.appendFile separately (not batched)', async () => {
    // The mkdir memo is a perf optimization; it MUST NOT batch the actual
    // writes — that would break crash recovery (user msg must persist
    // before the API call). One appendFile per message stays the contract.
    await store.appendMessage('s1', msg('user-1'), '/workspace/x');
    await store.appendMessage('s1', msg('asst-1'), '/workspace/x');
    expect(appendSpy).toHaveBeenCalledTimes(2);
  });

  // Round 6 (cortex self-audit finding): mkdir memo must recover from
  // externally-deleted directory. If the dir is removed between appends,
  // appendFile fails with ENOENT and the memo says "skip mkdir" — without
  // recovery, the second append throws and the session breaks.
  it('recovers when directory is externally deleted (ENOENT recovery)', async () => {
    // First write: succeeds, memo populated, mkdir called once
    await store.appendMessage('s1', msg('m1'), '/workspace/x');
    expect(mkdirSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);

    // Simulate external deletion: the next appendFile returns ENOENT
    let appendCallNum = 0;
    appendSpy.mockImplementation(async () => {
      appendCallNum++;
      if (appendCallNum === 1) {
        // The "second user append" appears to the spy as call #1 since we
        // mockImplementation here. Simulate ENOENT.
        const err: any = new Error('ENOENT: no such file or directory');
        err.code = 'ENOENT';
        throw err;
      }
      // Retry succeeds
      return undefined;
    });

    // Second write: ENOENT → memo eviction → mkdir → retry succeeds
    await store.appendMessage('s1', msg('m2'), '/workspace/x');
    // Recovery should have re-mkdir'd (mkdirSpy now called twice total)
    expect(mkdirSpy).toHaveBeenCalledTimes(2);
    // Three appendFile attempts total: 1 success on first message, then
    // (fail + retry) on second message.
    expect(appendSpy).toHaveBeenCalledTimes(3);
  });

  it('non-ENOENT errors are NOT silently retried', async () => {
    await store.appendMessage('s1', msg('m1'), '/workspace/x');
    // Now simulate a permission error
    appendSpy.mockImplementation(async () => {
      const err: any = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    });
    await expect(store.appendMessage('s1', msg('m2'), '/workspace/x')).rejects.toThrow('EACCES');
    // mkdir NOT called a second time — recovery only triggers on ENOENT
    expect(mkdirSpy).toHaveBeenCalledTimes(1);
  });
});
