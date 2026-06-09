#!/usr/bin/env node

const chalk = require('chalk');
const themes = require('./theme-definitions.cjs');

/**
 * ChalkThemes - Complete theming system for CLI
 * Based on view-more-themes.py comprehensive theme collection
 */
class ChalkThemes {
  constructor(themeName = 'tokyoNight') {
    this.setTheme(themeName);
  }

  setTheme(themeName) {
    if (!themes[themeName]) {
      throw new Error(`Theme '${themeName}' not found. Available themes: ${Object.keys(themes).join(', ')}`);
    }
    this.theme = themes[themeName];
    this.name = themeName;
    this.initializeColors();
  }

  initializeColors() {
    // UI Colors
    this.primary = chalk.hex(this.theme.primary);
    this.secondary = chalk.hex(this.theme.secondary);
    this.success = chalk.hex(this.theme.success);
    this.warning = chalk.hex(this.theme.warning);
    this.error = chalk.hex(this.theme.error);
    this.info = chalk.hex(this.theme.info);
    this.text = chalk.hex(this.theme.text);
    this.dimmed = chalk.hex(this.theme.dimmed);

    // Syntax Highlighting Colors
    this.keyword = chalk.hex(this.theme.keyword);
    this.function = chalk.hex(this.theme.function);
    this.string = chalk.hex(this.theme.string);
    this.number = chalk.hex(this.theme.number);
    this.variable = chalk.hex(this.theme.variable);
    this.comment = chalk.hex(this.theme.comment);
  }

  // Status Messages
  successMessage(text) {
    return this.success('✓ ') + this.text(text);
  }

  errorMessage(text) {
    return this.error('✗ ') + this.text(text);
  }

  warningMessage(text) {
    return this.warning('⚠ ') + this.text(text);
  }

  infoMessage(text) {
    return this.info('ℹ ') + this.text(text);
  }

  debugMessage(text) {
    return this.dimmed('● ') + this.dimmed(text);
  }

  // Tool Execution Display
  toolPending(name, args) {
    return this.dimmed('⏳ ') + this.primary(name) + this.dimmed(`(${args})`);
  }

  toolRunning(name, args) {
    return this.info('⚙️  ') + this.primary(name) + this.dimmed(`(${args})`);
  }

  toolSuccess(name, args) {
    return this.success('✓ ') + this.primary(name) + this.dimmed(`(${args})`);
  }

  toolError(name, args, error) {
    return this.error('✗ ') + this.primary(name) + this.dimmed(`(${args})`) + this.error(` - ${error}`);
  }

  // Progress Bar
  progressBar(percent, width = 30) {
    const filled = Math.round(width * percent);
    const empty = width - filled;
    return '[' +
           this.success('█'.repeat(filled)) +
           this.dimmed('░'.repeat(empty)) +
           '] ' +
           this.warning(`${Math.round(percent * 100)}%`);
  }

  // Gradient Progress Bar
  gradientProgressBar(percent, width = 30) {
    const filled = Math.round(width * percent);
    const empty = width - filled;
    let bar = '[';

    for (let i = 0; i < filled; i++) {
      const ratio = i / width;
      const r = Math.round(255 * (1 - ratio));
      const g = Math.round(255 * ratio);
      bar += chalk.rgb(r, g, 100)('█');
    }
    bar += this.dimmed('░'.repeat(empty));
    bar += '] ' + this.warning(`${Math.round(percent * 100)}%`);

    return bar;
  }

  // Session Header
  sessionHeader(session) {
    const border = this.dimmed;
    const lines = [
      border('┌' + '─'.repeat(58) + '┐'),
      border('│ ') + this.primary.bold('OmniClaude V4') + '                            ' + this.dimmed('[Ctrl+C to exit]') + ' ' + border('│'),
      border('│ ') + 'Model: ' + this.warning(session.model) + '    Session: ' + this.info(session.id) + '        ' + border('│'),
      border('│ ') + 'Messages: ' + this.text(session.messages) + ' | Tokens: ' + this.text(session.tokens) + ' | Cost: ' + this.success(session.cost) + '     ' + border('│'),
      border('└' + '─'.repeat(58) + '┘')
    ];
    return lines.join('\n');
  }

  // Code Block
  codeBlock(code, language = 'javascript') {
    const lines = code.split('\n');
    const formatted = lines.map(line => {
      // Simple syntax highlighting
      line = line.replace(/\/\/.*/g, match => this.comment(match));
      line = line.replace(/(const|let|var|function|async|await|return|if|else|for|while)/g,
                          match => this.keyword(match));
      line = line.replace(/"[^"]*"|'[^']*'/g, match => this.string(match));
      line = line.replace(/\d+/g, match => this.number(match));
      return line;
    });

    const border = this.dimmed;
    const output = [
      border('┌─ ' + language + ' ' + '─'.repeat(50 - language.length) + '┐'),
      ...formatted.map(line => border('│ ') + line),
      border('└' + '─'.repeat(54) + '┘')
    ];

    return output.join('\n');
  }

  // Rainbow Text
  rainbowText(text) {
    const colors = [
      [255, 0, 0],    // Red
      [255, 127, 0],  // Orange
      [255, 255, 0],  // Yellow
      [0, 255, 0],    // Green
      [0, 0, 255],    // Blue
      [75, 0, 130],   // Indigo
      [148, 0, 211]   // Violet
    ];

    return text.split('').map((char, i) => {
      const color = colors[i % colors.length];
      return chalk.rgb(...color)(char);
    }).join('');
  }

  // Box Styles
  singleBox(content, title = '') {
    const lines = content.split('\n');
    const maxLength = Math.max(...lines.map(l => l.length), title.length + 4);
    const border = this.primary;

    const output = [];
    if (title) {
      output.push(border('┌─ ' + title + ' ' + '─'.repeat(maxLength - title.length - 4) + '┐'));
    } else {
      output.push(border('┌' + '─'.repeat(maxLength) + '┐'));
    }

    lines.forEach(line => {
      const padding = maxLength - line.length;
      output.push(border('│ ') + line + ' '.repeat(padding - 2) + border(' │'));
    });

    output.push(border('└' + '─'.repeat(maxLength) + '┘'));

    return output.join('\n');
  }

  doubleBox(content, title = '') {
    const lines = content.split('\n');
    const maxLength = Math.max(...lines.map(l => l.length), title.length + 4);
    const border = this.secondary;

    const output = [];
    if (title) {
      output.push(border('╔═ ' + title + ' ' + '═'.repeat(maxLength - title.length - 4) + '╗'));
    } else {
      output.push(border('╔' + '═'.repeat(maxLength) + '╗'));
    }

    lines.forEach(line => {
      const padding = maxLength - line.length;
      output.push(border('║ ') + line + ' '.repeat(padding - 2) + border(' ║'));
    });

    output.push(border('╚' + '═'.repeat(maxLength) + '╝'));

    return output.join('\n');
  }

  roundedBox(content, title = '') {
    const lines = content.split('\n');
    const maxLength = Math.max(...lines.map(l => l.length), title.length + 4);
    const border = this.info;

    const output = [];
    if (title) {
      output.push(border('╭─ ' + title + ' ' + '─'.repeat(maxLength - title.length - 4) + '╮'));
    } else {
      output.push(border('╭' + '─'.repeat(maxLength) + '╮'));
    }

    lines.forEach(line => {
      const padding = maxLength - line.length;
      output.push(border('│ ') + line + ' '.repeat(padding - 2) + border(' │'));
    });

    output.push(border('╰' + '─'.repeat(maxLength) + '╯'));

    return output.join('\n');
  }

  // Display Theme Sample
  displayThemeSample() {
    console.log(this.primary.bold(`\n${this.theme.name} Theme\n`));

    // Color Palette
    console.log(this.text.bold('Color Palette:'));
    console.log(this.primary('■ Primary') + '  ' + this.secondary('■ Secondary') + '  ' + this.success('■ Success'));
    console.log(this.warning('■ Warning') + '  ' + this.error('■ Error') + '  ' + this.info('■ Info'));
    console.log(this.text('■ Text') + '  ' + this.dimmed('■ Dimmed') + '\n');

    // Status Messages
    console.log(this.text.bold('Status Messages:'));
    console.log(this.successMessage('Build completed successfully'));
    console.log(this.errorMessage('Connection failed'));
    console.log(this.warningMessage('Low memory warning'));
    console.log(this.infoMessage('Server started on port 3000'));
    console.log(this.debugMessage('Debug: Cache cleared') + '\n');

    // Progress Bar
    console.log(this.text.bold('Progress Bars:'));
    console.log('Standard: ' + this.progressBar(0.65));
    console.log('Gradient: ' + this.gradientProgressBar(0.65) + '\n');

    // Tool Execution
    console.log(this.text.bold('Tool Execution:'));
    console.log(this.toolPending('glob', '**/*.ts'));
    console.log(this.toolRunning('grep', 'TODO, {glob: "*.js"}'));
    console.log(this.toolSuccess('read', '/src/index.ts'));
    console.log(this.toolError('write', '/protected/file.txt', 'Permission denied') + '\n');

    // Code Sample
    const code = `async function processMessage(text) {
  const result = await client.send("Hello");
  return result;
}`;
    console.log(this.text.bold('Code Block:'));
    console.log(this.codeBlock(code, 'javascript') + '\n');

    // Rainbow Text
    console.log(this.text.bold('Rainbow Text:'));
    console.log(this.rainbowText('OMNICLAUDE V4 CLI') + '\n');
  }

  // List all available themes
  static listThemes() {
    console.log(chalk.cyan.bold('\nAvailable Themes:\n'));
    Object.entries(themes).forEach(([key, theme]) => {
      const sample = chalk.hex(theme.primary)('■') +
                     chalk.hex(theme.secondary)('■') +
                     chalk.hex(theme.success)('■') +
                     chalk.hex(theme.warning)('■') +
                     chalk.hex(theme.error)('■') +
                     chalk.hex(theme.info)('■');
      console.log(`  ${chalk.hex(theme.primary)(theme.name.padEnd(20))} ${sample}  ${chalk.gray(key)}`);
    });
    console.log();
  }

  // Demo all themes
  static demoAllThemes() {
    Object.keys(themes).forEach(themeName => {
      const themed = new ChalkThemes(themeName);
      themed.displayThemeSample();
      console.log(chalk.gray('─'.repeat(60)) + '\n');
    });
  }
}

// CLI Demo
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === 'list') {
    ChalkThemes.listThemes();
  } else if (args[0] === 'demo') {
    ChalkThemes.demoAllThemes();
  } else if (args[0]) {
    // Demo specific theme
    try {
      const themed = new ChalkThemes(args[0]);
      themed.displayThemeSample();
    } catch (error) {
      console.error(chalk.red(error.message));
      ChalkThemes.listThemes();
    }
  } else {
    // Default demo
    const themed = new ChalkThemes('tokyoNight');
    themed.displayThemeSample();
    console.log(chalk.gray('\nUsage:'));
    console.log(chalk.gray('  node chalk-themes.js [theme-name]  - Demo specific theme'));
    console.log(chalk.gray('  node chalk-themes.js list           - List all themes'));
    console.log(chalk.gray('  node chalk-themes.js demo           - Demo all themes'));
  }
}

module.exports = ChalkThemes;