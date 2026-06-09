/**
 * System Message Registry Interfaces
 * Defines structure for system message injection configuration
 */

/**
 * Injection position relative to canonical messages
 */
export type InjectionPosition = 'prepend' | 'append' | 'interleave';

/**
 * Message role (matches canonical message roles)
 */
export type MessageRole = 'system' | 'user' | 'assistant';

/**
 * Session phase
 */
export type SessionPhase = 'start' | 'ongoing' | 'end';

/**
 * Model capabilities that affect injection
 */
export type ModelCapability = 'reasoning' | 'vision' | 'tools' | 'streaming';

/**
 * Injection conditions for a system message
 */
export interface InjectionConditions {
  /** Inject only if tools are present */
  hasTools?: boolean;

  /** Inject only at specific turn number */
  turnNumber?: number;

  /** Inject when turn number matches modulo condition */
  turnNumberModulo?: {
    divisor: number;
    remainder: number;
  };

  /** Inject during specific session phases */
  sessionPhase?: SessionPhase | SessionPhase[];

  /** Inject only for models with specific capabilities */
  modelCapabilities?: ModelCapability[];

  /** Inject only for specific API patterns */
  apiPattern?: string | string[];

  /** Custom condition function (evaluated at runtime) */
  customCondition?: string;
}

/**
 * Injection configuration
 */
export interface InjectionConfig {
  /** Where to inject relative to canonical messages */
  position: InjectionPosition;

  /** Role of the injected message */
  role: MessageRole;

  /** Priority (lower = injected earlier) */
  priority: number;

  /** Index offset for interleave position */
  offset?: number;
}

/**
 * System message definition
 */
export interface SystemMessageDefinition {
  /** Unique identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Path to markdown file (relative to messages/) */
  file: string;

  /** Conditions for injection */
  conditions: InjectionConditions;

  /** Injection configuration */
  injection: InjectionConfig;

  /** Whether to cache file content */
  cache: boolean;

  /** Whether content is dynamic (contains templates) */
  dynamic?: boolean;

  /** Description */
  description: string;
}

/**
 * System message registry schema
 */
export interface SystemMessageRegistrySchema {
  $schema?: string;
  version: string;
  description: string;
  messages: SystemMessageDefinition[];
  injection_rules: {
    deduplication: {
      enabled: boolean;
      strategy: 'content_hash' | 'message_id';
      description: string;
    };
    reasoning_models: {
      interleaved_thinking: boolean;
      thinking_position: 'before_response' | 'after_response';
      description: string;
    };
    max_system_messages: number;
    trim_strategy: 'priority' | 'oldest_first' | 'newest_first';
    position_mapping: Record<InjectionPosition, string>;
  };
}

/**
 * Context for determining which messages to inject
 */
export interface InjectionContext {
  /** Current turn number */
  turnNumber: number;

  /** Session phase */
  sessionPhase: SessionPhase;

  /** Whether tools are present in request */
  hasTools: boolean;

  /** Tool count */
  toolCount?: number;

  /** Model capabilities */
  modelCapabilities: ModelCapability[];

  /** API pattern */
  apiPattern: string;

  /** Session ID */
  sessionId: string;

  /** Last injected message IDs (for deduplication) */
  lastInjectedIds?: string[];
}

/**
 * Loaded system message ready for injection
 */
export interface LoadedSystemMessage {
  /** Definition from registry */
  definition: SystemMessageDefinition;

  /** Loaded content (from .md file) */
  content: string;

  /** Content hash (for deduplication) */
  contentHash: string;

  /** Whether this is cached */
  cached: boolean;
}

/**
 * Template variables for dynamic messages
 */
export interface TemplateVariables {
  projectPath?: string;
  workspacePath?: string;
  currentDate?: string;
  currentTime?: string;
  toolCount?: number;
  toolNames?: string[];
  sandboxEnabled?: boolean;
  [key: string]: any;
}

/**
 * System message formatted for injection into content array
 * Based on Claude CLI pattern: inject into user message content array
 */
export interface SystemMessageForInjection {
  /** Content to inject */
  content: string;

  /** Where to inject (prepend, append, interleave) */
  position: InjectionPosition;

  /** Priority (for ordering within position) */
  priority: number;

  /** Wrap in <system-reminder> tags? (default: true) */
  wrapInSystemReminder: boolean;

  /** Content hash (for deduplication) */
  contentHash: string;

  /** Original definition (for debugging) */
  definition: SystemMessageDefinition;
}
