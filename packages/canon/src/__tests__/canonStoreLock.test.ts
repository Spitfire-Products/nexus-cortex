/**
 * One writer per store (2026-09-26): the cron legs and the watcher pipeline interleaved on one working clone (index.lock
 * failures; the browser fold-in re-added 19 archived sessions past the sync guard). withStoreLock serializes them.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { withStoreLock } from '../canonRepo.js';

let tmp: string;
let store: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-lock-')); store = path.join(tmp, 'store'); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('withStoreLock', () => {
  it('serializes concurrent writers on one store (no overlap)', async () => {
    const spans: Array<[number, number]> = [];
    const job = () => withStoreLock(store, 'test', async () => { const a = Date.now(); await sleep(250); spans.push([a, Date.now()]); return 1; }, () => 0);
    const r = await Promise.all([job(), job()]);
    expect(r).toEqual([1, 1]);
    spans.sort((x, y) => x[0] - y[0]);
    expect(spans[1]![0]).toBeGreaterThanOrEqual(spans[0]![1]);
    expect(fs.existsSync(`${store}.writer.lock`)).toBe(false);
  });

  it('takes over a stale lock left by a dead process', async () => {
    fs.writeFileSync(`${store}.writer.lock`, JSON.stringify({ pid: 2147483646, label: 'dead', ts: Date.now() }));
    expect(await withStoreLock(store, 'test', async () => 'ran', () => 'busy', 1000)).toBe('ran');
  });

  it('returns onBusy when a LIVE writer holds the lock past the wait', async () => {
    fs.writeFileSync(`${store}.writer.lock`, JSON.stringify({ pid: process.ppid, label: 'watcher', ts: Date.now() }));
    expect(await withStoreLock(store, 'test', async () => 'ran', () => 'busy', 300)).toBe('busy');
    expect(fs.existsSync(`${store}.writer.lock`)).toBe(true); // never removes someone else's lock
  });

  it('releases the lock when the work throws', async () => {
    await expect(withStoreLock(store, 'test', async () => { throw new Error('boom'); }, () => 0)).rejects.toThrow('boom');
    expect(fs.existsSync(`${store}.writer.lock`)).toBe(false);
  });
});
