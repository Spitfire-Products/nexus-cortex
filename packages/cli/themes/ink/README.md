# Ink Themes Collection

React-based terminal UI components with comprehensive theming system for Nexus Cortex CLI.

## 🎨 Available Themes

Same 13 themes as Chalk, but with interactive React components:

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
13. **Aura** - Purple-based dark theme (in theme definitions)

## 📁 File Structure

```
ink/
├── README.md                    # This file
├── ink-theme-demo.cjs          # ⭐ All themes in one view (CommonJS)
├── ink-theme-interactive.jsx   # ⭐ Interactive theme switcher (arrow keys!)
├── ink-theme-components.jsx    # Advanced components demo
├── ink-theme-basic.jsx        # Basic theme showcase
├── INK_THEMES_GUIDE.md         # Complete implementation guide
└── INK_THEMES_SUMMARY.md       # Quick summary
```

## 🚀 Quick Start

### Run Interactive Demos

```bash
# Best demos to try first:
node ink-theme-demo.cjs          # ⭐ Shows all 12 themes at once
node ink-theme-interactive.jsx   # ⭐ Navigate with arrow keys!

# Other demos:
node ink-theme-components.jsx    # Advanced UI components
node ink-theme-basic.jsx        # Basic showcase
```

### Interactive Controls

In `ink-theme-interactive.jsx`:
- **← / A**: Previous theme
- **→ / D**: Next theme
- **H**: Toggle help
- **Q / ESC**: Quit

## 💡 Key Differences: Ink vs Chalk

### Ink (React Terminal UI)
- **Interactive** - Keyboard input, menus, forms
- **Stateful** - Automatic re-renders on state change
- **Components** - Reusable UI components
- **Layout** - Flexbox-based positioning
- **Updates** - Live updates without flicker

### Chalk (Direct Output)
- **Static** - Direct color output
- **Streaming** - Character-by-character output
- **Simple** - No framework overhead
- **Fast** - Immediate rendering
- **Lightweight** - Minimal dependencies

## 📦 Ink Components Used

### Core Components
- `<Box>` - Flexbox container
- `<Text>` - Styled text
- `<Static>` - Static list rendering
- `<Newline>` - Line breaks

### Input Components
- `<TextInput>` - Text input field
- `<SelectInput>` - Menu selection
- `<ConfirmInput>` - Yes/No prompts

### Display Components
- `<Spinner>` - Loading indicators
- `<ProgressBar>` - Progress display
- `<Gradient>` - Gradient text
- `<BigText>` - ASCII art text

## 💻 Usage Examples

### Basic Theme Component

```jsx
import React from 'react';
import {Box, Text} from 'ink';

function ThemedMessage({theme}) {
  return (
    <Box>
      <Text color={theme.success}>✓ </Text>
      <Text>Build completed</Text>
    </Box>
  );
}
```

### Interactive Menu

```jsx
import SelectInput from 'ink-select-input';

function ThemedMenu({theme, items}) {
  return (
    <SelectInput
      items={items}
      indicatorComponent={({isSelected}) => (
        <Text color={isSelected ? theme.success : theme.dimmed}>
          {isSelected ? '▶' : ' '}
        </Text>
      )}
    />
  );
}
```

### Session Display

```jsx
function SessionHeader({theme, session}) {
  return (
    <Box
      borderStyle="round"
      borderColor={theme.primary}
      padding={1}
    >
      <Box flexDirection="column">
        <Text color={theme.primary} bold>
          Nexus Cortex
        </Text>
        <Box>
          <Text>Model: </Text>
          <Text color={theme.warning}>{session.model}</Text>
        </Box>
      </Box>
    </Box>
  );
}
```

### Progress with Theme

```jsx
import ProgressBar from 'ink-progress-bar';

function ThemedProgress({theme, percent}) {
  return (
    <Box>
      <ProgressBar
        percent={percent}
        character="█"
        incompleteCharacter="░"
        color={theme.success}
      />
      <Text color={theme.warning}> {Math.round(percent * 100)}%</Text>
    </Box>
  );
}
```

## 🎯 Best Use Cases for Ink

1. **Interactive CLI Mode** - When users need to interact with menus
2. **Dashboard Views** - Multiple updating components
3. **Setup Wizards** - Step-by-step configuration
4. **Live Monitoring** - Real-time status updates
5. **Form Input** - Collecting user information

## 🔄 State Management Pattern

```jsx
// Theme Provider Pattern
import React, {createContext, useContext, useState} from 'react';

const ThemeContext = createContext();

export function ThemeProvider({children}) {
  const [theme, setTheme] = useState(themes.tokyoNight);

  return (
    <ThemeContext.Provider value={{theme, setTheme}}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
```

## 📊 Component Architecture

```
App
├── ThemeProvider
│   ├── SessionHeader
│   ├── MessageDisplay
│   │   ├── UserMessage
│   │   └── AssistantMessage
│   ├── ToolExecutionPanel
│   │   └── ToolStatus
│   └── InputArea
│       └── TextInput
```

## 🌟 Features Demonstrated

- **Theme Switching** - Real-time theme changes
- **Interactive Menus** - Keyboard navigation
- **Loading States** - Multiple spinner types
- **Progress Tracking** - Visual progress bars
- **Status Messages** - Colored status indicators
- **Box Layouts** - Various border styles
- **Gradient Effects** - Rainbow text
- **ASCII Art** - Big text displays

## 📝 Notes

- Ink requires React knowledge but provides powerful UI capabilities
- Best for interactive modes, not for streaming LLM responses
- All components are fully themed and reusable
- The interactive demo (`ink-theme-interactive.jsx`) showcases real-time theme switching
- CommonJS version (`ink-theme-demo.cjs`) avoids ES module issues

## 🚦 When to Use Ink vs Chalk

**Use Ink when you need:**
- User interaction (menus, forms)
- Live updates
- Complex layouts
- Stateful UI

**Use Chalk when you need:**
- Streaming output
- Simple colored text
- Minimal overhead
- Direct stdout control