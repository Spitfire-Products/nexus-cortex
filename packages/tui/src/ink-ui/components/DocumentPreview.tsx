/**
 * DocumentPreview - Collapsible document preview component
 *
 * Used for markdown and text files that get special treatment:
 * - Full preview during streaming
 * - Collapsed summary in session history (default)
 * - Expandable via Ctrl+E shortcut
 * - Content lazy-loaded from disk when expanded
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';
import { MarkdownText } from './MarkdownText.js';

/**
 * Props for DocumentPreview component
 */
export interface DocumentPreviewProps {
  /** Unique ID for this document (e.g., message UUID + index) */
  docId: string;
  /** Path to the document file */
  filePath: string;
  /** Number of lines in the document */
  lineCount: number;
  /** Number of words in the document */
  wordCount: number;
  /** Whether this is a markdown file */
  isMarkdown: boolean;
  /** Whether the document is currently expanded */
  isExpanded: boolean;
  /** Content of the document (only present when expanded and loaded) */
  content?: string;
  /** Whether content is currently loading */
  isLoading?: boolean;
  /** Callback to toggle expansion */
  onToggle?: () => void;
  /** Terminal width for proper wrapping */
  terminalWidth?: number;
}

/**
 * Normalize text - remove problematic whitespace (for non-markdown content)
 */
function normalizeTextContent(text: string): string {
  return text
    // Zero-width characters
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, '')
    // Control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Word-wrap plain text to a specific width, preserving original formatting
 * Unlike MarkdownText, this does NOT parse markdown - just wraps lines
 */
function wrapPlainText(text: string, width: number): string[] {
  if (width <= 0 || !text) return [text];

  const result: string[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.length <= width) {
      result.push(line);
      continue;
    }

    // Wrap long lines at word boundaries
    let remaining = line;
    while (remaining.length > width) {
      // Find last space before width
      let breakPoint = remaining.lastIndexOf(' ', width);
      if (breakPoint <= 0) {
        // No space found, break at width
        breakPoint = width;
      }
      result.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trimStart();
    }
    if (remaining) {
      result.push(remaining);
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

  const lastTwo = parts.slice(-2).join('/');
  if (lastTwo.length + 4 <= maxLength) {
    return '.../' + lastTwo;
  }

  const lastPart = parts[parts.length - 1] || path;
  return '...' + lastPart.slice(-maxLength + 3);
}

/**
 * DocumentPreview component - collapsible document preview
 */
export const DocumentPreview: React.FC<DocumentPreviewProps> = ({
  docId: _docId,
  filePath,
  lineCount,
  wordCount,
  isMarkdown,
  isExpanded,
  content,
  isLoading = false,
  onToggle: _onToggle,
  terminalWidth = 80,
}) => {
  // Calculate available width for content:
  // terminalWidth - 2 (outer marginLeft) - 4 (content marginLeft) = terminalWidth - 6
  const documentContentWidth = Math.max(terminalWidth - 6, 40);
  const displayPath = truncatePath(filePath, documentContentWidth - 20);

  // Collapsed view - just show summary with expand hint
  if (!isExpanded) {
    return (
      <Box marginLeft={2}>
        <Text color={Colors.AccentGreen}>+ </Text>
        <Text color={Colors.White} bold>{displayPath}</Text>
        <Text dimColor> ({lineCount} lines, {wordCount} words)</Text>
        <Text color={Colors.AccentCyan}> [Ctrl+E to expand]</Text>
      </Box>
    );
  }

  // Expanded view - show full content (no border to preserve markdown formatting)
  return (
    <Box flexDirection="column" marginLeft={2}>
      {/* Header */}
      <Box>
        <Text color={Colors.AccentGreen}>- </Text>
        <Text color={Colors.White} bold>{displayPath}</Text>
        <Text dimColor> ({lineCount} lines, {wordCount} words)</Text>
        <Text color={Colors.AccentCyan}> [Ctrl+E to collapse]</Text>
      </Box>

      {/* Content - no border box to preserve markdown rendering */}
      <Box flexDirection="column" marginLeft={4} marginTop={1}>
        {isLoading ? (
          <Text dimColor>Loading document...</Text>
        ) : content ? (
          isMarkdown ? (
            // Use MarkdownText for markdown files - parses formatting
            <MarkdownText width={documentContentWidth}>{content}</MarkdownText>
          ) : (
            // Use plain text wrapper for non-markdown - preserves original formatting
            // Each line rendered separately to respect margins on wrap
            <Box flexDirection="column">
              {wrapPlainText(normalizeTextContent(content), documentContentWidth).map((line, i) => (
                <Text key={i}>{line}</Text>
              ))}
            </Box>
          )
        ) : (
          <Text dimColor color={Colors.AccentRed}>[File not found]</Text>
        )}
      </Box>

      {/* End marker */}
      <Box marginLeft={4} marginTop={1}>
        <Text dimColor>───────────────────────────────────────</Text>
      </Box>
    </Box>
  );
};

/**
 * Compact inline summary for document files
 */
export const InlineDocumentSummary: React.FC<{
  filePath: string;
  lineCount: number;
  wordCount: number;
  isMarkdown: boolean;
}> = ({ filePath, lineCount, wordCount, isMarkdown }) => {
  const displayPath = truncatePath(filePath, 40);
  const typeLabel = isMarkdown ? 'MD' : 'TXT';

  return (
    <Box>
      <Text color={Colors.AccentGreen}>Write </Text>
      <Text dimColor>[{typeLabel}] </Text>
      <Text dimColor>{displayPath}</Text>
      <Text dimColor> ({lineCount} lines, {wordCount} words)</Text>
    </Box>
  );
};

export default DocumentPreview;
