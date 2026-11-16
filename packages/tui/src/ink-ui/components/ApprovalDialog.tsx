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
import { choicesForRequest, isLoadSessionRequest, reduceApprovalKey, initialChoiceState } from '../approvalChoices.js';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';

export interface ApprovalDialogProps {
  pendingApproval: PendingApproval;
  onApprove: () => void;
  onDeny: () => void;
  onApproveAndYolo: () => void;
  /** Answer with a specific choice (the four-way load_session dialog). Omitted → the three legacy buttons only. */
  onChoose?: (choice: import('../approvalChoices.js').ApprovalChoice) => void;
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
  onChoose,
}) => {
  const { request } = pendingApproval;
  const fileName = extractFileName(request.toolInput);
  const actionVerb = getActionVerb(request.toolName);

  // A load_session request asks the four-way question (once / session / always / no); everything else keeps the legacy three.
  const loadSession = isLoadSessionRequest(request);
  const choices = choicesForRequest(request);
  const [state, setState] = React.useState(() => initialChoiceState(choices.length));

  const pick = (index: number) => {
    const choice = choices[index];
    if (!choice) return;
    if (onChoose) { onChoose(choice); return; }
    // No onChoose wired: fall back to the legacy callbacks, which answer 'once' / 'no'.
    if (choice.value === 'no') onDeny(); else onApprove();
  };

  // Handle keyboard input
  useInput((input, key) => {
    if (loadSession) {
      // arrows move, Enter commits, numbers pick, esc = no — the same reducer the pure tests exercise.
      const raw = key.upArrow ? 'up' : key.downArrow ? 'down' : key.return ? 'enter' : key.escape ? 'escape' : input;
      const next = reduceApprovalKey(state, raw, choices.length);
      if (next.answer !== undefined) { pick(next.index); return; }
      if (next.index !== state.index) setState(next);
      return;
    }

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
        {request.tier === 'blacklist' && (
          <Text color={Colors.AccentYellow}>
            {request.autoApproveOn ? 'Asks even with auto-approve ON: ' : ''}this kind of action (dangerous command, screen/app automation) is always confirmed by you.
          </Text>
        )}
      </Box>

      {/* Options */}
      {loadSession ? (
        <Box flexDirection="column">
          <Text>
            {request.reason}
          </Text>
          {choices.map((c, i) => (
            <Text key={`${c.value}-${i}`}>
              <Text color={i === state.index ? Colors.AccentGreen : undefined} dimColor={i !== state.index}>
                {i === state.index ? '❯ ' : '  '}{i + 1}.
              </Text>
              {' '}{c.label}
            </Text>
          ))}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text>
            <Text color={Colors.AccentGreen}>❯ 1.</Text> Yes
          </Text>
          <Text>
            <Text dimColor>  2.</Text> {request.autoApproveOn ? 'Yes (auto-approve is already ON)' : 'Yes, and auto-approve this session (shift+tab)'}
          </Text>
          <Text>
            <Text dimColor>  3.</Text> No, skip (esc)
          </Text>
        </Box>
      )}

      {/* Hint */}
      <Box marginTop={1}>
        <Text dimColor italic>
          {loadSession ? 'Press 1-4, ↑/↓ + Enter, or Esc' : 'Press 1/2/3, y/n, Enter, or Esc'}
        </Text>
      </Box>
    </Box>
  );
};

export default ApprovalDialog;
