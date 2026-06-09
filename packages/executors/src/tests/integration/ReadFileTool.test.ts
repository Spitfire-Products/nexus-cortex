/**
 * ReadFileTool Integration Tests
 *
 * Tests with REAL file I/O (no mocks per user directive)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ReadFileTool } from '../../implementations/file/ReadFileTool.js';
import { ToolRegistry, type ExecutorConfig } from '../../base/ToolRegistry.js';

describe('ReadFileTool Integration', () => {
  let tool: ReadFileTool;
  let registry: ToolRegistry;
  let testDir: string;
  let testFile: string;
  let config: ExecutorConfig;

  beforeEach(() => {
    // Create real test directory
    testDir = path.join(process.cwd(), '.test-tmp-read');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Create real test file
    testFile = path.join(testDir, 'test.txt');
    fs.writeFileSync(
      testFile,
      'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\n',
    );

    // Configure executor
    config = {
      workingDirectory: testDir,
      allowFileSystem: true,
    };

    // Create tool and registry
    tool = new ReadFileTool(config);
    registry = new ToolRegistry(config);
    registry.registerTool(tool);
  });

  afterEach(() => {
    // Cleanup real files
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should read entire file content', async () => {
    const result = await tool.execute(
      { file_path: testFile },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Line 1');
    expect(result.llmContent).toContain('Line 10');
    expect(result.error).toBeUndefined();
  });

  it('should read file with offset and limit', async () => {
    const result = await tool.execute(
      { file_path: testFile, offset: 2, limit: 3 },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Line 3');
    expect(result.llmContent).toContain('Line 5');
    expect(result.llmContent).not.toContain('Line 1');
    expect(result.llmContent).not.toContain('Line 6');
  });

  it('should handle non-existent file', async () => {
    const result = await tool.execute(
      { file_path: path.join(testDir, 'nonexistent.txt') },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should handle relative paths within working directory', async () => {
    const result = await tool.execute(
      { file_path: 'test.txt' }, // Relative to testDir
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Line 1');
  });

  it('should reject negative offset', async () => {
    const result = await tool.execute(
      { file_path: testFile, offset: -1 },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Offset must be a non-negative number');
  });

  it('should reject zero or negative limit', async () => {
    const result = await tool.execute(
      { file_path: testFile, limit: 0 },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Limit must be a positive number');
  });

  it('should work via ToolRegistry', async () => {
    const result = await registry.executeTool('Read', { file_path: testFile });

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Line 1');
  });

  it('should include metadata in result', async () => {
    const result = await tool.execute(
      { file_path: testFile },
      new AbortController().signal,
    );

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.executionTime).toBeGreaterThanOrEqual(0);
    expect(result.metadata!.resourcesUsed?.files).toContain(testFile);
    expect(result.metadata!.fileStats).toBeDefined();
  });

  it('should track execution statistics', async () => {
    await registry.executeTool('Read', { file_path: testFile });
    await registry.executeTool('Read', { file_path: testFile });

    const stats = registry.getToolStats('Read');

    expect(stats).toBeDefined();
    expect(stats!.executionCount).toBe(2);
    expect(stats!.successCount).toBe(2);
    expect(stats!.failureCount).toBe(0);
    expect(stats!.averageExecutionTime).toBeGreaterThanOrEqual(0);
  });

  describe('smart path fallback (doubled directory name)', () => {
    let nestedDir: string;
    let nestedFile: string;
    let nestedTool: ReadFileTool;

    beforeEach(() => {
      // Create structure: .test-tmp-read/my-project/src/index.ts
      // with workingDirectory = .test-tmp-read/my-project/
      nestedDir = path.join(testDir, 'my-project');
      fs.mkdirSync(path.join(nestedDir, 'src'), { recursive: true });
      nestedFile = path.join(nestedDir, 'src', 'index.ts');
      fs.writeFileSync(nestedFile, 'export const x = 1;\n');

      nestedTool = new ReadFileTool({
        workingDirectory: nestedDir,
        allowFileSystem: true,
      });
    });

    it('should resolve path with doubled directory prefix', async () => {
      // Model passes "my-project/src/index.ts" when workingDirectory is already my-project/
      const result = await nestedTool.execute(
        { file_path: 'my-project/src/index.ts' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('export const x = 1');
    });

    it('should still resolve normal relative paths', async () => {
      const result = await nestedTool.execute(
        { file_path: 'src/index.ts' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('export const x = 1');
    });

    it('should still reject paths outside working directory', async () => {
      const outsideFile = path.join(testDir, 'outside.txt');
      fs.writeFileSync(outsideFile, 'secret');

      const result = await nestedTool.execute(
        { file_path: '../outside.txt' },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be within the working directory');
    });
  });
});
