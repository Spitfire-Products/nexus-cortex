/**
 * ThemePicker Component
 * Interactive UI for selecting from 15 professional visual themes
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { ThemeManager, AvailableTheme } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';
import { ConfigManager } from '@nexus-cortex/cli/dist/config/ConfigManager.js';

export interface ThemePickerProps {
  onSelect: (themeName: string) => void;
  onExit: () => void;
}

interface SelectItem {
  label: string;
  value: string | null;
}

export const ThemePicker: React.FC<ThemePickerProps> = ({ onSelect, onExit }) => {
  const currentThemeName = ConfigManager.get('theme') as string || 'default';
  const availableThemes = ThemeManager.getAvailableThemes();
  const [hoveredTheme, setHoveredTheme] = useState<string>(currentThemeName);

  // Create theme items with descriptions
  const themeDescriptions: Record<string, string> = {
    default: 'GitHub-inspired default styling',
    minimal: 'Plain text for maximum compatibility',
    vscodeOneDark: 'Popular VS Code dark theme',
    monokai: 'Classic editor theme for code',
    dracula: 'Vibrant modern dark theme',
    githubLight: 'Clean light background theme',
    solarizedDark: 'Precision colors for long reading',
    tokyoNight: 'Purple-accented dark theme',
    nord: 'Arctic blue-gray minimal theme',
    gruvboxDark: 'Retro warm colors',
    materialOcean: 'Material design dark theme',
    atomOneLight: 'Atom editor light theme',
    palenight: 'Elegant material dark theme',
    cobalt2: 'Vibrant blue/yellow high energy',
    aura: 'Purple-based creative dark theme'
  };

  const themes: SelectItem[] = availableThemes.map(theme => ({
    label: `${themeDescriptions[theme] || theme} ${theme === currentThemeName ? '★' : ''}`,
    value: theme,
  }));

  // Add exit option
  themes.push({ label: '← Exit without changing', value: null });

  const handleSelect = async (item: SelectItem) => {
    if (item.value) {
      try {
        await ThemeManager.setTheme(item.value as AvailableTheme);
        onSelect(item.value);
      } catch (error) {
        console.error('Error setting theme:', error);
      }
    } else {
      onExit();
    }
  };

  // Get theme info for preview
  const previewTheme = hoveredTheme || currentThemeName;
  const themeInfo = ThemeManager.getThemeInfo(previewTheme as AvailableTheme);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
           Nexus Cortex Theme Picker
        </Text>
      </Box>

      <Text color="gray" dimColor>
        Use ↑/↓ to navigate, Enter to select, Ctrl+C to exit
      </Text>

      {/* Theme selection list */}
      <Box marginTop={1} marginBottom={1}>
        <SelectInput
          items={themes}
          onSelect={handleSelect}
          onHighlight={(item) => {
            if (item.value) {
              setHoveredTheme(item.value);
            }
          }}
        />
      </Box>

      {/* Theme preview box */}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
        <Text bold color="cyan">
          Preview: {themeInfo.name} {previewTheme === currentThemeName ? '(Current)' : ''}
        </Text>

        {themeInfo.colors.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text>
              <Text color="green">✓</Text> Success message example
            </Text>
            <Text>
              <Text color="red">✗</Text> Error message example
            </Text>
            <Text>
              <Text color="yellow">⚠</Text> Warning message example
            </Text>
            <Text>
              <Text color="blue">ℹ</Text> Info message example
            </Text>
            <Text color="gray" dimColor>
              • Muted/dimmed text example
            </Text>
          </Box>
        )}

        {themeInfo.colors.length === 0 && (
          <Box marginTop={1}>
            <Text color="gray" dimColor>
              Minimal theme: Plain text, no colors
            </Text>
          </Box>
        )}
      </Box>

      {/* Helper text */}
      <Box marginTop={1} flexDirection="column">
        <Text color="gray" dimColor>
          ★ = Currently active theme
        </Text>
        <Text color="gray" dimColor>
          {themes.length - 1} themes available (13 professional + 2 built-in)
        </Text>
      </Box>
    </Box>
  );
};
