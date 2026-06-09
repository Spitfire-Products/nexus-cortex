#!/usr/bin/env node
import React from 'react';
import {render, Box, Text, Newline, Static} from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import ProgressBar from 'ink-progress-bar';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';

// GitHub Light Theme
const githubLight = {
  primary: '#0969da',
  secondary: '#8250df',
  success: '#1a7f37',
  warning: '#9a6700',
  error: '#cf222e',
  info: '#0969da',
  text: '#1f2328',
  dimmed: '#656d76',
  accent: '#0969da'
};

// Solarized Dark Theme
const solarizedDark = {
  primary: '#268bd2',
  secondary: '#2aa198',
  success: '#859900',
  warning: '#b58900',
  error: '#dc322f',
  info: '#6c71c4',
  text: '#839496',
  dimmed: '#586e75',
  accent: '#cb4b16'
};

// Tokyo Night Theme
const tokyoNight = {
  primary: '#7aa2f7',
  secondary: '#bb9af7',
  success: '#9ece6a',
  warning: '#e0af68',
  error: '#f7768e',
  info: '#7dcfff',
  text: '#a9b1d6',
  dimmed: '#565f89',
  accent: '#ff9e64'
};

function ComponentShowcase() {
  const [theme, setTheme] = React.useState(tokyoNight);
  const [inputValue, setInputValue] = React.useState('');
  const [selectedOption, setSelectedOption] = React.useState('');
  const [progress] = React.useState(0.7);

  const menuItems = [
    {label: 'Create new project', value: 'create'},
    {label: 'Open existing project', value: 'open'},
    {label: 'Run tests', value: 'test'},
    {label: 'Build for production', value: 'build'},
    {label: 'Deploy to server', value: 'deploy'}
  ];

  const activities = [
    {icon: '📦', status: 'Building', color: theme.warning},
    {icon: '✓', status: 'Tests passed', color: theme.success},
    {icon: '⚠', status: 'Warning: Deprecated API', color: theme.warning},
    {icon: '✗', status: 'Build failed', color: theme.error},
    {icon: 'ℹ', status: 'Server running', color: theme.info}
  ];

  return (
    <Box flexDirection="column" padding={1}>
      {/* Gradient Header */}
      <Box marginBottom={1}>
        <Gradient name="rainbow">
          <BigText text="OMNICLAUDE" font="chrome"/>
        </Gradient>
      </Box>

      {/* Theme Selector Card */}
      <Box
        borderStyle="round"
        borderColor={theme.primary}
        padding={1}
        marginBottom={1}
        flexDirection="column"
      >
        <Text color={theme.primary} bold>
          🎨 Theme Configuration
        </Text>
        <Box marginTop={1}>
          <Box width="33%">
            <Box
              borderStyle="single"
              borderColor={tokyoNight.primary}
              padding={1}
              marginRight={1}
            >
              <Text color={tokyoNight.primary}>Tokyo Night</Text>
            </Box>
          </Box>
          <Box width="33%">
            <Box
              borderStyle="single"
              borderColor={solarizedDark.primary}
              padding={1}
              marginRight={1}
            >
              <Text color={solarizedDark.primary}>Solarized</Text>
            </Box>
          </Box>
          <Box width="33%">
            <Box
              borderStyle="single"
              borderColor={githubLight.primary}
              padding={1}
            >
              <Text color={githubLight.primary}>GitHub</Text>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Loading States */}
      <Box
        borderStyle="double"
        borderColor={theme.primary}
        padding={1}
        marginBottom={1}
        flexDirection="column"
      >
        <Text color={theme.primary} bold>
          🔄 Loading States
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={theme.info}>
              <Spinner type="dots"/> Processing request...
            </Text>
          </Box>
          <Box>
            <Text color={theme.warning}>
              <Spinner type="dots2"/> Compiling TypeScript...
            </Text>
          </Box>
          <Box>
            <Text color={theme.success}>
              <Spinner type="bouncingBar"/> Running tests...
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Progress Bars */}
      <Box
        borderStyle="classic"
        borderColor={theme.secondary}
        padding={1}
        marginBottom={1}
        flexDirection="column"
      >
        <Text color={theme.secondary} bold>
          📊 Progress Indicators
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text}>Build Progress:</Text>
          <Box>
            <Box width={30}>
              <ProgressBar
                percent={0.7}
                character="█"
                incompleteCharacter="░"
                color={theme.success}
              />
            </Box>
            <Text color={theme.warning}> 70%</Text>
          </Box>

          <Text color={theme.text}>Test Coverage:</Text>
          <Box>
            <Box width={30}>
              <ProgressBar
                percent={0.85}
                character="▓"
                incompleteCharacter="░"
                color={theme.info}
              />
            </Box>
            <Text color={theme.info}> 85%</Text>
          </Box>
        </Box>
      </Box>

      {/* Activity Log */}
      <Box
        borderStyle="round"
        borderColor={theme.accent}
        padding={1}
        marginBottom={1}
        flexDirection="column"
      >
        <Text color={theme.accent} bold>
          📋 Activity Log
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Static items={activities}>
            {activity => (
              <Box key={activity.status}>
                <Text color={activity.color}>{activity.icon} </Text>
                <Text color={theme.text}>{activity.status}</Text>
              </Box>
            )}
          </Static>
        </Box>
      </Box>

      {/* Input Components */}
      <Box
        borderStyle="single"
        borderColor={theme.primary}
        padding={1}
        marginBottom={1}
        flexDirection="column"
      >
        <Text color={theme.primary} bold>
          ⌨️ Input Components
        </Text>
        <Box marginTop={1}>
          <Text color={theme.text}>Enter command: </Text>
          <Box borderStyle="single" borderColor={theme.dimmed} padding={0}>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              placeholder="Type here..."
            />
          </Box>
        </Box>
      </Box>

      {/* Menu Selection */}
      <Box
        borderStyle="arrow"
        borderColor={theme.info}
        padding={1}
        marginBottom={1}
        flexDirection="column"
      >
        <Text color={theme.info} bold>
          📜 Menu Selection
        </Text>
        <Box marginTop={1} height={7}>
          <SelectInput
            items={menuItems}
            onSelect={item => setSelectedOption(item.value)}
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
        </Box>
      </Box>

      {/* Status Bar */}
      <Box
        borderStyle="single"
        borderColor={theme.dimmed}
        padding={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <Text color={theme.dimmed}>
          Mode: <Text color={theme.success}>Development</Text>
        </Text>
        <Text color={theme.dimmed}>
          Port: <Text color={theme.info}>3000</Text>
        </Text>
        <Text color={theme.dimmed}>
          Memory: <Text color={theme.warning}>245MB</Text>
        </Text>
        <Text color={theme.dimmed}>
          CPU: <Text color={theme.success}>12%</Text>
        </Text>
      </Box>
    </Box>
  );
}

render(<ComponentShowcase />);