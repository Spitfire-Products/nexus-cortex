/**
 * HB-HERDR-TERMINAL-BACKEND (R146, 2026-09-14): TmuxSession create/send/capture/list/kill
 * map to herdr panes when the resolved backend is herdr; snapshot stays tmux-only.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const state = vi.hoisted(() => ({ backend: null as any }));
vi.mock('../../../utils/TerminalBackend.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../utils/TerminalBackend.js')>();
  return {
    ...orig,
    resolveTerminalBackend: vi.fn(async (...args: any[]) =>
      state.backend ?? (orig.resolveTerminalBackend as any)(...args)),
  };
});

import { TmuxSessionTool } from '../TmuxSessionTool.js';
import { TmuxManager } from '../../../utils/TmuxManager.js';
import { HerdrTerminalBackend, resetTerminalBackendCache, type BackendExecFn, type BackendExecResult } from '../../../utils/TerminalBackend.js';

const ok = (stdout = ''): BackendExecResult => ({ stdout, stderr: '', code: 0 });

describe('R146: TmuxSession on the herdr backend', () => {
  const dirs: string[] = [];
  afterEach(() => {
    state.backend = null;
    resetTerminalBackendCache();
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('create/send/capture/list/kill map to pane split/send-text+Enter/read/close; snapshot errors clearly', async () => {
    const calls: string[][] = [];
    const exec: BackendExecFn = async (_bin, args) => {
      calls.push(args);
      if (args[1] === 'split') return ok(JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }));
      if (args[1] === 'read') return ok('$ echo captured\ncaptured\n$ ');
      if (args[1] === 'close') return ok('{"result":{"type":"ok"}}');
      return ok();
    };
    state.backend = new HerdrTerminalBackend({ bin: '/fake/herdr', parentPaneId: 'w1:p1', exec });
    const tmux = TmuxManager.getInstance();
    const avail = vi.spyOn(tmux, 'isAvailable');
    const create = vi.spyOn(tmux, 'createSession');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmuxtool-herdr-'));
    dirs.push(dir);
    const tool = new TmuxSessionTool({ workingDirectory: dir });
    const sig = new AbortController().signal;

    const created = await tool.execute({ action: 'create', sessionId: 'mon', cwd: dir }, sig);
    expect(created.success).toBe(true);
    expect((created.llmContent as string).split('\n')[0]).toMatch(/^\[INFO\] terminal backend: herdr pane backend/);
    expect(created.metadata?.paneId).toBe('w1:p5');
    expect(created.metadata?.sessionId).toBe('mon');
    expect(calls[0]).toEqual(['pane', 'split', 'w1:p1', '--direction', 'down', '--no-focus', '--cwd', dir]);
    expect(calls[1]).toEqual(['pane', 'rename', 'w1:p5', 'mon']);

    const sent = await tool.execute({ action: 'send', sessionId: 'mon', command: 'echo captured' }, sig);
    expect(sent.success).toBe(true);
    expect(calls.slice(-2)).toEqual([
      ['pane', 'send-text', 'w1:p5', 'echo captured'],
      ['pane', 'send-keys', 'w1:p5', 'Enter'],
    ]);

    const cap = await tool.execute({ action: 'capture', sessionId: 'mon' }, sig);
    expect(cap.success).toBe(true);
    expect(cap.llmContent as string).toContain('captured');
    expect(calls[calls.length - 1]).toEqual(['pane', 'read', 'w1:p5', '--source', 'recent-unwrapped', '--lines', '200']);

    const hist = await tool.execute({ action: 'capture', sessionId: 'mon', captureHistory: true }, sig);
    expect(hist.success).toBe(true);
    expect(calls[calls.length - 1].slice(-2)).toEqual(['--lines', '3000']);

    const list = await tool.execute({ action: 'list' }, sig);
    expect(list.success).toBe(true);
    expect(list.metadata?.sessions).toEqual([{ sessionId: 'w1:p5', paneId: 'w1:p5' }]);

    const snap = await tool.execute({ action: 'snapshot', sessionId: 'mon' }, sig);
    expect(snap.success).toBe(false);
    expect(snap.error).toContain('tmux-only');
    expect(snap.error).toContain("action='capture'");

    const missing = await tool.execute({ action: 'send', sessionId: 'nope', command: 'ls' }, sig);
    expect(missing.success).toBe(false);
    expect(missing.error).toContain("'nope' does not exist");

    const killed = await tool.execute({ action: 'kill', sessionId: 'mon' }, sig);
    expect(killed.success).toBe(true);
    expect(calls[calls.length - 1]).toEqual(['pane', 'close', 'w1:p5']);

    expect(avail).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('R142 wait action (herdr): maps to `pane wait-output --match|--regex --timeout`; reports matched / timeout', async () => {
    const calls: string[][] = [];
    let timeout = false;
    const exec: BackendExecFn = async (_bin, args) => {
      calls.push(args);
      if (args[1] === 'split') return ok(JSON.stringify({ result: { pane: { pane_id: 'w1:p5' } } }));
      if (args[1] === 'wait-output') {
        if (timeout) return { stdout: '', stderr: JSON.stringify({ error: { code: 'timeout' } }), code: 1 };
        return ok(JSON.stringify({ result: { matched_line: 'ready 7', read: { text: 'boot\nready 7' } } }));
      }
      if (args[1] === 'read') return ok('boot\nstill booting');
      return ok();
    };
    state.backend = new HerdrTerminalBackend({ bin: '/fake/herdr', parentPaneId: 'w1:p1', exec });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmuxtool-wait-'));
    dirs.push(dir);
    const tool = new TmuxSessionTool({ workingDirectory: dir });
    const sig = new AbortController().signal;
    await tool.execute({ action: 'create', sessionId: 'mon', cwd: dir }, sig);

    const hit = await tool.execute({ action: 'wait', sessionId: 'mon', regex: 'ready \\d+', timeoutMs: 2000 }, sig);
    expect(hit.success).toBe(true);
    expect(calls[calls.length - 1]).toEqual(['pane', 'wait-output', 'w1:p5', '--regex', 'ready \\d+', '--timeout', '2000']);
    expect(hit.llmContent as string).toMatch(/^\[wait\] \d+(\.\d)?s, matched\n/);
    expect(hit.llmContent as string).toContain('ready 7');
    expect(hit.metadata?.matched).toBe(true);

    timeout = true;
    const miss = await tool.execute({ action: 'wait', sessionId: 'mon', match: 'never', timeoutMs: 100 }, sig);
    expect(miss.success).toBe(true);
    expect(calls.find((c) => c[1] === 'wait-output' && c[3] === '--match')).toEqual(['pane', 'wait-output', 'w1:p5', '--match', 'never', '--timeout', '100']);
    expect(miss.llmContent as string).toMatch(/^\[wait\] \d+(\.\d)?s, timeout\n/);
    expect(miss.llmContent as string).toContain('still booting');
    expect(miss.metadata?.matched).toBe(false);

    const bad = await tool.execute({ action: 'wait', sessionId: 'mon' }, sig);
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/match or regex/);
  });

  it('R142 wait action (tmux): polls capture-pane for the text and returns matched / timeout', async () => {
    const tmux = TmuxManager.getInstance();
    vi.spyOn(tmux, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(tmux, 'sessionExists').mockResolvedValue(true);
    let n = 0;
    vi.spyOn(tmux, 'capturePane').mockImplementation(async () => (++n >= 2 ? '$ run\nready 9\n' : '$ run\nbooting\n'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmuxtool-wait-tmux-'));
    dirs.push(dir);
    const tool = new TmuxSessionTool({ workingDirectory: dir });
    const sig = new AbortController().signal;
    const hit = await tool.execute({ action: 'wait', sessionId: 's1', regex: 'ready \\d+', timeoutMs: 5000 }, sig);
    expect(hit.success).toBe(true);
    expect(hit.llmContent as string).toMatch(/^\[wait\] \d+(\.\d)?s, matched\n/);
    expect(hit.llmContent as string).toContain('ready 9');
    expect(n).toBeGreaterThanOrEqual(2);
    const miss = await tool.execute({ action: 'wait', sessionId: 's1', match: 'never', timeoutMs: 300 }, sig);
    expect(miss.llmContent as string).toMatch(/^\[wait\] \d+(\.\d)?s, timeout\n/);
    expect(miss.metadata?.matched).toBe(false);
  });
});
