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
