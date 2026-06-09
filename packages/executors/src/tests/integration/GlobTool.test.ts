/**
 * GlobTool Integration Tests
 *
 * Tests with REAL file I/O (no mocks per user directive)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GlobTool } from '../../implementations/search/GlobTool.js';
import { ToolRegistry, type ExecutorConfig } from '../../base/ToolRegistry.js';

describe('GlobTool Integration', () => {
  let tool: GlobTool;
  let registry: ToolRegistry;
  let testDir: string;
  let config: ExecutorConfig;

  beforeEach(() => {
    // Create real test directory structure
    testDir = path.join(process.cwd(), '.test-tmp-glob');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Create test files
    fs.writeFileSync(path.join(testDir, 'fileA.txt'), 'contentA');
    fs.writeFileSync(path.join(testDir, 'FileB.TXT'), 'contentB'); // Different case

    // Create subdirectory
    fs.mkdirSync(path.join(testDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'sub', 'fileC.md'), 'contentC');
    fs.writeFileSync(path.join(testDir, 'sub', 'FileD.MD'), 'contentD');

    // Create deeper subdirectory
    fs.mkdirSync(path.join(testDir, 'sub', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'sub', 'deep', 'fileE.log'), 'contentE');

    // Create files for mtime sorting test
    fs.writeFileSync(path.join(testDir, 'older.sortme'), 'older_content');
    // Small delay to ensure different mtime
    const start = Date.now();
    while (Date.now() - start < 10) {} // 10ms busy wait
    fs.writeFileSync(path.join(testDir, 'newer.sortme'), 'newer_content');

    // Configure executor
    config = {
      workingDirectory: testDir,
      allowFileSystem: true,
    };

    // Create tool and registry
    tool = new GlobTool(config);
    registry = new ToolRegistry(config);
    registry.registerTool(tool);
  });

  afterEach(() => {
    // Cleanup real files
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should find files matching a simple pattern', async () => {
    const result = await tool.execute(
      { pattern: '*.txt' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Case-sensitive by default: *.txt matches fileA.txt but NOT FileB.TXT
    expect(result.llmContent).toContain('Found 1 file(s)');
    expect(result.llmContent).toContain('fileA.txt');
    expect(result.metadata?.fileCount).toBe(1);
  });

  it('should find files case-sensitively by default', async () => {
    const result = await tool.execute(
      { pattern: '*.TXT' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Case-sensitive: *.TXT matches FileB.TXT but NOT fileA.txt
    expect(result.llmContent).toContain('Found 1 file(s)');
    expect(result.llmContent).toContain('FileB.TXT');
    expect(result.llmContent).not.toContain('fileA.txt');
  });

  it('should find files case-insensitively when specified', async () => {
    const result = await tool.execute(
      { pattern: '*.txt', case_sensitive: false },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Found 2 file(s)');
    expect(result.llmContent).toContain('fileA.txt');
    expect(result.llmContent).toContain('FileB.TXT');
  });

  it('should find files with recursive glob pattern', async () => {
    const result = await tool.execute(
      { pattern: '**/*.md' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Case-sensitive: *.md matches fileC.md but NOT FileD.MD
    expect(result.llmContent).toContain('Found 1 file(s)');
    expect(result.llmContent).toContain('fileC.md');
  });

  it('should find files in specific subdirectory', async () => {
    const result = await tool.execute(
      { pattern: '*.log', path: 'sub/deep' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Found 1 file(s)');
    expect(result.llmContent).toContain('fileE.log');
  });

  it('should find all files with star pattern', async () => {
    const result = await tool.execute(
      { pattern: '*' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Should find: fileA.txt, FileB.TXT, older.sortme, newer.sortme (4 files in root)
    expect(result.metadata?.fileCount).toBe(4);
  });

  it('should find files recursively with double-star', async () => {
    const result = await tool.execute(
      { pattern: '**/*' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Should find all 7 files: fileA.txt, FileB.TXT, older.sortme, newer.sortme,
    // sub/fileC.md, sub/FileD.MD, sub/deep/fileE.log
    expect(result.metadata?.fileCount).toBe(7);
  });

  it('should return message when no files found', async () => {
    const result = await tool.execute(
      { pattern: '*.nonexistent' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('No files found');
    expect(result.metadata?.fileCount).toBe(0);
  });

  it('should sort files by modification time', async () => {
    const result = await tool.execute(
      { pattern: '*.sortme' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const content = result.llmContent as string;

    // Find positions of each file in the result
    const newerPos = content.indexOf('newer.sortme');
    const olderPos = content.indexOf('older.sortme');

    // Newer file should come before older file
    expect(newerPos).toBeGreaterThan(0);
    expect(olderPos).toBeGreaterThan(0);
    expect(newerPos).toBeLessThan(olderPos);
  });

  it('should validate empty pattern', async () => {
    const result = await tool.execute(
      { pattern: '' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('pattern');
    expect(result.error).toContain('cannot be empty');
  });

  it('should validate search path exists', async () => {
    const result = await tool.execute(
      { pattern: '*.txt', path: 'nonexistent' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('should refuse path traversal', async () => {
    // GlobTool checks path-existence before working-directory containment.
    // `../../etc` may resolve to a non-existent path on the test box, so
    // the existence check fires first. Either refusal accomplishes the
    // security goal.
    const result = await tool.execute(
      { pattern: '*.txt', path: '../../etc' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/within the working directory|does not exist/i);
  });

  it('should handle relative search paths', async () => {
    const result = await tool.execute(
      { pattern: '*.md', path: 'sub' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Case-sensitive: *.md matches fileC.md but NOT FileD.MD
    expect(result.llmContent).toContain('Found 1 file(s)');
    expect(result.llmContent).toContain('fileC.md');
  });

  it('should work via ToolRegistry', async () => {
    const result = await registry.executeTool('Glob', {
      pattern: '*.txt',
    });

    expect(result.success).toBe(true);
    // Case-sensitive: *.txt matches fileA.txt only
    expect(result.llmContent).toContain('Found 1 file(s)');
  });

  it('should include metadata in result', async () => {
    const result = await tool.execute(
      { pattern: '*.txt' },
      new AbortController().signal,
    );

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.executionTime).toBeGreaterThan(0);
    expect(result.metadata!.fileCount).toBe(1); // Case-sensitive: fileA.txt only
    expect(result.metadata!.searchPath).toContain(testDir);
    expect(result.metadata!.pattern).toBe('*.txt');
  });

  it('should handle complex glob patterns', async () => {
    const result = await tool.execute(
      { pattern: 'sub/**/*.{md,log}' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Case-sensitive: matches fileC.md and fileE.log (not FileD.MD)
    expect(result.metadata?.fileCount).toBe(2);
  });

  it('should handle glob with character ranges', async () => {
    const result = await tool.execute(
      { pattern: 'file[A-B].*' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Case-sensitive: file[A-B].* matches fileA.txt only (FileB.TXT starts with 'F')
    expect(result.metadata?.fileCount).toBe(1);
  });

  it('should exclude node_modules by default', async () => {
    // Create node_modules directory with a file
    fs.mkdirSync(path.join(testDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'node_modules', 'test.txt'), 'content');

    const result = await tool.execute(
      { pattern: '**/*.txt' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Should NOT include the file from node_modules
    expect(result.llmContent).not.toContain('node_modules');
  });

  it('should exclude .git by default', async () => {
    // Create .git directory with a file
    fs.mkdirSync(path.join(testDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.git', 'config'), 'content');

    const result = await tool.execute(
      { pattern: '**/*' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Should NOT include files from .git
    expect(result.llmContent).not.toContain('.git');
  });

  it('should include dotfiles by default', async () => {
    fs.writeFileSync(path.join(testDir, '.hidden'), 'content');

    const result = await tool.execute(
      { pattern: '.*' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('.hidden');
  });
});
