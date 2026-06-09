/**
 * DiffPreview - Standalone diff preview component for Edit tool results
 *
 * A simplified diff renderer that doesn't depend on Gemini CLI contexts.
 * Shows file edits with proper + / - coloring.
 *
 * Uses shared DiffParser from @nexus-cortex/core for parsing unified diffs.
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';
import * as Diff from 'diff';
import {
  parseUnifiedDiff as coreParseUnifiedDiff,
  type ParsedDiff,
  type DiffLine as CoreDiffLine,
} from '@nexus-cortex/core';

export interface DiffPreviewProps {
  /** Path to the file being edited */
  filePath: string;
  /** Original text being replaced */
  oldString: string;
  /** New text replacing the old string */
  newString: string;
  /** Terminal width for proper wrapping */
  terminalWidth?: number;
  /** Whether to show in compact mode */
  compact?: boolean;
}

/**
 * React-specific DiffLine interface
 * Uses 'add'/'remove' for cleaner switch statements in components
 */
interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
  subHighlights?: Array<{text: string, type: 'add' | 'remove' | 'context'}>;
}

/**
 * Convert core DiffLine type to React component format
 */
function adaptCoreDiffLine(line: CoreDiffLine): DiffLine {
  return {
    type: line.type === 'added' ? 'add' : line.type === 'removed' ? 'remove' : 'context',
    content: line.content,
    lineNumber: line.lineNumber,
    oldLineNumber: line.oldLineNumber,
    newLineNumber: line.newLineNumber,
  };
}

/**
 * Convert a ParsedDiff from core to React DiffLine array
 */
function adaptParsedDiff(parsed: ParsedDiff): DiffLine[] {
  const result: DiffLine[] = [];
  for (const chunk of parsed.chunks) {
    for (const line of chunk.contextBefore) {
      result.push(adaptCoreDiffLine(line));
    }
    for (const line of chunk.changes) {
      result.push(adaptCoreDiffLine(line));
    }
    for (const line of chunk.contextAfter) {
      result.push(adaptCoreDiffLine(line));
    }
  }
  return result;
}

/**
 * Parse unified diff and extract lines with context
 * Uses the shared DiffParser from core, then adapts to React format
 */
function parseUnifiedDiff(oldStr: string, newStr: string): DiffLine[] {
  try {
    // Generate unified diff with context using the diff library
    const patch = Diff.createPatch('file', oldStr, newStr, 'Original', 'Modified', { context: 3 });

    // Use the shared parser from core
    const parsed = coreParseUnifiedDiff(patch, 'file');
    if (parsed) {
      return adaptParsedDiff(parsed);
    }

    // Fallback to simple diff if core parser returns null
    return generateSimpleFallbackDiff(oldStr, newStr);
  } catch (error) {
    // Fallback to simple diff if unified diff fails
    return generateSimpleFallbackDiff(oldStr, newStr);
  }
}

/**
 * Fallback simple diff for when unified diff fails
 */
function generateSimpleFallbackDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const result: DiffLine[] = [];

  const maxLines = Math.max(oldLines.length, newLines.length);
  let lineNumber = 1;

  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined && newLine !== undefined) {
      result.push({ type: 'add', content: newLine, lineNumber: lineNumber++ });
    } else if (oldLine !== undefined && newLine === undefined) {
      result.push({ type: 'remove', content: oldLine, lineNumber: lineNumber++ });
    } else if (oldLine !== newLine) {
      if (oldLine !== undefined) {
        result.push({ type: 'remove', content: oldLine, lineNumber: lineNumber++ });
      }
      if (newLine !== undefined) {
        result.push({ type: 'add', content: newLine, lineNumber: lineNumber++ });
      }
    } else if (oldLine !== undefined) {
      result.push({ type: 'context', content: oldLine, lineNumber: lineNumber++ });
    }
  }

  return result;
}

/**
 * Truncate path for display
 */
function truncatePath(path: string, maxLength: number): string {
  if (path.length <= maxLength) return path;

  const parts = path.split('/');
  if (parts.length <= 2) return '...' + path.slice(-maxLength + 3);

  // Show last parts
  const lastTwo = parts.slice(-2).join('/');

  if (lastTwo.length + 4 <= maxLength) {
    return '.../' + lastTwo;
  }

  const lastPart = parts[parts.length - 1] || path;
  return '...' + lastPart.slice(-maxLength + 3);
}

/**
 * DiffPreview component for displaying Edit tool changes
 */
export const DiffPreview: React.FC<DiffPreviewProps> = ({
  filePath,
  oldString,
  newString,
  terminalWidth = 80,
  compact = false,
}) => {
  const diffLines = useMemo(() => {
    return parseUnifiedDiff(oldString, newString);
  }, [oldString, newString]);

  // Count changes
  const addCount = diffLines.filter((l) => l.type === 'add').length;
  const removeCount = diffLines.filter((l) => l.type === 'remove').length;

  // Calculate display width
  const contentWidth = Math.max(terminalWidth - 8, 40);
  const displayPath = truncatePath(filePath, contentWidth - 10);

  // For compact mode, just show summary
  if (compact) {
    return (
      <Box flexDirection="row">
        <Text color={Colors.AccentYellow}>Edit: </Text>
        <Text dimColor>{displayPath}</Text>
        <Text> </Text>
        <Text color={Colors.AccentGreen}>+{addCount}</Text>
        <Text dimColor>/</Text>
        <Text color={Colors.AccentRed}>-{removeCount}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginLeft={2}>
      {/* Header inline with file path */}
      <Box>
        <Text color={Colors.AccentYellow}>Edit: </Text>
        <Text color={Colors.White}>{displayPath}</Text>
        <Text dimColor> </Text>
        <Text color={Colors.AccentGreen}>+{addCount}</Text>
        <Text dimColor>/</Text>
        <Text color={Colors.AccentRed}>-{removeCount}</Text>
      </Box>

      {/* Diff content - no border */}
      <Box flexDirection="column" marginLeft={2}>
        {diffLines.map((line, index) => (
          <DiffLineDisplay key={index} line={line} />
        ))}
      </Box>
    </Box>
  );
};

/**
 * Single diff line display
 */
const DiffLineDisplay: React.FC<{ line: DiffLine }> = ({ line }) => {
  let lineNumStr: string;
  let displayContent: React.ReactNode;

  switch (line.type) {
    case 'add':
      lineNumStr = line.newLineNumber ? line.newLineNumber.toString().padStart(4, ' ') : ' ';
      displayContent = (
        <Box>
          <Text dimColor>{lineNumStr}</Text>
          <Text backgroundColor="#2d5016" color={Colors.White}>
            + {line.content}
          </Text>
        </Box>
      );
      break;
    case 'remove':
      lineNumStr = line.oldLineNumber ? line.oldLineNumber.toString().padStart(4, ' ') : ' ';
      displayContent = (
        <Box>
          <Text dimColor>{lineNumStr}</Text>
          <Text backgroundColor={"#5d1a1a"} color={Colors.White}>
            - {line.content}
          </Text>
        </Box>
      );
      break;
    case 'context':
      lineNumStr = line.oldLineNumber ? line.oldLineNumber.toString().padStart(4, ' ') : ' ';
      displayContent = (
        <Box>
          <Text dimColor>{lineNumStr}   {line.content}</Text>
        </Box>
      );
      break;
    default:
      return null;
  }

  return displayContent;
};

/**
 * Compact inline diff for tool call display
 */
export const InlineDiffSummary: React.FC<{
  filePath: string;
  oldString: string;
  newString: string;
}> = ({ filePath, oldString, newString }) => {
  const oldLineCount = oldString.split('\n').length;
  const newLineCount = newString.split('\n').length;

  return (
    <Box>
      <Text color={Colors.AccentYellow}>Edit </Text>
      <Text dimColor>{truncatePath(filePath, 40)}</Text>
      <Text dimColor> ({oldLineCount} → {newLineCount} lines)</Text>
    </Box>
  );
};

/**
 * Props for UnifiedDiffDisplay
 */
export interface UnifiedDiffDisplayProps {
  /** The unified diff string from metadata.diff */
  diffString: string;
  /** Path to the file that was edited */
  filePath?: string;
  /** Terminal width for proper wrapping */
  terminalWidth?: number;
  /** Whether to show in compact mode */
  compact?: boolean;
  /** File statistics from metadata */
  fileStats?: {
    occurrences?: number;
    operation?: string;
  };
}

/**
 * UnifiedDiffDisplay - Renders a unified diff string (from Edit tool result metadata)
 *
 * This component displays the actual diff that was applied, not a preview.
 * Shows "Applied" header and success indicator.
 */
export const UnifiedDiffDisplay: React.FC<UnifiedDiffDisplayProps> = ({
  diffString,
  filePath = 'file',
  terminalWidth = 80,
  compact = false,
  fileStats,
}) => {
  const diffLines = useMemo(() => {
    // Use the shared parser from core and adapt to React format
    const parsed = coreParseUnifiedDiff(diffString, filePath);
    return parsed ? adaptParsedDiff(parsed) : [];
  }, [diffString, filePath]);

  // Count changes
  const addCount = diffLines.filter((l) => l.type === 'add').length;
  const removeCount = diffLines.filter((l) => l.type === 'remove').length;

  // Calculate display width
  const contentWidth = Math.max(terminalWidth - 8, 40);
  const displayPath = truncatePath(filePath, contentWidth - 10);

  // Build occurrences text
  const occurrencesText = fileStats?.occurrences
    ? ` (${fileStats.occurrences} replacement${fileStats.occurrences > 1 ? 's' : ''})`
    : '';

  // For compact mode, just show summary
  if (compact) {
    return (
      <Box flexDirection="row">
        <Text color={Colors.AccentGreen}>✓ </Text>
        <Text color={Colors.White}>{displayPath}</Text>
        <Text> </Text>
        <Text color={Colors.AccentGreen}>+{addCount}</Text>
        <Text dimColor>/</Text>
        <Text color={Colors.AccentRed}>-{removeCount}</Text>
        <Text dimColor>{occurrencesText}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginLeft={2}>
      {/* Header inline with checkmark */}
      <Box>
        <Text color={Colors.AccentGreen}>✓ </Text>
        <Text color={Colors.White}>{displayPath}</Text>
        <Text dimColor> </Text>
        <Text color={Colors.AccentGreen}>+{addCount}</Text>
        <Text dimColor>/</Text>
        <Text color={Colors.AccentRed}>-{removeCount}</Text>
        <Text dimColor>{occurrencesText}</Text>
      </Box>

      {/* Diff content - no border */}
      <Box flexDirection="column" marginLeft={2}>
        {diffLines.map((line, index) => (
          <DiffLineDisplay key={index} line={line} />
        ))}
      </Box>
    </Box>
  );
};

export default DiffPreview;
