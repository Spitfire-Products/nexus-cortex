/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { type SlashCommand, CommandKind } from '../commands/types.js';
import { slashCommandRegistry } from '@nexus-cortex/core';

interface Help {
  commands: readonly SlashCommand[];
}

/**
 * Get all commands from unified registry, grouped by category
 */
function getUnifiedCommands() {
  const commands = slashCommandRegistry.getAllCommands();
  const categories = slashCommandRegistry.getCategories();

  // Group by category
  const grouped: Record<string, typeof commands> = {};
  for (const cmd of commands) {
    if (!grouped[cmd.category]) {
      grouped[cmd.category] = [];
    }
    grouped[cmd.category].push(cmd);
  }

  return { commands, categories, grouped };
}

export const Help: React.FC<Help> = ({ commands }) => {
  const { grouped, categories } = getUnifiedCommands();

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      borderColor={theme.border.default}
      borderStyle="round"
      padding={1}
    >
      {/* Basics */}
      <Text bold color={theme.text.primary}>
        Basics:
      </Text>
      <Text color={theme.text.primary}>
        <Text bold color={theme.text.accent}>
          Add context
        </Text>
        : Use{' '}
        <Text bold color={theme.text.accent}>
          @
        </Text>{' '}
        to specify files for context (e.g.,{' '}
        <Text bold color={theme.text.accent}>
          @src/myFile.ts
        </Text>
        ) to target specific files or folders.
      </Text>
      <Text color={theme.text.primary}>
        <Text bold color={theme.text.accent}>
          Shell mode
        </Text>
        : Execute shell commands via{' '}
        <Text bold color={theme.text.accent}>
          !
        </Text>{' '}
        (e.g.,{' '}
        <Text bold color={theme.text.accent}>
          !npm run start
        </Text>
        ) or use natural language (e.g.{' '}
        <Text bold color={theme.text.accent}>
          start server
        </Text>
        ).
      </Text>

      <Box height={1} />

      {/* Commands from unified registry - grouped by category */}
      <Text bold color={theme.text.primary}>
        Commands ({slashCommandRegistry.getAllCommands().length} total):
      </Text>
      <Box height={1} />

      {categories.map((category) => {
        const cmds = grouped[category.name];
        if (!cmds || cmds.length === 0) return null;

        return (
          <Box key={category.name} flexDirection="column" marginBottom={1}>
            <Text color={theme.text.secondary} bold>
              {category.icon} {category.label}
            </Text>
            {cmds.map((cmd) => (
              <Box key={cmd.name} flexDirection="column">
                <Text color={theme.text.primary}>
                  <Text bold color={theme.text.accent}>
                    {' '}
                    /{cmd.name}
                  </Text>
                  {cmd.altName && (
                    <Text color={theme.text.secondary}> (/{cmd.altName})</Text>
                  )}
                  {cmd.description && ' - ' + cmd.description}
                </Text>
                {cmd.subcommands &&
                  cmd.subcommands.map((sub) => (
                    <Text key={sub.name} color={theme.text.primary}>
                      <Text bold color={theme.text.accent}>
                        {' '}
                        {sub.name}
                      </Text>
                      {sub.altName && (
                        <Text color={theme.text.secondary}> ({sub.altName})</Text>
                      )}
                      {sub.description && ' - ' + sub.description}
                    </Text>
                  ))}
              </Box>
            ))}
          </Box>
        );
      })}

      {/* Also show any local neoncortex commands not in unified registry */}
      {commands.filter(c => c.description && !c.hidden).length > 0 && (
        <>
          <Text color={theme.text.secondary} bold>
            ▸ Additional Commands
          </Text>
          {commands
            .filter((command) => command.description && !command.hidden)
            .map((command: SlashCommand) => (
              <Box key={command.name} flexDirection="column">
                <Text color={theme.text.primary}>
                  <Text bold color={theme.text.accent}>
                    {' '}
                    /{command.name}
                  </Text>
                  {command.kind === CommandKind.MCP_PROMPT && (
                    <Text color={theme.text.secondary}> [MCP]</Text>
                  )}
                  {command.description && ' - ' + command.description}
                </Text>
                {command.subCommands &&
                  command.subCommands
                    .filter((subCommand) => !subCommand.hidden)
                    .map((subCommand) => (
                      <Text key={subCommand.name} color={theme.text.primary}>
                        <Text bold color={theme.text.accent}>
                          {' '}
                          {subCommand.name}
                        </Text>
                        {subCommand.description && ' - ' + subCommand.description}
                      </Text>
                    ))}
              </Box>
            ))}
        </>
      )}

      <Text color={theme.text.primary}>
        <Text bold color={theme.text.accent}>
          {' '}
          !{' '}
        </Text>
        - shell command
      </Text>
      <Text color={theme.text.primary}>
        <Text color={theme.text.secondary}>[MCP]</Text> - Model Context Protocol
        command (from external servers)
      </Text>

      <Box height={1} />

    {/* Shortcuts - Navigation */}
    <Text bold color={theme.text.primary}>
      Keyboard Shortcuts:
    </Text>
    <Box height={1} />
    <Text color={theme.text.secondary}>Navigation</Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Enter
      </Text>{' '}
      - Send message / Execute command
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Ctrl+C
      </Text>{' '}
      - Quit application
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Esc
      </Text>{' '}
      - Cancel operation / Hide autocomplete / Clear input (double press)
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        /
      </Text>{' '}
      - Open slash command menu
    </Text>

    <Box height={1} />
    <Text color={theme.text.secondary}>Cursor Movement</Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Left/Right
      </Text>{' '}
      - Move cursor left/right
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Up/Down
      </Text>{' '}
      - Navigate autocomplete / History / Multiline
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Alt+Left/Right
      </Text>{' '}
      - Jump through words
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Alt+Up/Down
      </Text>{' '}
      - Jump 5 lines up/down
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Ctrl+A / Home
      </Text>{' '}
      - Move to start of line
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        End
      </Text>{' '}
      - Move to end of line
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Page Up/Down
      </Text>{' '}
      - Scroll page up/down
    </Text>

    <Box height={1} />
    <Text color={theme.text.secondary}>Editing</Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        {process.platform === 'win32' ? 'Ctrl+Enter' : 'Ctrl+J'}
      </Text>{' '}
      {process.platform === 'linux'
        ? '- New line (Alt+Enter works for certain linux distros)'
        : '- New line'}
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Alt+Backspace
      </Text>{' '}
      - Delete previous word
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Ctrl+W
      </Text>{' '}
      - Delete previous word (bash-style)
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Ctrl+K
      </Text>{' '}
      - Delete to end of line
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Ctrl+U
      </Text>{' '}
      - Clear entire line
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Ctrl+L
      </Text>{' '}
      - Clear the screen
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        {process.platform === 'darwin' ? 'Ctrl+X / Meta+Enter' : 'Ctrl+X'}
      </Text>{' '}
      - Open input in external editor
    </Text>

    <Box height={1} />
    <Text color={theme.text.secondary}>Toggles & Modes</Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Tab
      </Text>{' '}
      - Accept autocomplete / Toggle thinking mode
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Shift+Tab
      </Text>{' '}
      - Toggle auto-approve mode
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Ctrl+E
      </Text>{' '}
      - Toggle document expand/collapse
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Ctrl+Y
      </Text>{' '}
      - Toggle YOLO mode
    </Text>
    <Text color={theme.text.primary}>
      <Text bold color={theme.text.accent}>
        Ctrl+S
      </Text>{' '}
      - Enter selection mode to copy text
    </Text>

    <Box height={1} />
    <Text bold color={theme.text.primary}>
      Headless Mode (Server + curl):
    </Text>
    <Text color={theme.text.primary}>
      Run the server for scriptable, stateful queries without the terminal UI.
    </Text>
    <Text color={theme.text.primary}>
      Sequential curl requests share the same session with full conversation history.
    </Text>
    <Box height={1} />
    <Text color={theme.text.secondary}>  Quick Start</Text>
    <Text color={theme.text.primary}>
      {' '}
      <Text bold color={theme.text.accent}>node packages/server/dist/index.js</Text>
      {' '}Start server on :4000
    </Text>
    <Text color={theme.text.primary}>
      {' '}
      <Text bold color={theme.text.accent}>cd packages/server && npm run dev</Text>
      {' '}Dev mode (auto-restart + session resume)
    </Text>
    <Text color={theme.text.primary}>
      {' '}
      <Text bold color={theme.text.accent}>node packages/server/dist/index.js --help</Text>
      {' '}Full server docs
    </Text>
    <Box height={1} />
    <Text color={theme.text.secondary}>  Sending Messages</Text>
    <Text color={theme.text.primary}>
      {" curl -s 'http://localhost:4000/v1/messages' \\"}
    </Text>
    <Text color={theme.text.primary}>
      {" -H 'Content-Type: application/json' \\"}
    </Text>
    <Text color={theme.text.primary}>
      {' -d \'{"model":"MODEL_ID","messages":[{"role":"user","content":"..."}]}\''}
    </Text>
    <Box height={1} />
    <Text color={theme.text.secondary}>  Key Endpoints</Text>
    <Text color={theme.text.primary}>
      {' '}
      <Text bold color={theme.text.accent}>POST /v1/messages</Text>
      {' '}Send message (stateful)
    </Text>
    <Text color={theme.text.primary}>
      {' '}
      <Text bold color={theme.text.accent}>POST /sessions/new</Text>
      {' '}Fresh session
    </Text>
    <Text color={theme.text.primary}>
      {' '}
      <Text bold color={theme.text.accent}>GET  /sessions/:id/stats</Text>
      {' '}Token usage and tool stats
    </Text>
    <Text color={theme.text.primary}>
      {' '}
      <Text bold color={theme.text.accent}>GET  /health</Text>
      {' '}Server status + available models
    </Text>

    <Box height={1} />
    <Text color={theme.text.primary}>
      <Text color={theme.text.secondary}>[i]</Text> Type{' '}
      <Text bold color={theme.text.accent}>
        /help {'<command>'}
      </Text>{' '}
      for detailed help on a specific command
    </Text>
  </Box>
);
