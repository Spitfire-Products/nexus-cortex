/**
 * HB-TMUX-PASTE-BUFFER (R140, 2026-09-14): TmuxManager.sendKeys routes oversize
 * (> TMUX_SEND_KEYS_MAX_CHARS) or multi-line input through a 0600 temp file +
 * `load-buffer` / `paste-buffer -d -p`, then a separate `send-keys Enter`; short
 * single-line input keeps the literal `send-keys -l` path. Terminus 2 reference:
 * harbor agents/terminus_2/tmux_session.py:661-687.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { TmuxManager, TMUX_SEND_KEYS_MAX_CHARS, needsPasteBuffer, type TmuxExecFn } from '../TmuxManager.js';

interface Seen {
  args: string[];
  /** Snapshot of the paste temp file taken while load-buffer ran (content + mode). */
  file?: { content: string; mode: number; path: string };
}

function makeTmux(opts: { failPaste?: boolean } = {}) {
  const calls: Seen[] = [];
  const exec: TmuxExecFn = async (_bin, args) => {
    const seen: Seen = { args };
    if (args[0] === 'load-buffer') {
      const file = args[args.indexOf('-b') + 2];
      seen.file = { content: fs.readFileSync(file, 'utf8'), mode: fs.statSync(file).mode & 0o777, path: file };
    }
    calls.push(seen);
    if (args[0] === '-V') return { stdout: 'tmux 3.5a\n', stderr: '' };
    if (args[0] === 'paste-buffer' && opts.failPaste) throw new Error('paste failed');
    return { stdout: '', stderr: '' };
  };
  return { tmux: TmuxManager.createWithExec(exec), calls };
}

describe('needsPasteBuffer', () => {
  it('is false for short single-line text, true for newlines or > TMUX_SEND_KEYS_MAX_CHARS', () => {
    expect(needsPasteBuffer('ls -la')).toBe(false);
    expect(needsPasteBuffer('a'.repeat(TMUX_SEND_KEYS_MAX_CHARS))).toBe(false);
    expect(needsPasteBuffer('a'.repeat(TMUX_SEND_KEYS_MAX_CHARS + 1))).toBe(true);
    expect(needsPasteBuffer('cat <<EOF\nx\nEOF')).toBe(true);
  });
});

describe('TmuxManager.sendKeys (R140)', () => {
  it('short single-line input: literal send-keys -l, then Enter (no shell quoting, $? untouched)', async () => {
    const { tmux, calls } = makeTmux();
    await tmux.sendKeys('s1', `false; printf '__CORTEX_DONE_ab_%d__\\n' $?`);
    expect(calls.map((c) => c.args)).toEqual([
      ['-V'],
      ['send-keys', '-t', 's1', '-l', `false; printf '__CORTEX_DONE_ab_%d__\\n' $?`],
      ['send-keys', '-t', 's1', 'Enter'],
    ]);
  });

  it('long input (> 2000 chars): 0600 temp file + load-buffer + paste-buffer -d -p, file deleted, then Enter', async () => {
    const { tmux, calls } = makeTmux();
    const body = 'python3 -c "' + 'x = 1; '.repeat(600) + '"';
    expect(body.length).toBeGreaterThan(TMUX_SEND_KEYS_MAX_CHARS);
    await tmux.sendKeys('s1', body);
    const argv = calls.map((c) => c.args);
    expect(argv[1][0]).toBe('load-buffer');
    expect(argv[1].slice(0, 2)).toEqual(['load-buffer', '-b']);
    const name = argv[1][2];
    expect(name).toMatch(/^cortex-[0-9a-f]+$/);
    expect(argv[2]).toEqual(['paste-buffer', '-d', '-p', '-b', name, '-t', 's1']);
    expect(argv[3]).toEqual(['send-keys', '-t', 's1', 'Enter']);
    expect(argv.some((a) => a[0] === 'send-keys' && a.includes('-l'))).toBe(false);
    const file = calls[1].file!;
    expect(file.content).toBe(body);
    expect(file.mode).toBe(0o600);
    expect(fs.existsSync(file.path)).toBe(false);
  });

  it('multi-line input (heredoc) goes through the paste buffer even when short', async () => {
    const { tmux, calls } = makeTmux();
    const heredoc = 'cat <<EOF > f.txt\nline one\nEOF';
    await tmux.sendKeys('s1', heredoc);
    const argv = calls.map((c) => c.args);
    expect(argv.map((a) => a[0])).toEqual(['-V', 'load-buffer', 'paste-buffer', 'send-keys']);
    expect(calls[1].file!.content).toBe(heredoc);
    expect(argv[3]).toEqual(['send-keys', '-t', 's1', 'Enter']);
  });

  it('enter:false pastes the body without pressing Enter (backend sendText)', async () => {
    const { tmux, calls } = makeTmux();
    await tmux.sendKeys('s1', 'partial', { enter: false });
    expect(calls.map((c) => c.args)).toEqual([['-V'], ['send-keys', '-t', 's1', '-l', 'partial']]);
    await tmux.sendKeys('s1', 'a\nb', { enter: false });
    expect(calls[calls.length - 1].args[0]).toBe('paste-buffer');
  });

  it('sendRawKeys sends key names (C-c, Enter) without -l and without an implicit Enter', async () => {
    const { tmux, calls } = makeTmux();
    await tmux.sendRawKeys('s1', ['C-c']);
    expect(calls[calls.length - 1].args).toEqual(['send-keys', '-t', 's1', 'C-c']);
  });

  it('deletes the temp file even when paste-buffer fails, and surfaces the error', async () => {
    const { tmux, calls } = makeTmux({ failPaste: true });
    await expect(tmux.sendKeys('s1', 'a\nb')).rejects.toThrow(/paste failed/);
    expect(fs.existsSync(calls[1].file!.path)).toBe(false);
  });
});

// HB-TMUX-SELF-INSTALL (R138, 2026-09-14): ensureTmux tries a package manager, then a
// static binary from CORTEX_TMUX_STATIC_URL, each step time-bounded through an injectable
// exec; the outcome is cached per process and R134 degrades when every step fails.
import { describe as d138, it as it138, expect as ex138, vi as vi138 } from 'vitest';
import os from 'os';
import path from 'path';
import type { TmuxInstallExecFn } from '../TmuxManager.js';

d138('TmuxManager.ensureTmux (R138 HB-TMUX-SELF-INSTALL)', () => {
  /**
   * Fake world: tmux is absent (`-V` throws) until an install step "lands" it; the install
   * exec answers `command -v <pm>` from `present`, and install commands from `landOn`.
   */
  function world(opts: { present?: string[]; landOn?: (args: string[]) => boolean; installRc?: number; env?: Record<string, string> } = {}) {
    let installed = false;
    const calls: { bin: string; args: string[]; timeoutMs?: number }[] = [];
    const exec: TmuxExecFn = async (_bin, args) => {
      if (args[0] === '-V') {
        if (!installed) throw new Error('spawn tmux ENOENT');
        return { stdout: 'tmux 3.5a\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };
    const installExec: TmuxInstallExecFn = async (bin, args, o) => {
      calls.push({ bin, args, timeoutMs: o?.timeoutMs });
      if (bin === 'sh' && args[1]?.startsWith('command -v ')) {
        const pm = args[1].slice('command -v '.length);
        return { code: (opts.present ?? []).includes(pm) ? 0 : 1, stdout: '', stderr: '' };
      }
      if (opts.landOn?.([bin, ...args])) { installed = true; return { code: 0, stdout: '', stderr: '' }; }
      return { code: opts.installRc ?? 1, stdout: '', stderr: 'E: Unable to locate package tmux' };
    };
    const log = vi138.fn();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tmux-home-'));
    const env = { HOME: home, ...(opts.env ?? {}) };
    const tmux = TmuxManager.createWithExec(exec, { installExec });
    return { tmux, calls, log, env, home };
  }

  it138('apt-get present + install succeeds -> available, installedVia apt-get, one [INFO] line, update step carries the expired-Release flags', async () => {
    const { tmux, calls, log, env } = world({ present: ['apt-get'], landOn: (a) => a[0] === 'apt-get' && a[1] === 'install' });
    const res = await tmux.ensureTmux({ env, log });
    ex138(res.available).toBe(true);
    ex138(res.installedVia).toBe('apt-get');
    ex138(res.tried).toEqual(['apt-get']);
    const argv = calls.map((c) => c.args);
    ex138(argv[0]).toEqual(['-c', 'command -v apt-get']);
    ex138(argv[1]).toEqual(['-o', 'Acquire::Check-Valid-Until=false', '-o', 'Acquire::AllowInsecureRepositories=true', 'update']);
    ex138(argv[2]).toEqual(['install', '-y', '--no-install-recommends', 'tmux']);
    ex138(calls[1].bin).toBe('apt-get');
    ex138(calls[2].bin).toBe('apt-get');
    ex138(calls.every((c) => c.timeoutMs === 120000)).toBe(true);
    ex138(log).toHaveBeenCalledTimes(1);
    ex138(log.mock.calls[0][0]).toBe('[INFO] tmux installed via apt-get');
    ex138(await tmux.isAvailable()).toBe(true);
  });

  it138('apt-get fails -> CORTEX_TMUX_STATIC_URL set -> curl drops ~/.local/bin/tmux -> available via static-url', async () => {
    const url = 'https://example.invalid/tmux-static-x86_64';
    const { tmux, calls, log, env, home } = world({
      present: ['apt-get', 'curl'],
      landOn: (a) => a[0] === 'curl',
      env: { CORTEX_TMUX_STATIC_URL: url },
    });
    const res = await tmux.ensureTmux({ env, log, timeoutMs: 5000 });
    ex138(res.available).toBe(true);
    ex138(res.installedVia).toBe('static-url');
    ex138(res.tried).toEqual(['apt-get', 'static-url']);
    const curl = calls.find((c) => c.bin === 'curl')!;
    ex138(curl.args).toEqual(['-fsSL', url, '-o', path.join(home, '.local', 'bin', 'tmux')]);
    ex138(curl.timeoutMs).toBe(5000);
    ex138(fs.existsSync(path.join(home, '.local', 'bin'))).toBe(true);
    ex138(log.mock.calls[0][0]).toBe('[INFO] tmux installed via static-url');
  });

  it138('every step fails -> available:false with the tried list and one [WARN] line; R134 degrade is the caller\'s job', async () => {
    const { tmux, calls, log, env } = world({ present: ['apt-get', 'apk'] });
    const res = await tmux.ensureTmux({ env, log });
    ex138(res.available).toBe(false);
    ex138(res.installedVia).toBeUndefined();
    ex138(res.tried).toEqual(['apt-get', 'apk']);
    ex138(calls.some((c) => c.bin === 'curl' || c.bin === 'wget')).toBe(false);
    ex138(log).toHaveBeenCalledTimes(1);
    ex138(log.mock.calls[0][0]).toBe('[WARN] tmux unavailable after: apt-get, apk (CORTEX_TMUX_STATIC_URL unset)');
  });

  it138('no package manager and no static URL -> nothing attempted, [WARN] says so', async () => {
    const { tmux, calls, log, env } = world({});
    const res = await tmux.ensureTmux({ env, log });
    ex138(res.available).toBe(false);
    ex138(res.tried).toEqual([]);
    ex138(calls.filter((c) => c.bin !== 'sh')).toHaveLength(0);
    ex138(log.mock.calls[0][0]).toBe('[WARN] tmux unavailable after: no package manager found (CORTEX_TMUX_STATIC_URL unset)');
  });

  it138('CORTEX_TMUX_AUTO_INSTALL=false (or allowInstall:false) -> no attempts at all', async () => {
    const a = world({ present: ['apt-get'], env: { CORTEX_TMUX_AUTO_INSTALL: 'false' } });
    ex138(await a.tmux.ensureTmux({ env: a.env, log: a.log })).toEqual({ available: false, tried: [], skipped: 'lever' });
    ex138(a.calls).toHaveLength(0);
    const b = world({ present: ['apt-get'] });
    ex138(await b.tmux.ensureTmux({ env: b.env, log: b.log, allowInstall: false })).toEqual({ available: false, tried: [], skipped: 'lever' });
    ex138(b.calls).toHaveLength(0);
  });

  it138('caches the outcome per process: a second call re-runs nothing and logs nothing', async () => {
    const { tmux, calls, log, env } = world({ present: ['apt-get'] });
    await tmux.ensureTmux({ env, log });
    const n = calls.length;
    const again = await tmux.ensureTmux({ env, log });
    ex138(again.available).toBe(false);
    ex138(calls.length).toBe(n);
    ex138(log).toHaveBeenCalledTimes(1);
  });

  it138('tmux already present -> available without any install call', async () => {
    const { tmux, calls, log, env } = world({ present: ['apt-get'] });
    (tmux as any).tmuxAvailable = true;
    const res = await tmux.ensureTmux({ env, log });
    ex138(res).toEqual({ available: true, tried: [] });
    ex138(calls).toHaveLength(0);
    ex138(log).not.toHaveBeenCalled();
  });
});

// HB-TMUX-WAIT-FOR (R139): waitForChannel blocks on `tmux wait-for <chan>` under the cap
// (execFile timeout) and reports signaled:false on cap expiry instead of throwing.
import { describe as d139, it as it139, expect as ex139 } from 'vitest';

d139('TmuxManager.waitForChannel (R139 HB-TMUX-WAIT-FOR)', () => {
  it139('argv is `wait-for <chan>` with the cap passed as the exec timeout; signaled on rc 0', async () => {
    const seen: { args: string[]; timeoutMs?: number }[] = [];
    const tmux = TmuxManager.createWithExec(async (_bin, args, o) => {
      seen.push({ args, timeoutMs: o?.timeoutMs });
      return { stdout: args[0] === '-V' ? 'tmux 3.5a' : '', stderr: '' };
    });
    ex139(await tmux.waitForChannel('cortex-wf-ab12', 1500)).toEqual({ signaled: true });
    ex139(seen[1]).toEqual({ args: ['wait-for', 'cortex-wf-ab12'], timeoutMs: 1500 });
  });

  it139('cap expiry (exec killed) -> signaled:false; any other failure is thrown', async () => {
    const killed = TmuxManager.createWithExec(async (_bin, args) => {
      if (args[0] === 'wait-for') { const e: any = new Error('killed'); e.killed = true; e.signal = 'SIGTERM'; throw e; }
      return { stdout: 'tmux 3.5a', stderr: '' };
    });
    ex139(await killed.waitForChannel('c', 10)).toEqual({ signaled: false });
    const dead = TmuxManager.createWithExec(async (_bin, args) => {
      if (args[0] === 'wait-for') throw new Error('no server running on /tmp/tmux-1000/default');
      return { stdout: 'tmux 3.5a', stderr: '' };
    });
    await ex139(dead.waitForChannel('c', 10)).rejects.toThrow(/no server running/);
  });
});

// HB-TMUX-CAPTURE-CAP (R141): sessions are created with a fixed geometry and a raised
// history-limit that reaches the FIRST window (global set -> new-session -> global restore,
// plus the session-level option for later windows; `set-option -t` alone leaves the first
// window at 2000 — probed on tmux 3.5a 2026-09-14).
import { describe as d141, it as it141, expect as ex141, afterEach as ae141 } from 'vitest';
import { readTmuxHistoryLimit, readTmuxPaneSize } from '../TmuxManager.js';

d141('TmuxManager.createSession geometry + history-limit (R141 HB-TMUX-CAPTURE-CAP)', () => {
  const saved: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined) => { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  ae141(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  const mk = () => {
    const calls: string[][] = [];
    const tmux = TmuxManager.createWithExec(async (_bin, args) => {
      calls.push(args);
      if (args[0] === '-V') return { stdout: 'tmux 3.5a', stderr: '' };
      if (args.includes('show-options')) return { stdout: '2000\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    return { tmux, calls };
  };

  it141('default: -x 160 -y 40, history-limit 50000 on the global (restored) and the session', async () => {
    setEnv('CORTEX_TMUX_HISTORY_LIMIT', undefined);
    setEnv('CORTEX_TMUX_PANE_SIZE', undefined);
    const { tmux, calls } = mk();
    ex141(await tmux.createSession('s1', '/work')).toBe('s1');
    ex141(calls[1]).toEqual(['start-server', ';', 'show-options', '-gv', 'history-limit']);
    ex141(calls[2]).toEqual([
      'set-option', '-g', 'history-limit', '50000', ';',
      'new-session', '-d', '-s', 's1', '-x', '160', '-y', '40', '-c', '/work', ';',
      'set-option', '-t', 's1', 'history-limit', '50000', ';',
      'set-option', '-g', 'history-limit', '2000',
    ]);
  });

  it141('env vars go through set-environment argv; levers change limit + geometry', async () => {
    setEnv('CORTEX_TMUX_HISTORY_LIMIT', '1000');
    setEnv('CORTEX_TMUX_PANE_SIZE', '200x50');
    const { tmux, calls } = mk();
    await tmux.createSession('s2', undefined, { FOO: 'bar baz' });
    ex141(calls[2].slice(0, 4)).toEqual(['set-option', '-g', 'history-limit', '1000']);
    ex141(calls[2]).toContain('-x');
    ex141(calls[2][calls[2].indexOf('-x') + 1]).toBe('200');
    ex141(calls[2][calls[2].indexOf('-y') + 1]).toBe('50');
    ex141(calls[2]).not.toContain('-c');
    ex141(calls[3]).toEqual(['set-environment', '-t', 's2', 'FOO', 'bar baz']);
  });

  it141('lever readers: defaults, valid values, and garbage -> defaults', () => {
    ex141(readTmuxHistoryLimit({})).toBe(50000);
    ex141(readTmuxHistoryLimit({ CORTEX_TMUX_HISTORY_LIMIT: '1234' })).toBe(1234);
    ex141(readTmuxHistoryLimit({ CORTEX_TMUX_HISTORY_LIMIT: 'lots' })).toBe(50000);
    ex141(readTmuxPaneSize({})).toEqual({ width: 160, height: 40 });
    ex141(readTmuxPaneSize({ CORTEX_TMUX_PANE_SIZE: '120x30' })).toEqual({ width: 120, height: 30 });
    ex141(readTmuxPaneSize({ CORTEX_TMUX_PANE_SIZE: 'wide' })).toEqual({ width: 160, height: 40 });
  });
});
