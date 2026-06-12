/**
 * Glob Tool Executor
 *
 * Finds files matching glob patterns with modification time sorting.
 * Fast pattern-based file discovery for large codebases.
 *
 * Adapted and simplified from Gemini CLI patterns
 * - Removed: FileDiscovery service, git-ignore filtering
 * - Kept: Core glob matching, modification time sorting, security
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import {
  makeRelative,
  shortenPath,
} from '../../utils/FileUtils.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

/**
 * Subset of 'Path' interface provided by 'glob' that we use
 */
export interface GlobPath {
  fullpath(): string;
  mtimeMs?: number;
}

/**
 * Parameters for the Glob tool
 */
export interface GlobToolParams {
  /**
   * The glob pattern to match files against
   */
  pattern: string;

  /**
   * The directory to search in (optional, defaults to working directory)
   */
  path?: string;

  /**
   * Whether the search should be case-sensitive (optional, defaults to false)
   */
  case_sensitive?: boolean;

  /**
   * Maximum number of files to return (optional, defaults to 100)
   * Set to -1 for unlimited (not recommended for large codebases)
   */
  limit?: number;

  /**
   * Number of files to skip (for pagination)
   * Use with limit to page through large result sets
   */
  offset?: number;
}

/**
 * Glob Tool Executor
 *
 * Features:
 * - Fast pattern matching (e.g., star-star-slash-star.ts, src-star-star-slash-star.js)
 * - Sorts results by modification time (newest first)
 * - Then alphabetically for older files
 * - Excludes node_modules and .git by default
 * - Path normalization and security
 */
export class GlobTool extends BaseTool<GlobToolParams, ToolResult> {
  // Recency threshold: 24 hours
  private readonly RECENCY_THRESHOLD_MS = 24 * 60 * 60 * 1000;
  // Default max results to prevent context overflow
  private static readonly DEFAULT_MAX_RESULTS = 100;

  constructor(private config: ExecutorConfig) {
    super(
      'Glob',
      'FindFiles',
      `Efficiently finds files matching specific glob patterns (e.g., \`src/**/*.ts\`, \`**/*.md\`), returning absolute paths sorted by modification time (newest first). Ideal for quickly locating files based on their name or path structure, especially in large codebases.`,
      {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description:
              "The glob pattern to match against (e.g., '**/*.py', 'docs/*.md'). Supports wildcards: * (matches any chars), ** (matches directories recursively), ? (matches single char), [...] (character ranges).",
          },
          path: {
            type: 'string',
            description:
              'Optional: The directory to search within. Can be absolute or relative to working directory. If omitted, searches the working directory.',
          },
          case_sensitive: {
            type: 'boolean',
            description:
              'Optional: Whether the search should be case-sensitive. Defaults to false (case-insensitive).',
          },
        },
        required: ['pattern'],
      },
    );
  }

  validateToolParams(params: GlobToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Validate pattern
    if (!params.pattern || typeof params.pattern !== 'string' || params.pattern.trim() === '') {
      return "The 'pattern' parameter cannot be empty.";
    }

    // Resolve search directory
    const searchDirAbsolute = path.resolve(
      this.config.workingDirectory,
      params.path || '.',
    );

    // Path validation: allow any absolute path (matching standard absolute-path behavior),
    // but reject root "/" to prevent full-filesystem scans that hang tool execution.
    if (!path.isAbsolute(searchDirAbsolute)) {
      return `Search path must resolve to an absolute path: ${searchDirAbsolute}`;
    }
    if (searchDirAbsolute === '/') {
      return `Searching from "/" would scan the entire filesystem. Use "." for the project directory or provide a specific path.`;
    }

    // Check directory exists
    try {
      if (!fs.existsSync(searchDirAbsolute)) {
        return `Search path does not exist: ${searchDirAbsolute}`;
      }
      if (!fs.statSync(searchDirAbsolute).isDirectory()) {
        return `Search path is not a directory: ${searchDirAbsolute}`;
      }
    } catch (error: any) {
      return `Error accessing search path: ${error.message}`;
    }

    return null;
  }

  getDescription(params: GlobToolParams): string {
    if (!params || !params.pattern) {
      return 'Find files';
    }

    let description = `'${params.pattern}'`;
    if (params.path) {
      const searchDir = path.resolve(this.config.workingDirectory, params.path || '.');
      const relativePath = makeRelative(searchDir, this.config.workingDirectory);
      description += ` in ${shortenPath(relativePath)}`;
    }
    return description;
  }

  async execute(
    params: GlobToolParams,
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
      const searchDirAbsolute = path.resolve(
        this.config.workingDirectory,
        params.path || '.',
      );

      // Execute glob search
      const entries = (await glob(params.pattern, {
        cwd: searchDirAbsolute,
        withFileTypes: true,
        nodir: true, // Only files, no directories
        stat: true, // Include file stats (for mtime)
        nocase: !(params.case_sensitive ?? true),
        dot: true, // Include dotfiles
        ignore: ['**/node_modules/**', '**/.git/**'], // Exclude common directories
        follow: false, // Don't follow symlinks
        signal,
      })) as GlobPath[];

      // Check if any files found
      if (!entries || entries.length === 0) {
        const message = `No files found matching pattern "${params.pattern}" within ${searchDirAbsolute}.`;
        return this.createSuccessResult(message, {
          executionTime: Date.now() - startTime,
          fileCount: 0,
        });
      }

      // Sort files by modification time
      const sortedEntries = this.sortFilesByRecency(entries);

      // Apply offset and limit for pagination
      const offset = params.offset || 0;
      const maxResults = params.limit === -1 ? Infinity : (params.limit || GlobTool.DEFAULT_MAX_RESULTS);
      const totalCount = sortedEntries.length;

      // Apply offset first, then limit
      const afterOffset = sortedEntries.slice(offset);
      const limitedEntries = afterOffset.slice(0, maxResults);
      const hasMore = offset + limitedEntries.length < totalCount;
      const remainingCount = totalCount - offset - limitedEntries.length;

      // Get absolute paths
      const sortedAbsolutePaths = limitedEntries.map((entry) => entry.fullpath());
      const fileListDescription = sortedAbsolutePaths.join('\n');
      const fileCount = sortedAbsolutePaths.length;

      // Format result message with clear pagination guidance for the model
      let resultMessage: string;
      if (offset > 0 || hasMore) {
        const rangeStart = offset + 1;
        const rangeEnd = offset + fileCount;
        resultMessage = `Found ${totalCount} file(s) matching "${params.pattern}" (showing ${rangeStart}-${rangeEnd}):\n${fileListDescription}`;

        if (hasMore) {
          const nextOffset = offset + fileCount;
          resultMessage += `\n\n[TRUNCATED] ${remainingCount} more files available. To see next page, call Glob again with offset=${nextOffset}`;
        }
      } else {
        resultMessage = `Found ${fileCount} file(s) matching "${params.pattern}" within ${searchDirAbsolute}, sorted by modification time (newest first):\n${fileListDescription}`;
      }

      // Stream output if callback provided
      if (updateOutput) {
        updateOutput(`Found ${fileCount} matching file(s)`);
      }

      return this.createSuccessResult(resultMessage, {
        executionTime: Date.now() - startTime,
        fileCount,
        totalCount,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + fileCount : undefined,
        searchPath: searchDirAbsolute,
        pattern: params.pattern,
      });
    } catch (error: any) {
      // Handle glob errors
      if (error.name === 'AbortError') {
        return this.createErrorResult('Glob search was aborted');
      }

      return this.createErrorResult(`Failed to perform glob search: ${error.message}`);
    }
  }

  /**
   * Sorts file entries based on recency and then alphabetically.
   * Recent files (modified within 24 hours) are listed first, newest to oldest.
   * Older files are listed after recent ones, sorted alphabetically by path.
   * @private
   */
  private sortFilesByRecency(entries: GlobPath[]): GlobPath[] {
    const nowTimestamp = Date.now();
    const sortedEntries = [...entries];

    sortedEntries.sort((a, b) => {
      const mtimeA = a.mtimeMs ?? 0;
      const mtimeB = b.mtimeMs ?? 0;
      const aIsRecent = nowTimestamp - mtimeA < this.RECENCY_THRESHOLD_MS;
      const bIsRecent = nowTimestamp - mtimeB < this.RECENCY_THRESHOLD_MS;

      // Both are recent: sort by mtime (newest first)
      if (aIsRecent && bIsRecent) {
        return mtimeB - mtimeA;
      }

      // Only A is recent: A comes first
      if (aIsRecent) {
        return -1;
      }

      // Only B is recent: B comes first
      if (bIsRecent) {
        return 1;
      }

      // Both are old: sort alphabetically
      return a.fullpath().localeCompare(b.fullpath());
    });

    return sortedEntries;
  }
}
