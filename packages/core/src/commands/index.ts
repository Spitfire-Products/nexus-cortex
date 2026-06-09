/**
 * Slash Command System
 *
 * Unified slash command infrastructure for Nexus Cortex CLIs.
 * Shared between fuzzycortex (chalk) and neoncortex (ink) interfaces.
 *
 * @module commands
 */

// Types
export type {
  CommandContext,
  CommandResult,
  SubcommandDefinition,
  CommandDefinition,
  CommandCategory,
  CategoryMetadata,
  ParsedCommand,
  CompletionSuggestion,
  CompletionState,
  CommandTreeNode,
} from './types.js';

// Registry
export { SlashCommandRegistry, slashCommandRegistry } from './SlashCommandRegistry.js';

// Parser
export { SlashCommandParser, parseSlashCommand } from './SlashCommandParser.js';

// Completer
export {
  SlashCommandCompleter,
  createCompleter,
  type CompleterConfig,
} from './SlashCommandCompleter.js';
