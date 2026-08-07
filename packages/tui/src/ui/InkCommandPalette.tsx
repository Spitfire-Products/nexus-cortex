/**
 * InkCommandPalette - Imperative wrapper for CommandSuggestions
 *
 * Allows fuzzycortex (chalk-based CLI) to use the neoncortex CommandSuggestions
 * component in an imperative way, matching the InkMenuPicker pattern.
 *
 * Both CLIs now use the same visual component and command definitions from core.
 *
 * @module ui/InkCommandPalette
 */

import React, { useState, useEffect, useMemo } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { CommandSuggestions } from '../ink-ui/components/CommandSuggestions.js';
import { getSuggestions, type FlatCommand } from '../ink-ui/commands/slashCommands.js';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';

/**
 * Result from command palette interaction
 */
export interface CommandPaletteResult {
  /** Whether a command was selected */
  selected: boolean;
  /** The selected command (if any) */
  command?: FlatCommand;
  /** Full command path (e.g., "/models list") */
  fullPath?: string;
}

/**
 * Interactive command palette component
 */
interface InteractiveCommandPaletteProps {
  initialQuery: string;
  onComplete: (result: CommandPaletteResult) => void;
}

const InteractiveCommandPalette: React.FC<InteractiveCommandPaletteProps> = ({
  initialQuery,
  onComplete,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const suggestions = useMemo(() => {
    return getSuggestions(query); // No limit - allow scrolling through all commands
  }, [query]);

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions.length]);

  useInput((input, key) => {
    // Navigate up
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    // Navigate down
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(suggestions.length - 1, prev + 1));
      return;
    }

    // Select current
    if (key.return || key.tab) {
      const selected = suggestions[selectedIndex];
      if (selected) {
        onComplete({
          selected: true,
          command: selected,
          fullPath: selected.fullPath,
        });
      }
      return;
    }

    // Cancel
    if (key.escape) {
      onComplete({ selected: false });
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      setQuery((prev) => {
        if (prev.length <= 1) {
          onComplete({ selected: false });
          return prev;
        }
        return prev.slice(0, -1);
      });
      return;
    }

    // Type character
    if (input && input.length === 1 && input.charCodeAt(0) >= 32) {
      setQuery((prev) => prev + input);
      return;
    }
  });

  return (
    <Box flexDirection="column">
      {/* Search input display */}
      <Box marginBottom={1}>
        <Text color={Colors.AccentCyan} bold>
          {query}
          <Text color={Colors.AccentYellow}>_</Text>
        </Text>
      </Box>

      {/* Use the same CommandSuggestions component as neoncortex */}
      <CommandSuggestions
        suggestions={suggestions}
        selectedIndex={selectedIndex}
        maxVisible={12}
      />

      {/* Additional hint for fuzzycortex context */}
      {suggestions.length === 0 && (
        <Box>
          <Text color={Colors.Gray}>No matching commands</Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Show interactive command palette
 *
 * Renders the shared CommandSuggestions component and returns the selected command.
 * This is the imperative entry point for fuzzycortex.
 *
 * @param initialQuery - Initial query (default: "/")
 * @returns Promise resolving to the command palette result
 *
 * @example
 * ```typescript
 * const result = await showCommandPalette('/mod');
 * if (result.selected && result.fullPath) {
 *   // Handle selected command
 *   console.log(`Selected: ${result.fullPath}`);
 * }
 * ```
 */
export async function showCommandPalette(
  initialQuery: string = '/'
): Promise<CommandPaletteResult> {
  return new Promise((resolve) => {
    const { unmount, waitUntilExit } = render(
      <InteractiveCommandPalette
        initialQuery={initialQuery}
        onComplete={(result) => {
          unmount();
          resolve(result);
        }}
      />
    );

    // Handle unexpected exit
    waitUntilExit().catch(() => {
      resolve({ selected: false });
    });
  });
}

export default showCommandPalette;
