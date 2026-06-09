# Nexus Cortex CLI - Theme & Color Demos

## Quick Start

```bash
# Install dependencies
npm install

# Run the theme demo
npm run demo:themes

# Or run directly
node demo-themes-simple.js
```

## What You'll See

The demo displays:

### 1. **Color Palettes**
- Basic 8 colors (red, green, blue, yellow, etc.)
- Bright/high-intensity variants
- 256 color palette samples
- True color (RGB/Hex) gradients and rainbow effects

### 2. **Text Styles**
- Bold, italic, underline, strikethrough
- Dim text, inverse colors
- Combined styles

### 3. **Pre-built Themes**
- **Dark Theme** (VS Code One Dark inspired)
- **Monokai Theme** (Classic code editor theme)
- **Dracula Theme** (Popular dark theme)

### 4. **UI Components**
- ✅ Status messages (success, error, warning, info)
- ⏳ Loading spinners and progress bars
- 📦 Box drawing with different border styles
- 📊 Session header with stats
- 🛠 Tool execution display

### 5. **Syntax Highlighting**
Shows how code can be colorized with proper syntax colors for:
- Keywords (purple/bold)
- Strings (green)
- Numbers (orange)
- Functions (blue)
- Comments (gray/italic)

## Files

- `demo-themes-simple.js` - CommonJS version (works everywhere)
- `demo-themes.js` - ES module version
- `COLORS_AND_THEMES.md` - Complete documentation with all code examples

## Terminal Compatibility

The demo will show different results based on your terminal:

| Terminal | Color Support | Features |
|----------|--------------|----------|
| **iTerm2** (Mac) | Full (16M colors) | All styles work |
| **VS Code Terminal** | Full (16M colors) | All styles work |
| **Windows Terminal** | Full (16M colors) | All styles work |
| **Hyper** | Full (16M colors) | All styles work |
| **Terminal.app** (Mac) | 256 colors | No italic |
| **PuTTY** | 256 colors | Limited styles |
| **cmd.exe** | 16 colors | Very limited |

## Customizing Themes

Edit the theme objects in the demo files to create your own color schemes:

```javascript
const myTheme = {
  primary: chalk.hex('#YOUR_COLOR'),
  secondary: chalk.hex('#YOUR_COLOR'),
  success: chalk.green,
  error: chalk.red,
  // ... add more
};
```

## Using in Your CLI

```javascript
import chalk from 'chalk';

// Create a theme
const theme = {
  success: (text) => chalk.green('✓') + ' ' + chalk.white(text),
  error: (text) => chalk.red('✗') + ' ' + chalk.white(text),
  info: (text) => chalk.blue('ℹ') + ' ' + chalk.white(text),
};

// Use it
console.log(theme.success('Operation completed'));
console.log(theme.error('Something went wrong'));
console.log(theme.info('Server running on port 3000'));
```

## Terminal Color Level Detection

The demo shows your terminal's color support level at the bottom:
- **Level 0**: No color support
- **Level 1**: Basic 16 colors
- **Level 2**: 256 colors
- **Level 3**: True color (16 million colors)

Force a specific level if needed:
```javascript
chalk.level = 3; // Force true color
```