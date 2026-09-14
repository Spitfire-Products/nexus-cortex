/**
 * HB-TMUX-CAPTURE-CAP (R141, 2026-09-14): TmuxSession creates sessions with a fixed
 * geometry + raised history-limit, caps every capture at 10 KB (middle omitted) and
 * honors `lines` as a tail. Runs against a fake tmux exec swapped into the singleton.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TmuxSessionTool } from '../TmuxSessionTool.js';
import { TmuxManager } from '../../../utils/TmuxManager.js';
import { resetTerminalBackendCache, HERDR_READ_CAP_CHARS } from '../../../utils/TerminalBackend.js';

describe('R141: TmuxSession capture cap + create geometry', () => {
  const dirs: string[] = [];
  let calls: string[][];
  let screen: string;
  let original: TmuxManager;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['CORTEX_TERMINAL_BACKEND', 'CORTEX_TMUX_HISTORY_LIMIT', 'CORTEX_TMUX_PANE_SIZE', 'HERDR_ENV']) saved[k] = process.env[k];
    process.env.CORTEX_TERMINAL_BACKEND = 'tmux';
    delete process.env.CORTEX_TMUX_HISTORY_LIMIT;
    delete process.env.CORTEX_TMUX_PANE_SIZE;
    delete process.env.HERDR_ENV;
    resetTerminalBackendCache();
    calls = [];
    screen = '';
    original = TmuxManager.getInstance();
    const fake = TmuxManager.createWithExec(async (_bin, args) => {
      calls.push(args);
      if (args[0] === '-V') return { stdout: 'tmux 3.5a', stderr: '' };
      if (args.includes('show-options')) return { stdout: '2000\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    vi.spyOn(fake, 'sessionExists').mockResolvedValue(true);
    vi.spyOn(fake, 'capturePane').mockImplementation(async (_id, startLine) => {
      const lines = screen.split('\n');
      return startLine ? lines.slice(startLine).join('\n') : screen;
    });
    (TmuxManager as any).instance = fake;
  });
  afterEach(() => {
    (TmuxManager as any).instance = original;
    resetTerminalBackendCache();
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  const tool = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmuxtool-cap-'));
    dirs.push(dir);
    return new TmuxSessionTool({ workingDirectory: dir });
  };

  it('create: new-session carries -x 160 -y 40 and history-limit 50000 (global around it + session-level)', async () => {
    const res = await tool().execute({ action: 'create', sessionId: 'cap-s1' }, new AbortController().signal);
    expect(res.success).toBe(true);
    const create = calls.find((a) => a.includes('new-session'))!;
    expect(create.slice(create.indexOf('new-session'), create.indexOf('new-session') + 8)).toEqual(['new-session', '-d', '-s', 'cap-s1', '-x', '160', '-y', '40']);
    expect(create.slice(0, 4)).toEqual(['set-option', '-g', 'history-limit', '50000']);
    expect(create.join(' ')).toContain('set-option -t cap-s1 history-limit 50000');
    expect(create.slice(-4)).toEqual(['set-option', '-g', 'history-limit', '2000']);
  });

  it('capture > 10 KB is middle-truncated with head + tail intact and the marker present', async () => {
    screen = Array.from({ length: 800 }, (_, i) => `row-${i} ` + 'y'.repeat(60)).join('\n');
    const res = await tool().execute({ action: 'capture', sessionId: 'cap-s1' }, new AbortController().signal);
    expect(res.success).toBe(true);
    const text = res.llmContent as string;
    const body = text.slice(text.indexOf('='.repeat(60)) + 61, text.lastIndexOf('='.repeat(60)));
    expect(body.length).toBeLessThanOrEqual(HERDR_READ_CAP_CHARS + 80);
    expect(body.startsWith('row-0 ')).toBe(true);
    expect(body.trimEnd().endsWith('y'.repeat(60))).toBe(true);
    expect(body).toContain('row-799 ');
    expect(body).toMatch(/\.\.\. \[\d+ chars omitted\] \.\.\./);
  });

  it('lines: returns only the last N lines (capture is asked for -N) and reports lines in metadata', async () => {
    screen = Array.from({ length: 50 }, (_, i) => `row-${i}`).join('\n');
    const res = await tool().execute({ action: 'capture', sessionId: 'cap-s1', lines: 5 }, new AbortController().signal);
    expect(res.success).toBe(true);
    expect(res.llmContent as string).toContain('row-49');
    expect(res.llmContent as string).not.toContain('row-44\n');
    expect(res.metadata?.lines).toBe(5);
    const cap = (TmuxManager.getInstance().capturePane as any).mock.calls.at(-1);
    expect(cap).toEqual(['cap-s1', -5]);
  });

  it('rejects a non-positive lines value at validation', () => {
    expect(tool().validateToolParams({ action: 'capture', sessionId: 'cap-s1', lines: 0 })).toMatch(/lines must be a positive integer/);
    expect(tool().validateToolParams({ action: 'capture', sessionId: 'cap-s1', lines: 2.5 })).toMatch(/lines must be a positive integer/);
    expect(tool().validateToolParams({ action: 'capture', sessionId: 'cap-s1', lines: 5 })).toBeNull();
  });
});
