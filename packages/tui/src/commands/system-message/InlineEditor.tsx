/**
 * Inline Markdown Editor
 *
 * Terminal-based editor for editing system messages directly in the CLI.
 * No external editor dependencies - pure Ink component.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface EditorProps {
  /** Initial content to edit */
  content: string;

  /** File path being edited (for display) */
  filePath: string;

  /** Callback when save is requested */
  onSave: (newContent: string) => void;

  /** Callback when cancel is requested */
  onCancel: () => void;
}

/**
 * Inline editor component
 * Uses Ink for terminal rendering
 */
export const InlineEditor: React.FC<EditorProps> = ({
  content,
  filePath,
  onSave,
  onCancel,
}) => {
  const [lines, setLines] = useState<string[]>(content.split('\n'));
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [mode, setMode] = useState<'edit' | 'confirm-save' | 'confirm-cancel'>('edit');
  const [statusMessage, setStatusMessage] = useState('Ctrl+S: Save | Esc: Exit | Shift+Arrows: Jump');

  /**
   * Handle keyboard input - simple text editor
   */
  useInput((input, key) => {
    // Confirmation prompts
    if (mode === 'confirm-save') {
      if (input.toLowerCase() === 'y') {
        const newContent = lines.join('\n');
        onSave(newContent);
      } else if (input.toLowerCase() === 'n') {
        setMode('edit');
        setStatusMessage('Ctrl+S: Save | Esc: Exit | Shift+Arrows: Jump');
      }
      return;
    }

    if (mode === 'confirm-cancel') {
      if (input.toLowerCase() === 'y') {
        onCancel();
      } else if (input.toLowerCase() === 'n') {
        setMode('edit');
        setStatusMessage('Ctrl+S: Save | Esc: Exit | Shift+Arrows: Jump');
      }
      return;
    }

    // Edit mode - simple text editing

    // Save
    if (key.ctrl && input === 's') {
      setMode('confirm-save');
      setStatusMessage('Save changes? Y/N');
      return;
    }

    // Cancel with Escape
    if (key.escape) {
      setMode('confirm-cancel');
      setStatusMessage('Discard changes? Y/N');
      return;
    }

    // Arrow key navigation
    if (key.upArrow) {
      if (key.shift) {
        // Shift+Up: Jump up 10 lines
        const newLine = Math.max(0, cursorLine - 10);
        setCursorLine(newLine);
        setCursorCol(Math.min(cursorCol, lines[newLine]!.length));
      } else {
        // Up: Move up one line
        if (cursorLine > 0 && lines[cursorLine - 1] !== undefined) {
          const newLine = cursorLine - 1;
          setCursorLine(newLine);
          setCursorCol(Math.min(cursorCol, lines[newLine]!.length));
        }
      }
    } else if (key.downArrow) {
      if (key.shift) {
        // Shift+Down: Jump down 10 lines
        const newLine = Math.min(lines.length - 1, cursorLine + 10);
        setCursorLine(newLine);
        setCursorCol(Math.min(cursorCol, lines[newLine]!.length));
      } else {
        // Down: Move down one line
        if (cursorLine < lines.length - 1 && lines[cursorLine + 1] !== undefined) {
          const newLine = cursorLine + 1;
          setCursorLine(newLine);
          setCursorCol(Math.min(cursorCol, lines[newLine]!.length));
        }
      }
    } else if (key.leftArrow) {
      if (key.shift) {
        // Shift+Left: Jump to previous word or tab boundary
        const currentLine = lines[cursorLine] || '';
        if (cursorCol > 0) {
          // Find previous word boundary
          let newCol = cursorCol - 1;

          // Skip current whitespace
          while (newCol > 0 && /\s/.test(currentLine[newCol]!)) {
            newCol--;
          }

          // Skip to start of word
          while (newCol > 0 && !/\s/.test(currentLine[newCol - 1]!)) {
            newCol--;
          }

          setCursorCol(newCol);
        } else if (cursorLine > 0 && lines[cursorLine - 1] !== undefined) {
          // Jump to end of previous line
          setCursorLine(cursorLine - 1);
          setCursorCol(lines[cursorLine - 1]!.length);
        }
      } else {
        // Left: Move left one character
        if (cursorCol > 0) {
          setCursorCol(cursorCol - 1);
        } else if (cursorLine > 0 && lines[cursorLine - 1] !== undefined) {
          setCursorLine(cursorLine - 1);
          setCursorCol(lines[cursorLine - 1]!.length);
        }
      }
    } else if (key.rightArrow) {
      if (key.shift) {
        // Shift+Right: Jump to next word or tab boundary
        const currentLine = lines[cursorLine] || '';
        if (cursorCol < currentLine.length) {
          // Find next word boundary
          let newCol = cursorCol;

          // Skip current word
          while (newCol < currentLine.length && !/\s/.test(currentLine[newCol]!)) {
            newCol++;
          }

          // Skip whitespace
          while (newCol < currentLine.length && /\s/.test(currentLine[newCol]!)) {
            newCol++;
          }

          setCursorCol(Math.min(newCol, currentLine.length));
        } else if (cursorLine < lines.length - 1) {
          // Jump to start of next line
          setCursorLine(cursorLine + 1);
          setCursorCol(0);
        }
      } else {
        // Right: Move right one character
        const currentLine = lines[cursorLine] || '';
        if (cursorCol < currentLine.length) {
          setCursorCol(cursorCol + 1);
        } else if (cursorLine < lines.length - 1) {
          setCursorLine(cursorLine + 1);
          setCursorCol(0);
        }
      }
    }
    // Enter key
    else if (key.return) {
      const currentLine = lines[cursorLine] || '';
      const before = currentLine.slice(0, cursorCol);
      const after = currentLine.slice(cursorCol);

      const newLines = [...lines];
      newLines[cursorLine] = before;
      newLines.splice(cursorLine + 1, 0, after);

      setLines(newLines);
      setCursorLine(cursorLine + 1);
      setCursorCol(0);
    }
    // Backspace
    else if (key.backspace || key.delete) {
      if (cursorCol > 0) {
        const currentLine = lines[cursorLine] || '';
        const newLine = currentLine.slice(0, cursorCol - 1) + currentLine.slice(cursorCol);

        const newLines = [...lines];
        newLines[cursorLine] = newLine;
        setLines(newLines);
        setCursorCol(cursorCol - 1);
      } else if (cursorLine > 0 && lines[cursorLine - 1] !== undefined && lines[cursorLine] !== undefined) {
        const prevLine = lines[cursorLine - 1]!;
        const currentLine = lines[cursorLine]!;

        const newLines = [...lines];
        newLines[cursorLine - 1] = prevLine + currentLine;
        newLines.splice(cursorLine, 1);

        setLines(newLines);
        setCursorLine(cursorLine - 1);
        setCursorCol(prevLine.length);
      }
    }
    // Type regular characters
    else if (input && !key.ctrl && !key.meta && input.length > 0) {
      const currentLine = lines[cursorLine] || '';
      const newLine = currentLine.slice(0, cursorCol) + input + currentLine.slice(cursorCol);

      const newLines = [...lines];
      newLines[cursorLine] = newLine;
      setLines(newLines);
      setCursorCol(cursorCol + input.length);
    }
  });

  /**
   * Render editor
   * Fixed window view to prevent jumping
   */
  const windowSize = 26; // Optimal window size
  const halfWindow = Math.floor(windowSize / 2);

  // Calculate stable window position
  let windowStart = Math.max(0, cursorLine - halfWindow);
  let windowEnd = windowStart + windowSize;

  // Adjust if we're near the end
  if (windowEnd > lines.length) {
    windowEnd = lines.length;
    windowStart = Math.max(0, windowEnd - windowSize);
  }

  const visibleLines = lines.slice(windowStart, windowEnd);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">Editing: </Text>
        <Text>{filePath}</Text>
      </Box>

      {/* Content - Windowed view */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        {windowStart > 0 && (
          <Text dimColor>... {windowStart} lines above ...</Text>
        )}

        {visibleLines.map((line, idx) => {
          const lineNumber = windowStart + idx;
          const isCursorLine = lineNumber === cursorLine;

          return (
            <Box key={lineNumber}>
              <Text dimColor>{String(lineNumber + 1).padStart(4, ' ')} │ </Text>
              {isCursorLine ? (
                <Text>
                  {line.slice(0, cursorCol)}
                  <Text inverse>{line[cursorCol] || ' '}</Text>
                  {line.slice(cursorCol + 1)}
                </Text>
              ) : (
                <Text>{line}</Text>
              )}
            </Box>
          );
        })}

        {windowEnd < lines.length && (
          <Text dimColor>... {lines.length - windowEnd} lines below ...</Text>
        )}
      </Box>

      {/* Status bar */}
      <Box
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        justifyContent="space-between"
      >
        <Box>
          <Text dimColor>
            Line {cursorLine + 1}/{lines.length} | Col {cursorCol + 1}
          </Text>
          <Text dimColor> | </Text>
          <Text dimColor>
            {lines.join('\n') !== content ? '● Modified' : 'Unchanged'}
          </Text>
        </Box>
        <Text color={mode !== 'edit' ? 'yellow' : 'dimColor'}>{statusMessage}</Text>
      </Box>
    </Box>
  );
};
