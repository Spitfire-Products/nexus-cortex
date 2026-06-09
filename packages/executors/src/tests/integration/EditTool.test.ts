/**
 * EditTool Integration Tests
 *
 * Tests with REAL file I/O (no mocks per user directive)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { EditTool, FileReadTracker } from '../../implementations/file/EditTool.js';
import { ReadFileTool } from '../../implementations/file/ReadFileTool.js';
import { ToolRegistry, type ExecutorConfig } from '../../base/ToolRegistry.js';

describe('EditTool Integration', () => {
  let tool: EditTool;
  let readTool: ReadFileTool;
  let registry: ToolRegistry;
  let testDir: string;
  let testFile: string;
  let config: ExecutorConfig;

  beforeEach(() => {
    // Create real test directory
    testDir = path.join(process.cwd(), '.test-tmp-edit');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    testFile = path.join(testDir, 'test-edit.txt');

    // Configure executor
    config = {
      workingDirectory: testDir,
      allowFileSystem: true,
    };

    // Create tools and registry
    tool = new EditTool(config);
    readTool = new ReadFileTool(config);
    registry = new ToolRegistry(config);
    registry.registerTool(tool);

    // Clear session state for clean tests
    FileReadTracker.clearSession();
  });

  afterEach(() => {
    // Cleanup real files
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should replace a single occurrence', async () => {
    // Create test file with unique content
    const initialContent = `Line 1: Hello
Line 2: World
Line 3: Test`;
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: 'Line 2: World',
        new_string: 'Line 2: Universe',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(testFile, 'utf-8');
    expect(updatedContent).toBe(`Line 1: Hello
Line 2: Universe
Line 3: Test`);
  });

  it('should replace multiple occurrences with replace_all', async () => {
    const initialContent = `foo bar foo
baz foo qux
foo`;
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: 'foo',
        new_string: 'FOO',
        replace_all: true,
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(testFile, 'utf-8');
    expect(updatedContent).toBe(`FOO bar FOO
baz FOO qux
FOO`);
    expect(result.metadata?.fileStats?.occurrences).toBe(4);
  });

  it('should fail when multiple occurrences found without replace_all', async () => {
    const initialContent = `foo bar foo
baz foo qux`;
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: 'foo',
        new_string: 'FOO',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('found 3 occurrences but expected exactly 1');
  });

  it('should fail when old_string not found', async () => {
    const initialContent = `Line 1
Line 2
Line 3`;
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: 'NonExistent',
        new_string: 'Replacement',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('could not find the string to replace');
  });

  it('should handle multiline replacements', async () => {
    const initialContent = `function hello() {
  console.log("Hello");
  return "world";
}`;
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: `  console.log("Hello");
  return "world";`,
        new_string: `  console.log("Hello, World!");
  return "universe";`,
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(testFile, 'utf-8');
    expect(updatedContent).toContain('console.log("Hello, World!")');
    expect(updatedContent).toContain('return "universe"');
  });

  it('should preserve indentation and whitespace', async () => {
    const initialContent = `    indented line
  less indented
      more indented`;
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: '  less indented',
        new_string: '  modified line',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(testFile, 'utf-8');
    expect(updatedContent).toBe(`    indented line
  modified line
      more indented`);
  });

  it('should create new file when old_string is empty', async () => {
    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: '',
        new_string: 'New file content',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(fs.existsSync(testFile)).toBe(true);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe('New file content');
  });

  it('should fail when trying to create existing file', async () => {
    fs.writeFileSync(testFile, 'Existing content');

    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: '',
        new_string: 'New content',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot create file that already exists');
  });

  it('should handle relative paths', async () => {
    const relativePath = 'relative-edit.txt';
    const initialContent = 'Test content';

    // Create file using absolute path
    const absolutePath = path.join(testDir, relativePath);
    fs.writeFileSync(absolutePath, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: relativePath }, new AbortController().signal);

    const result = await tool.execute(
      {
        file_path: relativePath,
        old_string: 'Test',
        new_string: 'Updated',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(absolutePath, 'utf-8');
    expect(updatedContent).toBe('Updated content');
  });

  it('should refuse edits to paths outside the working directory', async () => {
    // EditTool now enforces the read-before-edit invariant FIRST, so a path
    // outside the working directory is rejected with "must read the file
    // before editing" before the path-traversal check fires. Either refusal
    // accomplishes the security goal; just assert that an unread external
    // path is denied.
    const result = await tool.execute(
      {
        file_path: '../../etc/passwd',
        old_string: 'old',
        new_string: 'new',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/within the working directory|must read the file before editing/i);
  });

  it('should handle empty new_string (deletion)', async () => {
    const initialContent = `Line 1
DELETE_ME
Line 3`;
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: 'DELETE_ME\n',
        new_string: '',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(testFile, 'utf-8');
    expect(updatedContent).toBe(`Line 1
Line 3`);
  });

  it('should work via ToolRegistry', async () => {
    const initialContent = `Registry test content`;
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    const result = await registry.executeTool('Edit', {
      file_path: testFile,
      old_string: 'test',
      new_string: 'TEST',
    });

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(testFile, 'utf-8');
    expect(updatedContent).toContain('TEST');
  });

  it('should include metadata in result', async () => {
    const initialContent = `Original content`;
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: 'Original',
        new_string: 'Updated',
      },
      new AbortController().signal,
    );

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.executionTime).toBeGreaterThanOrEqual(0);
    expect(result.metadata!.resourcesUsed?.files).toContain(testFile);
    expect(result.metadata!.fileStats?.occurrences).toBe(1);
    expect(result.metadata!.fileStats?.operation).toBe('edit');
  });

  it('should include diff in metadata', async () => {
    const initialContent = `Line 1
Line 2
Line 3`;
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: 'Line 2',
        new_string: 'Modified Line 2',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.metadata?.diff).toBeDefined();
    expect(typeof result.metadata?.diff).toBe('string');
    expect(result.metadata?.diff).toContain('-Line 2');
    expect(result.metadata?.diff).toContain('+Modified Line 2');
  });

  it('should handle complex context matching', async () => {
    const initialContent = `function foo() {
  console.log("test");
}

function bar() {
  console.log("test");
}

function baz() {
  console.log("test");
}`;
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    // Should successfully replace only the middle occurrence
    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: `function bar() {
  console.log("test");
}`,
        new_string: `function bar() {
  console.log("modified");
}`,
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(testFile, 'utf-8');
    expect(updatedContent).toContain('function foo() {\n  console.log("test");');
    expect(updatedContent).toContain('function bar() {\n  console.log("modified");');
    expect(updatedContent).toContain('function baz() {\n  console.log("test");');
  });

  it('should handle Windows line endings', async () => {
    const initialContent = `Line 1\r\nLine 2\r\nLine 3`;
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: 'Line 2',
        new_string: 'Modified Line 2',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(testFile, 'utf-8');
    expect(updatedContent).toContain('Modified Line 2');
  });

  it('should handle special characters in replacement', async () => {
    const initialContent = `const regex = /test/;`;
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: '/test/',
        new_string: '/[a-zA-Z0-9]+/',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(testFile, 'utf-8');
    expect(updatedContent).toBe('const regex = /[a-zA-Z0-9]+/;');
  });

  it('should handle $ escape sequences correctly (safe literal replacement)', async () => {
    const initialContent = 'Price: foo';
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    // Test replacing with $100 (which contains special $ character)
    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: 'foo',
        new_string: '$100',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(testFile, 'utf-8');
    expect(updatedContent).toBe('Price: $100'); // Should be literal $100, not "0" or other corruption
  });

  it('should handle $$ escape sequences correctly', async () => {
    const initialContent = 'Value: placeholder';
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    // Test replacing with $$ which should become literal $$
    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: 'placeholder',
        new_string: '$$variable',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(testFile, 'utf-8');
    expect(updatedContent).toBe('Value: $$variable');
  });

  it('should validate expected_replacements parameter', async () => {
    const initialContent = 'foo bar foo';
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    // Expect 2 replacements but actually has 2 (should succeed)
    const result1 = await tool.execute(
      {
        file_path: testFile,
        old_string: 'foo',
        new_string: 'baz',
        replace_all: true,
        expected_replacements: 2,
      },
      new AbortController().signal,
    );

    expect(result1.success).toBe(true);
    const updatedContent = fs.readFileSync(testFile, 'utf-8');
    expect(updatedContent).toBe('baz bar baz');
  });

  it('should fail if expected_replacements does not match actual', async () => {
    const initialContent = 'foo bar foo';
    fs.writeFileSync(testFile, initialContent);

    // Read file first (required by read-before-edit protocol)
    await readTool.execute({ file_path: testFile }, new AbortController().signal);

    // Expect 3 replacements but actually has 2 (should fail)
    const result = await tool.execute(
      {
        file_path: testFile,
        old_string: 'foo',
        new_string: 'baz',
        replace_all: true,
        expected_replacements: 3,
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('found 2 occurrences but expected 3');
  });
});
