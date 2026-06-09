# Chalk Themes Collection

Complete theming system for terminal output using Chalk, featuring 13 comprehensive themes with full color palettes and UI components.

## 🎨 Available Themes

1. **VS Code One Dark** - Popular VS Code dark theme
2. **Monokai** - Classic code editor theme
3. **Dracula** - Modern dark theme with vibrant colors
4. **GitHub Light** - Clean, professional light theme
5. **Solarized Dark** - Precision colors for readability
6. **Tokyo Night** - Vibrant dark theme with purple accents
7. **Nord** - Arctic-inspired blue-gray palette
8. **Gruvbox Dark** - Retro groove with warm colors
9. **Material Ocean** - Material design dark variant
10. **Atom One Light** - Atom editor light theme
11. **Palenight** - Elegant material dark theme
12. **Cobalt2** - Vibrant blue theme with yellow accents
13. **Aura** - Purple-based dark theme

## 📁 File Structure

```
chalk/
├── README.md                     # This file
├── theme-definitions.js          # All theme color definitions
├── chalk-themes.js              # Main theming library with utilities
│
├── view-more-themes.py          # ⭐ Comprehensive Python demo (12+ themes)
├── view-all-themes.py           # Complete theme gallery in Python
├── view-colors.py               # Basic color test in Python
│
├── demo-colors-working.cjs      # Clean working Node.js demo
├── demo-themes-simple.cjs       # Simple theme showcase
├── demo-themes-forced-colors.cjs # Force color output demo
├── demo-themes.js               # ES module version
│
├── COLORS_AND_THEMES.md         # Complete documentation
├── THEME_SAMPLES_SUMMARY.md     # Quick summary guide
├── README_THEMES.md             # Original theme documentation
└── view-colors.sh               # Shell script for HTML preview
```

## 🚀 Quick Start

### Using the Main Library

```javascript
const ChalkThemes = require('./chalk-themes.js');

// Create themed instance
const theme = new ChalkThemes('tokyoNight');

// Use theme colors
console.log(theme.successMessage('Build completed'));
console.log(theme.errorMessage('Connection failed'));
console.log(theme.progressBar(0.75));
```

### Run Demos

```bash
# Main library demo (recommended)
node chalk-themes.js              # Default theme
node chalk-themes.js tokyoNight   # Specific theme
node chalk-themes.js list         # List all themes
node chalk-themes.js demo         # Demo all themes

# Python demos (visual output guaranteed)
python3 view-more-themes.py       # ⭐ Best comprehensive view
python3 view-all-themes.py        # Complete gallery
python3 view-colors.py            # Basic test

# Node.js demos
node demo-colors-working.cjs      # Clean demo
node demo-themes-simple.cjs       # Simple showcase
```

## 💡 Usage Examples

### Basic Theme Usage

```javascript
const ChalkThemes = require('./chalk-themes.js');
const theme = new ChalkThemes('dracula');

// Status messages
console.log(theme.successMessage('Tests passed'));
console.log(theme.errorMessage('Build failed'));
console.log(theme.warningMessage('Deprecated API'));
console.log(theme.infoMessage('Server ready'));

// Tool execution
console.log(theme.toolRunning('glob', '**/*.ts'));
console.log(theme.toolSuccess('read', 'file.txt'));
console.log(theme.toolError('write', 'file.txt', 'Permission denied'));
```

### Progress Indicators

```javascript
// Standard progress bar
console.log(theme.progressBar(0.65));

// Gradient progress bar
console.log(theme.gradientProgressBar(0.65));
```

### Session Header

```javascript
const session = {
  model: 'gemini-2.5-flash',
  id: 'abc-123',
  messages: '12',
  tokens: '45.2K',
  cost: '$0.03'
};

console.log(theme.sessionHeader(session));
```

### Boxes and Containers

```javascript
// Single line box
console.log(theme.singleBox('Content here', 'Title'));

// Double line box
console.log(theme.doubleBox('Important message', 'Alert'));

// Rounded box
console.log(theme.roundedBox('Information', 'Info'));
```

### Code Syntax Highlighting

```javascript
const code = `
async function process() {
  const result = await api.call();
  return result;
}
`;

console.log(theme.codeBlock(code, 'javascript'));
```

### Rainbow Text

```javascript
console.log(theme.rainbowText('OMNICLAUDE V4 CLI'));
```

## 🔧 Theme Structure

Each theme contains:

```javascript
{
  name: 'Theme Name',
  // UI Colors
  primary: '#7aa2f7',    // Main brand color
  secondary: '#bb9af7',  // Secondary actions
  success: '#9ece6a',    // Success states
  warning: '#e0af68',    // Warnings
  error: '#f7768e',      // Errors
  info: '#7dcfff',       // Information
  text: '#a9b1d6',       // Main text
  dimmed: '#565f89',     // Muted text
  background: '#1a1b26', // Background

  // Syntax Highlighting
  keyword: '#9d7cd8',    // Keywords
  function: '#7aa2f7',   // Functions
  string: '#9ece6a',     // Strings
  number: '#ff9e64',     // Numbers
  variable: '#bb9af7',   // Variables
  comment: '#565f89'     // Comments
}
```

## 🎯 Best Practices

1. **Choose a theme** that matches your brand or preference
2. **Use consistently** throughout your CLI
3. **Test in different terminals** for color support
4. **Provide fallbacks** for terminals without color
5. **Use semantic colors** (success=green, error=red, etc.)

## 🌟 Recommended Themes

- **Dark terminals**: Tokyo Night, Dracula, VS Code One Dark
- **Light terminals**: GitHub Light, Atom One Light
- **High contrast**: Cobalt2, Monokai
- **Subtle colors**: Nord, Gruvbox Dark
- **Material design**: Material Ocean, Palenight

## 📝 Notes

- The `view-more-themes.py` script provides the most comprehensive visual demonstration
- All themes support 256 colors and true color (16M colors)
- Themes are optimized for both dark and light terminal backgrounds
- Each theme includes both UI colors and syntax highlighting colors