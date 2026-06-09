/**
 * Approval Dialog Component
 *
 * Renders a permission confirmation dialog for tool operations.
 * Shows tool name, file path, and action buttons.
 * For Edit tools, shows a diff preview before the approval options.
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { PendingApproval } from '../hooks/useReactApprovalHandler.js';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';

export interface ApprovalDialogProps {
  pendingApproval: PendingApproval;
  onApprove: () => void;
  onDeny: () => void;
  onApproveAndYolo: () => void;
}

/**
 * Extract a display-friendly file name from tool input
 */
function extractFileName(toolInput: any): string {
  if (toolInput?.file_path) {
    const parts = toolInput.file_path.split('/');
    return parts[parts.length - 1] || toolInput.file_path;
  }
  if (toolInput?.path) {
    const parts = toolInput.path.split('/');
    return parts[parts.length - 1] || toolInput.path;
  }
  if (toolInput?.command) {
    // For bash commands, show first part
    const cmd = toolInput.command.split(' ')[0];
    return cmd || 'command';
  }
  return 'operation';
}

/**
 * Get action verb based on tool name
 */
function getActionVerb(toolName: string): string {
  switch (toolName) {
    case 'Write':
      return 'create';
    case 'Edit':
      return 'edit';
    case 'Read':
      return 'read';
    case 'Bash':
      return 'run';
    case 'Glob':
    case 'Grep':
      return 'search';
    default:
      return 'execute';
  }
}

/**
 * Approval Dialog Component
 */
export const ApprovalDialog: React.FC<ApprovalDialogProps> = ({
  pendingApproval,
  onApprove,
  onDeny,
  onApproveAndYolo,
}) => {
  const { request } = pendingApproval;
  const fileName = extractFileName(request.toolInput);
  const actionVerb = getActionVerb(request.toolName);

  // Handle keyboard input
  useInput((input, key) => {
    // 1 or y = approve
    if (input === '1' || input === 'y' || input === 'Y') {
      onApprove();
      return;
    }

    // 2 or a = approve and enable YOLO
    if (input === '2' || input === 'a' || input === 'A') {
      onApproveAndYolo();
      return;
    }

    // 3 or n or ESC = deny
    if (input === '3' || input === 'n' || input === 'N' || key.escape) {
      onDeny();
      return;
    }

    // Shift+Tab = approve and toggle YOLO
    if (key.tab && key.shift) {
      onApproveAndYolo();
      return;
    }

    // Enter = approve (default action)
    if (key.return) {
      onApprove();
      return;
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentYellow}
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={Colors.AccentYellow} bold>
          ⚠ Permission Required
        </Text>
      </Box>

      {/* Question */}
      <Box marginBottom={1}>
        <Text>
          Do you want to{' '}
          <Text color={Colors.AccentCyan}>{actionVerb}</Text>
          {' '}
          <Text color={Colors.White} bold>{fileName}</Text>
          ?
        </Text>
      </Box>

      {/* Tool details */}
      <Box marginBottom={1} flexDirection="column">
        <Text dimColor>Tool: {request.toolName}</Text>
        {request.toolInput?.file_path && (
          <Text dimColor>Path: {request.toolInput.file_path}</Text>
        )}
        {request.toolInput?.command && (
          <Text dimColor>Command: {request.toolInput.command.substring(0, 80)}{request.toolInput.command.length > 80 ? '...' : ''}</Text>
        )}
        {request.reason && (
          <Text dimColor>Reason: {request.reason}</Text>
        )}
      </Box>

      {/* Options */}
      <Box flexDirection="column">
        <Text>
          <Text color={Colors.AccentGreen}>❯ 1.</Text> Yes
        </Text>
        <Text>
          <Text dimColor>  2.</Text> Yes, auto-approve all (shift+tab)
        </Text>
        <Text>
          <Text dimColor>  3.</Text> No, skip (esc)
        </Text>
      </Box>

      {/* Hint */}
      <Box marginTop={1}>
        <Text dimColor italic>
          Press 1/2/3, y/n, Enter, or Esc
        </Text>
      </Box>
    </Box>
  );
};

export default ApprovalDialog;
