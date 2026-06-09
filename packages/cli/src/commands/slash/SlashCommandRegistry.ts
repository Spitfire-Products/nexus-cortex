/**
 * SlashCommandRegistry - Re-exports from core library
 *
 * This module re-exports the unified slash command registry from @nexus-cortex/core.
 * The core registry is shared between fuzzycortex (chalk) and neoncortex (ink) CLIs.
 *
 * @module SlashCommandRegistry
 */

// Re-export types and classes from core
export {
  SlashCommandRegistry,
  slashCommandRegistry,
  SlashCommandCompleter,
  createCompleter,
} from '@nexus-cortex/core';

export type {
  CommandDefinition,
  SubcommandDefinition,
  CommandCategory,
  CategoryMetadata,
  CommandTreeNode,
  CommandContext,
  CommandResult,
  CompletionSuggestion,
  CompletionState,
  CompleterConfig,
} from '@nexus-cortex/core';
