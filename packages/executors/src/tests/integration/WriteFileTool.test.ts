/**
 * WriteFileTool Integration Tests
 *
 * Tests with REAL file I/O (no mocks per user directive)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { WriteFileTool } from '../../implementations/file/WriteFileTool.js';
import { ToolRegistry, type ExecutorConfig } from '../../base/ToolRegistry.js';

describe('WriteFileTool Integration', () => {
  let tool: WriteFileTool;
  let registry: ToolRegistry;
  let testDir: string;
  let testFile: string;
  let config: ExecutorConfig;

  beforeEach(() => {
    // Create real test directory
    testDir = path.join(process.cwd(), '.test-tmp-write');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    testFile = path.join(testDir, 'test-write.txt');

    // Configure executor
    config = {
      workingDirectory: testDir,
      allowFileSystem: true,
    };

    // Create tool and registry
    tool = new WriteFileTool(config);
    registry = new ToolRegistry(config);
    registry.registerTool(tool);
  });

  afterEach(() => {
    // Cleanup real files
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should create new file', async () => {
    const result = await tool.execute(
      { file_path: testFile, content: 'Hello, World!' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(fs.existsSync(testFile)).toBe(true);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe('Hello, World!');
  });

  it('should overwrite existing file', async () => {
    // Create initial file
    fs.writeFileSync(testFile, 'Initial content');

    const result = await tool.execute(
      { file_path: testFile, content: 'Updated content' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe('Updated content');
  });

  it('should create parent directories', async () => {
    const nestedFile = path.join(testDir, 'nested', 'deep', 'file.txt');

    const result = await tool.execute(
      { file_path: nestedFile, content: 'Nested content' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(fs.existsSync(nestedFile)).toBe(true);
    expect(fs.readFileSync(nestedFile, 'utf-8')).toBe('Nested content');
  });

  it('should handle empty content', async () => {
    const result = await tool.execute(
      { file_path: testFile, content: '' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe('');
  });

  it('should handle multiline content', async () => {
    const content = 'Line 1\nLine 2\nLine 3';

    const result = await tool.execute(
      { file_path: testFile, content },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe(content);
  });

  it('should handle relative paths within working directory', async () => {
    const result = await tool.execute(
      { file_path: 'relative-test.txt', content: 'Relative path test' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const resolvedPath = path.join(testDir, 'relative-test.txt');
    expect(fs.existsSync(resolvedPath)).toBe(true);
  });

  it('should reject directory paths', async () => {
    const dirPath = path.join(testDir, 'subdir');
    fs.mkdirSync(dirPath);

    const result = await tool.execute(
      { file_path: dirPath, content: 'content' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('directory');
  });

  it('should work via ToolRegistry', async () => {
    const result = await registry.executeTool('Write', {
      file_path: testFile,
      content: 'Registry test',
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(testFile)).toBe(true);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe('Registry test');
  });

  it('should include metadata in result', async () => {
    const result = await tool.execute(
      { file_path: testFile, content: 'Test content' },
      new AbortController().signal,
    );

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.executionTime).toBeGreaterThanOrEqual(0);
    expect(result.metadata!.resourcesUsed?.files).toContain(testFile);
    expect(result.metadata!.fileStats).toBeDefined();
    expect(result.metadata!.fileStats.action).toBe('Created');
  });

  it('should track create vs update in metadata', async () => {
    // First write (create)
    let result = await tool.execute(
      { file_path: testFile, content: 'Initial' },
      new AbortController().signal,
    );
    expect(result.metadata!.fileStats.action).toBe('Created');

    // Second write (update)
    result = await tool.execute(
      { file_path: testFile, content: 'Updated' },
      new AbortController().signal,
    );
    expect(result.metadata!.fileStats.action).toBe('Updated');
  });
});
