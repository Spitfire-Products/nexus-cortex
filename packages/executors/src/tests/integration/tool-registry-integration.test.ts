/**
 * Tool Registry Integration Tests
 *
 * Verifies that tool executors integrate properly with ToolRegistry
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ToolRegistry } from '../../base/ToolRegistry.js';
import { SlashCommandToolExecutor } from '../../implementations/extensions/SlashCommandTool.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

describe('Tool Registry Integration', () => {
  let registry: ToolRegistry;
  let testDir: string;
  let commandsDir: string;

  beforeAll(async () => {
    // Create test directory with commands
    testDir = join(process.cwd(), 'test-registry-integration');
    commandsDir = join(testDir, '.cortex', 'commands');
    await fs.mkdir(commandsDir, { recursive: true });

    // Create a test command file
    await fs.writeFile(
      join(commandsDir, 'test-command.md'),
      `---
description: Test command for integration
argument-hint: [arg1]
---

Test command with $1
`,
    );

    // Create tool registry
    registry = new ToolRegistry({
      workingDirectory: testDir,
      allowFileSystem: true,
    });

    // Register SlashCommand tool
    const slashCommandTool = new SlashCommandToolExecutor({
      workingDirectory: testDir,
    });
    registry.registerTool(slashCommandTool);
  });

  afterAll(async () => {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('Tool Registration', () => {
    it('should register SlashCommand tool successfully', () => {
      expect(registry.hasTool('SlashCommand')).toBe(true);
      expect(registry.getToolCount()).toBeGreaterThanOrEqual(1);
    });

    it('should retrieve registered tool', () => {
      const tool = registry.getTool('SlashCommand');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('SlashCommand');
    });

    it('should list registered tools', () => {
      const toolNames = registry.getToolNames();
      expect(toolNames).toContain('SlashCommand');
    });
  });

  describe('Tool Execution via Registry', () => {
    it('should execute SlashCommand through registry', async () => {
      const result = await registry.executeTool(
        'SlashCommand',
        { command: '/test-command hello' },
        new AbortController().signal,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('test-command');
      expect(result.returnDisplay).toContain('hello');
    });

    it('should validate parameters before execution', async () => {
      const result = await registry.executeTool(
        'SlashCommand',
        { command: 'invalid-no-slash' },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('must start with a forward slash');
    });

    it('should handle non-existent tool', async () => {
      const result = await registry.executeTool(
        'NonExistentTool',
        {},
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });

  describe('Tool Statistics', () => {
    it('should track execution statistics', async () => {
      // Execute tool
      await registry.executeTool(
        'SlashCommand',
        { command: '/test-command arg' },
        new AbortController().signal,
      );

      // Get stats
      const stats = registry.getToolStats('SlashCommand');
      expect(stats).toBeDefined();
      expect(stats!.toolName).toBe('SlashCommand');
      expect(stats!.executionCount).toBeGreaterThan(0);
      expect(stats!.successCount).toBeGreaterThan(0);
    });

    it('should track execution time', async () => {
      const result = await registry.executeTool(
        'SlashCommand',
        { command: '/test-command test' },
        new AbortController().signal,
      );

      expect(result.metadata?.executionTime).toBeDefined();
      expect(result.metadata!.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should retrieve all statistics', () => {
      const allStats = registry.getAllStats();
      expect(allStats.size).toBeGreaterThan(0);
      expect(allStats.has('SlashCommand')).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle tool execution errors gracefully', async () => {
      const result = await registry.executeTool(
        'SlashCommand',
        { command: '/nonexistent' },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toBeDefined();
      expect(result.error).toBeDefined();
    });

    it('should track failed executions', async () => {
      const statsBefore = registry.getToolStats('SlashCommand');
      const failuresBefore = statsBefore?.failureCount || 0;

      // Execute with invalid command
      await registry.executeTool(
        'SlashCommand',
        { command: '/does-not-exist' },
        new AbortController().signal,
      );

      const statsAfter = registry.getToolStats('SlashCommand');
      expect(statsAfter?.failureCount).toBeGreaterThan(failuresBefore);
    });
  });
});
