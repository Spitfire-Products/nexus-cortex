/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text, Box } from 'ink';
import { theme } from '../../semantic-colors.js';
import { SCREEN_READER_USER_PREFIX } from '../../textConstants.js';
import { isSlashCommand as checkIsSlashCommand } from '../../utils/commandUtils.js';

/**
 * Word-wrap text to fit within width, breaking at word boundaries
 */
function wordWrap(text: string, width: number): string[] {
  if (width <= 0 || !text) return [text];
  const words = text.split(/(\s+)/); // Keep whitespace as separate tokens
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;
    if (currentLine.length + word.length <= width) {
      currentLine += word;
    } else if (word.match(/^\s+$/)) {
      // Skip whitespace at line breaks
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [''];
}

interface UserMessageProps {
  text: string;
  width: number;
}

export const UserMessage: React.FC<UserMessageProps> = ({ text, width }) => {
  const prefix = '> ';
  const prefixWidth = prefix.length;
  const isSlashCommand = checkIsSlashCommand(text);
  const textColor = isSlashCommand ? theme.text.accent : theme.text.secondary;

  // Calculate available width for text content (total - prefix)
  const contentWidth = Math.max(width - prefixWidth, 20);
  const wrappedLines = wordWrap(text, contentWidth);

  return (
    <Box
      flexDirection="row"
      paddingY={0}
      marginY={1}
      alignSelf="flex-start"
      width={width}
    >
      <Box width={prefixWidth} flexShrink={0}>
        <Text color={theme.text.accent} aria-label={SCREEN_READER_USER_PREFIX}>
          {prefix}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {wrappedLines.map((line, i) => (
          <Text key={i} color={textColor}>
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
};
