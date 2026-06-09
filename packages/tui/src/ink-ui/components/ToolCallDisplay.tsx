/**
 * ToolCallDisplay - Component for rendering tool calls with proper formatting
 *
 * Displays tool calls with:
 * - Tool name with icon
 * - Formatted input display (not raw JSON)
 * - Status indicator
 * - Result formatting based on tool type
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';
import type { IndividualToolCallDisplay } from '../cortex-types.js';
import { ToolCallStatus } from '../cortex-types.js';
import { DiffPreview, InlineDiffSummary, UnifiedDiffDisplay } from './DiffPreview.js';

export interface ToolCallDisplayProps {
  /** Tool call data */
  toolCall: IndividualToolCallDisplay;
  /** Terminal width for proper display */
  terminalWidth?: number;
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Raw input args if available */
  inputArgs?: Record<string, any>;
}

/**
 * Get icon for tool type
 */
function getToolIcon(toolName: string): string {
  const iconMap: Record<string, string> = {
    // File operations
    Read: '',
    Write: '',
    Edit: '✏',
    Glob: '',
    Grep: '',
    // Shell
    Bash: '',
    BashOutput: '',
    KillShell: '',
    // Web
    WebFetch: '',
    WebSearch: '',
    // Tasks
    Task: '',
    TodoWrite: '',
    // Planning
    AskUserQuestion: '❓',
    ExitPlanMode: '',
    EnterPlanMode: '',
    // Session
    SearchConversationHistory: '',
    ListSessions: '',
    LoadSession: '',
    // MCP
    InitMcpConfig: '',
    EnableMcpServer: '',
    DisableMcpServer: '',
    // Notebooks
    NotebookEdit: '',
  };
  return iconMap[toolName] ?? '';
}

/**
 * Get status color
 */
function getStatusColor(status: ToolCallStatus): string {
  switch (status) {
    case ToolCallStatus.Pending:
      return Colors.AccentYellow;
    case ToolCallStatus.Executing:
      return Colors.AccentCyan;
    case ToolCallStatus.Success:
      return Colors.AccentGreen;
    case ToolCallStatus.Error:
      return Colors.AccentRed;
    case ToolCallStatus.Canceled:
      return Colors.Gray;
    case ToolCallStatus.Confirming:
      return Colors.AccentYellow;
    default:
      return Colors.White;
  }
}

/**
 * Get status icon
 */
function getStatusIcon(status: ToolCallStatus): string {
  switch (status) {
    case ToolCallStatus.Pending:
      return '○';
    case ToolCallStatus.Executing:
      return '●';
    case ToolCallStatus.Success:
      return '✓';
    case ToolCallStatus.Error:
      return '✗';
    case ToolCallStatus.Canceled:
      return '⊘';
    case ToolCallStatus.Confirming:
      return '?';
    default:
      return '•';
  }
}

/**
 * Format tool input for display
 */
function formatToolInput(toolName: string, args: Record<string, any>): React.ReactNode {
  switch (toolName) {
    case 'Read':
      const readFilename = args.file_path?.split('/').pop() || args.file_path;
      const readPath = args.file_path?.slice(0, -(readFilename?.length || 0) - 1) || '';
      return (
        <Box flexDirection="column">
          <Box>
            {readPath && <Text dimColor>{readPath}/</Text>}
            <Text color={Colors.AccentBlue}>{readFilename}</Text>
          </Box>
          {(args.offset || args.limit) && (
            <Text dimColor>
              Lines {args.offset || 1}-{(args.offset || 1) + (args.limit || 100) - 1}
            </Text>
          )}
        </Box>
      );

    case 'Write':
      const writeFilename = args.file_path?.split('/').pop() || args.file_path;
      const writePath = args.file_path?.slice(0, -(writeFilename?.length || 0) - 1) || '';
      const writeContent = args.content as string || '';
      const writeLines = writeContent.split('\n');
      const previewLines = writeLines.slice(0, 3);
      return (
        <Box flexDirection="column">
          <Box>
            {writePath && <Text dimColor>{writePath}/</Text>}
            <Text color={Colors.AccentGreen}>{writeFilename}</Text>
            <Text dimColor> ({writeLines.length} lines)</Text>
          </Box>
          {/* Preview first few lines */}
          {previewLines.length > 0 && (
            <Box flexDirection="column" marginLeft={2}>
              {previewLines.map((line, i) => (
                <Text key={i} dimColor wrap="truncate">
                  {truncate(line, 50)}
                </Text>
              ))}
              {writeLines.length > 3 && <Text dimColor>...</Text>}
            </Box>
          )}
        </Box>
      );

    case 'Glob':
      return (
        <Text dimColor>
          {args.pattern}
          {args.path && ` in ${args.path}`}
        </Text>
      );

    case 'Grep':
      return (
        <Box flexDirection="column">
          <Text dimColor>/{args.pattern}/</Text>
          {args.path && <Text dimColor>in {args.path}</Text>}
          {args.glob && <Text dimColor>files: {args.glob}</Text>}
        </Box>
      );

    case 'Bash':
      return (
        <Box flexDirection="column">
          <Text color={Colors.AccentCyan}>$ {truncateCommand(args.command, 60)}</Text>
          {args.description && <Text dimColor>{args.description}</Text>}
        </Box>
      );

    case 'WebFetch':
      return (
        <Box flexDirection="column">
          <Text dimColor>{args.url}</Text>
          {args.prompt && <Text dimColor italic>"{truncate(args.prompt, 40)}"</Text>}
        </Box>
      );

    case 'WebSearch':
      return <Text dimColor>"{args.query}"</Text>;

    case 'Task':
      return (
        <Box flexDirection="column">
          <Text dimColor>Agent: {args.subagent_type || 'general'}</Text>
          {args.description && <Text dimColor>{args.description}</Text>}
        </Box>
      );

    case 'TodoWrite':
      const todos = args.todos as Array<{ content: string; status: string }> | undefined;
      if (todos && todos.length > 0) {
        return (
          <Box flexDirection="column">
            <Text dimColor>{todos.length} task(s)</Text>
          </Box>
        );
      }
      return <Text dimColor>Update tasks</Text>;

    case 'AskUserQuestion':
      const questions = args.questions as Array<{ question: string }> | undefined;
      const firstQuestion = questions?.[0];
      if (firstQuestion) {
        return <Text dimColor>"{truncate(firstQuestion.question, 50)}"</Text>;
      }
      return <Text dimColor>Asking user...</Text>;

    default:
      // Generic: show first few key-value pairs
      const entries = Object.entries(args).slice(0, 3);
      if (entries.length === 0) {
        return <Text dimColor>(no args)</Text>;
      }
      return (
        <Box flexDirection="column">
          {entries.map(([key, value]) => (
            <Text key={key} dimColor>
              {key}: {truncate(String(value), 40)}
            </Text>
          ))}
          {Object.keys(args).length > 3 && (
            <Text dimColor>... +{Object.keys(args).length - 3} more</Text>
          )}
        </Box>
      );
  }
}

/**
 * Truncate string
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Format Bash output with syntax highlighting
 */
function formatBashOutput(output: string): React.ReactNode {
  const lines = output.split('\n');
  const totalLines = lines.length;
  const maxLines = 15;
  const displayLines = lines.slice(0, maxLines);

  /**
   * Classify a line for coloring
   */
  function classifyLine(line: string): 'error' | 'warning' | 'success' | 'info' | 'normal' {
    const lower = line.toLowerCase();
    // Errors
    if (lower.includes('error') || lower.includes('failed') ||
        lower.includes('fatal') || lower.includes('exception') ||
        lower.startsWith('e ') || line.startsWith('✗')) {
      return 'error';
    }
    // Warnings
    if (lower.includes('warning') || lower.includes('warn') ||
        lower.includes('deprecated') || line.startsWith('⚠')) {
      return 'warning';
    }
    // Success
    if (lower.includes('success') || lower.includes('passed') ||
        lower.includes('done') || lower.includes('completed') ||
        line.startsWith('✓') || line.startsWith('✔')) {
      return 'success';
    }
    // Info (headers, separators)
    if (line.startsWith('>') || line.startsWith('$') ||
        line.match(/^[=\-─]{3,}/) || line.match(/^\s*\d+\s+(passing|failing)/)) {
      return 'info';
    }
    return 'normal';
  }

  return (
    <Box marginTop={1} flexDirection="column">
      <Box borderStyle="single" borderColor={Colors.Gray} paddingX={1} flexDirection="column">
        {displayLines.map((line, i) => {
          const lineType = classifyLine(line);
          const color = lineType === 'error' ? Colors.AccentRed
            : lineType === 'warning' ? Colors.AccentYellow
            : lineType === 'success' ? Colors.AccentGreen
            : lineType === 'info' ? Colors.AccentCyan
            : undefined;

          return (
            <Text key={i} color={color} dimColor={!color} wrap="truncate">
              {line || ' '}
            </Text>
          );
        })}
      </Box>
      {totalLines > maxLines && (
        <Text dimColor>  ... ({totalLines - maxLines} more lines)</Text>
      )}
    </Box>
  );
}

/**
 * Truncate command, preserving important parts
 */
function truncateCommand(cmd: string, maxLength: number): string {
  if (cmd.length <= maxLength) return cmd;

  // Try to show the command name and some args
  const parts = cmd.split(' ');
  const command = parts[0] || '';

  if (command.length >= maxLength - 3) {
    return truncate(cmd, maxLength);
  }

  const remaining = maxLength - command.length - 4; // 4 for " ..."
  const args = parts.slice(1).join(' ');

  if (args.length <= remaining) {
    return cmd;
  }

  return command + ' ' + args.slice(0, remaining) + '...';
}

/**
 * Format tool result for display
 */
function formatToolResult(
  toolName: string,
  result: { output?: string; error?: string; isError?: boolean } | undefined,
): React.ReactNode {
  if (!result) return null;

  if (result.isError || result.error) {
    return (
      <Box marginTop={1}>
        <Text color={Colors.AccentRed}>Error: {truncate(result.error || 'Unknown error', 60)}</Text>
      </Box>
    );
  }

  if (!result.output) return null;

  // Tool-specific result formatting
  switch (toolName) {
    case 'Glob':
      const files = result.output.split('\n').filter(Boolean);
      return (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>{files.length} file(s) found</Text>
          {files.slice(0, 5).map((file, i) => (
            <Text key={i} dimColor>  {file}</Text>
          ))}
          {files.length > 5 && <Text dimColor>  ... +{files.length - 5} more</Text>}
        </Box>
      );

    case 'Grep':
      const matches = result.output.split('\n').filter(Boolean);
      return (
        <Box marginTop={1}>
          <Text dimColor>{matches.length} match(es)</Text>
        </Box>
      );

    case 'Bash':
    case 'BashOutput':
      return formatBashOutput(result.output);

    default:
      return (
        <Box marginTop={1}>
          <Text dimColor wrap="truncate">{truncate(result.output, 100)}</Text>
        </Box>
      );
  }
}

/**
 * Main ToolCallDisplay component
 */
export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({
  toolCall,
  terminalWidth = 80,
  compact = false,
  inputArgs,
}) => {
  const icon = getToolIcon(toolCall.name);
  const statusIcon = getStatusIcon(toolCall.status);
  const statusColor = getStatusColor(toolCall.status);

  // Special case for Edit tool - show diff preview or result
  if (toolCall.name === 'Edit') {
    const filePath = inputArgs?.file_path || toolCall.resultDisplay?.metadata?.fileStats?.path || 'unknown';
    const hasDiffResult = toolCall.resultDisplay?.metadata?.diff;
    const isComplete = toolCall.status === ToolCallStatus.Success;
    const isError = toolCall.status === ToolCallStatus.Error;

    // If we have a completed diff result, show that instead of the input preview
    if (hasDiffResult && isComplete) {
      if (compact) {
        return (
          <Box>
            <Text color={statusColor}>{statusIcon} </Text>
            <UnifiedDiffDisplay
              diffString={toolCall.resultDisplay!.metadata!.diff!}
              filePath={filePath}
              terminalWidth={terminalWidth}
              compact={true}
              fileStats={toolCall.resultDisplay?.metadata?.fileStats}
            />
          </Box>
        );
      }

      return (
        <Box flexDirection="column" marginY={1}>
          <Box>
            <Text color={statusColor}>{statusIcon} </Text>
            <Text>{icon} </Text>
            <Text bold>Edit</Text>
            <Text dimColor> [Completed]</Text>
          </Box>
          <UnifiedDiffDisplay
            diffString={toolCall.resultDisplay!.metadata!.diff!}
            filePath={filePath}
            terminalWidth={terminalWidth}
            compact={false}
            fileStats={toolCall.resultDisplay?.metadata?.fileStats}
          />
        </Box>
      );
    }

    // If error, show error message
    if (isError && toolCall.resultDisplay?.error) {
      return (
        <Box flexDirection="column" marginY={1}>
          <Box>
            <Text color={statusColor}>{statusIcon} </Text>
            <Text>{icon} </Text>
            <Text bold>Edit</Text>
            <Text dimColor> [Error]</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={Colors.AccentRed}>Error: {truncate(toolCall.resultDisplay.error, 200)}</Text>
          </Box>
        </Box>
      );
    }

    // Show input preview while executing or if no result yet
    if (inputArgs?.old_string && inputArgs?.new_string) {
      if (compact) {
        return (
          <Box>
            <Text color={statusColor}>{statusIcon} </Text>
            <InlineDiffSummary
              filePath={filePath}
              oldString={inputArgs.old_string}
              newString={inputArgs.new_string}
            />
          </Box>
        );
      }

      return (
        <Box flexDirection="column" marginY={1}>
          <Box>
            <Text color={statusColor}>{statusIcon} </Text>
            <Text>{icon} </Text>
            <Text bold>Edit</Text>
            {toolCall.status === ToolCallStatus.Executing && (
              <Text dimColor> [Executing...]</Text>
            )}
          </Box>
          <DiffPreview
            filePath={filePath}
            oldString={inputArgs.old_string}
            newString={inputArgs.new_string}
            terminalWidth={terminalWidth}
            compact={false}
          />
        </Box>
      );
    }
  }

  // Compact mode
  if (compact) {
    return (
      <Box>
        <Text color={statusColor}>{statusIcon} </Text>
        <Text>{icon} </Text>
        <Text bold>{toolCall.name}</Text>
        {toolCall.description && (
          <Text dimColor> - {truncate(toolCall.description, 40)}</Text>
        )}
      </Box>
    );
  }

  // Full display
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={Colors.Gray}
      paddingX={1}
      marginY={1}
      width={Math.min(terminalWidth - 4, 80)}
    >
      {/* Header with status */}
      <Box>
        <Text color={statusColor}>{statusIcon} </Text>
        <Text>{icon} </Text>
        <Text bold>{toolCall.name}</Text>
        <Text dimColor> [{toolCall.status}]</Text>
      </Box>

      {/* Description */}
      {toolCall.description && (
        <Box marginTop={1}>
          <Text dimColor>{toolCall.description}</Text>
        </Box>
      )}

      {/* Input args */}
      {inputArgs && (
        <Box marginTop={1} flexDirection="column">
          {formatToolInput(toolCall.name, inputArgs)}
        </Box>
      )}

      {/* Result */}
      {toolCall.resultDisplay && formatToolResult(toolCall.name, toolCall.resultDisplay)}
    </Box>
  );
};

/**
 * Tool group display - shows multiple tool calls
 */
export const ToolGroupDisplay: React.FC<{
  tools: IndividualToolCallDisplay[];
  terminalWidth?: number;
  inputArgsMap?: Map<string, Record<string, any>>;
}> = ({ tools, terminalWidth = 80, inputArgsMap }) => {
  if (tools.length === 0) return null;

  return (
    <Box flexDirection="column" marginY={1}>
      <Text dimColor bold>
        Tool Calls ({tools.length})
      </Text>
      {tools.map((tool) => (
        <ToolCallDisplay
          key={tool.callId}
          toolCall={tool}
          terminalWidth={terminalWidth}
          compact={tools.length > 3}
          inputArgs={inputArgsMap?.get(tool.callId)}
        />
      ))}
    </Box>
  );
};

/**
 * Get a brief summary of tool input for inline display
 */
function getToolInputSummary(toolName: string, args: Record<string, any>): string {
  switch (toolName) {
    case 'Read':
      return args.file_path || 'file';
    case 'Write':
      return args.file_path || 'file';
    case 'Edit':
      return args.file_path || 'file';
    case 'Glob':
      return args.pattern || 'pattern';
    case 'Grep':
      return args.pattern || 'pattern';
    case 'Bash':
      const cmd = args.command || '';
      // Get first word of command
      const firstWord = cmd.split(' ')[0] || 'command';
      return truncate(firstWord + (cmd.includes(' ') ? '...' : ''), 30);
    case 'WebFetch':
      return truncate(args.url || 'url', 40);
    case 'WebSearch':
      return `"${truncate(args.query || '', 30)}"`;
    case 'Task':
      return args.description || args.subagent_type || 'task';
    case 'TodoWrite':
      const todos = args.todos as Array<any> | undefined;
      return `${todos?.length || 0} task(s)`;
    default:
      // Return first string arg or empty
      const firstArg = Object.values(args).find(v => typeof v === 'string');
      return firstArg ? truncate(String(firstArg), 30) : '';
  }
}

/**
 * Get brief result summary for inline display
 */
function getToolResultSummary(toolName: string, result: { output?: string; error?: string; isError?: boolean } | undefined): string {
  if (!result) return '';
  if (result.isError || result.error) {
    return `Error: ${truncate(result.error || 'failed', 30)}`;
  }
  if (!result.output) return 'Done';

  switch (toolName) {
    case 'Read':
      const lines = result.output.split('\n').length;
      return `Read ${lines} lines`;
    case 'Write':
      return 'Written';
    case 'Edit':
      return 'Updated';
    case 'Glob':
      const files = result.output.split('\n').filter(Boolean).length;
      return `${files} file(s)`;
    case 'Grep':
      const matches = result.output.split('\n').filter(Boolean).length;
      return `${matches} match(es)`;
    case 'Bash':
      const outputLines = result.output.split('\n').length;
      return outputLines > 1 ? `${outputLines} lines` : truncate(result.output, 30);
    case 'WebFetch':
      return 'Fetched';
    case 'WebSearch':
      return 'Results';
    case 'Task':
      return 'Completed';
    default:
      return truncate(result.output, 30);
  }
}

/**
 * Claude Code style inline tool call
 * Format: ● ToolName(args)
 *           ⎿  Result summary
 */
export const InlineToolCall: React.FC<{
  toolCall: IndividualToolCallDisplay;
  inputArgs?: Record<string, any>;
}> = ({ toolCall, inputArgs }) => {
  const statusColor = getStatusColor(toolCall.status);
  const isExecuting = toolCall.status === ToolCallStatus.Executing || toolCall.status === ToolCallStatus.Pending;
  const isError = toolCall.status === ToolCallStatus.Error;

  const inputSummary = inputArgs ? getToolInputSummary(toolCall.name, inputArgs) : '';
  const resultSummary = toolCall.resultDisplay ? getToolResultSummary(toolCall.name, toolCall.resultDisplay) : '';

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Tool call line */}
      <Box>
        <Text color={statusColor}>● </Text>
        <Text bold>{toolCall.name}</Text>
        {inputSummary && (
          <Text dimColor>({inputSummary})</Text>
        )}
        {isExecuting && <Text color={Colors.AccentCyan}> ...</Text>}
      </Box>

      {/* Result line with corner connector */}
      {(resultSummary || isError) && (
        <Box marginLeft={2}>
          <Text dimColor>⎿  </Text>
          <Text color={isError ? Colors.AccentRed : Colors.AccentGreen}>
            {resultSummary}
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Inline tool group - shows tool calls in message stream style
 */
export const InlineToolGroup: React.FC<{
  tools: IndividualToolCallDisplay[];
  inputArgsMap?: Map<string, Record<string, any>>;
}> = ({ tools, inputArgsMap }) => {
  if (tools.length === 0) return null;

  return (
    <Box flexDirection="column">
      {tools.map((tool) => (
        <InlineToolCall
          key={tool.callId}
          toolCall={tool}
          inputArgs={inputArgsMap?.get(tool.callId)}
        />
      ))}
    </Box>
  );
};

export default ToolCallDisplay;
