/**
 * Slash Command Types
 *
 * Shared type definitions for the slash command system.
 * Used by both fuzzycortex (chalk) and neoncortex (ink) CLIs.
 *
 * @module commands/types
 */

/**
 * Command execution context passed to handlers
 */
export interface CommandContext {
  /** Current session ID */
  sessionId?: string;
  /** Current model ID */
  modelId?: string;
  /** Project/working directory path */
  projectPath: string;
  /** Raw arguments from command line */
  args: string[];
  /** Parsed options/flags */
  options: Record<string, string | boolean>;
}

/**
 * Result of command execution
 */
export interface CommandResult {
  /** Whether command succeeded */
  success: boolean;
  /** Message to display (info, error, etc.) */
  message?: string;
  /** Type of result for UI handling */
  type?: 'message' | 'dialog' | 'action' | 'silent';
  /** Additional data for specific result types */
  data?: unknown;
}

/**
 * Subcommand definition
 */
export interface SubcommandDefinition {
  /** Subcommand name (e.g., 'list', 'switch') */
  name: string;
  /** Alternative name/alias */
  altName?: string;
  /** Human-readable description */
  description: string;
  /** Usage syntax (e.g., '/models switch <model-id>') */
  usage?: string;
  /** Example usages */
  examples?: string[];
  /** Async function to provide argument completions */
  completion?: (context: CommandContext) => Promise<CompletionSuggestion[]>;
  /** Handler function */
  handler?: (context: CommandContext) => Promise<CommandResult> | CommandResult;
}

/**
 * Main command definition
 */
export interface CommandDefinition {
  /** Command name (e.g., 'models', 'session') */
  name: string;
  /** Alternative name/alias */
  altName?: string;
  /** Category for grouping in UI */
  category: CommandCategory;
  /** Human-readable description */
  description: string;
  /** Usage syntax */
  usage?: string;
  /** Example usages */
  examples?: string[];
  /** Nested subcommands */
  subcommands?: SubcommandDefinition[];
  /** Async function to provide argument completions */
  completion?: (context: CommandContext) => Promise<CompletionSuggestion[]>;
  /** Handler function (for commands without subcommands) */
  handler?: (context: CommandContext) => Promise<CommandResult> | CommandResult;
}

/**
 * Command category for organization
 */
export type CommandCategory =
  | 'models'
  | 'session'
  | 'cache'
  | 'mcp'
  | 'tools'
  | 'config'
  | 'system'
  | 'ide'
  | 'extensions';

/**
 * Category metadata for display
 */
export interface CategoryMetadata {
  /** Category identifier */
  name: CommandCategory;
  /** Human-readable label */
  label: string;
  /** Description of category */
  description: string;
  /** Icon/symbol for display */
  icon: string;
}

/**
 * Parsed command structure
 */
export interface ParsedCommand {
  /** Whether input was detected as a command */
  isCommand: boolean;
  /** Main command name */
  command: string;
  /** Subcommand name (if any) */
  subcommand?: string;
  /** Remaining arguments */
  args: string[];
  /** Parsed flags/options */
  options: Record<string, string | boolean>;
  /** Original raw input */
  rawInput: string;
}

/**
 * Completion/autocomplete suggestion
 */
export interface CompletionSuggestion {
  /** Display label */
  label: string;
  /** Value to insert */
  value: string;
  /** Optional description */
  description?: string;
  /** Type of suggestion */
  type?: 'command' | 'subcommand' | 'argument' | 'file' | 'option';
}

/**
 * Completion state for UI
 */
export interface CompletionState {
  /** Available suggestions */
  suggestions: CompletionSuggestion[];
  /** Currently selected index */
  activeIndex: number;
  /** Whether suggestions are visible */
  showSuggestions: boolean;
  /** Whether loading async suggestions */
  isLoading: boolean;
  /** Scroll offset for windowed display */
  scrollOffset: number;
}

/**
 * Command tree node for hierarchical traversal
 */
export interface CommandTreeNode {
  /** Node name */
  name: string;
  /** Node definition (command or subcommand) */
  definition: CommandDefinition | SubcommandDefinition;
  /** Child nodes */
  children: Map<string, CommandTreeNode>;
  /** Whether this is a leaf node (can be executed) */
  isLeaf: boolean;
}
