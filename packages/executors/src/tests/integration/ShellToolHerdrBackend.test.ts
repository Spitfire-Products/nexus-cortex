/**
 * HB-HERDR-TERMINAL-BACKEND (R146, 2026-09-14): Bash persistentSession routes to the
 * herdr backend when it resolves (one [INFO] line, tmux untouched), to tmux when herdr
 * is absent, and to the R134 detached fallback when both are absent.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const state = vi.hoisted(() => ({ backend: null as any }));
vi.mock('../../utils/TerminalBackend.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../utils/TerminalBackend.js')>();
  return {
    ...orig,
    resolveTerminalBackend: vi.fn(async (...args: any[]) =>
      state.backend ?? (orig.resolveTerminalBackend as any)(...args)),
  };
});

import { ShellTool } from '../../implementations/execution/ShellTool.js';
import { TmuxManager } from '../../utils/TmuxManager.js';
import { HerdrTerminalBackend, resetTerminalBackendCache, type BackendExecFn, type BackendExecResult } from '../../utils/TerminalBackend.js';
import { BackgroundProcessRegistry } from '../../implementations/execution/BackgroundProcessRegistry.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

const ok = (stdout = ''): BackendExecResult => ({ stdout, stderr: '', code: 0 });

function herdrBackend(opts: { complete?: boolean } = {}) {
  const calls: string[][] = [];
  let token = '';
  const exec: BackendExecFn = async (_bin, args) => {
    calls.push(args);
    if (args[1] === 'split') return ok(JSON.stringify({ result: { pane: { pane_id: 'w1:p4' } } }));
    if (args[1] === 'run' || args[1] === 'send-text') {
      token = (args[3] as string).match(/__CORTEX_DONE_([0-9a-f]+)_/)![1];
      return ok();
    }
    if (args[1] === 'wait-output') {
      // herdr 0.9.0 prints the timeout error envelope on STDERR with rc 1 (verified live)
      if (opts.complete === false) return { stdout: '', stderr: JSON.stringify({ error: { code: 'timeout' } }), code: 1 };
      return ok(JSON.stringify({ result: { matched_line: `__CORTEX_DONE_${token}_0__`, read: { text: '' } } }));
    }
    if (args[1] === 'read') return ok(`$ echo hi; printf ...\nhi-from-herdr\n\n__CORTEX_DONE_${token}_0__\n$ `);
    return ok('{"result":{"type":"ok"}}');
  };
  const backend = new HerdrTerminalBackend({ bin: '/fake/herdr', parentPaneId: 'w1:p1', exec });
  return { backend, calls };
}

describe('R146: persistentSession backend routing', () => {
  const dirs: string[] = [];
  afterEach(() => {
    state.backend = null;
    resetTerminalBackendCache();
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const mkTool = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-herdr-'));
    dirs.push(dir);
    return new ShellTool({ workingDirectory: dir } as ExecutorConfig);
  };

  it('routes to the herdr pane when the backend resolves: [INFO] line first, tmux never called', async () => {
    const { backend, calls } = herdrBackend();
    state.backend = backend;
    const tmux = TmuxManager.getInstance();
    const avail = vi.spyOn(tmux, 'isAvailable');
    const create = vi.spyOn(tmux, 'createSession');
    const send = vi.spyOn(tmux, 'sendKeys');

    const t = mkTool();
    const res = await t.execute({ command: 'echo hi', persistentSession: true, sessionId: 'monitor' }, new AbortController().signal);
    expect(res.success).toBe(true);
    const text = res.llmContent as string;
    expect(text.split('\n')[0]).toBe('[INFO] persistent session via herdr pane w1:p4');
    expect(text).toContain('hi-from-herdr');
    expect(text).not.toContain('__CORTEX_DONE_');
    expect(text).toContain("sessionId='monitor'");
    expect(res.metadata?.backend).toBe('herdr');
    expect(res.metadata?.paneId).toBe('w1:p4');
    expect(res.metadata?.completed).toBe(true);
    expect(res.metadata?.exitCode).toBe(0);
    expect(avail).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(calls[0].slice(0, 6)).toEqual(['pane', 'split', 'w1:p1', '--direction', 'down', '--no-focus']);
    expect(calls.some((c) => c[1] === 'rename' && c[3] === 'monitor')).toBe(true);
    expect(calls.some((c) => c[1] === 'wait-output')).toBe(true);

    // Second call with the label reuses the pane (no second split).
    const splits = calls.filter((c) => c[1] === 'split').length;
    const again = await t.execute({ command: 'echo hi', persistentSession: true, sessionId: 'monitor' }, new AbortController().signal);
    expect(again.metadata?.paneId).toBe('w1:p4');
    expect(calls.filter((c) => c[1] === 'split').length).toBe(splits);
  });

  it('an incomplete herdr run registers a BashOutput handle whose read pulls `pane read`', async () => {
    const { backend, calls } = herdrBackend({ complete: false });
    state.backend = backend;
    const t = mkTool();
    const res = await t.execute({ command: 'echo hi', persistentSession: true, timeout: 1000 }, new AbortController().signal);
    expect(res.success).toBe(true);
    expect(res.metadata?.completed).toBe(false);
    const bashId = res.metadata?.bash_id as string;
    expect(bashId).toBe('herdr-w1:p4');
    expect(res.llmContent as string).toContain(`BashOutput({ bash_id: "${bashId}" })`);
    const reg = BackgroundProcessRegistry.getInstance();
    const handle = reg.getProcess(bashId)!;
    expect(handle.pid).toBe(0);
    const readsBefore = calls.filter((c) => c[1] === 'read').length;
    await handle.refresh!();
    expect(calls.filter((c) => c[1] === 'read').length).toBe(readsBefore + 1);
    expect(handle.output.join('\n')).toContain('hi-from-herdr');
    expect(reg.killProcess(bashId)).toBe(true);
    expect(calls[calls.length - 1]).toEqual(['pane', 'send-keys', 'w1:p4', 'C-c']);
    reg.removeProcess(bashId);
  });

  it('R142: wait_for on the herdr path -> ONE combined --regex to pane wait-output; a user match reports waitMatched + a BashOutput handle', async () => {
    const calls: string[][] = [];
    const exec: BackendExecFn = async (_bin, args) => {
      calls.push(args);
      if (args[1] === 'split') return ok(JSON.stringify({ result: { pane: { pane_id: 'w1:p6' } } }));
      if (args[1] === 'wait-output') return ok(JSON.stringify({ result: { matched_line: 'listening on port 8080', read: { text: '' } } }));
      if (args[1] === 'read') return ok('$ node server.js; printf ...\nstarting\nlistening on port 8080\n');
      return ok('{"result":{"type":"ok"}}');
    };
    state.backend = new HerdrTerminalBackend({ bin: '/fake/herdr', parentPaneId: 'w1:p1', exec });
    const t = mkTool();
    const res = await t.execute({ command: 'node server.js', persistentSession: true, sessionId: 'srv', wait_for: 'listening on port \\d+', timeout: 5000 }, new AbortController().signal);
    expect(res.success).toBe(true);
    const wait = calls.find((c) => c[1] === 'wait-output')!;
    expect(wait.slice(0, 4)).toEqual(['pane', 'wait-output', 'w1:p6', '--regex']);
    expect(wait[4]).toMatch(/__CORTEX_DONE_[0-9a-f]+_\(\\d\+\)__/);
    expect(wait[4]).toContain('listening on port \\d+');
    expect(wait.slice(5)).toEqual(['--timeout', '5000']);
    expect(res.metadata?.completed).toBe(false);
    expect(res.metadata?.waitMatched).toBe(true);
    expect(res.metadata?.bash_id).toBe('herdr-w1:p6');
    expect(res.llmContent as string).toMatch(/wait_for .*matched/);
    expect(res.llmContent as string).toContain('listening on port 8080');
    BackgroundProcessRegistry.getInstance().removeProcess('herdr-w1:p6');
  });

  it('uses the tmux path when herdr is absent', async () => {
    const tmux = TmuxManager.getInstance();
    vi.spyOn(tmux, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(tmux, 'waitForChannel').mockResolvedValue({ signaled: true }); // R139: no real wait-for
    vi.spyOn(tmux, 'sessionExists').mockResolvedValue(false);
    vi.spyOn(tmux, 'createSession').mockImplementation(async (id) => id || 'x');
    let sent = '';
    vi.spyOn(tmux, 'sendKeys').mockImplementation(async (_id, cmd) => { sent = cmd; });
    vi.spyOn(tmux, 'capturePane').mockImplementation(async () => {
      const s = sent.match(/__CORTEX_DONE_[0-9a-f]+/)![0];
      return `tmux-out\n${s}_0\n`;
    });
    const t = mkTool();
    const res = await t.execute({ command: 'echo hi', persistentSession: true, sessionId: 'sess-1' }, new AbortController().signal);
    expect(res.success).toBe(true);
    expect(res.llmContent as string).toContain("persistent tmux session 'sess-1'");
    expect(res.llmContent as string).not.toContain('[INFO] persistent session via herdr');
    expect(res.metadata?.backend).toBeUndefined();
  });

  it('degrades to the R134 detached fallback when both herdr and tmux are absent', async () => {
    vi.spyOn(TmuxManager.getInstance(), 'isAvailable').mockResolvedValue(false);
    vi.spyOn(TmuxManager.getInstance(), 'ensureTmux').mockResolvedValue({ available: false, tried: [] });
    const t = mkTool();
    const res = await t.execute({ command: 'echo detached-path', persistentSession: true }, new AbortController().signal);
    expect(res.success).toBe(true);
    expect((res.llmContent as string).split('\n')[0]).toMatch(/^\[WARN\] tmux not available: persistentSession downgraded/);
    const id = res.metadata?.bash_id as string;
    const reg = BackgroundProcessRegistry.getInstance();
    reg.killProcess(id); reg.removeProcess(id);
  });
});
