/**
 * Raw Terminal Input with Persistent Status Line
 *
 * Provides a readline-like interface but with full control over terminal rendering,
 * allowing us to show a status line below the input while the user types.
 */

import { renderStatusLine, type StatusLineState } from './SplashScreen.js';
import { slashCommandAutocomplete } from './SlashCommandAutocomplete.js';

// ANSI escape codes
const ESC = '\x1b';
const CSI = `${ESC}[`;

const ANSI = {
  clearLine: `${CSI}2K`,
  clearToEnd: `${CSI}0K`,
  cursorUp: (n: number) => `${CSI}${n}A`,
  cursorDown: (n: number) => `${CSI}${n}B`,
  cursorForward: (n: number) => `${CSI}${n}C`,
  cursorBack: (n: number) => `${CSI}${n}D`,
  cursorToColumn: (n: number) => `${CSI}${n}G`,
  saveCursor: `${ESC}7`,
  restoreCursor: `${ESC}8`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
};

// Bracketed paste mode markers (some terminals send these)
const PASTE_START = `${CSI}200~`;
const PASTE_END = `${CSI}201~`;

/**
 * Calculate display width of a string (accounting for wide characters)
 * Wide characters (emoji, CJK) take 2 columns
 */
function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) || 0;
    // Wide characters: CJK, emoji, fullwidth
    if (
      (code >= 0x1100 && code <= 0x115F) ||   // Hangul Jamo
      (code >= 0x2E80 && code <= 0x9FFF) ||   // CJK
      (code >= 0xAC00 && code <= 0xD7A3) ||   // Hangul Syllables
      (code >= 0xF900 && code <= 0xFAFF) ||   // CJK Compatibility
      (code >= 0xFE10 && code <= 0xFE1F) ||   // Vertical forms
      (code >= 0xFE30 && code <= 0xFE6F) ||   // CJK Compatibility Forms
      (code >= 0xFF00 && code <= 0xFF60) ||   // Fullwidth
      (code >= 0xFFE0 && code <= 0xFFE6) ||   // Fullwidth symbols
      (code >= 0x1F300 && code <= 0x1F9FF) || // Emoji
      (code >= 0x20000 && code <= 0x2FFFF)    // CJK Extension B+
    ) {
      width += 2;
    } else if (code >= 0x20) {
      width += 1;
    }
    // Control characters (< 0x20) have width 0
  }
  return width;
}

/**
 * Get display width up to a character position (for cursor positioning)
 */
function getDisplayWidthUpTo(str: string, charPos: number): number {
  return getDisplayWidth(str.slice(0, charPos));
}

/**
 * Calculate multiline metrics for input with explicit newlines and terminal wrapping
 * Returns info about total visual lines and cursor position
 */
function getMultilineMetrics(
  input: string,
  cursorPos: number,
  termWidth: number,
  prefixWidth: number
): {
  totalVisualLines: number;
  cursorVisualRow: number;
  cursorVisualCol: number;
} {
  const lines = input.split('\n');
  let totalVisualLines = 0;
  let cursorVisualRow = 0;
  let cursorVisualCol = 0;
  let charCount = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    const lineDisplayWidth = getDisplayWidth(line);
    // First line has prefix, subsequent lines start at column 0
    const effectiveWidth = lineIdx === 0 ? prefixWidth + lineDisplayWidth : lineDisplayWidth;
    const lineVisualRows = Math.max(1, Math.ceil(effectiveWidth / termWidth) || 1);

    // Check if cursor is on this line
    const lineStart = charCount;
    const lineEnd = charCount + line.length;

    if (cursorPos >= lineStart && cursorPos <= lineEnd) {
      // Cursor is on this line
      const posInLine = cursorPos - lineStart;
      const displayPosInLine = getDisplayWidthUpTo(line, posInLine);
      const absoluteCol = lineIdx === 0 ? prefixWidth + displayPosInLine : displayPosInLine;

      cursorVisualRow = totalVisualLines + Math.floor(absoluteCol / termWidth);
      cursorVisualCol = absoluteCol % termWidth;
    }

    totalVisualLines += lineVisualRows;
    charCount += line.length + 1; // +1 for newline
  }

  return { totalVisualLines, cursorVisualRow, cursorVisualCol };
}

/**
 * Find the character position in input that corresponds to a visual row/col
 * Used for up/down arrow navigation in multiline input
 */
function findCharPosForVisualPosition(
  input: string,
  targetRow: number,
  targetCol: number,
  termWidth: number,
  prefixWidth: number
): number {
  const lines = input.split('\n');
  let currentVisualRow = 0;
  let charCount = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    const lineDisplayWidth = getDisplayWidth(line);
    // First line has prefix, subsequent lines start at column 0
    const effectiveWidth = lineIdx === 0 ? prefixWidth + lineDisplayWidth : lineDisplayWidth;
    const lineVisualRows = Math.max(1, Math.ceil(effectiveWidth / termWidth) || 1);

    // Check if target row is within this line's visual rows
    if (targetRow >= currentVisualRow && targetRow < currentVisualRow + lineVisualRows) {
      // Target is on this line - find exact character position
      const rowWithinLine = targetRow - currentVisualRow;
      const targetDisplayPos = rowWithinLine * termWidth + targetCol - (rowWithinLine === 0 && lineIdx === 0 ? prefixWidth : 0);

      // Find character position for this display position within the line
      let displayWidth = 0;
      for (let i = 0; i < line.length; i++) {
        const charWidth = getDisplayWidth(line.charAt(i));
        if (displayWidth >= targetDisplayPos) {
          return charCount + i;
        }
        displayWidth += charWidth;
      }
      // If we reach end of line, return end of line position
      return charCount + line.length;
    }

    currentVisualRow += lineVisualRows;
    charCount += line.length + 1; // +1 for newline
  }

  // If target row is beyond input, return end of input
  return input.length;
}

/**
 * Check if a character is a word character (alphanumeric or underscore)
 */
function isWordChar(char: string): boolean {
  return /[\w\u00C0-\u024F\u1E00-\u1EFF]/.test(char);
}

/**
 * Find the start of the previous word from cursor position
 * Mimics Option+Left behavior: skip whitespace, then skip word chars
 */
function findPrevWordStart(str: string, pos: number): number {
  if (pos <= 0) return 0;

  let i = pos - 1;

  // Skip any whitespace/non-word chars immediately before cursor
  while (i > 0 && !isWordChar(str[i]!)) {
    i--;
  }

  // Now skip the word characters to find the start of the word
  while (i > 0 && isWordChar(str[i - 1]!)) {
    i--;
  }

  return i;
}

/**
 * Find the end of the next word from cursor position
 * Mimics Option+Right behavior: skip current word, then skip whitespace
 */
function findNextWordEnd(str: string, pos: number): number {
  if (pos >= str.length) return str.length;

  let i = pos;

  // Skip current word characters
  while (i < str.length && isWordChar(str[i]!)) {
    i++;
  }

  // Skip whitespace/non-word chars to reach the next word
  while (i < str.length && !isWordChar(str[i]!)) {
    i++;
  }

  return i;
}

export interface RawInputOptions {
  getStatusState: () => StatusLineState;
  theme: any;
  onToggleThinking?: () => void;
  onToggleAutoApprove?: () => void;
  onToggleDocuments?: () => void;
  onEscape?: () => void;
}

// Track frame state for redraws
let lastFrameTotalLines = 0;
let lastCursorRowInFrame = 0; // Which row (0-indexed from top of frame) cursor is on

// Module-level history that persists across rawQuestion calls
const inputHistory: string[] = [];
const MAX_HISTORY_SIZE = 100;

/**
 * Draw the input frame with status line below
 *
 * Uses explicit line counting and cursor movement (not save/restore which fails on scroll).
 * Supports multiline input with explicit newlines and terminal wrapping.
 */
function drawInputFrame(
  inputLine: string,
  cursorPos: number,
  options: RawInputOptions
): void {
  const theme = options.theme;
  const termWidth = process.stdout.columns || 80;
  const borderWidth = Math.min(70, termWidth);
  const statusLine = renderStatusLine(options.getStatusState());
  const shortcuts = ' / commands • ←→↑↓ nav • ⌥←→ word • ⌥↑↓ 5 lines • ⌥⌫ del word';

  const prefixWidth = 3; // " > "
  const prefix = theme.colors.info(' > ');

  // Calculate multiline metrics (handles explicit newlines + terminal wrapping)
  const metrics = getMultilineMetrics(inputLine, cursorPos, termWidth, prefixWidth);
  const inputLinesCount = metrics.totalVisualLines;

  // Get autocomplete popup lines (if visible)
  const autocompleteLines = slashCommandAutocomplete.render();
  const autocompleteLineCount = autocompleteLines.length;

  // For redraws, move cursor back to top of previous frame
  // Use tracked cursor position for accurate repositioning
  if (lastFrameTotalLines > 0 && lastCursorRowInFrame > 0) {
    // Move to start of line first
    process.stdout.write('\r');
    // Move up from cursor's current row to top of frame
    process.stdout.write(ANSI.cursorUp(lastCursorRowInFrame));
  }

  // Calculate total lines this frame will use
  // Frame = autocomplete popup + top border (1) + input lines + bottom border (1) + shortcuts (1) + status (1)
  const totalFrameLines = autocompleteLineCount + 1 + inputLinesCount + 1 + 1 + 1;
  lastFrameTotalLines = totalFrameLines;

  // Draw autocomplete popup (if visible) - above the input box
  for (const line of autocompleteLines) {
    process.stdout.write(ANSI.clearLine);
    process.stdout.write(line + '\n');
  }

  // Draw top border
  process.stdout.write(ANSI.clearLine);
  process.stdout.write(theme.dimmed('─'.repeat(borderWidth)) + '\n');

  // Draw input line(s) - terminal handles wrapping naturally
  // For multiline input, we need to clear each line as we go
  const inputLines = inputLine.split('\n');
  for (let i = 0; i < inputLines.length; i++) {
    process.stdout.write(ANSI.clearLine);
    if (i === 0) {
      process.stdout.write(prefix + inputLines[i]);
    } else {
      process.stdout.write(inputLines[i]);
    }
    process.stdout.write(ANSI.clearToEnd);
    if (i < inputLines.length - 1) {
      process.stdout.write('\n');
    }
  }

  // Move to next line after input
  process.stdout.write('\n');

  // Draw bottom border
  process.stdout.write(ANSI.clearLine);
  process.stdout.write(theme.dimmed('─'.repeat(borderWidth)) + '\n');

  // Draw shortcuts
  process.stdout.write(ANSI.clearLine);
  process.stdout.write(theme.dimmed(shortcuts) + '\n');

  // Draw status line
  process.stdout.write(ANSI.clearLine);
  process.stdout.write(statusLine + ANSI.clearToEnd);

  // Clear any extra lines below (in case previous input was longer or autocomplete was visible)
  const extraLinesToClear = 5 + (autocompleteLineCount > 0 ? 15 : 0); // Extra space for autocomplete
  for (let i = 0; i < extraLinesToClear; i++) {
    process.stdout.write('\n' + ANSI.clearLine);
  }
  // Move back up past the extra cleared lines
  process.stdout.write(ANSI.cursorUp(extraLinesToClear));

  // Move cursor back to input line
  // From status line, go up: shortcuts(1) + bottom border(1) + input lines to reach first input row
  // Then we'll move down to the correct row within input
  const linesUp = 3 + (inputLinesCount - 1);
  process.stdout.write(ANSI.cursorUp(linesUp));

  // Move down to correct visual row within input
  if (metrics.cursorVisualRow > 0) {
    process.stdout.write(ANSI.cursorDown(metrics.cursorVisualRow));
  }

  // Move to correct column (1-indexed for ANSI)
  process.stdout.write(ANSI.cursorToColumn(metrics.cursorVisualCol + 1));

  // Track where cursor ends up (row within frame, 0-indexed from top)
  // Cursor is at: autocomplete lines + top border (row 0) + 1 + cursorVisualRow
  lastCursorRowInFrame = autocompleteLineCount + 1 + metrics.cursorVisualRow;
}

/**
 * Reset frame position tracking (call when starting new input session)
 */
function resetFramePosition(): void {
  lastFrameTotalLines = 0;
  lastCursorRowInFrame = 0;
}

/**
 * Clear the input frame completely (erase all lines)
 * This ensures the frame doesn't appear in scrollback history
 * Optionally echoes the submitted input text
 */
function clearInputFrame(input: string, theme: any): void {
  // Move to top of frame using tracked cursor position
  if (lastCursorRowInFrame > 0) {
    process.stdout.write('\r');
    process.stdout.write(ANSI.cursorUp(lastCursorRowInFrame));
  }

  // Clear all lines of the frame + extra padding we added
  const totalLinesToClear = lastFrameTotalLines + 5; // frame + padding
  for (let i = 0; i < totalLinesToClear; i++) {
    process.stdout.write(ANSI.clearLine);
    if (i < totalLinesToClear - 1) {
      process.stdout.write('\n');
    }
  }

  // Move back to top
  process.stdout.write(ANSI.cursorUp(totalLinesToClear - 1));
  process.stdout.write('\r');

  // Reset frame position tracking
  lastFrameTotalLines = 0;
  lastCursorRowInFrame = 0;

  // Echo just the user's input for history
  if (input.trim()) {
    process.stdout.write(theme.colors.info('> ') + input + '\n');
  }
}

/**
 * Prompt for input with persistent status line below
 */
export function rawQuestion(options: RawInputOptions): Promise<string> {
  return new Promise((resolve) => {
    let input = '';
    let cursorPos = 0;
    let historyIndex = -1;  // -1 means not browsing history
    let drawTimeout: ReturnType<typeof setTimeout> | null = null;

    // Reset frame position for new input session
    resetFramePosition();

    // Debounced redraw to prevent flickering during paste
    const scheduleRedraw = () => {
      if (drawTimeout) {
        clearTimeout(drawTimeout);
      }
      drawTimeout = setTimeout(() => {
        drawInputFrame(input, cursorPos, options);
        drawTimeout = null;
      }, 16);  // ~60fps max
    };

    // Initial draw
    drawInputFrame(input, cursorPos, options);

    // Enable raw mode - use try-catch to prevent crashes if stdin is in unexpected state
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch {
        // Ignore errors if stdin is already closed or in unexpected state
      }
    }
    process.stdin.resume();

    // Helper to update autocomplete suggestions after input changes
    const updateAutocomplete = async () => {
      await slashCommandAutocomplete.update(input);
    };

    const handleData = (data: Buffer) => {
      const str = data.toString();

      // Handle special keys
      if (str === '\r' || str === '\n') {
        // Enter - if autocomplete is visible with selection, accept it; otherwise submit
        if (slashCommandAutocomplete.isVisible()) {
          const newInput = slashCommandAutocomplete.accept();
          if (newInput !== null) {
            input = newInput + ' '; // Add space after command for arguments
            cursorPos = input.length;
            updateAutocomplete();
            drawInputFrame(input, cursorPos, options);
            return;
          }
        }

        // Hide autocomplete before submitting
        slashCommandAutocomplete.hide();

        try {
          process.stdin.removeListener('data', handleData);
        } catch {
          // Ignore errors during listener removal
        }
        if (process.stdin.isTTY) {
          try {
            process.stdin.setRawMode(false);
          } catch {
            // Ignore errors if stdin is already closed or in unexpected state
          }
        }
        // Cancel any pending debounced redraw and do a final synchronous draw
        // to ensure frame metrics are accurate before clearing
        if (drawTimeout) {
          clearTimeout(drawTimeout);
          drawTimeout = null;
        }
        // Final draw to update lastCursorRowInFrame with current input state
        drawInputFrame(input, cursorPos, options);
        clearInputFrame(input, options.theme);
        if (input.trim()) {
          // Add to persistent history, avoiding duplicates of the last entry
          if (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== input) {
            inputHistory.push(input);
            // Trim history if it exceeds max size
            if (inputHistory.length > MAX_HISTORY_SIZE) {
              inputHistory.shift();
            }
          }
        }
        resolve(input);
        return;
      }

      if (str === '\x03') {
        // Ctrl+C - clean exit via signal handler
        if (process.stdin.isTTY) {
          try {
            process.stdin.setRawMode(false);
          } catch {
            // Ignore errors if stdin is already closed or in unexpected state
          }
        }
        process.kill(process.pid, 'SIGINT');
        return;
      }

      if (str === '\x1b') {
        // Escape - hide autocomplete if visible, otherwise call onEscape
        if (slashCommandAutocomplete.isVisible()) {
          slashCommandAutocomplete.hide();
          drawInputFrame(input, cursorPos, options);
          return;
        }
        if (options.onEscape) {
          options.onEscape();
        }
        return;
      }

      if (str === '\x09') {
        // Tab - accept autocomplete if visible, otherwise toggle thinking
        if (slashCommandAutocomplete.isVisible()) {
          const newInput = slashCommandAutocomplete.accept();
          if (newInput !== null) {
            input = newInput + ' '; // Add space after command for arguments
            cursorPos = input.length;
            updateAutocomplete();
            drawInputFrame(input, cursorPos, options);
          }
          return;
        }
        if (options.onToggleThinking) {
          options.onToggleThinking();
          drawInputFrame(input, cursorPos, options);
        }
        return;
      }

      if (str === '\x1b[Z') {
        // Shift+Tab - toggle auto-approve
        if (options.onToggleAutoApprove) {
          options.onToggleAutoApprove();
          drawInputFrame(input, cursorPos, options);
        }
        return;
      }

      // Backspace or Ctrl+H
      if (str === '\x7f' || str === '\b' || str === '\x08') {
        if (cursorPos > 0) {
          input = input.slice(0, cursorPos - 1) + input.slice(cursorPos);
          cursorPos--;
          historyIndex = -1;  // Reset history browsing when input is modified
          updateAutocomplete(); // Update autocomplete after deletion
          scheduleRedraw();
        }
        return;
      }

      // Left arrow or Ctrl+B (emacs style)
      if (str === '\x1b[D' || str === '\x02') {
        if (cursorPos > 0) {
          cursorPos--;
          drawInputFrame(input, cursorPos, options);
        }
        return;
      }

      // Right arrow or Ctrl+F (emacs style)
      if (str === '\x1b[C' || str === '\x06') {
        if (cursorPos < input.length) {
          cursorPos++;
          drawInputFrame(input, cursorPos, options);
        }
        return;
      }

      // Home key - go to start of line
      if (str === '\x1b[H' || str === '\x1b[1~' || str === '\x1bOH') {
        cursorPos = 0;
        drawInputFrame(input, cursorPos, options);
        return;
      }

      // End key - go to end of line
      if (str === '\x1b[F' || str === '\x1b[4~' || str === '\x1bOF') {
        cursorPos = input.length;
        drawInputFrame(input, cursorPos, options);
        return;
      }

      // Ctrl+D - delete character forward (like Delete key)
      if (str === '\x04') {
        if (cursorPos < input.length) {
          input = input.slice(0, cursorPos) + input.slice(cursorPos + 1);
          historyIndex = -1;  // Reset history browsing
          drawInputFrame(input, cursorPos, options);
        }
        return;
      }

      // Option+Left or Ctrl+Left - jump to previous word
      // Option: \x1bb (ESC b) or \x1b[1;3D
      // Ctrl: \x1b[1;5D
      if (str === '\x1bb' || str === '\x1b[1;3D' || str === '\x1b[1;5D') {
        cursorPos = findPrevWordStart(input, cursorPos);
        drawInputFrame(input, cursorPos, options);
        return;
      }

      // Option+Right or Ctrl+Right - jump to next word
      // Option: \x1bf (ESC f) or \x1b[1;3C
      // Ctrl: \x1b[1;5C
      if (str === '\x1bf' || str === '\x1b[1;3C' || str === '\x1b[1;5C') {
        cursorPos = findNextWordEnd(input, cursorPos);
        drawInputFrame(input, cursorPos, options);
        return;
      }

      // Option+Up or Ctrl+Up - jump 5 lines up
      // Option: \x1b[1;3A, Ctrl: \x1b[1;5A
      if (str === '\x1b[1;3A' || str === '\x1b[1;5A') {
        const termWidth = process.stdout.columns || 80;
        const prefixWidth = 3;
        const metrics = getMultilineMetrics(input, cursorPos, termWidth, prefixWidth);
        const targetRow = Math.max(0, metrics.cursorVisualRow - 5);
        if (targetRow !== metrics.cursorVisualRow) {
          cursorPos = findCharPosForVisualPosition(input, targetRow, metrics.cursorVisualCol, termWidth, prefixWidth);
          drawInputFrame(input, cursorPos, options);
        }
        return;
      }

      // Option+Down or Ctrl+Down - jump 5 lines down
      // Option: \x1b[1;3B, Ctrl: \x1b[1;5B
      if (str === '\x1b[1;3B' || str === '\x1b[1;5B') {
        const termWidth = process.stdout.columns || 80;
        const prefixWidth = 3;
        const metrics = getMultilineMetrics(input, cursorPos, termWidth, prefixWidth);
        const targetRow = Math.min(metrics.totalVisualLines - 1, metrics.cursorVisualRow + 5);
        if (targetRow !== metrics.cursorVisualRow) {
          cursorPos = findCharPosForVisualPosition(input, targetRow, metrics.cursorVisualCol, termWidth, prefixWidth);
          drawInputFrame(input, cursorPos, options);
        }
        return;
      }

      // Option+Backspace - delete previous word
      // macOS sends \x1b\x7f (ESC DEL)
      if (str === '\x1b\x7f') {
        const newPos = findPrevWordStart(input, cursorPos);
        input = input.slice(0, newPos) + input.slice(cursorPos);
        cursorPos = newPos;
        historyIndex = -1;  // Reset history browsing
        drawInputFrame(input, cursorPos, options);
        return;
      }

      // Ctrl+W - delete previous word (bash-style)
      if (str === '\x17') {
        const newPos = findPrevWordStart(input, cursorPos);
        input = input.slice(0, newPos) + input.slice(cursorPos);
        cursorPos = newPos;
        historyIndex = -1;  // Reset history browsing
        drawInputFrame(input, cursorPos, options);
        return;
      }

      // Option+Delete or Ctrl+Delete - delete next word
      // Option: \x1bd (ESC d) or \x1b[3;3~
      // Ctrl: \x1b[3;5~
      if (str === '\x1bd' || str === '\x1b[3;3~' || str === '\x1b[3;5~') {
        const endPos = findNextWordEnd(input, cursorPos);
        input = input.slice(0, cursorPos) + input.slice(endPos);
        historyIndex = -1;  // Reset history browsing
        drawInputFrame(input, cursorPos, options);
        return;
      }

      // Forward delete (Fn+Backspace on Mac, Delete key)
      // Sends \x1b[3~
      if (str === '\x1b[3~') {
        if (cursorPos < input.length) {
          input = input.slice(0, cursorPos) + input.slice(cursorPos + 1);
          historyIndex = -1;  // Reset history browsing
          drawInputFrame(input, cursorPos, options);
        }
        return;
      }

      if (str === '\x1b[A') {
        // Up arrow - navigate autocomplete when visible, otherwise normal behavior
        if (slashCommandAutocomplete.isVisible()) {
          slashCommandAutocomplete.moveUp();
          drawInputFrame(input, cursorPos, options);
          return;
        }

        // Navigate visual lines (including newlines), then jump to beginning, then history
        const termWidth = process.stdout.columns || 80;
        const prefixWidth = 3;
        const metrics = getMultilineMetrics(input, cursorPos, termWidth, prefixWidth);

        if (metrics.cursorVisualRow > 0) {
          // Move cursor up one visual row - find char position for target row
          const targetRow = metrics.cursorVisualRow - 1;
          const targetCol = metrics.cursorVisualCol;
          cursorPos = findCharPosForVisualPosition(input, targetRow, targetCol, termWidth, prefixWidth);
          drawInputFrame(input, cursorPos, options);
        } else if (cursorPos > 0) {
          // At first visual row but not at beginning - jump to beginning
          cursorPos = 0;
          drawInputFrame(input, cursorPos, options);
        } else {
          // At first visual row AND at beginning - access history
          if (inputHistory.length > 0 && historyIndex < inputHistory.length - 1) {
            historyIndex++;
            input = inputHistory[inputHistory.length - 1 - historyIndex] || '';
            cursorPos = input.length;
            drawInputFrame(input, cursorPos, options);
          }
        }
        return;
      }

      if (str === '\x1b[B') {
        // Down arrow - navigate autocomplete when visible, otherwise normal behavior
        if (slashCommandAutocomplete.isVisible()) {
          slashCommandAutocomplete.moveDown();
          drawInputFrame(input, cursorPos, options);
          return;
        }

        // Navigate visual lines (including newlines), then jump to end of text
        const termWidth = process.stdout.columns || 80;
        const prefixWidth = 3;
        const metrics = getMultilineMetrics(input, cursorPos, termWidth, prefixWidth);

        if (metrics.cursorVisualRow < metrics.totalVisualLines - 1) {
          // Move cursor down one visual row - find char position for target row
          const targetRow = metrics.cursorVisualRow + 1;
          const targetCol = metrics.cursorVisualCol;
          cursorPos = findCharPosForVisualPosition(input, targetRow, targetCol, termWidth, prefixWidth);
          drawInputFrame(input, cursorPos, options);
        } else if (cursorPos < input.length) {
          // At last visual row but not at end - jump to end of text
          cursorPos = input.length;
          drawInputFrame(input, cursorPos, options);
        }
        // If already at end of last row, do nothing
        return;
      }

      if (str === '\x01') {
        // Ctrl+A - start of line
        cursorPos = 0;
        drawInputFrame(input, cursorPos, options);
        return;
      }

      if (str === '\x05') {
        // Ctrl+E - toggle document expand/collapse
        if (options.onToggleDocuments) {
          options.onToggleDocuments();
          drawInputFrame(input, cursorPos, options);
        }
        return;
      }

      if (str === '\x0b') {
        // Ctrl+K - kill to end of line
        input = input.slice(0, cursorPos);
        historyIndex = -1;  // Reset history browsing
        drawInputFrame(input, cursorPos, options);
        return;
      }

      if (str === '\x15') {
        // Ctrl+U - kill whole line
        input = '';
        cursorPos = 0;
        historyIndex = -1;  // Reset history browsing
        drawInputFrame(input, cursorPos, options);
        return;
      }

      // Regular character input (handles both single chars and paste)
      // Strip bracketed paste mode markers if present
      let cleanStr = str;
      if (cleanStr.includes(PASTE_START)) {
        cleanStr = cleanStr.replace(PASTE_START, '');
      }
      if (cleanStr.includes(PASTE_END)) {
        cleanStr = cleanStr.replace(PASTE_END, '');
      }

      // Normalize line endings: \r\n -> \n, \r -> \n
      cleanStr = cleanStr.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // Filter to printable characters and newlines (including Unicode)
      let printable = '';
      for (const char of cleanStr) {
        const code = char.codePointAt(0) || 0;
        // Accept printable ASCII, newlines, and all Unicode above ASCII
        // Reject control characters (0x00-0x1F except newline 0x0A, and 0x7F)
        if ((code >= 0x20 && code !== 0x7F) || code === 0x0A) {
          printable += char;
        }
      }

      if (printable.length > 0) {
        // Insert all printable characters at cursor position
        input = input.slice(0, cursorPos) + printable + input.slice(cursorPos);
        cursorPos += printable.length;
        historyIndex = -1;  // Reset history browsing when input is modified

        // Update autocomplete suggestions
        updateAutocomplete();

        // For paste (multiple characters), do immediate redraw to keep cursor in sync
        // For single char, use debounced redraw
        if (printable.length > 1) {
          if (drawTimeout) {
            clearTimeout(drawTimeout);
            drawTimeout = null;
          }
          drawInputFrame(input, cursorPos, options);
        } else {
          scheduleRedraw();
        }
      }
    };

    process.stdin.on('data', handleData);
  });
}

/**
 * Simple wrapper that mimics readline.question interface
 */
export function createRawReadline(options: RawInputOptions) {
  return {
    question: async (_prompt: string, callback: (answer: string) => void) => {
      const answer = await rawQuestion(options);
      callback(answer);
    },
    close: () => {
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch {
          // Ignore errors if stdin is already closed or in unexpected state
        }
      }
    }
  };
}
