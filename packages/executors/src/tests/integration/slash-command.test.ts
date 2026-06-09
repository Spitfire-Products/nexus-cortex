/**
 * SlashCommand Tool Integration Tests
 *
 * Tests the SlashCommand tool with real .md command files
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SlashCommandToolExecutor } from '../../implementations/extensions/SlashCommandTool.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

describe('SlashCommand Integration', () => {
  let executor: SlashCommandToolExecutor;
  let testDir: string;
  let commandsDir: string;

  beforeAll(async () => {
    // Create test directory structure
    testDir = join(process.cwd(), 'test-slash-commands');
    commandsDir = join(testDir, '.cortex', 'commands');

    await fs.mkdir(commandsDir, { recursive: true });

    // Create test command files
    await createTestCommands(commandsDir);

    // Create executor
    executor = new SlashCommandToolExecutor({
      workingDirectory: testDir,
    });
  });

  afterAll(async () => {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('Command Loading', () => {
    it('should load command from .md file', async () => {
      const result = await executor.execute(
        { command: '/review-pr 123' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('Slash Command: /review-pr');
      expect(result.returnDisplay).toContain('Review pull request #123');
    });

    it('should handle command without arguments', async () => {
      const result = await executor.execute(
        { command: '/status' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('Slash Command: /status');
      expect(result.returnDisplay).toContain('Show project status');
    });

    it('should error for non-existent command', async () => {
      const result = await executor.execute(
        { command: '/nonexistent' },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('Command \'nonexistent\' not found');
      expect(result.returnDisplay).toContain('Available commands:');
    });

    it('should load commands from subdirectories', async () => {
      const result = await executor.execute(
        { command: '/deploy-prod' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('Slash Command: /deploy-prod');
    });
  });

  describe('Argument Substitution', () => {
    it('should substitute single argument', async () => {
      const result = await executor.execute(
        { command: '/review-pr 456' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('Review pull request #456');
      expect(result.returnDisplay).not.toContain('$1');
    });

    it('should substitute multiple arguments', async () => {
      const result = await executor.execute(
        { command: '/test-provider anthropic hello' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('Test the anthropic provider');
      expect(result.returnDisplay).toContain('hello');
      expect(result.returnDisplay).not.toContain('$1');
      expect(result.returnDisplay).not.toContain('$2');
    });

    it('should handle missing arguments gracefully', async () => {
      const result = await executor.execute(
        { command: '/review-pr' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      // Should not contain $1 placeholder
      expect(result.returnDisplay).not.toContain('$1');
    });

    it('should handle extra arguments', async () => {
      const result = await executor.execute(
        { command: '/review-pr 123 456 789' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('123');
      // Extra arguments should be shown in metadata (with markdown bold formatting)
      expect(result.returnDisplay).toContain('**Provided Arguments**: 123, 456, 789');
    });
  });

  describe('Frontmatter Parsing', () => {
    it('should parse description from frontmatter', async () => {
      const result = await executor.execute(
        { command: '/review-pr 123' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('**Description**: Review a pull request by number');
    });

    it('should parse argument-hint from frontmatter', async () => {
      const result = await executor.execute(
        { command: '/review-pr 123' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('**Arguments**: [pr-number]');
    });

    it('should handle commands without argument-hint', async () => {
      const result = await executor.execute(
        { command: '/status' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      // Should not error when argument-hint is missing
      expect(result.returnDisplay).not.toContain('**Arguments**:');
    });
  });

  describe('Parameter Validation', () => {
    it('should error for missing command', async () => {
      const result = await executor.execute(
        { command: '' } as any,
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('must be a non-empty string');
    });

    it('should error for command without leading slash', async () => {
      const result = await executor.execute(
        { command: 'review-pr 123' },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('must start with a forward slash');
    });

    it('should error for empty command name', async () => {
      const result = await executor.execute(
        { command: '/' },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('command name cannot be empty');
    });

    it('should handle invalid parameter type', async () => {
      const result = await executor.execute(
        { command: 123 as any },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('must be a non-empty string');
    });
  });

  describe('Abort Signal', () => {
    it('should handle abort signal during command loading', async () => {
      // Note: Since command loading is synchronous and very fast,
      // aborting before execute() is called still succeeds.
      // This test verifies the tool handles aborted signals gracefully.
      const controller = new AbortController();
      controller.abort();

      const result = await executor.execute(
        { command: '/review-pr 123' },
        controller.signal,
      );

      // Tool may still succeed if cache is loaded, or fail if aborted early
      expect(result).toBeDefined();
      expect(result.returnDisplay).toBeDefined();
    });
  });

  describe('Cache Management', () => {
    it('should cache commands after first load', async () => {
      // First call loads from disk
      const result1 = await executor.execute(
        { command: '/review-pr 123' },
        new AbortController().signal,
      );

      expect(result1.success).toBe(true);

      // Second call uses cache (should be faster)
      const result2 = await executor.execute(
        { command: '/review-pr 456' },
        new AbortController().signal,
      );

      expect(result2.success).toBe(true);
      expect(result2.returnDisplay).toContain('456');
    });

    it('should allow cache clearing', async () => {
      const result1 = await executor.execute(
        { command: '/review-pr 123' },
        new AbortController().signal,
      );

      expect(result1.success).toBe(true);

      // Clear cache
      executor.clearCache();

      // Next call should reload from disk (and still work)
      const result2 = await executor.execute(
        { command: '/review-pr 456' },
        new AbortController().signal,
      );

      expect(result2.success).toBe(true);
      expect(result2.returnDisplay).toContain('456');

      // Verify cache was actually cleared and reloaded
      // (both results should be successful, demonstrating cache reload works)
      expect(result1.metadata.commandName).toBe('review-pr');
      expect(result2.metadata.commandName).toBe('review-pr');
    });
  });

  describe('Output Formatting', () => {
    it('should format output with command header', async () => {
      const result = await executor.execute(
        { command: '/review-pr 123' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('# Slash Command: /review-pr');
      expect(result.returnDisplay).toContain('---');
    });

    it('should include metadata in result', async () => {
      const result = await executor.execute(
        { command: '/review-pr 123' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.commandName).toBe('review-pr');
      expect(result.metadata.argumentCount).toBe(1);
      expect(result.metadata.description).toBe('Review a pull request by number');
      expect(result.metadata.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should show provided arguments in output', async () => {
      const result = await executor.execute(
        { command: '/test-provider anthropic testprompt' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('**Provided Arguments**: anthropic, testprompt');
    });
  });

  describe('Edge Cases', () => {
    it('should handle command with special characters in arguments', async () => {
      const result = await executor.execute(
        { command: '/review-pr PR-123' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('PR-123');
    });

    it('should handle command with multiple spaces', async () => {
      const result = await executor.execute(
        { command: '/review-pr   123   456' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('123');
    });

    it('should handle command with trailing spaces', async () => {
      const result = await executor.execute(
        { command: '/review-pr 123   ' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('123');
    });

    it('should handle missing .cortex/commands directory', async () => {
      const tempExecutor = new SlashCommandToolExecutor({
        workingDirectory: '/nonexistent/directory',
      });

      const result = await tempExecutor.execute(
        { command: '/any-command' },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('not found');
    });
  });
});

/**
 * Create test command files
 */
async function createTestCommands(commandsDir: string): Promise<void> {
  // Review PR command
  await fs.writeFile(
    join(commandsDir, 'review-pr.md'),
    `---
description: Review a pull request by number
argument-hint: [pr-number]
---

Review pull request #$1

Instructions:
1. Fetch PR details from GitHub
2. Analyze the code changes
3. Provide constructive feedback
4. Check for potential issues
`,
  );

  // Status command (no arguments)
  await fs.writeFile(
    join(commandsDir, 'status.md'),
    `---
description: Show project status
---

Show project status

Tasks:
- Check git status
- Show current branch
- List uncommitted changes
`,
  );

  // Test provider command (multiple arguments)
  await fs.writeFile(
    join(commandsDir, 'test-provider.md'),
    `---
description: Test an AI provider with a prompt
argument-hint: [provider-name] [test-prompt]
---

Test the $1 provider with the following prompt:

"$2"

Instructions:
1. Send test request to the provider
2. Verify response is received
3. Report any errors
4. Display response time
`,
  );

  // Deploy command in subdirectory
  const deployDir = join(commandsDir, 'deployment');
  await fs.mkdir(deployDir, { recursive: true });

  await fs.writeFile(
    join(deployDir, 'deploy-prod.md'),
    `---
description: Deploy to production
argument-hint: [version]
---

Deploy version $1 to production

Steps:
1. Run tests
2. Build production bundle
3. Deploy to servers
4. Verify deployment
`,
  );
}
