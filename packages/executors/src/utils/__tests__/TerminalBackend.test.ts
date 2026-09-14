/**
 * HB-HERDR-TERMINAL-BACKEND (R146, 2026-09-14): the TerminalBackend seam.
 * herdr (HERDR_ENV=1 + binary + `pane list` ok) > tmux (TmuxManager) > detached.
 * Argv shapes verified live against herdr 0.9.0 (session `bench`, 2026-09-14).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  HerdrTerminalBackend,
  TmuxTerminalBackend,
  DetachedTerminalBackend,
  resolveTerminalBackend,
  resetTerminalBackendCache,
  truncateMiddle,
  HERDR_READ_CAP_CHARS,
  type BackendExecFn,
  type BackendExecResult,
} from '../TerminalBackend.js';
import { TmuxManager } from '../TmuxManager.js';
import { BackgroundProcessRegistry } from '../../implementations/execution/BackgroundProcessRegistry.js';

const ok = (stdout = ''): BackendExecResult => ({ stdout, stderr: '', code: 0 });
const splitJson = (paneId: string) =>
  JSON.stringify({ id: 'cli:pane:split', result: { pane: { pane_id: paneId, cwd: '/tmp' }, type: 'pane_info' } });
const listJson = (...ids: string[]) =>
  JSON.stringify({ id: 'cli:pane:list', result: { panes: ids.map((pane_id) => ({ pane_id })), type: 'pane_list' } });
const matchedJson = (line: string, text: string) =>
  JSON.stringify({ id: 'cli:pane:wait-output', result: { matched_line: line, read: { text }, type: 'output_matched' } });
/** herdr prints ERROR envelopes (timeout, rc 1) on STDERR — fixtures place it there (verified live). */
const timeoutJson = () =>
  JSON.stringify({ error: { code: 'timeout', message: 'timed out waiting for output match' }, id: 'cli:pane:wait-output' });

/** Scripted exec: records argv, answers by subcommand. */
function makeExec(script: (args: string[], calls: string[][]) => BackendExecResult | Promise<BackendExecResult>) {
  const calls: string[][] = [];
  const exec: BackendExecFn = async (_bin, args) => {
    calls.push(args);
    return script(args, calls);
  };
  return { exec, calls };
}

let fakeBinDir: string;
let fakeBin: string;
beforeEach(() => {
  fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-bin-'));
  fakeBin = path.join(fakeBinDir, 'herdr');
  fs.writeFileSync(fakeBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
});
afterEach(() => {
  resetTerminalBackendCache();
  vi.restoreAllMocks();
  fs.rmSync(fakeBinDir, { recursive: true, force: true });
});

const herdrEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  HERDR_ENV: '1',
  HERDR_PANE_ID: 'w1:p1',
  HERDR_SESSION: 'bench',
  CORTEX_HERDR_BIN: fakeBin,
  PATH: '/nonexistent',
  ...extra,
});

describe('truncateMiddle (R141 inherited: keep head + tail, omit the middle)', () => {
  it('returns short text unchanged', () => {
    expect(truncateMiddle('hello', 100)).toBe('hello');
  });
  it('keeps head and tail and marks the omitted count', () => {
    const text = 'H'.repeat(6000) + 'T'.repeat(6000);
    const out = truncateMiddle(text, HERDR_READ_CAP_CHARS);
    expect(out.length).toBeLessThanOrEqual(HERDR_READ_CAP_CHARS + 80);
    expect(out.startsWith('HHHH')).toBe(true);
    expect(out.endsWith('TTTT')).toBe(true);
    expect(out).toMatch(/\.\.\. \[\d+ chars omitted\] \.\.\./);
  });
});

describe('resolveTerminalBackend order + lever', () => {
  it('picks herdr when HERDR_ENV=1, the binary resolves and `pane list` succeeds', async () => {
    const { exec, calls } = makeExec(() => ok(listJson('w1:p1')));
    const backend = await resolveTerminalBackend(herdrEnv(), { exec });
    expect(backend.kind).toBe('herdr');
    expect(calls[0]).toEqual(['pane', 'list']);
    expect(backend.describe()).toContain('herdr');
  });

  it('falls to tmux when HERDR_ENV is unset and tmux is available', async () => {
    vi.spyOn(TmuxManager.getInstance(), 'isAvailable').mockResolvedValue(true);
    const { exec, calls } = makeExec(() => ok(listJson()));
    const backend = await resolveTerminalBackend({ PATH: '/nonexistent' }, { exec });
    expect(backend.kind).toBe('tmux');
    expect(calls).toHaveLength(0);
  });

  it('falls to herdr->tmux when `pane list` fails (socket down)', async () => {
    vi.spyOn(TmuxManager.getInstance(), 'isAvailable').mockResolvedValue(true);
    const { exec } = makeExec(() => ({ stdout: '{"error":{"code":"server_not_running"}}', stderr: '', code: 1 }));
    const backend = await resolveTerminalBackend(herdrEnv(), { exec });
    expect(backend.kind).toBe('tmux');
  });

  it('falls to detached when neither herdr nor tmux is available', async () => {
    vi.spyOn(TmuxManager.getInstance(), 'isAvailable').mockResolvedValue(false);
    const { exec } = makeExec(() => ok(listJson()));
    const backend = await resolveTerminalBackend({ PATH: '/nonexistent' }, { exec });
    expect(backend.kind).toBe('detached');
  });

  it('CORTEX_TERMINAL_BACKEND=tmux skips herdr even inside a pane', async () => {
    vi.spyOn(TmuxManager.getInstance(), 'isAvailable').mockResolvedValue(true);
    const { exec, calls } = makeExec(() => ok(listJson('w1:p1')));
    const backend = await resolveTerminalBackend(herdrEnv({ CORTEX_TERMINAL_BACKEND: 'tmux' }), { exec });
    expect(backend.kind).toBe('tmux');
    expect(calls).toHaveLength(0);
  });

  it('CORTEX_TERMINAL_BACKEND=detached skips herdr and tmux', async () => {
    const spy = vi.spyOn(TmuxManager.getInstance(), 'isAvailable').mockResolvedValue(true);
    const { exec } = makeExec(() => ok(listJson('w1:p1')));
    const backend = await resolveTerminalBackend(herdrEnv({ CORTEX_TERMINAL_BACKEND: 'detached' }), { exec });
    expect(backend.kind).toBe('detached');
    expect(spy).not.toHaveBeenCalled();
  });

  it('CORTEX_TERMINAL_BACKEND=herdr outside a pane warns once and falls through', async () => {
    vi.spyOn(TmuxManager.getInstance(), 'isAvailable').mockResolvedValue(true);
    const warn = vi.fn();
    const { exec } = makeExec(() => ok(listJson()));
    const backend = await resolveTerminalBackend({ PATH: '/nonexistent', CORTEX_TERMINAL_BACKEND: 'herdr' }, { exec, warn });
    expect(backend.kind).toBe('tmux');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[WARN\] CORTEX_TERMINAL_BACKEND=herdr/);
  });

  it('caches the resolution per process until reset', async () => {
    const { exec, calls } = makeExec(() => ok(listJson('w1:p1')));
    const a = await resolveTerminalBackend(herdrEnv(), { exec });
    const b = await resolveTerminalBackend(herdrEnv(), { exec });
    expect(b).toBe(a);
    expect(calls.filter((c) => c[1] === 'list')).toHaveLength(1);
    resetTerminalBackendCache();
    await resolveTerminalBackend(herdrEnv(), { exec });
    expect(calls.filter((c) => c[1] === 'list')).toHaveLength(2);
  });
});

describe('HerdrTerminalBackend argv + semantics (herdr 0.9.0)', () => {
  const mk = (script: Parameters<typeof makeExec>[0]) => {
    const { exec, calls } = makeExec(script);
    const backend = new HerdrTerminalBackend({ bin: '/fake/herdr', parentPaneId: 'w1:p1', exec });
    return { backend, calls };
  };

  it('createSession splits DOWN from the host pane without focus, with --cwd/--env, and records the id', async () => {
    const { backend, calls } = mk((args) => (args[1] === 'split' ? ok(splitJson('w1:p7')) : ok()));
    const { id } = await backend.createSession({ cwd: '/work', env: { FOO: 'bar' } });
    expect(id).toBe('w1:p7');
    expect(calls[0]).toEqual(['pane', 'split', 'w1:p1', '--direction', 'down', '--no-focus', '--cwd', '/work', '--env', 'FOO=bar']);
    expect(await backend.list()).toEqual(['w1:p7']);
  });

  it('createSession with a label renames the pane and resolves the label as an alias', async () => {
    const { backend, calls } = mk((args) => (args[1] === 'split' ? ok(splitJson('w1:p8')) : ok()));
    const { id } = await backend.createSession({ label: 'monitor' });
    expect(id).toBe('w1:p8');
    expect(calls[1]).toEqual(['pane', 'rename', 'w1:p8', 'monitor']);
    await backend.sendKeys('monitor', ['C-c']);
    expect(calls[2]).toEqual(['pane', 'send-keys', 'w1:p8', 'C-c']);
  });

  it('run (blocking) uses `pane run` + `wait-output --regex --timeout`, parses the exit code, strips the sentinel', async () => {
    const { backend, calls } = mk((args, all) => {
      const token = (all[0][3] as string).match(/__CORTEX_DONE_([0-9a-f]+)_/)![1];
      if (args[1] === 'wait-output') {
        return ok(matchedJson(`__CORTEX_DONE_${token}_3__`, ''));
      }
      if (args[1] === 'read') {
        return ok(`$ false; printf '\\n__CORTEX_DONE_${token}_%s__\\n' $?\nsome output\n\n__CORTEX_DONE_${token}_3__\n$ `);
      }
      return ok();
    });
    const res = await backend.run('w1:p2', 'false', { block: true, timeoutMs: 7000 });
    expect(calls[0][0]).toBe('pane');
    expect(calls[0][1]).toBe('run');
    expect(calls[0][2]).toBe('w1:p2');
    expect(calls[0][3]).toMatch(/^false; printf '\\n__CORTEX_DONE_[0-9a-f]+_%s__\\n' \$\?$/);
    expect(calls[1].slice(0, 4)).toEqual(['pane', 'wait-output', 'w1:p2', '--regex']);
    expect(calls[1][4]).toMatch(/^__CORTEX_DONE_[0-9a-f]+_\(\\d\+\)__$/);
    expect(calls[1].slice(5)).toEqual(['--timeout', '7000']);
    expect(calls[2].slice(0, 3)).toEqual(['pane', 'read', 'w1:p2']);
    expect(res.completed).toBe(true);
    expect(res.timedOut).toBeFalsy();
    expect(res.exitCode).toBe(3);
    expect(res.output).toContain('some output');
    expect(res.output).not.toContain('__CORTEX_DONE_');
  });

  it('run (blocking) reports timedOut + partial output when wait-output times out, never exceeding the caller timeout', async () => {
    const { backend, calls } = mk((args) => {
      if (args[1] === 'wait-output') return { stdout: '', stderr: timeoutJson(), code: 1 };
      if (args[1] === 'read') return ok('still going');
      return ok();
    });
    const res = await backend.run('w1:p2', 'sleep 999', { block: true, timeoutMs: 1500 });
    expect(res.completed).toBe(false);
    expect(res.timedOut).toBe(true);
    expect(res.output).toContain('still going');
    const wait = calls.find((c) => c[1] === 'wait-output')!;
    expect(wait[wait.indexOf('--timeout') + 1]).toBe('1500');
  });

  it('run (non-blocking) submits and returns immediately without wait-output', async () => {
    const { backend, calls } = mk(() => ok());
    const res = await backend.run('w1:p2', 'node server.js', { block: false });
    expect(res.completed).toBe(false);
    expect(calls.map((c) => c[1])).toEqual(['run']);
  });

  it('routes multi-line or >4 KB commands through send-text (bracketed paste) + send-keys Enter (R140 inherited)', async () => {
    const { backend, calls } = mk((args) => {
      if (args[1] === 'wait-output') return ok(matchedJson('__CORTEX_DONE_ff_0__', ''));
      if (args[1] === 'read') return ok('done');
      return ok();
    });
    const heredoc = 'cat <<EOF > f.txt\nline\nEOF';
    await backend.run('w1:p2', heredoc, { block: true, timeoutMs: 1000 });
    expect(calls[0].slice(0, 3)).toEqual(['pane', 'send-text', 'w1:p2']);
    expect(calls[0][3]).toMatch(/^cat <<EOF > f\.txt\nline\nEOF\nprintf '\\n__CORTEX_DONE_[0-9a-f]+_%s__\\n' \$\?$/);
    expect(calls[1]).toEqual(['pane', 'send-keys', 'w1:p2', 'Enter']);

    const big = 'echo ' + 'x'.repeat(5000);
    await backend.run('w1:p2', big, { block: false });
    const last = calls.slice(-2);
    expect(last[0][1]).toBe('send-text');
    expect(last[1]).toEqual(['pane', 'send-keys', 'w1:p2', 'Enter']);
  });

  it('sendText / sendKeys map 1:1', async () => {
    const { backend, calls } = mk(() => ok());
    await backend.sendText('w1:p2', 'hello');
    await backend.sendKeys('w1:p2', ['C-c', 'Enter']);
    expect(calls).toEqual([
      ['pane', 'send-text', 'w1:p2', 'hello'],
      ['pane', 'send-keys', 'w1:p2', 'C-c', 'Enter'],
    ]);
  });

  it('read uses `pane read --source recent-unwrapped --lines N` and caps output with middle omission (R141)', async () => {
    const big = 'A'.repeat(9000) + '\n' + 'B'.repeat(9000);
    const { backend, calls } = mk(() => ok(big));
    const out = await backend.read('w1:p2', { lines: 50 });
    expect(calls[0]).toEqual(['pane', 'read', 'w1:p2', '--source', 'recent-unwrapped', '--lines', '50']);
    expect(out.length).toBeLessThanOrEqual(HERDR_READ_CAP_CHARS + 80);
    expect(out).toMatch(/chars omitted/);
    await backend.read('w1:p2', { history: true });
    expect(calls[1].slice(-2)).toEqual(['--lines', '3000']);
  });

  it('waitOutput maps --match/--regex/--timeout and returns matched + text', async () => {
    const { backend, calls } = mk((args) =>
      args[1] === 'wait-output' ? ok(matchedJson('ready', 'server ready')) : ok('fallback'),
    );
    const res = await backend.waitOutput('w1:p2', { match: 'ready', timeoutMs: 3000 });
    expect(calls[0]).toEqual(['pane', 'wait-output', 'w1:p2', '--match', 'ready', '--timeout', '3000']);
    expect(res).toEqual({ matched: true, output: 'server ready' });
    const { backend: b2, calls: c2 } = mk((args) =>
      args[1] === 'wait-output' ? { stdout: '', stderr: timeoutJson(), code: 1 } : ok('partial'),
    );
    const miss = await b2.waitOutput('w1:p2', { regex: 'x+', timeoutMs: 10 });
    expect(c2[0]).toEqual(['pane', 'wait-output', 'w1:p2', '--regex', 'x+', '--timeout', '10']);
    expect(miss.matched).toBe(false);
    expect(miss.output).toBe('partial');
  });

  it('kill closes the pane and forgets it', async () => {
    const { backend, calls } = mk((args) => (args[1] === 'split' ? ok(splitJson('w1:p9')) : ok('{"result":{"type":"ok"}}')));
    await backend.createSession({});
    await backend.kill('w1:p9');
    expect(calls[1]).toEqual(['pane', 'close', 'w1:p9']);
    expect(await backend.list()).toEqual([]);
  });

  it('surfaces a herdr error envelope as an Error', async () => {
    const { backend } = mk(() => ({ stdout: '{"id":"cli:pane:split","error":{"code":"not_found","message":"no such pane"}}', stderr: '', code: 1 }));
    await expect(backend.createSession({})).rejects.toThrow(/no such pane/);
  });
});

describe('TmuxTerminalBackend (thin wrapper)', () => {
  it('delegates to TmuxManager', async () => {
    const tmux = TmuxManager.getInstance();
    vi.spyOn(tmux, 'isAvailable').mockResolvedValue(true);
    const create = vi.spyOn(tmux, 'createSession').mockResolvedValue('s1');
    const send = vi.spyOn(tmux, 'sendKeys').mockResolvedValue();
    const cap = vi.spyOn(tmux, 'capturePane').mockResolvedValue('captured');
    const list = vi.spyOn(tmux, 'listSessions').mockResolvedValue(['s1']);
    const kill = vi.spyOn(tmux, 'killSession').mockResolvedValue();
    const backend = new TmuxTerminalBackend(tmux);
    expect(backend.kind).toBe('tmux');
    expect(await backend.createSession({ cwd: '/w' })).toEqual({ id: 's1' });
    expect(create).toHaveBeenCalledWith(undefined, '/w', undefined);
    await backend.sendText('s1', 'ls');
    expect(send).toHaveBeenCalledWith('s1', 'ls');
    expect(await backend.read('s1', { history: true })).toBe('captured');
    expect(cap).toHaveBeenCalledWith('s1', -3000);
    expect(await backend.list()).toEqual(['s1']);
    await backend.kill('s1');
    expect(kill).toHaveBeenCalledWith('s1');
  });
});

describe('DetachedTerminalBackend (BackgroundProcessRegistry)', () => {
  it('run spawns a detached process registered under the session id; read pulls the registry', async () => {
    const backend = new DetachedTerminalBackend();
    expect(backend.kind).toBe('detached');
    const { id } = await backend.createSession({ cwd: os.tmpdir() });
    expect(id).toMatch(/^bg-/);
    const res = await backend.run(id, 'echo detached-ok', { block: true, timeoutMs: 5000 });
    expect(res.completed).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(await backend.read(id)).toContain('detached-ok');
    expect(await backend.list()).toContain(id);
    const reg = BackgroundProcessRegistry.getInstance();
    expect(reg.hasProcess(id)).toBe(true);
    await backend.kill(id);
    expect(reg.hasProcess(id)).toBe(false);
    await expect(backend.sendKeys(id, ['C-c'])).rejects.toThrow(/detached/);
  }, 10000);
});
