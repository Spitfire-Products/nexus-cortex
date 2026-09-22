import { describe, it, expect } from 'vitest';
import { FrameRunner } from '../frameRunner.js';
import { FRAME_CONFIG_DEFAULTS } from '../frameConfig.js';

function fakeDeps(screens: string[], log: string[]) {
  let t = 0; let cap = 0;
  const deps = {
    execute: async (name: string, input: Record<string, unknown>) => {
      log.push(`${name}:${input.action}:${String(input.command ?? '').slice(0, 30)}`);
      if (input.action === 'capture') { const s = screens[Math.min(cap, screens.length - 1)]!; cap++; return { llmContent: `Captured output from tmux session 'x':\n\n${'='.repeat(60)}\n${s}${'='.repeat(60)}\n` }; }
      return { llmContent: 'ok' };
    },
    recordEvent: (_k: string, _d: Record<string, unknown>) => {},
    sleep: async (ms: number) => { t += ms; },
    now: () => t,
  };
  return deps;
}

describe('R179 frameRunner — time efficiency', () => {
  it('returns as soon as the prompt is back, not after the requested 60 s', async () => {
    const log: string[] = [];
    const screens = ['root@x:/app$ ls\nfile\n__RC=0\nroot@x:/app$ '];
    const r = new FrameRunner({ ...FRAME_CONFIG_DEFAULTS, frame: 'terminus' }, fakeDeps(screens, log));
    const res = await r.step({ action: { analysis: 'a', plan: 'p', candidates: [{ label: 'list', keystrokes: 'ls\n', duration_s: 60 }] }, task: 'list the files', elapsedMs: 0, deadlineMs: 0, cwd: '/app', sessionId: 's', predictorModel: 'gen' });
    expect(res.isError).toBe(false);
    expect(res.meta.running).toBe(false);
    expect(res.meta.rc).toBe(0);
    const waited = Number((res.content.match(/rc 0 in (\d+) s/) ?? [])[1] ?? -1);
    expect(waited).toBeGreaterThanOrEqual(0); expect(waited).toBeLessThan(10); // ~2 s, not 60
  });
  it('hands a still-running command back after the requested duration plus one grace', async () => {
    const log: string[] = [];
    const screens = ['building... 10%', 'building... 20%', 'building... 30%', 'building... 40%', 'building... 50%'];
    const r = new FrameRunner({ ...FRAME_CONFIG_DEFAULTS, frame: 'terminus' }, fakeDeps(screens, log));
    const res = await r.step({ action: { analysis: 'a', plan: 'p', candidates: [{ label: 'build', keystrokes: 'make\n', duration_s: 4 }] }, task: 'build it', elapsedMs: 0, deadlineMs: 0, cwd: '/app', sessionId: 's', predictorModel: 'gen' });
    expect(res.meta.running).toBe(true);
    expect(res.content).toContain('STILL RUNNING'); expect(res.content).toContain('WAIT'); expect(res.content).toContain('INTERRUPT');
  });
});

describe('R180 pane recovery', () => {
  const DEAD = "Session 'frame-s-abcd' does not exist";
  const PROMPT = 'root@x:/app$ \n__RC=0\nroot@x:/app$ ';
  it('respawns the pane when the session died during a step and tells the writer', async () => {
    const log: string[] = [];
    const screens = [PROMPT, PROMPT, DEAD, PROMPT, PROMPT]; // before, after ls, after C-d (dead), after the reset, …
    const r = new FrameRunner({ ...FRAME_CONFIG_DEFAULTS, frame: 'terminus', keyGuard: false }, fakeDeps(screens, log)); // guard off: this test is about recovery
    await r.step({ action: { analysis: 'a', plan: 'p', candidates: [{ label: 'list', keystrokes: 'ls\n', duration_s: 3 }] }, task: 't', elapsedMs: 0, deadlineMs: 0, cwd: '/app', sessionId: 's', predictorModel: 'gen' });
    const res = await r.step({ action: { analysis: 'a', plan: 'p', candidates: [{ label: 'eof', keystrokes: 'C-d', duration_s: 3 }] }, task: 't', elapsedMs: 0, deadlineMs: 0, cwd: '/app', sessionId: 's', predictorModel: 'gen' });
    expect(res.content).toContain('PANE RESET (1)');
    expect(res.content).not.toContain('does not exist');
    expect(res.meta.running).toBe(false);
    expect(log.filter((l) => l.startsWith('TmuxSession:create')).length).toBe(2);
    expect(log.some((l) => l.startsWith('TmuxSession:kill'))).toBe(true);
  });
  it('offers RESET THE PANE after four promptless turns with an interrupt, and the named template resets', async () => {
    const log: string[] = [];
    const screens = ['building...'];
    const r = new FrameRunner({ ...FRAME_CONFIG_DEFAULTS, frame: 'terminus' }, fakeDeps(screens, log));
    const go = (label: string, keys: string) => r.step({ action: { analysis: 'a', plan: 'p', candidates: [{ label, keystrokes: keys, duration_s: 2 }] }, task: 't', elapsedMs: 0, deadlineMs: 0, cwd: '/app', sessionId: 's', predictorModel: 'gen' });
    await go('run', 'python3 x.py\n'); await go('stop', 'C-c'); await go('stop again', 'C-c');
    const r4 = await go('probe', 'echo hi\n');
    expect(r4.content).toContain('RESET THE PANE');
    const before = log.filter((l) => l.startsWith('TmuxSession:create')).length;
    const r5 = await go('RESET THE PANE', '');
    expect(r5.content).toContain('PANE RESET (1)');
    expect(log.filter((l) => l.startsWith('TmuxSession:create')).length).toBe(before + 1);
    expect(r5.meta.pick).toBe('c1');
  });
});

describe('R182 keystroke guard in the runner', () => {
  const PROMPT = 'root@x:/app$ \n__RC=0\nroot@x:/app$ ';
  it('does not send a blocked C-d at an idle prompt and tells the writer; nothing else is sent either', async () => {
    const log: string[] = [];
    const r = new FrameRunner({ ...FRAME_CONFIG_DEFAULTS, frame: 'terminus' }, fakeDeps([PROMPT], log));
    const res = await r.step({ action: { analysis: 'a', plan: 'p', candidates: [{ label: 'eof', keystrokes: 'C-d', duration_s: 2 }] }, task: 't', elapsedMs: 0, deadlineMs: 0, cwd: '/app', sessionId: 's', predictorModel: 'gen' });
    expect(res.content).toContain('BLOCKED by the keystroke guard');
    expect(res.meta.action).toBe('refuse'); expect(res.meta.pick).toBe(null);
    expect(log.some((l) => l.startsWith('TmuxSession:send:C-d'))).toBe(false);
  });
  it('falls to the second candidate when the first is destructive, and off means off', async () => {
    const log: string[] = [];
    const r = new FrameRunner({ ...FRAME_CONFIG_DEFAULTS, frame: 'terminus', candidates: 3 }, fakeDeps([PROMPT], log));
    const res = await r.step({ action: { analysis: 'a', plan: 'p', candidates: [{ label: 'nuke', keystrokes: 'rm -rf /\n', duration_s: 2 }, { label: 'ls', keystrokes: 'ls\n', duration_s: 2 }] }, task: 't', elapsedMs: 0, deadlineMs: 0, cwd: '/app', sessionId: 's', predictorModel: 'gen' });
    expect(res.meta.pick).toBe('c2'); expect(log.some((l) => l.startsWith('TmuxSession:send:ls'))).toBe(true); expect(log.some((l) => l.includes('rm -rf'))).toBe(false);
    const log2: string[] = [];
    const r2 = new FrameRunner({ ...FRAME_CONFIG_DEFAULTS, frame: 'terminus', keyGuard: false }, fakeDeps([PROMPT], log2));
    await r2.step({ action: { analysis: 'a', plan: 'p', candidates: [{ label: 'x', keystrokes: 'exit\n', duration_s: 2 }] }, task: 't', elapsedMs: 0, deadlineMs: 0, cwd: '/app', sessionId: 's', predictorModel: 'gen' });
    expect(log2.some((l) => l.startsWith('TmuxSession:send:exit'))).toBe(true);
  });
});
