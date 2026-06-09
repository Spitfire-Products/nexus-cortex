/**
 * Shared UI Types for Nexus Cortex
 *
 * These types are shared between different CLI implementations:
 * - fuzzycortex (chalk-based terminal UI)
 * - neoncortex (Ink-based React terminal UI)
 * - cortexserver (HTTP API for web/mobile clients)
 *
 * @module ui/types
 */

/**
 * Model display information for UI components
 * Used by model picker dialogs in both chalk and Ink implementations
 */
export interface ModelDisplayInfo {
  /** Unique model identifier (e.g., "gpt-4", "claude-3-opus") */
  id: string;

  /** Human-readable display name */
  displayName: string;

  /** Provider name (e.g., "OpenAI", "Anthropic", "Google") */
  provider: string;

  /** Context window size in tokens */
  contextWindow?: number;

  /** Input cost per million tokens */
  inputCost?: number;

  /** Output cost per million tokens */
  outputCost?: number;

  /** Whether the model supports reasoning/thinking mode */
  supportsReasoning?: boolean;

  /** Whether the model supports vision/image input */
  supportsVision?: boolean;

  /** Whether the model supports streaming responses */
  supportsStreaming?: boolean;

  /** Maximum output tokens */
  maxOutput?: number;

  /** Model description */
  description?: string;
}

/**
 * Result from a model picker interaction
 */
export interface ModelPickerResult {
  /** Whether a model was selected (false if cancelled) */
  selected: boolean;

  /** The selected model ID (undefined if cancelled) */
  modelId?: string;
}

/**
 * Session display information for UI components
 * Used by session picker dialogs
 */
export interface SessionDisplayInfo {
  /** Session ID */
  id: string;

  /** Session display name or title */
  name: string;

  /** Number of messages in the session */
  messageCount: number;

  /** Session creation timestamp */
  createdAt: Date;

  /** Session last updated timestamp */
  updatedAt: Date;

  /** Total token count */
  tokenCount?: number;

  /** Current model used in session */
  currentModel?: string;
}

/**
 * Result from a session picker interaction
 */
export interface SessionPickerResult {
  /** Whether a session was selected (false if cancelled) */
  selected: boolean;

  /** The selected session ID (undefined if cancelled) */
  sessionId?: string;
}

/**
 * Theme picker result
 */
export interface ThemePickerResult {
  /** Whether a theme was selected */
  selected: boolean;

  /** The selected theme name */
  theme?: string;
}
