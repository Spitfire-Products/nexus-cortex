/**
 * ReadFile Tool Executor
 *
 * Reads and returns the content of a specified file from the local filesystem.
 * Handles text files with optional line range support and automatic truncation.
 *
 * Adapted from Gemini CLI patterns
 */

import path from 'path';
import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import {
  makeRelative,
  shortenPath,
  readFileContent,
  fileExists,
  getFileStats,
  formatFileSize,
  resolveFilePath,
} from '../../utils/FileUtils.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import { FileReadTracker } from './EditTool.js';

// Constants for truncation (aligned with Gemini CLI)
const DEFAULT_MAX_LINES = 2000;
const MAX_LINE_LENGTH = 2000;

/**
 * Parameters for the ReadFile tool
 */
export interface ReadFileToolParams {
  /**
   * The absolute or relative path to the file to read
   */
  file_path: string;

  /**
   * The line number to start reading from (optional, 0-based)
   */
  offset?: number;

  /**
   * The number of lines to read (optional)
   */
  limit?: number;
}

/**
 * ReadFile Tool Executor
 *
 * Features:
 * - Reads text files
 * - Supports line range (offset + limit)
 * - Path normalization and validation
 * - Security: prevents path traversal
 */
export class ReadFileTool extends BaseTool<ReadFileToolParams, ToolResult> {
  constructor(private config: ExecutorConfig) {
    super(
      'Read',
      'Read',
      `Reads and returns the content of a specified file from the local filesystem.

If the file is large, the content will be automatically truncated to ${DEFAULT_MAX_LINES} lines.
The response will clearly indicate if truncation occurred and provide guidance on reading more content using 'offset' and 'limit' parameters.
Individual lines longer than ${MAX_LINE_LENGTH} characters will also be truncated.`,
      {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description:
              "The path to the file to read (e.g., 'src/file.txt' or '/home/user/project/file.txt'). Can be absolute or relative to the current working directory.",
          },
          offset: {
            type: 'number',
            description:
              "Optional: For text files, the 0-based line number to start reading from. Use for paginating through large files. Defaults to 0.",
          },
          limit: {
            type: 'number',
            description:
              `Optional: For text files, maximum number of lines to read. Use with 'offset' to paginate through large files. Defaults to ${DEFAULT_MAX_LINES}.`,
          },
        },
        required: ['file_path'],
      },
    );
  }

  validateToolParams(params: ReadFileToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Capture whether the model supplied a relative path BEFORE resolution.
    // Absolute paths are allowed anywhere (matching standard absolute-path behavior);
    // relative paths must stay within workingDirectory so a model can't
    // escape via `../`-traversal.
    const wasRelative = !path.isAbsolute(params.file_path);

    // Normalize and resolve path (with smart fallback for doubled directory names)
    let filePath = resolveFilePath(params.file_path, this.config.workingDirectory);

    if (!path.isAbsolute(filePath)) {
      return `File path must resolve to an absolute path: ${filePath}`;
    }

    // Containment check for originally-relative paths. Without this guard,
    // `../outside.txt` resolves to a path outside workingDirectory and is
    // happily read — which is a real security regression caught by bench
    // 6's canary test. (Deficiency #15, fixed 2026-05-11.)
    if (wasRelative && this.config.workingDirectory) {
      const wd = path.resolve(this.config.workingDirectory);
      const relative = path.relative(wd, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return `Path must be within the working directory: ${params.file_path}`;
      }
    }

    // Update params with resolved path
    params.file_path = filePath;

    // Validate offset and limit
    if (params.offset !== undefined && params.offset < 0) {
      return 'Offset must be a non-negative number';
    }

    if (params.limit !== undefined && params.limit <= 0) {
      return 'Limit must be a positive number';
    }

    // Check file exists (after security check)
    if (!fileExists(filePath)) {
      return `File not found: ${filePath}`;
    }

    return null;
  }

  getDescription(params: ReadFileToolParams): string {
    if (!params || !params.file_path) {
      return 'Read file';
    }

    const relativePath = makeRelative(params.file_path, this.config.workingDirectory);
    const shortened = shortenPath(relativePath);

    if (params.offset !== undefined || params.limit !== undefined) {
      const offset = params.offset || 0;
      const limit = params.limit || '∞';
      return `Read ${shortened} (lines ${offset}-${offset + Number(limit)})`;
    }

    return `Read ${shortened}`;
  }

  async execute(
    params: ReadFileToolParams,
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
      // Read full file content
      let rawContent = await readFileContent(params.file_path);
      const allLines = rawContent.split('\n');
      const originalLineCount = allLines.length;

      // Get file stats
      const stats = await getFileStats(params.file_path);
      const fileSize = formatFileSize(stats.size);

      // Determine effective line range
      const startLine = params.offset || 0;
      const effectiveLimit = params.limit || DEFAULT_MAX_LINES;
      const endLine = Math.min(startLine + effectiveLimit, originalLineCount);

      // Extract requested lines
      const selectedLines = allLines.slice(startLine, endLine);

      // Truncate long lines, then prefix the ABSOLUTE file line number in
      // `cat -n` form (`<line_number>\t<content>`), honoring this tool's
      // documented contract. Line numbers are offset-correct (startLine is
      // 0-based; +1 → 1-based, matching the truncation-warning display).
      // This is the grounding substrate citations/Stage-3 verify against —
      // and the thing a model needs to NOT confabulate line numbers.
      let linesWereTruncatedInLength = false;
      const formattedLines = selectedLines.map((line, idx) => {
        let body = line;
        if (line.length > MAX_LINE_LENGTH) {
          linesWereTruncatedInLength = true;
          body = line.substring(0, MAX_LINE_LENGTH) + '... [line truncated]';
        }
        const lineNo = startLine + idx + 1;
        return `${String(lineNo).padStart(6)}\t${body}`;
      });

      // Determine if content was truncated
      const contentRangeTruncated = startLine > 0 || endLine < originalLineCount;
      const isTruncated = contentRangeTruncated || linesWereTruncatedInLength;

      // Build final content
      let content = formattedLines.join('\n');

      // Add truncation warning if applicable
      if (isTruncated) {
        const nextOffset = endLine;
        const truncationWarning = `
IMPORTANT: The file content has been truncated.
Status: Showing lines ${startLine + 1}-${endLine} of ${originalLineCount} total lines.
Action: To read more of the file, use the 'offset' and 'limit' parameters. For example, to read the next section, use offset: ${nextOffset}.

--- FILE CONTENT (truncated) ---
`;
        content = truncationWarning + content;
      }

      // Format for display
      const relativePath = makeRelative(params.file_path, this.config.workingDirectory);
      const displayContent = this.formatContentForDisplay(
        content,
        relativePath,
        isTruncated ? endLine - startLine : originalLineCount,
        fileSize,
        isTruncated,
      );

      // Stream output if callback provided
      if (updateOutput) {
        updateOutput(displayContent);
      }

      // Mark file as read in session (enables edit-after-read protocol)
      // Track the line range that was read for smart re-read suggestions
      // Pass the section content for fingerprinting (enables content-based freshness detection)
      const sectionContent = selectedLines.join('\n');
      FileReadTracker.markAsRead(params.file_path, startLine, endLine, sectionContent);

      // #10 mitigation — prepend a verbatim-transcription reminder. When the
      // model subsequently feeds this content into Write/Edit, the
      // <system-reminder> block reduces the risk of confabulation (e.g.
      // rewriting `const X = {...} as const` as `enum X { ... }`). Models
      // filter <system-reminder> blocks from "quote verbatim" contexts so
      // this won't pollute legitimate exact-copy operations.
      const VERBATIM_REMINDER =
        '<system-reminder>When using this file content for a subsequent Write or Edit, ' +
        'transcribe it verbatim. Do not paraphrase, reword, or convert between declaration forms ' +
        '(e.g. `const X = {...} as const` vs `enum X { ... }`, arrow function vs function declaration). ' +
        'Only modify what the user explicitly requested.</system-reminder>\n\n';
      const contentWithReminder = VERBATIM_REMINDER + content;

      return this.createSuccessResult(contentWithReminder, {
        executionTime: Date.now() - startTime,
        resourcesUsed: {
          files: [params.file_path],
        },
        fileStats: {
          path: relativePath,
          size: stats.size,
          sizeFormatted: fileSize,
          lines: isTruncated ? endLine - startLine : originalLineCount,
          originalLines: originalLineCount,
          truncated: isTruncated,
          linesShown: isTruncated ? [startLine + 1, endLine] : undefined,
        },
      });
    } catch (error: any) {
      // Handle read errors
      if (error.code === 'ENOENT') {
        return this.createErrorResult(`File not found: ${params.file_path}`);
      }

      if (error.code === 'EACCES') {
        return this.createErrorResult(`Permission denied: ${params.file_path}`);
      }

      if (error.code === 'EISDIR') {
        return this.createErrorResult(`Path is a directory, not a file: ${params.file_path}`);
      }

      return this.createErrorResult(`Failed to read file: ${error.message}`);
    }
  }

  /**
   * Format content for display
   * @private
   */
  private formatContentForDisplay(
    content: string,
    relativePath: string,
    lineCount: number,
    fileSize: string,
    isTruncated: boolean = false,
  ): string {
    const truncatedLabel = isTruncated ? ' [TRUNCATED]' : '';
    const header = `# ${relativePath} (${lineCount} lines, ${fileSize})${truncatedLabel}`;
    return `${header}\n\n${content}`;
  }
}
