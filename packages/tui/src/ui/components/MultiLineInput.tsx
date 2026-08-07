/**
 * MultiLineInput - A growing text input component for Ink
 *
 * Features:
 * - Multi-line text that grows as you type
 * - Proper cursor navigation
 * - Handles paste correctly
 * - Wraps long lines visually
 */

import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import chalk from 'chalk';

export interface MultiLineInputProps {
  /** Called when user submits (Enter without Shift) */
  onSubmit: (text: string) => void;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Prompt prefix (e.g., "> ") */
  prompt?: string;
  /** Whether input is focused */
  focus?: boolean;
  /** Theme colors */
  promptColor?: (text: string) => string;
  textColor?: (text: string) => string;
  placeholderColor?: (text: string) => string;
}

export const MultiLineInput: React.FC<MultiLineInputProps> = ({
  onSubmit,
  placeholder = 'Type your message...',
  prompt = '> ',
  focus = true,
  promptColor = chalk.cyan,
  textColor = chalk.white,
  placeholderColor = chalk.gray,
}) => {
  const [lines, setLines] = useState<string[]>(['']);
  const [cursorRow, setCursorRow] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const { exit } = useApp();

  const text = lines.join('\n');
  const isEmpty = text === '';

  // Get current line safely
  const currentLine = lines[cursorRow] || '';

  useInput((input, key) => {
    if (!focus) return;

    // Submit on Enter (without shift/ctrl for multi-line)
    if (key.return && !key.shift && !key.ctrl) {
      if (text.trim()) {
        onSubmit(text);
        setLines(['']);
        setCursorRow(0);
        setCursorCol(0);
      }
      return;
    }

    // New line on Shift+Enter
    if (key.return && key.shift) {
      const newLines = [...lines];
      const before = currentLine.slice(0, cursorCol);
      const after = currentLine.slice(cursorCol);
      newLines[cursorRow] = before;
      newLines.splice(cursorRow + 1, 0, after);
      setLines(newLines);
      setCursorRow(cursorRow + 1);
      setCursorCol(0);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorCol > 0) {
        // Delete character before cursor
        const newLines = [...lines];
        newLines[cursorRow] = currentLine.slice(0, cursorCol - 1) + currentLine.slice(cursorCol);
        setLines(newLines);
        setCursorCol(cursorCol - 1);
      } else if (cursorRow > 0) {
        // Join with previous line
        const newLines = [...lines];
        const prevLine = newLines[cursorRow - 1] || '';
        const newCol = prevLine.length;
        newLines[cursorRow - 1] = prevLine + currentLine;
        newLines.splice(cursorRow, 1);
        setLines(newLines);
        setCursorRow(cursorRow - 1);
        setCursorCol(newCol);
      }
      return;
    }

    // Arrow keys
    if (key.leftArrow) {
      if (cursorCol > 0) {
        setCursorCol(cursorCol - 1);
      } else if (cursorRow > 0) {
        setCursorRow(cursorRow - 1);
        setCursorCol((lines[cursorRow - 1] || '').length);
      }
      return;
    }

    if (key.rightArrow) {
      if (cursorCol < currentLine.length) {
        setCursorCol(cursorCol + 1);
      } else if (cursorRow < lines.length - 1) {
        setCursorRow(cursorRow + 1);
        setCursorCol(0);
      }
      return;
    }

    if (key.upArrow) {
      if (cursorRow > 0) {
        setCursorRow(cursorRow - 1);
        setCursorCol(Math.min(cursorCol, (lines[cursorRow - 1] || '').length));
      }
      return;
    }

    if (key.downArrow) {
      if (cursorRow < lines.length - 1) {
        setCursorRow(cursorRow + 1);
        setCursorCol(Math.min(cursorCol, (lines[cursorRow + 1] || '').length));
      }
      return;
    }

    // Home/End
    if (key.ctrl && input === 'a') {
      setCursorCol(0);
      return;
    }
    if (key.ctrl && input === 'e') {
      setCursorCol(currentLine.length);
      return;
    }

    // Escape - could cancel or do nothing
    if (key.escape) {
      return;
    }

    // Ctrl+C - exit
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    // Regular character input (including paste)
    if (input && !key.ctrl && !key.meta) {
      // Handle multi-line paste
      const pastedLines = input.split('\n');

      if (pastedLines.length === 1) {
        // Single line - insert at cursor
        const newLines = [...lines];
        newLines[cursorRow] = currentLine.slice(0, cursorCol) + input + currentLine.slice(cursorCol);
        setLines(newLines);
        setCursorCol(cursorCol + input.length);
      } else {
        // Multi-line paste
        const newLines = [...lines];
        const before = currentLine.slice(0, cursorCol);
        const after = currentLine.slice(cursorCol);

        // First pasted line joins with content before cursor
        newLines[cursorRow] = before + pastedLines[0];

        // Middle lines inserted as-is
        for (let i = 1; i < pastedLines.length - 1; i++) {
          const middleLine = pastedLines[i];
          if (middleLine !== undefined) {
            newLines.splice(cursorRow + i, 0, middleLine);
          }
        }

        // Last pasted line joins with content after cursor
        const lastPastedLine = pastedLines[pastedLines.length - 1] ?? '';
        newLines.splice(cursorRow + pastedLines.length - 1, 0, lastPastedLine + after);

        // Remove the original line's remainder if we split it
        if (pastedLines.length > 1) {
          newLines.splice(cursorRow + pastedLines.length, 1);
        }

        setLines(newLines);
        setCursorRow(cursorRow + pastedLines.length - 1);
        setCursorCol(lastPastedLine.length);
      }
    }
  }, { isActive: focus });

  // Render lines with cursor
  const renderLines = () => {
    if (isEmpty) {
      return (
        <Box>
          <Text>{promptColor(prompt)}</Text>
          <Text>{placeholderColor(placeholder)}</Text>
          <Text inverse> </Text>
        </Box>
      );
    }

    return lines.map((line, rowIndex) => {
      const isCurrentRow = rowIndex === cursorRow;
      const showPrompt = rowIndex === 0;

      if (isCurrentRow) {
        // Show cursor on this line
        const before = line.slice(0, cursorCol);
        const cursorChar = line[cursorCol] || ' ';
        const after = line.slice(cursorCol + 1);

        return (
          <Box key={`line-${rowIndex}`}>
            <Text>{showPrompt ? promptColor(prompt) : ' '}</Text>
            <Text>{textColor(before)}</Text>
            <Text inverse>{cursorChar}</Text>
            <Text>{textColor(after)}</Text>
          </Box>
        );
      }

      return (
        <Box key={`line-${rowIndex}`}>
          <Text>{showPrompt ? promptColor(prompt) : ' '}</Text>
          <Text>{textColor(line)}</Text>
        </Box>
      );
    });
  };

  return (
    <Box flexDirection="column">
      {renderLines()}
    </Box>
  );
};

export default MultiLineInput;
