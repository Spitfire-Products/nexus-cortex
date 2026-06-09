/**
 * DiffParser - Shared utility for parsing unified diff strings
 *
 * This module provides a consistent way to parse unified diff output
 * (from tools like `diff -u` or the `diff` npm package) into structured
 * data that can be rendered by any UI.
 *
 * Used by:
 * - Chalk CLI (ToolFormatter.ts)
 * - Ink UI (DiffPreview.tsx)
 * - Edit tool result display in both UIs
 *
 * @module DiffParser
 */

import * as Diff from 'diff';

/**
 * Represents a single line in a diff
 */
export interface DiffLine {
  /** Line number in the old file (for removed/context lines) */
  oldLineNumber?: number;
  /** Line number in the new file (for added/context lines) */
  newLineNumber?: number;
  /** Legacy line number field for backwards compatibility */
  lineNumber?: number;
  /** Type of change */
  type: 'added' | 'removed' | 'context';
  /** The actual line content (without the +/- prefix) */
  content: string;
}

/**
 * Represents a chunk/hunk in a diff (a contiguous section of changes)
 */
export interface DiffChunk {
  /** Context lines before the changes */
  contextBefore: DiffLine[];
  /** The actual changed lines (additions and removals) */
  changes: DiffLine[];
  /** Context lines after the changes */
  contextAfter: DiffLine[];
}

/**
 * Represents a complete parsed diff
 */
export interface ParsedDiff {
  /** Path to the file that was diffed */
  file: string;
  /** Number of lines added */
  additions: number;
  /** Number of lines removed */
  removals: number;
  /** The diff chunks */
  chunks: DiffChunk[];
}

/**
 * Parse a unified diff string into structured data
 *
 * Handles standard unified diff format:
 * ```
 * --- a/file.txt
 * +++ b/file.txt
 * @@ -1,3 +1,4 @@
 *  context line
 * -removed line
 * +added line
 *  context line
 * ```
 *
 * @param diffString - The unified diff string to parse
 * @param filePath - The file path (used if not found in diff header)
 * @returns Parsed diff structure, or null if parsing fails
 */
export function parseUnifiedDiff(diffString: string, filePath: string = 'file'): ParsedDiff | null {
  try {
    const lines = diffString.split('\n');
    let currentLineOld = 0;
    let currentLineNew = 0;
    const chunks: DiffChunk[] = [];
    let currentChunk: DiffChunk | null = null;

    let additions = 0;
    let removals = 0;

    // Try to extract file path from diff header
    let extractedPath = filePath;
    for (const line of lines) {
      if (line.startsWith('+++ ')) {
        // Extract path from +++ b/path or +++ path
        const pathMatch = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
        if (pathMatch && pathMatch[1] && pathMatch[1] !== '/dev/null') {
          extractedPath = pathMatch[1];
        }
        break;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip if line is undefined
      if (line === undefined) continue;

      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
        if (match) {
          currentLineOld = parseInt(match[1] || '1', 10);
          currentLineNew = parseInt(match[2] || '1', 10);

          // Start new chunk
          if (currentChunk) {
            chunks.push(currentChunk);
          }
          currentChunk = {
            contextBefore: [],
            changes: [],
            contextAfter: []
          };
        }
        continue;
      }

      // Skip diff header lines
      if (line.startsWith('---') || line.startsWith('+++') ||
          line.startsWith('Index:') || line.startsWith('\\') ||
          line.startsWith('diff ')) {
        continue;
      }

      if (!currentChunk) continue;

      // Handle empty lines (but not undefined)
      if (line === '') continue;

      const firstChar = line[0];

      if (firstChar === '-') {
        // Removed line
        removals++;
        currentChunk.changes.push({
          lineNumber: currentLineOld,
          oldLineNumber: currentLineOld++,
          type: 'removed',
          content: line.substring(1)
        });
      } else if (firstChar === '+') {
        // Added line
        additions++;
        currentChunk.changes.push({
          lineNumber: currentLineNew,
          newLineNumber: currentLineNew++,
          type: 'added',
          content: line.substring(1)
        });
      } else if (firstChar === ' ') {
        // Context line
        const diffLine: DiffLine = {
          lineNumber: currentLineOld,
          oldLineNumber: currentLineOld++,
          newLineNumber: currentLineNew++,
          type: 'context',
          content: line.substring(1)
        };

        // Add to context before if no changes yet, otherwise context after
        if (currentChunk.changes.length === 0) {
          currentChunk.contextBefore.push(diffLine);
        } else {
          currentChunk.contextAfter.push(diffLine);
        }
      }
    }

    // Add final chunk
    if (currentChunk && (currentChunk.changes.length > 0 || currentChunk.contextBefore.length > 0)) {
      chunks.push(currentChunk);
    }

    if (chunks.length === 0) {
      return null;
    }

    return {
      file: extractedPath,
      additions,
      removals,
      chunks
    };
  } catch (error) {
    console.error('[DiffParser] Error parsing unified diff:', error);
    return null;
  }
}

/**
 * Generate a unified diff from old and new strings
 *
 * This is a convenience wrapper that can be used when you have
 * the before/after content rather than a diff string.
 *
 * Note: Requires the 'diff' package to be available.
 *
 * @param oldString - The original content
 * @param newString - The modified content
 * @param filePath - The file path for the diff header
 * @returns Parsed diff structure, or null if no changes
 */
export function generateAndParseDiff(
  oldString: string,
  newString: string,
  filePath: string
): ParsedDiff | null {
  try {
    const fileName = filePath.split('/').pop() || 'file';
    const patch = Diff.createPatch(fileName, oldString, newString, 'Original', 'Modified', { context: 3 });
    return parseUnifiedDiff(patch, filePath);
  } catch (error) {
    console.error('[DiffParser] Error generating diff:', error);
    return null;
  }
}

/**
 * Get a summary of a parsed diff
 *
 * @param diff - The parsed diff
 * @returns Human-readable summary string
 */
export function getDiffSummary(diff: ParsedDiff): string {
  const { additions, removals, file } = diff;
  const fileName = file.split('/').pop() || file;
  return `${fileName}: +${additions}/-${removals}`;
}

/**
 * Check if a diff represents actual changes
 *
 * @param diff - The parsed diff (or null)
 * @returns true if there are actual changes
 */
export function hasChanges(diff: ParsedDiff | null): boolean {
  if (!diff) return false;
  return diff.additions > 0 || diff.removals > 0;
}
