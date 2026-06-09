/**
 * Nexus Cortex - UI Types
 *
 * Standalone types for the Ink UI that don't depend on @google/gemini-cli-core.
 * These mirror the Gemini CLI types but are self-contained.
 */

/**
 * Streaming state for the UI
 */
export enum StreamingState {
  Idle = 'idle',
  Streaming = 'streaming',
  WaitingForConfirmation = 'waiting_for_confirmation',
}

/**
 * Tool call status
 */
export enum ToolCallStatus {
  Pending = 'Pending',
  Canceled = 'Canceled',
  Confirming = 'Confirming',
  Executing = 'Executing',
  Success = 'Success',
  Error = 'Error',
}

/**
 * Message types for history items
 */
export enum MessageType {
  User = 'user',
  Model = 'model',
  Info = 'info',
  Error = 'error',
  Warning = 'warning',
  ToolGroup = 'tool_group',
}

/**
 * Thought summary for thinking display
 */
export interface ThoughtSummary {
  text: string;
  isComplete: boolean;
}

/**
 * User content can be a string or structured
 */
export interface UserContent {
  text: string;
  images?: string[];
}

/**
 * Individual tool call display
 */
export interface IndividualToolCallDisplay {
  callId: string;
  name: string;
  description: string;
  resultDisplay?: ToolResultDisplay;
  status: ToolCallStatus;
  confirmationDetails?: ToolCallConfirmationDetails;
  renderOutputAsMarkdown?: boolean;
  ptyId?: number;
  outputFile?: string;
}

/**
 * Tool result display
 */
export interface ToolResultDisplay {
  output?: string;
  error?: string;
  isError?: boolean;
  /** Metadata from tool execution (contains diff for Edit tool, fileStats, etc.) */
  metadata?: {
    /** Unified diff string from Edit tool */
    diff?: string;
    /** File statistics from Edit/Write tools */
    fileStats?: {
      path?: string;
      occurrences?: number;
      operation?: string;
      size?: number;
      lines?: number;
    };
    /** Execution time in ms */
    executionTime?: number;
    /** Any other metadata */
    [key: string]: any;
  };
}

/**
 * Tool call confirmation details
 */
export interface ToolCallConfirmationDetails {
  requiresConfirmation: boolean;
  reason?: string;
}

/**
 * Base history item interface
 */
export interface HistoryItemBase {
  id: string;
  timestamp: number;
}

/**
 * User message history item
 */
export interface HistoryItemUser extends HistoryItemBase {
  type: MessageType.User;
  userContent: UserContent | string;
}

/**
 * Model response history item
 */
export interface HistoryItemModel extends HistoryItemBase {
  type: MessageType.Model;
  modelContent: string;
  thought?: string;
}

/**
 * Info message history item
 */
export interface HistoryItemInfo extends HistoryItemBase {
  type: MessageType.Info;
  infoContent: string;
}

/**
 * Error message history item
 */
export interface HistoryItemError extends HistoryItemBase {
  type: MessageType.Error;
  errorContent: string;
}

/**
 * Warning message history item
 */
export interface HistoryItemWarning extends HistoryItemBase {
  type: MessageType.Warning;
  warningContent: string;
}

/**
 * Tool group history item
 */
export interface HistoryItemToolGroup extends HistoryItemBase {
  type: MessageType.ToolGroup;
  tools: IndividualToolCallDisplay[];
}

/**
 * Orchestrator message history item (from core library)
 */
export interface HistoryItemOrchestrator extends HistoryItemBase {
  type: 'orchestrator';
  message: any; // Raw orchestrator message from core library
}

/**
 * Union type for all history items
 */
export type HistoryItem =
  | HistoryItemUser
  | HistoryItemModel
  | HistoryItemInfo
  | HistoryItemError
  | HistoryItemWarning
  | HistoryItemToolGroup
  | HistoryItemOrchestrator;

/**
 * History item without ID (for creation)
 */
export type HistoryItemWithoutId =
  | Omit<HistoryItemUser, 'id' | 'timestamp'>
  | Omit<HistoryItemModel, 'id' | 'timestamp'>
  | Omit<HistoryItemInfo, 'id' | 'timestamp'>
  | Omit<HistoryItemError, 'id' | 'timestamp'>
  | Omit<HistoryItemWarning, 'id' | 'timestamp'>
  | Omit<HistoryItemToolGroup, 'id' | 'timestamp'>
  | Omit<HistoryItemOrchestrator, 'id' | 'timestamp'>;

/**
 * Slash command processor result
 */
export type SlashCommandProcessorResult =
  | { type: 'handled' }
  | { type: 'schedule_tool'; toolName: string; toolArgs: Record<string, unknown> }
  | { type: 'submit_prompt'; content: string };

/**
 * Loop detection confirmation request
 */
export interface LoopDetectionConfirmationRequest {
  toolName: string;
  callCount: number;
  onConfirm: (proceed: boolean) => void;
}

/**
 * Stream event types for interleaved display
 * These are tracked in order as they arrive during streaming
 */
export enum StreamEventType {
  UserMessage = 'user_message',
  Text = 'text',
  Thinking = 'thinking',
  ToolCall = 'tool_call',
  ToolResult = 'tool_result',
}

/**
 * Individual stream event - represents a unit of content in the stream
 */
export interface StreamEvent {
  id: string;
  type: StreamEventType;
  timestamp: number;
  // For user_message events
  userMessage?: string;
  // For text events
  text?: string;
  // For thinking events
  thinking?: string;
  thinkingComplete?: boolean;
  // For tool_call events
  toolCall?: IndividualToolCallDisplay;
  toolInputArgs?: Record<string, any>;
  // For tool_result events
  toolResult?: {
    toolUseId: string;
    output?: string;
    error?: string;
    isError?: boolean;
  };
}
