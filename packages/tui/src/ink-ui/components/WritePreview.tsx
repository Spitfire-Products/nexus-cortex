/**
 * WritePreview - File content preview component for Write tool results
 *
 * Displays the content of newly created or updated files with line numbers.
 * Used for persisted preview in session history.
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';

/**
 * Word-wrap text to a specific width, breaking at word boundaries.
 * For code, we try to preserve logical breaks (at operators, commas, etc.)
 */
function wrapCodeLine(text: string, width: number): string[] {
  if (width <= 0 || !text || text.length <= width) return [text];

  const result: string[] = [];
  let remaining = text;

  while (remaining.length > width) {
    // Find a good break point
    let breakPoint = width;

    // Look for logical break points (in order of preference)
    const breakChars = [' ', ',', '(', ')', '{', '}', '[', ']', '+', '-', '=', '/', '|', '&'];
    for (const char of breakChars) {
      const lastIndex = remaining.lastIndexOf(char, width);
      if (lastIndex > width * 0.4) {
        // Found a reasonable break point (at least 40% into the line)
        breakPoint = lastIndex + 1;
        break;
      }
    }

    // If no good break point found, just break at width
    result.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint);
  }

  if (remaining) {
    result.push(remaining);
  }

  return result.length > 0 ? result : [''];
}

/**
 * Props for WritePreview component
 */
export interface WritePreviewProps {
  /** Path to the file that was written */
  filePath: string;
  /** Full file content */
  content: string;
  /** Number of lines in the file */
  lineCount: number;
  /** File size in bytes */
  byteSize: number;
  /** Programming language for syntax hints */
  language?: string;
  /** Maximum lines to display before truncating */
  maxLines?: number;
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Terminal width for proper wrapping */
  terminalWidth?: number;
}

/**
 * Format bytes to human readable size
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Truncate path for display
 */
function truncatePath(path: string, maxLength: number): string {
  if (path.length <= maxLength) return path;

  const parts = path.split('/');
  if (parts.length <= 2) return '...' + path.slice(-maxLength + 3);

  const lastTwo = parts.slice(-2).join('/');
  if (lastTwo.length + 4 <= maxLength) {
    return '.../' + lastTwo;
  }

  const lastPart = parts[parts.length - 1] || path;
  return '...' + lastPart.slice(-maxLength + 3);
}

/**
 * WritePreview component - displays file content with line numbers
 */
export const WritePreview: React.FC<WritePreviewProps> = ({
  filePath,
  content,
  lineCount,
  byteSize,
  language,
  maxLines = 50,
  compact = false,
  terminalWidth = 80,
}) => {
  const lines = useMemo(() => content.split('\n'), [content]);
  const displayLines = useMemo(() => lines.slice(0, maxLines), [lines, maxLines]);
  const truncated = lines.length > maxLines;

  const contentWidth = Math.max(terminalWidth - 8, 40);
  const displayPath = truncatePath(filePath, contentWidth - 10);

  // For compact mode, just show summary
  if (compact) {
    return (
      <Box flexDirection="row">
        <Text color={Colors.AccentGreen}>+ </Text>
        <Text color={Colors.White}>{displayPath}</Text>
        <Text dimColor> ({lineCount} lines, {formatBytes(byteSize)})</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginLeft={2}>
      {/* Header with file info */}
      <Box>
        <Text color={Colors.AccentGreen}>+ Created </Text>
        <Text color={Colors.White} bold>{displayPath}</Text>
        <Text dimColor> ({lineCount} lines, {formatBytes(byteSize)})</Text>
        {language && <Text dimColor> [{language}]</Text>}
      </Box>

      {/* File content with line numbers */}
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        {displayLines.map((line, lineIndex) => {
          // Calculate width for code content: total - marginLeft(2) - lineNum(4) - " │ "(3) - some margin
          const lineNumWidth = 7; // " 1 │ "
          const codeWidth = Math.max(contentWidth - lineNumWidth, 30);
          const wrappedLines = wrapCodeLine(line, codeWidth);

          return (
            <Box key={lineIndex} flexDirection="column">
              {wrappedLines.map((wrappedLine, wrapIndex) => (
                <Box key={wrapIndex}>
                  {wrapIndex === 0 ? (
                    // First line shows the line number
                    <Text dimColor>{String(lineIndex + 1).padStart(4, ' ')} │ </Text>
                  ) : (
                    // Continuation lines show padding to align with code
                    <Text dimColor>{' │ '}</Text>
                  )}
                  <Text>{wrappedLine}</Text>
                </Box>
              ))}
            </Box>
          );
        })}
        {truncated && (
          <Text dimColor>     ... {lines.length - maxLines} more lines</Text>
        )}
      </Box>
    </Box>
  );
};

/**
 * Compact inline summary for tool call display
 */
export const InlineWriteSummary: React.FC<{
  filePath: string;
  lineCount: number;
  byteSize: number;
}> = ({ filePath, lineCount, byteSize }) => {
  return (
    <Box>
      <Text color={Colors.AccentGreen}>Write </Text>
      <Text dimColor>{truncatePath(filePath, 40)}</Text>
      <Text dimColor> ({lineCount} lines, {formatBytes(byteSize)})</Text>
    </Box>
  );
};

export default WritePreview;
