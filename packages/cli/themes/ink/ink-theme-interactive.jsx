#!/usr/bin/env node
import React, {useState} from 'react';
import {render, Box, Text, useInput, useApp} from 'ink';
import Gradient from 'ink-gradient';
import figlet from 'figlet';

// Complete theme collection
const themes = {
  vscode: {
    name: 'VS Code One Dark',
    primary: '#61AFEF',
    secondary: '#C678DD',
    success: '#98C379',
    warning: '#E5C07B',
    error: '#E06C75',
    info: '#56B6C2',
    text: '#ABB2BF',
    dimmed: '#5C6370',
    bg: '#282C34'
  },
  monokai: {
    name: 'Monokai',
    primary: '#66D9EF',
    secondary: '#F92672',
    success: '#A6E22E',
    warning: '#FD971F',
    error: '#F92672',
    info: '#AE81FF',
    text: '#F8F8F2',
    dimmed: '#75715E',
    bg: '#272822'
  },
  dracula: {
    name: 'Dracula',
    primary: '#8BE9FD',
    secondary: '#FF79C6',
    success: '#50FA7B',
    warning: '#FFB86C',
    error: '#FF5555',
    info: '#BD93F9',
    text: '#F8F8F2',
    dimmed: '#6272A4',
    bg: '#282A36'
  },
  github: {
    name: 'GitHub Light',
    primary: '#0969da',
    secondary: '#8250df',
    success: '#1a7f37',
    warning: '#9a6700',
    error: '#cf222e',
    info: '#0969da',
    text: '#1f2328',
    dimmed: '#656d76',
    bg: '#ffffff'
  },
  solarized: {
    name: 'Solarized Dark',
    primary: '#268bd2',
    secondary: '#2aa198',
    success: '#859900',
    warning: '#b58900',
    error: '#dc322f',
    info: '#6c71c4',
    text: '#839496',
    dimmed: '#586e75',
    bg: '#002b36'
  },
  tokyoNight: {
    name: 'Tokyo Night',
    primary: '#7aa2f7',
    secondary: '#bb9af7',
    success: '#9ece6a',
    warning: '#e0af68',
    error: '#f7768e',
    info: '#7dcfff',
    text: '#a9b1d6',
    dimmed: '#565f89',
    bg: '#1a1b26'
  },
  nord: {
    name: 'Nord',
    primary: '#88C0D0',
    secondary: '#81A1C1',
    success: '#A3BE8C',
    warning: '#EBCB8B',
    error: '#BF616A',
    info: '#5E81AC',
    text: '#D8DEE9',
    dimmed: '#4C566A',
    bg: '#2E3440'
  },
  gruvbox: {
    name: 'Gruvbox Dark',
    primary: '#83a598',
    secondary: '#d3869b',
    success: '#b8bb26',
    warning: '#fabd2f',
    error: '#fb4934',
    info: '#8ec07c',
    text: '#ebdbb2',
    dimmed: '#928374',
    bg: '#282828'
  },
  material: {
    name: 'Material Ocean',
    primary: '#82AAFF',
    secondary: '#C792EA',
    success: '#C3E88D',
    warning: '#FFCB6B',
    error: '#F07178',
    info: '#89DDFF',
    text: '#EEFFFF',
    dimmed: '#546E7A',
    bg: '#0F111A'
  },
  atom: {
    name: 'Atom One Light',
    primary: '#4078f2',
    secondary: '#a626a4',
    success: '#50a14f',
    warning: '#c18401',
    error: '#e45649',
    info: '#0184bc',
    text: '#383a42',
    dimmed: '#a0a1a7',
    bg: '#fafafa'
  },
  palenight: {
    name: 'Palenight',
    primary: '#82b1ff',
    secondary: '#c792ea',
    success: '#c3e88d',
    warning: '#ffcb6b',
    error: '#ff5370',
    info: '#82aaff',
    text: '#959dcb',
    dimmed: '#676e95',
    bg: '#292d3e'
  },
  cobalt: {
    name: 'Cobalt2',
    primary: '#ffc600',
    secondary: '#ff0088',
    success: '#9eff80',
    warning: '#ff9d00',
    error: '#ff628c',
    info: '#80ffbb',
    text: '#ffffff',
    dimmed: '#8b9dc3',
    bg: '#193549'
  }
};

function InteractiveThemeDemo() {
  const themeNames = Object.keys(themes);
  const [themeIndex, setThemeIndex] = useState(0);
  const [showHelp, setShowHelp] = useState(true);
  const {exit} = useApp();

  const currentThemeName = themeNames[themeIndex];
  const theme = themes[currentThemeName];

  // Handle keyboard input
  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
    }
    if (key.leftArrow || input === 'a') {
      setThemeIndex((prev) => (prev - 1 + themeNames.length) % themeNames.length);
    }
    if (key.rightArrow || input === 'd') {
      setThemeIndex((prev) => (prev + 1) % themeNames.length);
    }
    if (input === 'h') {
      setShowHelp(!showHelp);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* ASCII Art Header */}
      <Box marginBottom={1}>
        <Text color={theme.primary}>
          {figlet.textSync('INK THEMES', {
            font: 'Small',
            horizontalLayout: 'default',
            verticalLayout: 'default'
          })}
        </Text>
      </Box>

      {/* Theme Name with Navigation */}
      <Box justifyContent="center" marginBottom={1}>
        <Text color={theme.dimmed}>{'<'} </Text>
        <Text color={theme.primary} bold>
          {theme.name} ({themeIndex + 1}/{themeNames.length})
        </Text>
        <Text color={theme.dimmed}> {'>'}</Text>
      </Box>

      {/* Main Content Area */}
      <Box flexDirection="row" marginBottom={1}>
        {/* Left Panel - Color Palette */}
        <Box
          flexDirection="column"
          width="40%"
          borderStyle="round"
          borderColor={theme.primary}
          padding={1}
          marginRight={1}
        >
          <Text color={theme.primary} bold underline>
            Color Palette
          </Text>
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text color={theme.primary}>███ Primary</Text>
            </Box>
            <Box>
              <Text color={theme.secondary}>███ Secondary</Text>
            </Box>
            <Box>
              <Text color={theme.success}>███ Success</Text>
            </Box>
            <Box>
              <Text color={theme.warning}>███ Warning</Text>
            </Box>
            <Box>
              <Text color={theme.error}>███ Error</Text>
            </Box>
            <Box>
              <Text color={theme.info}>███ Info</Text>
            </Box>
            <Box>
              <Text color={theme.text}>███ Text</Text>
            </Box>
            <Box>
              <Text color={theme.dimmed}>███ Dimmed</Text>
            </Box>
          </Box>
        </Box>

        {/* Right Panel - Sample UI */}
        <Box
          flexDirection="column"
          width="60%"
          borderStyle="double"
          borderColor={theme.secondary}
          padding={1}
        >
          <Text color={theme.secondary} bold underline>
            Sample UI Components
          </Text>

          {/* Status Messages */}
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text color={theme.success}>✓ </Text>
              <Text color={theme.text}>Build completed</Text>
            </Box>
            <Box>
              <Text color={theme.error}>✗ </Text>
              <Text color={theme.text}>Tests failed</Text>
            </Box>
            <Box>
              <Text color={theme.warning}>⚠ </Text>
              <Text color={theme.text}>Memory warning</Text>
            </Box>
            <Box>
              <Text color={theme.info}>ℹ </Text>
              <Text color={theme.text}>Server ready</Text>
            </Box>
          </Box>

          {/* Code Sample */}
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.dimmed}>// Code Example</Text>
            <Box>
              <Text color={theme.secondary}>async </Text>
              <Text color={theme.primary}>function </Text>
              <Text color={theme.text}>process() {'{'}</Text>
            </Box>
            <Box>
              <Text color={theme.text}>  </Text>
              <Text color={theme.secondary}>return </Text>
              <Text color={theme.success}>"Done"</Text>
              <Text color={theme.text}>;</Text>
            </Box>
            <Box>
              <Text color={theme.text}>{'}'}</Text>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Progress Bar Sample */}
      <Box
        borderStyle="single"
        borderColor={theme.dimmed}
        padding={1}
        marginBottom={1}
      >
        <Text color={theme.text}>Progress: </Text>
        <Text>[</Text>
        <Text color={theme.success}>████████████████</Text>
        <Text color={theme.dimmed}>████████</Text>
        <Text>] </Text>
        <Text color={theme.warning}>67%</Text>
      </Box>

      {/* Theme Preview Bar */}
      <Box marginBottom={1} justifyContent="center">
        {themeNames.map((name, index) => (
          <Text
            key={name}
            color={index === themeIndex ? themes[name].primary : themes[name].dimmed}
          >
            {index === themeIndex ? '●' : '○'}
          </Text>
        ))}
      </Box>

      {/* Help Instructions */}
      {showHelp && (
        <Box
          borderStyle="classic"
          borderColor={theme.dimmed}
          padding={1}
        >
          <Box flexDirection="column">
            <Text color={theme.info} bold>
              Keyboard Controls:
            </Text>
            <Box marginTop={1}>
              <Text color={theme.text}>
                ← / A: Previous Theme | → / D: Next Theme | H: Toggle Help | Q/ESC: Quit
              </Text>
            </Box>
          </Box>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1} justifyContent="center">
        <Text color={theme.dimmed}>
          Interactive Ink Theme Selector - OmniClaude V4
        </Text>
      </Box>
    </Box>
  );
}

// ASCII art for header (fallback if figlet fails)
const asciiHeader = `
 ___       _      _____ _
|_ _|_ __ | | __ |_   _| |__   ___ _ __ ___   ___  ___
 | || '_ \\| |/ /   | | | '_ \\ / _ \\ '_ \` _ \\ / _ \\/ __|
 | || | | |   <    | | | | | |  __/ | | | | |  __/\\__ \\
|___|_| |_|_|\\_\\   |_| |_| |_|\\___|_| |_| |_|\\___||___/
`;

render(<InteractiveThemeDemo />);