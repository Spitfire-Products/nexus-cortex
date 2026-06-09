/**
 * Round 10 (parallel-bench output): two fixes to ContentAddressableStore.
 *
 * Opus finding: `initialize()` ran `fs.mkdir(recursive:true)` on every
 * `saveBackup` call. Memoize so the syscall fires once per instance.
 *
 * Cortex finding: `saveBackup` did a redundant `fs.stat` to get byte size
 * when we already had the content in memory. Use Buffer.byteLength.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Factory is hoisted before imports — declare mocks INSIDE the factory.
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({ size: 999 })),
    writeFile: vi.fn(async () => undefined),
  };
});

import * as fs from 'fs/promises';
import { ContentAddressableStore } from '../ContentAddressableStore.js';

const mkdirMock = fs.mkdir as unknown as ReturnType<typeof vi.fn>;
const statMock = fs.stat as unknown as ReturnType<typeof vi.fn>;
const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>;

describe('ContentAddressableStore — Round 10', () => {
  let store: ContentAddressableStore;

  beforeEach(() => {
    mkdirMock.mockClear();
    statMock.mockClear();
    writeFileMock.mockClear();
    store = new ContentAddressableStore('/tmp/r10', 'sess-1');
  });

  afterEach(() => {
    /* no-op */
  });

  it('initialize is memoized — only one mkdir per instance', async () => {
    await store.initialize();
    await store.initialize();
    await store.initialize();
    expect(mkdirMock).toHaveBeenCalledTimes(1);
  });

  it('saveBackup does NOT run a redundant mkdir after the first call', async () => {
    await store.saveBackup('content one', 1);
    await store.saveBackup('content two', 2);
    await store.saveBackup('content three', 3);
    // mkdir fires once (first saveBackup → initialize), not three times
    expect(mkdirMock).toHaveBeenCalledTimes(1);
  });

  it('saveBackup uses Buffer.byteLength, not fs.stat, for size', async () => {
    const content = 'hello world';
    const result = await store.saveBackup(content, 1);
    // No stat syscall
    expect(statMock).toHaveBeenCalledTimes(0);
    // Size from the in-memory content
    expect(result.size).toBe(Buffer.byteLength(content, 'utf8'));
  });

  it('saveBackup writes content and returns hash + version metadata', async () => {
    const content = 'some file body';
    const result = await store.saveBackup(content, 7);
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(result.version).toBe(7);
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(result.backupFileName).toMatch(/^[0-9a-f]{16}@v7$/);
  });

  it('multi-byte content reports correct utf-8 byte length', async () => {
    const content = 'héllo 🌍'; // 2-byte é, 4-byte 🌍
    const result = await store.saveBackup(content, 1);
    expect(result.size).toBe(Buffer.byteLength(content, 'utf8'));
    expect(result.size).toBeGreaterThan(content.length); // bytes > chars
  });
});
