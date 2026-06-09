/**
 * System Message Types
 *
 * Types for the hot-reload system message architecture
 */

/**
 * System message source
 */
export type MessageSource = 'builtin' | 'workspace' | 'runtime';

/**
 * System message type
 */
export type MessageType = 'instruction' | 'constraint' | 'context' | 'template';

/**
 * System message data
 */
export interface SystemMessage {
  /** Unique message identifier (e.g., 'tool_usage_guide') */
  id: string;

  /** Message type */
  type: MessageType;

  /** File path relative to source directory */
  path: string;

  /** Whether message is enabled */
  enabled: boolean;

  /** Source of the message */
  source: MessageSource;

  /** Priority for injection order (higher = injected first) */
  priority: number;

  /** Message content (markdown) */
  content: string;

  /** Optional conditions for when to inject */
  conditions?: MessageConditions;

  /** Metadata */
  metadata: MessageMetadata;
}

/**
 * Conditions for message injection
 */
export interface MessageConditions {
  /** Require tools to be enabled */
  requireTools?: boolean;

  /** Minimum number of tools */
  minToolCount?: number;

  /** Only for specific model families */
  modelFamily?: string[];

  /** Only in debug mode */
  debugOnly?: boolean;

  /** Inject only on a specific turn (0 = first turn → R28 pins it static). */
  turnNumber?: number;

  /**
   * Inject when turn matches modulo. Presence ALSO marks the message
   * turn-varying (see turnVaryingClassifier) → routed to the live user
   * turn instead of the cached `system` field. `{divisor:1,remainder:0}`
   * = every turn.
   */
  turnNumberModulo?: { divisor: number; remainder: number };
}

/**
 * Message metadata
 */
export interface MessageMetadata {
  /** Author/creator */
  author?: string;

  /** Creation timestamp */
  created: string;

  /** Last modification timestamp */
  modified?: string;

  /** Human-readable description */
  description?: string;

  /** Display name */
  displayName?: string;
}

/**
 * System message info (for listing)
 */
export interface SystemMessageInfo {
  id: string;
  type: MessageType;
  source: MessageSource;
  path: string;
  enabled: boolean;
  priority: number;
  metadata: MessageMetadata;
  fileSize?: number;
  lastModified?: Date;
}

/**
 * Message registry (stored in registry.json)
 */
export interface MessageRegistry {
  /** Registry format version */
  version: string;

  /** Last modification time */
  lastModified: string;

  /** Registered messages */
  messages: MessageRegistryEntry[];
}

/**
 * Registry entry for a message
 */
export interface MessageRegistryEntry {
  id: string;
  type: MessageType;
  path: string;
  enabled: boolean;
  priority: number;
  conditions?: MessageConditions;
  metadata: MessageMetadata;
}

/**
 * Store event types
 */
export type StoreEventType =
  | 'message_created'
  | 'message_updated'
  | 'message_deleted'
  | 'message_toggled'
  | 'store_reloaded'
  | 'registry_updated';

/**
 * Store event
 */
export interface StoreEvent {
  type: StoreEventType;
  messageId?: string;  // Optional for registry_updated events
  message?: SystemMessage;
  enabled?: boolean;
  timestamp: Date;
}

/**
 * Store change listener callback
 */
export type StoreChangeListener = (event: StoreEvent) => void;

/**
 * Message template for creating new messages
 */
export interface MessageTemplate {
  id: string;
  type: MessageType;
  displayName?: string;
  description?: string;
  priority?: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  stats: ValidationStats;
}

/**
 * Validation error
 */
export interface ValidationError {
  type: 'size' | 'encoding' | 'frontmatter' | 'security' | 'syntax';
  message: string;
  line?: number;
  column?: number;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  type: 'length' | 'formatting' | 'deprecated';
  message: string;
  suggestion?: string;
}

/**
 * Validation statistics
 */
export interface ValidationStats {
  lines: number;
  chars: number;
  words: number;
}

/**
 * Editor launch result
 */
export interface EditResult {
  wasModified: boolean;
  filePath: string;
  editor: string;
}
