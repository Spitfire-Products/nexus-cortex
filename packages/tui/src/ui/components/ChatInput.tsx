/**
 * ChatInput - Combined input area with multi-line text and status bar
 *
 * This is the main input component for the CLI chat interface.
 * It combines MultiLineInput and StatusBar into a cohesive input area.
 */

import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { MultiLineInput } from './MultiLineInput.js';
import { StatusBar } from './StatusBar.js';

export interface ChatInputProps {
  /** Called when user submits input */
  onSubmit: (text: string) => void;
  /** Current model name */
  model?: string;
  /** Auto-approve mode */
  autoApprove?: boolean;
  /** Show thinking mode */
  showThinking?: boolean;
  /** Debug mode */
  debug?: boolean;
  /** Whether currently streaming */
  streaming?: boolean;
  /** Whether input is focused */
  focus?: boolean;
  /** Custom status message */
  statusMessage?: string;
  /** Theme color functions */
  theme?: {
    primary?: (text: string) => string;
    dimmed?: (text: string) => string;
    success?: (text: string) => string;
    warning?: (text: string) => string;
    info?: (text: string) => string;
  };
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSubmit,
  model,
  autoApprove = false,
  showThinking = false,
  debug = false,
  streaming = false,
  focus = true,
  statusMessage,
  theme = {},
}) => {
  const {
    primary = chalk.cyan,
    dimmed = chalk.gray,
    success = chalk.green,
    warning = chalk.yellow,
    info = chalk.blue,
  } = theme;

  return (
    <Box flexDirection="column">
      {/* Top separator */}
      <Text>{dimmed('─'.repeat(60))}</Text>

      {/* Multi-line input */}
      <MultiLineInput
        onSubmit={onSubmit}
        focus={focus}
        prompt="> "
        placeholder="Type your message... (Shift+Enter for new line)"
        promptColor={info}
        textColor={chalk.white}
        placeholderColor={dimmed}
      />

      {/* Status bar */}
      <StatusBar
        model={model}
        autoApprove={autoApprove}
        showThinking={showThinking}
        debug={debug}
        streaming={streaming}
        message={statusMessage}
        dimColor={dimmed}
        accentColor={primary}
        successColor={success}
        warningColor={warning}
      />
    </Box>
  );
};

export default ChatInput;
