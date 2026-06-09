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

  it('should reject path traversal', async () => {
    const result = await tool.execute(
      { command: 'echo test', directory: '../../etc' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('within working directory');
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
    expect(result.metadata!.executionTime).toBeGreaterThan(0);
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
});
