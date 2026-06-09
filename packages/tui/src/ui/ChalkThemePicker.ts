/**
 * Chalk-based Theme Picker for Nexus Cortex
 *
 * Interactive terminal UI for selecting themes using raw terminal input.
 * Shows full color palettes for each theme with rich visual preview.
 */

import chalk from 'chalk';
import { ThemeManager, AvailableTheme } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';
import { loadPersistedThemeForPlatform, type Platform } from '@nexus-cortex/cli/dist/themes/colors.js';
import { themeDefinitions, ThemeDefinition } from '@nexus-cortex/cli/dist/themes/themeDefinitions.js';

// Platform identifier for fuzzycortex CLI
const PLATFORM: Platform = 'fuzzycortex';

// ANSI escape codes
const ESC = '\x1b';
const CSI = `${ESC}[`;

const ANSI = {
  clearLine: `${CSI}2K`,
  clearToEnd: `${CSI}0K`,
  clearScreen: `${CSI}2J`,
  cursorUp: (n: number) => `${CSI}${n}A`,
  cursorDown: (n: number) => `${CSI}${n}B`,
  cursorToColumn: (n: number) => `${CSI}${n}G`,
  cursorHome: `${CSI}H`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  saveCursor: `${ESC}7`,
  restoreCursor: `${ESC}8`,
};

// Theme descriptions for display
const THEME_DESCRIPTIONS: Record<string, string> = {
  default: 'GitHub-inspired default styling',
  minimal: 'Plain text for maximum compatibility',
  vscodeOneDark: 'Popular VS Code dark theme',
  monokai: 'Classic editor theme for code',
  dracula: 'Vibrant modern dark theme',
  githubLight: 'Clean light background theme',
  solarizedDark: 'Precision colors for long reading',
  tokyoNight: 'Purple-accented dark theme',
  nord: 'Arctic blue-gray minimal theme',
  gruvboxDark: 'Retro warm colors',
  materialOcean: 'Material design dark theme',
  atomOneLight: 'Atom editor light theme',
  palenight: 'Elegant material dark theme',
  cobalt2: 'Vibrant blue/yellow high energy',
  aura: 'Purple-based creative dark theme',
};

// Default theme colors (GitHub-inspired)
const DEFAULT_THEME: ThemeDefinition = {
  name: 'Default',
  primary: '#58a6ff',
  secondary: '#a371f7',
  success: '#3fb950',
  warning: '#d29922',
  error: '#f85149',
  info: '#58a6ff',
  text: '#c9d1d9',
  dimmed: '#8b949e',
  background: '#0d1117',
  keyword: '#ff7b72',
  function: '#d2a8ff',
  string: '#a5d6ff',
  number: '#79c0ff',
  variable: '#ffa657',
  comment: '#8b949e',
};

interface ThemePickerResult {
  selected: boolean;
  theme?: string;
}

/**
 * Get theme definition, with fallbacks for default and minimal
 */
function getThemeDef(themeName: string): ThemeDefinition | null {
  if (themeName === 'minimal') return null;
  if (themeName === 'default') return DEFAULT_THEME;
  return themeDefinitions[themeName as keyof typeof themeDefinitions] || null;
}

/**
 * Render a color swatch (colored block)
 */
function colorSwatch(color: string): string {
  return chalk.hex(color)('██');
}

/**
 * Render a small color dot
 */
function colorDot(color: string): string {
  return chalk.hex(color)('●');
}

/**
 * Draw a single theme list item with its color palette
 */
function drawThemeListItem(
  theme: string,
  def: ThemeDefinition | null,
  isSelected: boolean,
  isCurrent: boolean
): string {
  const themeName = theme.charAt(0).toUpperCase() + theme.slice(1);

  let line = ' ';

  // Selection indicator
  if (isSelected) {
    line += chalk.cyan.bold('▸ ');
  } else {
    line += ' ';
  }

  if (def) {
    // Show theme name in its primary color
    if (isSelected) {
      line += chalk.hex(def.primary).bold(themeName.padEnd(16));
    } else {
      line += chalk.hex(def.primary)(themeName.padEnd(16));
    }

    // Color palette swatches (mini preview)
    line += colorDot(def.primary) + ' ';
    line += colorDot(def.secondary) + ' ';
    line += colorDot(def.success) + ' ';
    line += colorDot(def.warning) + ' ';
    line += colorDot(def.error) + ' ';
    line += colorDot(def.info) + ' ';

    // Current indicator
    if (isCurrent) {
      line += chalk.hex(def.warning)(' ★');
    }
  } else {
    // Minimal theme - no colors
    if (isSelected) {
      line += chalk.white.bold(themeName.padEnd(16));
    } else {
      line += chalk.white(themeName.padEnd(16));
    }
    line += chalk.dim('○ ○ ○ ○ ○ ○');
    if (isCurrent) {
      line += chalk.yellow(' ★');
    }
  }

  return line;
}

/**
 * Draw the full color palette preview for a theme
 */
function drawColorPalette(def: ThemeDefinition): string[] {
  const lines: string[] = [];

  // UI Colors section
  lines.push(chalk.hex(def.text).bold(' UI Colors'));
  lines.push(
    ` ${colorSwatch(def.primary)} ${chalk.hex(def.primary)('Primary')}   ` +
    `${colorSwatch(def.secondary)} ${chalk.hex(def.secondary)('Secondary')}   ` +
    `${colorSwatch(def.text)} ${chalk.hex(def.text)('Text')}`
  );
  lines.push(
    ` ${colorSwatch(def.success)} ${chalk.hex(def.success)('Success')}   ` +
    `${colorSwatch(def.warning)} ${chalk.hex(def.warning)('Warning')}     ` +
    `${colorSwatch(def.error)} ${chalk.hex(def.error)('Error')}`
  );
  lines.push(
    ` ${colorSwatch(def.info)} ${chalk.hex(def.info)('Info')}      ` +
    `${colorSwatch(def.dimmed)} ${chalk.hex(def.dimmed)('Dimmed')}`
  );

  lines.push('');

  // Syntax Highlighting section
  lines.push(chalk.hex(def.text).bold(' Syntax Highlighting'));
  lines.push(
    ` ${colorSwatch(def.keyword)} ${chalk.hex(def.keyword)('keyword')}   ` +
    `${colorSwatch(def.function)} ${chalk.hex(def.function)('function')}   ` +
    `${colorSwatch(def.string)} ${chalk.hex(def.string)('string')}`
  );
  lines.push(
    ` ${colorSwatch(def.number)} ${chalk.hex(def.number)('number')}    ` +
    `${colorSwatch(def.variable)} ${chalk.hex(def.variable)('variable')}   ` +
    `${colorSwatch(def.comment)} ${chalk.hex(def.comment)('comment')}`
  );

  lines.push('');

  // Status Messages preview
  lines.push(chalk.hex(def.text).bold(' Message Examples'));
  lines.push(` ${chalk.hex(def.success)('✓')} ${chalk.hex(def.text)('Build completed successfully')}`);
  lines.push(` ${chalk.hex(def.error)('✗')} ${chalk.hex(def.text)('Failed to compile: syntax error')}`);
  lines.push(` ${chalk.hex(def.warning)('⚠')} ${chalk.hex(def.text)('Deprecated API usage detected')}`);
  lines.push(` ${chalk.hex(def.info)('ℹ')} ${chalk.hex(def.text)('Running in development mode')}`);
  lines.push(` ${chalk.hex(def.dimmed)('• Muted informational text')}`);

  lines.push('');

  // Code preview
  lines.push(chalk.hex(def.text).bold(' Code Preview'));
  lines.push(
    ` ${chalk.hex(def.keyword)('const')} ` +
    `${chalk.hex(def.variable)('message')} ${chalk.hex(def.text)('=')} ` +
    `${chalk.hex(def.string)('"Hello, World!"')};`
  );
  lines.push(
    ` ${chalk.hex(def.keyword)('function')} ` +
    `${chalk.hex(def.function)('greet')}${chalk.hex(def.text)('(')}` +
    `${chalk.hex(def.variable)('name')}${chalk.hex(def.text)(') {')}` +
    ` ${chalk.hex(def.comment)('// Say hello')}`
  );
  lines.push(
    ` ${chalk.hex(def.keyword)('return')} ` +
    `${chalk.hex(def.string)('\`Hello, \${')}${chalk.hex(def.variable)('name')}${chalk.hex(def.string)('}!\`')};`
  );
  lines.push(` ${chalk.hex(def.text)('}')}`);

  return lines;
}

/**
 * Draw the theme picker UI
 */
function drawThemePicker(
  themes: AvailableTheme[],
  selectedIndex: number,
  currentTheme: string,
  terminalWidth: number
): number {
  const width = Math.min(75, terminalWidth);
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(chalk.cyan.bold(' Nexus Cortex Theme Picker'));
  lines.push(chalk.dim('─'.repeat(width)));
  lines.push(chalk.dim(' ↑/↓ Navigate • Enter Select • Home/End Jump • Esc Exit'));
  lines.push('');

  // Theme list with color swatches
  for (let i = 0; i < themes.length; i++) {
    const theme = themes[i]!;
    const def = getThemeDef(theme);
    const isCurrent = theme === currentTheme;
    const isSelected = i === selectedIndex;

    lines.push(drawThemeListItem(theme, def, isSelected, isCurrent));
  }

  lines.push('');
  lines.push(chalk.dim('─'.repeat(width)));

  // Preview section with full color palette
  const previewTheme = themes[selectedIndex]!;
  const previewDef = getThemeDef(previewTheme);
  const description = THEME_DESCRIPTIONS[previewTheme] || previewTheme;

  lines.push('');

  if (previewDef) {
    // Theme name and description in theme colors
    const headerLine =
      chalk.hex(previewDef.primary).bold(` ◆ ${previewDef.name}`) +
      (previewTheme === currentTheme ? chalk.hex(previewDef.warning)(' ★ Current') : '') +
      chalk.hex(previewDef.dimmed)(` — ${description}`);
    lines.push(headerLine);
    lines.push('');

    // Full color palette
    const paletteLines = drawColorPalette(previewDef);
    lines.push(...paletteLines);
  } else {
    // Minimal theme
    lines.push(chalk.white.bold(` ◆ Minimal Theme`) +
      (previewTheme === currentTheme ? chalk.yellow(' ★ Current') : ''));
    lines.push('');
    lines.push(chalk.dim(' Plain text output with no color formatting.'));
    lines.push(chalk.dim(' Maximum compatibility for all terminals.'));
    lines.push('');
    lines.push(' ✓ Build completed successfully');
    lines.push(' ✗ Failed to compile: syntax error');
    lines.push(' ⚠ Deprecated API usage detected');
    lines.push(' ℹ Running in development mode');
  }

  lines.push('');
  lines.push(chalk.dim('─'.repeat(width)));
  lines.push(chalk.dim(` ★ = Currently active | ${themes.length} themes available | 13 professional + 2 built-in`));
  lines.push('');

  // Clear screen and draw
  process.stdout.write(ANSI.hideCursor);
  process.stdout.write(ANSI.cursorHome);
  process.stdout.write(ANSI.clearScreen);

  for (const line of lines) {
    process.stdout.write(line + '\n');
  }

  return lines.length;
}

/**
 * Interactive theme picker using raw terminal input
 */
export async function showThemePicker(): Promise<ThemePickerResult> {
  return new Promise((resolve) => {
    const themes = ThemeManager.getAvailableThemes();
    const currentTheme = loadPersistedThemeForPlatform(PLATFORM) || 'default';
    let selectedIndex = themes.indexOf(currentTheme as AvailableTheme);
    if (selectedIndex === -1) selectedIndex = 0;

    const terminalWidth = process.stdout.columns || 80;

    // Initial draw
    drawThemePicker(themes, selectedIndex, currentTheme, terminalWidth);

    // Enable raw mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.removeListener('data', handleData);
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch {
          // Ignore
        }
      }
      process.stdout.write(ANSI.showCursor);
      process.stdout.write(ANSI.clearScreen);
      process.stdout.write(ANSI.cursorHome);
    };

    const handleData = async (data: Buffer) => {
      const str = data.toString();

      // Up arrow or k (vim)
      if (str === '\x1b[A' || str === 'k') {
        if (selectedIndex > 0) {
          selectedIndex--;
          drawThemePicker(themes, selectedIndex, currentTheme, terminalWidth);
        }
        return;
      }

      // Down arrow or j (vim)
      if (str === '\x1b[B' || str === 'j') {
        if (selectedIndex < themes.length - 1) {
          selectedIndex++;
          drawThemePicker(themes, selectedIndex, currentTheme, terminalWidth);
        }
        return;
      }

      // Home key or g (vim) - go to first
      if (str === '\x1b[H' || str === '\x1b[1~' || str === '\x1bOH' || str === 'g') {
        selectedIndex = 0;
        drawThemePicker(themes, selectedIndex, currentTheme, terminalWidth);
        return;
      }

      // End key or G (vim) - go to last
      if (str === '\x1b[F' || str === '\x1b[4~' || str === '\x1bOF' || str === 'G') {
        selectedIndex = themes.length - 1;
        drawThemePicker(themes, selectedIndex, currentTheme, terminalWidth);
        return;
      }

      // Page Up - jump 5 up
      if (str === '\x1b[5~') {
        selectedIndex = Math.max(0, selectedIndex - 5);
        drawThemePicker(themes, selectedIndex, currentTheme, terminalWidth);
        return;
      }

      // Page Down - jump 5 down
      if (str === '\x1b[6~') {
        selectedIndex = Math.min(themes.length - 1, selectedIndex + 5);
        drawThemePicker(themes, selectedIndex, currentTheme, terminalWidth);
        return;
      }

      // Enter - select theme
      if (str === '\r' || str === '\n') {
        const selectedTheme = themes[selectedIndex]!;
        cleanup();

        // Apply the theme for fuzzycortex platform
        try {
          await ThemeManager.setThemeForPlatform(PLATFORM, selectedTheme);
          resolve({ selected: true, theme: selectedTheme });
        } catch (error) {
          console.error('Error setting theme:', error);
          resolve({ selected: false });
        }
        return;
      }

      // Escape or q - exit without changing
      if (str === '\x1b' || str === 'q' || str === 'Q') {
        cleanup();
        resolve({ selected: false });
        return;
      }

      // Ctrl+C - exit
      if (str === '\x03') {
        cleanup();
        process.kill(process.pid, 'SIGINT');
        return;
      }
    };

    process.stdin.on('data', handleData);
  });
}

/**
 * Run the theme picker and print result
 */
export async function runThemePicker(): Promise<void> {
  const result = await showThemePicker();

  if (result.selected && result.theme) {
    const theme = ThemeManager.getThemeForPlatform(PLATFORM);
    console.log(theme.colors.success(`\n✓ Theme changed to: ${result.theme}`));
    console.log(theme.colors.muted('Theme saved to fuzzycortex configuration'));
    console.log();
    console.log(theme.colors.info('The new theme will be applied to all future fuzzycortex sessions.'));
    console.log();
  } else {
    const theme = ThemeManager.getThemeForPlatform(PLATFORM);
    console.log(theme.colors.muted('\nExited theme picker'));
  }
}
