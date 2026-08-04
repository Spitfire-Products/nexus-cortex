/**
 * canonSyncScheduler — the node reactive-capture trigger. Mirrors the browser
 * SPA's CanonSyncService scheduler tests: opt-in gate, debounce coalescing, and
 * consent-safe flush. Pure timer logic (canonSync stubbed via the test seam).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  scheduleCanonSync, flushCanonSync, canonAutoSyncConfig, __setCanonSyncRunner,
} from '../canonSyncScheduler.js';

const ON = { enabled: true }; // force the opt-in gate on regardless of ambient env

describe('canonAutoSyncConfig — env resolution', () => {
  it('is disabled by default and enabled only by a truthy CANON_AUTO_SYNC', () => {
    expect(canonAutoSyncConfig({}).enabled).toBe(false);
    expect(canonAutoSyncConfig({ CANON_AUTO_SYNC: 'false' }).enabled).toBe(false);
    expect(canonAutoSyncConfig({ CANON_AUTO_SYNC: '0' }).enabled).toBe(false);
    for (const v of ['1', 'true', 'on', 'yes', 'push', 'TRUE']) {
      expect(canonAutoSyncConfig({ CANON_AUTO_SYNC: v }).enabled).toBe(true);
    }
  });

  it('defaults the debounce to 60s and honours a positive override', () => {
    expect(canonAutoSyncConfig({}).debounceMs).toBe(60_000);
    expect(canonAutoSyncConfig({ CANON_AUTO_SYNC_DEBOUNCE_MS: '5000' }).debounceMs).toBe(5000);
    expect(canonAutoSyncConfig({ CANON_AUTO_SYNC_DEBOUNCE_MS: '-1' }).debounceMs).toBe(60_000);
    expect(canonAutoSyncConfig({ CANON_AUTO_SYNC_DEBOUNCE_MS: 'nope' }).debounceMs).toBe(60_000);
  });

  it('threads store/repoUrl into canonSync options only when present', () => {
    expect(canonAutoSyncConfig({}).options).toEqual({});
    expect(canonAutoSyncConfig({ CANON_STORE: '/tmp/x', CANON_REPO: 'https://r' }).options)
      .toEqual({ store: '/tmp/x', repoUrl: 'https://r' });
  });
});

describe('scheduleCanonSync — opt-in gate + debounce', () => {
  afterEach(() => { __setCanonSyncRunner(null); vi.useRealTimers(); });

  it('is a no-op when disabled (never fires a sync without opt-in)', () => {
    vi.useFakeTimers();
    const runner = vi.fn();
    __setCanonSyncRunner(runner);
    scheduleCanonSync({ enabled: false, debounceMs: 1000 });
    vi.advanceTimersByTime(5000);
    expect(runner).not.toHaveBeenCalled();
  });

  it('coalesces a burst of turns into ONE sync after the debounce settles', () => {
    vi.useFakeTimers();
    const runner = vi.fn();
    __setCanonSyncRunner(runner);
    scheduleCanonSync({ ...ON, debounceMs: 1000 });
    scheduleCanonSync({ ...ON, debounceMs: 1000 });
    scheduleCanonSync({ ...ON, debounceMs: 1000 }); // burst of turn completions
    expect(runner).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(runner).toHaveBeenCalledTimes(1); // one sync, not three
  });
});

describe('flushCanonSync — consent-safe immediate flush', () => {
  afterEach(() => { __setCanonSyncRunner(null); vi.useRealTimers(); });

  it('is a no-op when nothing was scheduled (opting out never triggers a capture)', async () => {
    const runner = vi.fn();
    __setCanonSyncRunner(runner);
    await flushCanonSync();
    expect(runner).not.toHaveBeenCalled();
  });

  it('fires immediately when a sync is pending and cancels the debounce (no double-run)', async () => {
    vi.useFakeTimers();
    const runner = vi.fn();
    __setCanonSyncRunner(runner);
    scheduleCanonSync({ ...ON, debounceMs: 10_000 });
    await flushCanonSync();
    expect(runner).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(runner).toHaveBeenCalledTimes(1); // flush cancelled the debounce
  });
});
