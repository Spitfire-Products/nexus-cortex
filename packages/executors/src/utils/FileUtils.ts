/**
 * File Utilities
 *
 * Common file operations and path handling for tool executors
 */

import fs from 'fs';
import path from 'path';

/**
 * Check if a path is within a root directory
 *
 * @param filePath Path to check
 * @param rootDir Root directory
 * @returns true if path is within root, false otherwise
 */
export function isWithinRoot(filePath: string, rootDir: string): boolean {
  const resolved = path.resolve(filePath);
  const root = path.resolve(rootDir);
  return resolved.startsWith(root);
}

/**
 * Check if a path is within the working directory OR any user-granted
 * additional directory (the `--add-dir` / CORTEX_ADD_DIRS permission model).
 * This is the single boundary predicate every file tool should use so the
 * "in-bounds" rule is uniform and additional-dir grants are honored everywhere.
 *
 * @param filePath Path to check
 * @param workingDirectory The canonical project root
 * @param additionalDirectories Extra roots the user explicitly granted (optional)
 */
export function isWithinAllowedRoots(
  filePath: string,
  workingDirectory: string,
  additionalDirectories?: string[]
): boolean {
  if (isWithinRoot(filePath, workingDirectory)) return true;
  for (const dir of additionalDirectories || []) {
    if (dir && isWithinRoot(filePath, dir)) return true;
  }
  return false;
}

/**
 * Make a path relative to a directory
 *
 * @param filePath Absolute path
 * @param baseDir Base directory
 * @returns Relative path
 */
export function makeRelative(filePath: string, baseDir: string): string {
  return path.relative(baseDir, filePath);
}

/**
 * Shorten a path for display
 *
 * @param filePath Path to shorten
 * @param maxLength Maximum length (default: 60)
 * @returns Shortened path
 */
export function shortenPath(filePath: string, maxLength: number = 60): string {
  if (filePath.length <= maxLength) {
    return filePath;
  }

  const parts = filePath.split(path.sep);
  if (parts.length <= 2) {
    return filePath;
  }

  // Keep first and last parts, abbreviate middle
  return `${parts[0]}${path.sep}...${path.sep}${parts[parts.length - 1]}`;
}

/**
 * Read file content with line range support
 *
 * @param filePath Path to file
 * @param offset Line offset (0-based)
 * @param limit Number of lines to read
 * @returns File content
 */
export async function readFileContent(
  filePath: string,
  offset?: number,
  limit?: number,
): Promise<string> {
  const content = await fs.promises.readFile(filePath, 'utf-8');

  // Return full content if no offset/limit
  if (offset === undefined && limit === undefined) {
    return content;
  }

  // Split into lines
  const lines = content.split('\n');

  // Apply offset and limit
  const startLine = offset || 0;
  const endLine = limit ? startLine + limit : lines.length;

  return lines.slice(startLine, endLine).join('\n');
}

/**
 * Get file statistics
 *
 * @param filePath Path to file
 * @returns File stats
 */
export async function getFileStats(filePath: string): Promise<fs.Stats> {
  return fs.promises.stat(filePath);
}

/**
 * Check if file exists
 *
 * @param filePath Path to file
 * @returns true if exists, false otherwise
 */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Resolve a file path with smart fallback for common model mistakes.
 *
 * When a model passes a relative path that doesn't exist after resolution
 * against the working directory, this tries stripping leading segments that
 * duplicate the working directory name. For example, if workingDirectory is
 * `/home/user/my-project` and the model passes `my-project/src/index.ts`,
 * the naive resolution produces `/home/user/my-project/my-project/src/index.ts`
 * (doesn't exist). The fallback strips the `my-project/` prefix and retries,
 * yielding the correct `/home/user/my-project/src/index.ts`.
 *
 * Only returns a fallback if it (a) exists on disk and (b) passes the
 * security check (within workingDirectory). Otherwise returns the original
 * resolved path so the caller can produce the normal error.
 *
 * @param rawPath   The path exactly as the model provided it
 * @param workingDirectory  The project root / security boundary
 * @returns The resolved absolute path (fallback-corrected when possible)
 */
export function resolveFilePath(rawPath: string, workingDirectory: string): string {
  // Normalize double slashes
  let filePath = rawPath.replace(/\/+/g, '/');

  // Already absolute — nothing to resolve
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  // Standard resolution against working directory
  const resolved = path.resolve(workingDirectory, filePath);

  // If it exists, great — use it
  if (fs.existsSync(resolved)) {
    return resolved;
  }

  // --- Smart fallback: strip leading segments that match the workingDirectory basename ---
  // Handles: "nexus-cortex/packages/core/..." when workingDirectory already IS nexus-cortex
  const dirName = path.basename(workingDirectory);
  const segments = filePath.split('/');

  if (segments[0] === dirName && segments.length > 1) {
    const stripped = segments.slice(1).join('/');
    const fallback = path.resolve(workingDirectory, stripped);

    if (fs.existsSync(fallback) && isWithinRoot(fallback, workingDirectory)) {
      return fallback;
    }
  }

  // Return original resolution (caller will produce the appropriate error)
  return resolved;
}

/**
 * Format file size for display
 *
 * @param bytes File size in bytes
 * @returns Formatted string (e.g., "1.5 KB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
