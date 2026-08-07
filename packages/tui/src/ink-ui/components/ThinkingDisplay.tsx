/**
 * ThinkingDisplay - Component for rendering AI thinking/reasoning blocks
 *
 * Displays thinking content with proper styling:
 * - Dimmed, italic text for in-progress thinking
 * - Collapsible display for completed thinking
 * - Visual prefix icon (brain emoji)
 */

import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';

/** Type of thinking block for visual distinction */
export type ThinkingType = 'native' | 'extended' | 'mentorship';

export interface ThinkingDisplayProps {
  /** The thinking text content */
  text: string;
  /** Whether the thinking block is complete */
  isComplete: boolean;
  /** Whether to show in expanded or collapsed mode */
  expanded?: boolean;
  /** Maximum lines to show when collapsed */
  maxCollapsedLines?: number;
  /** Terminal width for wrapping */
  terminalWidth?: number;
  /** Whether this is inline (during streaming) vs in history */
  isInline?: boolean;
  /** Type of thinking for visual distinction */
  thinkingType?: ThinkingType;
}

/**
 * Get display configuration based on thinking type
 */
function getThinkingConfig(thinkingType: ThinkingType, isComplete: boolean) {
  switch (thinkingType) {
    case 'extended':
      // Extended thinking (Opus + Tab): dimmed, brain icon, "Extended Thinking"
      return {
        icon: '',
        label: isComplete ? 'Extended Thinking' : 'Extended Thinking',
        color: Colors.AccentPurple,
        dimContent: true,
        borderColor: Colors.AccentPurple,
      };
    case 'mentorship':
      // Mentorship thinking: lightbulb icon, "Mentor Insight"
      return {
        icon: '',
        label: 'Mentor Insight',
        color: Colors.AccentYellow,
        dimContent: false,
        borderColor: Colors.AccentYellow,
      };
    case 'native':
    default:
      // Native interleaved (Haiku): thought bubble, "Thinking"
      return {
        icon: '',
        label: isComplete ? 'Thinking' : 'Thinking',
        color: Colors.AccentBlue,
        dimContent: false,
        borderColor: Colors.Gray,
      };
  }
}

/**
 * Component that displays AI thinking/reasoning content
 */
export const ThinkingDisplay: React.FC<ThinkingDisplayProps> = ({
  text,
  isComplete,
  expanded = true,
  maxCollapsedLines = 3,
  terminalWidth = 80,
  isInline = false,
  thinkingType = 'native',
}) => {
  const [isExpanded, setIsExpanded] = useState(expanded);

  // Only allow toggle when viewing completed thinking in history
  useInput((_input, key) => {
    if (key.return && isComplete && !isInline) {
      setIsExpanded(prev => !prev);
    }
  });

  if (!text) {
    return null;
  }

  const lines = text.split('\n');
  const displayLines = isExpanded ? lines : lines.slice(0, maxCollapsedLines);
  const hasMoreLines = !isExpanded && lines.length > maxCollapsedLines;

  // Calculate available width for content (accounting for prefix)
  const contentWidth = Math.max(terminalWidth - 6, 40);

  // Get config based on thinking type
  const config = getThinkingConfig(thinkingType, isComplete);
  const statusIndicator = isComplete ? '' : ' ...';

  // Style based on thinking type
  const textStyle = {
    dimColor: config.dimContent,
    italic: true,
  };

  return (
    <Box
      flexDirection="column"
      marginY={isInline ? 0 : 1}
      paddingLeft={1}
      borderStyle={isComplete && !isInline ? 'single' : undefined}
      borderColor={config.borderColor}
      width={contentWidth + 4}
    >
      {/* Header */}
      <Box>
        <Text color={config.color}>{config.icon} </Text>
        <Text bold color={config.color}>
          {config.label}
          {statusIndicator}
        </Text>
        {isComplete && !isInline && (
          <Text dimColor> (press Enter to {isExpanded ? 'collapse' : 'expand'})</Text>
        )}
      </Box>

      {/* Content */}
      <Box flexDirection="column" marginTop={1} paddingLeft={2}>
        {displayLines.map((line, lineIndex) => {
          // Word-wrap each line to fit within content width
          const wrappedLines = wordWrap(line, contentWidth - 2);
          return wrappedLines.map((wrappedLine, wrapIndex) => (
            <Text key={`${lineIndex}-${wrapIndex}`} {...textStyle}>
              {wrappedLine}
            </Text>
          ));
        })}
        {hasMoreLines && (
          <Text dimColor>... ({lines.length - maxCollapsedLines} more lines)</Text>
        )}
      </Box>
    </Box>
  );
};

/**
 * Word-wrap text to a specific width, breaking at word boundaries
 */
function wordWrap(text: string, width: number): string[] {
  if (width <= 0 || !text) return [text];

  // Normalize whitespace first
  const normalized = text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = normalized.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;

    if (!currentLine) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= width) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

/**
 * Get inline display configuration based on thinking type
 */
function getInlineThinkingConfig(thinkingType: ThinkingType) {
  switch (thinkingType) {
    case 'extended':
      // Extended thinking: dimmed, no bullet, brain prefix on first line
      return {
        bullet: ' ',
        bulletContinue: ' ',
        dimContent: true,
        color: Colors.AccentPurple,
      };
    case 'mentorship':
      // Mentorship: not dimmed, lightbulb bullet
      return {
        bullet: ' ',
        bulletContinue: ' ',
        dimContent: false,
        color: Colors.AccentYellow,
      };
    case 'native':
    default:
      // Native interleaved: standard bullet style
      return {
        bullet: '● ',
        bulletContinue: ' ',
        dimContent: false,
        color: Colors.AccentBlue,
      };
  }
}

/**
 * Inline thinking display for during streaming
 * Claude Code style: bullet prefix with type-aware styling
 * Each paragraph gets its own bullet
 */
export const InlineThinkingDisplay: React.FC<{
  text: string;
  isComplete: boolean;
  /** Available width for text wrapping */
  width?: number;
  /** Type of thinking for visual distinction */
  thinkingType?: ThinkingType;
}> = ({ text, isComplete, width, thinkingType = 'native' }) => {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;

  if (!text) {
    return null;
  }

  // Get config based on thinking type
  const config = getInlineThinkingConfig(thinkingType);

  // Split into paragraphs for bullet display
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

  // Only show last few paragraphs during streaming to avoid overwhelming
  const maxParagraphs = 4;
  const displayParagraphs = paragraphs.slice(-maxParagraphs);

  // Calculate content width (accounting for bullet prefix)
  const effectiveWidth = width || terminalWidth;
  const contentWidth = effectiveWidth - config.bullet.length;

  return (
    <Box flexDirection="column" marginY={1}>
      {displayParagraphs.map((paragraph, index) => {
        const isLastParagraph = index === displayParagraphs.length - 1;
        const trimmedText = paragraph.trim();

        // Word wrap text to fit within content width
        const lines = wordWrap(trimmedText, contentWidth);
        return (
          <Box key={index} flexDirection="column" marginBottom={isLastParagraph ? 0 : 1}>
            {lines.map((line, lineIndex) => (
              <Box key={lineIndex}>
                {/* Show bullet on first line, continuation indent on others */}
                <Text dimColor={config.dimContent} color={lineIndex === 0 ? config.color : undefined}>
                  {lineIndex === 0 ? config.bullet : config.bulletContinue}
                </Text>
                <Text dimColor={config.dimContent} italic>
                  {line}
                  {!isComplete && isLastParagraph && lineIndex === lines.length - 1 && (
                    <Text color={Colors.AccentCyan}> ▌</Text>
                  )}
                </Text>
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
};

export default ThinkingDisplay;
