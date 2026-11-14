/**
 * In-session scheduler + schedule ownership (2026-11-14, operator: a first-class team member works through its TUI). While a TUI is open
 * it owns ~/.cortex/schedules.json, runs due jobs as turns in its own session when idle, and the OS ticker stands down.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  InSessionScheduler, saveJobs, loadJobs, claimScheduleOwner, liveScheduleOwner, releaseScheduleOwner, readScheduleOwner, OWNER_STALE_MS,
  scheduledTurnPrompt, type ScheduleJob,
} from './schedule.js';

let dir: string; let file: string; let ownerFile: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insess-')); file = path.join(dir, 'schedules.json'); ownerFile = path.join(dir, 'owner.json'); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const job = (o: Partial<ScheduleJob> = {}): ScheduleJob => ({ tag: '[mail poll]', everyMin: 5, prompt: 'read your mail', ...o });

function harness(over: { idle?: boolean; lastKey?: number; now?: number; peek?: string } = {}) {
  const turns: string[] = []; const notes: string[] = [];
  let now = over.now ?? 10_000_000;
  const state = { idle: over.idle ?? true, lastKey: over.lastKey ?? 0 };
  const s = new InSessionScheduler({
    isIdle: () => state.idle,
    lastUserActivityMs: () => state.lastKey,
    runTurn: async (p) => { turns.push(p); },
    notify: (l) => notes.push(l),
  }, { ui: 'neoncortex', file, ownerFile, now: () => now, peek: async () => over.peek ?? 'no new mail for x' });
  return { s, turns, notes, state, setNow: (n: number) => { now = n; } };
}

describe('ownership', () => {
  it('first claimant wins; the same process refreshes; a stale heartbeat or a dead pid frees it', () => {
    expect(claimScheduleOwner({ ui: 'neoncortex' }, 1000, ownerFile)).toBe(true);
    expect(liveScheduleOwner(1000 + 5000, ownerFile)?.pid).toBe(process.pid);
    expect(claimScheduleOwner({ ui: 'fuzzycortex' }, 2000, ownerFile)).toBe(true);           // same pid → refresh
    expect(liveScheduleOwner(2000 + OWNER_STALE_MS + 1, ownerFile)).toBeNull();               // stale
    fs.writeFileSync(ownerFile, JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), ui: 'x', ts: 3000 }));
    expect(liveScheduleOwner(3500, ownerFile)).toBeNull();                                    // dead pid on this host
    fs.writeFileSync(ownerFile, JSON.stringify({ pid: 1, host: 'other-host', ui: 'x', ts: 3000 }));
    expect(liveScheduleOwner(3500, ownerFile)?.host).toBe('other-host');                      // another host: trust the heartbeat
    expect(claimScheduleOwner({ ui: 'neoncortex' }, 3600, ownerFile)).toBe(false);            // someone else owns it
  });
  it('release only removes our own claim', () => {
    fs.writeFileSync(ownerFile, JSON.stringify({ pid: 1, host: 'other-host', ui: 'x', ts: 1 }));
    releaseScheduleOwner(ownerFile); expect(readScheduleOwner(ownerFile)).not.toBeNull();
    fs.rmSync(ownerFile); claimScheduleOwner({ ui: 'n' }, 1, ownerFile); releaseScheduleOwner(ownerFile);
    expect(fs.existsSync(ownerFile)).toBe(false);
  });
});

describe('InSessionScheduler.tick', () => {
  it('runs a due job as a marked turn in the session, stamps it, and does not re-run it inside its period', async () => {
    saveJobs(file, [job()]);
    const h = harness();
    expect(await h.s.tick()).toBe('[mail poll]');
    expect(h.turns).toEqual([scheduledTurnPrompt(job())]);
    expect(h.turns[0]).toMatch(/^\[scheduled \[mail poll\]\] read your mail$/);
    const j = loadJobs(file)[0]!;
    expect(j.lastRunner).toBe(`tui:${process.pid}`); expect(j.lastRc).toBe(0);
    expect(await h.s.tick()).toBe('none');
    h.setNow(10_000_000 + 5 * 60_000); expect(await h.s.tick()).toBe('[mail poll]');
  });
  it('never starts while busy or while the user typed in the last minute', async () => {
    saveJobs(file, [job()]);
    const h = harness({ idle: false });
    expect(await h.s.tick()).toBe('busy');
    h.state.idle = true; h.state.lastKey = 10_000_000 - 30_000;
    expect(await h.s.tick()).toBe('busy');
    h.state.lastKey = 10_000_000 - 61_000;
    expect(await h.s.tick()).toBe('[mail poll]');
  });
  it('mailOnly jobs need unread mail', async () => {
    saveJobs(file, [job({ mailOnly: true, mailName: 'm2-cortex' })]);
    expect(await harness({ peek: 'no new mail for m2-cortex' }).s.tick()).toBe('none');
    expect(await harness({ peek: '1 new message from workspace: hi' }).s.tick()).toBe('[mail poll]');
  });
  it('a second window does not run jobs while the first owns the schedule', async () => {
    saveJobs(file, [job()]);
    fs.writeFileSync(ownerFile, JSON.stringify({ pid: 1, host: 'other-host', ui: 'fuzzycortex', ts: 10_000_000 }));
    const h = harness();
    expect(await h.s.tick()).toBe('not-owner'); expect(h.turns).toEqual([]);
  });
  it('a failed turn is recorded as rc 1 and does not wedge the scheduler', async () => {
    saveJobs(file, [job()]);
    const s = new InSessionScheduler({ isIdle: () => true, lastUserActivityMs: () => 0, runTurn: async () => { throw new Error('boom'); } },
      { ui: 'n', file, ownerFile, now: () => 10_000_000 });
    expect(await s.tick()).toBe('[mail poll]'); expect(loadJobs(file)[0]!.lastRc).toBe(1);
  });
  it('disabled jobs never run; CORTEX_TUI_SCHEDULER=off keeps start() from ticking', async () => {
    saveJobs(file, [job({ enabled: false })]);
    expect(await harness().s.tick()).toBe('none');
    process.env.CORTEX_TUI_SCHEDULER = 'off';
    const h = harness(); h.s.start(); expect(h.s.owns).toBe(false); h.s.stop();
    delete process.env.CORTEX_TUI_SCHEDULER;
  });
});
