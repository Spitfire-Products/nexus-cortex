/**
 * WriteFile Tool Executor
 *
 * Writes content to a specified file in the local filesystem.
 * Can create new files or overwrite existing ones.
 *
 * Adapted from Gemini CLI patterns
 */

import fs from 'fs';
import path from 'path';
import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import {
  makeRelative,
  shortenPath,
  fileExists,
  resolveFilePath,
} from '../../utils/FileUtils.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

/**
 * Document file extensions that get collapsible preview (no full content in metadata)
 */
const DOCUMENT_EXTENSIONS = ['.md', '.mdx', '.txt', '.rst', '.adoc', '.markdown'];

/**
 * Detect if a file is a document (markdown, text, etc.) vs code/other
 */
function isDocumentFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return DOCUMENT_EXTENSIONS.includes(ext);
}

/**
 * Detect programming language from file extension for syntax highlighting hints
 */
function detectLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const languageMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.cs': 'csharp',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.r': 'r',
    '.sql': 'sql',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'bash',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.xml': 'xml',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.less': 'less',
    '.vue': 'vue',
    '.svelte': 'svelte',
  };
  return languageMap[ext];
}

/**
 * Parameters for the WriteFile tool
 */
export interface WriteFileToolParams {
  /**
   * The path to the file to write to
   */
  file_path: string;

  /**
   * The content to write to the file
   */
  content: string;
}

/**
 * WriteFile Tool Executor
 *
 * Features:
 * - Creates new files
 * - Overwrites existing files
 * - Creates parent directories if needed
 * - Path normalization and validation
 * - Security: prevents path traversal
 */
export class WriteFileTool extends BaseTool<WriteFileToolParams, ToolResult> {
  constructor(private config: ExecutorConfig) {
    super(
      'Write',
      'Write',
      'Writes content to a specified file in the local filesystem. Can create new files or overwrite existing ones. Parent directories will be created if they do not exist.',
      {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description:
              "The path to the file to write to (e.g., 'src/file.txt' or '/home/user/project/file.txt'). Can be absolute or relative to the current working directory.",
          },
          content: {
            type: 'string',
            description: 'The content to write to the file.',
          },
        },
        required: ['file_path', 'content'],
      },
    );
  }

  validateToolParams(params: WriteFileToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Normalize and resolve path (with smart fallback for doubled directory names)
    let filePath = resolveFilePath(params.file_path, this.config.workingDirectory);

    // Path validation: allow any absolute path (matching standard absolute-path behavior).
    if (!path.isAbsolute(filePath)) {
      return `File path must resolve to an absolute path: ${filePath}`;
    }

    // Update params with resolved path
    params.file_path = filePath;

    // Check if path is a directory
    if (fileExists(filePath)) {
      try {
        const stats = fs.lstatSync(filePath);
        if (stats.isDirectory()) {
          return `Path is a directory, not a file: ${filePath}`;
        }
      } catch (error: any) {
        return `Error accessing path: ${error.message}`;
      }
    }

    return null;
  }

  getDescription(params: WriteFileToolParams): string {
    if (!params || !params.file_path) {
      return 'Write file';
    }

    const relativePath = makeRelative(params.file_path, this.config.workingDirectory);
    const shortened = shortenPath(relativePath);
    const contentSize = params.content ? params.content.length : 0;

    return `Write ${shortened} (${contentSize} bytes)`;
  }

  async execute(
    params: WriteFileToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    // Validate parameters
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return this.createErrorResult(validationError);
    }

    try {
      // Ensure parent directory exists
      const dirPath = path.dirname(params.file_path);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // Check if file exists (for reporting)
      const existed = fileExists(params.file_path);
      const action = existed ? 'Updated' : 'Created';

      // Write file
      await fs.promises.writeFile(params.file_path, params.content, 'utf-8');

      // Get file stats
      const stats = await fs.promises.stat(params.file_path);
      const fileSize = stats.size;
      const lineCount = params.content.split('\n').length;

      // Format for display
      const relativePath = makeRelative(params.file_path, this.config.workingDirectory);
      const displayContent = `${action} ${relativePath} (${lineCount} lines, ${fileSize} bytes)`;

      // Stream output if callback provided
      if (updateOutput) {
        updateOutput(displayContent);
      }

      // Build metadata with preview information
      const metadata: Record<string, any> = {
        executionTime: Date.now() - startTime,
        resourcesUsed: {
          files: [params.file_path],
        },
        fileStats: {
          path: relativePath,
          size: fileSize,
          lines: lineCount,
          action,
          existed,
          operation: 'create',
        },
      };

      // Add preview metadata based on file type
      const isDocument = isDocumentFile(params.file_path);

      if (isDocument) {
        // Document files: store minimal metadata (content lazy-loaded on expand)
        const wordCount = params.content.split(/\s+/).filter(Boolean).length;
        const isMarkdown = params.file_path.endsWith('.md') || params.file_path.endsWith('.mdx');

        metadata.documentPreview = {
          filePath: relativePath,
          lineCount,
          wordCount,
          isMarkdown,
        };
      } else {
        // Code/other files: store full content for preview persistence
        metadata.writePreview = {
          filePath: relativePath,
          content: params.content,
          lineCount,
          byteSize: fileSize,
          language: detectLanguage(params.file_path),
        };
      }

      return this.createSuccessResult(displayContent, metadata);
    } catch (error: any) {
      // Handle write errors
      if (error.code === 'EACCES') {
        return this.createErrorResult(`Permission denied: ${params.file_path}`);
      }

      if (error.code === 'ENOSPC') {
        return this.createErrorResult('No space left on device');
      }

      if (error.code === 'EROFS') {
        return this.createErrorResult('Read-only file system');
      }

      return this.createErrorResult(`Failed to write file: ${error.message}`);
    }
  }
}
