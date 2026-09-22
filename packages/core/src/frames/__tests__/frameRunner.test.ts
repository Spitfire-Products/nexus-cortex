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
