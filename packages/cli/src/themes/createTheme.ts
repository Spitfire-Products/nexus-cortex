/**
 * Theme factory - Creates Theme objects from theme definitions
 */

import chalk from 'chalk';
import { Theme, ThemeColors, ThemeIcons } from './Theme.interface.js';
import { ThemeDefinition } from './themeDefinitions.js';

/**
 * Create a Theme object from a theme definition
 */
export function createTheme(definition: ThemeDefinition): Theme {
  const colors: ThemeColors = {
    primary: (text: string) => chalk.hex(definition.primary)(text),
    secondary: (text: string) => chalk.hex(definition.secondary)(text),
    success: (text: string) => chalk.hex(definition.success)(text),
    error: (text: string) => chalk.hex(definition.error)(text),
    warning: (text: string) => chalk.hex(definition.warning)(text),
    info: (text: string) => chalk.hex(definition.info)(text),
    muted: (text: string) => chalk.hex(definition.dimmed)(text),
    highlight: (text: string) => chalk.hex(definition.accent || definition.secondary).bold(text),
    text: (text: string) => chalk.hex(definition.text)(text),
  };

  const icons: ThemeIcons = {
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: 'ℹ',
    loading: '⏳',
  };

  return {
    name: definition.name,
    colors,
    icons,
  };
}

/**
 * Extended theme with additional formatting functions
 */
export interface ExtendedTheme extends Theme {
  // Color functions with direct access
  text: (str: string) => string;
  dimmed: (str: string) => string;
  keyword: (str: string) => string;
  function: (str: string) => string;
  string: (str: string) => string;
  number: (str: string) => string;
  variable: (str: string) => string;
  comment: (str: string) => string;

  // Message formatters
  successMessage: (text: string) => string;
  errorMessage: (text: string) => string;
  warningMessage: (text: string) => string;
  infoMessage: (text: string) => string;
  debugMessage: (text: string) => string;

  // Tool formatting
  toolPending: (name: string, args: string) => string;
  toolRunning: (name: string, args: string) => string;
  toolSuccess: (name: string, args: string) => string;
  toolError: (name: string, args: string, error: string) => string;

  // Progress bars
  progressBar: (percent: number, width?: number) => string;

  // Box drawing
  singleBox: (content: string, title?: string) => string;
  doubleBox: (content: string, title?: string) => string;
  roundedBox: (content: string, title?: string) => string;
}

/**
 * Create an extended theme with all formatting functions
 */
export function createExtendedTheme(definition: ThemeDefinition): ExtendedTheme {
  const base = createTheme(definition);

  // Direct color accessors
  const text = (str: string) => chalk.hex(definition.text)(str);
  const dimmed = (str: string) => chalk.hex(definition.dimmed)(str);
  const keyword = (str: string) => chalk.hex(definition.keyword)(str);
  const functionColor = (str: string) => chalk.hex(definition.function)(str);
  const stringColor = (str: string) => chalk.hex(definition.string)(str);
  const numberColor = (str: string) => chalk.hex(definition.number)(str);
  const variable = (str: string) => chalk.hex(definition.variable)(str);
  const comment = (str: string) => chalk.hex(definition.comment)(str);

  // Message formatters
  const successMessage = (msg: string) => base.colors.success('✓ ') + text(msg);
  const errorMessage = (msg: string) => base.colors.error('✗ ') + text(msg);
  const warningMessage = (msg: string) => base.colors.warning('⚠ ') + text(msg);
  const infoMessage = (msg: string) => base.colors.info('ℹ ') + text(msg);
  const debugMessage = (msg: string) => dimmed('● ' + msg);

  // Tool formatters
  const toolPending = (name: string, args: string) =>
    dimmed('⏳ ') + base.colors.primary(name) + dimmed(`(${args})`);

  const toolRunning = (name: string, args: string) =>
    base.colors.info('⚙  ') + base.colors.primary(name) + dimmed(`(${args})`);

  const toolSuccess = (name: string, args: string) =>
    base.colors.success('✓ ') + base.colors.primary(name) + dimmed(`(${args})`);

  const toolError = (name: string, args: string, error: string) =>
    base.colors.error('✗ ') + base.colors.primary(name) + dimmed(`(${args})`) + base.colors.error(` - ${error}`);

  // Progress bar
  const progressBar = (percent: number, width = 30) => {
    const filled = Math.round(width * percent);
    const empty = width - filled;
    return '[' +
           base.colors.success('█'.repeat(filled)) +
           dimmed('░'.repeat(empty)) +
           '] ' +
           base.colors.warning(`${Math.round(percent * 100)}%`);
  };

  // Box drawing helpers
  const createBox = (
    content: string,
    title: string,
    chars: { tl: string; tr: string; bl: string; br: string; h: string; v: string },
    colorFn: (text: string) => string
  ): string => {
    const lines = content.split('\n');
    const maxLength = Math.max(...lines.map(l => l.length), title ? title.length + 4 : 0);
    const output: string[] = [];

    if (title) {
      output.push(colorFn(chars.tl + chars.h + ' ' + title + ' ' + chars.h.repeat(Math.max(0, maxLength - title.length - 4)) + chars.tr));
    } else {
      output.push(colorFn(chars.tl + chars.h.repeat(maxLength) + chars.tr));
    }

    lines.forEach(line => {
      const padding = maxLength - line.length;
      output.push(colorFn(chars.v + ' ') + line + ' '.repeat(Math.max(0, padding - 2)) + colorFn(' ' + chars.v));
    });

    output.push(colorFn(chars.bl + chars.h.repeat(maxLength) + chars.br));

    return output.join('\n');
  };

  const singleBox = (content: string, title = '') =>
    createBox(content, title, { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' }, base.colors.primary);

  const doubleBox = (content: string, title = '') =>
    createBox(content, title, { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' }, base.colors.secondary);

  const roundedBox = (content: string, title = '') =>
    createBox(content, title, { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' }, base.colors.info);

  return {
    ...base,
    text,
    dimmed,
    keyword,
    function: functionColor,
    string: stringColor,
    number: numberColor,
    variable,
    comment,
    successMessage,
    errorMessage,
    warningMessage,
    infoMessage,
    debugMessage,
    toolPending,
    toolRunning,
    toolSuccess,
    toolError,
    progressBar,
    singleBox,
    doubleBox,
    roundedBox,
  };
}
