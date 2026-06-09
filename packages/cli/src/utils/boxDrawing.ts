/**
 * Box drawing utilities for creating bordered content
 * Uses Unicode box-drawing characters
 */

export interface BoxOptions {
  title?: string;
  color?: (text: string) => string;
  padding?: number;
  width?: number;
}

/**
 * Box drawing characters
 */
const CHARS = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  teeDown: '┬',
  teeUp: '┴',
  teeRight: '├',
  teeLeft: '┤',
};

/**
 * Create a bordered box around content
 */
export function createBox(content: string, options: BoxOptions = {}): string {
  const {
    title,
    color = (s: string) => s,
    padding = 1,
    width,
  } = options;

  const lines = content.split('\n');
  const contentWidth = width || Math.max(
    ...lines.map(l => l.length),
    title ? title.length + 2 : 0
  );

  const pad = ' '.repeat(padding);
  const horizontalLine = CHARS.horizontal.repeat(contentWidth + padding * 2);

  // Top border
  let result = color(CHARS.topLeft + horizontalLine + CHARS.topRight) + '\n';

  // Title if provided
  if (title) {
    const titlePadding = Math.max(0, contentWidth - title.length);
    const leftPad = Math.floor(titlePadding / 2);
    const rightPad = titlePadding - leftPad;
    result += color(CHARS.vertical) + pad +
      ' '.repeat(leftPad) + title + ' '.repeat(rightPad) +
      pad + color(CHARS.vertical) + '\n';
    result += color(CHARS.teeRight + horizontalLine + CHARS.teeLeft) + '\n';
  }

  // Content lines
  for (const line of lines) {
    const linePadding = ' '.repeat(Math.max(0, contentWidth - line.length));
    result += color(CHARS.vertical) + pad + line + linePadding + pad + color(CHARS.vertical) + '\n';
  }

  // Bottom border
  result += color(CHARS.bottomLeft + horizontalLine + CHARS.bottomRight);

  return result;
}

/**
 * Create a simple horizontal divider
 */
export function createDivider(length: number = 50, char: string = CHARS.horizontal, color?: (text: string) => string): string {
  const line = char.repeat(length);
  return color ? color(line) : line;
}

/**
 * Wrap text to a specific width
 */
export function wrapText(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + word).length > width) {
      if (currentLine) lines.push(currentLine.trim());
      currentLine = word + ' ';
    } else {
      currentLine += word + ' ';
    }
  }

  if (currentLine) lines.push(currentLine.trim());

  return lines;
}
