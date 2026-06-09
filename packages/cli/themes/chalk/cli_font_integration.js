#!/usr/bin/env node

/**
 * CLI Font Integration Example
 * Demonstrates how to integrate Tron-style wide fonts with the hybrid Chalk/Ink architecture
 */

const chalk = require('chalk');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// ASCII wide font definitions (JavaScript version)
const TRON_FONTS = {
  A: ['██████', '██  ██', '██████', '██  ██', '██  ██'],
  B: ['█████ ', '██  ██', '█████ ', '██  ██', '█████ '],
  C: ['██████', '██    ', '██    ', '██    ', '██████'],
  D: ['█████ ', '██  ██', '██  ██', '██  ██', '█████ '],
  E: ['██████', '██    ', '██████', '██    ', '██████'],
  F: ['██████', '██    ', '██████', '██    ', '██    '],
  G: ['██████', '██    ', '██ ███', '██  ██', '██████'],
  H: ['██  ██', '██  ██', '██████', '██  ██', '██  ██'],
  I: ['██████', '  ██  ', '  ██  ', '  ██  ', '██████'],
  L: ['██    ', '██    ', '██    ', '██    ', '██████'],
  M: ['██   ██', '███ ███', '██ █ ██', '██   ██', '██   ██'],
  N: ['██  ██', '███ ██', '██████', '██ ███', '██  ██'],
  O: ['██████', '██  ██', '██  ██', '██  ██', '██████'],
  R: ['█████ ', '██  ██', '█████ ', '██ ██ ', '██  ██'],
  S: ['██████', '██    ', '██████', '    ██', '██████'],
  T: ['██████', '  ██  ', '  ██  ', '  ██  ', '  ██  '],
  U: ['██  ██', '██  ██', '██  ██', '██  ██', '██████'],
  ' ': ['      ', '      ', '      ', '      ', '      ']
};

// Color themes
const themes = {
  tron: {
    primary: chalk.hex('#00ffff'),   // Cyan
    secondary: chalk.hex('#ff00ff'),  // Magenta
    accent: chalk.hex('#ffaa00'),     // Orange
    glow: chalk.hex('#00ffff').bold,
    dim: chalk.gray
  },
  matrix: {
    primary: chalk.green,
    secondary: chalk.greenBright,
    accent: chalk.yellow,
    glow: chalk.greenBright.bold,
    dim: chalk.gray
  },
  neon: {
    primary: chalk.hex('#ff00ff'),
    secondary: chalk.hex('#00ff00'),
    accent: chalk.hex('#ff0080'),
    glow: chalk.hex('#ff00ff').bold,
    dim: chalk.dim
  }
};

/**
 * Render wide ASCII text with theme
 */
function renderWideText(text, theme = 'tron') {
  const colorTheme = themes[theme];
  const lines = ['', '', '', '', ''];

  text.toUpperCase().split('').forEach(char => {
    const charDef = TRON_FONTS[char] || TRON_FONTS[' '];
    charDef.forEach((line, i) => {
      // Apply gradient effect
      const colored = line
        .replace(/██/g, colorTheme.glow('█'))
        .replace(/█/g, colorTheme.primary('█'))
        .replace(/ /g, ' ');
      lines[i] += colored + ' ';
    });
  });

  return lines.join('\n');
}

/**
 * Create a Tron-style UI frame
 */
function createTronFrame(title, content, width = 60) {
  const theme = themes.tron;
  const lines = [];

  // Top border with title
  const titleBar = `═╡ ${title} ╞`;
  const padding = width - titleBar.length - 2;
  lines.push(theme.primary(`╔${titleBar}${'═'.repeat(padding)}╗`));

  // Content
  content.forEach(line => {
    const contentPadding = width - line.length - 2;
    lines.push(theme.primary('║') + ' ' + line + ' '.repeat(contentPadding) + theme.primary('║'));
  });

  // Bottom border
  lines.push(theme.primary(`╚${'═'.repeat(width - 2)}╝`));

  return lines.join('\n');
}

/**
 * Integration with Python fonts (via child process)
 */
async function renderPythonFont(text, fontStyle = 'tron') {
  try {
    const { stdout } = await execAsync(
      `python -c "
import sys
sys.path.append('/home/runner/workspace/nexus-cortex/packages/cli/themes/chalk')
from custom_wide_fonts import TronBlockFont, render_text

font = TronBlockFont()
print(render_text('${text}', font))
"`
    );
    return stdout;
  } catch (error) {
    console.error('Error calling Python font:', error);
    return null;
  }
}

/**
 * Main demonstration
 */
async function main() {
  console.clear();

  // Header
  console.log(themes.tron.glow('═'.repeat(80)));
  console.log(themes.tron.glow('HYBRID CLI FONT INTEGRATION - CHALK + WIDE FONTS'));
  console.log(themes.tron.glow('═'.repeat(80)));
  console.log();

  // 1. JavaScript wide fonts
  console.log(chalk.white.bold('1. JAVASCRIPT WIDE FONTS (Native)'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(renderWideText('TRON', 'tron'));
  console.log();

  // 2. Different themes
  console.log(chalk.white.bold('2. THEME VARIATIONS'));
  console.log(chalk.gray('─'.repeat(60)));

  console.log(chalk.cyan('Tron Theme:'));
  console.log(renderWideText('GRID', 'tron'));
  console.log();

  console.log(chalk.green('Matrix Theme:'));
  console.log(renderWideText('GRID', 'matrix'));
  console.log();

  console.log(chalk.magenta('Neon Theme:'));
  console.log(renderWideText('GRID', 'neon'));
  console.log();

  // 3. UI Frame Integration
  console.log(chalk.white.bold('3. TRON UI FRAME INTEGRATION'));
  console.log(chalk.gray('─'.repeat(60)));

  const frameContent = [
    `USER: ${themes.tron.accent('FLYNN')}     STATUS: ${chalk.green('●ONLINE')}`,
    `GRID: ${themes.tron.primary('ACTIVE')}    SECTOR: ${themes.tron.accent('7G')}`,
    '',
    `${chalk.green('■')} Recognizer   [ACTIVE]    ${chalk.yellow('████████░░')} 80%`,
    `${chalk.green('■')} Light Cycle  [READY]     CPU: ${chalk.blue('▁▃▅▇▅▃▁')}`,
    `${chalk.red('■')} MCP          [THREAT]    I/O: ${chalk.magenta('⟨⟩⟨⟩⟨⟩⟨⟩')}`
  ];

  console.log(createTronFrame('SYSTEM INTERFACE', frameContent));
  console.log();

  // 4. Python integration (if available)
  console.log(chalk.white.bold('4. PYTHON FONT INTEGRATION'));
  console.log(chalk.gray('─'.repeat(60)));

  const pythonResult = await renderPythonFont('SYSTEM');
  if (pythonResult) {
    console.log(themes.tron.primary(pythonResult));
  } else {
    console.log(chalk.yellow('Python fonts not available'));
  }

  // 5. Combined with standard chalk styling
  console.log(chalk.white.bold('5. COMBINED WITH CHALK STYLING'));
  console.log(chalk.gray('─'.repeat(60)));

  // Wide font title
  console.log(renderWideText('CLI', 'tron'));

  // Regular chalk content below
  console.log();
  console.log(chalk.cyan('▶ ') + chalk.white('Streaming output with ') + chalk.cyan.bold('chalk'));
  console.log(chalk.cyan('▶ ') + chalk.white('Interactive elements with ') + chalk.green.bold('Ink'));
  console.log(chalk.cyan('▶ ') + chalk.white('Wide fonts for ') + chalk.yellow.bold('futuristic headers'));
  console.log(chalk.cyan('▶ ') + chalk.white('ASCII art for ') + chalk.magenta.bold('visual impact'));

  console.log();
  console.log(themes.tron.dim('─'.repeat(80)));
  console.log(chalk.white('This demonstrates the integration of:'));
  console.log(chalk.gray('• Wide ASCII fonts (width > height) for Tron aesthetic'));
  console.log(chalk.gray('• Multiple color themes (Tron, Matrix, Neon)'));
  console.log(chalk.gray('• UI frame components with box drawing'));
  console.log(chalk.gray('• Python font integration via child process'));
  console.log(chalk.gray('• Seamless combination with chalk styling'));
  console.log(themes.tron.dim('─'.repeat(80)));
}

// Run the demonstration
if (require.main === module) {
  main().catch(console.error);
}

// Export for use in other modules
module.exports = {
  renderWideText,
  createTronFrame,
  renderPythonFont,
  themes,
  TRON_FONTS
};