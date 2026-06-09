/**
 * Enhanced Grep Tool Executor with Native Command Support
 *
 * Implements a 4-tier fallback strategy for optimal performance:
 * 1. ripgrep (rg)       -  Fastest (0.5-1s)
 * 2. git grep           - ⚡ Fast (1-2s, git repos only)
 * 3. system grep        -  Good (2-5s)
 * 4. JavaScript fallback -  Portable (5-10s)
 *
 * Gracefully falls back if native commands are not available.
 */

import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import { EOL } from 'os';
import { spawn } from 'child_process';
import { globStream } from 'glob';
import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import {
  makeRelative,
  shortenPath,
} from '../../utils/FileUtils.js';
import { isGitRepository } from '../../utils/GitUtils.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

/**
 * Parameters for the Grep tool
 * Matches the tool definition in toolDefinitions.ts
 */
export interface GrepToolParams {
  pattern: string;
  path?: string;
  glob?: string;           // Glob pattern to filter files (e.g., "*.js", "*.{ts,tsx}")
  output_mode?: 'content' | 'files_with_matches' | 'count';
  '-A'?: number;           // Lines after match
  '-B'?: number;           // Lines before match
  '-C'?: number;           // Lines of context (before and after)
  '-n'?: boolean;          // Show line numbers
  '-i'?: boolean;          // Case insensitive
  type?: string;           // File type (rg --type)
  head_limit?: number;     // Limit output to first N entries (default: 100)
  offset?: number;         // Skip first N entries (for pagination)
  multiline?: boolean;     // Enable multiline mode
  // Legacy support
  include?: string;        // Alias for glob
  case_sensitive?: boolean; // Inverse of -i
}

/**
 * Result object for a single grep match
 */
interface GrepMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

/**
 * Enhanced Grep Tool with Native Command Support
 */
export class GrepTool extends BaseTool<GrepToolParams, ToolResult> {
  private static readonly DEFAULT_MAX_RESULTS = 100;  // Default limit for context efficiency
  private static readonly HARD_MAX_RESULTS = 500;     // Absolute maximum to prevent context overflow
  private static readonly MAX_CONTENT_LENGTH = 30000; // ~30KB max output
  // JS-fallback only: skip files above this size. Reading them into a single string
  // throws "Invalid string length" once they exceed V8's ~512MB cap (e.g. the grok
  // CLI's .grok/upload_queue git-diff blobs), and grepping a huge minified/blob file
  // is never useful anyway. rg/grep handle large files natively; this guards Strategy 4.
  private static readonly MAX_SEARCHABLE_FILE_BYTES = 20 * 1024 * 1024; // 20MB

  constructor(private config: ExecutorConfig) {
    super(
      'Grep',
      'SearchText',
      `Searches for a regular expression pattern within the content of files. Uses ripgrep, git grep, or system grep for optimal performance, with automatic fallback to JavaScript implementation.`,
      {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description:
              "The regular expression pattern to search for (e.g., 'function\\\\s+myFunction').",
          },
          path: {
            type: 'string',
            description:
              'Optional: File or directory to search within. For single-file searches, provide exact file path. For directory searches, all files will be scanned. Defaults to working directory.',
          },
          include: {
            type: 'string',
            description:
              "Optional: Glob pattern to filter files (e.g., '*.js', '**/*.{ts,tsx}').",
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Optional: Case-sensitive search. Defaults to false.',
          },
        },
        required: ['pattern'],
      },
    );
  }

  validateToolParams(params: GrepToolParams): string | null {
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Validate regex pattern
    try {
      new RegExp(params.pattern);
    } catch (error: any) {
      return `Invalid regular expression: ${params.pattern}. Error: ${error.message}`;
    }

    // Validate path (can be file or directory)
    const searchPathAbsolute = path.resolve(
      this.config.workingDirectory,
      params.path || '.',
    );

    // Path validation: allow any absolute path (matching standard absolute-path behavior),
    // but reject root "/" to prevent full-filesystem scans that hang tool execution.
    if (!path.isAbsolute(searchPathAbsolute)) {
      return `Search path must resolve to an absolute path: ${searchPathAbsolute}`;
    }
    if (searchPathAbsolute === '/') {
      return `Searching from "/" would scan the entire filesystem. Use "." for the project directory or provide a specific path.`;
    }

    try {
      if (!fsSync.existsSync(searchPathAbsolute)) {
        return `Search path does not exist: ${searchPathAbsolute}`;
      }
      // Accept both files and directories
      const stats = fsSync.statSync(searchPathAbsolute);
      if (!stats.isFile() && !stats.isDirectory()) {
        return `Search path must be a file or directory: ${searchPathAbsolute}`;
      }
    } catch (error: any) {
      return `Error accessing search path: ${error.message}`;
    }

    return null;
  }

  getDescription(params: GrepToolParams): string {
    if (!params?.pattern) return 'Search file content';

    let desc = `'${params.pattern}'`;
    const globPattern = params.glob || params.include;
    if (globPattern) desc += ` in ${globPattern}`;
    if (params.path) {
      const resolved = path.resolve(this.config.workingDirectory, params.path);
      const relative = makeRelative(resolved, this.config.workingDirectory);
      desc += ` within ${shortenPath(relative)}`;
    }
    if (params.output_mode) desc += ` (${params.output_mode})`;
    return desc;
  }

  async execute(
    params: GrepToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    const validationError = this.validateToolParams(params);
    if (validationError) {
      return this.createErrorResult(validationError);
    }

    try {
      const searchPathAbsolute = path.resolve(
        this.config.workingDirectory,
        params.path || '.',
      );
      const searchPathDisplay = params.path || '.';

      // Normalize parameters (handle both new and legacy param names)
      const globPattern = params.glob || params.include;
      const caseInsensitive = params['-i'] ?? (params.case_sensitive === undefined ? false : !params.case_sensitive);
      const outputMode = params.output_mode || 'files_with_matches'; // Default to files_with_matches for efficiency
      // Apply default limit if not specified (prevents context overflow)
      const headLimit = params.head_limit ?? GrepTool.DEFAULT_MAX_RESULTS;
      const effectiveLimit = Math.min(headLimit, GrepTool.HARD_MAX_RESULTS);
      const offset = params.offset ?? 0; // Pagination offset
      const contextAfter = params['-A'];
      const contextBefore = params['-B'];
      const contextBoth = params['-C'];
      const showLineNumbers = params['-n'] ?? true;
      const fileType = params.type;
      const multiline = params.multiline;

      // Check if path is a file or directory
      const stats = fsSync.statSync(searchPathAbsolute);
      const isFile = stats.isFile();

      // For single file searches, extract directory and filename
      let searchDir: string;
      let targetFile: string | undefined;

      if (isFile) {
        searchDir = path.dirname(searchPathAbsolute);
        targetFile = path.basename(searchPathAbsolute);
      } else {
        searchDir = searchPathAbsolute;
        targetFile = undefined;
      }

      // Perform search with fallback strategies
      // Pass effectiveLimit to enable early termination in native commands
      const { matches, strategy } = await this.performGrepSearch(
        params.pattern,
        searchDir,
        globPattern,
        !caseInsensitive, // performGrepSearch expects caseSensitive, we have caseInsensitive
        signal,
        targetFile,
        fileType,
        multiline,
        contextAfter,
        contextBefore,
        contextBoth,
        effectiveLimit, // Enable early termination in ripgrep with -m flag
      );

      if (matches.length === 0) {
        const message = `No matches found for pattern "${params.pattern}" in "${searchPathDisplay}"${globPattern ? ` (filter: "${globPattern}")` : ''}.`;
        if (updateOutput) updateOutput('No matches found');
        return this.createSuccessResult(message, {
          executionTime: Date.now() - startTime,
          matchCount: 0,
          searchPath: searchPathAbsolute,
          pattern: params.pattern,
          strategy,
          output_mode: outputMode,
        });
      }

      // Apply offset and limit for pagination (already limited at source for ripgrep, but ensure hard cap)
      const totalMatches = matches.length;
      const afterOffset = matches.slice(offset);
      const limitedMatches = afterOffset.slice(0, effectiveLimit);
      const hasMore = offset + limitedMatches.length < totalMatches;
      const remainingCount = totalMatches - offset - limitedMatches.length;

      // Format results based on output_mode
      let llmContent: string;
      let matchCount: number;

      if (outputMode === 'files_with_matches') {
        // Return only unique file paths
        const uniqueFiles = [...new Set(limitedMatches.map(m => m.filePath))];
        matchCount = uniqueFiles.length;
        const displayFiles = uniqueFiles.slice(0, GrepTool.HARD_MAX_RESULTS);

        // Build result message with pagination guidance
        if (offset > 0 || hasMore) {
          const rangeStart = offset + 1;
          const rangeEnd = offset + limitedMatches.length;
          llmContent = `Found ${totalMatches} matches in files for "${params.pattern}" (showing matches ${rangeStart}-${rangeEnd})${globPattern ? ` (filter: "${globPattern}")` : ''}:\n`;
        } else {
          llmContent = `Found ${totalMatches} matches in ${uniqueFiles.length} files for "${params.pattern}"${globPattern ? ` (filter: "${globPattern}")` : ''}:\n`;
        }
        llmContent += displayFiles.join('\n');

        if (hasMore) {
          const nextOffset = offset + limitedMatches.length;
          llmContent += `\n\n[TRUNCATED] ${remainingCount} more matches available. To see next page, call grep again with offset=${nextOffset}`;
        }

        if (updateOutput) updateOutput(`Found ${uniqueFiles.length} files`);

        return this.createSuccessResult(llmContent, {
          executionTime: Date.now() - startTime,
          matchCount: totalMatches,
          fileCount: uniqueFiles.length,
          searchPath: searchPathAbsolute,
          pattern: params.pattern,
          strategy,
          output_mode: outputMode,
          offset,
          hasMore,
          nextOffset: hasMore ? offset + limitedMatches.length : undefined,
        });
      } else if (outputMode === 'count') {
        // Return match counts per file
        const countsByFile: Record<string, number> = {};
        for (const match of limitedMatches) {
          countsByFile[match.filePath] = (countsByFile[match.filePath] || 0) + 1;
        }

        const fileEntries = Object.entries(countsByFile);
        matchCount = fileEntries.length;
        const displayEntries = fileEntries.slice(0, GrepTool.HARD_MAX_RESULTS);

        // Build result message with pagination guidance
        if (offset > 0 || hasMore) {
          const rangeStart = offset + 1;
          const rangeEnd = offset + limitedMatches.length;
          llmContent = `Found ${totalMatches} matches for "${params.pattern}" (showing matches ${rangeStart}-${rangeEnd})${globPattern ? ` (filter: "${globPattern}")` : ''}:\n`;
        } else {
          llmContent = `Found ${totalMatches} matches in ${fileEntries.length} files for "${params.pattern}"${globPattern ? ` (filter: "${globPattern}")` : ''}:\n`;
        }

        for (const [file, count] of displayEntries) {
          llmContent += `${file}: ${count}\n`;
        }

        if (hasMore) {
          const nextOffset = offset + limitedMatches.length;
          llmContent += `\n[TRUNCATED] ${remainingCount} more matches available. To see next page, call grep again with offset=${nextOffset}`;
        }

        if (updateOutput) updateOutput(`Found ${totalMatches} matches in ${fileEntries.length} files`);

        return this.createSuccessResult(llmContent, {
          executionTime: Date.now() - startTime,
          matchCount: totalMatches,
          fileCount: fileEntries.length,
          searchPath: searchPathAbsolute,
          pattern: params.pattern,
          strategy,
          output_mode: outputMode,
          offset,
          hasMore,
          nextOffset: hasMore ? offset + limitedMatches.length : undefined,
        });
      }

      // Default: content mode - show matching lines
      const displayMatches = limitedMatches.slice(0, GrepTool.HARD_MAX_RESULTS);

      const matchesByFile = this.groupMatchesByFile(displayMatches, searchDir);
      matchCount = displayMatches.length;
      const matchTerm = matchCount === 1 ? 'match' : 'matches';

      // Build header with pagination info
      if (offset > 0 || hasMore) {
        const rangeStart = offset + 1;
        const rangeEnd = offset + limitedMatches.length;
        llmContent = `Found ${totalMatches} matches for "${params.pattern}" (showing ${rangeStart}-${rangeEnd}) in "${searchPathDisplay}"${globPattern ? ` (filter: "${globPattern}")` : ''} [using ${strategy}]:\n---\n`;
      } else {
        llmContent = `Found ${matchCount} ${matchTerm} for "${params.pattern}" in "${searchPathDisplay}"${globPattern ? ` (filter: "${globPattern}")` : ''} [using ${strategy}]:\n---\n`;
      }

      let contentLength = llmContent.length;
      let contentTruncated = false;

      for (const filePath in matchesByFile) {
        const fileMatches = matchesByFile[filePath];
        if (!fileMatches) continue;

        const fileHeader = `File: ${filePath}\n`;
        if (contentLength + fileHeader.length > GrepTool.MAX_CONTENT_LENGTH) {
          contentTruncated = true;
          break;
        }
        llmContent += fileHeader;
        contentLength += fileHeader.length;

        for (const match of fileMatches) {
          const trimmedLine = match.line.trim();
          const lineContent = showLineNumbers ? `L${match.lineNumber}: ${trimmedLine}\n` : `${trimmedLine}\n`;
          if (contentLength + lineContent.length > GrepTool.MAX_CONTENT_LENGTH) {
            contentTruncated = true;
            break;
          }
          llmContent += lineContent;
          contentLength += lineContent.length;
        }
        if (contentTruncated) break;
        llmContent += '---\n';
        contentLength += 4;
      }

      // Add pagination guidance
      if (hasMore || contentTruncated) {
        const nextOffset = offset + limitedMatches.length;
        llmContent += `\n[TRUNCATED] ${remainingCount} more matches available. To see next page, call grep again with offset=${nextOffset}`;
      }

      const returnDisplay = hasMore || offset > 0
        ? `Found ${totalMatches} matches (showing ${matchCount})`
        : `Found ${matchCount} ${matchTerm}`;

      if (updateOutput) updateOutput(returnDisplay);

      return this.createSuccessResult(llmContent.trim(), {
        executionTime: Date.now() - startTime,
        matchCount: totalMatches,
        displayedMatches: matchCount,
        truncated: hasMore || contentTruncated,
        searchPath: searchPathAbsolute,
        pattern: params.pattern,
        strategy,
        output_mode: outputMode,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + limitedMatches.length : undefined,
      });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return this.createErrorResult('Search was aborted');
      }
      return this.createErrorResult(`Search failed: ${error.message}`);
    }
  }

  /**
   * Performs grep search using best available strategy
   *
   * @param pattern - Regex pattern to search for
   * @param absolutePath - Directory to search in
   * @param include - Glob pattern for file filtering
   * @param caseSensitive - Whether search is case-sensitive
   * @param signal - Abort signal for cancellation
   * @param targetFile - Optional: specific filename to search (single-file mode)
   * @param fileType - Optional: file type filter (rg --type)
   * @param multiline - Optional: enable multiline matching
   * @param contextAfter - Optional: lines after match (-A)
   * @param contextBefore - Optional: lines before match (-B)
   * @param contextBoth - Optional: lines of context (-C)
   * @param maxResults - Optional: maximum results (enables -m flag for ripgrep)
   */
  private async performGrepSearch(
    pattern: string,
    absolutePath: string,
    include?: string,
    caseSensitive: boolean = false,
    signal?: AbortSignal,
    targetFile?: string,
    fileType?: string,
    multiline?: boolean,
    contextAfter?: number,
    contextBefore?: number,
    contextBoth?: number,
    maxResults?: number,
  ): Promise<{ matches: GrepMatch[]; strategy: string }> {
    // Strategy 1: ripgrep (rg) - Fastest
    if (await this.isCommandAvailable('rg')) {
      try {
        const matches = await this.searchWithRipgrep(
          pattern,
          absolutePath,
          include,
          caseSensitive,
          targetFile,
          fileType,
          multiline,
          contextAfter,
          contextBefore,
          contextBoth,
          maxResults,
          signal,
        );
        return { matches, strategy: 'ripgrep' };
      } catch (error: any) {
        // If aborted, propagate the error instead of falling back
        if (error.message?.includes('aborted') || error.message?.includes('timed out')) {
          throw error;
        }
        console.debug(`ripgrep failed: ${error.message}, falling back...`);
      }
    }

    // Strategy 2: git grep - Fast (git repos only)
    if (isGitRepository(absolutePath) && (await this.isCommandAvailable('git'))) {
      try {
        const matches = await this.searchWithGitGrep(
          pattern,
          absolutePath,
          include,
          caseSensitive,
          targetFile,
          signal,
        );
        return { matches, strategy: 'git grep' };
      } catch (error: any) {
        // If aborted, propagate the error instead of falling back
        if (error.message?.includes('aborted') || error.message?.includes('timed out')) {
          throw error;
        }
        console.debug(`git grep failed: ${error.message}, falling back...`);
      }
    }

    // Strategy 3: system grep - Good
    if (await this.isCommandAvailable('grep')) {
      try {
        const matches = await this.searchWithSystemGrep(
          pattern,
          absolutePath,
          include,
          caseSensitive,
          targetFile,
          signal,
        );
        return { matches, strategy: 'system grep' };
      } catch (error: any) {
        // If aborted, propagate the error instead of falling back
        if (error.message?.includes('aborted') || error.message?.includes('timed out')) {
          throw error;
        }
        console.debug(`system grep failed: ${error.message}, falling back...`);
      }
    }

    // Strategy 4: JavaScript fallback - Portable
    const matches = await this.searchWithJavaScript(
      pattern,
      absolutePath,
      include,
      caseSensitive,
      signal,
      targetFile,
      multiline,
    );
    return { matches, strategy: 'javascript' };
  }

  /**
   * Strategy 1: Search with ripgrep (rg)
   */
  private async searchWithRipgrep(
    pattern: string,
    cwd: string,
    include?: string,
    caseSensitive: boolean = false,
    targetFile?: string,
    fileType?: string,
    multiline?: boolean,
    contextAfter?: number,
    contextBefore?: number,
    contextBoth?: number,
    maxResults?: number,
    signal?: AbortSignal,
  ): Promise<GrepMatch[]> {
    const args = [
      '--line-number',
      '--no-heading',
      '--with-filename',
      '--color', 'never',
    ];

    if (!caseSensitive) args.push('--ignore-case');
    if (include) args.push('--glob', include);
    if (fileType) args.push('--type', fileType);
    if (multiline) args.push('-U', '--multiline-dotall');
    if (contextAfter) args.push('-A', String(contextAfter));
    if (contextBefore) args.push('-B', String(contextBefore));
    if (contextBoth) args.push('-C', String(contextBoth));
    // Early termination: limit results at source to save context tokens
    if (maxResults && maxResults > 0) args.push('-m', String(maxResults));

    args.push(pattern);

    // Single file mode: search specific file instead of directory
    args.push(targetFile || '.');

    const output = await this.executeCommand('rg', args, cwd, signal);
    return this.parseGrepOutput(output, cwd);
  }

  /**
   * Strategy 2: Search with git grep
   */
  private async searchWithGitGrep(
    pattern: string,
    cwd: string,
    include?: string,
    caseSensitive: boolean = false,
    targetFile?: string,
    signal?: AbortSignal,
  ): Promise<GrepMatch[]> {
    const args = [
      'grep',
      '--untracked',
      '-n',
      '-E',
    ];

    if (!caseSensitive) args.push('--ignore-case');
    args.push(pattern);

    // Single file mode or directory mode
    if (targetFile) {
      args.push('--');
      args.push(targetFile);
    } else if (include) {
      args.push('--');
      args.push(include);
    }

    const output = await this.executeCommand('git', args, cwd, signal);
    return this.parseGrepOutput(output, cwd);
  }

  /**
   * Strategy 3: Search with system grep
   */
  private async searchWithSystemGrep(
    pattern: string,
    cwd: string,
    include?: string,
    caseSensitive: boolean = false,
    targetFile?: string,
    signal?: AbortSignal,
  ): Promise<GrepMatch[]> {
    // Single file mode: use different flags (no recursion)
    const args = targetFile ? ['-n', '-H', '-E'] : ['-r', '-n', '-H', '-E'];

    if (!caseSensitive) args.push('--ignore-case');

    // Only exclude directories when searching recursively
    if (!targetFile) {
      const excludeDirs = [
        '.git',
        'node_modules',
        'bower_components',
        'dist',
        'build',
        '.claude',           // external coding-agent data dir
        '.cortex',           // Nexus Cortex runtime data
        '.npm',              // npm cache
        '.pythonlibs',       // Python libraries
        '.config',           // Configuration data
        'coverage',          // Test coverage
        '.next',             // Next.js build
        '.nuxt',             // Nuxt.js build
        '.cache',            // General cache
        'tmp',               // Temporary files
        'temp',              // Temporary files
        '__pycache__',       // Python cache
        '.pytest_cache',     // Pytest cache
        '.mypy_cache',       // Mypy cache
        'vendor',            // Vendor dependencies
        '.venv',             // Python virtual env
        'venv',              // Python virtual env
        'env',               // Environment
      ];
      excludeDirs.forEach(dir => args.push(`--exclude-dir=${dir}`));

      if (include) args.push(`--include=${include}`);
    }

    args.push(pattern);

    // Single file mode: search specific file instead of directory
    args.push(targetFile || '.');

    const output = await this.executeCommand('grep', args, cwd, signal);
    return this.parseGrepOutput(output, cwd);
  }

  /**
   * Strategy 4: Pure JavaScript fallback
   */
  private async searchWithJavaScript(
    pattern: string,
    absolutePath: string,
    include?: string,
    caseSensitive: boolean = false,
    signal?: AbortSignal,
    targetFile?: string,
    multiline?: boolean,
  ): Promise<GrepMatch[]> {
    // Build regex flags
    let flags = caseSensitive ? '' : 'i';
    if (multiline) flags += 'ms'; // multiline + dotAll
    const regex = new RegExp(pattern, flags);
    const allMatches: GrepMatch[] = [];

    // Single file mode: search only the target file
    if (targetFile) {
      const fileAbsolutePath = path.join(absolutePath, targetFile);

      try {
        const stat = await fs.stat(fileAbsolutePath);
        if (stat.size > GrepTool.MAX_SEARCHABLE_FILE_BYTES) {
          console.debug(`Skipping ${fileAbsolutePath}: ${stat.size} bytes exceeds search limit`);
          return allMatches;
        }
        const content = await fs.readFile(fileAbsolutePath, 'utf8');
        const lines = content.split(/\r?\n/);

        lines.forEach((line, index) => {
          if (regex.test(line)) {
            allMatches.push({
              filePath: targetFile,
              lineNumber: index + 1,
              line,
            });
          }
        });
      } catch (error: any) {
        console.debug(`Could not read ${fileAbsolutePath}: ${error.message}`);
      }

      return allMatches;
    }

    // Directory mode: search all matching files
    const globPattern = include || '**/*';
    // Minimal exclusions - let .gitignore/.rgignore handle the rest (ripgrep respects these)
    // This matches the approach of delegating to ripgrep defaults
    const ignorePatterns = [
      '.git/**',             // Git internals (ripgrep excludes by default)
      'node_modules/**',     // Dependencies (usually in .gitignore but critical for performance)
      '.claude/**',          // external coding-agent data dir
      '.cortex/**',          // Nexus Cortex runtime data
      '.grok/**',            // xAI Grok CLI runtime data (upload_queue holds huge blobs)
    ];

    const filesStream = globStream(globPattern, {
      cwd: absolutePath,
      dot: true,
      ignore: ignorePatterns,
      absolute: true,
      nodir: true,
      signal,
    });

    for await (const filePath of filesStream) {
      const fileAbsolutePath = filePath as string;

      try {
        const stat = await fs.stat(fileAbsolutePath);
        if (stat.size > GrepTool.MAX_SEARCHABLE_FILE_BYTES) {
          // Skip oversized files: reading them into a string can throw
          // "Invalid string length", and they're never useful grep targets.
          continue;
        }
        const content = await fs.readFile(fileAbsolutePath, 'utf8');
        const lines = content.split(/\r?\n/);

        lines.forEach((line, index) => {
          if (regex.test(line)) {
            allMatches.push({
              filePath:
                path.relative(absolutePath, fileAbsolutePath) ||
                path.basename(fileAbsolutePath),
              lineNumber: index + 1,
              line,
            });
          }
        });
      } catch (error: any) {
        if (error.code !== 'ENOENT' && error.code !== 'EISDIR') {
          console.debug(`Could not read ${fileAbsolutePath}: ${error.message}`);
        }
      }
    }

    return allMatches;
  }

  /**
   * Executes a command and returns stdout
   * Supports abort signal for ESC key cancellation and timeout for runaway processes
   */
  private executeCommand(
    command: string,
    args: string[],
    cwd: string,
    signal?: AbortSignal,
    timeoutMs: number = 30000, // 30 second default timeout
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Check if already aborted before spawning
      if (signal?.aborted) {
        reject(new Error('Search was aborted'));
        return;
      }

      const child = spawn(command, args, {
        cwd,
        windowsHide: true,
      });

      let killed = false;
      let timedOut = false;

      // Setup timeout to prevent runaway grep processes
      const timeoutId = setTimeout(() => {
        if (!killed) {
          timedOut = true;
          killed = true;
          child.kill('SIGKILL');
        }
      }, timeoutMs);

      // Setup abort signal handler for ESC key cancellation
      const abortHandler = () => {
        if (!killed) {
          killed = true;
          clearTimeout(timeoutId);
          child.kill('SIGKILL');
        }
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk) => {
        const str = chunk.toString();
        // Suppress common harmless messages
        if (!str.includes('Permission denied') && !/Is a directory/i.test(str)) {
          stderrChunks.push(chunk);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }
        reject(new Error(`Failed to start ${command}: ${err.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }

        // Handle abort/timeout cases
        if (signal?.aborted || killed) {
          if (timedOut) {
            reject(new Error(`Search timed out after ${timeoutMs / 1000} seconds`));
          } else {
            reject(new Error('Search was aborted'));
          }
          return;
        }

        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

        if (code === 0) {
          resolve(stdout);
        } else if (code === 1) {
          resolve(''); // No matches (not an error)
        } else {
          reject(new Error(`${command} exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
        }
      });
    });
  }

  /**
   * Checks if a command is available
   */
  private isCommandAvailable(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const checkCmd = process.platform === 'win32' ? 'where' : 'command';
      const checkArgs = process.platform === 'win32' ? [command] : ['-v', command];

      try {
        const child = spawn(checkCmd, checkArgs, {
          stdio: 'ignore',
          shell: process.platform === 'win32',
        });
        child.on('close', (code) => resolve(code === 0));
        child.on('error', () => resolve(false));
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Parses grep-style output including context lines from -A/-B/-C flags.
   * Match lines use colons: file:line:content
   * Context lines use dashes: file-line-content
   * Group separators: --
   */
  private parseGrepOutput(output: string, basePath: string): GrepMatch[] {
    const results: GrepMatch[] = [];
    if (!output) return results;

    const lines = output.split(EOL);

    for (const line of lines) {
      if (!line.trim()) continue;
      // Skip group separators between match groups
      if (line === '--') continue;

      // Try colon-separated match line: file:linenum:content
      const firstColon = line.indexOf(':');
      if (firstColon > 0) {
        const secondColon = line.indexOf(':', firstColon + 1);
        if (secondColon > 0) {
          const filePathRaw = line.substring(0, firstColon);
          const lineNumberStr = line.substring(firstColon + 1, secondColon);
          const lineNumber = parseInt(lineNumberStr, 10);
          if (!isNaN(lineNumber)) {
            const absoluteFilePath = path.resolve(basePath, filePathRaw);
            const relativeFilePath = path.relative(basePath, absoluteFilePath);
            results.push({
              filePath: relativeFilePath || path.basename(absoluteFilePath),
              lineNumber,
              line: line.substring(secondColon + 1),
            });
            continue;
          }
        }
      }

      // Try dash-separated context line: file-linenum-content
      // Context lines from ripgrep -A/-B/-C use dashes instead of colons
      const dashMatch = line.match(/^(.+?)-(\d+)-(.*)$/);
      if (dashMatch) {
        const [, filePathRaw, lineNumberStr, lineContent] = dashMatch;
        const lineNumber = parseInt(lineNumberStr!, 10);
        if (!isNaN(lineNumber) && filePathRaw) {
          const absoluteFilePath = path.resolve(basePath, filePathRaw);
          const relativeFilePath = path.relative(basePath, absoluteFilePath);
          results.push({
            filePath: relativeFilePath || path.basename(absoluteFilePath),
            lineNumber,
            line: lineContent ?? '',
          });
        }
      }
    }

    return results;
  }

  /**
   * Groups matches by file and sorts by line number
   */
  private groupMatchesByFile(
    matches: GrepMatch[],
    basePath: string,
  ): Record<string, GrepMatch[]> {
    const matchesByFile: Record<string, GrepMatch[]> = {};

    for (const match of matches) {
      const absoluteFilePath = path.resolve(basePath, match.filePath);
      const relativeFilePath =
        path.relative(basePath, absoluteFilePath) || path.basename(absoluteFilePath);

      if (!matchesByFile[relativeFilePath]) {
        matchesByFile[relativeFilePath] = [];
      }
      matchesByFile[relativeFilePath].push(match);
    }

    for (const filePath in matchesByFile) {
      const fileMatches = matchesByFile[filePath];
      if (fileMatches) {
        fileMatches.sort((a, b) => a.lineNumber - b.lineNumber);
      }
    }

    return matchesByFile;
  }
}
