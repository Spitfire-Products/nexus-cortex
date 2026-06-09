/**
 * SlashCommandParser - Re-exports from core library
 *
 * This module re-exports the unified slash command parser from @nexus-cortex/core.
 * The core parser is shared between fuzzycortex (chalk) and neoncortex (ink) CLIs.
 *
 * @module SlashCommandParser
 */

// Re-export parser and types from core
export {
  SlashCommandParser,
  parseSlashCommand,
} from '@nexus-cortex/core';

export type { ParsedCommand } from '@nexus-cortex/core';
