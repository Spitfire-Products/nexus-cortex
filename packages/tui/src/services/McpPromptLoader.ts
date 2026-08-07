/**
 * McpPromptLoader - Loads slash commands from MCP prompts
 *
 * Discovers prompts from enabled MCP servers and exposes them as commands.
 */

import type { CommandLoader } from './CommandService.js';
import type { SlashCommand } from '../ink-ui/commands/types.js';
import type { Config } from '../ink-ui/core-stubs.js';

/**
 * McpPromptLoader loads commands from MCP server prompts
 */
export class McpPromptLoader implements CommandLoader {
  constructor(_config: Config | null) {
    // Config will be used when implementing MCP prompt loading
  }

  async loadCommands(_signal?: AbortSignal): Promise<SlashCommand[]> {
    // TODO: Implement MCP prompt loading from enabled servers
    // For now, return empty array
    return [];
  }
}
