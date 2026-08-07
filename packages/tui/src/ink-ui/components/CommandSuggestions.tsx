/**
 * CommandSuggestions - Autocomplete dropdown for slash commands
 *
 * Displays fuzzy-matched command suggestions as user types.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';
import type { FlatCommand } from '../commands/slashCommands.js';

export interface CommandSuggestionsProps {
  suggestions: FlatCommand[];
  selectedIndex: number;
  maxVisible?: number;
}

/**
 * Category icons
 */
const categoryIcons: Record<string, string> = {
  core: '⚡',
  model: '',
  session: '',
  config: '⚙',
  tools: '',
  mcp: '',
};

/**
 * CommandSuggestions - Dropdown showing matching slash commands
 * Shows items with scroll indicators for navigating the full list
 */
export const CommandSuggestions: React.FC<CommandSuggestionsProps> = ({
  suggestions,
  selectedIndex,
  maxVisible = 8,
}) => {
  if (suggestions.length === 0) {
    return null;
  }

  // Calculate scroll offset to keep selected item visible
  const scrollOffset = Math.max(0, Math.min(
    selectedIndex - Math.floor(maxVisible / 2),
    suggestions.length - maxVisible
  ));

  const visibleSuggestions = suggestions.slice(
    scrollOffset,
    scrollOffset + maxVisible
  );

  const showUpArrow = scrollOffset > 0;
  const showDownArrow = scrollOffset + maxVisible < suggestions.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={Colors.AccentCyan}
      paddingX={1}
      marginBottom={1}
    >
      {/* Header */}
      <Box marginBottom={0}>
        <Text dimColor>
          Commands ({suggestions.length})
        </Text>
      </Box>

      {/* Scroll indicator up */}
      {showUpArrow && (
        <Box>
          <Text dimColor>  ▲ more</Text>
        </Box>
      )}

      {/* Suggestions list */}
      {visibleSuggestions.map((suggestion, index) => {
        const actualIndex = scrollOffset + index;
        const isSelected = actualIndex === selectedIndex;
        const icon = categoryIcons[suggestion.category] || '•';

        return (
          <Box key={suggestion.fullPath} flexDirection="row">
            {/* Selection indicator */}
            <Text color={isSelected ? Colors.AccentCyan : undefined}>
              {isSelected ? '❯' : ' '}
            </Text>

            {/* Category icon */}
            <Text> {icon} </Text>

            {/* Command path */}
            <Box width={20}>
              <Text
                color={isSelected ? Colors.AccentCyan : Colors.AccentGreen}
                bold={isSelected}
              >
                {suggestion.fullPath}
              </Text>
            </Box>

            {/* Description */}
            <Box flexGrow={1}>
              <Text
                color={isSelected ? Colors.Foreground : Colors.Gray}
                wrap="truncate"
              >
                {suggestion.description}
              </Text>
            </Box>
          </Box>
        );
      })}

      {/* Scroll indicator down */}
      {showDownArrow && (
        <Box>
          <Text dimColor>  ▼ more</Text>
        </Box>
      )}

      {/* Footer hints */}
      <Box marginTop={0} borderStyle={undefined}>
        <Text dimColor>
          ↑↓ select • Tab complete • Enter execute • Esc close
        </Text>
      </Box>
    </Box>
  );
};

export default CommandSuggestions;
