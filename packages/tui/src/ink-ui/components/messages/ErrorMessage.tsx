/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text, Box, useStdout } from 'ink';
import { theme } from '../../semantic-colors.js';

/**
 * Word-wrap text to fit within width
 */
function wordWrap(text: string, width: number): string[] {
  if (width <= 0 || !text) return [text];
  const words = text.split(/\s+/);
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
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [''];
}

interface ErrorMessageProps {
  text: string;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ text }) => {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;
  const prefix = '✕ ';
  const prefixWidth = prefix.length;
  const contentWidth = Math.max(terminalWidth - prefixWidth - 2, 20);
  const wrappedLines = wordWrap(text, contentWidth);

  return (
    <Box flexDirection="row" marginBottom={1}>
      <Box width={prefixWidth}>
        <Text color={theme.status.error}>{prefix}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {wrappedLines.map((line, i) => (
          <Text key={i} color={theme.status.error}>
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
};
