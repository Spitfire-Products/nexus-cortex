#!/usr/bin/env node
/**
 * Cortex - Ink-based Terminal UI for Nexus Cortex
 *
 * A modern, React-based terminal interface with:
 * - Multi-line input that grows
 * - Status bar showing current state
 * - Streaming response display
 * - Mouse support (future)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, Static, useApp, useInput } from 'ink';
import { OrchestratorClient } from '@nexus-cortex/cli/dist/orchestrator/OrchestratorClient.js';
import { ChatInput } from './ui/components/ChatInput.js';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

// Types
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface AppState {
  messages: Message[];
  streaming: boolean;
  streamingContent: string;
  autoApprove: boolean;
  showThinking: boolean;
  debug: boolean;
  model: string;
  error: string | null;
}

// Get theme
const theme = ThemeManager.getExtendedTheme();

// Header component
const Header: React.FC<{ model: string }> = ({ model }) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text>{theme.dimmed('─'.repeat(60))}</Text>
    <Text>
      {theme.colors.primary(' Cortex')}
      {theme.dimmed(' │ ')}
      {theme.colors.highlight(model)}
    </Text>
    <Text>{theme.dimmed('─'.repeat(60))}</Text>
    <Text>{theme.dimmed(' Tab: thinking │ Shift+Tab: auto-approve │ /help │ ESC: abort')}</Text>
    <Text>{theme.dimmed('─'.repeat(60))}</Text>
  </Box>
);

// Message component
const MessageItem: React.FC<{ message: Message }> = ({ message }) => {
  const isUser = message.role === 'user';
  const prefix = isUser ? theme.colors.info('> ') : theme.colors.success('◆ ');

  return (
    <Box flexDirection="column" marginY={0}>
      <Text>
        {prefix}
        {isUser ? theme.text(message.content) : message.content}
      </Text>
    </Box>
  );
};

// Streaming content component
const StreamingContent: React.FC<{ content: string }> = ({ content }) => {
  if (!content) return null;

  return (
    <Box flexDirection="column">
      <Text>{theme.colors.success('◆ ')}{content}</Text>
      <Text>{theme.colors.info('●')} {theme.dimmed('streaming...')}</Text>
    </Box>
  );
};

// Error display
const ErrorDisplay: React.FC<{ error: string }> = ({ error }) => (
  <Box marginY={1}>
    <Text>{theme.colors.error('✗ Error: ')}{error}</Text>
  </Box>
);

// Main App
const CortexApp: React.FC = () => {
  const { exit } = useApp();

  const [state, setState] = useState<AppState>({
    messages: [],
    streaming: false,
    streamingContent: '',
    autoApprove: false,
    showThinking: false,
    debug: process.env.DEBUG === 'true',
    model: process.env.DEFAULT_MODEL_ID || 'default',
    error: null,
  });

  const [client, setClient] = useState<OrchestratorClient | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Initialize client
  useEffect(() => {
    const init = async () => {
      try {
        const mode = (process.env.CORTEX_MODE || process.env.OMNICLAUDE_MODE) || 'direct';
        const serverUrl = (process.env.CORTEX_SERVER_URL || process.env.OMNICLAUDE_SERVER_URL);

        const orchestratorClient = new OrchestratorClient({
          mode: mode as 'direct' | 'server',
          serverUrl,
          defaultModelId: state.model,
          projectPath: process.cwd(),
          debug: state.debug,
        });

        await orchestratorClient.initialize();
        setClient(orchestratorClient);
        setInitialized(true);
      } catch (err) {
        setState(s => ({
          ...s,
          error: err instanceof Error ? err.message : 'Failed to initialize',
        }));
      }
    };

    init();
  }, []);

  // Handle keyboard shortcuts
  useInput((input, key) => {
    // Tab - toggle thinking
    if (key.tab && !key.shift) {
      setState(s => ({ ...s, showThinking: !s.showThinking }));
      return;
    }

    // Shift+Tab - toggle auto-approve
    if (key.tab && key.shift) {
      setState(s => ({ ...s, autoApprove: !s.autoApprove }));
      return;
    }

    // Escape - abort streaming (future: implement abort)
    if (key.escape && state.streaming) {
      // TODO: Implement abort
      return;
    }

    // Ctrl+C - exit
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }
  });

  // Use ref for streaming state to avoid stale closure
  const streamingRef = React.useRef(state.streaming);
  streamingRef.current = state.streaming;

  // Handle message submission
  const handleSubmit = useCallback(async (text: string) => {
    if (!client || streamingRef.current) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      const cmd = trimmed.slice(1).toLowerCase();

      if (cmd === 'exit' || cmd === 'quit' || cmd === 'q') {
        exit();
        return;
      }

      if (cmd === 'clear') {
        setState(s => ({ ...s, messages: [], error: null }));
        return;
      }

      if (cmd === 'help') {
        setState(s => ({
          ...s,
          messages: [
            ...s.messages,
            {
              id: `help-${Date.now()}`,
              role: 'system',
              content: `Commands:
  /help    - Show this help
  /clear   - Clear messages
  /exit    - Exit Cortex
  /model   - Show current model
  /yolo    - Toggle auto-approve
  /debug   - Toggle debug logging

Shortcuts:
  Tab        - Toggle thinking display
  Shift+Tab  - Toggle auto-approve
  Ctrl+C     - Exit`,
              timestamp: new Date(),
            },
          ],
        }));
        return;
      }

      if (cmd === 'model') {
        setState(s => ({
          ...s,
          messages: [
            ...s.messages,
            {
              id: `model-${Date.now()}`,
              role: 'system',
              content: `Current model: ${s.model}`,
              timestamp: new Date(),
            },
          ],
        }));
        return;
      }

      if (cmd === 'yolo') {
        setState(s => ({
          ...s,
          autoApprove: !s.autoApprove,
          messages: [
            ...s.messages,
            {
              id: `yolo-${Date.now()}`,
              role: 'system',
              content: `Auto-approve: ${!s.autoApprove ? 'ON' : 'OFF'}`,
              timestamp: new Date(),
            },
          ],
        }));
        return;
      }

      if (cmd === 'debug') {
        setState(s => ({
          ...s,
          debug: !s.debug,
          messages: [
            ...s.messages,
            {
              id: `debug-${Date.now()}`,
              role: 'system',
              content: `Debug: ${!s.debug ? 'ON' : 'OFF'}`,
              timestamp: new Date(),
            },
          ],
        }));
        return;
      }

      // Unknown command
      setState(s => ({
        ...s,
        error: `Unknown command: ${cmd}`,
      }));
      return;
    }

    // Add user message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    setState(s => ({
      ...s,
      messages: [...s.messages, userMessage],
      streaming: true,
      streamingContent: '',
      error: null,
    }));

    try {
      // Send message and collect response using streaming
      let fullResponse = '';
      let currentToolInfo = '';

      // Use the async generator streamMessage API
      for await (const chunk of client.streamMessage(trimmed, {})) {
        // Debug: log all chunk types
        if (state.debug) {
          console.log('[Cortex] Chunk:', chunk.type, 'delta:', chunk.delta?.substring(0, 50) || '(none)');
        }

        // Handle text deltas (main content type)
        if (chunk.type === 'text_delta' && chunk.delta) {
          fullResponse += chunk.delta;
          setState(s => ({
            ...s,
            streamingContent: fullResponse + currentToolInfo,
          }));
        }
        // Handle thinking deltas (Gemini, Claude extended thinking)
        else if (chunk.type === 'thinking_delta' && chunk.delta && state.showThinking) {
          // Show thinking with a prefix
          fullResponse += chunk.delta;
          setState(s => ({
            ...s,
            streamingContent: fullResponse + currentToolInfo,
          }));
        }
        // Handle content_block_delta with reasoning flag (Claude/Grok native thinking)
        else if (chunk.type === 'content_block_delta') {
          const data = chunk.data as any;
          if (data?.reasoning === true && state.showThinking && chunk.delta) {
            fullResponse += chunk.delta;
            setState(s => ({
              ...s,
              streamingContent: fullResponse + currentToolInfo,
            }));
          } else if (!data?.reasoning && chunk.delta) {
            // Regular content block delta
            fullResponse += chunk.delta;
            setState(s => ({
              ...s,
              streamingContent: fullResponse + currentToolInfo,
            }));
          }
        }
        // Handle tool use blocks
        else if (chunk.type === 'tool_use_complete') {
          const toolData = chunk.data as any;
          const toolName = toolData?.name || 'tool';
          currentToolInfo = `\n Using: ${toolName}...`;
          setState(s => ({
            ...s,
            streamingContent: fullResponse + currentToolInfo,
          }));
        }
        // Handle tool results
        else if (chunk.type === 'tool_result') {
          const resultData = chunk.data as any;
          const isError = resultData?.is_error;
          currentToolInfo = isError ? '\n[ERROR] Tool error' : '\n✓ Tool completed';
          setState(s => ({
            ...s,
            streamingContent: fullResponse + currentToolInfo,
          }));
          // Clear tool info after a moment (it will be replaced by next text)
          currentToolInfo = '';
        }
      }

      // Add assistant message (without tool info)
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date(),
      };

      setState(s => ({
        ...s,
        messages: [...s.messages, assistantMessage],
        streaming: false,
        streamingContent: '',
      }));
    } catch (err) {
      setState(s => ({
        ...s,
        streaming: false,
        streamingContent: '',
        error: err instanceof Error ? err.message : 'Request failed',
      }));
    }
  }, [client, exit]);

  // Loading state
  if (!initialized) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header model={state.model} />
        <Text>{theme.colors.info('●')} {theme.dimmed('Initializing...')}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Header model={state.model} />

      {/* Message history (static - won't re-render) */}
      <Static items={state.messages}>
        {(message) => <MessageItem key={message.id} message={message} />}
      </Static>

      {/* Streaming content */}
      {state.streaming && <StreamingContent content={state.streamingContent} />}

      {/* Error display */}
      {state.error && <ErrorDisplay error={state.error} />}

      {/* Input area */}
      <Box marginTop={1}>
        <ChatInput
          onSubmit={handleSubmit}
          model={state.model}
          autoApprove={state.autoApprove}
          showThinking={state.showThinking}
          debug={state.debug}
          streaming={state.streaming}
          focus={!state.streaming}
          theme={{
            primary: theme.colors.primary,
            dimmed: theme.dimmed,
            success: theme.colors.success,
            warning: theme.colors.warning,
            info: theme.colors.info,
          }}
        />
      </Box>
    </Box>
  );
};

// Render the app
render(<CortexApp />);
