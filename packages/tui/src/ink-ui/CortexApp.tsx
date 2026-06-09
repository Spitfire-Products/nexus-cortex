/**
 * Nexus Cortex - Main Application Component
 *
 * This is the entry point for the Ink-based UI, adapted from Gemini CLI
 * but wired to our @nexus-cortex/core orchestrator.
 *
 * Architecture:
 * - CortexApp (this file) - Application shell and state management
 * - useCortexStream - Bridge hook to orchestrator
 * - Gemini UI components - Rendering (DiffRenderer, InputPrompt, etc.)
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import fs, { realpathSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Box,
  Text,
  Static,
  useApp,
  useInput,
  useStdout,
  useStdin,
} from 'ink';
import { createInputBuffer, type InputBuffer } from './SimpleInputBuffer.js';
import { OrchestratorClient, type ReasoningEffort } from '@nexus-cortex/cli/dist/orchestrator/OrchestratorClient.js';
import { useCortexStream } from './hooks/useCortexStream.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
// useHistory hook removed - using orchestrator history directly
// import { useHistory } from './hooks/useHistoryManager.js';
import { useReactApprovalHandler } from './hooks/useReactApprovalHandler.js';
import { StreamingState, MessageType, type HistoryItem, type HistoryItemWithoutId } from './cortex-types.js';
import { Colors, setTheme, getThemeNames, getThemeDefinition, initializeTheme, persistModel, loadPersistedModel, type ThemeName } from '@nexus-cortex/cli/dist/themes/colors.js';
import { ApprovalDialog } from './components/ApprovalDialog.js';
import { InlineThinkingDisplay } from './components/ThinkingDisplay.js';
import { StreamDisplay } from './components/StreamDisplay.js';
import { UnifiedDiffDisplay } from './components/DiffPreview.js';
import { WritePreview } from './components/WritePreview.js';
import { DocumentPreview } from './components/DocumentPreview.js';
import { MarkdownText } from './components/MarkdownText.js';
import { CommandSuggestions } from './components/CommandSuggestions.js';
import { getSuggestions, type FlatCommand } from './commands/slashCommands.js';
import { InteractiveMenu } from '../commands/system-message/InteractiveMenu.js';
import { SystemMessageStore } from '@nexus-cortex/core/system-messages/SystemMessageStore.js';
import type { ModelDisplayInfo, InteractiveMenuDefinition, MenuResult } from '@nexus-cortex/core';
import { MentorshipConfigService, slashCommandRegistry } from '@nexus-cortex/core';
import { ModelPickerDialog } from './components/ModelPickerDialog.js';
import { MenuRenderer } from './components/MenuRenderer.js';
import { SubAgentPanel, createSubAgentStateManager, type SubAgentState } from './components/SubAgentPanel.js';
import type { SubAgentEvent } from '@nexus-cortex/core';
import { ConfigMenu } from '../ui/InkConfigMenu.js';

// Get installation root from this file's location
// Use realpathSync to resolve symlinks (important for npm link)
// Compiled file is at: packages/cli/dist/ink-ui/CortexApp.js
// Installation root is 4 levels up: ink-ui -> dist -> cli -> packages -> root
const __filename = realpathSync(fileURLToPath(import.meta.url));
const __dirname = path.dirname(__filename);
const CLI_INSTALLATION_ROOT = path.join(__dirname, '..', '..', '..', '..');

// Import UI components (these come from Gemini CLI)
// We'll start with basics and add more as needed
// import { Header } from './components/Header.js';
// import { Footer } from './components/Footer.js';
// import { InputPrompt } from './components/InputPrompt.js';
// import { LoadingIndicator } from './components/LoadingIndicator.js';
// import { HistoryItemDisplay } from './components/HistoryItemDisplay.js';
// import { Help } from './components/Help.js';
// import { ThemeDialog } from './components/ThemeDialog.js';

/**
 * App configuration passed from entry point
 */
export interface CortexAppProps {
  modelId?: string;
  debug?: boolean;
  projectPath?: string;
  autoApprove?: boolean;
  initialPrompt?: string;
}

/**
 * Compact header - CC-style 3-line display: name + model + cwd
 */
const CompactHeader: React.FC<{ model: string; cwd: string }> = ({ model, cwd }) => {
  const home = process.env.HOME || '';
  const displayCwd = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={Colors.primary} bold>CORTEX</Text>
        <Text dimColor> · </Text>
        <Text color={Colors.AccentGreen}>{model}</Text>
        <Text dimColor> · </Text>
        <Text color={Colors.AccentBlue}>{displayCwd}</Text>
      </Box>
      <Text dimColor>Tab: thinking | Shift+Tab: auto-approve | /help: commands | ESC: abort</Text>
    </Box>
  );
};

/**
 * Status Line component - displays at bottom below input
 * Shows model, status indicators, and keyboard shortcuts
 */
const StatusLine: React.FC<{
  model: string;
  autoApprove: boolean;
  showThinking: boolean;
  reasoningEffort?: ReasoningEffort;
  supportsReasoning?: boolean;
}> = ({ model, autoApprove, showThinking, reasoningEffort, supportsReasoning }) => {
  return (
    <Box marginTop={1}>
      <Text color={Colors.AccentGreen}>{model}</Text>
      {showThinking && <Text color={Colors.AccentBlue}> [Think]</Text>}
      {supportsReasoning && reasoningEffort && reasoningEffort !== 'none' && (
        <Text color={Colors.AccentPurple}> [R:{reasoningEffort}]</Text>
      )}
      {autoApprove && <Text color={Colors.AccentYellow}> [Auto-Approve]</Text>}
    </Box>
  );
};

/**
 * Format tool input for display (compact summary)
 */
function formatToolInputForDisplay(name: string, input: Record<string, any>): string {
  if (!input) return '';
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return input.file_path || '';
    case 'Glob':
    case 'Grep':
      return input.pattern || '';
    case 'Bash':
      const cmd = input.command || '';
      return cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd;
    default:
      const first = Object.values(input).find(v => typeof v === 'string');
      if (first) {
        const s = String(first);
        return s.length > 50 ? s.slice(0, 50) + '...' : s;
      }
      return '';
  }
}

/**
 * Message display component - memoized to prevent re-renders on input changes
 */
const MessageDisplay: React.FC<{
  item: HistoryItem;
  terminalWidth: number;
  showThinking?: boolean;
  expandedDocuments?: Set<string>;
  documentContents?: Map<string, string | null>;
}> = React.memo(({ item, terminalWidth, showThinking = false, expandedDocuments = new Set(), documentContents = new Map() }) => {
  // Calculate content width accounting for prefix characters
  const contentWidth = Math.max(terminalWidth - 2, 40); // "◆ " or "❯ " = 2 chars

  switch (item.type) {
    case MessageType.User:
      return (
        <Box marginY={1}>
          <Text color={Colors.AccentBlue}>❯ </Text>
          <Text>{typeof item.userContent === 'string' ? item.userContent : item.userContent?.text}</Text>
        </Box>
      );

    case MessageType.Model:
      const modelItem = item as any;
      return (
        <Box marginY={1} flexDirection="column">
          {/* Show stored thinking if available - Claude Code bullet style */}
          {showThinking && modelItem.thought && (
            <InlineThinkingDisplay
              text={modelItem.thought}
              isComplete={true}
              width={terminalWidth}
            />
          )}
          <Box>
            <Text color={Colors.AccentGreen}>◆ </Text>
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <MarkdownText width={contentWidth}>{modelItem.modelContent || ''}</MarkdownText>
            </Box>
          </Box>
        </Box>
      );

    case MessageType.Error:
      return (
        <Box marginY={1}>
          <Text color={Colors.AccentRed}>✗ Error: </Text>
          <Text color={Colors.AccentRed}>{item.errorContent}</Text>
        </Box>
      );

    case MessageType.Info:
      return (
        <Box marginY={1}>
          <Text dimColor>ℹ {item.infoContent}</Text>
        </Box>
      );

    case 'orchestrator': {
      // Render orchestrator message from core library
      const orchestratorItem = item as any;
      const msg = orchestratorItem.message;
      if (!msg) return null;

      const role = msg.message?.role || msg.type;
      const content = msg.message?.content;

      // User message - check for tool_result with Edit diff or Write preview first
      if (role === 'user') {
        // Check if this is a tool_result message with Edit diffs or Write previews
        if (Array.isArray(content)) {
          const editResults = content.filter((b: any) =>
            b.type === 'tool_result' &&
            b.tool_name?.toLowerCase() === 'edit' &&
            b.metadata?.diff &&
            !b.is_error
          );

          const writeResults = content.filter((b: any) =>
            b.type === 'tool_result' &&
            b.tool_name?.toLowerCase() === 'write' &&
            b.metadata?.writePreview &&
            !b.is_error
          );

          const documentResults = content.filter((b: any) =>
            b.type === 'tool_result' &&
            b.tool_name?.toLowerCase() === 'write' &&
            b.metadata?.documentPreview &&
            !b.is_error
          );

          if (editResults.length > 0 || writeResults.length > 0 || documentResults.length > 0) {
            // Render Edit tool results with diffs, Write tool results with previews, and Document previews
            return (
              <Box marginY={1} flexDirection="column">
                {editResults.map((block: any, i: number) => (
                  <Box key={`${msg.uuid}-edit-result-${i}`} marginLeft={2}>
                    <UnifiedDiffDisplay
                      diffString={block.metadata.diff}
                      filePath={block.metadata?.fileStats?.path || ''}
                      compact={false}
                      fileStats={block.metadata?.fileStats}
                    />
                  </Box>
                ))}
                {writeResults.map((block: any, i: number) => (
                  <Box key={`${msg.uuid}-write-result-${i}`} marginLeft={2}>
                    <WritePreview
                      filePath={block.metadata.writePreview.filePath}
                      content={block.metadata.writePreview.content}
                      lineCount={block.metadata.writePreview.lineCount}
                      byteSize={block.metadata.writePreview.byteSize}
                      language={block.metadata.writePreview.language}
                      terminalWidth={terminalWidth - 4}
                    />
                  </Box>
                ))}
                {documentResults.map((block: any, i: number) => {
                  const docId = `${msg.uuid}-doc-${i}`;
                  const isExpanded = expandedDocuments.has(docId);
                  const docContent = documentContents.get(docId);
                  return (
                    <Box key={docId} marginLeft={2}>
                      <DocumentPreview
                        docId={docId}
                        filePath={block.metadata.documentPreview.filePath}
                        lineCount={block.metadata.documentPreview.lineCount}
                        wordCount={block.metadata.documentPreview.wordCount}
                        isMarkdown={block.metadata.documentPreview.isMarkdown}
                        isExpanded={isExpanded}
                        content={docContent ?? undefined}
                        isLoading={isExpanded && !documentContents.has(docId)}
                        terminalWidth={terminalWidth - 2}
                      />
                    </Box>
                  );
                })}
              </Box>
            );
          }
        }

        // Regular user text message
        const text = typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.find((b: any) => b.type === 'text')?.text || ''
            : '';
        if (!text) return null; // Skip empty tool_result messages
        return (
          <Box marginY={1}>
            <Text color={Colors.AccentBlue}>❯ </Text>
            <Text>{text}</Text>
          </Box>
        );
      }

      // Assistant message - render content blocks in order
      if (role === 'assistant' && Array.isArray(content)) {
        return (
          <Box marginY={1} flexDirection="column">
            {content.map((block: any, i: number) => {
              if (block.type === 'text' && block.text) {
                return (
                  <Box key={`${msg.uuid}-text-${i}`}>
                    <Text color={Colors.AccentGreen}>◆ </Text>
                    <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                      <MarkdownText width={contentWidth}>{block.text}</MarkdownText>
                    </Box>
                  </Box>
                );
              }
              // Interleaved thinking - ALWAYS show (it's natural model output)
              // This is NOT controlled by Tab toggle - that's for extended thinking only
              if (block.type === 'thinking' && block.thinking) {
                // Determine thinking type for visual distinction
                const thinkingBlock = block as any;
                let thinkingType: 'native' | 'extended' | 'mentorship' = 'native';
                
                // Check metadata first (explicitly set during conversion)
                if (thinkingBlock.thinkingMetadata?.source) {
                  thinkingType = thinkingBlock.thinkingMetadata.source;
                } else if (thinkingBlock.signature) {
                  // Has signature = extended thinking (Opus + Tab)
                  thinkingType = 'extended';
                }
                
                return (
                  <InlineThinkingDisplay
                    key={`${msg.uuid}-thinking-${i}`}
                    text={block.thinking}
                    isComplete={true}
                    width={terminalWidth}
                    thinkingType={thinkingType}
                  />
                );
              }
              if (block.type === 'tool_use' && block.toolUse) {
                const toolName = block.toolUse.name;
                const input = block.toolUse.input || {};
                const inputStr = formatToolInputForDisplay(toolName, input);
                return (
                  <Box key={`${msg.uuid}-tool-${i}`}>
                    <Text color={Colors.AccentCyan}>● </Text>
                    <Text bold>{toolName}</Text>
                    {inputStr && <Text dimColor> ({inputStr})</Text>}
                  </Box>
                );
              }
              if (block.type === 'tool_result') {
                const isError = block.is_error;
                const isEdit = block.tool_name?.toLowerCase() === 'edit';
                const isWrite = block.tool_name?.toLowerCase() === 'write';
                const hasDiff = block.metadata?.diff;
                const hasWritePreview = block.metadata?.writePreview;
                const filePath = block.metadata?.fileStats?.path || '';

                // For Edit tools with diff, show the diff inline
                if (isEdit && hasDiff && !isError) {
                  return (
                    <Box key={`${msg.uuid}-result-${i}`} flexDirection="column" marginLeft={2}>
                      <UnifiedDiffDisplay
                        diffString={block.metadata.diff}
                        filePath={filePath}
                        compact={false}
                        fileStats={block.metadata.fileStats}
                      />
                    </Box>
                  );
                }

                // For Write tools with preview, show the file content
                if (isWrite && hasWritePreview && !isError) {
                  return (
                    <Box key={`${msg.uuid}-result-${i}`} flexDirection="column" marginLeft={2}>
                      <WritePreview
                        filePath={block.metadata.writePreview.filePath}
                        content={block.metadata.writePreview.content}
                        lineCount={block.metadata.writePreview.lineCount}
                        byteSize={block.metadata.writePreview.byteSize}
                        language={block.metadata.writePreview.language}
                        terminalWidth={terminalWidth - 4}
                      />
                    </Box>
                  );
                }

                // For Write tools with document preview (markdown/txt), show collapsible preview
                const hasDocumentPreview = block.metadata?.documentPreview;
                if (isWrite && hasDocumentPreview && !isError) {
                  const docId = `${msg.uuid}-doc-${i}`;
                  const isExpanded = expandedDocuments.has(docId);
                  const docContent = documentContents.get(docId);
                  return (
                    <Box key={`${msg.uuid}-result-${i}`} flexDirection="column" marginLeft={2}>
                      <DocumentPreview
                        docId={docId}
                        filePath={block.metadata.documentPreview.filePath}
                        lineCount={block.metadata.documentPreview.lineCount}
                        wordCount={block.metadata.documentPreview.wordCount}
                        isMarkdown={block.metadata.documentPreview.isMarkdown}
                        isExpanded={isExpanded}
                        content={docContent ?? undefined}
                        isLoading={isExpanded && !documentContents.has(docId)}
                        terminalWidth={terminalWidth - 2}
                      />
                    </Box>
                  );
                }

                // For other tools or Edit without diff, show simple status
                return (
                  <Box key={`${msg.uuid}-result-${i}`} marginLeft={2}>
                    <Text dimColor>⎿ </Text>
                    <Text color={isError ? Colors.AccentRed : Colors.AccentGreen}>
                      {isError ? 'Error' : 'Done'}
                    </Text>
                  </Box>
                );
              }
              return null;
            })}
          </Box>
        );
      }

      return null;
    }

    case MessageType.ToolGroup: {
      // Render tool group with diffs for Edit tools and previews for Write tools
      const tools = (item as any).tools || [];
      return (
        <Box marginY={1} flexDirection="column">
          {tools.map((tool: any, i: number) => {
            const isEdit = tool.name?.toLowerCase() === 'edit';
            const isWrite = tool.name?.toLowerCase() === 'write';
            const hasDiff = tool.resultDisplay?.metadata?.diff;
            const hasWritePreview = tool.resultDisplay?.metadata?.writePreview;
            const isSuccess = tool.status === 'Success';
            const filePath = tool.resultDisplay?.metadata?.fileStats?.path || '';

            if (isEdit && isSuccess && hasDiff) {
              // Show full diff for Edit tools
              return (
                <Box key={`tool-${i}`} flexDirection="column">
                  <UnifiedDiffDisplay
                    diffString={tool.resultDisplay.metadata.diff}
                    filePath={filePath}
                    compact={false}
                    fileStats={tool.resultDisplay.metadata.fileStats}
                  />
                </Box>
              );
            }

            if (isWrite && isSuccess && hasWritePreview) {
              // Show file content preview for Write tools
              return (
                <Box key={`tool-${i}`} flexDirection="column">
                  <WritePreview
                    filePath={tool.resultDisplay.metadata.writePreview.filePath}
                    content={tool.resultDisplay.metadata.writePreview.content}
                    lineCount={tool.resultDisplay.metadata.writePreview.lineCount}
                    byteSize={tool.resultDisplay.metadata.writePreview.byteSize}
                    language={tool.resultDisplay.metadata.writePreview.language}
                    terminalWidth={terminalWidth}
                  />
                </Box>
              );
            }

            // Show document preview for markdown/text files
            const hasDocumentPreview = tool.resultDisplay?.metadata?.documentPreview;
            if (isWrite && isSuccess && hasDocumentPreview) {
              const docId = `${item.id}-tool-doc-${i}`;
              const isExpanded = expandedDocuments.has(docId);
              const docContent = documentContents.get(docId);
              return (
                <Box key={`tool-${i}`} flexDirection="column">
                  <DocumentPreview
                    docId={docId}
                    filePath={tool.resultDisplay.metadata.documentPreview.filePath}
                    lineCount={tool.resultDisplay.metadata.documentPreview.lineCount}
                    wordCount={tool.resultDisplay.metadata.documentPreview.wordCount}
                    isMarkdown={tool.resultDisplay.metadata.documentPreview.isMarkdown}
                    isExpanded={isExpanded}
                    content={docContent ?? undefined}
                    isLoading={isExpanded && !documentContents.has(docId)}
                    terminalWidth={terminalWidth}
                  />
                </Box>
              );
            }

            // Show simple tool result for non-Edit/Write tools
            return (
              <Box key={`tool-${i}`}>
                <Text color={isSuccess ? Colors.AccentGreen : Colors.AccentRed}>
                  {isSuccess ? '✓' : '✗'}{' '}
                </Text>
                <Text bold>{tool.name}</Text>
                {filePath && <Text dimColor> ({filePath})</Text>}
              </Box>
            );
          })}
        </Box>
      );
    }

    default:
      return null;
  }
});

// Display name for debugging
MessageDisplay.displayName = 'MessageDisplay';

/**
 * Enhanced Input component with proper cursor control and paste support
 *
 * Uses our SimpleInputBuffer for standalone input handling:
 * - Full cursor control: Left/Right for chars, Up/Down for lines
 * - Multi-line input: Ctrl+J adds new line, Enter submits
 * - Input history: Up/Down arrows navigate previous messages (when single-line)
 * - Slash command autocomplete: Shows suggestions when typing /
 * - Paste support via bracketed paste mode (raw stdin parsing)
 * - Visual cursor with inverse highlight
 *
 * Wrapped in React.memo to prevent re-renders from parent state changes
 */
const EnhancedInput: React.FC<{
  onSubmit: (text: string) => void;
  disabled: boolean;
  placeholder?: string;
  userMessages: readonly string[];
  prefillValue?: string | null;
}> = React.memo(({ onSubmit, disabled, placeholder = 'Type your message...', userMessages, prefillValue }) => {
  const { width: terminalWidth } = useTerminalSize();
  const { stdin } = useStdin();

  // Use our simple input buffer (state is managed internally)
  const bufferRef = useRef<InputBuffer | null>(null);
  if (!bufferRef.current) {
    bufferRef.current = createInputBuffer();
  }
  const buffer = bufferRef.current;

  // Force re-render when buffer changes
  const [, forceUpdate] = useState({});
  const triggerUpdate = useCallback(() => forceUpdate({}), []);

  // Ghost text (prediction autocomplete shown as dim text after cursor)
  const [ghostText, setGhostText] = useState<string | null>(null);
  const lastPrefillRef = useRef<string | null>(null);
  useEffect(() => {
    if (prefillValue && prefillValue !== lastPrefillRef.current) {
      setGhostText(prefillValue);
      lastPrefillRef.current = prefillValue;
    } else if (!prefillValue) {
      setGhostText(null);
      lastPrefillRef.current = null;
    }
  }, [prefillValue]);

  // Input history state
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [originalValue, setOriginalValue] = useState('');

  // Command suggestions state
  const [suggestions, setSuggestions] = useState<FlatCommand[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  // Derived state
  const text = buffer.text;
  const lines = buffer.lines;
  const lineCount = lines.length;
  const isMultiLine = lineCount > 1;
  const [cursorRow, cursorCol] = buffer.cursor;
  const showSuggestions = suggestions.length > 0 && text.startsWith('/');

  // Update suggestions when text changes
  useEffect(() => {
    if (text.startsWith('/') && !isMultiLine) {
      const newSuggestions = getSuggestions(text); // No limit - allow scrolling through all commands
      setSuggestions(newSuggestions);
      setSuggestionIndex(prev =>
        prev >= newSuggestions.length ? Math.max(0, newSuggestions.length - 1) : prev
      );
    } else {
      setSuggestions([]);
      setSuggestionIndex(0);
    }
  }, [text, isMultiLine]);

  // Refs for current state in event handler
  const stateRef = useRef({ historyIndex, originalValue, suggestions, suggestionIndex, text, cursorRow, lineCount });
  stateRef.current = { historyIndex, originalValue, suggestions, suggestionIndex, text, cursorRow, lineCount };

  // Flag to skip useInput when we've handled a paste
  const skipNextInputRef = useRef(false);

  // Enable bracketed paste mode when component mounts
  useEffect(() => {
    if (disabled) return;
    // Enable bracketed paste mode
    process.stdout.write('\x1b[?2004h');
    return () => {
      // Disable bracketed paste mode on cleanup
      process.stdout.write('\x1b[?2004l');
    };
  }, [disabled]);

  // Raw stdin handling ONLY for bracketed paste detection
  // Regular keys are handled by useInput below
  useEffect(() => {
    if (!stdin || disabled) return;

    const handleData = (data: string) => {
      // Check for bracketed paste (escape sequence wrapped)
      // Format: \x1b[200~ ... content ... \x1b[201~
      if (data.includes('\x1b[200~')) {
        const startIdx = data.indexOf('\x1b[200~');
        const endIdx = data.indexOf('\x1b[201~');
        if (endIdx !== -1) {
          const pasteContent = data.slice(startIdx + 6, endIdx);
          // Normalize line endings
          const cleanedPaste = pasteContent
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\n+$/, '');
          buffer.insert(cleanedPaste, { isPaste: true });
          if (stateRef.current.historyIndex !== -1) {
            setHistoryIndex(-1);
          }
          // Set flag to skip useInput processing for a short time
          // This prevents the double-processing issue
          skipNextInputRef.current = true;
          setTimeout(() => { skipNextInputRef.current = false; }, 50);
          triggerUpdate();
          return;
        }
      }

      // Heuristic: If data contains multiple characters including newlines,
      // and it doesn't start with escape sequences, treat it as a paste.
      const looksLikePaste = data.length > 1 &&
        !data.startsWith('\x1b') &&
        (data.includes('\n') || data.includes('\r')) &&
        data.replace(/[\r\n]/g, '').length > 0;

      if (looksLikePaste) {
        const cleanedPaste = data
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .replace(/\n+$/, '');
        buffer.insert(cleanedPaste, { isPaste: true });
        if (stateRef.current.historyIndex !== -1) {
          setHistoryIndex(-1);
        }
        skipNextInputRef.current = true;
        setTimeout(() => { skipNextInputRef.current = false; }, 50);
        triggerUpdate();
      }
      // All other input is handled by useInput below
    };

    stdin.on('data', handleData);
    return () => {
      stdin.removeListener('data', handleData);
    };
  }, [stdin, disabled, buffer, triggerUpdate]);

  // Use Ink's useInput for all keyboard handling (it properly parses escape sequences)
  useInput((input, key) => {
    if (disabled) return;

    // Skip if we just handled a paste via raw stdin
    if (skipNextInputRef.current) return;

    const state = stateRef.current;
    const showingSuggestions = state.suggestions.length > 0 && buffer.text.startsWith('/');

    // Submit on Enter
    if (key.return) {
      if (showingSuggestions) {
        const selected = state.suggestions[state.suggestionIndex];
        if (selected) {
          onSubmit(selected.fullPath);
          buffer.setText('');
          setSuggestions([]);
          setSuggestionIndex(0);
          setHistoryIndex(-1);
          setOriginalValue('');
        }
      } else if (buffer.text.trim()) {
        onSubmit(buffer.text);
        buffer.setText('');
        setHistoryIndex(-1);
        setOriginalValue('');
        setSuggestions([]);
        setSuggestionIndex(0);
        if (ghostText) setGhostText(null);
      }
      triggerUpdate();
      return;
    }

    // Tab handling
    if (key.tab) {
      if (key.shift) {
        // Shift+Tab handled at app level
        return;
      }
      if (showingSuggestions) {
        const selected = state.suggestions[state.suggestionIndex];
        if (selected) {
          buffer.setText(selected.fullPath + ' ');
          setSuggestions([]);
          setSuggestionIndex(0);
        }
        triggerUpdate();
      } else if (ghostText) {
        buffer.setText(buffer.text + ghostText);
        setGhostText(null);
        triggerUpdate();
      }
      return;
    }

    // Up arrow
    if (key.upArrow) {
      if (showingSuggestions) {
        setSuggestionIndex(i => Math.max(0, i - 1));
        return;
      }

      // At top line (or single line)
      if (state.lineCount === 1 || state.cursorRow === 0) {
        // If cursor is not at beginning, first move to beginning
        if (buffer.cursor[1] > 0) {
          buffer.moveHome();
          triggerUpdate();
          return;
        }
        // Cursor already at beginning - scroll through history
        if (userMessages.length === 0) return;
        if (state.historyIndex === -1) {
          setOriginalValue(buffer.text);
          setHistoryIndex(0);
          const newText = userMessages[userMessages.length - 1] || '';
          buffer.setText(newText);
        } else if (state.historyIndex < userMessages.length - 1) {
          const newIndex = state.historyIndex + 1;
          setHistoryIndex(newIndex);
          const newText = userMessages[userMessages.length - 1 - newIndex] || '';
          buffer.setText(newText);
        }
        triggerUpdate();
        return;
      }
      // Move cursor up in multiline
      buffer.moveUp();
      triggerUpdate();
      return;
    }

    // Down arrow
    if (key.downArrow) {
      if (showingSuggestions) {
        setSuggestionIndex(i => Math.min(state.suggestions.length - 1, i + 1));
        return;
      }

      // At bottom line (or single line)
      if (state.lineCount === 1 || state.cursorRow === state.lineCount - 1) {
        const currentLineLength = buffer.lines[buffer.cursor[0]]?.length || 0;
        // If cursor is not at end, first move to end
        if (buffer.cursor[1] < currentLineLength) {
          buffer.moveEnd();
          triggerUpdate();
          return;
        }
        // Cursor already at end - scroll through history (if in history mode)
        if (state.historyIndex === -1) return;
        if (state.historyIndex === 0) {
          setHistoryIndex(-1);
          buffer.setText(state.originalValue);
        } else {
          const newIndex = state.historyIndex - 1;
          setHistoryIndex(newIndex);
          const newText = userMessages[userMessages.length - 1 - newIndex] || '';
          buffer.setText(newText);
        }
        triggerUpdate();
        return;
      }
      // Move cursor down in multiline
      buffer.moveDown();
      triggerUpdate();
      return;
    }

    // Left arrow
    if (key.leftArrow) {
      if (key.ctrl) {
        buffer.moveWordLeft();
      } else {
        buffer.moveLeft();
      }
      triggerUpdate();
      return;
    }

    // Right arrow
    if (key.rightArrow) {
      const atEnd = buffer.cursor[0] === buffer.lines.length - 1
        && buffer.cursor[1] >= (buffer.lines[buffer.cursor[0]] || '').length;
      if (atEnd && ghostText) {
        buffer.setText(buffer.text + ghostText);
        setGhostText(null);
      } else if (key.ctrl) {
        buffer.moveWordRight();
      } else {
        buffer.moveRight();
      }
      triggerUpdate();
      return;
    }

    // Option+Delete (Alt+Backspace) - delete word to the left
    // On Mac, Option+Delete sends \x17 (ETB) or the meta flag is set
    if ((key.meta && (key.delete || key.backspace || input === '\x7f')) || input === '\x17') {
      buffer.deleteWordLeft();
      if (state.historyIndex !== -1) setHistoryIndex(-1);
      triggerUpdate();
      return;
    }

    // Mac Delete key (⌫) - deletes character to the LEFT of cursor
    // Ink sets key.delete=true for Mac Delete key, so treat ALL delete as backspace
    if (key.delete || key.backspace || input === '\x7f' || input === '\b') {
      buffer.backspace();
      if (state.historyIndex !== -1) setHistoryIndex(-1);
      triggerUpdate();
      return;
    }

    // Escape
    if (key.escape) {
      if (ghostText) {
        setGhostText(null);
      } else if (showingSuggestions) {
        setSuggestions([]);
        setSuggestionIndex(0);
      } else if (state.historyIndex !== -1) {
        setHistoryIndex(-1);
        buffer.setText(state.originalValue);
      } else if (buffer.text) {
        buffer.setText('');
      }
      triggerUpdate();
      return;
    }

    // Ctrl+J for newline
    if (key.ctrl && input === 'j') {
      buffer.newline();
      if (state.historyIndex !== -1) setHistoryIndex(-1);
      triggerUpdate();
      return;
    }

    // Ctrl+A - move to start
    if (key.ctrl && input === 'a') {
      buffer.moveHome();
      triggerUpdate();
      return;
    }

    // Ctrl+E - move to end
    if (key.ctrl && input === 'e') {
      buffer.moveEnd();
      triggerUpdate();
      return;
    }

    // Ctrl+U - kill to start of line
    if (key.ctrl && input === 'u') {
      while (buffer.cursor[1] > 0) {
        buffer.backspace();
      }
      if (state.historyIndex !== -1) setHistoryIndex(-1);
      triggerUpdate();
      return;
    }

    // Ctrl+K - kill to end of line
    if (key.ctrl && input === 'k') {
      const currentLine = buffer.lines[buffer.cursor[0]] || '';
      while (buffer.cursor[1] < currentLine.length) {
        buffer.delete();
      }
      if (state.historyIndex !== -1) setHistoryIndex(-1);
      triggerUpdate();
      return;
    }

    // Ctrl+Z - undo
    if (key.ctrl && input === 'z') {
      buffer.undo();
      triggerUpdate();
      return;
    }

    // Regular character input (not control keys)
    if (input && !key.ctrl && !key.meta) {
      if (ghostText) setGhostText(null);
      buffer.insert(input);
      if (state.historyIndex !== -1) setHistoryIndex(-1);
      triggerUpdate();
    }
  }, { isActive: !disabled });

  // Render text with cursor highlighting
  const renderContent = () => {
    if (!text) {
      if (ghostText && !disabled) {
        // Empty buffer with ghost text: show cursor then dim prediction
        return (
          <Text>
            <Text inverse>{ghostText.charAt(0)}</Text>
            <Text dimColor>{ghostText.slice(1)}</Text>
          </Text>
        );
      }
      // When showing placeholder: show cursor position with first char highlighted
      const displayPlaceholder = placeholder || 'Type your message...';
      return (
        <Text>
          {!disabled && <Text inverse>{displayPlaceholder.charAt(0) || ' '}</Text>}
          <Text dimColor>{disabled ? displayPlaceholder : displayPlaceholder.slice(1)}</Text>
        </Text>
      );
    }

    const isLastLine = (idx: number) => idx === lines.length - 1;
    const showGhostOnLine = (idx: number) =>
      ghostText && !disabled && isLastLine(idx) && idx === cursorRow
      && cursorCol >= (lines[idx] || '').length;

    return (
      <Box flexDirection="column">
        {lines.map((line, lineIdx) => {
          const isOnCursorLine = lineIdx === cursorRow;

          if (!isOnCursorLine || disabled) {
            return (
              <Text key={lineIdx} color={disabled ? Colors.Gray : undefined}>
                {line || ' '}
              </Text>
            );
          }

          // Render line with cursor
          const lineLen = line.length;
          const before = line.slice(0, cursorCol);
          const cursorChar = cursorCol < lineLen ? line.slice(cursorCol, cursorCol + 1) : ' ';
          const after = cursorCol < lineLen ? line.slice(cursorCol + 1) : '';

          return (
            <Text key={lineIdx}>
              {before}
              <Text inverse>{cursorChar}</Text>
              {after}
              {showGhostOnLine(lineIdx) && <Text dimColor>{ghostText}</Text>}
            </Text>
          );
        })}
      </Box>
    );
  };

  // Determine border color based on mode
  const getBorderColor = () => {
    if (disabled) return Colors.Gray;
    if (showSuggestions) return Colors.AccentGreen;
    if (historyIndex !== -1) return Colors.AccentYellow;
    return Colors.AccentCyan;
  };

  return (
    <Box flexDirection="column">
      {/* Command suggestions dropdown (shown above input) */}
      {showSuggestions && (
        <CommandSuggestions
          suggestions={suggestions}
          selectedIndex={suggestionIndex}
          maxVisible={8}
        />
      )}

      {/* Input box with horizontal borders only */}
      <Box flexDirection="column">
        {/* Top border */}
        <Text color={getBorderColor()}>{'─'.repeat(Math.max(terminalWidth - 2, 40))}</Text>

        {/* Content area */}
        <Box paddingX={1} minHeight={1}>
          {renderContent()}
        </Box>

        {/* Bottom border */}
        <Text color={getBorderColor()}>{'─'.repeat(Math.max(terminalWidth - 2, 40))}</Text>
      </Box>

      {/* Status hints */}
      <Box paddingX={1}>
        {showSuggestions && (
          <Text dimColor color={Colors.AccentGreen}>
            ↑↓ select • Tab complete • Enter execute • Esc close
          </Text>
        )}
        {!showSuggestions && historyIndex !== -1 && (
          <Text dimColor color={Colors.AccentYellow}>
            History [{historyIndex + 1}/{userMessages.length}] • ↓ newer • Esc cancel
          </Text>
        )}
        {!showSuggestions && isMultiLine && historyIndex === -1 && (
          <Text dimColor>
            {lineCount} lines • ←→↑↓ cursor • Ctrl+A/E home/end • Enter submit
          </Text>
        )}
        {!showSuggestions && !isMultiLine && historyIndex === -1 && !ghostText && (
          <Text dimColor>
            / commands • ↑↓ history • Ctrl+J new line • ←→ cursor
          </Text>
        )}
        {ghostText && !showSuggestions && historyIndex === -1 && (
          <Text dimColor>
            Tab or → accept prediction • Esc dismiss • type to replace
          </Text>
        )}
      </Box>
    </Box>
  );
});

// Display name for debugging
EnhancedInput.displayName = 'EnhancedInput';

/**
 * Loading spinner component
 */
const LoadingSpinner: React.FC<{ text?: string }> = ({ text = 'Thinking...' }) => {
  const [frame, setFrame] = useState(0);
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % frames.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text color={Colors.AccentCyan}>
      {frames[frame]} {text}
    </Text>
  );
};

/**
 * Theme Picker Dialog Component
 *
 * Interactive theme selection with live preview colors
 */
const ThemePickerDialog: React.FC<{
  themes: ThemeName[];
  currentTheme: ThemeName;
  onSelect: (theme: ThemeName) => void;
  onCancel: () => void;
}> = ({ themes, currentTheme, onSelect, onCancel }) => {
  const [selectedIndex, setSelectedIndex] = useState(() =>
    Math.max(0, themes.indexOf(currentTheme))
  );

  const selectedTheme = themes[selectedIndex] || themes[0];
  const themeDef = selectedTheme ? getThemeDefinition(selectedTheme) : null;

  useInput((input, key) => {
    // Up/Down to navigate
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(i => Math.min(themes.length - 1, i + 1));
      return;
    }

    // Number keys for quick selection (1-9)
    const num = parseInt(input, 10);
    if (num >= 1 && num <= 9 && num <= themes.length) {
      setSelectedIndex(num - 1);
      return;
    }

    // Enter to select
    if (key.return && selectedTheme) {
      onSelect(selectedTheme);
      return;
    }

    // Escape to cancel
    if (key.escape) {
      onCancel();
      return;
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentPurple}
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={Colors.AccentPurple} bold>
           Select Theme
        </Text>
      </Box>

      {/* Theme list */}
      <Box flexDirection="row">
        {/* Left: Theme list */}
        <Box flexDirection="column" width="50%">
          {themes.map((theme, index) => {
            const def = getThemeDefinition(theme);
            const isSelected = index === selectedIndex;
            const isCurrent = theme === currentTheme;
            return (
              <Box key={theme}>
                <Text
                  color={isSelected ? Colors.AccentCyan : undefined}
                  bold={isSelected}
                >
                  {isSelected ? '❯' : ' '} {index < 9 ? `${index + 1}.` : ' '}
                  {' '}
                  <Text color={isSelected ? Colors.AccentCyan : (isCurrent ? Colors.AccentGreen : undefined)}>
                    {def?.name || theme}
                  </Text>
                  {isCurrent && <Text dimColor> (current)</Text>}
                </Text>
              </Box>
            );
          })}
        </Box>

        {/* Right: Preview */}
        {themeDef && (
          <Box flexDirection="column" width="50%" paddingLeft={2}>
            <Text bold color={Colors.AccentPurple}>Preview</Text>
            <Box
              borderStyle="single"
              borderColor={themeDef.dimmed}
              flexDirection="column"
              paddingX={1}
              marginTop={1}
            >
              <Text color={themeDef.primary}>● Primary</Text>
              <Text color={themeDef.secondary}>● Secondary</Text>
              <Text color={themeDef.success}>● Success</Text>
              <Text color={themeDef.warning}>● Warning</Text>
              <Text color={themeDef.error}>● Error</Text>
              <Text color={themeDef.info}>● Info</Text>
              <Text color={themeDef.text}>● Text</Text>
              <Text color={themeDef.dimmed}>● Dimmed</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ navigate • 1-9 quick select • Enter apply • Esc cancel
        </Text>
      </Box>
    </Box>
  );
};

/**
 * ModelDisplayInfo and ModelPickerDialog now imported from:
 * - @nexus-cortex/core (types)
 * - ./components/ModelPickerDialog.js (component)
 */

/**
 * Session display info for the picker
 */
interface SessionDisplayInfo {
  sessionId: string;
  shortId: string;
  lastModified: Date;
  messageCount: number;
  model?: string;
  firstUserMessage?: string;
  title?: string;
  age: string;
}

/**
 * Format relative time for session display
 */
function formatSessionAge(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}

/**
 * Session Picker Dialog Component
 *
 * Interactive session selection with details panel, similar to ModelPickerDialog.
 */
const SessionPickerDialog: React.FC<{
  sessions: SessionDisplayInfo[];
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
  loading?: boolean;
}> = ({ sessions, onSelect, onCancel, loading = false }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Memoize to prevent recalculation
  const selectedSession = useMemo(() => sessions[selectedIndex] || sessions[0], [sessions, selectedIndex]);

  useInput((input, key) => {
    if (loading) return;

    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(i => Math.min(sessions.length - 1, i + 1));
      return;
    }

    const num = parseInt(input, 10);
    if (num >= 1 && num <= 9 && num <= sessions.length) {
      setSelectedIndex(num - 1);
      return;
    }

    if (key.return && selectedSession) {
      onSelect(selectedSession.sessionId);
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }
  });

  // Fixed window size - always show exactly this many rows
  const VISIBLE_ROWS = 10;

  // Calculate scroll window with stable bounds
  const scrollWindow = useMemo(() => {
    const total = sessions.length;
    if (total <= VISIBLE_ROWS) {
      return { start: 0, end: total };
    }

    // Keep selection centered when possible
    const halfWindow = Math.floor(VISIBLE_ROWS / 2);
    let start = selectedIndex - halfWindow;
    let end = selectedIndex + halfWindow + (VISIBLE_ROWS % 2);

    // Clamp to bounds
    if (start < 0) {
      start = 0;
      end = VISIBLE_ROWS;
    } else if (end > total) {
      end = total;
      start = total - VISIBLE_ROWS;
    }

    return { start, end };
  }, [sessions.length, selectedIndex]);

  // Build display rows - memoized
  const displayRows = useMemo(() => {
    const rows: Array<{
      key: string;
      session: SessionDisplayInfo;
      index: number;
      isSelected: boolean;
    }> = [];

    for (let i = scrollWindow.start; i < scrollWindow.end; i++) {
      const session = sessions[i];
      if (session) {
        rows.push({
          key: `row-${i}-${session.sessionId}`,
          session,
          index: i,
          isSelected: i === selectedIndex,
        });
      }
    }

    return rows;
  }, [sessions, scrollWindow, selectedIndex]);

  const aboveCount = scrollWindow.start;
  const belowCount = sessions.length - scrollWindow.end;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentPurple}
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Box marginBottom={1}>
        <Text color={Colors.AccentPurple} bold>
           Resume Session ({sessions.length} available)
        </Text>
        {loading && <Text dimColor> loading...</Text>}
      </Box>

      {loading ? (
        <Box height={VISIBLE_ROWS + 2}>
          <Text dimColor>Loading sessions...</Text>
        </Box>
      ) : sessions.length === 0 ? (
        <Box height={3}>
          <Text dimColor>No previous sessions found.</Text>
        </Box>
      ) : (
        <Box flexDirection="row">
          {/* Left: Session list - fixed height */}
          <Box flexDirection="column" width={44}>
            {aboveCount > 0 && (
              <Text dimColor>    ↑ {aboveCount} more</Text>
            )}
            {aboveCount === 0 && <Text> </Text>}

            {displayRows.map((row) => (
              <Text key={row.key}>
                <Text color={row.isSelected ? Colors.AccentCyan : undefined} bold={row.isSelected}>
                  {row.isSelected ? '❯ ' : ' '}
                </Text>
                <Text dimColor>{row.index + 1}. </Text>
                <Text color={row.isSelected ? Colors.AccentCyan : Colors.AccentBlue}>
                  {row.session.title
                    ? row.session.title.slice(0, 28).padEnd(28)
                    : row.session.shortId.padEnd(28)}
                </Text>
                <Text dimColor> │ </Text>
                <Text color={row.isSelected ? Colors.AccentCyan : undefined}>
                  {row.session.age.padEnd(9)}
                </Text>
              </Text>
            ))}

            {belowCount > 0 && (
              <Text dimColor>    ↓ {belowCount} more</Text>
            )}
            {belowCount === 0 && <Text> </Text>}
          </Box>

          {/* Right: Details panel - matches list height */}
          <Box flexDirection="column" width={38} paddingLeft={1}>
            <Text bold color={Colors.AccentPurple}>Session Details</Text>
            <Box
              borderStyle="single"
              borderColor={Colors.Gray}
              flexDirection="column"
              paddingX={1}
              height={13}
            >
              {selectedSession && (
                <>
                  {selectedSession.title && (
                    <Text bold color={Colors.AccentCyan}>{selectedSession.title.slice(0, 34)}</Text>
                  )}
                  <Text><Text color={Colors.AccentCyan}>ID:</Text> {selectedSession.shortId}</Text>
                  <Text><Text color={Colors.AccentCyan}>Messages:</Text> {selectedSession.messageCount}</Text>
                  <Text><Text color={Colors.AccentCyan}>Last Active:</Text> {selectedSession.age}</Text>
                  <Text><Text color={Colors.AccentCyan}>Model:</Text> {(selectedSession.model || 'Unknown').slice(0, 24)}</Text>
                  <Text><Text color={Colors.AccentCyan}>Date:</Text> {selectedSession.lastModified.toLocaleDateString()}</Text>
                  <Box marginTop={1} flexDirection="column">
                    <Text color={Colors.AccentCyan}>First Prompt:</Text>
                    <Text dimColor wrap="wrap">
                      {selectedSession.firstUserMessage
                        ? selectedSession.firstUserMessage.slice(0, 250)
                        : '(No preview available)'}
                    </Text>
                  </Box>
                </>
              )}
            </Box>
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate • 1-9 quick select • Enter resume • Esc cancel</Text>
      </Box>
    </Box>
  );
};

/**
 * Main Cortex Application
 */
export const CortexApp: React.FC<CortexAppProps> = ({
  modelId,
  debug = false,
  projectPath,
  autoApprove: initialAutoApprove = false,
  initialPrompt,
}) => {
  const { exit } = useApp();
  useStdout(); // Keep for potential future use
  const { width: terminalWidth, height: terminalHeight } = useTerminalSize();

  // Application state
  const [client, setClient] = useState<OrchestratorClient | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showConfigMenu, setShowConfigMenu] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [autoApprove, setAutoApprove] = useState(initialAutoApprove);
  const [currentModel, setCurrentModel] = useState(modelId || 'loading...');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('none');
  const [supportsReasoning, setSupportsReasoning] = useState(false);
  const [reasoningToggleable, setReasoningToggleable] = useState(false);
  // Initialize theme from .cortex/config.json or use default
  const [currentTheme, setCurrentTheme] = useState<ThemeName>(() => initializeTheme());
  const [showThemePicker, setShowThemePicker] = useState(false);

  // Model picker state
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelDisplayInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Session picker state
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [availableSessions, setAvailableSessions] = useState<SessionDisplayInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // System message manager state
  const [showSystemMessageManager, setShowSystemMessageManager] = useState(false);
  const [systemMessageStore, setSystemMessageStore] = useState<SystemMessageStore | null>(null);

  // Mentorship config menu state
  const [showMentorshipConfig, setShowMentorshipConfig] = useState(false);
  const [mentorshipMenuDef, setMentorshipMenuDef] = useState<InteractiveMenuDefinition | null>(null);
  const [mentorshipInitialValues, setMentorshipInitialValues] = useState<Record<string, unknown>>({});
  const [mentorshipService, setMentorshipService] = useState<MentorshipConfigService | null>(null);

  // Sub-agent tracking state for parallel agent display
  const subAgentStateManagerRef = useRef(createSubAgentStateManager());
  const [subAgents, setSubAgents] = useState<Map<string, SubAgentState>>(new Map());

  // Sub-agent event handler callback - updates state for UI
  const handleSubAgentEvent = useCallback((event: SubAgentEvent) => {
    const manager = subAgentStateManagerRef.current;

    switch (event.type) {
      case 'started':
        manager.handleStarted({
          agentId: event.agentId,
          agentName: event.agentName,
          model: event.data.model || 'unknown',
        });
        break;
      case 'progress':
        manager.handleProgress({
          agentId: event.agentId,
          turnNumber: event.data.turnNumber || 0,
          totalTokens: event.data.totalTokens || 0,
          elapsedMs: event.data.elapsedMs || 0,
        });
        break;
      case 'tool_call':
        manager.handleToolCall({
          agentId: event.agentId,
          toolName: event.data.toolName || 'unknown',
          toolInput: {},
        });
        break;
      case 'text':
        manager.handleText({
          agentId: event.agentId,
          text: event.data.text || '',
          isFinal: event.data.isFinal || false,
        });
        break;
      case 'completed':
        manager.handleCompleted({
          agentId: event.agentId,
          result: {
            status: event.data.status || 'completed',
            durationMs: event.data.elapsedMs || 0,
            turnCount: event.data.turnNumber || 0,
          },
        });
        // Clear completed agent from display after brief delay
        // This allows the completion status to show briefly, then it scrolls away
        setTimeout(() => {
          manager.agents.delete(event.agentId);
          setSubAgents(new Map(manager.agents));
        }, 2000);
        break;
      case 'error':
        manager.handleError({
          agentId: event.agentId,
          agentName: event.agentName,
          error: new Error(event.data.error || 'Unknown error'),
        });
        // Clear errored agent from display after delay
        setTimeout(() => {
          manager.agents.delete(event.agentId);
          setSubAgents(new Map(manager.agents));
        }, 3000);
        break;
    }

    // Trigger re-render with updated agents
    setSubAgents(new Map(manager.agents));
  }, []);

  // Queued/staged message - submitted while streaming, will auto-send when ready
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);

  // History management - read directly from orchestrator (single source of truth)
  const [orchestratorHistory, setOrchestratorHistory] = useState<any[]>([]);

  // Sync history from orchestrator (used for real-time updates during streaming)
  // TODO: Wire this into streaming to show real-time tool execution
  const refreshOrchestratorHistory = useCallback(() => {
    if (client) {
      const messages = client.getMessageHistory();
      setOrchestratorHistory([...messages]);
    }
  }, [client]);

  // Initialize orchestrator history on client ready
  useEffect(() => {
    if (client) {
      refreshOrchestratorHistory();
    }
  }, [client, refreshOrchestratorHistory]);

  // Legacy addItem for slash commands that add info/error messages
  // These are UI-only messages, not part of the conversation
  const [uiMessages, setUiMessages] = useState<HistoryItem[]>([]);
  const addItem = useCallback((item: HistoryItemWithoutId, timestamp: number, _isResuming?: boolean): string => {
    const id = `ui-${timestamp}-${Math.random().toString(36).substr(2, 5)}`;
    setUiMessages(prev => [...prev, { ...item, id, timestamp } as HistoryItem]);
    return id;
  }, []);

  // Document preview expansion state (for collapsible document previews)
  const [expandedDocuments, setExpandedDocuments] = useState<Set<string>>(new Set());
  const [documentContents, setDocumentContents] = useState<Map<string, string | null>>(new Map());

  const clearHistory = useCallback(() => {
    setUiMessages([]);
    // Note: This doesn't clear orchestrator history - that's persistent
  }, []);

  // Combined history: orchestrator messages + UI messages, sorted by timestamp
  const history = useMemo(() => {
    const orchestratorItems = orchestratorHistory.map(msg => ({
      id: msg.uuid,
      timestamp: new Date(msg.timestamp).getTime(),
      type: 'orchestrator' as const,
      message: msg,
    }));
    return [...orchestratorItems, ...uiMessages].sort((a, b) => a.timestamp - b.timestamp);
  }, [orchestratorHistory, uiMessages]);

  // Extract user messages from history for input history navigation
  const userMessages = useMemo(() => {
    return history
      .filter((item): item is HistoryItem => item.type === MessageType.User)
      .map(item => {
        if ('userContent' in item && item.userContent) {
          return typeof item.userContent === 'string'
            ? item.userContent
            : (item.userContent as any).text || '';
        }
        return '';
      })
      .filter(text => text.length > 0);
  }, [history]);

  // YOLO mode toggle callback for approval handler
  const handleYoloToggle = useCallback(() => {
    setAutoApprove(prev => {
      const newValue = !prev;
      // Also update the orchestrator
      if (client) {
        if (newValue) {
          client.enableYoloMode();
        } else {
          client.disableYoloMode();
        }
      }
      return newValue;
    });
  }, [client]);

  // React-compatible approval handler
  const {
    handler: approvalHandler,
    pendingApproval,
    approve,
    deny,
    approveAndEnableYolo,
  } = useReactApprovalHandler(handleYoloToggle);

  // Initialize orchestrator client
  useEffect(() => {
    const initClient = async () => {
      try {
        // Priority: CLI arg > persisted model > env var > fallback
        const persistedModel = loadPersistedModel();
        const effectiveModelId = modelId || persistedModel || process.env.DEFAULT_MODEL_ID || 'grok-code-fast-1';

        const orchestratorClient = new OrchestratorClient({
          mode: 'direct',
          defaultModelId: effectiveModelId,
          projectPath: projectPath || process.cwd(),
          debug,
        });

        await orchestratorClient.initialize();

        // Set our React-compatible approval handler
        orchestratorClient.setApprovalHandler(approvalHandler);

        // Set sub-agent event callback for parallel agent display
        orchestratorClient.setSubAgentEventCallback(handleSubAgentEvent);

        setClient(orchestratorClient);
        setInitialized(true);

        // Get actual model name and capabilities
        const model = orchestratorClient.getCurrentModel();
        if (model) {
          setCurrentModel(model.name || model.id);
          // Check if model supports reasoning
          setSupportsReasoning(model.reasoning?.supported === true);
          setReasoningToggleable(model.reasoning?.toggleable === true);
        }

        // Set initial YOLO mode if requested
        if (initialAutoApprove) {
          orchestratorClient.enableYoloMode();
        }
      } catch (err) {
        setInitError(err instanceof Error ? err.message : 'Failed to initialize');
      }
    };

    initClient();
  }, [modelId, projectPath, debug, approvalHandler, initialAutoApprove, handleSubAgentEvent]);

  // Debug message handler
  const handleDebugMessage = useCallback((message: string) => {
    if (debug) {
      console.log(`[Debug] ${message}`);
    }
  }, [debug]);

  // Parse slash command into parts
  const parseSlashCommand = useCallback((cmd: string) => {
    const withoutSlash = cmd.slice(1).trim();
    const parts = withoutSlash.split(/\s+/);
    const command = parts[0]?.toLowerCase() || '';
    const subcommand = parts[1]?.toLowerCase();
    const args = parts.slice(2);
    return { command, subcommand, args, raw: withoutSlash };
  }, []);

  // Slash command handler - expanded with all chalk CLI commands
  const handleSlashCommand = useCallback(async (cmd: string): Promise<any> => {
    const { command, subcommand, args, raw } = parseSlashCommand(cmd);

    switch (command) {
      case 'help':
      case '?':
        setShowHelp(true);
        return { handled: true };

      case 'clear':
        clearHistory();
        addItem({ type: MessageType.Info, infoContent: 'History cleared' }, Date.now());
        return { handled: true };

      case 'exit':
      case 'quit':
      case 'q':
        exit();
        return { handled: true };

      case 'yolo': {
        const isDisabling = args[0] === 'off';
        const isYoloActive = client?.isYoloModeActive() || false;

        if (isDisabling || isYoloActive) {
          client?.disableYoloMode();
          setAutoApprove(false);
          addItem({ type: MessageType.Info, infoContent: 'YOLO mode disabled. Interactive approval restored.' }, Date.now());
        } else {
          client?.enableYoloMode();
          setAutoApprove(true);
          addItem({ type: MessageType.Info, infoContent: ' YOLO MODE ACTIVATED - All tools auto-approved!' }, Date.now());
        }
        return { handled: true };
      }

      case 'thinking':
        setShowThinking(prev => !prev);
        addItem({
          type: MessageType.Info,
          infoContent: `Show thinking: ${!showThinking ? 'ON' : 'OFF'}`,
        }, Date.now());
        return { handled: true };

      case 'theme': {
        // /theme - show current theme
        // /theme list - list all themes
        // /theme set <name> - set theme
        // /theme picker - open interactive theme picker
        if (!subcommand) {
          const themeDef = getThemeDefinition(currentTheme);
          addItem({
            type: MessageType.Info,
            infoContent: `Current theme: ${themeDef?.name || currentTheme}\nTip: Use /theme picker for interactive selection`,
          }, Date.now());
          return { handled: true };
        }

        if (subcommand === 'picker' || subcommand === 'pick') {
          setShowThemePicker(true);
          return { handled: true };
        }

        if (subcommand === 'list') {
          const themes = getThemeNames();
          const themeList = themes.map(name => {
            const def = getThemeDefinition(name);
            const marker = name === currentTheme ? '●' : '○';
            return ` ${marker} ${name} - ${def?.name || name}`;
          }).join('\n');
          addItem({
            type: MessageType.Info,
            infoContent: `Available themes:\n${themeList}`,
          }, Date.now());
          return { handled: true };
        }

        if (subcommand === 'set') {
          const themeName = args[0] as ThemeName;
          if (!themeName) {
            addItem({
              type: MessageType.Error,
              errorContent: 'Usage: /theme set <theme-name>',
            }, Date.now());
            return { handled: true };
          }

          if (setTheme(themeName)) {
            setCurrentTheme(themeName);
            const themeDef = getThemeDefinition(themeName);
            addItem({
              type: MessageType.Info,
              infoContent: `✓ Theme set to: ${themeDef?.name || themeName}`,
            }, Date.now());
          } else {
            const available = getThemeNames().join(', ');
            addItem({
              type: MessageType.Error,
              errorContent: `Unknown theme: ${themeName}\nAvailable: ${available}`,
            }, Date.now());
          }
          return { handled: true };
        }

        addItem({
          type: MessageType.Error,
          errorContent: 'Usage: /theme [list | set <name> | picker]',
        }, Date.now());
        return { handled: true };
      }

      case 'm':
      case 'model': {
        // /model picker - open interactive model picker
        if (subcommand === 'picker' || subcommand === 'pick') {
          if (!client) {
            addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
            return { handled: true };
          }

          // Load models and open picker
          setModelsLoading(true);
          setShowModelPicker(true);

          try {
            const models = await client.listModels();
            const modelDisplayInfos: ModelDisplayInfo[] = models.map((m: any) => ({
              id: m.id,
              displayName: m.displayName || m.id,
              provider: m.owned_by || m.provider || 'Unknown',
              contextWindow: m.contextWindow,
              supportsReasoning: m.reasoning?.supported === true,
              reasoningToggleable: m.reasoning?.toggleable === true,
              inputCost: m.inputCostPer1M,
              outputCost: m.outputCostPer1M,
            }));
            setAvailableModels(modelDisplayInfos);
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error loading models: ${error.message}` }, Date.now());
            setShowModelPicker(false);
          } finally {
            setModelsLoading(false);
          }
          return { handled: true };
        }

        // /model alone shows current model
        addItem({
          type: MessageType.Info,
          infoContent: `Current model: ${currentModel}\nTip: Use /model picker for interactive selection`,
        }, Date.now());
        return { handled: true };
      }

      case 'session':
        if (subcommand === 'list') {
          // /session list
          if (!client) {
            addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
            return { handled: true };
          }
          try {
            const result = await client.listSessions();
            const sessions = result.sessions;
            if (sessions && sessions.length > 0) {
              const sessionList = sessions.slice(0, 10).map((s: any) =>
                ` ${s.sessionId?.slice(0, 8) || s.id?.slice(0, 8)} - ${s.messageCount || 0} messages`
              ).join('\n');
              addItem({
                type: MessageType.Info,
                infoContent: `Sessions:\n${sessionList}${sessions.length > 10 ? `\n  ... and ${sessions.length - 10} more` : ''}`,
              }, Date.now());
            } else {
              addItem({ type: MessageType.Info, infoContent: 'No sessions found' }, Date.now());
            }
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        if (subcommand === 'checkpoint') {
          // /session checkpoint [name]
          const checkpointName = args.join(' ') || `Checkpoint ${new Date().toLocaleString()}`;
          if (!client) {
            addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
            return { handled: true };
          }
          try {
            const checkpoint = await client.createCheckpoint(checkpointName);
            addItem({
              type: MessageType.Info,
              infoContent: `✓ Checkpoint created: ${checkpoint.id?.slice(0, 8) || 'unknown'} - "${checkpointName}"`,
            }, Date.now());
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        addItem({ type: MessageType.Info, infoContent: 'Available: /session list, /session checkpoint [name]' }, Date.now());
        return { handled: true };

      case 'cache':
        if (subcommand === 'metrics') {
          // /cache metrics
          if (!client) {
            addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
            return { handled: true };
          }
          try {
            const result = await client.getCacheMetrics();
            if (result?.metrics) {
              const m = result.metrics;
              const hitRate = m.overallCacheHitRate ? `${(m.overallCacheHitRate * 100).toFixed(1)}%` : '0%';
              const costSavings = m.overallCostSavingsRatio ? `${(m.overallCostSavingsRatio * 100).toFixed(1)}%` : '0%';

              const lines = [
                `Cache Metrics:`,
                ` Total Requests: ${m.requestCount || 0}`,
                ` Requests with Cache Hits: ${m.requestsWithCacheHits || 0}`,
                '',
                ` Total Input Tokens: ${(m.totalInputTokens || 0).toLocaleString()}`,
                ` Cache Creation: ${(m.totalCacheCreationTokens || 0).toLocaleString()}`,
                ` Cache Reads: ${(m.totalCacheReadTokens || 0).toLocaleString()}`,
                ` Uncached: ${(m.totalUncachedInputTokens || 0).toLocaleString()}`,
                '',
                ` Cache Hit Rate: ${hitRate}`,
                ` Est. Cost Savings: ${costSavings}`
              ];

              // Show provider breakdown if available
              if (Object.keys(m.byProvider || {}).length > 0) {
                lines.push('');
                lines.push(' By Provider:');
                for (const [provider, pm] of Object.entries(m.byProvider) as [string, any][]) {
                  const providerHitRate = pm.cacheHitRate ? `${(pm.cacheHitRate * 100).toFixed(1)}%` : '0%';
                  lines.push(` ${provider}: ${pm.cacheReadTokens.toLocaleString()} cached (${providerHitRate})`);
                }
              }

              addItem({ type: MessageType.Info, infoContent: lines.join('\n') }, Date.now());
            } else {
              addItem({
                type: MessageType.Info,
                infoContent: 'No cache metrics available\n[i] Make some API requests with caching enabled'
              }, Date.now());
            }
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        if (subcommand === 'report') {
          // /cache report
          if (!client) {
            addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
            return { handled: true };
          }
          try {
            const report = await client.getCacheReport();
            addItem({ type: MessageType.Info, infoContent: report || 'No cache report available' }, Date.now());
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        addItem({ type: MessageType.Info, infoContent: 'Available: /cache metrics, /cache report' }, Date.now());
        return { handled: true };

      case 'mcp':
        if (subcommand === 'list') {
          // /mcp list
          if (!client) {
            addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
            return { handled: true };
          }
          try {
            const result = await client.listMcpServers();
            if (!result.enabled) {
              addItem({ type: MessageType.Info, infoContent: 'MCP is not enabled' }, Date.now());
              return { handled: true };
            }
            const servers = result.servers;
            if (servers && servers.length > 0) {
              const serverList = servers.map((s: any) =>
                ` ${s.name} [${s.enabled ? 'enabled' : 'disabled'}]${s.description ? ` - ${s.description}` : ''}`
              ).join('\n');
              addItem({ type: MessageType.Info, infoContent: `MCP Servers:\n${serverList}` }, Date.now());
            } else {
              addItem({ type: MessageType.Info, infoContent: 'No MCP servers configured' }, Date.now());
            }
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        if (subcommand === 'enable') {
          const serverName = args[0];
          if (!serverName) {
            addItem({ type: MessageType.Error, errorContent: 'Usage: /mcp enable <server-name>' }, Date.now());
            return { handled: true };
          }
          if (!client) {
            addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
            return { handled: true };
          }
          try {
            await client.enableMCPServer(serverName);
            addItem({ type: MessageType.Info, infoContent: `✓ Enabled MCP server: ${serverName}` }, Date.now());
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        if (subcommand === 'disable') {
          const serverName = args[0];
          if (!serverName) {
            addItem({ type: MessageType.Error, errorContent: 'Usage: /mcp disable <server-name>' }, Date.now());
            return { handled: true };
          }
          if (!client) {
            addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
            return { handled: true };
          }
          try {
            await client.disableMCPServer(serverName);
            addItem({ type: MessageType.Info, infoContent: `✓ Disabled MCP server: ${serverName}` }, Date.now());
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        addItem({ type: MessageType.Info, infoContent: 'Available: /mcp list, /mcp enable <name>, /mcp disable <name>' }, Date.now());
        return { handled: true };

      case 'tools':
        if (subcommand === 'list') {
          // /tools list [--grouped]
          const grouped = args.includes('--grouped');
          if (!client) {
            addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
            return { handled: true };
          }
          try {
            const result = await client.listTools(grouped);
            if (grouped && result.grouped) {
              let output = 'Available Tools:\n';
              for (const [category, tools] of Object.entries(result.grouped as Record<string, any[]>)) {
                output += `\n  ${category}:\n`;
                for (const tool of tools) {
                  output += ` ${tool.name}${tool.description ? ` - ${tool.description.slice(0, 50)}...` : ''}\n`;
                }
              }
              addItem({ type: MessageType.Info, infoContent: output }, Date.now());
            } else if (result.tools) {
              const toolList = result.tools.slice(0, 20).map((t: any) =>
                ` ${t.name}${t.description ? ` - ${t.description.slice(0, 40)}...` : ''}`
              ).join('\n');
              addItem({
                type: MessageType.Info,
                infoContent: `Available Tools (${result.totalCount}):\n${toolList}${result.tools.length > 20 ? '\n  ...' : ''}`,
              }, Date.now());
            }
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        if (subcommand === 'info') {
          const toolName = args[0];
          if (!toolName) {
            addItem({ type: MessageType.Error, errorContent: 'Usage: /tools info <tool-name>' }, Date.now());
            return { handled: true };
          }
          if (!client) {
            addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
            return { handled: true };
          }
          try {
            const toolInfo = await client.getToolInfo(toolName);
            if (toolInfo) {
              const info = [
                `Tool: ${toolInfo.name}`,
                toolInfo.description ? `Description: ${toolInfo.description}` : '',
                toolInfo.category ? `Category: ${toolInfo.category}` : '',
              ].filter(Boolean).join('\n  ');
              addItem({ type: MessageType.Info, infoContent: info }, Date.now());
            }
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        addItem({ type: MessageType.Info, infoContent: 'Available: /tools list [--grouped], /tools info <name>' }, Date.now());
        return { handled: true };

      case 'init':
        // /init - Scan project, then let the model write CORTEX.md
        if (!client) {
          addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
          return { handled: true };
        }
        try {
          addItem({ type: MessageType.Info, infoContent: '[INIT] Scanning project...' }, Date.now());
          const { InitCortexContext } = await import('@nexus-cortex/core');
          const isGlobal = args.includes('--global');
          const depthIndex = args.indexOf('--depth');
          const depthArg = depthIndex >= 0 ? args[depthIndex + 1] : undefined;

          const scan = await InitCortexContext.scan(
            projectPath || process.cwd(),
            {
              scope: isGlobal ? 'global' : 'auto',
              max_depth: depthArg ? parseInt(depthArg, 10) : undefined,
            }
          );
          const prompt = InitCortexContext.formatScanAsPrompt(scan);
          addItem({ type: MessageType.Info, infoContent: `[INIT] Scan complete. Generating CORTEX.md...` }, Date.now());
          return { type: 'submit_prompt' as const, content: prompt };
        } catch (error: any) {
          addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
        }
        return { handled: true };

      case 'continue':
        // /continue - Interactive session picker
        if (!client) {
          addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
          return { handled: true };
        }
        try {
          setSessionsLoading(true);
          setShowSessionPicker(true);

          const { resolveContext, JSONLHistoryStore } = await import('@nexus-cortex/core');
          const context = resolveContext({ cwd: projectPath || process.cwd() });
          const historyStore = new JSONLHistoryStore({ baseDir: context.sessionsDir });

          const sessions = await historyStore.listSessions();

          // Sort by most recent
          sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

          // Fetch first user message for each session (for preview)
          const sessionDisplayInfos: SessionDisplayInfo[] = await Promise.all(
            sessions.slice(0, 50).map(async (s) => {
              let firstUserMessage: string | undefined;
              try {
                const messages = await historyStore.loadSession(s.sessionId);
                // Find first user message - messages have type: 'user'|'assistant'|etc and message object
                const firstUser = messages.find((m: any) => m.type === 'user');
                if (firstUser && (firstUser as any).message) {
                  const msg = (firstUser as any).message;
                  if (typeof msg.content === 'string') {
                    firstUserMessage = msg.content.replace(/\n/g, ' ').trim();
                  } else if (Array.isArray(msg.content)) {
                    const textPart = msg.content.find((p: any) => p.type === 'text');
                    if (textPart && textPart.text) {
                      firstUserMessage = textPart.text.replace(/\n/g, ' ').trim();
                    }
                  }
                }
              } catch {
                // Ignore errors loading individual sessions
              }

              return {
                sessionId: s.sessionId,
                shortId: s.sessionId.slice(0, 8),
                lastModified: s.lastModified,
                messageCount: s.messageCount,
                model: s.metadata?.currentModel,
                title: s.metadata?.title,
                firstUserMessage,
                age: formatSessionAge(s.lastModified),
              };
            })
          );

          setAvailableSessions(sessionDisplayInfos);
          setSessionsLoading(false);

          // Store sessions for /resume command (backwards compatibility)
          (client as any)._cachedSessions = sessions.slice(0, 50);
        } catch (error: any) {
          setShowSessionPicker(false);
          setSessionsLoading(false);
          addItem({ type: MessageType.Error, errorContent: `Error loading sessions: ${error.message}` }, Date.now());
        }
        return { handled: true };

      case 'resume': {
        // /resume <number|session-id>
        const selector = raw.split(/\s+/)[1];
        if (!selector) {
          addItem({ type: MessageType.Error, errorContent: 'Usage: /resume <number> or /resume <session-id>' }, Date.now());
          return { handled: true };
        }
        if (!client) {
          addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
          return { handled: true };
        }
        try {
          let sessionId: string;
          const cachedSessions = (client as any)._cachedSessions as any[] | undefined;

          // Check if selector is a number (index) or session ID
          const num = parseInt(selector, 10);
          if (!isNaN(num) && cachedSessions && num >= 1 && num <= cachedSessions.length) {
            sessionId = cachedSessions[num - 1].sessionId;
          } else {
            // Treat as session ID (or prefix)
            sessionId = selector;
          }

          addItem({ type: MessageType.Info, infoContent: `Resuming session ${sessionId.slice(0, 8)}...` }, Date.now());
          await client.resumeSession(sessionId);
          // Refresh history to display the loaded session's messages
          refreshOrchestratorHistory();
          addItem({ type: MessageType.Info, infoContent: `✓ Session resumed. Continue your conversation.` }, Date.now());
        } catch (error: any) {
          addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
        }
        return { handled: true };
      }

      case 'debug': {
        const newDebugState = !(client?.isDebugActive() ?? process.env.DEBUG === 'true');
        if (client) {
          client.setDebug(newDebugState);
        } else {
          process.env.DEBUG = newDebugState ? 'true' : 'false';
        }
        addItem({
          type: MessageType.Info,
          infoContent: `Debug mode: ${newDebugState ? 'ON' : 'OFF'}`,
        }, Date.now());
        return { handled: true };
      }

      case 'config': {
        // /config - show summary
        // /config list - list all config keys
        // /config get <key> - get specific value
        // /config set <key> <value> - set value
        if (!client) {
          addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
          return { handled: true };
        }

        if (!subcommand) {
          setShowConfigMenu(true);
          return { handled: true };
        }

        if (subcommand === 'list') {
          try {
            const keys = await client.listConfigKeys();
            const keyList = keys.map(k => ` ${k}`).join('\n');
            addItem({
              type: MessageType.Info,
              infoContent: `Configuration Keys:\n${keyList}`,
            }, Date.now());
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        if (subcommand === 'get') {
          const key = args[0];
          if (!key) {
            addItem({ type: MessageType.Error, errorContent: 'Usage: /config get <key>' }, Date.now());
            return { handled: true };
          }
          try {
            const value = await client.getConfig(key);
            // Mask API keys
            const displayValue = key.includes('API_KEY') && value ? '***configured***' : value;
            addItem({
              type: MessageType.Info,
              infoContent: `${key} = ${displayValue}`,
            }, Date.now());
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        if (subcommand === 'set') {
          const key = args[0];
          const value = args.slice(1).join(' ');
          if (!key || !value) {
            setShowConfigMenu(true);
            return { handled: true };
          }
          try {
            await client.setConfig(key, value);
            const { getRuntimeConfigEntry, isLiveToggleable } = await import('@nexus-cortex/core');
            const entry = getRuntimeConfigEntry(key);
            if (entry?.tier === 'config' && entry.mapper) {
              client.updateRuntimeConfig(entry.mapper(value));
            }
            addItem({
              type: MessageType.Info,
              infoContent: isLiveToggleable(key)
                ? `[OK] ${key} updated (live)`
                : `[OK] ${key} updated (restart required)`,
            }, Date.now());
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        if (subcommand === 'reset') {
          try {
            const { configReset } = await import('@nexus-cortex/cli/dist/commands/config/reset.js');
            await configReset();
            addItem({
              type: MessageType.Info,
              infoContent: '[OK] Configuration reset to benchmark-proven optimal defaults (API keys preserved). Restart recommended.',
            }, Date.now());
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        addItem({
          type: MessageType.Info,
          infoContent: 'Available: /config, /config list, /config get <key>, /config set <key> <value>, /config reset',
        }, Date.now());
        return { handled: true };
      }

      case 'system-message':
      case 'sysmsg': {
        // /system-message - open interactive manager (default)
        // /system-message list - quick list of system messages
        // /system-message view <filename> - view content
        if (!client) {
          addItem({ type: MessageType.Error, errorContent: 'Client not initialized' }, Date.now());
          return { handled: true };
        }

        // Interactive manager mode (default or 'manage' subcommand)
        if (!subcommand || subcommand === 'manage') {
          try {
            // Get context-aware paths using ContextResolver
            const { resolveContext } = await import('@nexus-cortex/core/utils/ContextResolver.js');
            const context = resolveContext({ cwd: projectPath, debug });

            // Builtin directory: relative to package location
            const { fileURLToPath } = await import('url');
            const { dirname, join } = await import('path');
            // packages/cli/dist/ink-ui/CortexApp.js -> packages/core/dist/system-messages
            const currentDir = dirname(fileURLToPath(import.meta.url));
            const cliDistDir = dirname(currentDir); // packages/cli/dist
            const packagesDir = dirname(dirname(cliDistDir)); // packages/
            const builtinDir = join(packagesDir, 'core', 'dist', 'system-messages');

            // Initialize store
            const store = new SystemMessageStore({
              builtinDir,
              runtimeDir: context.systemMessagesDir,
              enableWatching: false, // Don't watch in dialog mode
              debug: debug || false,
            });

            await store.initialize();
            setSystemMessageStore(store);
            setShowSystemMessageManager(true);

            addItem({
              type: MessageType.Info,
              infoContent: ' Opening System Message Manager...',
            }, Date.now());
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error opening manager: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        if (subcommand === 'list') {
          try {
            const messages = await client.listSystemMessages();
            if (messages.length === 0) {
              addItem({
                type: MessageType.Info,
                infoContent: 'No system messages found.\nCreate files in .cortex/system-messages/ (e.g., 01-base.md)\n\nUse /system-message to open interactive manager',
              }, Date.now());
            } else {
              const msgList = messages.map(m =>
                ` [${String(m.priority).padStart(2, '0')}] ${m.filename}`
              ).join('\n');
              addItem({
                type: MessageType.Info,
                infoContent: `System Messages:\n${msgList}\n\nUse /system-message to manage interactively`,
              }, Date.now());
            }
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        if (subcommand === 'view') {
          const filename = args[0];
          if (!filename) {
            addItem({ type: MessageType.Error, errorContent: 'Usage: /system-message view <filename>' }, Date.now());
            return { handled: true };
          }
          try {
            const content = await client.getSystemMessageContent(filename);
            // Truncate if too long
            const maxLength = 2000;
            const displayContent = content.length > maxLength
              ? content.slice(0, maxLength) + '\n... (truncated)'
              : content;
            addItem({
              type: MessageType.Info,
              infoContent: `─── ${filename} ───\n${displayContent}`,
            }, Date.now());
          } catch (error: any) {
            addItem({ type: MessageType.Error, errorContent: `Error: ${error.message}` }, Date.now());
          }
          return { handled: true };
        }

        addItem({
          type: MessageType.Info,
          infoContent: 'Available:\n  /system-message       - Interactive manager\n  /system-message list  - Quick list\n  /system-message view <filename>',
        }, Date.now());
        return { handled: true };
      }

      case 'mentorship': {
        // Direct mentorship commands
        // Find installation root - prefer env var, then use module location
        const getInstallationRoot = (): string => {
          const root = process.env.CORTEX_ROOT;
          if (root) return root;
          return CLI_INSTALLATION_ROOT;
        };

        const mentorshipSvc = new MentorshipConfigService(getInstallationRoot());

        // /mentorship or /mentorship status - show status immediately
        if (!subcommand || subcommand === 'status') {
          const summary = mentorshipSvc.getSummary();
          const statusIcon = summary.status === 'enabled' ? '[ON]' : '[OFF]';
          addItem({
            type: MessageType.Info,
            infoContent: [
              `Mentorship: ${statusIcon} ${summary.status.toUpperCase()}`,
              `Helper:     ${summary.helperModel}`,
              `Triggers:   ${summary.triggers.join(', ')}`,
              '',
              '/mentorship enable|disable|config',
            ].join('\n'),
          }, Date.now());
          return { handled: true };
        }

        if (subcommand === 'enable') {
          await mentorshipSvc.quickEnable();
          client?.updateRuntimeConfig({
            reactiveMentorship: {
              enabled: true,
              triggerOnError: true,
              errorSeverityThreshold: 'medium',
              enableKeywords: false,
              patternDetection: true,
            },
          });
          addItem({
            type: MessageType.Info,
            infoContent: '[OK] Mentorship enabled',
          }, Date.now());
          return { handled: true };
        }

        if (subcommand === 'disable') {
          await mentorshipSvc.quickDisable();
          client?.updateRuntimeConfig({
            reactiveMentorship: { enabled: false, triggerOnError: false, errorSeverityThreshold: 'medium', enableKeywords: false },
          });
          addItem({
            type: MessageType.Info,
            infoContent: 'Mentorship disabled',
          }, Date.now());
          return { handled: true };
        }

        // /mentorship config - show interactive config menu
        if (subcommand === 'config') {
          const menuDef = mentorshipSvc.getMenuDefinition();
          const config = mentorshipSvc.getConfig();

          // Extract initial values from config matching menu item keys
          const initialValues: Record<string, unknown> = {};
          for (const section of menuDef.sections) {
            for (const item of section.items) {
              // Map menu item keys (ENV var names) to config values
              const configKeyMap: Record<string, keyof typeof config> = {
                'MENTORSHIP_ENABLED': 'enabled',
                'MENTORSHIP_TRIGGER_ON_ERROR': 'triggerOnError',
                'MENTORSHIP_ERROR_THRESHOLD': 'errorThreshold',
                'MENTORSHIP_KEYWORDS_ENABLED': 'keywordsEnabled',
                'MENTORSHIP_CUSTOM_KEYWORDS': 'customKeywords',
                'MENTORSHIP_HELPER_MODEL': 'helperModel',
                'MENTORSHIP_TURN_BASED_ENABLED': 'turnBasedEnabled',
                'MENTORSHIP_TURN_INTERVAL': 'turnInterval',
                'MENTORSHIP_INTERLEAVED_THINKING': 'interleavedThinking',
                'MENTORSHIP_PATTERN_DETECTION': 'patternDetection',
                'MENTORSHIP_PATTERN_THRESHOLD': 'patternThreshold',
              };
              const configKey = configKeyMap[item.key];
              if (configKey) {
                initialValues[item.key] = config[configKey];
              }
            }
          }

          // Store service and show menu
          setMentorshipService(mentorshipSvc);
          setMentorshipMenuDef(menuDef);
          setMentorshipInitialValues(initialValues);
          setShowMentorshipConfig(true);
          return { handled: true };
        }

        addItem({
          type: MessageType.Error,
          errorContent: 'Usage: /mentorship [status|enable|disable|config]',
        }, Date.now());
        return { handled: true };
      }

      case 'about': {
        const { renderSplashScreen: renderFullSplash } = await import('../ui/SplashScreen.js');
        addItem({ type: MessageType.Info, infoContent: renderFullSplash() }, Date.now());
        return { handled: true };
      }

      case 'agent': {
        const { AgentStore } = await import('@nexus-cortex/core');
        const agentDir = path.join(projectPath || process.cwd(), '.cortex', 'agents');
        const agentStore = new AgentStore({ projectDir: agentDir, enableWatching: false });
        await agentStore.initialize();
        try {
          const agents = agentStore.getAll();
          if (subcommand === 'list' || !subcommand) {
            if (agents.length === 0) {
              addItem({ type: MessageType.Info, infoContent: 'No agents found. Create one in .cortex/agents/' }, Date.now());
            } else {
              const lines = agents.map((a: { name: string; description?: string; model?: string; tools?: string[] | string }) => {
                const loc = 'location' in a ? (a as any).location === 'project' ? '[P]' : '[G]' : '';
                const toolsInfo = a.tools === 'all' ? 'all' : Array.isArray(a.tools) ? `${a.tools.length} tools` : '';
                return ` ${loc} ${a.name} — ${a.description || '(no description)'} (${a.model || 'default'}, ${toolsInfo})`;
              });
              addItem({ type: MessageType.Info, infoContent: `Agents (${agents.length}):\n${lines.join('\n')}` }, Date.now());
            }
          } else if (subcommand === 'info' && args.length > 0) {
            const agent = agentStore.getAgent(args[0] as string);
            if (agent) {
              const toolsList = agent.tools === 'all' ? 'all' : Array.isArray(agent.tools) ? agent.tools.join(', ') : '';
              const details = [
                `Name: ${agent.name}`,
                `Description: ${agent.description || '(none)'}`,
                `Model: ${agent.model || '(default)'}`,
                `Tools: ${toolsList}`,
                'location' in agent ? `Location: ${(agent as any).location}` : null,
                'filePath' in agent ? `File: ${(agent as any).filePath}` : null,
              ].filter(Boolean).join('\n');
              addItem({ type: MessageType.Info, infoContent: details }, Date.now());
            } else {
              addItem({ type: MessageType.Error, errorContent: `Agent "${args[0]}" not found` }, Date.now());
            }
          } else {
            addItem({ type: MessageType.Info, infoContent: 'Usage: /agent [list|info <name>]' }, Date.now());
          }
        } finally {
          await agentStore.destroy();
        }
        return { handled: true };
      }

      default:
        addItem({
          type: MessageType.Error,
          errorContent: `Unknown command: /${command}. Type /help for available commands.`,
        }, Date.now());
        return { handled: true };
    }
  }, [parseSlashCommand, clearHistory, addItem, exit, autoApprove, showThinking, currentModel, debug, client, projectPath]);

  // Cancel handler
  const handleCancelSubmit = useCallback((_shouldRestorePrompt?: boolean) => {
    handleDebugMessage('Request cancelled');
  }, [handleDebugMessage]);

  // Streaming hook
  const {
    streamingState,
    submitQuery,
    initError: _streamInitError,
    pendingHistoryItems: _pendingHistoryItems,
    thought: _thought,
    cancelOngoingRequest,
    pendingToolCalls: _pendingToolCalls,
    pendingToolInputArgs: _pendingToolInputArgs,
    handleApprovalModeChange,
    streamEvents,
    turnSummary,
    turnUsage: _turnUsage,
    nextActionPrediction,
    streamStartTime,
  } = useCortexStream(
    client,
    history,
    addItem,
    { debug, projectPath, autoApprove },
    { showThinking },
    handleDebugMessage,
    handleSlashCommand,
    false, // shellModeActive
    handleCancelSubmit,
    terminalWidth,
    terminalHeight,
    refreshOrchestratorHistory, // Refresh history after streaming completes
  );

  // Keyboard shortcuts
  useInput((input, key) => {
    // Tab - toggle extended reasoning (only for toggleable models)
    if (key.tab && !key.shift) {
      if (reasoningToggleable) {
        // Toggle extended reasoning on/off
        setReasoningEffort(prev => {
          const newEffort = prev === 'none' ? 'high' : 'none';
          addItem({
            type: MessageType.Info,
            infoContent: `Extended reasoning: ${newEffort === 'high' ? 'ON' : 'OFF'}`,
          }, Date.now());
          return newEffort;
        });
      } else {
        // Model has native interleaved thinking or no reasoning support
        addItem({
          type: MessageType.Info,
          infoContent: supportsReasoning
            ? `${currentModel} has native interleaved thinking (always visible)`
            : `${currentModel} does not support extended reasoning`,
        }, Date.now());
      }
      return;
    }

    // Shift+Tab - toggle auto-approve
    if (key.tab && key.shift) {
      setAutoApprove(prev => {
        const newValue = !prev;
        handleApprovalModeChange(newValue);
        return newValue;
      });
      return;
    }

    // ESC - cancel streaming or close dialogs
    if (key.escape) {
      if (showHelp) {
        setShowHelp(false);
        return;
      }
      if (showConfigMenu) {
        setShowConfigMenu(false);
        return;
      }
      if (streamingState === StreamingState.Streaming) {
        cancelOngoingRequest();
        return;
      }
    }

    // Ctrl+C - exit
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    // Ctrl+E - toggle document previews (expand/collapse)
    if (key.ctrl && input === 'e' && streamingState === StreamingState.Idle) {
      // Collect all document IDs from history
      const allDocIds: Array<{id: string, filePath: string}> = [];
      orchestratorHistory.forEach((msg: any) => {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          content.forEach((block: any, i: number) => {
            if (block.type === 'tool_result' && block.metadata?.documentPreview) {
              allDocIds.push({
                id: `${msg.uuid}-doc-${i}`,
                filePath: block.metadata.documentPreview.filePath,
              });
            }
          });
        }
      });

      if (allDocIds.length === 0) {
        // No documents to toggle
        return;
      }

      // Toggle all documents: if any expanded, collapse all; otherwise expand all
      setExpandedDocuments(prev => {
        if (prev.size > 0) {
          // Collapse all
          return new Set();
        } else {
          // Expand all and lazy-load content
          const newSet = new Set(allDocIds.map(d => d.id));
          // Trigger lazy loading for all documents
          allDocIds.forEach(({id, filePath}) => {
            if (!documentContents.has(id)) {
              // Resolve the file path (it's relative, need to make absolute)
              const absolutePath = path.isAbsolute(filePath)
                ? filePath
                : path.resolve(process.cwd(), filePath);

              // Read file content asynchronously
              fs.promises.readFile(absolutePath, 'utf-8').then((content: string) => {
                setDocumentContents(prev => new Map(prev).set(id, content));
              }).catch(() => {
                setDocumentContents(prev => new Map(prev).set(id, null));
              });
            }
          });
          return newSet;
        }
      });

      addItem({
        type: MessageType.Info,
        infoContent: `Document previews: ${expandedDocuments.size > 0 ? 'collapsed' : 'expanded'}`,
      }, Date.now());
      return;
    }
  });

  // Use refs for values that change during streaming to avoid invalidating memo
  const streamingStateRef = useRef(streamingState);
  const reasoningEffortRef = useRef(reasoningEffort);
  const supportsReasoningRef = useRef(supportsReasoning);
  useEffect(() => {
    streamingStateRef.current = streamingState;
    reasoningEffortRef.current = reasoningEffort;
    supportsReasoningRef.current = supportsReasoning;
  }, [streamingState, reasoningEffort, supportsReasoning]);

  // Handle message submission - stable callback for EnhancedInput memo
  const handleSubmit = useCallback(async (text: string) => {
    // If currently streaming, queue the message for later
    if (streamingStateRef.current === StreamingState.Streaming) {
      setQueuedMessage(text);
      addItem({
        type: MessageType.Info,
        infoContent: ` Message queued: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`,
      }, Date.now());
      return;
    }

    // Pass reasoning effort for models that support it
    await submitQuery(text, {
      reasoningEffort: supportsReasoningRef.current ? reasoningEffortRef.current : undefined,
    });
  }, [submitQuery, addItem]); // Minimal dependencies for stable reference

  // Auto-send initial prompt (from --prompt flag) once initialized
  const hasSentInitialPrompt = useRef(false);
  useEffect(() => {
    if (initialPrompt && initialized && !hasSentInitialPrompt.current) {
      hasSentInitialPrompt.current = true;
      handleSubmit(initialPrompt);
    }
  }, [initialPrompt, initialized, handleSubmit]);

  // Process queued message when streaming completes
  useEffect(() => {
    if (streamingState === StreamingState.Idle && queuedMessage) {
      const message = queuedMessage;
      setQueuedMessage(null);

      addItem({
        type: MessageType.Info,
        infoContent: `▶ Sending queued message...`,
      }, Date.now());

      // Submit directly - the state is already Idle
      submitQuery(message, {
        reasoningEffort: supportsReasoning ? reasoningEffort : undefined,
      });
    }
  }, [streamingState, queuedMessage, submitQuery, supportsReasoning, reasoningEffort, addItem]);

  // Loading state - show simple spinner while initializing
  if (!initialized) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={Colors.AccentCyan}>CORTEX</Text>
        <LoadingSpinner text="Initializing..." />
        {initError && <Text color={Colors.AccentRed}>Error: {initError}</Text>}
      </Box>
    );
  }

  // Help screen - shows all commands from unified registry
  if (showHelp) {
    const allCommands = slashCommandRegistry.getAllCommands();
    const categories = slashCommandRegistry.getCategories();

    // Group commands by category
    const grouped: Record<string, typeof allCommands> = {};
    for (const cmd of allCommands) {
      if (!grouped[cmd.category]) grouped[cmd.category] = [];
      grouped[cmd.category].push(cmd);
    }

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={Colors.AccentCyan}>━━━ CORTEX Help ({allCommands.length} commands) ━━━</Text>
        <Text></Text>

        {categories.map((category) => {
          const cmds = grouped[category.name];
          if (!cmds || cmds.length === 0) return null;

          return (
            <Box key={category.name} flexDirection="column">
              <Text bold color={Colors.AccentGreen}>{category.icon} {category.label}:</Text>
              {cmds.map((cmd) => (
                <Box key={cmd.name} flexDirection="column">
                  <Text>
                    <Text color={Colors.AccentCyan}>  /{cmd.name}</Text>
                    {cmd.altName && <Text dimColor> (/{cmd.altName})</Text>}
                    <Text dimColor>  {cmd.description}</Text>
                  </Text>
                  {cmd.subcommands && cmd.subcommands.map((sub) => (
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

        <Text bold color={Colors.AccentYellow}>Keyboard Shortcuts:</Text>
        <Text>  Tab             Toggle thinking display</Text>
        <Text>  Shift+Tab       Toggle auto-approve (YOLO)</Text>
        <Text>  Ctrl+E          Expand/collapse document previews</Text>
        <Text>  ESC             Cancel streaming / Close dialogs</Text>
        <Text>  Ctrl+C          Exit</Text>
        <Text></Text>
        <Text bold color={Colors.AccentYellow}>Input Features:</Text>
        <Text>  ↑/↓             Navigate message history</Text>
        <Text>  Shift+Enter     Multi-line input (new line)</Text>
        <Text>  Enter           Submit message</Text>
        <Text>  ESC             Clear input / Cancel history</Text>
        <Text></Text>
        <Text dimColor>Press ESC to close</Text>
      </Box>
    );
  }

  if (showConfigMenu) {
    return (
      <ConfigMenu
        projectPath={projectPath || process.cwd()}
        onUpdateRuntimeConfig={client ? (updates) => client.updateRuntimeConfig(updates) : undefined}
        onClose={() => setShowConfigMenu(false)}
      />
    );
  }

  // Main UI - Using Static for history to prevent re-renders on input
  return (
    <Box flexDirection="column" width={terminalWidth}>
      {/* Compact header on first launch (full splash via /about) */}
      {history.length === 0 && streamingState === StreamingState.Idle && (
        <CompactHeader model={currentModel} cwd={projectPath || process.cwd()} />
      )}

      {/* Debug: show history count */}
      {debug && (
        <Text dimColor>[Debug: {history.length} messages in history]</Text>
      )}

      {/* Message history - Static renders completed messages */}
      {/* Note: Static only renders items once and won't re-render on state changes.
          By giving Static a key that includes both expandedDocuments.size AND documentContents.size,
          we force React to unmount and remount when:
          1. Document expansion toggles (expandedDocuments changes)
          2. Document content finishes loading (documentContents changes)
          This causes a full re-render of history, but these events are infrequent. */}
      <Static key={`history-exp-${expandedDocuments.size}-content-${documentContents.size}`} items={history}>
        {(item) => (
          <MessageDisplay
            key={item.id}
            item={item}
            terminalWidth={terminalWidth}
            showThinking={showThinking}
            expandedDocuments={expandedDocuments}
            documentContents={documentContents}
          />
        )}
      </Static>

      {/* Dynamic content area */}
      <Box flexDirection="column">

        {/* Streaming content display - renders current turn's content */}
        {streamingState === StreamingState.Streaming && (
          <StreamDisplay
            events={streamEvents}
            isStreaming={true}
            showThinking={showThinking}
            streamStartTime={streamStartTime}
          />
        )}

        {/* Sub-Agent Panel - shows parallel agent activity */}
        {subAgents.size > 0 && (
          <SubAgentPanel
            agents={subAgents}
            terminalWidth={terminalWidth}
          />
        )}

        {/* Approval Dialog */}
        {pendingApproval && (
          <ApprovalDialog
            pendingApproval={pendingApproval}
            onApprove={approve}
            onDeny={deny}
            onApproveAndYolo={approveAndEnableYolo}
          />
        )}

        {/* Theme Picker Dialog */}
        {showThemePicker && (
          <ThemePickerDialog
            themes={getThemeNames()}
            currentTheme={currentTheme}
            onSelect={(theme) => {
              if (setTheme(theme)) {
                setCurrentTheme(theme);
                const themeDef = getThemeDefinition(theme);
                addItem({
                  type: MessageType.Info,
                  infoContent: `✓ Theme set to: ${themeDef?.name || theme}`,
                }, Date.now());
              }
              setShowThemePicker(false);
            }}
            onCancel={() => setShowThemePicker(false)}
          />
        )}

        {/* Model Picker Dialog */}
        {showModelPicker && (
          <ModelPickerDialog
            models={availableModels}
            currentModelId={client?.getCurrentModel()?.id || currentModel}
            loading={modelsLoading}
            onSelect={async (selectedModelId) => {
              if (client) {
                try {
                  await client.switchModel(selectedModelId);
                  const newModel = client.getCurrentModel();
                  const modelSupportsReasoning = newModel?.reasoning?.supported === true;
                  const modelReasoningToggleable = newModel?.reasoning?.toggleable === true;

                  setCurrentModel(newModel?.name || newModel?.id || selectedModelId);
                  setSupportsReasoning(modelSupportsReasoning);
                  setReasoningToggleable(modelReasoningToggleable);

                  // Reset reasoning effort when switching models
                  if (modelSupportsReasoning && modelReasoningToggleable) {
                    setReasoningEffort(showThinking ? 'high' : 'none');
                  } else {
                    setReasoningEffort('none');
                  }

                  // Persist model choice to .cortex/config.json
                  persistModel(selectedModelId);

                  addItem({
                    type: MessageType.Info,
                    infoContent: `✓ Switched to model: ${newModel?.name || selectedModelId}${modelSupportsReasoning ? ' (supports reasoning)' : ''}\n  (saved as default)`,
                  }, Date.now());
                } catch (error: any) {
                  addItem({
                    type: MessageType.Error,
                    errorContent: `Error switching model: ${error.message}`,
                  }, Date.now());
                }
              }
              setShowModelPicker(false);
            }}
            onCancel={() => setShowModelPicker(false)}
          />
        )}

        {/* Session Picker Dialog */}
        {showSessionPicker && (
          <SessionPickerDialog
            sessions={availableSessions}
            loading={sessionsLoading}
            onSelect={async (sessionId) => {
              if (client) {
                try {
                  addItem({ type: MessageType.Info, infoContent: `Resuming session ${sessionId.slice(0, 8)}...` }, Date.now());
                  await client.resumeSession(sessionId);
                  // Refresh history to display the loaded session's messages
                  refreshOrchestratorHistory();
                  addItem({ type: MessageType.Info, infoContent: `✓ Session resumed. Continue your conversation.` }, Date.now());
                } catch (error: any) {
                  addItem({
                    type: MessageType.Error,
                    errorContent: `Error resuming session: ${error.message}`,
                  }, Date.now());
                }
              }
              setShowSessionPicker(false);
            }}
            onCancel={() => setShowSessionPicker(false)}
          />
        )}

        {/* System Message Manager Dialog */}
        {showSystemMessageManager && systemMessageStore && (
          <InteractiveMenu
            store={systemMessageStore}
            runtimeDir={systemMessageStore.getRuntimeDir()}
            builtinDir={systemMessageStore.getBuiltinDir()}
            onExit={async () => {
              setShowSystemMessageManager(false);
              // Cleanup store
              if (systemMessageStore) {
                await systemMessageStore.destroy();
                setSystemMessageStore(null);
              }
              addItem({
                type: MessageType.Info,
                infoContent: '✓ System Message Manager closed',
              }, Date.now());
            }}
          />
        )}

        {/* Mentorship Config Menu */}
        {showMentorshipConfig && mentorshipMenuDef && mentorshipService && (
          <MenuRenderer
            definition={mentorshipMenuDef}
            initialValues={mentorshipInitialValues}
            isActive={showMentorshipConfig}
            onComplete={async (result: MenuResult) => {
              setShowMentorshipConfig(false);

              if (result.action === 'save' && result.hasChanges) {
                // Map menu keys back to config keys and save
                const configKeyMap: Record<string, string> = {
                  'MENTORSHIP_ENABLED': 'enabled',
                  'MENTORSHIP_TRIGGER_ON_ERROR': 'triggerOnError',
                  'MENTORSHIP_ERROR_THRESHOLD': 'errorThreshold',
                  'MENTORSHIP_KEYWORDS_ENABLED': 'keywordsEnabled',
                  'MENTORSHIP_CUSTOM_KEYWORDS': 'customKeywords',
                  'MENTORSHIP_HELPER_MODEL': 'helperModel',
                  'MENTORSHIP_TURN_BASED_ENABLED': 'turnBasedEnabled',
                  'MENTORSHIP_TURN_INTERVAL': 'turnInterval',
                  'MENTORSHIP_INTERLEAVED_THINKING': 'interleavedThinking',
                  'MENTORSHIP_PATTERN_DETECTION': 'patternDetection',
                  'MENTORSHIP_PATTERN_THRESHOLD': 'patternThreshold',
                };

                const configChanges: Record<string, unknown> = {};
                for (const [menuKey, value] of Object.entries(result.changes)) {
                  const configKey = configKeyMap[menuKey];
                  if (configKey) {
                    configChanges[configKey] = value;
                  }
                }

                try {
                  await mentorshipService.setConfig(configChanges as any);
                  addItem({
                    type: MessageType.Info,
                    infoContent: `✓ Mentorship config saved (${Object.keys(result.changes).length} changes)`,
                  }, Date.now());
                } catch (error: any) {
                  addItem({
                    type: MessageType.Error,
                    errorContent: `Error saving config: ${error.message}`,
                  }, Date.now());
                }
              } else if (result.action === 'reset') {
                try {
                  await mentorshipService.resetToDefaults();
                  addItem({
                    type: MessageType.Info,
                    infoContent: '✓ Mentorship config reset to defaults',
                  }, Date.now());
                } catch (error: any) {
                  addItem({
                    type: MessageType.Error,
                    errorContent: `Error resetting config: ${error.message}`,
                  }, Date.now());
                }
              } else if (result.action === 'cancel') {
                addItem({
                  type: MessageType.Info,
                  infoContent: 'Mentorship config cancelled',
                }, Date.now());
              }

              // Cleanup
              setMentorshipService(null);
              setMentorshipMenuDef(null);
              setMentorshipInitialValues({});
            }}
            onLiveUpdate={async (key: string, value: unknown) => {
              // Handle live updates for toggles
              const configKeyMap: Record<string, string> = {
                'MENTORSHIP_ENABLED': 'enabled',
                'MENTORSHIP_TRIGGER_ON_ERROR': 'triggerOnError',
                'MENTORSHIP_ERROR_THRESHOLD': 'errorThreshold',
                'MENTORSHIP_KEYWORDS_ENABLED': 'keywordsEnabled',
                'MENTORSHIP_TURN_BASED_ENABLED': 'turnBasedEnabled',
                'MENTORSHIP_PATTERN_DETECTION': 'patternDetection',
                'MENTORSHIP_INTERLEAVED_THINKING': 'interleavedThinking',
              };
              const configKey = configKeyMap[key];
              if (configKey && mentorshipService) {
                await mentorshipService.setConfig({ [configKey]: value } as any);
              }
            }}
          />
        )}
      </Box>

      {/* Queued message indicator */}
      {queuedMessage && (
        <Box paddingX={1} marginBottom={1}>
          <Text color={Colors.AccentYellow}>
             Queued: "{queuedMessage.slice(0, 60)}{queuedMessage.length > 60 ? '...' : ''}"
          </Text>
          <Text dimColor> (will send when ready)</Text>
        </Box>
      )}

      {/* Turn summary (shown after streaming completes) */}
      {turnSummary && streamingState === StreamingState.Idle && (
        <Box paddingX={1}>
          <Text dimColor>[Summary] {turnSummary}</Text>
        </Box>
      )}

      {/* Input - enabled during streaming to allow message queuing */}
      <EnhancedInput
        onSubmit={handleSubmit}
        disabled={!!pendingApproval || showThemePicker || showModelPicker || showSessionPicker || showSystemMessageManager}
        placeholder={streamingState === StreamingState.Streaming ? "Type next message (will queue)..." : undefined}
        userMessages={userMessages}
        prefillValue={streamingState === StreamingState.Idle ? nextActionPrediction : null}
      />

      {/* Status Line - replaces header and footer, shows all status info */}
      <StatusLine
        model={currentModel}
        autoApprove={autoApprove}
        showThinking={showThinking}
        reasoningEffort={reasoningEffort}
        supportsReasoning={supportsReasoning}
      />
    </Box>
  );
};

export default CortexApp;
