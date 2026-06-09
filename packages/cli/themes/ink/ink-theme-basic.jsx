#!/usr/bin/env node
import React from 'react';
import {render, Box, Text} from 'ink';
import chalk from 'chalk';

// Theme definitions
const themes = {
  vscode: {
    primary: '#61AFEF',
    secondary: '#C678DD',
    success: '#98C379',
    warning: '#E5C07B',
    error: '#E06C75',
    info: '#56B6C2',
    text: '#ABB2BF',
    dimmed: '#5C6370',
    background: '#282C34'
  },
  monokai: {
    primary: '#66D9EF',
    secondary: '#F92672',
    success: '#A6E22E',
    warning: '#FD971F',
    error: '#F92672',
    info: '#AE81FF',
    text: '#F8F8F2',
    dimmed: '#75715E',
    background: '#272822'
  },
  dracula: {
    primary: '#8BE9FD',
    secondary: '#FF79C6',
    success: '#50FA7B',
    warning: '#FFB86C',
    error: '#FF5555',
    info: '#BD93F9',
    text: '#F8F8F2',
    dimmed: '#6272A4',
    background: '#282A36'
  }
};

// Component: Theme Showcase
function ThemeShowcase() {
  const [selectedTheme, setSelectedTheme] = React.useState('vscode');
  const theme = themes[selectedTheme];

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          ════════════════════════════════════════════════════════
        </Text>
      </Box>
      <Box marginBottom={1} justifyContent="center">
        <Text color="cyan" bold>
          INK THEME SHOWCASE - React Components for Terminal
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          ════════════════════════════════════════════════════════
        </Text>
      </Box>

      {/* Current Theme Display */}
      <Box marginBottom={1}>
        <Text bold>Current Theme: </Text>
        <Text color="yellow">{selectedTheme.toUpperCase()}</Text>
      </Box>

      {/* Theme Colors */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Theme Colors:</Text>
        <Box>
          <Text color={theme.primary}>■ Primary </Text>
          <Text color={theme.secondary}>■ Secondary </Text>
          <Text color={theme.success}>■ Success </Text>
        </Box>
        <Box>
          <Text color={theme.warning}>■ Warning </Text>
          <Text color={theme.error}>■ Error </Text>
          <Text color={theme.info}>■ Info </Text>
        </Box>
      </Box>

      {/* Status Messages */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Status Messages:</Text>
        <Box>
          <Text color={theme.success}>✓ </Text>
          <Text>Build completed successfully</Text>
        </Box>
        <Box>
          <Text color={theme.error}>✗ </Text>
          <Text>Error: Connection failed</Text>
        </Box>
        <Box>
          <Text color={theme.warning}>⚠ </Text>
          <Text>Warning: Low memory</Text>
        </Box>
        <Box>
          <Text color={theme.info}>ℹ </Text>
          <Text>Info: Server started on port 3000</Text>
        </Box>
      </Box>

      {/* Box Component with Theme */}
      <Box
        borderStyle="round"
        borderColor={theme.primary}
        padding={1}
        marginBottom={1}
      >
        <Box flexDirection="column">
          <Text color={theme.primary} bold>Session Information</Text>
          <Text color={theme.text}>Model: <Text color={theme.warning}>gemini-2.5-flash</Text></Text>
          <Text color={theme.text}>Messages: <Text color={theme.info}>42</Text></Text>
          <Text color={theme.text}>Tokens: <Text color={theme.info}>12.5K</Text></Text>
          <Text color={theme.text}>Cost: <Text color={theme.success}>$0.05</Text></Text>
        </Box>
      </Box>

      {/* Progress Bar */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Progress:</Text>
        <Box>
          <Text>[</Text>
          <Text color={theme.success}>████████████████████</Text>
          <Text color="gray">░░░░░░░░░░</Text>
          <Text>] </Text>
          <Text color={theme.warning}>65%</Text>
        </Box>
      </Box>

      {/* Tool Execution Display */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Tool Execution:</Text>
        <Box flexDirection="column">
          <Box>
            <Text color={theme.info}>⏳ </Text>
            <Text color={theme.primary}>glob</Text>
            <Text color={theme.dimmed}>("**/*.ts")</Text>
          </Box>
          <Box>
            <Text color={theme.success}>✓ </Text>
            <Text color={theme.primary}>read</Text>
            <Text color={theme.dimmed}>("/src/index.ts")</Text>
          </Box>
          <Box>
            <Text color={theme.error}>✗ </Text>
            <Text color={theme.primary}>write</Text>
            <Text color={theme.dimmed}>("/protected/file")</Text>
            <Text color={theme.error}> - Permission denied</Text>
          </Box>
        </Box>
      </Box>

      {/* Code Block */}
      <Box
        borderStyle="single"
        borderColor={theme.dimmed}
        padding={1}
        marginBottom={1}
      >
        <Box flexDirection="column">
          <Text color={theme.dimmed} italic>// OmniClaude V4 Example</Text>
          <Box>
            <Text color={theme.secondary}>const </Text>
            <Text color={theme.text}>client = </Text>
            <Text color={theme.secondary}>new </Text>
            <Text color={theme.primary}>OmniClaudeClient</Text>
            <Text color={theme.text}>(</Text>
            <Text color={theme.success}>"gemini-2.5"</Text>
            <Text color={theme.text}>);</Text>
          </Box>
          <Box>
            <Text color={theme.secondary}>await </Text>
            <Text color={theme.text}>client.</Text>
            <Text color={theme.primary}>sendMessage</Text>
            <Text color={theme.text}>(</Text>
            <Text color={theme.success}>"Hello, World!"</Text>
            <Text color={theme.text}>);</Text>
          </Box>
        </Box>
      </Box>

      {/* Theme Selector */}
      <Box>
        <Text bold>Select Theme: </Text>
        {Object.keys(themes).map((themeName, index) => (
          <React.Fragment key={themeName}>
            {index > 0 && <Text> | </Text>}
            <Text
              color={selectedTheme === themeName ? 'yellow' : 'white'}
              bold={selectedTheme === themeName}
            >
              {themeName}
            </Text>
          </React.Fragment>
        ))}
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">
          ════════════════════════════════════════════════════════
        </Text>
      </Box>
      <Box>
        <Text color="gray">Run with: node ink-theme-basic.jsx</Text>
      </Box>
    </Box>
  );
}

// Render the app
render(<ThemeShowcase />);