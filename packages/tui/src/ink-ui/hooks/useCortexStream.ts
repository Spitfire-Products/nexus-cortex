/**
 * useCortexStream - Bridge between Nexus Cortex core and Gemini CLI UI
 *
 * This hook provides the same interface as useGeminiStream but wires to our
 * @nexus-cortex/core orchestrator instead of Google's Gemini client.
 *
 * Key responsibilities:
 * 1. Convert OrchestratorClient.streamMessage() chunks to UI history items
 * 2. Handle tool call scheduling and confirmation flow
 * 3. Manage streaming state for UI components
 * 4. Support slash commands and shell mode
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import type { OrchestratorClient } from '@nexus-cortex/cli/dist/orchestrator/OrchestratorClient.js';
import type {
  HistoryItem,
  HistoryItemWithoutId,
  SlashCommandProcessorResult,
  IndividualToolCallDisplay,
  StreamEvent,
} from '../cortex-types.js';
import { StreamingState, MessageType, StreamEventType, ToolCallStatus } from '../cortex-types.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';

// Types for our streaming chunks (from @nexus-cortex/core)
interface StreamChunk {
  type: 'text_delta' | 'thinking_delta' | 'content_block_delta' |
        'content_block_start' | 'content_block_stop' |
        'tool_use_complete' | 'tool_result' |
        'message_start' | 'message_delta' | 'message_stop' |
        'thinking' | 'thinking_start' | 'thinking_stop' |
        'turn_summary';
  delta?: string;
  data?: any;
  snapshot?: string;
  // For thinking chunks
  thinking?: string;
  isComplete?: boolean;
  // For tool_use_complete chunks
  toolUse?: {
    id: string;
    name: string;
    input: Record<string, any>;
  };
  // For tool_result chunks
  toolResult?: {
    tool_use_id: string;
    tool_name: string;
    content: string;
    is_error?: boolean;
    metadata?: any;
  };
}

// Thought summary for thinking display
export interface ThoughtSummary {
  text: string;
  isComplete: boolean;
  // Track multiple thinking blocks for interleaving
  blocks: ThinkingBlock[];
}

// Individual thinking block
export interface ThinkingBlock {
  id: string;
  text: string;
  isComplete: boolean;
  startedAt: number;
  completedAt?: number;
}

// Loop detection confirmation request
interface LoopDetectionConfirmationRequest {
  toolName: string;
  callCount: number;
  onConfirm: (proceed: boolean) => void;
}

// Simplified config interface for what we need
interface CortexConfig {
  debug?: boolean;
  projectPath?: string;
  autoApprove?: boolean;
}

// Simplified settings interface
interface CortexSettings {
  showThinking?: boolean;
  showCitations?: boolean;
}

/**
 * Main streaming hook - bridges Cortex core to Gemini UI
 */
export const useCortexStream = (
  orchestratorClient: OrchestratorClient | null,
  _history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  _config: CortexConfig,
  settings: CortexSettings,
  onDebugMessage: (message: string) => void,
  handleSlashCommand: (
    cmd: string,
  ) => Promise<SlashCommandProcessorResult | false>,
  _shellModeActive: boolean,
  onCancelSubmit: (shouldRestorePrompt?: boolean) => void,
  _terminalWidth: number,
  _terminalHeight: number,
  refreshHistory?: () => void,
) => {
  // State
  const [streamingState, setStreamingState] = useState<StreamingState>(StreamingState.Idle);
  const [initError, setInitError] = useState<string | null>(null);
  const [thought, setThought] = useState<ThoughtSummary | null>(null);
  const [_pendingHistoryItem, setPendingHistoryItem] = useState<HistoryItemWithoutId | null>(null);
  const pendingHistoryItemRef = useRef<HistoryItemWithoutId | null>(null);
  const [loopDetectionConfirmationRequest, _setLoopDetectionConfirmationRequest] =
    useState<LoopDetectionConfirmationRequest | null>(null);
  const [activePtyId, _setActivePtyId] = useState<string | null>(null);
  const [lastShellOutputTime, _setLastShellOutputTime] = useState<number>(0);

  // Track current thinking block ID for interleaving
  const currentThinkingBlockIdRef = useRef<string | null>(null);

  // Keep ref in sync with state
  const updatePendingHistoryItem = useCallback((item: HistoryItemWithoutId | null) => {
    pendingHistoryItemRef.current = item;
    setPendingHistoryItem(item);
  }, []);

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const turnCancelledRef = useRef(false);
  const activeQueryIdRef = useRef<string | null>(null);

  // Simplified tool tracking (full scheduler will be integrated later)
  const [toolCalls, setToolCalls] = useState<IndividualToolCallDisplay[]>([]);
  const [toolInputArgs, setToolInputArgs] = useState<Map<string, Record<string, any>>>(new Map());
  const [lastToolOutputTime, _setLastToolOutputTime] = useState<number>(0);

  // Turn summary & next-action prediction (set at end of turn when TURN_SUMMARY_PREDICTION=true)
  const [turnSummary, setTurnSummary] = useState<string | null>(null);
  const [nextActionPrediction, setNextActionPrediction] = useState<string | null>(null);

  // Turn usage data from orchestrator (set on message_stop)
  const [turnUsage, setTurnUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);

  // Stream start timestamp for elapsed timer
  const [streamStartTime, setStreamStartTime] = useState<number>(0);

  // Stream events for interleaved display - tracks all content in order
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const streamEventsRef = useRef<StreamEvent[]>([]);

  // Helper to add a stream event
  const addStreamEvent = useCallback((event: Omit<StreamEvent, 'id' | 'timestamp'>) => {
    const newEvent: StreamEvent = {
      ...event,
      id: `event-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: Date.now(),
    };
    streamEventsRef.current = [...streamEventsRef.current, newEvent];
    setStreamEvents(streamEventsRef.current);
    return newEvent.id;
  }, []);

  // Helper to update an existing stream event
  const updateStreamEvent = useCallback((eventId: string, updates: Partial<StreamEvent>) => {
    streamEventsRef.current = streamEventsRef.current.map(e =>
      e.id === eventId ? { ...e, ...updates } : e
    );
    setStreamEvents(streamEventsRef.current);
  }, []);

  const cancelAllToolCalls = useCallback(() => {
    setToolCalls([]);
    setToolInputArgs(new Map());
    setStreamEvents([]);
    streamEventsRef.current = [];
  }, []);

  /**
   * Cancel ongoing request
   */
  const cancelOngoingRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      turnCancelledRef.current = true;
    }
    cancelAllToolCalls();
    setStreamingState(StreamingState.Idle);
    onCancelSubmit(true);
  }, [cancelAllToolCalls, onCancelSubmit]);

  /**
   * Handle approval mode changes (auto-approve whitelist + graylist)
   * Note: This is NOT YOLO mode - blacklist actions still require manual approval
   */
  const handleApprovalModeChange = useCallback((autoApprove: boolean) => {
    if (orchestratorClient) {
      // Update orchestrator approval mode (graylist will be auto-approved)
      orchestratorClient.setApprovalMode(autoApprove);
    }
    onDebugMessage(`Auto-approve mode: ${autoApprove ? 'ON' : 'OFF'}`);
  }, [orchestratorClient, onDebugMessage]);

  /**
   * Helper to update thinking state with proper block tracking
   */
  const updateThinkingState = useCallback((
    thinkingText: string,
    isComplete: boolean,
    accumulatedThinkingBlocks: { current: ThinkingBlock[] },
  ) => {
    if (!settings.showThinking) return;

    // Get or create current block ID
    if (!currentThinkingBlockIdRef.current) {
      currentThinkingBlockIdRef.current = `thinking-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    }
    const blockId = currentThinkingBlockIdRef.current;

    // Find or create block
    let blockIndex = accumulatedThinkingBlocks.current.findIndex(b => b.id === blockId);
    if (blockIndex === -1) {
      accumulatedThinkingBlocks.current.push({
        id: blockId,
        text: '',
        isComplete: false,
        startedAt: Date.now(),
      });
      blockIndex = accumulatedThinkingBlocks.current.length - 1;
    }

    // Update block
    const block = accumulatedThinkingBlocks.current[blockIndex];
    if (block) {
      block.text = thinkingText;
      block.isComplete = isComplete;
      if (isComplete) {
        block.completedAt = Date.now();
        // Reset for next thinking block
        currentThinkingBlockIdRef.current = null;
      }
    }

    // Update thought state
    setThought({
      text: thinkingText,
      isComplete,
      blocks: [...accumulatedThinkingBlocks.current],
    });
  }, [settings.showThinking]);

  /**
   * Process streaming chunk and update UI state
   *
   * SIMPLE APPROACH: Just store chunks as stream events in order.
   * The core library provides chunks in the correct interleaved order.
   * We just need to render them.
   */
  const processStreamChunk = useCallback((
    chunk: StreamChunk,
    accumulatedText: { current: string },
    accumulatedThinking: { current: string },
    accumulatedThinkingBlocks: { current: ThinkingBlock[] },
  ) => {
    // Debug: log all chunk types to understand what's coming through
    onDebugMessage(`Chunk: ${chunk.type}${chunk.delta ? ` (delta: ${chunk.delta.slice(0, 30)}...)` : ''}${chunk.thinking ? ' (has thinking)' : ''}${chunk.toolUse ? ` (tool: ${chunk.toolUse.name})` : ''}`);

    switch (chunk.type) {
      case 'text_delta':
        if (chunk.delta) {
          accumulatedText.current += chunk.delta;

          // Add text chunk as stream event - core provides these in correct order
          addStreamEvent({
            type: StreamEventType.Text,
            text: chunk.delta,
          });

          // Also update pending history item for overall text
          updatePendingHistoryItem({
            type: MessageType.Model,
            modelContent: accumulatedText.current,
            thought: accumulatedThinking.current || undefined,
          });
        }
        break;

      case 'thinking_delta':
        if (chunk.delta) {
          accumulatedThinking.current += chunk.delta;
          updateThinkingState(accumulatedThinking.current, false, accumulatedThinkingBlocks);
        }
        break;

      case 'thinking':
        // Direct thinking chunk (some providers send full thinking at once)
        if (chunk.thinking) {
          accumulatedThinking.current = chunk.thinking;
          updateThinkingState(accumulatedThinking.current, chunk.isComplete || false, accumulatedThinkingBlocks);
        }
        break;

      case 'thinking_start':
        // New thinking block started - already handled by updateThinkingState creating new block
        onDebugMessage('Thinking block started');
        break;

      case 'thinking_stop':
        // Current thinking block completed
        if (accumulatedThinking.current) {
          updateThinkingState(accumulatedThinking.current, true, accumulatedThinkingBlocks);
          // Reset for next thinking block
          accumulatedThinking.current = '';
        }
        break;

      case 'content_block_delta':
        const data = chunk.data as any;
        const deltaType = data?.delta?.type || chunk.data?.type;

        // Check for input_json_delta (tool input streaming) - IGNORE these
        // They are already handled by content_block_start with full input
        if (deltaType === 'input_json_delta') {
          // Tool input JSON delta - skip, don't add to text
          break;
        }

        if (data?.reasoning && chunk.delta) {
          // Interleaved thinking (Grok, Claude) or OpenAI reasoning tokens
          // ALWAYS show interleaved thinking - it's part of the model's natural output
          // The Tab toggle only controls front/rear-loaded extended thinking (Claude <thinking> tags)
          accumulatedThinking.current += chunk.delta;

          // Always add to stream events - interleaved thinking should always be visible
          addStreamEvent({
            type: StreamEventType.Thinking,
            thinking: chunk.delta,
            thinkingComplete: false,
          });

          // Also update thinking state (for the separate thinking indicator if enabled)
          updateThinkingState(accumulatedThinking.current, false, accumulatedThinkingBlocks);
        } else if (!data?.reasoning && chunk.delta) {
          // Regular text - add as text event
          accumulatedText.current += chunk.delta;
          addStreamEvent({
            type: StreamEventType.Text,
            text: chunk.delta,
          });
          updatePendingHistoryItem({
            type: MessageType.Model,
            modelContent: accumulatedText.current,
            thought: accumulatedThinking.current || undefined,
          });
        }
        break;

      case 'content_block_start':
        // Check block type from chunk.data or chunk.content_block
        const startData = chunk.data as any;
        const contentBlock = startData?.content_block || startData;

        if (contentBlock?.type === 'thinking') {
          onDebugMessage('Thinking content block started');
        }
        // Note: tool_use blocks are handled by tool_use_complete event
        break;

      case 'content_block_stop':
        // Check if this is a thinking block end
        const stopData = chunk.data as any;
        if (stopData?.type === 'thinking' && accumulatedThinking.current) {
          updateThinkingState(accumulatedThinking.current, true, accumulatedThinkingBlocks);
          // Reset for next thinking block
          accumulatedThinking.current = '';
        }
        break;

      case 'tool_use_complete':
        // Tool call completed - add to stream events AND history
        // Core library provides this in correct order relative to text
        if (chunk.toolUse) {
          const toolUse = chunk.toolUse;
          onDebugMessage(`Tool use: ${toolUse.name}`);
          // Debug: Log input keys to understand what data we have
          if (toolUse.input) {
            onDebugMessage(`Tool input keys: ${Object.keys(toolUse.input).join(', ')}`);
            if (toolUse.name === 'Edit') {
              onDebugMessage(`Edit tool has old_string: ${toolUse.input.old_string !== undefined}, new_string: ${toolUse.input.new_string !== undefined}`);
            }
          } else {
            onDebugMessage(`Tool input is undefined`);
          }
          const callId = toolUse.id || `tool-${Date.now()}`;

          // Create tool call display entry
          const newToolCall: IndividualToolCallDisplay = {
            callId,
            name: toolUse.name,
            description: '',
            status: ToolCallStatus.Executing,
            resultDisplay: undefined,
            confirmationDetails: undefined,
          };

          setToolCalls(prev => [...prev, newToolCall]);

          // Store input args for tool display
          if (toolUse.input) {
            setToolInputArgs(prev => {
              const newMap = new Map(prev);
              newMap.set(callId, toolUse.input);
              return newMap;
            });
          }

          // Add stream event for interleaved display during streaming
          addStreamEvent({
            type: StreamEventType.ToolCall,
            toolCall: newToolCall,
            toolInputArgs: toolUse.input,
          });
        }
        break;

      case 'tool_result':
        // Tool completed - toolResult field contains the result data
        if (chunk.toolResult) {
          const toolResult = chunk.toolResult;
          onDebugMessage(`Tool result for ${toolResult.tool_name}: ${toolResult.is_error ? 'error' : 'success'}`);

          // Update tool call with result
          const resultCallId = toolResult.tool_use_id;
          if (resultCallId) {
            // Build result display with metadata (includes diff for Edit tool)
            const resultDisplay: any = {
              output: typeof toolResult.content === 'string'
                ? toolResult.content
                : JSON.stringify(toolResult.content),
              isError: toolResult.is_error,
              error: toolResult.is_error ? toolResult.content : undefined,
              // IMPORTANT: Pass through metadata which contains diff, fileStats, etc.
              metadata: toolResult.metadata,
            };

            // Debug: log if we have diff data for Edit tool
            if (toolResult.tool_name === 'Edit' && toolResult.metadata?.diff) {
              onDebugMessage(`Edit tool has diff metadata (${toolResult.metadata.diff.length} chars)`);
              // Diff is shown inline by StreamDisplay during streaming
              // History refresh at end syncs from orchestrator
            }

            setToolCalls(prev => prev.map(tc => {
              if (tc.callId === resultCallId) {
                return {
                  ...tc,
                  status: toolResult.is_error ? ToolCallStatus.Error : ToolCallStatus.Success,
                  resultDisplay,
                };
              }
              return tc;
            }));

            // Update corresponding stream event with result
            const eventToUpdate = streamEventsRef.current.find(
              e => e.type === StreamEventType.ToolCall && e.toolCall?.callId === resultCallId
            );
            if (eventToUpdate) {
              updateStreamEvent(eventToUpdate.id, {
                toolCall: {
                  ...eventToUpdate.toolCall!,
                  status: toolResult.is_error ? ToolCallStatus.Error : ToolCallStatus.Success,
                  resultDisplay,
                },
              });
            }
          }
        }
        break;

      case 'turn_summary':
        if (chunk.data) {
          const { summary, prediction } = chunk.data;
          if (summary) setTurnSummary(summary);
          if (prediction) setNextActionPrediction(prediction);
          onDebugMessage(`Turn summary: ${summary || '(none)'} | Prediction: ${prediction || '(none)'}`);
        }
        break;

      case 'message_stop':
        // Stream complete - finalize any open thinking block
        if (accumulatedThinking.current && !thought?.isComplete) {
          updateThinkingState(accumulatedThinking.current, true, accumulatedThinkingBlocks);
        }
        // Capture usage data from orchestrator for turn summary display
        if (chunk.data?.usage) {
          setTurnUsage(chunk.data.usage);
        }
        break;
    }
  }, [updatePendingHistoryItem, onDebugMessage, updateThinkingState, thought?.isComplete, addStreamEvent, updateStreamEvent]);

  /**
   * Submit a query to the orchestrator
   */
  const submitQuery = useCallback(async (
    userInput: string,
    options: { model?: string; reasoningEffort?: 'none' | 'low' | 'medium' | 'high' } = {},
  ) => {
    if (!orchestratorClient) {
      setInitError('Orchestrator not initialized');
      return;
    }

    if (streamingState !== StreamingState.Idle) {
      onDebugMessage('Cannot submit while streaming');
      return;
    }

    const trimmedInput = userInput.trim();
    if (!trimmedInput) return;

    // Check for slash commands
    let effectiveInput = trimmedInput;
    if (trimmedInput.startsWith('/')) {
      const result = await handleSlashCommand(trimmedInput);
      if (result !== false) {
        if (result && result.type === 'submit_prompt' && typeof result.content === 'string') {
          effectiveInput = result.content;
        } else {
          return;
        }
      }
    }

    // Generate query ID for tracking
    const queryId = `query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    activeQueryIdRef.current = queryId;

    // Before starting new query, save any pending response to history
    // This handles the case where previous response had tool calls and text was kept pending
    if (pendingHistoryItemRef.current) {
      const pending = pendingHistoryItemRef.current as any;
      if (pending.modelContent) {
        addItem({
          type: MessageType.Model,
          modelContent: pending.modelContent,
          thought: pending.thought,
        }, Date.now());
      }
    }

    // Start streaming - clear all pending state
    setStreamingState(StreamingState.Streaming);
    setStreamStartTime(Date.now());
    updatePendingHistoryItem(null);
    setThought(null);
    setToolCalls([]);
    setToolInputArgs(new Map());
    setStreamEvents([]);
    streamEventsRef.current = [];
    setTurnSummary(null);
    setNextActionPrediction(null);
    setTurnUsage(null);
    turnCancelledRef.current = false;
    abortControllerRef.current = new AbortController();
    currentThinkingBlockIdRef.current = null;

    // Accumulators for streaming content
    const accumulatedText = { current: '' };
    const accumulatedThinking = { current: '' };
    const accumulatedThinkingBlocks = { current: [] as ThinkingBlock[] };

    try {
      // Add user message to stream events FIRST (before any model response)
      // This shows the user's input immediately without refreshing history
      addStreamEvent({
        type: StreamEventType.UserMessage,
        userMessage: effectiveInput,
      });

      // Stream message through orchestrator
      const stream = orchestratorClient.streamMessage(effectiveInput, {
        model: options.model,
        reasoningEffort: options.reasoningEffort,
      });

      // Process chunks through React state (pure Ink rendering, no stdout)
      // NOTE: We do NOT refresh history during streaming to avoid scroll reset
      // The user message is shown via StreamDisplay's accumulated content
      // History is refreshed ONLY after streaming completes
      for await (const chunk of stream) {
        // Check for abort
        if (abortControllerRef.current?.signal.aborted || turnCancelledRef.current) {
          onDebugMessage('Stream aborted by user');
          break;
        }

        // Check if this is still the active query
        if (activeQueryIdRef.current !== queryId) {
          onDebugMessage('Query superseded by newer query');
          break;
        }

        // Process chunk through React state - updates streamEvents for Ink rendering
        processStreamChunk(chunk, accumulatedText, accumulatedThinking, accumulatedThinkingBlocks);
      }

      // Refresh UI from orchestrator's canonical history
      // The orchestrator already has the complete message with all content blocks
      // Just trigger a refresh - orchestrator is the single source of truth
      if (refreshHistory) {
        refreshHistory();
        onDebugMessage(`History refreshed from orchestrator`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      onDebugMessage(`Stream error: ${errorMessage}`);

      // Add error message to history
      addItem({
        type: MessageType.Error,
        errorContent: errorMessage,
      }, Date.now());

    } finally {
      // Clean up
      setStreamingState(StreamingState.Idle);
      updatePendingHistoryItem(null);
      abortControllerRef.current = null;
      activeQueryIdRef.current = null;
    }
  }, [
    orchestratorClient,
    streamingState,
    handleSlashCommand,
    addItem,
    processStreamChunk,
    onDebugMessage,
    updatePendingHistoryItem,
  ]);

  // Compute pending history items for UI
  const pendingHistoryItems = useMemo(() => {
    const items: HistoryItemWithoutId[] = [];
    if (pendingHistoryItemRef.current) {
      items.push(pendingHistoryItemRef.current);
    }
    return items;
  }, [pendingHistoryItemRef.current]);

  // Compute last output time
  const lastOutputTime = Math.max(lastToolOutputTime, lastShellOutputTime);

  return {
    streamingState,
    submitQuery,
    initError,
    pendingHistoryItems,
    thought,
    cancelOngoingRequest,
    pendingToolCalls: toolCalls,
    pendingToolInputArgs: toolInputArgs,
    handleApprovalModeChange,
    activePtyId,
    loopDetectionConfirmationRequest,
    lastOutputTime,
    // New: interleaved stream events for display
    streamEvents,
    // Turn summary & prediction (post-turn helper model output)
    turnSummary,
    nextActionPrediction,
    // Turn usage from orchestrator (set on message_stop)
    turnUsage,
    // Streaming timer
    streamStartTime,
  };
};

export type UseCortexStreamReturn = ReturnType<typeof useCortexStream>;
