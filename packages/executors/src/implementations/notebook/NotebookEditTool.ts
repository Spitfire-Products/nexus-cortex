/**
 * NotebookEdit Tool Executor
 *
 * Edit Jupyter notebook cells - supports replace, insert, and delete operations.
 * Works with .ipynb files (JSON format).
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Edit mode for notebook cell operations
 */
export type NotebookEditMode = 'replace' | 'insert' | 'delete';

/**
 * Cell type in Jupyter notebooks
 */
export type NotebookCellType = 'code' | 'markdown';

/**
 * Parameters for the NotebookEdit tool
 */
export interface NotebookEditToolParams {
  /**
   * Absolute path to the Jupyter notebook file
   */
  notebook_path: string;

  /**
   * ID of the cell to edit (optional for insert at end)
   */
  cell_id?: string;

  /**
   * Type of the cell (code or markdown)
   */
  cell_type?: NotebookCellType;

  /**
   * Edit operation: replace, insert, delete
   */
  edit_mode?: NotebookEditMode;

  /**
   * New source content for the cell
   */
  new_source: string;
}

/**
 * Jupyter notebook cell structure
 */
interface NotebookCell {
  cell_type: string;
  id?: string;
  metadata: Record<string, any>;
  source: string | string[];
  outputs?: any[];
  execution_count?: number | null;
}

/**
 * Jupyter notebook structure
 */
interface NotebookDocument {
  cells: NotebookCell[];
  metadata: Record<string, any>;
  nbformat: number;
  nbformat_minor: number;
}

/**
 * NotebookEdit Tool Executor
 *
 * Features:
 * - Read and parse .ipynb JSON files
 * - Replace cell content by cell_id
 * - Insert new cells at specific positions
 * - Delete cells by cell_id
 * - Preserve notebook metadata and structure
 */
export class NotebookEditTool extends BaseTool<
  NotebookEditToolParams,
  ToolResult
> {
  constructor(private config: ExecutorConfig) {
    super(
      'NotebookEdit',
      'NotebookEdit',
      `Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.`,
      {
        type: 'object',
        properties: {
          notebook_path: {
            type: 'string',
            description:
              'The absolute path to the Jupyter notebook file to edit (must be absolute, not relative)',
          },
          cell_id: {
            type: 'string',
            description:
              'The ID of the cell to edit. When inserting a new cell, the new cell will be inserted after the cell with this ID, or at the beginning if not specified.',
          },
          cell_type: {
            type: 'string',
            enum: ['code', 'markdown'],
            description:
              'The type of the cell (code or markdown). If not specified, it defaults to the current cell type. If using edit_mode=insert, this is required.',
          },
          edit_mode: {
            type: 'string',
            enum: ['replace', 'insert', 'delete'],
            description:
              'The type of edit to make (replace, insert, delete). Defaults to replace.',
          },
          new_source: {
            type: 'string',
            description: 'The new source for the cell',
          },
        },
        required: ['notebook_path', 'new_source'],
      },
    );
  }

  validateToolParams(params: NotebookEditToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Validate notebook path
    if (!params.notebook_path || !params.notebook_path.trim()) {
      return 'Notebook path cannot be empty.';
    }

    // Ensure absolute path
    if (!path.isAbsolute(params.notebook_path)) {
      return 'Notebook path must be absolute, not relative.';
    }

    // Validate file extension
    if (!params.notebook_path.endsWith('.ipynb')) {
      return 'Notebook path must end with .ipynb extension.';
    }

    // Validate edit_mode
    const editMode = params.edit_mode || 'replace';
    if (!['replace', 'insert', 'delete'].includes(editMode)) {
      return `Invalid edit_mode: ${editMode}. Must be 'replace', 'insert', or 'delete'.`;
    }

    // Validate cell_type
    if (params.cell_type && !['code', 'markdown'].includes(params.cell_type)) {
      return `Invalid cell_type: ${params.cell_type}. Must be 'code' or 'markdown'.`;
    }

    // For insert mode, cell_type is required
    if (editMode === 'insert' && !params.cell_type) {
      return 'cell_type is required when edit_mode is "insert".';
    }

    // For delete mode, new_source should be empty or ignored
    if (editMode === 'delete' && params.new_source.trim().length > 0) {
      return 'new_source should be empty when edit_mode is "delete".';
    }

    return null;
  }

  getDescription(params: NotebookEditToolParams): string {
    const mode = params.edit_mode || 'replace';
    const cellId = params.cell_id || 'new cell';
    return `${mode} cell ${cellId} in ${path.basename(params.notebook_path)}`;
  }

  async execute(
    params: NotebookEditToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Notebook edit was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Validate parameters
      const validationError = this.validateToolParams(params);
      if (validationError) {
        return {
          ...this.createErrorResult(validationError),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Resolve absolute path
      const notebookPath = path.resolve(params.notebook_path);

      // Check if file exists
      let notebookExists = false;
      try {
        await fs.access(notebookPath);
        notebookExists = true;
      } catch {
        notebookExists = false;
      }

      if (!notebookExists) {
        return {
          ...this.createErrorResult(
            `Notebook file not found: ${notebookPath}`,
          ),
          metadata: {
            executionTime: Date.now() - startTime,
            notebookPath,
          },
        };
      }

      // Read and parse notebook
      const notebookContent = await fs.readFile(notebookPath, 'utf-8');
      let notebook: NotebookDocument;

      try {
        notebook = JSON.parse(notebookContent);
      } catch (parseError: any) {
        return {
          ...this.createErrorResult(
            `Failed to parse notebook JSON: ${parseError.message}`,
          ),
          metadata: {
            executionTime: Date.now() - startTime,
            notebookPath,
          },
        };
      }

      // Validate notebook structure
      if (!notebook.cells || !Array.isArray(notebook.cells)) {
        return {
          ...this.createErrorResult(
            'Invalid notebook structure: missing or invalid cells array',
          ),
          metadata: {
            executionTime: Date.now() - startTime,
            notebookPath,
          },
        };
      }

      // Perform edit operation
      const editMode = params.edit_mode || 'replace';
      const editResult = await this.performEdit(
        notebook,
        params,
        editMode,
        signal,
      );

      if (!editResult.success) {
        return {
          ...this.createErrorResult(editResult.error || 'Edit operation failed'),
          metadata: {
            executionTime: Date.now() - startTime,
            notebookPath,
            cellCount: notebook.cells.length,
          },
        };
      }

      // Write modified notebook back to file
      const modifiedContent = JSON.stringify(notebook, null, 2);
      await fs.writeFile(notebookPath, modifiedContent, 'utf-8');

      // Format success message
      const message = this.formatSuccessMessage(params, editMode, notebook);

      return {
        ...this.createSuccessResult(message),
        metadata: {
          executionTime: Date.now() - startTime,
          notebookPath,
          editMode,
          cellId: params.cell_id,
          cellType: params.cell_type,
          cellCount: notebook.cells.length,
        },
      };
    } catch (error: any) {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Notebook edit was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      const errorMessage = error.message || String(error);
      return {
        ...this.createErrorResult(`Error editing notebook: ${errorMessage}`),
        metadata: {
          executionTime: Date.now() - startTime,
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Perform the edit operation on the notebook
   */
  private async performEdit(
    notebook: NotebookDocument,
    params: NotebookEditToolParams,
    editMode: NotebookEditMode,
    signal: AbortSignal,
  ): Promise<{ success: boolean; error?: string }> {
    if (signal.aborted) {
      return { success: false, error: 'Operation cancelled' };
    }

    switch (editMode) {
      case 'replace':
        return this.replaceCell(notebook, params);
      case 'insert':
        return this.insertCell(notebook, params);
      case 'delete':
        return this.deleteCell(notebook, params);
      default:
        return { success: false, error: `Unknown edit mode: ${editMode}` };
    }
  }

  /**
   * Get the cell ID from a cell (checks both cell.id and cell.metadata.id)
   * Jupyter notebooks may store cell IDs in either location
   */
  private getCellId(cell: NotebookCell): string | undefined {
    return cell.id || cell.metadata?.id;
  }

  /**
   * Find a cell by ID (checks both cell.id and cell.metadata.id)
   */
  private findCellIndex(notebook: NotebookDocument, cellId: string): number {
    return notebook.cells.findIndex((c) => this.getCellId(c) === cellId);
  }

  /**
   * Replace an existing cell's content
   */
  private replaceCell(
    notebook: NotebookDocument,
    params: NotebookEditToolParams,
  ): { success: boolean; error?: string } {
    if (!params.cell_id) {
      return {
        success: false,
        error: 'cell_id is required for replace mode',
      };
    }

    const cellIndex = this.findCellIndex(notebook, params.cell_id);
    if (cellIndex === -1) {
      // Provide helpful error with available cell IDs
      const availableIds = notebook.cells
        .map((c, i) => this.getCellId(c) || `[index ${i}]`)
        .join(', ');
      return {
        success: false,
        error: `Cell with id "${params.cell_id}" not found. Available cell IDs: ${availableIds}`,
      };
    }

    const cell = notebook.cells[cellIndex];
    if (!cell) {
      return { success: false, error: 'Cell is undefined' };
    }

    // Update cell content
    cell.source = this.normalizeSource(params.new_source);

    // Update cell type if provided
    if (params.cell_type) {
      cell.cell_type = params.cell_type;
    }

    // Clear outputs for code cells
    if (cell.cell_type === 'code') {
      cell.outputs = [];
      cell.execution_count = null;
    }

    return { success: true };
  }

  /**
   * Insert a new cell
   */
  private insertCell(
    notebook: NotebookDocument,
    params: NotebookEditToolParams,
  ): { success: boolean; error?: string } {
    if (!params.cell_type) {
      return {
        success: false,
        error: 'cell_type is required for insert mode',
      };
    }

    // Create new cell
    const newCell: NotebookCell = {
      cell_type: params.cell_type,
      id: this.generateCellId(),
      metadata: {},
      source: this.normalizeSource(params.new_source),
    };

    // Add code cell specific fields
    if (params.cell_type === 'code') {
      newCell.outputs = [];
      newCell.execution_count = null;
    }

    // Find insertion position
    let insertIndex = notebook.cells.length; // Default: append to end

    if (params.cell_id) {
      const refIndex = this.findCellIndex(notebook, params.cell_id);
      if (refIndex === -1) {
        // Provide helpful error with available cell IDs
        const availableIds = notebook.cells
          .map((c, i) => this.getCellId(c) || `[index ${i}]`)
          .join(', ');
        return {
          success: false,
          error: `Reference cell with id "${params.cell_id}" not found. Available cell IDs: ${availableIds}`,
        };
      }
      insertIndex = refIndex + 1; // Insert after reference cell
    }

    // Insert the new cell
    notebook.cells.splice(insertIndex, 0, newCell);

    return { success: true };
  }

  /**
   * Delete a cell
   */
  private deleteCell(
    notebook: NotebookDocument,
    params: NotebookEditToolParams,
  ): { success: boolean; error?: string } {
    if (!params.cell_id) {
      return { success: false, error: 'cell_id is required for delete mode' };
    }

    const cellIndex = this.findCellIndex(notebook, params.cell_id);
    if (cellIndex === -1) {
      // Provide helpful error with available cell IDs
      const availableIds = notebook.cells
        .map((c, i) => this.getCellId(c) || `[index ${i}]`)
        .join(', ');
      return {
        success: false,
        error: `Cell with id "${params.cell_id}" not found. Available cell IDs: ${availableIds}`,
      };
    }

    // Remove the cell
    notebook.cells.splice(cellIndex, 1);

    return { success: true };
  }

  /**
   * Normalize source content to array of lines
   */
  private normalizeSource(source: string): string[] {
    // Split into lines, preserving newlines
    const lines = source.split('\n');
    return lines.map((line, i) =>
      i < lines.length - 1 ? line + '\n' : line,
    );
  }

  /**
   * Generate a unique cell ID
   */
  private generateCellId(): string {
    // Generate a simple unique ID (8 random hex characters)
    return Math.random().toString(16).substring(2, 10);
  }

  /**
   * Format success message
   */
  private formatSuccessMessage(
    params: NotebookEditToolParams,
    editMode: NotebookEditMode,
    notebook: NotebookDocument,
  ): string {
    const lines: string[] = [];
    const filename = path.basename(params.notebook_path);

    lines.push('=== Notebook Edit Successful ===\n\n');

    switch (editMode) {
      case 'replace':
        lines.push(`Replaced cell "${params.cell_id}" in ${filename}\n`);
        lines.push(`Cell type: ${params.cell_type || 'unchanged'}\n`);
        break;
      case 'insert':
        lines.push(`Inserted new ${params.cell_type} cell in ${filename}\n`);
        if (params.cell_id) {
          lines.push(`Position: after cell "${params.cell_id}"\n`);
        } else {
          lines.push(`Position: at the end\n`);
        }
        break;
      case 'delete':
        lines.push(`Deleted cell "${params.cell_id}" from ${filename}\n`);
        break;
    }

    lines.push(`\nTotal cells: ${notebook.cells.length}\n`);

    return lines.join('');
  }
}
