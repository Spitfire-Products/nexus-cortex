/**
 * CommandService - Manages slash command loading and registration
 *
 * Provides a unified interface for loading commands from multiple sources:
 * - Built-in commands (mentorship, model, session, etc.)
 * - File-based commands (.cortex/commands/*.md)
 * - MCP prompts (from enabled MCP servers)
 */

import type { SlashCommand } from '../ink-ui/commands/types.js';

/**
 * Interface for command loaders
 */
export interface CommandLoader {
  /**
   * Load commands from this source
   * @param signal Abort signal for cancellation
   */
  loadCommands(signal?: AbortSignal): Promise<SlashCommand[]>;
}

/**
 * CommandService manages all slash commands
 */
export class CommandService {
  private commands: readonly SlashCommand[];

  private constructor(commands: SlashCommand[]) {
    this.commands = Object.freeze(commands);
  }

  /**
   * Create a CommandService by loading commands from all loaders
   */
  static async create(
    loaders: CommandLoader[],
    signal?: AbortSignal
  ): Promise<CommandService> {
    const allCommands: SlashCommand[] = [];

    for (const loader of loaders) {
      if (signal?.aborted) break;

      try {
        const commands = await loader.loadCommands(signal);
        allCommands.push(...commands);
      } catch (error) {
        // Log but don't fail - allow other loaders to continue
        console.error('Failed to load commands from loader:', error);
      }
    }

    return new CommandService(allCommands);
  }

  /**
   * Get all loaded commands
   */
  getCommands(): readonly SlashCommand[] {
    return this.commands;
  }

  /**
   * Find a command by name
   */
  findCommand(name: string): SlashCommand | undefined {
    return this.commands.find(
      cmd => cmd.name === name || cmd.altNames?.includes(name)
    );
  }
}
