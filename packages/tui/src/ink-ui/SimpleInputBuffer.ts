/**
 * Simple Input Buffer for Nexus Cortex Ink UI
 *
 * A standalone text buffer implementation that handles:
 * - Cursor navigation (arrow keys, home, end, word movement)
 * - Text insertion with proper cursor positioning
 * - Paste support via bracketed paste mode
 * - Multi-line editing
 * - Undo support
 *
 * This is a simplified version that doesn't require the complex
 * gemini-cli infrastructure.
 */

export interface InputBufferState {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
  undoStack: { lines: string[]; cursorRow: number; cursorCol: number }[];
}

export interface InputBuffer {
  lines: string[];
  text: string;
  cursor: [number, number];
  setText: (text: string) => void;
  insert: (text: string, options?: { isPaste?: boolean }) => void;
  backspace: () => void;
  delete: () => void;
  deleteWordLeft: () => void;
  moveLeft: () => void;
  moveRight: () => void;
  moveUp: () => void;
  moveDown: () => void;
  moveWordLeft: () => void;
  moveWordRight: () => void;
  moveHome: () => void;
  moveEnd: () => void;
  newline: () => void;
  undo: () => void;
}

/**
 * Create a simple input buffer for text editing
 */
export function createInputBuffer(): InputBuffer {
  let state: InputBufferState = {
    lines: [''],
    cursorRow: 0,
    cursorCol: 0,
    undoStack: [],
  };

  const getText = (): string => state.lines.join('\n');

  const pushUndo = () => {
    state.undoStack.push({
      lines: [...state.lines],
      cursorRow: state.cursorRow,
      cursorCol: state.cursorCol,
    });
    // Limit undo stack size
    if (state.undoStack.length > 100) {
      state.undoStack.shift();
    }
  };

  const setText = (text: string) => {
    pushUndo();
    state.lines = text.split('\n');
    if (state.lines.length === 0) state.lines = [''];
    // Move cursor to end
    state.cursorRow = state.lines.length - 1;
    state.cursorCol = state.lines[state.cursorRow].length;
  };

  const insert = (text: string, options?: { isPaste?: boolean }) => {
    pushUndo();

    // Normalize line endings for any text with newlines
    const normalizedText = text
      .replace(/\r\n/g, '\n')  // Windows CRLF -> LF
      .replace(/\r/g, '\n');   // Old Mac CR -> LF

    // Handle paste or text with newlines
    if (options?.isPaste || normalizedText.includes('\n')) {
      const parts = normalizedText.split('\n');
      const currentLine = state.lines[state.cursorRow] || '';
      const before = currentLine.slice(0, state.cursorCol);
      const after = currentLine.slice(state.cursorCol);

      if (parts.length === 1) {
        // Single line paste/insert
        state.lines[state.cursorRow] = before + parts[0] + after;
        state.cursorCol = before.length + parts[0].length;
      } else {
        // Multi-line paste/insert
        // First line: content before cursor + first part of paste
        const firstLine = before + parts[0];
        // Middle lines: unchanged from paste
        const middleLines = parts.slice(1, -1);
        // Last line: last part of paste + content after cursor
        const lastPart = parts[parts.length - 1] || '';
        const lastLine = lastPart + after;

        // Build the new lines array
        const newLines = [firstLine, ...middleLines, lastLine];

        // Replace current line with all new lines
        state.lines.splice(state.cursorRow, 1, ...newLines);

        // Move cursor to end of pasted content (before 'after')
        state.cursorRow += parts.length - 1;
        state.cursorCol = lastPart.length;
      }
      return;
    }

    // Single character insert (no newlines)
    const currentLine = state.lines[state.cursorRow] || '';
    state.lines[state.cursorRow] =
      currentLine.slice(0, state.cursorCol) + normalizedText + currentLine.slice(state.cursorCol);
    state.cursorCol += normalizedText.length;
  };

  const backspace = () => {
    if (state.cursorCol > 0) {
      pushUndo();
      const currentLine = state.lines[state.cursorRow];
      state.lines[state.cursorRow] =
        currentLine.slice(0, state.cursorCol - 1) + currentLine.slice(state.cursorCol);
      state.cursorCol--;
    } else if (state.cursorRow > 0) {
      pushUndo();
      const currentLine = state.lines[state.cursorRow];
      const prevLine = state.lines[state.cursorRow - 1];
      state.cursorCol = prevLine.length;
      state.lines[state.cursorRow - 1] = prevLine + currentLine;
      state.lines.splice(state.cursorRow, 1);
      state.cursorRow--;
    }
  };

  const del = () => {
    const currentLine = state.lines[state.cursorRow];
    if (state.cursorCol < currentLine.length) {
      pushUndo();
      state.lines[state.cursorRow] =
        currentLine.slice(0, state.cursorCol) + currentLine.slice(state.cursorCol + 1);
    } else if (state.cursorRow < state.lines.length - 1) {
      pushUndo();
      state.lines[state.cursorRow] = currentLine + state.lines[state.cursorRow + 1];
      state.lines.splice(state.cursorRow + 1, 1);
    }
  };

  const deleteWordLeft = () => {
    if (state.cursorCol === 0 && state.cursorRow === 0) return;

    pushUndo();
    const line = state.lines[state.cursorRow] || '';

    // If at start of line, join with previous line
    if (state.cursorCol === 0 && state.cursorRow > 0) {
      const prevLine = state.lines[state.cursorRow - 1] || '';
      state.cursorCol = prevLine.length;
      state.lines[state.cursorRow - 1] = prevLine + line;
      state.lines.splice(state.cursorRow, 1);
      state.cursorRow--;
      return;
    }

    // Find word boundary to the left
    let col = state.cursorCol;
    // Skip spaces
    while (col > 0 && line[col - 1] === ' ') col--;
    // Skip word chars
    while (col > 0 && line[col - 1] !== ' ') col--;

    // Delete from col to cursorCol
    state.lines[state.cursorRow] = line.slice(0, col) + line.slice(state.cursorCol);
    state.cursorCol = col;
  };

  const moveLeft = () => {
    if (state.cursorCol > 0) {
      state.cursorCol--;
    } else if (state.cursorRow > 0) {
      state.cursorRow--;
      state.cursorCol = state.lines[state.cursorRow].length;
    }
  };

  const moveRight = () => {
    const currentLine = state.lines[state.cursorRow];
    if (state.cursorCol < currentLine.length) {
      state.cursorCol++;
    } else if (state.cursorRow < state.lines.length - 1) {
      state.cursorRow++;
      state.cursorCol = 0;
    }
  };

  const moveUp = () => {
    if (state.cursorRow > 0) {
      state.cursorRow--;
      state.cursorCol = Math.min(state.cursorCol, state.lines[state.cursorRow].length);
    }
  };

  const moveDown = () => {
    if (state.cursorRow < state.lines.length - 1) {
      state.cursorRow++;
      state.cursorCol = Math.min(state.cursorCol, state.lines[state.cursorRow].length);
    }
  };

  const moveWordLeft = () => {
    const line = state.lines[state.cursorRow];
    if (state.cursorCol === 0 && state.cursorRow > 0) {
      state.cursorRow--;
      state.cursorCol = state.lines[state.cursorRow].length;
      return;
    }

    let col = state.cursorCol - 1;
    // Skip spaces
    while (col > 0 && line[col] === ' ') col--;
    // Skip word chars
    while (col > 0 && line[col - 1] !== ' ') col--;
    state.cursorCol = col;
  };

  const moveWordRight = () => {
    const line = state.lines[state.cursorRow];
    if (state.cursorCol >= line.length && state.cursorRow < state.lines.length - 1) {
      state.cursorRow++;
      state.cursorCol = 0;
      return;
    }

    let col = state.cursorCol;
    // Skip word chars
    while (col < line.length && line[col] !== ' ') col++;
    // Skip spaces
    while (col < line.length && line[col] === ' ') col++;
    state.cursorCol = col;
  };

  const moveHome = () => {
    state.cursorCol = 0;
  };

  const moveEnd = () => {
    state.cursorCol = state.lines[state.cursorRow].length;
  };

  const newline = () => {
    pushUndo();
    const currentLine = state.lines[state.cursorRow];
    const before = currentLine.slice(0, state.cursorCol);
    const after = currentLine.slice(state.cursorCol);
    state.lines[state.cursorRow] = before;
    state.lines.splice(state.cursorRow + 1, 0, after);
    state.cursorRow++;
    state.cursorCol = 0;
  };

  const undo = () => {
    const prev = state.undoStack.pop();
    if (prev) {
      state.lines = prev.lines;
      state.cursorRow = prev.cursorRow;
      state.cursorCol = prev.cursorCol;
    }
  };

  return {
    get lines() { return state.lines; },
    get text() { return getText(); },
    get cursor(): [number, number] { return [state.cursorRow, state.cursorCol]; },
    setText,
    insert,
    backspace,
    delete: del,
    deleteWordLeft,
    moveLeft,
    moveRight,
    moveUp,
    moveDown,
    moveWordLeft,
    moveWordRight,
    moveHome,
    moveEnd,
    newline,
    undo,
  };
}

/**
 * Parse raw stdin data for bracketed paste and key sequences
 * Returns an array of parsed events
 */
export interface ParsedKey {
  type: 'char' | 'paste' | 'special';
  value: string;
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

const ESCAPE_SEQUENCES: Record<string, { name: string; ctrl?: boolean; shift?: boolean }> = {
  '[A': { name: 'up' },
  '[B': { name: 'down' },
  '[C': { name: 'right' },
  '[D': { name: 'left' },
  '[H': { name: 'home' },
  '[F': { name: 'end' },
  '[1~': { name: 'home' },
  '[4~': { name: 'end' },
  '[3~': { name: 'delete' },
  '[5~': { name: 'pageup' },
  '[6~': { name: 'pagedown' },
  '[1;5C': { name: 'right', ctrl: true }, // Ctrl+Right
  '[1;5D': { name: 'left', ctrl: true },  // Ctrl+Left
  '[1;5A': { name: 'up', ctrl: true },    // Ctrl+Up
  '[1;5B': { name: 'down', ctrl: true },  // Ctrl+Down
  'OA': { name: 'up' },
  'OB': { name: 'down' },
  'OC': { name: 'right' },
  'OD': { name: 'left' },
  'OH': { name: 'home' },
  'OF': { name: 'end' },
  '[Z': { name: 'tab', shift: true },
};

export function parseRawInput(data: string): ParsedKey[] {
  const results: ParsedKey[] = [];
  let i = 0;

  while (i < data.length) {
    const char = data[i];

    // Check for bracketed paste start
    if (data.slice(i, i + 6) === '\x1b[200~') {
      const endIdx = data.indexOf('\x1b[201~', i + 6);
      if (endIdx !== -1) {
        const pasteContent = data.slice(i + 6, endIdx);
        results.push({ type: 'paste', value: pasteContent });
        i = endIdx + 6;
        continue;
      }
    }

    // Check for escape sequence
    if (char === '\x1b') {
      // Check for known sequences
      let matched = false;
      for (const [seq, info] of Object.entries(ESCAPE_SEQUENCES)) {
        if (data.slice(i + 1, i + 1 + seq.length) === seq) {
          results.push({
            type: 'special',
            value: '\x1b' + seq,
            name: info.name,
            ctrl: info.ctrl,
            shift: info.shift,
          });
          i += 1 + seq.length;
          matched = true;
          break;
        }
      }

      if (!matched) {
        // Unknown escape sequence or just Escape key
        // Try to skip entire sequence
        let j = i + 1;
        if (j < data.length && (data[j] === '[' || data[j] === 'O')) {
          j++;
          // Skip digits and semicolons
          while (j < data.length && /[0-9;]/.test(data[j])) j++;
          // Include final char if it's a letter
          if (j < data.length && /[a-zA-Z~$^]/.test(data[j])) j++;
        }

        if (j === i + 1) {
          // Just Escape key
          results.push({ type: 'special', value: '\x1b', name: 'escape' });
          i++;
        } else {
          // Unknown sequence - skip it
          i = j;
        }
      }
      continue;
    }

    // Control characters
    if (char === '\r') {
      results.push({ type: 'special', value: '\r', name: 'return' });
      i++;
      continue;
    }
    if (char === '\n') {
      results.push({ type: 'special', value: '\n', name: 'enter' });
      i++;
      continue;
    }
    if (char === '\t') {
      results.push({ type: 'special', value: '\t', name: 'tab' });
      i++;
      continue;
    }
    if (char === '\x7f' || char === '\b') {
      results.push({ type: 'special', value: char, name: 'backspace' });
      i++;
      continue;
    }

    // Ctrl combinations
    const code = char.charCodeAt(0);
    if (code < 32) {
      const letter = String.fromCharCode(code + 96); // 'a' = 97, Ctrl+A = 1
      results.push({ type: 'special', value: char, name: letter, ctrl: true });
      i++;
      continue;
    }

    // Regular character
    results.push({ type: 'char', value: char });
    i++;
  }

  return results;
}
