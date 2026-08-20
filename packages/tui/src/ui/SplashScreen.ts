/**
 * Splash Screen for Nexus Cortex Chalk CLI
 *
 * Renders a themed chip art and CORTEX title at startup.
 * Ported from the Ink UI (CortexApp.tsx) to work with chalk.
 */

import chalk from 'chalk';
import { keymapFooterHint } from '@nexus-cortex/core';
import { ThemeDefinition, themeDefinitions } from '@nexus-cortex/cli/dist/themes/themeDefinitions.js';
import { loadPersistedTheme } from '@nexus-cortex/cli/dist/themes/colors.js';

/**
 * Get the current theme definition
 * Uses .cortex/config.json persistence (same as Ink UI)
 */
function getCurrentThemeDefinition(): ThemeDefinition {
  const themeName = loadPersistedTheme();
  if (themeName && themeDefinitions[themeName as keyof typeof themeDefinitions]) {
    return themeDefinitions[themeName as keyof typeof themeDefinitions]!;
  }
  // Default to Tokyo Night
  return themeDefinitions.tokyoNight!;
}

/**
 * Per-brand splash art. Each TUI gets its own chip + title set:
 *   fuzzy → fuzzycortex (chalk REPL)        — FUZZY_CHIP_ART / FUZZY_TITLE
 *   neon  → neoncortex (React/Ink UI)       — NEON_CHIP_ART / NEON_TITLE
 * Edit with: packages/cli/themes/chalk/splash_configurator.py (interactive mode
 * asks which TUI to target before saving).
 */
export type SplashVariant = 'fuzzy' | 'neon';

const FUZZY_CHIP_ART = [
  '           ●          ●     ●     ●          ●           ',
  '           │          ╰──╮  │  ╭──╯          │           ',
  '       ●───╯  ●──╮       │  │  │       ╭──●  ╰───●       ',
  '                 ╰─╮     │  │  │     ╭─╯                 ',
  '           ╭───────┴─────┴──┴──┴─────┴───────╮           ',
  '       ●───┤■      ▀     ▀  ▀  ▀     ▀      ■├───●       ',
  '           │   ╔═════════════════════════╗   │           ',
  '       ●───┤■  ║   █▀▀ █ ▐ ▀▀█ ▀▀█ ▚ ▞   ║  ■├───●       ',
  '           │   ║   █▀  █ ▐  █   █   █    ║   │           ',
  '       ●───┤■  ║   █   █▄▟ █▄▄ █▄▄  █    ║  ■├───●       ',
  '           │   ╚═════════════════════════╝   │           ',
  '       ●───┤■      ▄     ▄  ▄  ▄     ▄      ■├───●       ',
  '           ╰───────┬─────┬──┬──┬─────┬───────╯           ',
  '                 ╭─╯     │  │  │     ╰─╮                 ',
  '       ●───╮  ●──╯       │  │  │       ╰──●  ╭───●       ',
  '           │          ╭──╯  │  ╰──╮          │           ',
  '           ●          ●     ●     ●          ●           ',
];

const FUZZY_TITLE = [
  '•●●●●●●●●●· ·●●●●●●●●●·  ●●●●●●●●●●  ●●●●●●●●●●· ●●●●●●●●●•  ●●●   ·●●•',
  '●●•         •●●     •●●  ●●·     ●●·     ●●•     ●●•······    •●●••●●· ',
  '●●·         •●●     •●●  ●●●●●●●●●●·     ●●·     ●●●●●●●●       ●●●●   ',
  '●●•         •●●     •●●  ●●••••●●●       ●●·     ●●•·····     •●●•●●●· ',
  '•●●●●●●●●●· ·●●●●●●●●●·  ●●·    ●●●      ●●·     ●●●●●●●●●●  ●●●·  ·●●•',
];

const NEON_CHIP_ART = [
  '           ●          ●     ●     ●          ●           ',
  '           │          ╰──╮  │  ╭──╯          │           ',
  '       ●───╯  ●──╮       │  │  │       ╭──●  ╰───●       ',
  '                 ╰─╮     │  │  │     ╭─╯                 ',
  '           ╭───────┴─────┴──┴──┴─────┴───────╮           ',
  '       ●───┤■      ▀     ▀  ▀  ▀     ▀      ■├───●       ',
  '           │   ╔═════════════════════════╗   │           ',
  '       ●───┤■  ║     █▜▐ █▀▀ █▀▜ █▜▐     ║  ■├───●       ',
  '           │   ║     █▐▐ █▀  █▌▐ █▐▐     ║   │           ',
  '       ●───┤■  ║     ▌ █ █▄▄ █▄▟ ▌ █     ║  ■├───●       ',
  '           │   ╚═════════════════════════╝   │           ',
  '       ●───┤■      ▄     ▄  ▄  ▄     ▄      ■├───●       ',
  '           ╰───────┬─────┬──┬──┬─────┬───────╯           ',
  '                 ╭─╯     │  │  │     ╰─╮                 ',
  '       ●───╮  ●──╯       │  │  │       ╰──●  ╭───●       ',
  '           │          ╭──╯  │  ╰──╮          │           ',
  '           ●          ●     ●     ●          ●           ',
];

const NEON_TITLE = [
  '•●●●●●●●●●· ·●●●●●●●●●·  ●●●●●●●●●●  ●●●●●●●●●●· ●●●●●●●●●•  ●●●   ·●●•',
  '●●•         •●●     •●●  ●●·     ●●·     ●●•     ●●•······    •●●••●●· ',
  '●●·         •●●     •●●  ●●●●●●●●●●·     ●●·     ●●●●●●●●       ●●●●   ',
  '●●•         •●●     •●●  ●●••••●●●       ●●·     ●●•·····     •●●•●●●· ',
  '•●●●●●●●●●· ·●●●●●●●●●·  ●●·    ●●●      ●●·     ●●●●●●●●●●  ●●●·  ·●●•',
];

const SPLASH_ART: Record<SplashVariant, { chip: string[]; title: string[] }> = {
  fuzzy: { chip: FUZZY_CHIP_ART, title: FUZZY_TITLE },
  neon: { chip: NEON_CHIP_ART, title: NEON_TITLE },
};

/**
 * Character sets for coloring
 */
const PIN_CHARS = new Set(['■']);
const TOP_BOTTOM_PIN_CHARS = new Set(['▀', '▄']);
const SOLDER_CHARS = new Set(['●']);
const INNER_BOX_CHARS = new Set(['╔', '═', '╗', '║', '╚', '╝']);
const INNER_TEXT_CHARS = new Set(['▛', '▜', '▌', '▐', '▙', '▟', '▚', '▞', '█']);
const SHARED_CHARS = new Set(['─', '│', '╭', '╮', '╯', '╰', '┴', '┬', '┤', '├']);
const SOLID_TITLE_CHARS = new Set(['█', '▀', '▄']);

/**
 * Render a single chip art line with themed colors
 * Position-based coloring for characters that appear in both traces and chip border
 */
function renderChipArtLine(line: string, lineIndex: number, theme: ThemeDefinition): string {
  // Lines 5 and 11 have top/bottom pins that should be error color
  const isPinLine = lineIndex === 5 || lineIndex === 11;

  // Chip box boundary: lines 4-12, columns 11-45
  const isChipBoxLine = lineIndex >= 4 && lineIndex <= 12;
  const chipBoxLeft = 11;
  const chipBoxRight = 45;

  const getColorForChar = (char: string, colIndex: number): string => {
    if (PIN_CHARS.has(char)) return theme.error;
    if (TOP_BOTTOM_PIN_CHARS.has(char)) return isPinLine ? theme.error : theme.secondary;
    if (SOLDER_CHARS.has(char)) return theme.success;
    if (INNER_BOX_CHARS.has(char)) return theme.text;
    if (INNER_TEXT_CHARS.has(char)) return theme.secondary;

    // Position-based coloring for shared characters
    if (SHARED_CHARS.has(char)) {
      if (isChipBoxLine && colIndex >= chipBoxLeft && colIndex <= chipBoxRight) {
        return theme.info;
      }
      return theme.warning;
    }

    return theme.warning; // default for other chars
  };

  let result = '';
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    const color = getColorForChar(char, i);
    result += chalk.hex(color)(char);
  }

  return result;
}

/**
 * Render a CORTEX title line with themed colors
 * Solid blocks (█) get primary color, line-drawing gets info color
 */
function renderTitleLine(line: string, theme: ThemeDefinition): string {
  let result = '';

  for (const char of line) {
    if (SOLID_TITLE_CHARS.has(char)) {
      result += chalk.hex(theme.primary).bold(char);
    } else if (char === ' ') {
      result += char;
    } else {
      // Line drawing characters (╔═╗║╚╝╝)
      result += chalk.hex(theme.info).bold(char);
    }
  }

  return result;
}

/**
 * Render a compact CC-style header: logo + version + model + cwd in 3 lines
 */
export function renderCompactHeader(opts: {
  version?: string;
  model?: string;
  cwd?: string;
  terminalWidth?: number;
}): string {
  const theme = getCurrentThemeDefinition();
  const model = opts.model || process.env.DEFAULT_MODEL_ID || 'default';
  const cwd = opts.cwd || process.cwd();
  const home = process.env.HOME || '';
  const displayCwd = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;

  const lines: string[] = [];
  lines.push('');
  lines.push(
    chalk.hex(theme.primary).bold(' CORTEX') +
    chalk.hex(theme.dimmed)(' · ') +
    chalk.hex(theme.secondary)(model) +
    chalk.hex(theme.dimmed)(' · ') +
    chalk.hex(theme.info)(displayCwd)
  );
  lines.push(
    chalk.hex(theme.dimmed)(' Tab: thinking | Shift+Tab: auto-approve | /help: commands | ESC: abort')
  );
  lines.push('');
  return lines.join('\n');
}

/**
 * Render the full splash screen (chip art + block title)
 * Used by /about command
 */
export function renderSplashScreen(terminalWidth?: number, variant: SplashVariant = 'fuzzy'): string {
  const theme = getCurrentThemeDefinition();
  const width = terminalWidth || process.stdout.columns || 80;
  const art = SPLASH_ART[variant];

  // Use the chip art width as reference for centering all elements
  // This ensures tagline, providers, etc. align with the art
  const artWidth = art.chip[0]?.length || 57;

  const lines: string[] = [];

  // Add some top padding
  lines.push('');

  // Render chip art (centered based on terminal width)
  for (let i = 0; i < art.chip.length; i++) {
    const artLine = art.chip[i]!;
    const coloredLine = renderChipArtLine(artLine, i, theme);
    const padding = Math.max(0, Math.floor((width - artLine.length) / 2));
    lines.push(' '.repeat(padding) + coloredLine);
  }

  lines.push('');

  // Render CORTEX title (centered based on terminal width)
  for (const titleLine of art.title) {
    const coloredLine = renderTitleLine(titleLine, theme);
    const padding = Math.max(0, Math.floor((width - titleLine.length) / 2));
    lines.push(' '.repeat(padding) + coloredLine);
  }

  lines.push('');

  // Calculate base padding to align with the art block
  const artPadding = Math.max(0, Math.floor((width - artWidth) / 2));

  // Tagline (centered within the art width, then offset by art padding)
  const tagline = '"AI-Powered Development Interface"';
  const taglinePadding = Math.max(0, Math.floor((artWidth - tagline.length) / 2));
  lines.push(' '.repeat(artPadding + taglinePadding) + chalk.hex(theme.dimmed)(tagline));

  lines.push('');

  // Provider list (centered within the art width)
  const providers = 'Anthropic • OpenAI • Google • XAI • DeepSeek';
  const providersPadding = Math.max(0, Math.floor((artWidth - providers.length) / 2));
  lines.push(' '.repeat(artPadding + providersPadding) + chalk.hex(theme.dimmed)(providers));

  lines.push('');

  // Help hint (centered within the art width)
  const helpHint = 'Type /help for commands';
  const helpPadding = Math.max(0, Math.floor((artWidth - helpHint.length) / 2));
  lines.push(' '.repeat(artPadding + helpPadding) + chalk.hex(theme.dimmed)(helpHint));

  lines.push('');

  return lines.join('\n');
}

/**
 * Render a minimal header for continuing sessions
 * Shows just the model and keyboard shortcuts
 */
export function renderMinimalHeader(modelDisplay: string, theme: ThemeDefinition): string {
  const width = process.stdout.columns || 80;
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.hex(theme.dimmed)('─'.repeat(Math.min(60, width))));
  lines.push(
    chalk.hex(theme.primary)(' Nexus Cortex') +
    chalk.hex(theme.dimmed)(' │ ') +
    chalk.hex(theme.secondary).bold(modelDisplay)
  );
  lines.push(chalk.hex(theme.dimmed)('─'.repeat(Math.min(60, width))));
  lines.push(chalk.hex(theme.dimmed)(' Tab: thinking │ Shift+Tab: auto-approve │ /: commands │ ESC: abort'));
  lines.push(chalk.hex(theme.dimmed)('─'.repeat(Math.min(60, width))));
  lines.push('');

  return lines.join('\n');
}

/**
 * Print splash screen to stdout
 */
export function printSplashScreen(variant: SplashVariant = 'fuzzy'): void {
  console.log(renderSplashScreen(undefined, variant));
}

/**
 * Print a horizontal divider line
 */
export function printDivider(width?: number): void {
  const theme = getCurrentThemeDefinition();
  const w = width || Math.min(70, process.stdout.columns || 80);
  console.log(chalk.hex(theme.dimmed)('─'.repeat(w)));
}

/**
 * Status line state for displaying current mode indicators
 */
export interface StatusLineState {
  model: string;
  showThinking: boolean;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  supportsReasoning?: boolean;
  autoApprove: boolean;
  yoloMode?: boolean;
}

/**
 * Render the status line showing model and mode indicators
 * Matches the Ink UI StatusLine component
 */
export function renderStatusLine(state: StatusLineState): string {
  const theme = getCurrentThemeDefinition();
  const parts: string[] = [];

  // Model name in success/green color
  parts.push(chalk.hex(theme.success)(state.model));

  // [Think] indicator in info/blue color
  if (state.showThinking) {
    parts.push(chalk.hex(theme.info)(' [Think]'));
  }

  // [R:effort] indicator in secondary/purple color for reasoning models
  if (state.supportsReasoning && state.reasoningEffort && state.reasoningEffort !== 'none') {
    parts.push(chalk.hex(theme.secondary)(` [R:${state.reasoningEffort}]`));
  }

  // [YOLO] or [Auto-Approve] indicator in warning/yellow color
  if (state.yoloMode) {
    parts.push(chalk.hex(theme.error)(' [YOLO]'));
  } else if (state.autoApprove) {
    parts.push(chalk.hex(theme.warning)(' [Auto-Approve]'));
  }

  return parts.join('');
}

/**
 * Print the input prompt area (for after splash)
 */
export function printInputPromptArea(statusState?: StatusLineState): void {
  const theme = getCurrentThemeDefinition();
  const width = Math.min(70, process.stdout.columns || 80);

  console.log(chalk.hex(theme.dimmed)('─'.repeat(width)));
  console.log(chalk.hex(theme.dimmed)(' Type your message...'));
  console.log(chalk.hex(theme.dimmed)('─'.repeat(width)));
  console.log(chalk.hex(theme.dimmed)(' ' + keymapFooterHint('chalk')));

  // Print status line if state provided
  if (statusState) {
    console.log();
    console.log(renderStatusLine(statusState));
  }
}

/**
 * Print just the status line (for updates during session)
 */
export function printStatusLine(state: StatusLineState): void {
  console.log(renderStatusLine(state));
}

/**
 * Render the input box frame (top border, placeholder, bottom border)
 * Returns the lines without printing, for more control
 */
export function renderInputBox(placeholder?: string): string[] {
  const theme = getCurrentThemeDefinition();
  const width = Math.min(70, process.stdout.columns || 80);
  const text = placeholder || 'Type your message...';

  return [
    chalk.hex(theme.dimmed)('─'.repeat(width)),
    chalk.hex(theme.dimmed)(` ${text}`),
    chalk.hex(theme.dimmed)('─'.repeat(width)),
  ];
}

/**
 * Render keyboard shortcuts help line
 */
export function renderKeyboardShortcuts(): string {
  const theme = getCurrentThemeDefinition();
  return chalk.hex(theme.dimmed)(' ' + keymapFooterHint('chalk'));
}
