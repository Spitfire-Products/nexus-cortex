#!/usr/bin/env node

// Force color output version
// Run with: node demo-themes-forced-colors.cjs

const chalk = require('chalk');

// FORCE COLOR SUPPORT
chalk.level = 3; // Force true color support
process.env.FORCE_COLOR = '3'; // Also set environment variable

console.clear();
console.log('FORCING COLOR LEVEL 3 (True Color)\n');

// Test if colors are working
console.log(chalk.red('If this text is RED, colors are working!'));
console.log(chalk.green('If this text is GREEN, colors are working!'));
console.log(chalk.blue('If this text is BLUE, colors are working!'));
console.log();

// ============================================================================
// VISUAL COLOR TEST
// ============================================================================

console.log('═══════════════════════════════════════════════════════════════');
console.log('                    OMNICLAUDE V4 CLI THEMES                   ');
console.log('═══════════════════════════════════════════════════════════════\n');

// Rainbow banner
const rainbow = [
  chalk.red,
  chalk.yellow,
  chalk.green,
  chalk.cyan,
  chalk.blue,
  chalk.magenta
];

const banner = 'OMNICLAUDE V4 - TERMINAL THEMES SHOWCASE';
let coloredBanner = '';
for (let i = 0; i < banner.length; i++) {
  coloredBanner += rainbow[i % rainbow.length](banner[i]);
}
console.log(chalk.bold(coloredBanner));
console.log();

// ============================================================================
// THEME SHOWCASE
// ============================================================================

console.log(chalk.bold.white('🎨 DARK THEME (VS Code One Dark)'));
console.log('─'.repeat(40));

// VS Code One Dark Colors
const vscode = {
  bg: chalk.bgHex('#282C34'),
  fg: chalk.hex('#ABB2BF'),
  red: chalk.hex('#E06C75'),
  green: chalk.hex('#98C379'),
  yellow: chalk.hex('#E5C07B'),
  blue: chalk.hex('#61AFEF'),
  magenta: chalk.hex('#C678DD'),
  cyan: chalk.hex('#56B6C2'),
  white: chalk.hex('#ABB2BF'),
  gray: chalk.hex('#5C6370')
};

// Status messages with VS Code theme
console.log(vscode.green('✓ Success:') + ' ' + vscode.fg('Operation completed'));
console.log(vscode.red('✗ Error:') + ' ' + vscode.fg('Failed to connect'));
console.log(vscode.yellow('⚠ Warning:') + ' ' + vscode.fg('Deprecated function'));
console.log(vscode.blue('ℹ Info:') + ' ' + vscode.fg('Server started'));
console.log();

// Code sample with VS Code theme
console.log(vscode.gray('// Example code'));
console.log(vscode.magenta('const') + ' ' + vscode.red('client') + ' ' + vscode.white('=') + ' ' + vscode.magenta('new') + ' ' + vscode.blue('OmniClaude') + vscode.white('(') + vscode.green('"gemini-2.5"') + vscode.white(');'));
console.log(vscode.red('client') + vscode.white('.') + vscode.blue('sendMessage') + vscode.white('(') + vscode.green('"Hello AI!"') + vscode.white(');'));
console.log();

// ============================================================================

console.log(chalk.bold.white('🎨 MONOKAI THEME'));
console.log('─'.repeat(40));

const monokai = {
  bg: chalk.bgHex('#272822'),
  pink: chalk.hex('#F92672'),
  green: chalk.hex('#A6E22E'),
  yellow: chalk.hex('#E6DB74'),
  purple: chalk.hex('#AE81FF'),
  cyan: chalk.hex('#66D9EF'),
  orange: chalk.hex('#FD971F'),
  white: chalk.hex('#F8F8F2')
};

console.log(monokai.pink('class') + ' ' + monokai.green('OmniClaude') + ' ' + monokai.white('{'));
console.log('  ' + monokai.cyan('constructor') + monokai.white('(') + monokai.orange('model') + monokai.white(': ') + monokai.cyan('string') + monokai.white(') {'));
console.log('    ' + monokai.pink('this') + monokai.white('.') + monokai.white('model') + ' ' + monokai.pink('=') + ' ' + monokai.orange('model') + monokai.white(';'));
console.log('  ' + monokai.white('}'));
console.log(monokai.white('}'));
console.log();

// ============================================================================

console.log(chalk.bold.white('🎨 DRACULA THEME'));
console.log('─'.repeat(40));

const dracula = {
  bg: chalk.bgHex('#282A36'),
  fg: chalk.hex('#F8F8F2'),
  cyan: chalk.hex('#8BE9FD'),
  green: chalk.hex('#50FA7B'),
  orange: chalk.hex('#FFB86C'),
  pink: chalk.hex('#FF79C6'),
  purple: chalk.hex('#BD93F9'),
  red: chalk.hex('#FF5555'),
  yellow: chalk.hex('#F1FA8C')
};

console.log(dracula.pink('async function') + ' ' + dracula.green('processMessage') + dracula.fg('(') + dracula.orange('text') + dracula.fg(') {'));
console.log('  ' + dracula.pink('return') + ' ' + dracula.pink('await') + ' ' + dracula.fg('client') + dracula.cyan('.') + dracula.green('send') + dracula.fg('(') + dracula.yellow('"') + dracula.yellow(text) + dracula.yellow('"') + dracula.fg(');'));
console.log(dracula.fg('}'));
console.log();

// ============================================================================
// UI COMPONENTS
// ============================================================================

console.log(chalk.bold.white('📦 UI COMPONENTS'));
console.log('─'.repeat(40));

// Session Header Box
const border = chalk.hex('#3E4451');
const text = chalk.hex('#ABB2BF');
const accent = chalk.hex('#61AFEF');

console.log(border('┌' + '─'.repeat(50) + '┐'));
console.log(border('│') + accent.bold(' OmniClaude V4') + ' '.repeat(23) + text.dim('[Ctrl+C]') + ' ' + border('│'));
console.log(border('│') + text(' Model: ') + chalk.yellow('gemini-2.5') + text('  Session: ') + chalk.cyan('abc-123') + '      ' + border('│'));
console.log(border('│') + text(' Messages: ') + chalk.white('42') + text(' | Tokens: ') + chalk.white('12.5K') + text(' | Cost: ') + chalk.green('$0.08') + '  ' + border('│'));
console.log(border('└' + '─'.repeat(50) + '┘'));
console.log();

// Progress Bar
console.log(chalk.bold.white('📊 PROGRESS BAR'));
const percent = 75;
const width = 30;
const filled = Math.floor(width * percent / 100);
const empty = width - filled;
console.log('[' + chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty)) + '] ' + chalk.yellow(percent + '%'));
console.log();

// Tool Execution
console.log(chalk.bold.white('🛠️  TOOL EXECUTION'));
console.log(chalk.gray('⏳') + ' ' + chalk.cyan('Starting') + ' ' + chalk.white('glob("**/*.ts")...'));
console.log(chalk.blue('⚙️') + ' ' + chalk.cyan('Running') + ' ' + chalk.white('grep("TODO")...'));
console.log(chalk.green('✓') + ' ' + chalk.cyan('Complete') + ' ' + chalk.white('read("/src/index.ts")'));
console.log(chalk.red('✗') + ' ' + chalk.cyan('Failed') + ' ' + chalk.white('write("/protected/file")'));
console.log();

// Gradient Bar
console.log(chalk.bold.white('🌈 GRADIENT EFFECTS'));
for (let i = 0; i < 50; i++) {
  const hue = (i * 360 / 50);
  const r = Math.floor(127 * (1 + Math.sin(hue * Math.PI / 180)));
  const g = Math.floor(127 * (1 + Math.sin((hue + 120) * Math.PI / 180)));
  const b = Math.floor(127 * (1 + Math.sin((hue + 240) * Math.PI / 180)));
  process.stdout.write(chalk.rgb(r, g, b)('█'));
}
console.log('\n');

// ============================================================================
// COMPARISON
// ============================================================================

console.log(chalk.bold.white('🔄 COLORED vs PLAIN TEXT'));
console.log('─'.repeat(40));

console.log('Colored:');
console.log('  ' + chalk.green('✓') + ' ' + chalk.green('Success:') + ' Build completed in ' + chalk.yellow('1.2s'));
console.log('  ' + chalk.red('✗') + ' ' + chalk.red('Error:') + ' Module ' + chalk.yellow('"express"') + ' not found');

console.log('\nPlain text:');
console.log('  [OK] Success: Build completed in 1.2s');
console.log('  [ERROR] Error: Module "express" not found');
console.log();

// ============================================================================
// FOOTER
// ============================================================================

console.log(chalk.gray('═'.repeat(60)));
console.log(chalk.cyan.bold('   Terminal Color Demo Complete'));
console.log(chalk.gray('   Forced color level: ') + chalk.green('3 (True Color)'));
console.log(chalk.gray('   Actual terminal support: ') + chalk.yellow(`Level ${chalk.level}`));
console.log(chalk.gray('═'.repeat(60)));
console.log();