# Ink Themes Complete Guide - React Components for Terminal

## Overview

Ink is React for the terminal - it allows you to build interactive CLI apps using React components. This guide shows all the theme capabilities and how to implement them in Nexus Cortex CLI.

## Running the Demos

### Basic Demo (CommonJS - easiest to run)
```bash
node ink-theme-demo.cjs
```

### Advanced Components Demo
```bash
node ink-theme-components.jsx
```

### Interactive Theme Switcher
```bash
node ink-theme-interactive.jsx
```

## Complete Theme Collection (12 Themes)

### 1. VS Code One Dark
```javascript
const vscode = {
  primary: '#61AFEF',    // Soft blue
  secondary: '#C678DD',  // Purple
  success: '#98C379',    // Green
  warning: '#E5C07B',    // Yellow
  error: '#E06C75',      // Red
  info: '#56B6C2',       // Cyan
  text: '#ABB2BF',       // Light gray
  dimmed: '#5C6370'      // Dark gray
}
```

### 2. Monokai
```javascript
const monokai = {
  primary: '#66D9EF',    // Cyan
  secondary: '#F92672',  // Pink
  success: '#A6E22E',    // Green
  warning: '#FD971F',    // Orange
  error: '#F92672',      // Pink
  info: '#AE81FF',       // Purple
  text: '#F8F8F2',       // White
  dimmed: '#75715E'      // Gray
}
```

### 3. Dracula
```javascript
const dracula = {
  primary: '#8BE9FD',    // Cyan
  secondary: '#FF79C6',  // Pink
  success: '#50FA7B',    // Green
  warning: '#FFB86C',    // Orange
  error: '#FF5555',      // Red
  info: '#BD93F9',       // Purple
  text: '#F8F8F2',       // White
  dimmed: '#6272A4'      // Comment gray
}
```

### 4. GitHub Light
```javascript
const githubLight = {
  primary: '#0969da',    // Blue
  secondary: '#8250df',  // Purple
  success: '#1a7f37',    // Green
  warning: '#9a6700',    // Yellow
  error: '#cf222e',      // Red
  info: '#0969da',       // Blue
  text: '#1f2328',       // Black
  dimmed: '#656d76'      // Gray
}
```

### 5. Solarized Dark
```javascript
const solarizedDark = {
  primary: '#268bd2',    // Blue
  secondary: '#2aa198',  // Cyan
  success: '#859900',    // Green
  warning: '#b58900',    // Yellow
  error: '#dc322f',      // Red
  info: '#6c71c4',       // Violet
  text: '#839496',       // Base0
  dimmed: '#586e75'      // Base01
}
```

### 6. Tokyo Night
```javascript
const tokyoNight = {
  primary: '#7aa2f7',    // Blue
  secondary: '#bb9af7',  // Purple
  success: '#9ece6a',    // Green
  warning: '#e0af68',    // Yellow
  error: '#f7768e',      // Red
  info: '#7dcfff',       // Cyan
  text: '#a9b1d6',       // Foreground
  dimmed: '#565f89'      // Comment
}
```

### 7. Nord
```javascript
const nord = {
  primary: '#88C0D0',    // Frost cyan
  secondary: '#81A1C1',  // Frost blue
  success: '#A3BE8C',    // Aurora green
  warning: '#EBCB8B',    // Aurora yellow
  error: '#BF616A',      // Aurora red
  info: '#5E81AC',       // Frost deep blue
  text: '#D8DEE9',       // Snow storm
  dimmed: '#4C566A'      // Polar night
}
```

### 8. Gruvbox Dark
```javascript
const gruvboxDark = {
  primary: '#83a598',    // Aqua
  secondary: '#d3869b',  // Purple
  success: '#b8bb26',    // Green
  warning: '#fabd2f',    // Yellow
  error: '#fb4934',      // Red
  info: '#8ec07c',       // Aqua light
  text: '#ebdbb2',       // Light
  dimmed: '#928374'      // Gray
}
```

### 9. Material Ocean
```javascript
const materialOcean = {
  primary: '#82AAFF',    // Blue
  secondary: '#C792EA',  // Purple
  success: '#C3E88D',    // Green
  warning: '#FFCB6B',    // Yellow
  error: '#F07178',      // Red
  info: '#89DDFF',       // Cyan
  text: '#EEFFFF',       // White
  dimmed: '#546E7A'      // Gray
}
```

### 10. Atom One Light
```javascript
const atomOneLight = {
  primary: '#4078f2',    // Blue
  secondary: '#a626a4',  // Purple
  success: '#50a14f',    // Green
  warning: '#c18401',    // Orange
  error: '#e45649',      // Red
  info: '#0184bc',       // Cyan
  text: '#383a42',       // Black
  dimmed: '#a0a1a7'      // Gray
}
```

### 11. Palenight
```javascript
const palenight = {
  primary: '#82b1ff',    // Blue
  secondary: '#c792ea',  // Purple
  success: '#c3e88d',    // Green
  warning: '#ffcb6b',    // Yellow
  error: '#ff5370',      // Red
  info: '#82aaff',       // Light blue
  text: '#959dcb',       // Text
  dimmed: '#676e95'      // Comment
}
```

### 12. Cobalt2
```javascript
const cobalt2 = {
  primary: '#ffc600',    // Yellow
  secondary: '#ff0088',  // Pink
  success: '#9eff80',    // Green
  warning: '#ff9d00',    // Orange
  error: '#ff628c',      // Red pink
  info: '#80ffbb',       // Cyan
  text: '#ffffff',       // White
  dimmed: '#8b9dc3'      // Gray
}
```

## Ink Component Examples

### Basic Text with Theme
```jsx
import React from 'react';
import {Box, Text} from 'ink';

function ThemedText({theme}) {
  return (
    <Box>
      <Text color={theme.primary}>Primary text</Text>
      <Text color={theme.secondary}> Secondary text</Text>
      <Text color={theme.success}> Success text</Text>
    </Box>
  );
}
```

### Status Messages
```jsx
function StatusMessages({theme}) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.success}>✓ </Text>
        <Text>Build completed</Text>
      </Box>
      <Box>
        <Text color={theme.error}>✗ </Text>
        <Text>Tests failed</Text>
      </Box>
      <Box>
        <Text color={theme.warning}>⚠ </Text>
        <Text>Low memory</Text>
      </Box>
      <Box>
        <Text color={theme.info}>ℹ </Text>
        <Text>Server ready</Text>
      </Box>
    </Box>
  );
}
```

### Bordered Box with Theme
```jsx
function ThemedBox({theme, children}) {
  return (
    <Box
      borderStyle="round"
      borderColor={theme.primary}
      padding={1}
    >
      {children}
    </Box>
  );
}
```

### Loading Spinner with Theme
```jsx
import Spinner from 'ink-spinner';

function ThemedSpinner({theme, text}) {
  return (
    <Box>
      <Text color={theme.info}>
        <Spinner type="dots"/>
      </Text>
      <Text color={theme.text}> {text}</Text>
    </Box>
  );
}
```

### Progress Bar Component
```jsx
import ProgressBar from 'ink-progress-bar';

function ThemedProgress({theme, percent}) {
  return (
    <Box>
      <Box width={30}>
        <ProgressBar
          percent={percent}
          character="█"
          incompleteCharacter="░"
          color={theme.success}
        />
      </Box>
      <Text color={theme.warning}> {Math.round(percent * 100)}%</Text>
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
      itemComponent={({label, isSelected}) => (
        <Text color={isSelected ? theme.primary : theme.text}>
          {label}
        </Text>
      )}
    />
  );
}
```

### Gradient Text
```jsx
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';

function GradientHeader() {
  return (
    <Gradient name="rainbow">
      <BigText text="OMNICLAUDE" font="chrome"/>
    </Gradient>
  );
}
```

## Implementation in Nexus Cortex CLI

### 1. Create Theme Provider
```jsx
// themes/provider.jsx
import React, {createContext, useContext, useState} from 'react';
import {themes} from './themes';

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

### 2. Main App Structure
```jsx
// app.jsx
import React from 'react';
import {render} from 'ink';
import {ThemeProvider} from './themes/provider';
import {MainUI} from './components/MainUI';

function App() {
  return (
    <ThemeProvider>
      <MainUI />
    </ThemeProvider>
  );
}

render(<App />);
```

### 3. Session Header Component
```jsx
function SessionHeader() {
  const {theme} = useTheme();

  return (
    <Box
      borderStyle="round"
      borderColor={theme.primary}
      padding={1}
      width="100%"
    >
      <Box flexDirection="column">
        <Box>
          <Text color={theme.primary} bold>Nexus Cortex</Text>
          <Text color={theme.dimmed}> - Session Active</Text>
        </Box>
        <Box marginTop={1}>
          <Text>Model: </Text>
          <Text color={theme.warning}>gemini-2.5-flash</Text>
          <Text> | Messages: </Text>
          <Text color={theme.info}>12</Text>
          <Text> | Cost: </Text>
          <Text color={theme.success}>$0.03</Text>
        </Box>
      </Box>
    </Box>
  );
}
```

### 4. Tool Execution Display
```jsx
function ToolExecution({tool, status}) {
  const {theme} = useTheme();

  const statusIcons = {
    running: '⏳',
    success: '✓',
    error: '✗'
  };

  const statusColors = {
    running: theme.info,
    success: theme.success,
    error: theme.error
  };

  return (
    <Box>
      <Text color={statusColors[status]}>
        {statusIcons[status]}
      </Text>
      <Text color={theme.primary}>{tool.name}</Text>
      <Text color={theme.dimmed}>({tool.args})</Text>
    </Box>
  );
}
```

### 5. Message Display
```jsx
function MessageDisplay({message}) {
  const {theme} = useTheme();

  return (
    <Box
      borderStyle="single"
      borderColor={message.role === 'user' ? theme.primary : theme.secondary}
      padding={1}
      marginBottom={1}
    >
      <Box flexDirection="column">
        <Text color={message.role === 'user' ? theme.primary : theme.secondary} bold>
          {message.role === 'user' ? '👤 User' : '🤖 Assistant'}
        </Text>
        <Text color={theme.text}>{message.content}</Text>
      </Box>
    </Box>
  );
}
```

## Available Ink Components

### Core Components
- `Box` - Flexbox container
- `Text` - Text display with color/style
- `Newline` - Line break
- `Static` - Static list rendering
- `Transform` - Text transformation

### Input Components
- `TextInput` - Text input field
- `SelectInput` - Menu selection
- `MultiSelectInput` - Multiple selection
- `PasswordInput` - Password field
- `ConfirmInput` - Yes/No confirmation

### Display Components
- `Spinner` - Loading indicators
- `ProgressBar` - Progress display
- `Badge` - Label badges
- `Divider` - Visual separator
- `Table` - Tabular data

### Advanced Components
- `Gradient` - Gradient text
- `BigText` - ASCII art text
- `Link` - Clickable links
- `Image` - Terminal images
- `Markdown` - Markdown rendering

## Theme Switching Implementation

```jsx
function ThemeSwitcher() {
  const {theme, setTheme} = useTheme();
  const themes = getAllThemes();

  const items = themes.map(t => ({
    label: t.name,
    value: t
  }));

  return (
    <Box>
      <Text>Select theme: </Text>
      <SelectInput
        items={items}
        onSelect={item => setTheme(item.value)}
        indicatorComponent={({isSelected}) => (
          <Text color={isSelected ? theme.success : theme.dimmed}>
            {isSelected ? '▶' : ' '}
          </Text>
        )}
      />
    </Box>
  );
}
```

## Package.json Scripts

Add to your package.json:
```json
{
  "scripts": {
    "demo:ink": "node ink-theme-demo.cjs",
    "demo:ink:components": "node ink-theme-components.jsx",
    "demo:ink:interactive": "node ink-theme-interactive.jsx"
  }
}
```

## Summary

Ink provides a powerful way to build interactive terminal UIs with React. The 12 themes shown here cover a wide range of popular editor and terminal themes, from dark themes like VS Code, Dracula, and Tokyo Night, to light themes like GitHub Light and Atom One Light.

Key advantages of using Ink for Nexus Cortex CLI:
- **React ecosystem** - Familiar component model
- **Interactive UI** - Keyboard input, menus, forms
- **Real-time updates** - Live progress, streaming responses
- **Theme support** - Easy color/style management
- **Component reuse** - Build once, use everywhere

Run the demos to see all themes in action!