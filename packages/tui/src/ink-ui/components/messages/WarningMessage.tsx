/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text, useStdout } from 'ink';
import { theme } from '../../semantic-colors.js';
import { RenderInline } from '../../utils/InlineMarkdownRenderer.js';

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

interface WarningMessageProps {
  text: string;
}

export const WarningMessage: React.FC<WarningMessageProps> = ({ text }) => {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;
  const prefix = '⚠ ';
  const prefixWidth = 3;
  const contentWidth = Math.max(terminalWidth - prefixWidth - 2, 20);
  const wrappedLines = wordWrap(text, contentWidth);

  return (
    <Box flexDirection="row" marginTop={1}>
      <Box width={prefixWidth}>
        <Text color={theme.status.warning}>{prefix}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {wrappedLines.map((line, i) => (
          <Text key={i}>
            <RenderInline text={line} defaultColor={theme.status.warning} />
          </Text>
        ))}
      </Box>
    </Box>
  );
};
