/**
 * StatusBar - Displays current mode/state below the input
 *
 * Shows:
 * - Current model
 * - Auto-approve status
 * - Thinking mode status
 * - Debug mode
 */

import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

export interface StatusBarProps {
  /** Current model name */
  model?: string;
  /** Auto-approve mode enabled */
  autoApprove?: boolean;
  /** Show thinking enabled */
  showThinking?: boolean;
  /** Debug mode enabled */
  debug?: boolean;
  /** Streaming state */
  streaming?: boolean;
  /** Custom status message */
  message?: string;
  /** Theme colors */
  dimColor?: (text: string) => string;
  accentColor?: (text: string) => string;
  successColor?: (text: string) => string;
  warningColor?: (text: string) => string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  model,
  autoApprove = false,
  showThinking = false,
  debug = false,
  streaming = false,
  message,
  dimColor = chalk.gray,
  accentColor = chalk.cyan,
  successColor = chalk.green,
  warningColor = chalk.yellow,
}) => {
  const parts: string[] = [];

  // Model
  if (model) {
    parts.push(accentColor(model));
  }

  // Mode indicators
  if (autoApprove) {
    parts.push(warningColor('YOLO'));
  }

  if (showThinking) {
    parts.push(successColor('THINK'));
  }

  if (debug) {
    parts.push(warningColor('DEBUG'));
  }

  if (streaming) {
    parts.push(accentColor('●'));
  }

  const statusText = parts.join(dimColor(' │ '));

  return (
    <Box flexDirection="column">
      <Text>{dimColor('─'.repeat(60))}</Text>
      <Box>
        <Text>{dimColor(' ')}</Text>
        <Text>{statusText}</Text>
        {message && (
          <>
            <Text>{dimColor(' │ ')}</Text>
            <Text>{dimColor(message)}</Text>
          </>
        )}
      </Box>
    </Box>
  );
};

export default StatusBar;
