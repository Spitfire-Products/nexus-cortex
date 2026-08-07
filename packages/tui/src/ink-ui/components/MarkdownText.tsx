/**
 * MarkdownText - Render markdown text to Ink components
 *
 * A simple markdown renderer for Ink/React that supports:
 * - Headers (# ## ###)
 * - Code blocks (```) with language hints
 * - Inline code (`code`)
 * - Bold (**text**)
 * - Italic (*text*)
 * - Lists (- item, 1. item)
 * - Links ([text](url))
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';

interface MarkdownTextProps {
  children: string;
  dimmed?: boolean;
  /** Available width for text wrapping (defaults to 80) */
  width?: number;
}

interface ParsedBlock {
  type: 'paragraph' | 'header' | 'code' | 'list' | 'hr';
  level?: number; // For headers (1-4)
  language?: string; // For code blocks
  items?: string[]; // For lists
  ordered?: boolean; // For numbered lists
  content: string;
}


/**
 * Parse markdown text into structured blocks
 */
function parseMarkdown(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] || '';
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      i++;
      continue;
    }

    // Code blocks
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]?.trim().startsWith('```')) {
        codeLines.push(lines[i] || '');
        i++;
      }
      blocks.push({
        type: 'code',
        language,
        content: codeLines.join('\n'),
      });
      i++; // Skip closing ```
      continue;
    }

    // Headers
    const headerMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      blocks.push({
        type: 'header',
        level: headerMatch[1]!.length,
        content: headerMatch[2]!,
      });
      i++;
      continue;
    }

    // Horizontal rules
    if (trimmed.match(/^[-*_]{3,}$/)) {
      blocks.push({ type: 'hr', content: '' });
      i++;
      continue;
    }

    // Lists (unordered) - recognize -, *, +, and actual bullet characters (•, ◦, ▪, ▸)
    if (trimmed.match(/^[-*+•◦▪▸]\s/) || trimmed.match(/^[-*+•◦▪▸]$/)) {
      const items: string[] = [];
      const bulletPattern = /^[-*+•◦▪▸]\s*/;
      while (i < lines.length) {
        const currentLine = lines[i]?.trim() || '';
        if (currentLine.match(bulletPattern)) {
          // Collect the item text, joining any continuation lines
          let itemText = currentLine.replace(bulletPattern, '');
          i++;
          // Check for continuation lines (indented, not starting with bullet/number)
          while (
            i < lines.length &&
            lines[i] &&
            !lines[i]!.trim().match(bulletPattern) &&
            !lines[i]!.trim().match(/^\d+[\.\)]\s/) &&
            !lines[i]!.trim().match(/^#{1,4}\s/) &&
            !lines[i]!.trim().match(/^```/) &&
            lines[i]!.trim() &&
            (lines[i]!.startsWith(' ') || lines[i]!.startsWith('\t'))
          ) {
            itemText += ' ' + lines[i]!.trim();
            i++;
          }
          items.push(itemText);
        } else {
          break;
        }
      }
      if (items.length > 0) {
        blocks.push({
          type: 'list',
          ordered: false,
          items,
          content: '',
        });
      }
      continue;
    }

    // Lists (ordered) - recognize "1." or "1)" style
    if (trimmed.match(/^\d+[\.\)]\s/)) {
      const items: string[] = [];
      const numberPattern = /^\d+[\.\)]\s*/;
      while (i < lines.length) {
        const currentLine = lines[i]?.trim() || '';
        if (currentLine.match(numberPattern)) {
          // Collect the item text, joining any continuation lines
          let itemText = currentLine.replace(numberPattern, '');
          i++;
          // Check for continuation lines (indented, not starting with bullet/number)
          while (
            i < lines.length &&
            lines[i] &&
            !lines[i]!.trim().match(numberPattern) &&
            !lines[i]!.trim().match(/^[-*+•◦▪▸]\s/) &&
            !lines[i]!.trim().match(/^#{1,4}\s/) &&
            !lines[i]!.trim().match(/^```/) &&
            lines[i]!.trim() &&
            (lines[i]!.startsWith(' ') || lines[i]!.startsWith('\t'))
          ) {
            itemText += ' ' + lines[i]!.trim();
            i++;
          }
          items.push(itemText);
        } else {
          break;
        }
      }
      if (items.length > 0) {
        blocks.push({
          type: 'list',
          ordered: true,
          items,
          content: '',
        });
      }
      continue;
    }

    // Regular paragraph (collect consecutive non-special lines)
    // Join with space for continuous text flow (not newlines)
    const paragraphLines: string[] = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i]?.trim() &&
      !lines[i]?.trim().startsWith('```') &&
      !lines[i]?.trim().match(/^#{1,4}\s/) &&
      !lines[i]?.trim().match(/^[-*+•◦▪▸]\s/) &&
      !lines[i]?.trim().match(/^[-*+•◦▪▸]$/) &&
      !lines[i]?.trim().match(/^\d+[\.\)]\s/) &&
      !lines[i]?.trim().match(/^[-*_]{3,}$/)
    ) {
      paragraphLines.push(lines[i]!.trim());
      i++;
    }
    blocks.push({
      type: 'paragraph',
      content: paragraphLines.join(' '),  // Join with space, not newline
    });
  }

  return blocks;
}

/**
 * Parse and render inline markdown formatting for a single line
 */
const parseInlineFormatting = (text: string, dimmed?: boolean): React.ReactNode[] => {
  const segments: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  // Regex patterns for inline elements
  const patterns = [
    { regex: /`([^`]+)`/, type: 'code' },
    { regex: /\*\*([^*]+)\*\*/, type: 'bold' },
    { regex: /\*([^*]+)\*/, type: 'italic' },
    { regex: /_([^_]+)_/, type: 'italic' },
    { regex: /\[([^\]]+)\]\(([^)]+)\)/, type: 'link' },
  ];

  while (remaining) {
    let earliestMatch: { index: number; length: number; type: string; content: string; url?: string } | null = null;

    for (const pattern of patterns) {
      const match = remaining.match(pattern.regex);
      if (match && match.index !== undefined) {
        if (!earliestMatch || match.index < earliestMatch.index) {
          earliestMatch = {
            index: match.index,
            length: match[0].length,
            type: pattern.type,
            content: match[1] || '',
            url: match[2],
          };
        }
      }
    }

    if (!earliestMatch) {
      if (remaining) {
        segments.push(<Text key={key++} dimColor={dimmed}>{remaining}</Text>);
      }
      break;
    }

    if (earliestMatch.index > 0) {
      segments.push(<Text key={key++} dimColor={dimmed}>{remaining.slice(0, earliestMatch.index)}</Text>);
    }

    switch (earliestMatch.type) {
      case 'code':
        segments.push(<Text key={key++} color={Colors.AccentYellow}>{earliestMatch.content}</Text>);
        break;
      case 'bold':
        segments.push(<Text key={key++} bold dimColor={dimmed}>{earliestMatch.content}</Text>);
        break;
      case 'italic':
        segments.push(<Text key={key++} italic dimColor={dimmed}>{earliestMatch.content}</Text>);
        break;
      case 'link':
        segments.push(
          <Text key={key++}>
            <Text color={Colors.AccentCyan}>{earliestMatch.content}</Text>
            <Text dimColor> ({earliestMatch.url})</Text>
          </Text>
        );
        break;
    }

    remaining = remaining.slice(earliestMatch.index + earliestMatch.length);
  }

  return segments;
};

/**
 * Normalize text - remove ALL problematic whitespace and Unicode characters
 * This is comprehensive to handle copy-paste artifacts and terminal encoding issues
 */
function normalizeText(text: string): string {
  return text
    // Line endings (all variants)
    .replace(/\r\n/g, ' ')      // Windows CRLF
    .replace(/\r/g, ' ')        // Old Mac CR
    .replace(/\n/g, ' ')        // Unix LF
    .replace(/\u2028/g, ' ')    // Line separator
    .replace(/\u2029/g, ' ')    // Paragraph separator
    // Zero-width characters (common copy-paste artifacts)
    .replace(/\u200B/g, '')     // Zero-width space
    .replace(/\u200C/g, '')     // Zero-width non-joiner
    .replace(/\u200D/g, '')     // Zero-width joiner
    .replace(/\u200E/g, '')     // Left-to-right mark
    .replace(/\u200F/g, '')     // Right-to-left mark
    .replace(/\u2060/g, '')     // Word joiner
    .replace(/\uFEFF/g, '')     // BOM / zero-width no-break space
    // Special spaces (all Unicode space variants)
    .replace(/\t/g, ' ')        // Tab
    .replace(/\u00A0/g, ' ')    // Non-breaking space
    .replace(/\u1680/g, ' ')    // Ogham space mark
    .replace(/\u180E/g, ' ')    // Mongolian vowel separator
    .replace(/[\u2000-\u200A]/g, ' ')  // Various width spaces (en quad, em quad, etc.)
    .replace(/\u202F/g, ' ')    // Narrow no-break space
    .replace(/\u205F/g, ' ')    // Medium mathematical space
    .replace(/\u3000/g, ' ')    // Ideographic space
    // Control characters (except already handled)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // ASCII control chars
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Word-wrap text to a specific width, breaking at word boundaries
 * Returns array of lines that each fit within the width
 */
function wordWrap(text: string, width: number): string[] {
  if (width <= 0 || !text) return [text];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;

    if (!currentLine) {
      // First word on line
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= width) {
      // Word fits on current line
      currentLine += ' ' + word;
    } else {
      // Word doesn't fit, start new line
      lines.push(currentLine);
      currentLine = word;
    }
  }

  // Don't forget the last line
  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

/**
 * Render inline markdown formatting (bold, italic, code, links)
 * With proper word-wrapping to specified width
 */
const InlineText: React.FC<{
  text: string;
  dimmed?: boolean;
  width?: number;
}> = ({ text, dimmed, width }) => {
  // Normalize the text to remove any problematic characters
  const normalized = normalizeText(text);

  // If width specified, wrap text and render each line separately
  // This ensures each line respects the parent Box's margin
  if (width && width > 0) {
    const lines = wordWrap(normalized, width);
    return (
      <Box flexDirection="column">
        {lines.map((line, i) => (
          <Text key={i}>{parseInlineFormatting(line, dimmed)}</Text>
        ))}
      </Box>
    );
  }

  // Fallback: let Ink handle wrapping (may not respect margins)
  return <Text>{parseInlineFormatting(normalized, dimmed)}</Text>;
};

/**
 * Render a code block
 */
const CodeBlock: React.FC<{ content: string; language?: string }> = ({ content, language }) => {
  return (
    <Box flexDirection="column" marginY={1}>
      {language && (
        <Text dimColor>{'─'.repeat(40)} {language}</Text>
      )}
      {!language && (
        <Text dimColor>{'─'.repeat(40)}</Text>
      )}
      {content.split('\n').map((line, i) => (
        <Text key={i} color={Colors.AccentYellow}>
          {' '}{line}
        </Text>
      ))}
      <Text dimColor>{'─'.repeat(40)}</Text>
    </Box>
  );
};

/**
 * Main MarkdownText component
 * Uses manual word-wrapping when width is provided to ensure wrapped lines
 * respect parent Box margins (Ink's natural wrapping goes to column 0)
 */
export const MarkdownText: React.FC<MarkdownTextProps> = ({ children, dimmed, width }) => {
  const blocks = useMemo(() => parseMarkdown(children), [children]);
  // Calculate width for list items (accounting for bullet/number prefix)
  const listItemWidth = width ? width - 4 : undefined; // "• " or "1. " takes ~3-4 chars

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'header':
            return (
              <Box key={index} marginY={block.level === 1 ? 1 : 0}>
                <Text
                  bold
                  color={
                    block.level === 1
                      ? Colors.AccentCyan
                      : block.level === 2
                      ? Colors.AccentGreen
                      : Colors.AccentBlue
                  }
                >
                  {normalizeText(block.content)}
                </Text>
              </Box>
            );

          case 'code':
            return <CodeBlock key={index} content={block.content} language={block.language} />;

          case 'list':
            return (
              <Box key={index} flexDirection="column" marginLeft={2}>
                {block.items?.map((item, i) => (
                  <Box key={i} flexDirection="row">
                    <Text color={Colors.AccentBlue}>
                      {block.ordered ? `${i + 1}. ` : '• '}
                    </Text>
                    <Box flexShrink={1}>
                      <InlineText text={item} dimmed={dimmed} width={listItemWidth} />
                    </Box>
                  </Box>
                ))}
              </Box>
            );

          case 'hr':
            return (
              <Box key={index} marginY={1}>
                <Text dimColor>{'─'.repeat(60)}</Text>
              </Box>
            );

          case 'paragraph':
          default:
            return (
              <Box key={index}>
                <InlineText text={block.content} dimmed={dimmed} width={width} />
              </Box>
            );
        }
      })}
    </Box>
  );
};

export default MarkdownText;
