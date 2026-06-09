# CLI Colors and Themes Guide

## 1. Chalk (Basic Terminal Styling)

Chalk is the most popular terminal string styling library. It supports:

### Basic Colors (8 colors)
```javascript
import chalk from 'chalk';

// Foreground colors
chalk.black('text')
chalk.red('text')
chalk.green('text')
chalk.yellow('text')
chalk.blue('text')
chalk.magenta('text')
chalk.cyan('text')
chalk.white('text')
chalk.gray('text')  // or chalk.grey()

// Background colors
chalk.bgBlack('text')
chalk.bgRed('text')
chalk.bgGreen('text')
chalk.bgYellow('text')
chalk.bgBlue('text')
chalk.bgMagenta('text')
chalk.bgCyan('text')
chalk.bgWhite('text')
```

### Bright Colors (High intensity)
```javascript
chalk.blackBright('text')  // (alias: gray/grey)
chalk.redBright('text')
chalk.greenBright('text')
chalk.yellowBright('text')
chalk.blueBright('text')
chalk.magentaBright('text')
chalk.cyanBright('text')
chalk.whiteBright('text')

// Bright backgrounds
chalk.bgBlackBright('text')
chalk.bgRedBright('text')
chalk.bgGreenBright('text')
chalk.bgYellowBright('text')
chalk.bgBlueBright('text')
chalk.bgMagentaBright('text')
chalk.bgCyanBright('text')
chalk.bgWhiteBright('text')
```

### 256 Colors Support
```javascript
// Using ANSI 256 color codes (0-255)
chalk.ansi256(196)('text')  // Specific red shade
chalk.bgAnsi256(21)('text')  // Blue background

// Common 256 color codes:
// 0-15: Basic colors
// 16-231: 216 colors (6x6x6 RGB cube)
// 232-255: Grayscale
```

### True Color (16 million colors)
```javascript
// RGB
chalk.rgb(255, 136, 0)('Orange text')
chalk.bgRgb(15, 100, 204)('Blue background')

// Hex
chalk.hex('#FF8800')('Orange text')
chalk.bgHex('#0F64CC')('Blue background')

// HSL
chalk.hsl(32, 100, 50)('Orange')
chalk.bgHsl(32, 100, 50)('Orange background')
```

### Text Styles
```javascript
chalk.bold('Bold text')
chalk.dim('Dim text')
chalk.italic('Italic text')
chalk.underline('Underlined text')
chalk.inverse('Inverse colors')
chalk.hidden('Hidden text')
chalk.strikethrough('Strikethrough')
chalk.overline('Overlined text')  // Not widely supported
```

### Combining Styles
```javascript
// Chain multiple styles
chalk.red.bold('Bold red text')
chalk.blue.underline.bold('Bold underlined blue')
chalk.green.bgYellow.bold('Bold green on yellow')

// Using template literals
chalk`{red.bold Error:} {cyan File not found}`

// Nested styles
chalk.red(`Red ${chalk.underline.bgBlue('underlined blue bg')} red`)
```

---

## 2. Theme Examples

### Dark Theme
```javascript
const darkTheme = {
  // Base colors
  primary: chalk.hex('#61AFEF'),      // Bright blue
  secondary: chalk.hex('#C678DD'),    // Purple
  success: chalk.hex('#98C379'),      // Green
  warning: chalk.hex('#E5C07B'),      // Yellow
  error: chalk.hex('#E06C75'),        // Red
  info: chalk.hex('#56B6C2'),         // Cyan

  // Text colors
  text: chalk.hex('#ABB2BF'),         // Light gray
  textDim: chalk.hex('#5C6370'),      // Dim gray
  textBright: chalk.hex('#FFFFFF'),   // White

  // UI elements
  border: chalk.hex('#3E4451'),       // Dark gray
  background: chalk.hex('#282C34'),   // Very dark gray
  highlight: chalk.hex('#3E4451'),    // Slightly lighter

  // Semantic
  comment: chalk.hex('#5C6370').italic,
  keyword: chalk.hex('#C678DD').bold,
  string: chalk.hex('#98C379'),
  number: chalk.hex('#D19A66'),
  function: chalk.hex('#61AFEF'),
  variable: chalk.hex('#E06C75'),
};

// Usage
console.log(darkTheme.error('Error: File not found'));
console.log(darkTheme.success('✓ Build completed'));
```

### Light Theme
```javascript
const lightTheme = {
  primary: chalk.hex('#0969DA'),      // Blue
  secondary: chalk.hex('#8250DF'),    // Purple
  success: chalk.hex('#1A7F37'),      // Green
  warning: chalk.hex('#9A6700'),      // Orange
  error: chalk.hex('#D1242F'),        // Red
  info: chalk.hex('#0969DA'),         // Blue

  text: chalk.hex('#1F2328'),         // Dark gray
  textDim: chalk.hex('#656D76'),      // Medium gray
  textBright: chalk.hex('#000000'),   // Black

  border: chalk.hex('#D0D7DE'),       // Light gray
  background: chalk.hex('#FFFFFF'),   // White
  highlight: chalk.hex('#FFF8C5'),     // Light yellow
};
```

### Monokai Theme
```javascript
const monokaiTheme = {
  background: chalk.hex('#272822'),
  foreground: chalk.hex('#F8F8F2'),
  comment: chalk.hex('#75715E'),
  red: chalk.hex('#F92672'),
  orange: chalk.hex('#FD971F'),
  lightOrange: chalk.hex('#E69F66'),
  yellow: chalk.hex('#E6DB74'),
  green: chalk.hex('#A6E22E'),
  cyan: chalk.hex('#66D9EF'),
  blue: chalk.hex('#66D9EF'),
  purple: chalk.hex('#AE81FF'),
};
```

### Dracula Theme
```javascript
const draculaTheme = {
  background: chalk.hex('#282A36'),
  currentLine: chalk.hex('#44475A'),
  foreground: chalk.hex('#F8F8F2'),
  comment: chalk.hex('#6272A4'),
  cyan: chalk.hex('#8BE9FD'),
  green: chalk.hex('#50FA7B'),
  orange: chalk.hex('#FFB86C'),
  pink: chalk.hex('#FF79C6'),
  purple: chalk.hex('#BD93F9'),
  red: chalk.hex('#FF5555'),
  yellow: chalk.hex('#F1FA8C'),
};
```

---

## 3. Practical UI Components

### Status Messages
```javascript
const ui = {
  success: (msg) => chalk.green('✓') + ' ' + chalk.white(msg),
  error: (msg) => chalk.red('✗') + ' ' + chalk.white(msg),
  warning: (msg) => chalk.yellow('⚠') + ' ' + chalk.white(msg),
  info: (msg) => chalk.blue('ℹ') + ' ' + chalk.white(msg),
  debug: (msg) => chalk.gray('●') + ' ' + chalk.gray(msg),
};

// Usage
console.log(ui.success('Build completed'));
console.log(ui.error('Compilation failed'));
console.log(ui.warning('Deprecated API usage'));
console.log(ui.info('Server started on port 3000'));
```

### Progress Indicators
```javascript
const spinner = {
  frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  render: (frame, text) => chalk.cyan(frame) + ' ' + chalk.gray(text),
};

// Loading states
const loading = {
  start: chalk.blue('⏳') + chalk.gray(' Loading...'),
  thinking: chalk.yellow('💭') + chalk.gray(' Thinking...'),
  processing: chalk.cyan('⚙️') + chalk.gray(' Processing...'),
  complete: chalk.green('✅') + chalk.gray(' Complete'),
};
```

### Box Drawing
```javascript
// Box drawing characters
const box = {
  // Single line
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',

  // Double line
  dTopLeft: '╔',
  dTopRight: '╗',
  dBottomLeft: '╚',
  dBottomRight: '╝',
  dHorizontal: '═',
  dVertical: '║',

  // Rounded
  rTopLeft: '╭',
  rTopRight: '╮',
  rBottomLeft: '╰',
  rBottomRight: '╯',
};

// Create a box
function drawBox(content, style = 'single') {
  const lines = content.split('\n');
  const maxLen = Math.max(...lines.map(l => l.length));

  const chars = style === 'double' ?
    [box.dTopLeft, box.dTopRight, box.dBottomLeft, box.dBottomRight, box.dHorizontal, box.dVertical] :
    [box.topLeft, box.topRight, box.bottomLeft, box.bottomRight, box.horizontal, box.vertical];

  const [tl, tr, bl, br, h, v] = chars;

  console.log(chalk.cyan(tl + h.repeat(maxLen + 2) + tr));
  lines.forEach(line => {
    console.log(chalk.cyan(v) + ' ' + line.padEnd(maxLen) + ' ' + chalk.cyan(v));
  });
  console.log(chalk.cyan(bl + h.repeat(maxLen + 2) + br));
}
```

### Syntax Highlighting
```javascript
// Code syntax highlighting
const syntax = {
  keyword: chalk.hex('#C678DD').bold,
  string: chalk.hex('#98C379'),
  number: chalk.hex('#D19A66'),
  comment: chalk.hex('#5C6370').italic,
  function: chalk.hex('#61AFEF'),
  variable: chalk.hex('#E06C75'),
  operator: chalk.hex('#56B6C2'),
  punctuation: chalk.hex('#ABB2BF'),
};

// Example
function highlightJS(code) {
  return code
    .replace(/\b(const|let|var|function|return|if|else)\b/g, syntax.keyword('$1'))
    .replace(/'[^']*'|"[^"]*"/g, syntax.string('$&'))
    .replace(/\b\d+\b/g, syntax.number('$&'))
    .replace(/\/\/.*/g, syntax.comment('$&'));
}
```

---

## 4. Ink (React for CLI)

Ink uses React components for building CLI interfaces. It builds on top of chalk.

### Basic Ink Components
```jsx
import React from 'react';
import { render, Text, Box, Newline, Spacer } from 'ink';
import { Badge, Spinner, ProgressBar } from 'ink-components';

// Text with colors
<Text color="green">Success!</Text>
<Text color="#FF8800">Custom color</Text>
<Text backgroundColor="blue" color="white">Inverse</Text>
<Text bold underline>Bold and underlined</Text>
<Text dimColor>Dimmed text</Text>

// Box with borders
<Box borderStyle="round" borderColor="cyan" padding={1}>
  <Text>Content in a box</Text>
</Box>

// Gradient text (requires ink-gradient)
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';

<Gradient name="rainbow">
  <BigText text="OMNICLAUDE" />
</Gradient>
```

### Ink Theme Provider
```jsx
import { ThemeProvider } from 'ink';

const theme = {
  styles: {
    colors: {
      primary: '#61AFEF',
      secondary: '#C678DD',
      success: '#98C379',
      warning: '#E5C07B',
      error: '#E06C75',
      info: '#56B6C2',
    },
    text: {
      primary: '#ABB2BF',
      secondary: '#5C6370',
      inverse: '#282C34',
    },
  },
};

<ThemeProvider theme={theme}>
  <App />
</ThemeProvider>
```

---

## 5. Color Utilities

### Color Detection
```javascript
import chalk from 'chalk';
import supportsColor from 'supports-color';

// Check color support level
console.log('Color support:', chalk.level);
// 0 = No color support
// 1 = Basic 16 colors
// 2 = 256 colors
// 3 = True color (16 million)

// Force color level
chalk.level = 3; // Force true color

// Check if terminal supports color
if (supportsColor.stdout) {
  console.log('Terminal supports color');
  console.log('Has 256:', supportsColor.stdout.has256);
  console.log('Has 16m:', supportsColor.stdout.has16m);
}
```

### Adaptive Themes
```javascript
// Automatically adapt to terminal capabilities
function getTheme() {
  const level = chalk.level;

  if (level === 0) {
    // No color support
    return {
      primary: (text) => text,
      error: (text) => `ERROR: ${text}`,
      success: (text) => `OK: ${text}`,
    };
  } else if (level === 1) {
    // Basic colors only
    return {
      primary: chalk.blue,
      error: chalk.red,
      success: chalk.green,
    };
  } else if (level === 2) {
    // 256 colors
    return {
      primary: chalk.ansi256(33),  // Blue
      error: chalk.ansi256(196),    // Red
      success: chalk.ansi256(46),   // Green
    };
  } else {
    // True color
    return {
      primary: chalk.hex('#61AFEF'),
      error: chalk.hex('#E06C75'),
      success: chalk.hex('#98C379'),
    };
  }
}
```

### Terminal Compatibility

```javascript
// Common terminal color capabilities:
const terminals = {
  'iTerm2': { colors: '16m', italic: true, underline: true },
  'Terminal.app': { colors: '256', italic: false, underline: true },
  'Hyper': { colors: '16m', italic: true, underline: true },
  'VS Code': { colors: '16m', italic: true, underline: true },
  'Windows Terminal': { colors: '16m', italic: true, underline: true },
  'cmd.exe': { colors: '16', italic: false, underline: false },
  'PowerShell': { colors: '16', italic: false, underline: true },
  'PuTTY': { colors: '256', italic: false, underline: true },
  'xterm': { colors: '256', italic: true, underline: true },
  'Linux Console': { colors: '16', italic: false, underline: false },
};
```

---

## 6. Complete Theme Implementation

```javascript
class ThemeManager {
  constructor() {
    this.themes = {
      default: this.createDefaultTheme(),
      dark: this.createDarkTheme(),
      light: this.createLightTheme(),
      ocean: this.createOceanTheme(),
      forest: this.createForestTheme(),
      none: this.createNoColorTheme(),
    };

    this.currentTheme = 'default';
  }

  createDefaultTheme() {
    return {
      // Status
      success: chalk.green,
      error: chalk.red,
      warning: chalk.yellow,
      info: chalk.blue,
      debug: chalk.gray,

      // UI Elements
      primary: chalk.cyan,
      secondary: chalk.magenta,
      accent: chalk.yellow,

      // Text
      heading: chalk.bold.underline,
      subheading: chalk.bold,
      body: chalk.white,
      muted: chalk.gray,

      // Code
      keyword: chalk.magenta,
      string: chalk.green,
      number: chalk.yellow,
      comment: chalk.gray.italic,
      function: chalk.cyan,

      // Interactive
      prompt: chalk.cyan('>'),
      input: chalk.white,
      selection: chalk.inverse,

      // Box drawing
      border: chalk.gray,

      // Gradients (for special effects)
      gradient: (text) => {
        const colors = [chalk.red, chalk.yellow, chalk.green, chalk.cyan, chalk.blue, chalk.magenta];
        return text.split('').map((char, i) => colors[i % colors.length](char)).join('');
      },
    };
  }

  createNoColorTheme() {
    // Fallback for no color support
    const identity = (text) => text;
    return {
      success: identity,
      error: (text) => `[ERROR] ${text}`,
      warning: (text) => `[WARN] ${text}`,
      info: (text) => `[INFO] ${text}`,
      debug: (text) => `[DEBUG] ${text}`,
      primary: identity,
      secondary: identity,
      accent: identity,
      heading: (text) => `=== ${text} ===`,
      subheading: (text) => `-- ${text} --`,
      body: identity,
      muted: identity,
      keyword: identity,
      string: identity,
      number: identity,
      comment: identity,
      function: identity,
      prompt: '>',
      input: identity,
      selection: (text) => `[${text}]`,
      border: identity,
      gradient: identity,
    };
  }
}
```

---

## 7. Usage Examples

### Session Header
```javascript
function renderSessionHeader(session, theme) {
  const width = 60;
  const border = theme.border('─'.repeat(width));

  console.log(theme.border('┌' + '─'.repeat(width - 2) + '┐'));
  console.log(theme.border('│') +
    theme.primary(' Nexus Cortex') +
    ' '.repeat(width - 30) +
    theme.muted('[Ctrl+C to exit]') +
    theme.border(' │'));
  console.log(theme.border('│') +
    ' Model: ' + theme.accent(session.model) +
    '  Session: ' + theme.info(session.id) +
    theme.border(' │'));
  console.log(theme.border('│') +
    ' Messages: ' + theme.number(session.messages) +
    ' | Tokens: ' + theme.number(session.tokens) +
    ' | Cost: ' + theme.success('$' + session.cost) +
    theme.border(' │'));
  console.log(theme.border('└' + '─'.repeat(width - 2) + '┘'));
}
```

### Tool Execution Display
```javascript
function renderToolExecution(tool, status, theme) {
  const icons = {
    pending: theme.muted('⏳'),
    running: theme.primary('⚙️'),
    success: theme.success('✓'),
    error: theme.error('✗'),
  };

  const statusColors = {
    pending: theme.muted,
    running: theme.primary,
    success: theme.success,
    error: theme.error,
  };

  console.log(
    icons[status] + ' ' +
    theme.function(tool.name) +
    statusColors[status]('(' + tool.args.join(', ') + ')') +
    (status === 'running' ? theme.muted(' ...') : '')
  );
}
```

This gives you a comprehensive overview of the color and theming capabilities available for the CLI using chalk and related libraries.