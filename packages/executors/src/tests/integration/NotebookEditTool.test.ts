/**
 * NotebookEditTool Integration Tests
 *
 * Tests Jupyter notebook cell editing with real .ipynb files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  NotebookEditTool,
  type NotebookEditToolParams,
} from '../../implementations/notebook/NotebookEditTool.js';
import { ToolRegistry, type ExecutorConfig } from '../../base/ToolRegistry.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('NotebookEditTool Integration', () => {
  let tool: NotebookEditTool;
  let registry: ToolRegistry;
  let config: ExecutorConfig;
  let testDir: string;

  beforeEach(async () => {
    // Create temp directory for test notebooks
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notebook-test-'));

    config = {
      workingDirectory: testDir,
      allowFileSystem: true,
    };

    tool = new NotebookEditTool(config);
    registry = new ToolRegistry(config);
    registry.registerTool(tool);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper: Create a minimal test notebook
   */
  async function createTestNotebook(
    filename: string,
    cells: any[] = [],
  ): Promise<string> {
    const notebookPath = path.join(testDir, filename);
    const notebook = {
      cells: cells.length > 0 ? cells : [
        {
          cell_type: 'code',
          id: 'cell-1',
          metadata: {},
          source: ['print("Hello")'],
          outputs: [],
          execution_count: null,
        },
        {
          cell_type: 'markdown',
          id: 'cell-2',
          metadata: {},
          source: ['# Title'],
        },
      ],
      metadata: {
        kernelspec: {
          display_name: 'Python 3',
          language: 'python',
          name: 'python3',
        },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };

    await fs.writeFile(notebookPath, JSON.stringify(notebook, null, 2));
    return notebookPath;
  }

  /**
   * Helper: Read and parse notebook
   */
  async function readNotebook(notebookPath: string): Promise<any> {
    const content = await fs.readFile(notebookPath, 'utf-8');
    return JSON.parse(content);
  }

  it('should replace cell content', async () => {
    const notebookPath = await createTestNotebook('test1.ipynb');

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_id: 'cell-1',
      edit_mode: 'replace',
      new_source: 'print("Modified")',
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Replaced cell');
    expect(result.llmContent).toContain('cell-1');

    // Verify notebook was modified
    const notebook = await readNotebook(notebookPath);
    const cell = notebook.cells.find((c: any) => c.id === 'cell-1');
    expect(cell).toBeDefined();
    expect(cell.source.join('')).toContain('Modified');
  });

  it('should insert new cell at end', async () => {
    const notebookPath = await createTestNotebook('test2.ipynb');

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_type: 'code',
      edit_mode: 'insert',
      new_source: 'x = 42',
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Inserted new code cell');
    expect(result.metadata?.cellCount).toBe(3); // Original 2 + 1 new

    // Verify cell was added
    const notebook = await readNotebook(notebookPath);
    expect(notebook.cells).toHaveLength(3);
    expect(notebook.cells[2].source.join('')).toContain('x = 42');
  });

  it('should insert new cell after specific cell', async () => {
    const notebookPath = await createTestNotebook('test3.ipynb');

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_id: 'cell-1',
      cell_type: 'markdown',
      edit_mode: 'insert',
      new_source: '## Subheading',
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('after cell "cell-1"');

    // Verify cell was inserted at correct position
    const notebook = await readNotebook(notebookPath);
    expect(notebook.cells).toHaveLength(3);
    expect(notebook.cells[1].cell_type).toBe('markdown');
    expect(notebook.cells[1].source.join('')).toContain('Subheading');
  });

  it('should delete cell', async () => {
    const notebookPath = await createTestNotebook('test4.ipynb');

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_id: 'cell-2',
      edit_mode: 'delete',
      new_source: '', // Required but ignored for delete
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Deleted cell');
    expect(result.metadata?.cellCount).toBe(1);

    // Verify cell was removed
    const notebook = await readNotebook(notebookPath);
    expect(notebook.cells).toHaveLength(1);
    expect(notebook.cells.find((c: any) => c.id === 'cell-2')).toBeUndefined();
  });

  it('should validate notebook path is absolute', async () => {
    const params: NotebookEditToolParams = {
      notebook_path: 'relative/path.ipynb', // Not absolute
      cell_id: 'cell-1',
      edit_mode: 'replace',
      new_source: 'test',
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('must be absolute');
  });

  it('should validate .ipynb extension', async () => {
    const params: NotebookEditToolParams = {
      notebook_path: path.join(testDir, 'test.txt'),
      cell_id: 'cell-1',
      edit_mode: 'replace',
      new_source: 'test',
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('.ipynb extension');
  });

  it('should handle non-existent notebook', async () => {
    const params: NotebookEditToolParams = {
      notebook_path: path.join(testDir, 'nonexistent.ipynb'),
      cell_id: 'cell-1',
      edit_mode: 'replace',
      new_source: 'test',
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should handle invalid JSON', async () => {
    const notebookPath = path.join(testDir, 'invalid.ipynb');
    await fs.writeFile(notebookPath, 'not valid json');

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_id: 'cell-1',
      edit_mode: 'replace',
      new_source: 'test',
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('parse notebook JSON');
  });

  it('should validate cell_id required for replace mode', async () => {
    const notebookPath = await createTestNotebook('test5.ipynb');

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      // No cell_id
      edit_mode: 'replace',
      new_source: 'test',
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('cell_id is required for replace mode');
  });

  it('should validate cell_type required for insert mode', async () => {
    const notebookPath = await createTestNotebook('test6.ipynb');

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      // No cell_type
      edit_mode: 'insert',
      new_source: 'test',
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('cell_type is required');
  });

  it('should handle non-existent cell_id for replace', async () => {
    const notebookPath = await createTestNotebook('test7.ipynb');

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_id: 'nonexistent',
      edit_mode: 'replace',
      new_source: 'test',
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should handle non-existent cell_id for delete', async () => {
    const notebookPath = await createTestNotebook('test8.ipynb');

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_id: 'nonexistent',
      edit_mode: 'delete',
      new_source: '',
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should change cell type when replacing', async () => {
    const notebookPath = await createTestNotebook('test9.ipynb');

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_id: 'cell-1',
      cell_type: 'markdown',
      edit_mode: 'replace',
      new_source: '# New Title',
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(true);

    // Verify cell type changed
    const notebook = await readNotebook(notebookPath);
    const cell = notebook.cells.find((c: any) => c.id === 'cell-1');
    expect(cell.cell_type).toBe('markdown');
    expect(cell.source.join('')).toContain('New Title');
  });

  it('should work via ToolRegistry', async () => {
    const notebookPath = await createTestNotebook('test10.ipynb');

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_id: 'cell-1',
      edit_mode: 'replace',
      new_source: 'registry test',
    };

    const result = await registry.executeTool('NotebookEdit', params);

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Replaced cell');
  });

  it('should handle abort signal', async () => {
    const notebookPath = await createTestNotebook('test11.ipynb');
    const controller = new AbortController();
    controller.abort();

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_id: 'cell-1',
      edit_mode: 'replace',
      new_source: 'test',
    };

    const result = await tool.execute(params, controller.signal);

    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled');
  });

  it('should include metadata in result', async () => {
    const notebookPath = await createTestNotebook('test12.ipynb');

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_id: 'cell-1',
      edit_mode: 'replace',
      new_source: 'metadata test',
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.notebookPath).toBe(notebookPath);
    expect(result.metadata!.editMode).toBe('replace');
    expect(result.metadata!.cellId).toBe('cell-1');
    expect(result.metadata!.cellCount).toBeGreaterThan(0);
    expect(result.metadata!.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('should report correct tool name', () => {
    expect(tool.name).toBe('NotebookEdit');
  });

  it('should handle multiline cell content', async () => {
    const notebookPath = await createTestNotebook('test13.ipynb');

    const multilineContent = `def hello():
    print("Hello")
    print("World")`;

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_id: 'cell-1',
      edit_mode: 'replace',
      new_source: multilineContent,
    };

    const result = await tool.execute(
      params,
      new AbortController().signal,
    );

    expect(result.success).toBe(true);

    // Verify multiline content preserved
    const notebook = await readNotebook(notebookPath);
    const cell = notebook.cells.find((c: any) => c.id === 'cell-1');
    const source = cell.source.join('');
    expect(source).toContain('def hello()');
    expect(source).toContain('print("Hello")');
    expect(source).toContain('print("World")');
  });

  it('should preserve notebook metadata', async () => {
    const notebookPath = await createTestNotebook('test14.ipynb');

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_id: 'cell-1',
      edit_mode: 'replace',
      new_source: 'test',
    };

    await tool.execute(params, new AbortController().signal);

    // Verify metadata preserved
    const notebook = await readNotebook(notebookPath);
    expect(notebook.metadata.kernelspec).toBeDefined();
    expect(notebook.metadata.kernelspec.name).toBe('python3');
    expect(notebook.nbformat).toBe(4);
  });

  it('should clear outputs when modifying code cell', async () => {
    const notebookPath = await createTestNotebook('test15.ipynb', [
      {
        cell_type: 'code',
        id: 'cell-1',
        metadata: {},
        source: ['print("Hello")'],
        outputs: [{ output_type: 'stream', text: ['Hello\n'] }],
        execution_count: 1,
      },
    ]);

    const params: NotebookEditToolParams = {
      notebook_path: notebookPath,
      cell_id: 'cell-1',
      edit_mode: 'replace',
      new_source: 'print("Modified")',
    };

    await tool.execute(params, new AbortController().signal);

    // Verify outputs cleared
    const notebook = await readNotebook(notebookPath);
    const cell = notebook.cells[0];
    expect(cell.outputs).toEqual([]);
    expect(cell.execution_count).toBeNull();
  });
});
