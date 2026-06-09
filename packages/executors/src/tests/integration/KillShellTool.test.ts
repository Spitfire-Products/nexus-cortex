/**
 * KillShellTool Integration Tests
 *
 * Tests background process termination with REAL processes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KillShellTool } from '../../implementations/execution/KillShellTool.js';
import { BackgroundProcessRegistry } from '../../implementations/execution/BackgroundProcessRegistry.js';
import { ToolRegistry, type ExecutorConfig } from '../../base/ToolRegistry.js';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

describe('KillShellTool Integration', () => {
  let tool: KillShellTool;
  let registry: BackgroundProcessRegistry;
  let toolRegistry: ToolRegistry;
  let testDir: string;
  let config: ExecutorConfig;
  let testProcesses: ChildProcess[] = [];

  beforeEach(() => {
    testDir = path.join(process.cwd(), '.test-tmp-kill-shell');

    config = {
      workingDirectory: testDir,
      allowFileSystem: true,
    };

    // Get singleton registry
    registry = BackgroundProcessRegistry.getInstance();
    registry.clear(); // Clear any previous processes

    // Create tool and registry
    tool = new KillShellTool(config);
    toolRegistry = new ToolRegistry(config);
    toolRegistry.registerTool(tool);
  });

  afterEach(() => {
    // Kill any remaining test processes
    testProcesses.forEach((proc) => {
      try {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
      } catch (error) {
        // Ignore errors during cleanup
      }
    });
    testProcesses = [];

    // Clear registry
    registry.clear();
  });

  it('should kill a running background process', async () => {
    const shellId = 'test-shell-kill-1';

    // Start a long-running process
    const process = spawn('sleep', ['10']);
    testProcesses.push(process);
    const pid = process.pid!;

    registry.registerProcess(shellId, pid, 'sleep 10', process);

    // Verify process is running
    expect(registry.hasProcess(shellId)).toBe(true);
    const bgProcess = registry.getProcess(shellId);
    expect(bgProcess?.isRunning).toBe(true);

    // Kill the process
    const result = await tool.execute(
      { shell_id: shellId },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Successfully killed');
    expect(result.llmContent).toContain(shellId);
    expect(result.llmContent).toContain(pid.toString());

    // Verify process is removed from registry
    expect(registry.hasProcess(shellId)).toBe(false);
  });

  it('should handle non-existent shell ID', async () => {
    const result = await tool.execute(
      { shell_id: 'nonexistent-shell-xyz' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should validate shell_id parameter', async () => {
    const result = await tool.execute(
      { shell_id: '' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("'shell_id' parameter cannot be empty");
  });

  it('should handle already-exited process', async () => {
    const shellId = 'test-shell-exited';

    // Start a short-lived process
    const process = spawn('echo', ['done']);
    testProcesses.push(process);

    registry.registerProcess(
      shellId,
      process.pid!,
      'echo done',
      process,
    );

    // Wait for process to exit naturally
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Try to kill it
    const result = await tool.execute(
      { shell_id: shellId },
      new AbortController().signal,
    );

    // Should succeed with "was already not running" message
    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('was already not running');

    // Process should still be in registry (not removed for already-exited)
    // Actually, looking at the implementation, already-exited returns success
    // but doesn't explicitly remove from registry
  });

  it('should remove process from registry after kill', async () => {
    const shellId = 'test-shell-cleanup';

    const process = spawn('sleep', ['5']);
    testProcesses.push(process);

    registry.registerProcess(
      shellId,
      process.pid!,
      'sleep 5',
      process,
    );

    // Verify in registry
    expect(registry.hasProcess(shellId)).toBe(true);
    expect(registry.getProcessCount()).toBeGreaterThan(0);

    // Kill
    await tool.execute(
      { shell_id: shellId },
      new AbortController().signal,
    );

    // Verify removed
    expect(registry.hasProcess(shellId)).toBe(false);
    expect(registry.getProcess(shellId)).toBeUndefined();
  });

  it('should handle multiple kills in sequence', async () => {
    // Register multiple processes
    const shells = ['shell-1', 'shell-2', 'shell-3'];
    const processes = shells.map((shellId) => {
      const process = spawn('sleep', ['10']);
      testProcesses.push(process);
      registry.registerProcess(
        shellId,
        process.pid!,
        'sleep 10',
        process,
      );
      return { shellId, process };
    });

    // Verify all registered
    expect(registry.getProcessCount()).toBe(3);

    // Kill them one by one
    for (const { shellId } of processes) {
      const result = await tool.execute(
        { shell_id: shellId },
        new AbortController().signal,
      );
      expect(result.success).toBe(true);
    }

    // Verify all removed
    expect(registry.getProcessCount()).toBe(0);
  });

  it('should handle concurrent kill requests', async () => {
    // Register multiple processes
    const shells = ['concurrent-1', 'concurrent-2', 'concurrent-3'];
    shells.forEach((shellId) => {
      const process = spawn('sleep', ['10']);
      testProcesses.push(process);
      registry.registerProcess(
        shellId,
        process.pid!,
        'sleep 10',
        process,
      );
    });

    // Kill all concurrently
    const results = await Promise.all(
      shells.map((shellId) =>
        tool.execute({ shell_id: shellId }, new AbortController().signal),
      ),
    );

    // All should succeed
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(results[2].success).toBe(true);

    // All should be removed
    expect(registry.getProcessCount()).toBe(0);
  });

  it('should include process metadata in result', async () => {
    const shellId = 'test-shell-metadata';

    const process = spawn('sleep', ['5']);
    testProcesses.push(process);
    const pid = process.pid!;

    registry.registerProcess(shellId, pid, 'sleep 5', process);

    const result = await tool.execute(
      { shell_id: shellId },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.pid).toBe(pid);
  });

  it('should handle abort signal', async () => {
    const shellId = 'test-shell-abort';

    const process = spawn('sleep', ['5']);
    testProcesses.push(process);

    registry.registerProcess(shellId, process.pid!, 'sleep 5', process);

    const controller = new AbortController();

    // The actual tool doesn't do any async work, so abort won't be detected
    // during execution. This test validates that the abort signal parameter
    // is accepted and doesn't cause errors.
    const result = await tool.execute({ shell_id: shellId }, controller.signal);

    // Tool execution completes synchronously, so abort won't be detected
    expect(result.success).toBe(true);
  });

  it('should work via ToolRegistry', async () => {
    const shellId = 'test-shell-registry';

    const process = spawn('sleep', ['5']);
    testProcesses.push(process);

    registry.registerProcess(
      shellId,
      process.pid!,
      'sleep 5',
      process,
    );

    const result = await toolRegistry.executeTool('KillShell', {
      shell_id: shellId,
    });

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Successfully killed');
    expect(registry.hasProcess(shellId)).toBe(false);
  });

  it('should send SIGTERM signal', async () => {
    const shellId = 'test-shell-sigterm';

    // Create a process that can be killed
    const process = spawn('sleep', ['10']);
    testProcesses.push(process);

    registry.registerProcess(
      shellId,
      process.pid!,
      'sleep 10',
      process,
    );

    let exitSignal: NodeJS.Signals | null = null;
    process.on('exit', (code, signal) => {
      exitSignal = signal;
    });

    // Kill the process
    await tool.execute(
      { shell_id: shellId },
      new AbortController().signal,
    );

    // Wait for exit event
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have been killed with SIGTERM
    expect(exitSignal).toBe('SIGTERM');
  });

  it('should handle process without handle (PID only)', async () => {
    const shellId = 'test-shell-no-handle';

    // Register a process without the ChildProcess handle
    // This simulates a process started outside our direct control
    const testPid = 99999; // Non-existent PID
    registry.registerProcess(shellId, testPid, 'external process');

    const result = await tool.execute(
      { shell_id: shellId },
      new AbortController().signal,
    );

    // Should attempt to kill and fail gracefully
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to kill');
  });

  it('should provide clear success message', async () => {
    const shellId = 'test-shell-message';

    const process = spawn('sleep', ['5']);
    testProcesses.push(process);
    const pid = process.pid!;

    registry.registerProcess(shellId, pid, 'sleep 5', process);

    const result = await tool.execute(
      { shell_id: shellId },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const message = result.llmContent as string;
    expect(message).toContain('Successfully killed');
    expect(message).toContain(`shell '${shellId}'`);
    expect(message).toContain(`PID: ${pid}`);
  });

  it('should handle kill after process naturally exits', async () => {
    const shellId = 'test-shell-natural-exit';

    const process = spawn('echo', ['quick exit']);
    testProcesses.push(process);

    registry.registerProcess(
      shellId,
      process.pid!,
      'echo quick exit',
      process,
    );

    // Wait for natural exit
    await new Promise((resolve) => {
      process.on('exit', () => resolve(null));
    });

    // Now try to kill (should handle gracefully)
    const result = await tool.execute(
      { shell_id: shellId },
      new AbortController().signal,
    );

    // Should handle the already-exited case
    if (!result.success) {
      expect(result.error).toContain('Failed to kill');
    }
  });

  it('should handle rapid kill requests on same process', async () => {
    const shellId = 'test-shell-rapid';

    const process = spawn('sleep', ['10']);
    testProcesses.push(process);

    registry.registerProcess(
      shellId,
      process.pid!,
      'sleep 10',
      process,
    );

    // Try to kill multiple times rapidly
    const results = await Promise.all([
      tool.execute({ shell_id: shellId }, new AbortController().signal),
      tool.execute({ shell_id: shellId }, new AbortController().signal),
      tool.execute({ shell_id: shellId }, new AbortController().signal),
    ]);

    // First one should succeed, others should fail (not found)
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    expect(successCount).toBeGreaterThanOrEqual(1);
    expect(successCount + failCount).toBe(3);
  });

  it('should validate shell exists before attempting kill', async () => {
    const result = await tool.execute(
      { shell_id: 'validation-test-123' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    expect(result.error).toContain('validation-test-123');
  });

  it('should handle process without valid handle', async () => {
    const shellId = 'test-shell-cleanup-fail';

    // Register with invalid PID (process without handle)
    registry.registerProcess(shellId, 99999, 'fake process');

    expect(registry.hasProcess(shellId)).toBe(true);

    // Try to kill - should fail since no valid process handle
    const result = await tool.execute(
      { shell_id: shellId },
      new AbortController().signal,
    );

    // Should fail to kill
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to kill');

    // Process remains in registry (only removed on successful kill)
    expect(registry.hasProcess(shellId)).toBe(true);
  });

  it('should report correct tool name', () => {
    expect(tool.name).toBe('KillShell');
  });
});
