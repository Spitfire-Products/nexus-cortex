/**
 * ShellTool Integration Tests
 *
 * Tests with REAL command execution (no mocks per user directive)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ShellTool } from '../../implementations/execution/ShellTool.js';
import { ToolRegistry, type ExecutorConfig } from '../../base/ToolRegistry.js';

describe('ShellTool Integration', () => {
  let tool: ShellTool;
  let registry: ToolRegistry;
  let testDir: string;
  let config: ExecutorConfig;

  beforeEach(() => {
    // Create real test directory
    testDir = path.join(process.cwd(), '.test-tmp-shell');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Configure executor
    config = {
      workingDirectory: testDir,
      allowFileSystem: true,
    };

    // Create tool and registry
    tool = new ShellTool(config);
    registry = new ToolRegistry(config);
    registry.registerTool(tool);
  });

  afterEach(() => {
    // Cleanup real files
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should execute simple echo command', async () => {
    const result = await tool.execute(
      { command: 'echo "Hello World"' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Hello World');
    // ShellTool now emits raw stdout in llmContent and exitCode in metadata.
    expect(result.metadata?.exitCode).toBe(0);
  });

  it('should execute command with working directory', async () => {
    const isWindows = os.platform() === 'win32';
    const command = isWindows ? 'cd' : 'pwd';

    const result = await tool.execute(
      { command },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain(testDir);
  });

  it('should execute command in subdirectory', async () => {
    // Create subdirectory
    const subDir = path.join(testDir, 'sub');
    fs.mkdirSync(subDir, { recursive: true });

    const isWindows = os.platform() === 'win32';
    const command = isWindows ? 'cd' : 'pwd';

    const result = await tool.execute(
      { command, directory: 'sub' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('sub');
  });

  it('should capture stdout correctly', async () => {
    const result = await tool.execute(
      { command: 'echo "line1" && echo "line2"' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('line1');
    expect(result.llmContent).toContain('line2');
  });

  it('should capture stderr correctly on failed commands', async () => {
    // ShellTool's concise output drops stderr when exit code is 0 (treats it
    // as noise). Verify stderr capture by failing the command.
    const isWindows = os.platform() === 'win32';
    const command = isWindows
      ? 'echo Error message 1>&2 & exit 1'
      : 'sh -c "echo \\"Error message\\" >&2; exit 1"';

    const result = await tool.execute({ command }, new AbortController().signal);

    expect(result.success).toBe(true);
    expect(result.metadata?.exitCode).not.toBe(0);
    expect(result.llmContent).toContain('Error message');
  });

  it('should handle command that fails with non-zero exit code', async () => {
    const isWindows = os.platform() === 'win32';
    const command = isWindows ? 'exit 1' : 'exit 1';

    const result = await tool.execute({ command }, new AbortController().signal);

    expect(result.success).toBe(true); // Command executed successfully (even if exit code != 0)
    expect(result.metadata?.exitCode).toBe(1);
  });

  it('should handle command not found', async () => {
    const result = await tool.execute(
      { command: 'nonexistent_command_xyz_123' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Command exists but exit code is non-zero (typically 127 for not-found).
    expect(result.metadata?.exitCode).not.toBe(0);
  });

  it('should handle empty output', async () => {
    const isWindows = os.platform() === 'win32';
    const command = isWindows ? 'echo.' : 'true'; // Command that succeeds with no output

    const result = await tool.execute({ command }, new AbortController().signal);

    expect(result.success).toBe(true);
    expect(result.metadata?.exitCode).toBe(0);
  });

  it('should chain commands with &&', async () => {
    const result = await tool.execute(
      { command: 'echo "first" && echo "second"' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('first');
    expect(result.llmContent).toContain('second');
  });

  it('should redirect echo>file patterns to the Write tool', async () => {
    // ShellTool intentionally refuses `echo "x" > file` patterns and steers
    // the model to the Write tool. This is a UX/security guard, not a bug.
    const command = `echo "test content" > test.txt`;
    const result = await tool.execute({ command }, new AbortController().signal);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Write tool');
  });

  it('should block command substitution with $()', async () => {
    const result = await tool.execute(
      { command: 'echo $(ls)' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Command substitution using $() is not allowed');
  });

  it('should allow $(( )) arithmetic expansion', async () => {
    const result = await tool.execute(
      { command: 'echo $((2 + 3))' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('5');
  });

  it('should still block command substitution nested inside arithmetic', async () => {
    const result = await tool.execute(
      { command: 'echo $(( $(date +%s) / 60 ))' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Command substitution using $() is not allowed');
  });

  it('should allow $() when CORTEX_ALLOW_CMD_SUBSTITUTION=true', async () => {
    const prev = process.env.CORTEX_ALLOW_CMD_SUBSTITUTION;
    process.env.CORTEX_ALLOW_CMD_SUBSTITUTION = 'true';
    try {
      const result = await tool.execute(
        { command: 'echo "count=$(echo 1 2 3 | wc -w)"' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('count=3');
    } finally {
      if (prev === undefined) delete process.env.CORTEX_ALLOW_CMD_SUBSTITUTION;
      else process.env.CORTEX_ALLOW_CMD_SUBSTITUTION = prev;
    }
  });

  it('should allow $() when config.allowCommandSubstitution=true (auto-approve/sandbox context, no env flag)', async () => {
    const permissiveTool = new ShellTool({ ...config, allowCommandSubstitution: true });
    const result = await permissiveTool.execute(
      { command: 'echo "count=$(echo 1 2 3 | wc -w)"' },
      new AbortController().signal,
    );
    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('count=3');
  });

  it('should validate command is not empty', async () => {
    const result = await tool.execute(
      { command: '' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Command cannot be empty');
  });

  it('should validate directory exists', async () => {
    const result = await tool.execute(
      { command: 'echo test', directory: 'nonexistent' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('should reject absolute directory path', async () => {
    const result = await tool.execute(
      { command: 'echo test', directory: '/absolute/path' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('relative to working directory');
  });

  it('no longer self-rejects out-of-root directories (boundary moved to WorkspaceBoundaryPolicy)', async () => {
    const result = await tool.execute(
      { command: 'echo test', directory: '../../etc' },
      new AbortController().signal,
    );

    // Boundary enforcement moved to WorkspaceBoundaryPolicy (approval-gated). The
    // tool no longer returns a "within working directory" error; here the directory
    // simply does not exist relative to the test cwd.
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('within working directory');
  });

  it('should handle abort signal', async () => {
    const controller = new AbortController();

    // Start long-running command
    const resultPromise = tool.execute(
      { command: 'sleep 5' },
      controller.signal,
    );

    // Abort after 100ms
    setTimeout(() => controller.abort(), 100);

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled');
  }, 10000);

  it('should enforce timeout', async () => {
    const result = await tool.execute(
      { command: 'sleep 10', timeout: 500 }, // 500ms timeout for 10s command
      new AbortController().signal,
    );

    // Command should be killed by timeout
    expect(result.success).toBe(true);
    expect(result.metadata?.exitCode).not.toBe(0);
  }, 15000);

  it('should work via ToolRegistry', async () => {
    const result = await registry.executeTool('Bash', {
      command: 'echo "via registry"',
    });

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('via registry');
  });

  it('should include metadata in result', async () => {
    const result = await tool.execute(
      { command: 'echo test' },
      new AbortController().signal,
    );

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.executionTime).toBeGreaterThanOrEqual(0); // ms duration; sub-ms ops legitimately measure 0
    expect(result.metadata!.exitCode).toBe(0);
  });

  it('should handle multiline output', async () => {
    const isWindows = os.platform() === 'win32';
    const command = isWindows
      ? 'echo line1 && echo line2 && echo line3'
      : 'echo "line1\nline2\nline3"';

    const result = await tool.execute({ command }, new AbortController().signal);

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('line1');
    expect(result.llmContent).toContain('line2');
    expect(result.llmContent).toContain('line3');
  });

  it('should handle commands with quotes', async () => {
    const result = await tool.execute(
      { command: 'echo "Hello, World!"' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Hello');
  });

  it('should handle commands with special characters', async () => {
    const isWindows = os.platform() === 'win32';
    if (!isWindows) {
      const result = await tool.execute(
        { command: 'echo "Special: $USER @#%"' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('Special');
    }
  });

  it('should validate timeout is positive', async () => {
    const result = await tool.execute(
      { command: 'echo test', timeout: -1000 },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Timeout must be a positive number');
  });

  it('should execute the command provided', async () => {
    // ShellTool emits raw stdout in llmContent; the command line is implicit.
    // Validate by checking the command's actual output appears.
    const command = 'echo "test command"';
    const result = await tool.execute(
      { command },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('test command');
  });

  it('should run in the supplied directory', async () => {
    // Tool no longer echoes a "Directory:" header. Verify by running pwd.
    const isWindows = os.platform() === 'win32';
    const pwdCmd = isWindows ? 'cd' : 'pwd';
    const result = await tool.execute(
      { command: pwdCmd, directory: '.' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain(testDir);
  });

  it('should handle rapid sequential commands', async () => {
    const results = await Promise.all([
      tool.execute({ command: 'echo "cmd1"' }, new AbortController().signal),
      tool.execute({ command: 'echo "cmd2"' }, new AbortController().signal),
      tool.execute({ command: 'echo "cmd3"' }, new AbortController().signal),
    ]);

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(results[2].success).toBe(true);
    expect(results[0].llmContent).toContain('cmd1');
    expect(results[1].llmContent).toContain('cmd2');
    expect(results[2].llmContent).toContain('cmd3');
  });

  // ── Tool-redirect guard: flag-aware + profile-aware (canon defect 2026-08-13) ──
  //
  // Production record (hosted container, deepseek-v4-pro): `cat -A probe.txt`
  // (legitimate — visible line endings) was blocked with the CORRUPT suggestion
  // `Read({ file_path: "-A probe.txt" })`. Three defects: flag-blind suggestion
  // parser, over-broad matching (no Read equivalent for cat -A / head -c), and
  // no profile gate (bash-only models were redirected to tools that don't exist).

  describe('tool-redirect guard (flag/profile awareness)', () => {
    let probeFile: string;

    beforeEach(() => {
      probeFile = path.join(testDir, 'probe.txt');
      fs.writeFileSync(probeFile, 'hello guard\nline two\n');
    });

    it('allows `cat -A file` through (no Read equivalent for flagged cat)', async () => {
      const result = await tool.execute(
        { command: 'cat -A probe.txt' },
        new AbortController().signal,
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('hello guard');
    });

    it('allows `head -c N file` through (byte-precise read has no Read equivalent)', async () => {
      const result = await tool.execute(
        { command: 'head -c 5 probe.txt' },
        new AbortController().signal,
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('hello');
    });

    it('allows multi-file `cat a b` through (concatenation has no Read equivalent)', async () => {
      fs.writeFileSync(path.join(testDir, 'second.txt'), 'second file\n');
      const result = await tool.execute(
        { command: 'cat probe.txt second.txt' },
        new AbortController().signal,
      );
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('second file');
    });

    it('still redirects bare `cat file` with a CLEAN suggestion (no flags glued into file_path)', async () => {
      const result = await tool.execute(
        { command: 'cat probe.txt' },
        new AbortController().signal,
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Read tool');
      expect(result.error).toContain('Read({ file_path: "probe.txt" })');
    });

    it('never produces a flags-in-file_path suggestion', async () => {
      // Direct probe of the guard: flagged invocations must return null (allowed),
      // never a suggestion like Read({ file_path: "-A probe.txt" }).
      const msg = (tool as any).checkToolRedirect('cat -A probe.txt');
      expect(msg).toBeNull();
    });

    it('allows flagged grep through (grep -c has no Grep-tool output equivalent)', async () => {
      const result = await tool.execute(
        { command: 'grep -c hello probe.txt' },
        new AbortController().signal,
      );
      expect(result.success).toBe(true);
      expect(result.llmContent.trim()).toContain('1');
    });

    it('still redirects bare `grep pattern file` to the Grep tool', async () => {
      const result = await tool.execute(
        { command: 'grep hello probe.txt' },
        new AbortController().signal,
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Grep tool');
    });

    it('allows `echo $VAR > file` through (shell-state capture Write cannot do)', async () => {
      const result = await tool.execute(
        { command: 'echo $HOME > envcap.txt' },
        new AbortController().signal,
      );
      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'envcap.txt'))).toBe(true);
    });

    it('allows append `>>` through (Write cannot append)', async () => {
      const result = await tool.execute(
        { command: 'echo "appended" >> probe.txt' },
        new AbortController().signal,
      );
      expect(result.success).toBe(true);
      expect(fs.readFileSync(probeFile, 'utf8')).toContain('appended');
    });

    it('allows `find` with -exec through (no Glob equivalent)', async () => {
      const result = await tool.execute(
        { command: 'find . -name "*.txt" -exec ls {} +' },
        new AbortController().signal,
      );
      expect(result.success).toBe(true);
    });

    it('still redirects plain `find -name` to the Glob tool', async () => {
      const result = await tool.execute(
        { command: 'find . -name "*.txt"' },
        new AbortController().signal,
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Glob tool');
    });

    describe('bash-only tool profile (redirect targets do not exist)', () => {
      const PROFILE_KEY = 'CORTEX_TOOL_PROFILE';
      let saved: string | undefined;

      beforeEach(() => {
        saved = process.env[PROFILE_KEY];
        process.env[PROFILE_KEY] = 'bash-only';
      });

      afterEach(() => {
        if (saved === undefined) delete process.env[PROFILE_KEY];
        else process.env[PROFILE_KEY] = saved;
      });

      it('executes bare `cat file` (never redirect to a tool the profile hides)', async () => {
        const result = await tool.execute(
          { command: 'cat probe.txt' },
          new AbortController().signal,
        );
        expect(result.success).toBe(true);
        expect(result.llmContent).toContain('hello guard');
      });

      it('executes `sed -i` in-place edits (Edit tool does not exist under bash-only)', async () => {
        const result = await tool.execute(
          { command: "sed -i 's/hello/goodbye/' probe.txt" },
          new AbortController().signal,
        );
        expect(result.success).toBe(true);
        expect(fs.readFileSync(probeFile, 'utf8')).toContain('goodbye');
      });

      it('executes `echo literal > file` (Write tool does not exist under bash-only)', async () => {
        const result = await tool.execute(
          { command: 'echo "made by bash" > bashonly.txt' },
          new AbortController().signal,
        );
        expect(result.success).toBe(true);
        expect(fs.readFileSync(path.join(testDir, 'bashonly.txt'), 'utf8')).toContain('made by bash');
      });
    });
  });

  // ── Output fidelity + timeout modernization ─────────────────────────────────

  describe('output fidelity', () => {
    it('includes stdout on FAILED commands (test runners print failures to stdout)', async () => {
      const result = await tool.execute(
        { command: 'sh -c \'echo "partial progress"; exit 3\'' },
        new AbortController().signal,
      );
      expect(result.success).toBe(true);
      expect(result.metadata?.exitCode).toBe(3);
      expect(result.llmContent).toContain('partial progress');
    });

    it('includes stderr on SUCCESSFUL commands (warnings matter)', async () => {
      const result = await tool.execute(
        { command: 'sh -c \'echo "deprecation warning" >&2; echo ok\'' },
        new AbortController().signal,
      );
      expect(result.success).toBe(true);
      expect(result.metadata?.exitCode).toBe(0);
      expect(result.llmContent).toContain('ok');
      expect(result.llmContent).toContain('deprecation warning');
    });

    it('reports timeout explicitly (timedOut metadata + clear message)', async () => {
      const result = await tool.execute(
        { command: 'sleep 10', timeout: 500 },
        new AbortController().signal,
      );
      expect(result.success).toBe(true);
      expect(result.metadata?.timedOut).toBe(true);
      expect(result.llmContent.toLowerCase()).toContain('timed out');
    }, 15000);

    it('clamps timeout to the configured maximum', () => {
      const resolved = (tool as any).resolveTimeoutMs({ command: 'true', timeout: 99999999 });
      expect(resolved).toBe((ShellTool as any).MAX_TIMEOUT_MS);
    });
  });

  // ── Persistent-session sentinel parsing (pure helpers; tmux not required) ──

  describe('persistent session sentinel helpers', () => {
    const sentinel = '__CORTEX_DONE_abcd';

    it('detects completion and extracts the exit code from pane output', () => {
      const pane = `$ ls\nfile.txt\n$ false; printf '${sentinel}_%d\\n' $?\n${sentinel}_1\n$`;
      const parsed = (ShellTool as any).parseSentinel(pane, sentinel);
      expect(parsed.done).toBe(true);
      expect(parsed.exitCode).toBe(1);
    });

    it('does not treat the echoed command line (%d placeholder) as completion', () => {
      const pane = `$ long_build; printf '${sentinel}_%d\\n' $?\nbuilding...`;
      const parsed = (ShellTool as any).parseSentinel(pane, sentinel);
      expect(parsed.done).toBe(false);
      expect(parsed.exitCode).toBeNull();
    });

    it('strips sentinel lines from the captured output', () => {
      const pane = `real output\n${sentinel}_0\nmore output`;
      const cleaned = (ShellTool as any).stripSentinelLines(pane, sentinel);
      expect(cleaned).toContain('real output');
      expect(cleaned).toContain('more output');
      expect(cleaned).not.toContain(sentinel);
    });
  });
});

// TOOL_TIMEOUT_MODE (2026-09-02): promote-at-deadline instead of kill.
import { BackgroundProcessRegistry } from '../../implementations/execution/BackgroundProcessRegistry.js';
describe('TOOL_TIMEOUT_MODE promote-at-deadline', () => {
  const ORIG = process.env.TOOL_TIMEOUT_MODE;
  afterEach(() => { if (ORIG === undefined) delete process.env.TOOL_TIMEOUT_MODE; else process.env.TOOL_TIMEOUT_MODE = ORIG; });

  it('resolves modes: auto = background when headless, kill otherwise; explicit values force', () => {
    delete process.env.TOOL_TIMEOUT_MODE;
    expect(ShellTool.resolveTimeoutMode(true)).toBe('background');
    expect(ShellTool.resolveTimeoutMode(false)).toBe('kill');
    process.env.TOOL_TIMEOUT_MODE = 'kill'; expect(ShellTool.resolveTimeoutMode(true)).toBe('kill');
    process.env.TOOL_TIMEOUT_MODE = 'background'; expect(ShellTool.resolveTimeoutMode(false)).toBe('background');
  });

  it('background mode: a long command is promoted, not killed; BashOutput can read it; KillShell cleans up', async () => {
    process.env.TOOL_TIMEOUT_MODE = 'background';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-promote-'));
    const t = new ShellTool({ workingDirectory: dir, headless: true } as ExecutorConfig);
    const res = await t.execute({ command: 'echo started; sleep 3; echo finished', timeout: 800 }, new AbortController().signal);
    expect(res.isError ?? res.is_error ?? false).toBeFalsy();
    const text = typeof res.llmContent === 'string' ? res.llmContent : JSON.stringify(res);
    expect(text).toContain('STILL RUNNING');
    const id = (res as any).metadata?.promotedToBackground as string;
    expect(id).toMatch(/^bg-/);
    const reg = BackgroundProcessRegistry.getInstance();
    expect(reg.hasProcess(id)).toBe(true);
    await new Promise((r) => setTimeout(r, 3500));
    const out = reg.getOutput(id).join('\n');
    expect(out).toContain('finished');
    reg.killProcess(id); reg.removeProcess(id);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 15000);

  it('kill mode: the legacy behavior is unchanged', async () => {
    process.env.TOOL_TIMEOUT_MODE = 'kill';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-kill-'));
    const t = new ShellTool({ workingDirectory: dir, headless: true } as ExecutorConfig);
    const res = await t.execute({ command: 'sleep 3; echo finished', timeout: 500 }, new AbortController().signal);
    const text = typeof res.llmContent === 'string' ? res.llmContent : JSON.stringify(res);
    expect(text).toContain('timed out');
    expect((res as any).metadata?.promotedToBackground).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 10000);
});

// HB-TMUX-FALLBACK (R134, 2026-09-13): persistentSession without tmux degrades to
// the run_in_background path (BashOutput-pollable) instead of erroring out.
import { vi } from 'vitest';
import { TmuxManager } from '../../utils/TmuxManager.js';
describe('HB-TMUX-FALLBACK (R134): persistentSession without tmux', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('degrades to a detached background process with the [WARN] line and a bash_id', async () => {
    vi.spyOn(TmuxManager.getInstance(), 'isAvailable').mockResolvedValue(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-tmux-fallback-'));
    const t = new ShellTool({ workingDirectory: dir } as ExecutorConfig);
    const res = await t.execute(
      { command: 'echo monitor-started; sleep 2; echo monitor-finished', persistentSession: true },
      new AbortController().signal,
    );
    expect(res.success).toBe(true);
    const text = typeof res.llmContent === 'string' ? res.llmContent : JSON.stringify(res);
    expect(text.split('\n')[0]).toMatch(
      /^\[WARN\] tmux not available: persistentSession downgraded to a detached background process \(state\/cwd\/env will not persist across calls\); poll with BashOutput/,
    );
    expect(text).toContain('Background process started with ID: bg-');
    const id = res.metadata?.bash_id as string;
    expect(id).toMatch(/^bg-/);
    expect(res.metadata?.backgroundProcess).toBe(true);
    expect(res.metadata?.persistentSessionDegraded).toBe(true);
    const reg = BackgroundProcessRegistry.getInstance();
    expect(reg.hasProcess(id)).toBe(true);
    await new Promise((r) => setTimeout(r, 2800));
    expect(reg.getOutput(id).join('\n')).toContain('monitor-finished');
    reg.killProcess(id); reg.removeProcess(id);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 15000);

  it('still errors when tmux is missing AND the background fallback cannot spawn', async () => {
    vi.spyOn(TmuxManager.getInstance(), 'isAvailable').mockResolvedValue(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-tmux-fallback-'));
    const t = new ShellTool({ workingDirectory: dir } as ExecutorConfig);
    vi.spyOn(t as any, 'executeInBackground').mockReturnValue({
      success: false, llmContent: 'Error: Failed to spawn background process.', error: 'Failed to spawn background process.',
    });
    const res = await t.execute({ command: 'true', persistentSession: true }, new AbortController().signal);
    expect(res.success).toBe(false);
    expect(res.error).toContain('tmux is not available');
    expect(res.error).toContain('Failed to spawn background process.');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// HB-WAIT-PRIMITIVE (R142, 2026-09-14): Bash persistentSession wait_for on the tmux path — the
// sentinel poll also watches the pane for the regex (only text AFTER the echoed command line
// counts) and returns as soon as it matches, reporting the command as possibly still running.
import { describe as d142, it as it142, expect as ex142, afterEach as ae142, vi as vi142 } from 'vitest';
import { resetTerminalBackendCache as reset142 } from '../../utils/TerminalBackend.js';

d142('R142 HB-WAIT-PRIMITIVE: wait_for on the tmux persistent path', () => {
  const dirs: string[] = [];
  ae142(() => { vi142.restoreAllMocks(); reset142(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  /** Mock tmux: sendKeys records the text, capturePane returns the scripted frames in order (last repeats). */
  const mockTmux = (frames: (sent: string) => string[]) => {
    const tmux = TmuxManager.getInstance();
    vi142.spyOn(tmux, 'isAvailable').mockResolvedValue(true);
    vi142.spyOn(tmux, 'sessionExists').mockResolvedValue(true);
    let sent = '';
    let i = 0;
    vi142.spyOn(tmux, 'sendKeys').mockImplementation(async (_id, cmd) => { sent = cmd; });
    vi142.spyOn(tmux, 'capturePane').mockImplementation(async () => {
      const f = frames(sent);
      return f[Math.min(i++, f.length - 1)];
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-wait-'));
    dirs.push(dir);
    return { tool: new ShellTool({ workingDirectory: dir } as ExecutorConfig), sentRef: () => sent };
  };
  const sentinelOf = (sent: string) => sent.match(/__CORTEX_DONE_[0-9a-f]+/)![0];

  it142('returns when the regex appears after the command echo, before the sentinel (command still running)', async () => {
    const { tool } = mockTmux((sent) => [
      `$ node server.js; printf '${sentinelOf(sent)}_%d\\n' $?\nstarting`,
      `$ node server.js; printf '${sentinelOf(sent)}_%d\\n' $?\nstarting\nlistening on port 8080`,
    ]);
    const t0 = Date.now();
    const res = await tool.execute({ command: 'node server.js', persistentSession: true, sessionId: 'srv', wait_for: 'listening on port \\d+', timeout: 10000 }, new AbortController().signal);
    ex142(res.success).toBe(true);
    ex142(Date.now() - t0).toBeLessThan(5000);
    ex142(res.metadata?.completed).toBe(false);
    ex142(res.metadata?.waitMatched).toBe(true);
    const text = res.llmContent as string;
    ex142(text).toContain('listening on port 8080');
    ex142(text).toMatch(/wait_for .*matched/);
    ex142(text).toContain('may still be running');
    ex142(text).not.toContain('__CORTEX_DONE_');
  });

  it142('stale text BEFORE the echoed command line never satisfies wait_for', async () => {
    const { tool } = mockTmux((sent) => [
      `listening on port 1 (old)\n$ node server.js; printf '${sentinelOf(sent)}_%d\\n' $?\nstarting`,
      `listening on port 1 (old)\n$ node server.js; printf '${sentinelOf(sent)}_%d\\n' $?\nstarting`,
      `listening on port 1 (old)\n$ node server.js; printf '${sentinelOf(sent)}_%d\\n' $?\nstarting\nlistening on port 2`,
    ]);
    const res = await tool.execute({ command: 'node server.js', persistentSession: true, sessionId: 'srv2', wait_for: 'listening on port \\d+', timeout: 10000 }, new AbortController().signal);
    ex142(res.metadata?.waitMatched).toBe(true);
    ex142(res.llmContent as string).toContain('listening on port 2');
  });

  it142('the sentinel still wins when the command finishes first (completed, not waitMatched)', async () => {
    const { tool } = mockTmux((sent) => [
      `$ make; printf '${sentinelOf(sent)}_%d\\n' $?\nbuilt\n${sentinelOf(sent)}_0`,
    ]);
    const res = await tool.execute({ command: 'make', persistentSession: true, sessionId: 'mk', wait_for: 'never-appears', timeout: 10000 }, new AbortController().signal);
    ex142(res.metadata?.completed).toBe(true);
    ex142(res.metadata?.exitCode).toBe(0);
    ex142(res.metadata?.waitMatched).toBe(false);
  });

  it142('rejects an invalid wait_for regex', async () => {
    const { tool } = mockTmux(() => ['']);
    const res = await tool.execute({ command: 'true', persistentSession: true, wait_for: '(' }, new AbortController().signal);
    ex142(res.success).toBe(false);
    ex142(res.error).toMatch(/wait_for/);
  });
});
