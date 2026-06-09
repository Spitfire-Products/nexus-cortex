#!/usr/bin/env node

// Simple version that works with CommonJS
// Run with: node demo-themes-simple.js
// Install chalk first: npm install chalk@4.1.2

const chalk = require('chalk');

console.clear();

// ============================================================================
// BASIC COLORS
// ============================================================================

console.log(chalk.bold.underline('\n📎 BASIC COLORS (8 colors)\n'));

console.log(chalk.black.bgWhite(' black '), chalk.red(' red '), chalk.green(' green '), chalk.yellow(' yellow '));
console.log(chalk.blue(' blue '), chalk.magenta(' magenta '), chalk.cyan(' cyan '), chalk.white(' white '));

console.log(chalk.bold.underline('\n📎 BRIGHT COLORS (High intensity)\n'));

console.log(chalk.gray(' gray/blackBright '), chalk.redBright(' redBright '), chalk.greenBright(' greenBright '), chalk.yellowBright(' yellowBright '));
console.log(chalk.blueBright(' blueBright '), chalk.magentaBright(' magentaBright '), chalk.cyanBright(' cyanBright '), chalk.whiteBright(' whiteBright '));

// ============================================================================
// TEXT STYLES
// ============================================================================

console.log(chalk.bold.underline('\n📎 TEXT STYLES\n'));

console.log(chalk.bold('Bold text'));
console.log(chalk.dim('Dim text'));
console.log(chalk.italic('Italic text'));
console.log(chalk.underline('Underlined text'));
console.log(chalk.inverse('Inverse colors'));
console.log(chalk.strikethrough('Strikethrough'));
console.log(chalk.bold.italic.underline('Combined: Bold + Italic + Underline'));

// ============================================================================
// 256 COLORS PALETTE
// ============================================================================

console.log(chalk.bold.underline('\n📎 256 COLOR PALETTE (Sample)\n'));

// Show color cube sample
process.stdout.write('Color cube: ');
for (let i = 16; i < 52; i++) {
  process.stdout.write(chalk.bgAnsi256(i)('  '));
}
console.log();

process.stdout.write('            ');
for (let i = 52; i < 88; i++) {
  process.stdout.write(chalk.bgAnsi256(i)('  '));
}
console.log();

// Grayscale
process.stdout.write('Grayscale:  ');
for (let i = 232; i < 256; i++) {
  process.stdout.write(chalk.bgAnsi256(i)('  '));
}
console.log();

// ============================================================================
// TRUE COLOR (RGB/HEX)
// ============================================================================

console.log(chalk.bold.underline('\n📎 TRUE COLOR (16 Million Colors)\n'));

// Gradient effect
process.stdout.write('RGB Gradient: ');
for (let i = 0; i < 40; i++) {
  const r = Math.floor(255 * (i / 40));
  const g = Math.floor(255 * (1 - i / 40));
  const b = 128;
  process.stdout.write(chalk.rgb(r, g, b)('█'));
}
console.log();

process.stdout.write('Rainbow:      ');
const rainbow = [
  [255, 0, 0], [255, 127, 0], [255, 255, 0], [0, 255, 0],
  [0, 0, 255], [75, 0, 130], [148, 0, 211]
];
const text = 'OMNICLAUDE V4 CLI';
for (let i = 0; i < text.length; i++) {
  const color = rainbow[i % rainbow.length];
  process.stdout.write(chalk.rgb(...color).bold(text[i]));
}
console.log();

// ============================================================================
// THEME: DARK (VS Code One Dark)
// ============================================================================

console.log(chalk.bold.underline('\n📎 DARK THEME (VS Code One Dark)\n'));

const darkTheme = {
  primary: chalk.hex('#61AFEF'),
  secondary: chalk.hex('#C678DD'),
  success: chalk.hex('#98C379'),
  warning: chalk.hex('#E5C07B'),
  error: chalk.hex('#E06C75'),
  info: chalk.hex('#56B6C2'),
  text: chalk.hex('#ABB2BF'),
  textDim: chalk.hex('#5C6370'),
  border: chalk.hex('#3E4451'),
};

console.log(darkTheme.primary('Primary'), darkTheme.secondary('Secondary'), darkTheme.success('Success'));
console.log(darkTheme.warning('Warning'), darkTheme.error('Error'), darkTheme.info('Info'));
console.log(darkTheme.text('Regular text'), darkTheme.textDim('Dimmed text'));

// Code syntax example
console.log('\nCode Example:');
console.log(darkTheme.secondary('function') + ' ' + darkTheme.primary('calculate') + chalk.gray('(') + darkTheme.warning('x') + chalk.gray(', ') + darkTheme.warning('y') + chalk.gray(') {'));
console.log('  ' + darkTheme.secondary('return') + ' ' + darkTheme.warning('x') + ' ' + chalk.gray('+') + ' ' + darkTheme.warning('y') + chalk.gray(';'));
console.log(chalk.gray('}'));

// ============================================================================
// THEME: MONOKAI
// ============================================================================

console.log(chalk.bold.underline('\n📎 MONOKAI THEME\n'));

const monokai = {
  pink: chalk.hex('#F92672'),
  green: chalk.hex('#A6E22E'),
  yellow: chalk.hex('#E6DB74'),
  purple: chalk.hex('#AE81FF'),
  cyan: chalk.hex('#66D9EF'),
  orange: chalk.hex('#FD971F'),
};

console.log(monokai.pink('Pink/Keywords'), monokai.green('Green/Functions'), monokai.yellow('Yellow/Strings'));
console.log(monokai.purple('Purple/Numbers'), monokai.cyan('Cyan/Types'), monokai.orange('Orange/Params'));

// ============================================================================
// THEME: DRACULA
// ============================================================================

console.log(chalk.bold.underline('\n📎 DRACULA THEME\n'));

const dracula = {
  cyan: chalk.hex('#8BE9FD'),
  green: chalk.hex('#50FA7B'),
  orange: chalk.hex('#FFB86C'),
  pink: chalk.hex('#FF79C6'),
  purple: chalk.hex('#BD93F9'),
  red: chalk.hex('#FF5555'),
  yellow: chalk.hex('#F1FA8C'),
};

console.log(dracula.cyan('Cyan'), dracula.green('Green'), dracula.orange('Orange'));
console.log(dracula.pink('Pink'), dracula.purple('Purple'), dracula.red('Red'), dracula.yellow('Yellow'));

// ============================================================================
// UI COMPONENTS: STATUS MESSAGES
// ============================================================================

console.log(chalk.bold.underline('\n📎 STATUS MESSAGES\n'));

console.log(chalk.green('✓') + ' ' + chalk.white('Build completed successfully'));
console.log(chalk.red('✗') + ' ' + chalk.white('Error: Compilation failed'));
console.log(chalk.yellow('⚠') + ' ' + chalk.white('Warning: Deprecated API usage'));
console.log(chalk.blue('ℹ') + ' ' + chalk.white('Info: Server running on port 3000'));
console.log(chalk.gray('●') + ' ' + chalk.gray('Debug: Cache cleared'));

// Alternative style
console.log();
console.log(chalk.bgGreen.black(' SUCCESS ') + ' Tests passed');
console.log(chalk.bgRed.white(' ERROR ') + ' Connection timeout');
console.log(chalk.bgYellow.black(' WARNING ') + ' Low memory');
console.log(chalk.bgBlue.white(' INFO ') + ' Update available');

// ============================================================================
// UI COMPONENTS: PROGRESS INDICATORS
// ============================================================================

console.log(chalk.bold.underline('\n📎 PROGRESS INDICATORS\n'));

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
process.stdout.write('Spinner frames: ');
spinnerFrames.forEach(frame => process.stdout.write(chalk.cyan(frame) + ' '));
console.log();

console.log(chalk.blue('⏳') + chalk.gray(' Loading...'));
console.log(chalk.yellow('💭') + chalk.gray(' Thinking...'));
console.log(chalk.cyan('⚙️') + chalk.gray(' Processing...'));
console.log(chalk.green('✅') + chalk.gray(' Complete'));

// Progress bar
console.log('\nProgress Bar:');
const progressWidth = 30;
const progress = 0.65;
const filled = Math.floor(progressWidth * progress);
const empty = progressWidth - filled;
console.log(
  '[' +
  chalk.green('█'.repeat(filled)) +
  chalk.gray('░'.repeat(empty)) +
  '] ' +
  chalk.yellow(`${Math.floor(progress * 100)}%`)
);

// ============================================================================
// UI COMPONENTS: BOXES
// ============================================================================

console.log(chalk.bold.underline('\n📎 BOX STYLES\n'));

// Single line box
console.log(chalk.cyan('┌────────────────────┐'));
console.log(chalk.cyan('│') + ' Single line box    ' + chalk.cyan('│'));
console.log(chalk.cyan('└────────────────────┘'));

console.log();

// Double line box
console.log(chalk.magenta('╔════════════════════╗'));
console.log(chalk.magenta('║') + ' Double line box    ' + chalk.magenta('║'));
console.log(chalk.magenta('╚════════════════════╝'));

console.log();

// Rounded box
console.log(chalk.yellow('╭────────────────────╮'));
console.log(chalk.yellow('│') + ' Rounded box        ' + chalk.yellow('│'));
console.log(chalk.yellow('╰────────────────────╯'));

// ============================================================================
// UI COMPONENTS: SESSION HEADER
// ============================================================================

console.log(chalk.bold.underline('\n📎 SESSION HEADER EXAMPLE\n'));

const border = chalk.gray;
const width = 60;

console.log(border('┌' + '─'.repeat(width - 2) + '┐'));
console.log(border('│') + chalk.cyan.bold(' OmniClaude V4') + ' '.repeat(29) + chalk.dim('[Ctrl+C to exit]') + ' ' + border('│'));
console.log(border('│') + ' Model: ' + chalk.yellow('gemini-2.5-flash') + '      Session: ' + chalk.blue('abc-123') + '         ' + border('│'));
console.log(border('│') + ' Messages: ' + chalk.white('12') + '  |  Tokens: ' + chalk.white('45.2K') + '  |  Cost: ' + chalk.green('$0.03') + '          ' + border('│'));
console.log(border('└' + '─'.repeat(width - 2) + '┘'));

// ============================================================================
// UI COMPONENTS: TOOL EXECUTION
// ============================================================================

console.log(chalk.bold.underline('\n📎 TOOL EXECUTION DISPLAY\n'));

console.log(chalk.gray('⏳') + ' ' + chalk.cyan('glob') + chalk.gray('("**/*.ts")') + chalk.gray(' ...'));
console.log(chalk.cyan('⚙️') + ' ' + chalk.cyan('grep') + chalk.gray('("TODO", {glob: "*.js"})') + chalk.gray(' ...'));
console.log(chalk.green('✓') + ' ' + chalk.cyan('read') + chalk.gray('("/src/index.ts")'));
console.log(chalk.red('✗') + ' ' + chalk.cyan('write') + chalk.gray('("/protected/file.txt")') + chalk.red(' - Permission denied'));

// ============================================================================
// SYNTAX HIGHLIGHTING EXAMPLE
// ============================================================================

console.log(chalk.bold.underline('\n📎 SYNTAX HIGHLIGHTING (JavaScript)\n'));

const syn = {
  keyword: chalk.hex('#C678DD').bold,
  string: chalk.hex('#98C379'),
  number: chalk.hex('#D19A66'),
  comment: chalk.hex('#5C6370').italic,
  function: chalk.hex('#61AFEF'),
  variable: chalk.hex('#E06C75'),
};

console.log(syn.comment('// OmniClaude V4 Example'));
console.log(syn.keyword('const') + ' ' + syn.variable('client') + ' = ' + syn.keyword('new') + ' ' + syn.function('OmniClaudeClient') + '({');
console.log('  ' + syn.variable('model') + ': ' + syn.string('"gemini-2.5-flash"') + ',');
console.log('  ' + syn.variable('temperature') + ': ' + syn.number('0.7') + ',');
console.log('  ' + syn.variable('maxTokens') + ': ' + syn.number('4096'));
console.log('});');
console.log();
console.log(syn.keyword('async function') + ' ' + syn.function('sendMessage') + '(' + syn.variable('text') + ') {');
console.log('  ' + syn.keyword('return await') + ' ' + syn.variable('client') + '.' + syn.function('chat') + '(' + syn.variable('text') + ');');
console.log('}');

// ============================================================================
// COMPARISON: WITH AND WITHOUT COLORS
// ============================================================================

console.log(chalk.bold.underline('\n📎 WITH vs WITHOUT COLORS\n'));

console.log('With colors:');
console.log(chalk.green('✓') + ' Build ' + chalk.green('succeeded') + ' in ' + chalk.yellow('1.2s'));
console.log(chalk.red('✗') + ' ' + chalk.red('Error:') + ' Cannot find module ' + chalk.yellow("'express'"));

console.log('\nWithout colors:');
console.log('[OK] Build succeeded in 1.2s');
console.log('[ERROR] Cannot find module \'express\'');

// ============================================================================
// FOOTER
// ============================================================================

console.log(chalk.gray('\n' + '═'.repeat(60)));
console.log(chalk.cyan.bold('   End of Theme Demo'));
console.log(chalk.gray('   Run with: ') + chalk.yellow('node demo-themes-simple.js'));
console.log(chalk.gray('   Terminal color support: ') + chalk.green(`Level ${chalk.level}`) + chalk.gray(' (0=none, 1=basic, 2=256, 3=truecolor)'));
console.log(chalk.gray('═'.repeat(60) + '\n'));