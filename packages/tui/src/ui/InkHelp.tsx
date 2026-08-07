/**
 * InkHelp - Imperative wrapper for unified Help display
 *
 * Allows fuzzycortex (chalk-based CLI) to use the same help rendering
 * as neoncortex, ensuring consistent command display across both CLIs.
 *
 * @module ui/InkHelp
 */

import React from 'react';
import { render, Box, Text, useInput } from 'ink';
import { slashCommandRegistry } from '@nexus-cortex/core';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';

/**
 * Interactive help component - shows all commands from unified registry
 */
interface HelpDisplayProps {
  onClose: () => void;
}

const HelpDisplay: React.FC<HelpDisplayProps> = ({ onClose }) => {
  const allCommands = slashCommandRegistry.getAllCommands();
  const categories = slashCommandRegistry.getCategories();

  // Group commands by category
  const grouped: Record<string, typeof allCommands> = {};
  for (const cmd of allCommands) {
    if (!grouped[cmd.category]) grouped[cmd.category] = [];
    grouped[cmd.category].push(cmd);
  }

  useInput((input, key) => {
    // Close on ESC, q, or Enter
    if (key.escape || input === 'q' || key.return) {
      onClose();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={Colors.AccentCyan}>
        ━━━ CORTEX Help ({allCommands.length} commands) ━━━
      </Text>
      <Text></Text>

      {/* Basics */}
      <Text bold color={Colors.AccentYellow}>Basics:</Text>
      <Text>
        <Text bold color={Colors.AccentCyan}>@</Text>
        <Text> - Add file context (e.g., @src/myFile.ts)</Text>
      </Text>
      <Text>
        <Text bold color={Colors.AccentCyan}>!</Text>
        <Text> - Execute shell command (e.g., !npm run build)</Text>
      </Text>
      <Text></Text>

      {/* Commands by category */}
      {categories.map((category) => {
        const cmds = grouped[category.name];
        if (!cmds || cmds.length === 0) return null;

        return (
          <Box key={category.name} flexDirection="column">
            <Text bold color={Colors.AccentGreen}>
              {category.icon} {category.label}:
            </Text>
            {cmds.map((cmd) => (
              <Box key={cmd.name} flexDirection="column">
                <Text>
                  <Text color={Colors.AccentCyan}>  /{cmd.name}</Text>
                  {cmd.altName && <Text dimColor> (/{cmd.altName})</Text>}
                  <Text dimColor>  {cmd.description}</Text>
                </Text>
                {cmd.subcommands &&
                  cmd.subcommands.map((sub) => (
                    <Text key={sub.name}>
                      <Text color={Colors.Gray}>    {sub.name}</Text>
                      {sub.altName && <Text dimColor> ({sub.altName})</Text>}
                      <Text dimColor>  {sub.description}</Text>
                    </Text>
                  ))}
              </Box>
            ))}
            <Text></Text>
          </Box>
        );
      })}

      {/* Keyboard shortcuts */}
      <Text bold color={Colors.AccentYellow}>Keyboard Shortcuts:</Text>
      <Text>  <Text color={Colors.AccentCyan}>Enter</Text>       Send message / Execute command</Text>
      <Text>  <Text color={Colors.AccentCyan}>Tab</Text>         Toggle thinking display</Text>
      <Text>  <Text color={Colors.AccentCyan}>Shift+Tab</Text>   Toggle auto-approve (YOLO)</Text>
      <Text>  <Text color={Colors.AccentCyan}>Ctrl+E</Text>      Expand/collapse documents</Text>
      <Text>  <Text color={Colors.AccentCyan}>ESC</Text>         Cancel / Close dialogs</Text>
      <Text>  <Text color={Colors.AccentCyan}>Ctrl+C</Text>      Exit application</Text>
      <Text></Text>

      <Text bold color={Colors.AccentYellow}>Input Features:</Text>
      <Text>  <Text color={Colors.AccentCyan}>↑/↓</Text>         Navigate history / autocomplete</Text>
      <Text>  <Text color={Colors.AccentCyan}>Shift+Enter</Text> Multi-line input</Text>
      <Text>  <Text color={Colors.AccentCyan}>/</Text>           Open command palette</Text>
      <Text></Text>

      <Text dimColor>Press ESC, Enter, or 'q' to close</Text>
    </Box>
  );
};

/**
 * Show interactive help screen
 *
 * Renders the unified help display showing all commands from core registry.
 * This is the imperative entry point for fuzzycortex.
 *
 * @returns Promise that resolves when help is closed
 *
 * @example
 * ```typescript
 * await showHelp();
 * // Help screen is displayed, user presses ESC to close
 * ```
 */
export async function showHelp(): Promise<void> {
  return new Promise((resolve) => {
    const { unmount, waitUntilExit } = render(
      <HelpDisplay
        onClose={() => {
          unmount();
          resolve();
        }}
      />
    );

    waitUntilExit().catch(() => {
      resolve();
    });
  });
}

export default showHelp;
