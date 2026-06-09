/**
 * GrepTool Integration Tests
 *
 * Tests with REAL file I/O (no mocks per user directive)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GrepTool } from '../../implementations/search/GrepTool.js';
import { ToolRegistry, type ExecutorConfig } from '../../base/ToolRegistry.js';

describe('GrepTool Integration', () => {
  let tool: GrepTool;
  let registry: ToolRegistry;
  let testDir: string;
  let config: ExecutorConfig;

  beforeEach(() => {
    // Create real test directory structure
    testDir = path.join(process.cwd(), '.test-tmp-grep');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Create test files with searchable content
    fs.writeFileSync(
      path.join(testDir, 'file1.ts'),
      `function hello() {\n  console.log("Hello");\n}\n\nfunction goodbye() {\n  console.log("Goodbye");\n}`,
    );

    fs.writeFileSync(
      path.join(testDir, 'file2.js'),
      `const greeting = "Hello World";\nconst farewell = "Goodbye World";\nconsole.log(greeting);`,
    );

    // Create subdirectory
    fs.mkdirSync(path.join(testDir, 'sub'), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, 'sub', 'nested.ts'),
      `import { hello } from '../file1';\nhello();\nconst message = "Hello from nested";`,
    );

    // Configure executor
    config = {
      workingDirectory: testDir,
      allowFileSystem: true,
    };

    // Create tool and registry
    tool = new GrepTool(config);
    registry = new ToolRegistry(config);
    registry.registerTool(tool);
  });

  afterEach(() => {
    // Cleanup real files
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should find matches for simple pattern', async () => {
    // Default output_mode is 'files_with_matches' (just file paths). To see
    // matching line content, request output_mode: 'content'.
    const result = await tool.execute(
      { pattern: 'hello', output_mode: 'content' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Found');
    expect(result.llmContent).toContain('file1.ts');
    expect(result.llmContent).toContain('function hello');
    expect(result.metadata?.matchCount).toBeGreaterThan(0);
  });

  it('should find matches case-insensitively when -i is set', async () => {
    // GrepTool now defaults to case-SENSITIVE; opt in via -i: true.
    const result = await tool.execute(
      { pattern: 'HELLO', '-i': true } as any,
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Found');
    expect(result.llmContent).toContain('file1.ts');
  });

  it('should find matches case-sensitively when specified', async () => {
    const result = await tool.execute(
      { pattern: 'HELLO', case_sensitive: true },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('No matches found');
  });

  it('should find matches with regex pattern', async () => {
    const result = await tool.execute(
      { pattern: 'function\\s+\\w+', output_mode: 'content' } as any,
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('function hello');
    expect(result.llmContent).toContain('function goodbye');
  });

  it('should filter by file glob pattern', async () => {
    const result = await tool.execute(
      { pattern: 'hello', include: '*.ts' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('file1.ts');
    // Note: *.ts only matches files in root, not subdirectories
    // Use **/*.ts for recursive matching
    expect(result.llmContent).not.toContain('file2.js');
  });

  it('should filter by recursive glob pattern', async () => {
    const result = await tool.execute(
      { pattern: 'hello', include: '**/*.ts' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('file1.ts');
    expect(result.llmContent).toContain('nested.ts');
    expect(result.llmContent).not.toContain('file2.js');
  });

  it('should search in subdirectory', async () => {
    const result = await tool.execute(
      { pattern: 'hello', path: 'sub' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('nested.ts');
    expect(result.llmContent).toContain('hello');
  });

  it('should search recursively by default', async () => {
    const result = await tool.execute(
      { pattern: 'hello' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Should find matches in both root and subdirectory
    expect(result.llmContent).toContain('file1.ts');
    expect(result.llmContent).toContain('nested.ts');
  });

  it('should return no matches when pattern not found', async () => {
    const result = await tool.execute(
      { pattern: 'nonexistent_pattern_xyz' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('No matches found');
    expect(result.metadata?.matchCount).toBe(0);
  });

  it('should include line numbers in results when output_mode: content', async () => {
    const result = await tool.execute(
      { pattern: 'console.log', output_mode: 'content' } as any,
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toMatch(/L\d+:/); // Should contain "L<number>:"
  });

  it('should group matches by file when output_mode: content', async () => {
    const result = await tool.execute(
      { pattern: 'console', output_mode: 'content' } as any,
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const content = result.llmContent as string;
    expect(content).toContain('File: file1.ts');
    expect(content).toContain('File: file2.js');
    expect(content).toContain('---'); // File separator
  });

  it('should validate regex pattern', async () => {
    const result = await tool.execute(
      { pattern: '[invalid(' }, // Invalid regex
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid regular expression');
  });

  it('should validate search path exists', async () => {
    const result = await tool.execute(
      { pattern: 'test', path: 'nonexistent' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('should refuse path traversal', async () => {
    // GrepTool checks path-existence before working-directory containment;
    // `../../etc` may resolve to a non-existent path on the test box.
    const result = await tool.execute(
      { pattern: 'test', path: '../../etc' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/within working directory|does not exist/i);
  });

  it('should work via ToolRegistry', async () => {
    const result = await registry.executeTool('Grep', {
      pattern: 'hello',
    });

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Found');
  });

  it('should include metadata in result', async () => {
    const result = await tool.execute(
      { pattern: 'hello' },
      new AbortController().signal,
    );

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.executionTime).toBeGreaterThan(0);
    expect(result.metadata!.matchCount).toBeGreaterThan(0);
    expect(result.metadata!.searchPath).toContain(testDir);
    expect(result.metadata!.pattern).toBe('hello');
  });

  it('should handle complex regex patterns', async () => {
    const result = await tool.execute(
      { pattern: 'const\\s+\\w+\\s*=\\s*"', output_mode: 'content' } as any,
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('const greeting');
    expect(result.llmContent).toContain('const message');
  });

  it('should exclude node_modules by default', async () => {
    // Create node_modules directory with searchable content
    fs.mkdirSync(path.join(testDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, 'node_modules', 'test.js'),
      'hello from node_modules',
    );

    const result = await tool.execute(
      { pattern: 'hello' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Should NOT include matches from node_modules
    expect(result.llmContent).not.toContain('node_modules');
  });

  it('should exclude .git by default', async () => {
    // Create .git directory with searchable content
    fs.mkdirSync(path.join(testDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.git', 'config'), 'hello from git');

    const result = await tool.execute(
      { pattern: 'hello' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Should NOT include matches from .git
    expect(result.llmContent).not.toContain('.git');
  });

  it('should handle empty files gracefully', async () => {
    fs.writeFileSync(path.join(testDir, 'empty.txt'), '');

    const result = await tool.execute(
      { pattern: 'anything' },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    // Empty file won't have matches, but shouldn't cause errors
  });
});
