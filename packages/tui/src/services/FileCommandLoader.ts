/**
 * FileCommandLoader - Loads slash commands from .cortex/commands/*.md files
 *
 * Allows users to define custom commands in markdown files.
 */

import type { CommandLoader } from './CommandService.js';
import type { SlashCommand } from '../ink-ui/commands/types.js';
import type { Config } from '../ink-ui/core-stubs.js';

/**
 * FileCommandLoader loads commands from markdown files
 */
export class FileCommandLoader implements CommandLoader {
  constructor(_config: Config | null) {
    // Config will be used when implementing file-based command loading
  }

  async loadCommands(_signal?: AbortSignal): Promise<SlashCommand[]> {
    // TODO: Implement file-based command loading from .cortex/commands/*.md
    // For now, return empty array
    return [];
  }
}
