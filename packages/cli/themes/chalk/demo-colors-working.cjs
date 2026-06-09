#!/usr/bin/env node

const chalk = require('chalk');

// Force color support
chalk.level = 3;
process.env.FORCE_COLOR = '3';

console.clear();
console.log('');

// Title
console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
console.log(chalk.cyan.bold('           OMNICLAUDE V4 CLI - THEME SHOWCASE          '));
console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
console.log('');

// Basic test
console.log(chalk.bold('🎨 COLOR TEST'));
console.log(chalk.red('■ Red'), chalk.green('■ Green'), chalk.blue('■ Blue'), chalk.yellow('■ Yellow'));
console.log(chalk.magenta('■ Magenta'), chalk.cyan('■ Cyan'), chalk.white('■ White'), chalk.gray('■ Gray'));
console.log('');

// Status messages
console.log(chalk.bold('📌 STATUS MESSAGES'));
console.log(chalk.green('✓') + ' ' + chalk.white('Success: Operation completed'));
console.log(chalk.red('✗') + ' ' + chalk.white('Error: Connection failed'));
console.log(chalk.yellow('⚠') + ' ' + chalk.white('Warning: Low memory'));
console.log(chalk.blue('ℹ') + ' ' + chalk.white('Info: Server started'));
console.log('');

// VS Code Theme Example
console.log(chalk.bold('🎨 VS CODE THEME'));
const theme = {
  keyword: chalk.hex('#C678DD').bold,
  string: chalk.hex('#98C379'),
  number: chalk.hex('#D19A66'),
  function: chalk.hex('#61AFEF'),
  variable: chalk.hex('#E06C75'),
  comment: chalk.hex('#5C6370').italic
};

console.log(theme.comment('// Initialize OmniClaude client'));
console.log(theme.keyword('const') + ' ' + theme.variable('client') + ' = ' + theme.keyword('new') + ' ' + theme.function('OmniClaude') + '({');
console.log('  model: ' + theme.string('"gemini-2.5-flash"') + ',');
console.log('  temperature: ' + theme.number('0.7'));
console.log('});');
console.log('');

// Session header
console.log(chalk.bold('📦 SESSION HEADER'));
const border = chalk.gray;
console.log(border('┌──────────────────────────────────────────────────┐'));
console.log(border('│') + chalk.cyan.bold(' OmniClaude V4') + '                   ' + chalk.dim('[Ctrl+C]') + ' ' + border('│'));
console.log(border('│') + ' Model: ' + chalk.yellow('gemini-2.5-flash') + '  Session: ' + chalk.blue('abc-123') + '  ' + border('│'));
console.log(border('│') + ' Messages: ' + chalk.white('12') + ' | Tokens: ' + chalk.white('45K') + ' | Cost: ' + chalk.green('$0.03') + '    ' + border('│'));
console.log(border('└──────────────────────────────────────────────────┘'));
console.log('');

// Progress bar
console.log(chalk.bold('📊 PROGRESS'));
const width = 30;
const percent = 65;
const filled = Math.floor(width * percent / 100);
const empty = width - filled;
process.stdout.write('[' + chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty)) + '] ');
console.log(chalk.yellow(percent + '%'));
console.log('');

// Tool execution
console.log(chalk.bold('🛠️  TOOLS'));
console.log(chalk.blue('⏳') + ' ' + chalk.cyan('glob') + chalk.gray('("**/*.ts")') + chalk.gray(' ...'));
console.log(chalk.green('✓') + ' ' + chalk.cyan('read') + chalk.gray('("/src/index.ts")'));
console.log(chalk.red('✗') + ' ' + chalk.cyan('write') + chalk.gray('("/protected")') + chalk.red(' - Permission denied'));
console.log('');

// Rainbow text
console.log(chalk.bold('🌈 RAINBOW'));
const text = 'OMNICLAUDE V4 CLI';
const rainbow = [chalk.red, chalk.yellow, chalk.green, chalk.cyan, chalk.blue, chalk.magenta];
let output = '';
for (let i = 0; i < text.length; i++) {
  output += rainbow[i % rainbow.length](text[i]);
}
console.log(output);
console.log('');

// Footer
console.log(chalk.gray('─'.repeat(55)));
console.log(chalk.gray('Color support: ') + chalk.green('Enabled (Level 3 - True Color)'));
console.log(chalk.gray('Run this demo: ') + chalk.yellow('node demo-colors-working.cjs'));
console.log(chalk.gray('─'.repeat(55)));
console.log('');