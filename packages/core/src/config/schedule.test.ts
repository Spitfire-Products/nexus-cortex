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
  scheduledTurnPrompt, dueJobs, jobInvocation, systemBootMs, type ScheduleJob,
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

describe('runAtStart (2026-11-17): due once each time a runner starts', () => {
  const now = 50_000_000;
  it('dueJobs: due when not run since the start; a start-only job (everyMin 0) is never periodic; no start given = periodic rules only', () => {
    const recent = job({ runAtStart: true, lastRunMs: now - 60_000 });               // ran 1 min ago, every 5 min → not periodic-due
    expect(dueJobs([recent], now)).toHaveLength(0);
    expect(dueJobs([recent], now, { startedAtMs: now - 30_000 })).toHaveLength(1);    // ...but the runner started after that run
    expect(dueJobs([recent], now, { startedAtMs: now - 120_000 })).toHaveLength(0);   // already ran since this start
    const startOnly = job({ runAtStart: true, everyMin: 0, lastRunMs: now - 10 * 24 * 3600_000 });
    expect(dueJobs([startOnly], now)).toHaveLength(0);
    expect(dueJobs([startOnly], now, { startedAtMs: now - 1000 })).toHaveLength(1);
    expect(dueJobs([job({ runAtStart: true, enabled: false })], now, { startedAtMs: now })).toHaveLength(0);
    expect(dueJobs([job({ lastRunMs: now - 60_000 })], now, { startedAtMs: now - 1000 })).toHaveLength(0);   // plain jobs ignore the start
  });
  it('systemBootMs is in the past (the OS ticker\'s start)', () => {
    expect(systemBootMs(now)).toBeLessThanOrEqual(now);
  });
  it('the TUI scheduler runs a runAtStart job once after start(), then not again until the next start', async () => {
    saveJobs(file, [job({ tag: '[resume]', runAtStart: true, everyMin: 0, lastRunMs: 1 })]);
    let t = 10_000_000; const turns: string[] = [];
    const mk = () => new InSessionScheduler({ isIdle: () => true, lastUserActivityMs: () => 0, runTurn: async (p) => { turns.push(p); } },
      { ui: 'neoncortex', file, ownerFile, now: () => t, tickMs: 3_600_000 });
    const s = mk();
    expect(await s.tick()).toBe('none');           // not started yet → no start-run
    s.start(); await new Promise((r) => setTimeout(r, 50));
    expect(turns).toEqual(['[scheduled [resume]] read your mail']);
    t += 1000; expect(await s.tick()).toBe('none'); // once per start
    s.stop();
    t += 1000; const s2 = mk(); s2.start(); await new Promise((r) => setTimeout(r, 50)); s2.stop();
    expect(turns).toHaveLength(2);                 // the next window start runs it again
  });
  it('a fresh scheduled session is marked for the lifecycle hooks (SessionStart source=schedule); a pinned session is not', () => {
    expect(jobInvocation(job(), '/x/cortex.js').env.CORTEX_SESSION_SOURCE).toBe('schedule');
    expect(jobInvocation(job({ session: 'abc' }), '/x/cortex.js').env.CORTEX_SESSION_SOURCE).toBeUndefined();
  });
});
