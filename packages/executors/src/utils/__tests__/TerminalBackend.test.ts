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
    vi.spyOn(TmuxManager.getInstance(), 'ensureTmux').mockResolvedValue({ available: false, tried: [] });
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

  it('R142 run(waitFor): a wait-output hit on the ECHOED command line is not a match; re-waits until the text appears after the echo', async () => {
    let waits = 0;
    const { backend, calls } = mk((args, all) => {
      const token = (all[0][3] as string).match(/__CORTEX_DONE_([0-9a-f]+)_/)![1];
      const echo = `$ sleep 3; echo READY 9090; printf '\\n__CORTEX_DONE_${token}_%s__\\n' $?`;
      if (args[1] === 'wait-output') {
        waits += 1;
        return ok(matchedJson(waits === 1 ? echo : 'READY 9090', ''));
      }
      if (args[1] === 'read') return ok(waits === 1 ? `${echo}\n` : `${echo}\nREADY 9090\n`);
      return ok();
    });
    const res = await backend.run('w1:p2', 'sleep 3; echo READY 9090', { block: true, timeoutMs: 5000, waitFor: { regex: 'READY \\d+' } });
    expect(waits).toBe(2);
    const wait = calls.find((c) => c[1] === 'wait-output')!;
    expect(wait[4]).toMatch(/^\(\?:__CORTEX_DONE_[0-9a-f]+_\(\\d\+\)__\)\|\(\?:READY \\d\+\)$/);
    expect(res.completed).toBe(false);
    expect(res.waitMatched).toBe(true);
    expect(res.output).toContain('READY 9090');
  });

  it('R142 run(waitFor): the sentinel still wins and reports completion', async () => {
    const { backend } = mk((args, all) => {
      const token = (all[0][3] as string).match(/__CORTEX_DONE_([0-9a-f]+)_/)![1];
      if (args[1] === 'wait-output') return ok(matchedJson(`__CORTEX_DONE_${token}_2__`, ''));
      if (args[1] === 'read') return ok(`out\n__CORTEX_DONE_${token}_2__\n`);
      return ok();
    });
    const res = await backend.run('w1:p2', 'make', { block: true, timeoutMs: 5000, waitFor: { match: 'never' } });
    expect(res.completed).toBe(true);
    expect(res.exitCode).toBe(2);
    expect(res.waitMatched).toBeFalsy();
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
    expect(send).toHaveBeenCalledWith('s1', 'ls', { enter: false });
    expect(await backend.read('s1', { history: true })).toBe('captured');
    expect(cap).toHaveBeenCalledWith('s1', -3000);
    expect(await backend.list()).toEqual(['s1']);
    await backend.kill('s1');
    expect(kill).toHaveBeenCalledWith('s1');
  });
});

describe('TmuxTerminalBackend paste path (R140 HB-TMUX-PASTE-BUFFER)', () => {
  /** Injected tmux exec: records argv; capture-pane is spied separately (execAsync path). */
  const mk = () => {
    const calls: string[][] = [];
    const tmux = TmuxManager.createWithExec(async (_bin, args) => {
      calls.push(args);
      return { stdout: args[0] === '-V' ? 'tmux 3.5a' : '', stderr: '' };
    });
    return { tmux, calls, backend: new TmuxTerminalBackend(tmux) };
  };

  it('run() with a heredoc: sentinel on its OWN line, body via load-buffer/paste-buffer, Enter separate, $? unescaped', async () => {
    const { tmux, calls, backend } = mk();
    let pasted = '';
    const origPaste = (tmux as any).pasteText.bind(tmux);
    vi.spyOn(tmux as any, 'pasteText').mockImplementation(async (id: string, text: string) => { pasted = text; return origPaste(id, text); });
    vi.spyOn(tmux, 'capturePane').mockImplementation(async () => {
      const token = pasted.match(/__CORTEX_DONE_([0-9a-f]+)_/)![1];
      return `$ cat <<EOF > f.txt\n> line\n> EOF\nline\n__CORTEX_DONE_${token}_0__\n$ `;
    });
    const res = await backend.run('s1', 'cat <<EOF > f.txt\nline\nEOF', { block: true, timeoutMs: 3000 });
    expect(pasted).toMatch(/^cat <<EOF > f\.txt\nline\nEOF\nprintf '__CORTEX_DONE_[0-9a-f]+_%d__\\n' \$\?; \S*tmux wait-for -S cortex-wf-[0-9a-f]+$/);
    expect(calls.map((c) => c[0])).toEqual(['-V', 'load-buffer', 'paste-buffer', 'send-keys', 'wait-for']); // R139: channel wait after Enter
    expect(calls[2].slice(0, 3)).toEqual(['paste-buffer', '-d', '-p']);
    expect(calls[3]).toEqual(['send-keys', '-t', 's1', 'Enter']);
    expect(res.completed).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.output).not.toContain('__CORTEX_DONE_');
  });

  it('run() with a > 2000-char single line takes the paste path; a short line keeps send-keys -l', async () => {
    const { calls, backend } = mk();
    await backend.run('s1', 'echo ' + 'x'.repeat(2500), { block: false });
    expect(calls.map((c) => c[0])).toEqual(['-V', 'load-buffer', 'paste-buffer', 'send-keys']);
    calls.length = 0;
    await backend.run('s1', 'true', { block: false });
    expect(calls.map((c) => c[0])).toEqual(['send-keys', 'send-keys']);
    expect(calls[0].slice(0, 4)).toEqual(['send-keys', '-t', 's1', '-l']);
    expect(calls[0][4]).toMatch(/^true; printf '__CORTEX_DONE_[0-9a-f]+_%d__\\n' \$\?; \S*tmux wait-for -S cortex-wf-[0-9a-f]+$/);
  });

  it('sendText is Enter-less (bracketed paste for multi-line); sendKeys sends tmux key names raw', async () => {
    const { calls, backend } = mk();
    await backend.sendText('s1', 'a\nb');
    expect(calls.map((c) => c[0])).toEqual(['-V', 'load-buffer', 'paste-buffer']);
    calls.length = 0;
    await backend.sendKeys('s1', ['C-c', 'Enter']);
    expect(calls).toEqual([['send-keys', '-t', 's1', 'C-c', 'Enter']]);
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

// HB-TMUX-WAIT-FOR (R139) + HB-TMUX-CAPTURE-CAP (R141) on the tmux backend: blocking runs
// signal a tmux wait-for channel after the exit-code sentinel and block on `wait-for`
// under the cap (no 400 ms poll loop); cap expiry = timedOut, process left running; the
// R142 waitFor regex keeps the poll; every read is capped at 10 KB middle-omitted.
describe('TmuxTerminalBackend wait-for + capture cap (R139/R141)', () => {
  const mk = (opts: { waitKilled?: boolean } = {}) => {
    const calls: { args: string[]; timeoutMs?: number }[] = [];
    const tmux = TmuxManager.createWithExec(async (_bin, args, o) => {
      calls.push({ args, timeoutMs: o?.timeoutMs });
      if (args[0] === '-V') return { stdout: 'tmux 3.5a', stderr: '' };
      if (args[0] === 'wait-for' && opts.waitKilled) { const e: any = new Error('killed'); e.killed = true; throw e; }
      return { stdout: '', stderr: '' };
    });
    return { tmux, calls, backend: new TmuxTerminalBackend(tmux) };
  };
  const tokenOf = (sent: string) => sent.match(/__CORTEX_DONE_([0-9a-f]+)_/)![1];

  it('blocking run: command ends with `; <tmux> wait-for -S cortex-wf-<token>`, waits on the channel with the cap, captures ONCE, parses rc', async () => {
    const { tmux, calls, backend } = mk();
    let sent = '';
    vi.spyOn(tmux, 'sendKeys').mockImplementation(async (_id, text) => { sent = text; });
    const cap = vi.spyOn(tmux, 'capturePane').mockImplementation(async () => `$ false; ...\nsome output\n__CORTEX_DONE_${tokenOf(sent)}_3__\n$ `);
    const res = await backend.run('s1', 'false', { block: true, timeoutMs: 7000 });
    const token = tokenOf(sent);
    expect(sent).toMatch(new RegExp(`^false; printf '__CORTEX_DONE_${token}_%d__\\\\n' \\$\\?; \\S*tmux wait-for -S cortex-wf-${token}$`));
    const wait = calls.find((c) => c.args[0] === 'wait-for')!;
    expect(wait.args).toEqual(['wait-for', `cortex-wf-${token}`]);
    expect(wait.timeoutMs).toBe(7000);
    expect(cap).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ completed: true, exitCode: 3 });
    expect(res.timedOut).toBeFalsy();
    expect(res.output).toContain('some output');
    expect(res.output).not.toContain('__CORTEX_DONE_');
  });

  it('cap expiry: timedOut:true, completed:false, output = current screen, nothing killed', async () => {
    const { tmux, calls, backend } = mk({ waitKilled: true });
    vi.spyOn(tmux, 'sendKeys').mockResolvedValue();
    vi.spyOn(tmux, 'capturePane').mockResolvedValue('$ sleep 999; ...\nstill going');
    const kill = vi.spyOn(tmux, 'killSession');
    const raw = vi.spyOn(tmux, 'sendRawKeys');
    const res = await backend.run('s1', 'sleep 999', { block: true, timeoutMs: 1000 });
    expect(res).toMatchObject({ completed: false, timedOut: true, exitCode: null });
    expect(res.output).toContain('still going');
    expect(calls.find((c) => c.args[0] === 'wait-for')!.timeoutMs).toBe(1000);
    expect(kill).not.toHaveBeenCalled();
    expect(raw).not.toHaveBeenCalled();
  });

  it('non-blocking run submits and returns without waiting on the channel', async () => {
    const { tmux, calls, backend } = mk();
    vi.spyOn(tmux, 'sendKeys').mockResolvedValue();
    const res = await backend.run('s1', 'node server.js', { block: false });
    expect(res).toEqual({ output: '', completed: false, exitCode: null });
    expect(calls.some((c) => c.args[0] === 'wait-for')).toBe(false);
  });

  it('R142 waitFor regex keeps the screen poll (no wait-for call) and still reports waitMatched', async () => {
    const { tmux, calls, backend } = mk();
    let sent = '';
    vi.spyOn(tmux, 'sendKeys').mockImplementation(async (_id, text) => { sent = text; });
    let n = 0;
    vi.spyOn(tmux, 'capturePane').mockImplementation(async () =>
      `$ node server.js; printf '__CORTEX_DONE_${tokenOf(sent)}_%d__\\n' $?; tmux wait-for -S x\nstarting${++n >= 2 ? '\nlistening on port 8080' : ''}`);
    const res = await backend.run('s1', 'node server.js', { block: true, timeoutMs: 5000, waitFor: { regex: 'listening on port \\d+' } });
    expect(res).toMatchObject({ completed: false, waitMatched: true });
    expect(n).toBeGreaterThanOrEqual(2);
    expect(calls.some((c) => c.args[0] === 'wait-for')).toBe(false);
  });

  it('read caps every capture at 10 KB middle-omitted and honors lines as a tail', async () => {
    const { tmux, backend } = mk();
    const big = Array.from({ length: 400 }, (_, i) => `line-${i} ` + 'x'.repeat(40)).join('\n');
    const cap = vi.spyOn(tmux, 'capturePane').mockResolvedValue(big);
    const out = await backend.read('s1');
    expect(out.length).toBeLessThanOrEqual(HERDR_READ_CAP_CHARS + 80);
    expect(out.startsWith('line-0 ')).toBe(true);
    expect(out.endsWith('x'.repeat(40))).toBe(true);
    expect(out).toMatch(/\.\.\. \[\d+ chars omitted\] \.\.\./);
    const tail = await backend.read('s1', { lines: 3 });
    expect(cap).toHaveBeenLastCalledWith('s1', -3);
    expect(tail.split('\n')).toHaveLength(3);
    expect(tail.startsWith('line-397 ')).toBe(true);
  });
});
