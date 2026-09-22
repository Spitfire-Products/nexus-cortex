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

describe('R183 soft-destructive arbitration with the chooser off', () => {
  const PROMPT = 'root@x:/app$ \n__RC=0\nroot@x:/app$ ';
  it('holds rm -rf of the task tree without a why, runs it with a justifying why', async () => {
    const log: string[] = [];
    const r = new FrameRunner({ ...FRAME_CONFIG_DEFAULTS, frame: 'terminus' }, fakeDeps([PROMPT], log));
    const held = await r.step({ action: { analysis: 'a', plan: 'p', candidates: [{ label: 'clean', keystrokes: 'rm -rf /app/*\n', duration_s: 2 }] }, task: 't', elapsedMs: 0, deadlineMs: 0, cwd: '/app', sessionId: 's', predictorModel: 'gen' });
    expect(held.content).toMatch(/carried no justification/); expect(log.some((l) => l.includes('rm -rf'))).toBe(false);
    const ran = await r.step({ action: { analysis: 'a', plan: 'p', candidates: [{ label: 'clean', keystrokes: 'rm -rf /app/*\n', duration_s: 2, why: 'the task says to rebuild the output tree from scratch' }] }, task: 't', elapsedMs: 0, deadlineMs: 0, cwd: '/app', sessionId: 's', predictorModel: 'gen' });
    expect(ran.meta.pick).toBe('c1'); expect(log.some((l) => l.includes('rm -rf'))).toBe(true);
  });
});

describe('R184 menu diversity with the chooser on', () => {
  const PROMPT = 'root@x:/app$ \n__RC=0\nroot@x:/app$ ';
  const cfg = { ...FRAME_CONFIG_DEFAULTS, frame: 'terminus' as const, chooser: 'jev' as const, candidates: 3, minCandidates: 2 };
  const one = { analysis: 'a', plan: 'p', candidates: [{ label: 'ls', keystrokes: 'ls\n', duration_s: 2 }] };
  const two = { analysis: 'a', plan: 'p', candidates: [{ label: 'ls', keystrokes: 'ls\n', duration_s: 2 }, { label: 'find', keystrokes: 'find . -name "*.py" | head\n', duration_s: 2 }] };
  const go = (r: FrameRunner, action: unknown) => r.step({ action, task: 't', elapsedMs: 0, deadlineMs: 0, cwd: '/app', sessionId: 's', predictorModel: 'gen' });
  it('asks once for alternatives without executing, then runs the resend', async () => {
    const log: string[] = []; const r = new FrameRunner(cfg, fakeDeps([PROMPT], log));
    const ask = await go(r, one);
    expect(ask.content).toContain('MENU NEEDS ALTERNATIVES'); expect(ask.meta.diversityReask).toBe(1); expect(log.some((l) => l.startsWith('TmuxSession:send:ls'))).toBe(false);
    const ran = await go(r, two);
    expect(ran.meta.pick).toBe('c1'); expect(ran.meta.distinctCandidates).toBe(2); expect(log.some((l) => l.startsWith('TmuxSession:send:ls'))).toBe(true);
  });
  it('does not re-ask twice in a row (a stubborn single candidate runs) and stops asking after five re-asks', async () => {
    const log: string[] = []; const r = new FrameRunner(cfg, fakeDeps([PROMPT], log));
    const a1 = await go(r, one); expect(a1.meta.diversityReask).toBe(1);
    const a2 = await go(r, one); expect(a2.meta.pick).toBe('c1'); // ran as given
    for (let i = 0; i < 4; i++) { const ask = await go(r, one); expect(ask.meta.diversityReask).toBe(i + 2); await go(r, one); }
    const after = await go(r, one); expect(after.meta.pick).toBe('c1'); expect(after.meta.diversityReask).toBeUndefined();
  });
  it('two variants of the same command are one action; the chooser-off arm never asks', async () => {
    const log: string[] = []; const r = new FrameRunner(cfg, fakeDeps([PROMPT], log));
    const same = await go(r, { analysis: 'a', plan: 'p', candidates: [{ label: 'ls', keystrokes: 'ls\n', duration_s: 2 }, { label: 'ls again', keystrokes: 'ls \n', duration_s: 3 }] });
    expect(same.content).toContain('MENU NEEDS ALTERNATIVES');
    const off = new FrameRunner({ ...FRAME_CONFIG_DEFAULTS, frame: 'terminus' }, fakeDeps([PROMPT], []));
    expect((await go(off, one)).meta.pick).toBe('c1');
  });
});

describe('R185 candidate author in the runner', () => {
  const PROMPT = 'root@x:/app$ \n__RC=0\nroot@x:/app$ ';
  const cfg = { ...FRAME_CONFIG_DEFAULTS, frame: 'terminus' as const, chooser: 'jev' as const, candidates: 3, minCandidates: 2, author: 'helper' as const };
  const one = { analysis: 'a', plan: 'p', candidates: [{ label: 'ls', keystrokes: 'ls\n', duration_s: 2 }] };
  it('fills the menu from the author (no re-ask), Jev can pick an authored candidate, and the event banks the author', async () => {
    const log: string[] = []; const events: any[] = []; let asked: any = null;
    const deps = { ...fakeDeps([PROMPT], log), recordEvent: (_k: string, d: any) => events.push(d),
      author: async (ctx: any) => { asked = ctx; return [{ label: 'find py', keystrokes: 'find . -name "*.py" | head\n', durationS: 3, why: 'locate sources' }, { label: 'readme', keystrokes: 'head -n 20 README.md\n', durationS: 2, why: 'orient' }]; },
      jev: async (_s: any, q: any) => { const a: Record<string, number> = { repeat: 0.1, unsafe: 0.05, questionable: 0.1, unaddressed_error: 0.1 }; for (const k of Object.keys(q)) if (k.startsWith('pick_')) a[k] = k === 'pick_c2' ? 0.9 : 0.2; return a; } };
    const r = new FrameRunner(cfg, deps);
    const res = await r.step({ action: one, task: 'find the python sources', elapsedMs: 0, deadlineMs: 0, cwd: '/app', sessionId: 's', predictorModel: 'gen' });
    expect(res.content).not.toContain('MENU NEEDS ALTERNATIVES');
    expect(asked.count).toBe(2); expect(asked.writerCandidates[0].keystrokes).toBe('ls\n');
    expect(res.meta.pick).toBe('c2'); expect(res.meta.pickSource).toBe('predictor'); expect(res.meta.authored).toBe(2);
    expect(log.some((l) => l.startsWith('TmuxSession:send:find . -name'))).toBe(true);
    expect(res.content).toContain('The harness chose');
    const ev = events.find((e) => e.authored !== undefined); expect(ev.authored).toBe(2); expect(ev.candidates.map((c: any) => c.source)).toEqual(['generator', 'predictor', 'predictor', 'template', 'template']);
  });
  it('an author failure or empty answer leaves the writer menu (never worse than the frame)', async () => {
    const log: string[] = [];
    const r = new FrameRunner(cfg, { ...fakeDeps([PROMPT], log), author: async () => { throw new Error('helper down'); } });
    const res = await r.step({ action: one, task: 't', elapsedMs: 0, deadlineMs: 0, cwd: '/app', sessionId: 's', predictorModel: 'gen' });
    expect(res.meta.pick).toBe('c1'); expect(res.meta.authored).toBe(0);
  });
});
