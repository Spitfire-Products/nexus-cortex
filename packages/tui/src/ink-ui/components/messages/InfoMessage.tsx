/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text, Box, useStdout } from 'ink';
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

interface InfoMessageProps {
  text: string;
  icon?: string;
  color?: string;
}

export const InfoMessage: React.FC<InfoMessageProps> = ({
  text,
  icon,
  color,
}) => {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;
  color ??= theme.status.warning;
  const prefix = icon ?? 'ℹ ';
  const prefixWidth = prefix.length;
  const contentWidth = Math.max(terminalWidth - prefixWidth - 2, 20);

  return (
    <Box flexDirection="row" marginTop={1}>
      <Box width={prefixWidth}>
        <Text color={color}>{prefix}</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column">
        {text.split('\n').map((line, lineIndex) => {
          const wrappedLines = wordWrap(line, contentWidth);
          return wrappedLines.map((wrappedLine, wrapIndex) => (
            <Text key={`${lineIndex}-${wrapIndex}`}>
              <RenderInline text={wrappedLine} defaultColor={color} />
            </Text>
          ));
        })}
      </Box>
    </Box>
  );
};
