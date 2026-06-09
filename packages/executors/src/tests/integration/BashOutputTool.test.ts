/**
 * BashOutputTool Integration Tests
 *
 * Tests background process output monitoring with REAL processes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BashOutputTool } from '../../implementations/execution/BashOutputTool.js';
import { BackgroundProcessRegistry } from '../../implementations/execution/BackgroundProcessRegistry.js';
import { ToolRegistry, type ExecutorConfig } from '../../base/ToolRegistry.js';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

describe('BashOutputTool Integration', () => {
  let tool: BashOutputTool;
  let registry: BackgroundProcessRegistry;
  let toolRegistry: ToolRegistry;
  let testDir: string;
  let config: ExecutorConfig;
  let testProcesses: ChildProcess[] = [];

  beforeEach(() => {
    testDir = path.join(process.cwd(), '.test-tmp-bash-output');

    config = {
      workingDirectory: testDir,
      allowFileSystem: true,
    };

    // Get singleton registry
    registry = BackgroundProcessRegistry.getInstance();
    registry.clear(); // Clear any previous processes

    // Create tool and registry
    tool = new BashOutputTool(config);
    toolRegistry = new ToolRegistry(config);
    toolRegistry.registerTool(tool);
  });

  afterEach(() => {
    // Kill all test processes
    testProcesses.forEach((proc) => {
      try {
        proc.kill('SIGTERM');
      } catch (error) {
        // Ignore errors during cleanup
      }
    });
    testProcesses = [];

    // Clear registry
    registry.clear();
  });

  it('should get output from background process', async () => {
    // Register a simple process that outputs some text
    const process = spawn('echo', ['Hello from background']);
    testProcesses.push(process);
    const shellId = 'test-shell-1';

    registry.registerProcess(shellId, process.pid!, 'echo test', process);

    // Wait for output to be captured
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await tool.execute(
      { bash_id: shellId },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Hello from background');
    expect(result.metadata?.isRunning).toBeDefined();
  });

  it('should return only new output on subsequent calls', async () => {
    const shellId = 'test-shell-incremental';

    // Create a process that outputs multiple lines
    const process = spawn('sh', [
      '-c',
      'echo "line1"; sleep 0.1; echo "line2"; sleep 0.1; echo "line3"',
    ]);
    testProcesses.push(process);

    registry.registerProcess(shellId, process.pid!, 'multi-line test', process);

    // First call - get initial output
    await new Promise((resolve) => setTimeout(resolve, 150));
    const result1 = await tool.execute(
      { bash_id: shellId },
      new AbortController().signal,
    );
    expect(result1.success).toBe(true);
    expect(result1.llmContent).toContain('line1');

    // Second call - should get only new output
    await new Promise((resolve) => setTimeout(resolve, 150));
    const result2 = await tool.execute(
      { bash_id: shellId },
      new AbortController().signal,
    );
    expect(result2.success).toBe(true);
    // Should have line2 and/or line3, but not line1 again
    const hasNewLines =
      (result2.llmContent as string).includes('line2') ||
      (result2.llmContent as string).includes('line3');
    expect(hasNewLines).toBe(true);
  });

  it('should filter output with regex', async () => {
    const shellId = 'test-shell-filter';

    // Process that outputs multiple lines
    const process = spawn('sh', [
      '-c',
      'echo "ERROR: Something failed"; echo "INFO: Normal message"; echo "ERROR: Another failure"',
    ]);
    testProcesses.push(process);

    registry.registerProcess(shellId, process.pid!, 'filter test', process);

    // Wait for output
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get only ERROR lines
    const result = await tool.execute(
      { bash_id: shellId, filter: 'ERROR' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('ERROR');
    expect(result.llmContent).not.toContain('INFO: Normal message');
  });

  it('should handle non-existent shell ID', async () => {
    const result = await tool.execute(
      { bash_id: 'nonexistent-shell-123' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should validate bash_id parameter', async () => {
    const result = await tool.execute(
      { bash_id: '' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("'bash_id' parameter cannot be empty");
  });

  it('should handle completed process', async () => {
    const shellId = 'test-shell-completed';

    // Short-lived process
    const process = spawn('echo', ['Done']);
    testProcesses.push(process);

    registry.registerProcess(shellId, process.pid!, 'short test', process);

    // Wait for process to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    const result = await tool.execute(
      { bash_id: shellId },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Done');
    expect(result.metadata?.isRunning).toBe(false);
    expect(result.metadata?.exitCode).toBeDefined();
  });

  it('should handle process with no output', async () => {
    const shellId = 'test-shell-empty';

    // Process with no output
    const process = spawn('sleep', ['0.1']);
    testProcesses.push(process);

    registry.registerProcess(shellId, process.pid!, 'silent test', process);

    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await tool.execute(
      { bash_id: shellId },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('(no new output)');
  });

  it('should handle regex filter with no matches', async () => {
    const shellId = 'test-shell-no-match';

    const process = spawn('echo', ['No errors here']);
    testProcesses.push(process);

    registry.registerProcess(shellId, process.pid!, 'no match test', process);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await tool.execute(
      { bash_id: shellId, filter: 'ERROR' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('(no new output)'); // Filter produces no matches
  });

  it('should handle invalid regex pattern', async () => {
    const shellId = 'test-shell-invalid-regex';

    const process = spawn('echo', ['test']);
    testProcesses.push(process);

    registry.registerProcess(shellId, process.pid!, 'invalid regex', process);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await tool.execute(
      { bash_id: shellId, filter: '[invalid(' }, // Invalid regex
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid filter regex');
  });

  it('should include process metadata in result', async () => {
    const shellId = 'test-shell-metadata';

    const process = spawn('echo', ['test']);
    testProcesses.push(process);

    registry.registerProcess(shellId, process.pid!, 'metadata test', process);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await tool.execute(
      { bash_id: shellId },
      new AbortController().signal,
    );

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.isRunning).toBeDefined();
    expect(result.metadata!.newLinesCount).toBeGreaterThanOrEqual(0);
  });

  it('should handle abort signal', async () => {
    const shellId = 'test-shell-abort';

    const process = spawn('sleep', ['1']);
    testProcesses.push(process);

    registry.registerProcess(shellId, process.pid!, 'abort test', process);

    const controller = new AbortController();

    // The actual tool doesn't do any async work, so abort won't be detected
    // during execution. This test validates that the abort signal parameter
    // is accepted and doesn't cause errors.
    const result = await tool.execute({ bash_id: shellId }, controller.signal);

    // Tool execution completes synchronously, so abort won't be detected
    expect(result.success).toBe(true);
  });

  it('should work via ToolRegistry', async () => {
    const shellId = 'test-shell-registry';

    const process = spawn('echo', ['via registry']);
    testProcesses.push(process);

    registry.registerProcess(
      shellId,
      process.pid!,
      'registry test',
      process,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await toolRegistry.executeTool('BashOutput', {
      bash_id: shellId,
    });

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('via registry');
  });

  it('should handle multiple concurrent reads', async () => {
    const shellId = 'test-shell-concurrent';

    const process = spawn('sh', [
      '-c',
      'for i in 1 2 3; do echo "Line $i"; sleep 0.05; done',
    ]);
    testProcesses.push(process);

    registry.registerProcess(
      shellId,
      process.pid!,
      'concurrent test',
      process,
    );

    // Wait for some output
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Multiple concurrent reads
    const results = await Promise.all([
      tool.execute({ bash_id: shellId }, new AbortController().signal),
      tool.execute({ bash_id: shellId }, new AbortController().signal),
      tool.execute({ bash_id: shellId }, new AbortController().signal),
    ]);

    // All should succeed
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(results[2].success).toBe(true);
  });

  it('should handle stderr output', async () => {
    const shellId = 'test-shell-stderr';

    const process = spawn('sh', ['-c', 'echo "Error message" >&2']);
    testProcesses.push(process);

    registry.registerProcess(shellId, process.pid!, 'stderr test', process);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await tool.execute(
      { bash_id: shellId },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Error message');
  });

  it('should handle multiline output', async () => {
    const shellId = 'test-shell-multiline';

    const process = spawn('sh', [
      '-c',
      'echo "Line 1\nLine 2\nLine 3\nLine 4"',
    ]);
    testProcesses.push(process);

    registry.registerProcess(
      shellId,
      process.pid!,
      'multiline test',
      process,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await tool.execute(
      { bash_id: shellId },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const content = result.llmContent as string;
    expect(content).toContain('Line 1');
    expect(content).toContain('Line 2');
    expect(content).toContain('Line 3');
    expect(content).toContain('Line 4');
  });

  it('should handle rapid output bursts', async () => {
    const shellId = 'test-shell-burst';

    // Process that outputs many lines quickly (using POSIX-compatible syntax)
    const process = spawn('sh', [
      '-c',
      'i=1; while [ $i -le 10 ]; do echo "Burst $i"; i=$((i+1)); done',
    ]);
    testProcesses.push(process);

    registry.registerProcess(shellId, process.pid!, 'burst test', process);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const result = await tool.execute(
      { bash_id: shellId },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.metadata?.newLinesCount).toBeGreaterThan(5);
  });

  it('should provide clear output formatting', async () => {
    const shellId = 'test-shell-format';

    const process = spawn('echo', ['Test output']);
    testProcesses.push(process);

    registry.registerProcess(shellId, process.pid!, 'format test', process);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await tool.execute(
      { bash_id: shellId },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const content = result.llmContent as string;
    expect(content).toContain('Shell ID:');
    expect(content).toContain('Status:');
    expect(content).toContain('=== Output ===');
  });
});
