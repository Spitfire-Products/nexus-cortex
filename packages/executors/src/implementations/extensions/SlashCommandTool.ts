/**
 * SlashCommand Tool - Execute custom slash commands from .cortex/commands/
 *
 * Loads and executes custom commands defined in Markdown files with YAML frontmatter.
 * Supports argument substitution using $1, $2, etc.
 *
 * Command Format (.md files):
 * ```markdown
 * ---
 * description: Command description
 * argument-hint: [arg1] [arg2]
 * ---
 *
 * Command body with $1 and $2 placeholders
 * ```
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { promises as fs } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import { glob } from 'glob';

/**
 * Parameters for the SlashCommand tool
 */
export interface SlashCommandParams {
  /** The slash command to execute with its arguments (e.g., "/review-pr 123") */
  command: string;
}

/**
 * Parsed command definition from .md file
 */
interface CommandDefinition {
  name: string;
  description: string;
  argumentHint?: string;
  body: string;
}

/**
 * SlashCommand Tool Executor
 *
 * Executes custom slash commands from .cortex/commands/ directory.
 * Commands are defined in Markdown files with YAML frontmatter.
 *
 * Example command file (.cortex/commands/review-pr.md):
 * ```markdown
 * ---
 * description: Review a pull request
 * argument-hint: [pr-number]
 * ---
 *
 * Review pull request #$1
 *
 * Instructions:
 * 1. Fetch PR details from GitHub
 * 2. Analyze the code changes
 * 3. Provide feedback
 * ```
 *
 * Usage: SlashCommand({ command: "/review-pr 123" })
 */
export class SlashCommandToolExecutor extends BaseTool<
  SlashCommandParams,
  ToolResult
> {
  private commandsCache: Map<string, CommandDefinition> | null = null;
  private commandsDir: string;

  constructor(config: { workingDirectory: string }) {
    super(
      'SlashCommand',
      'SlashCommand',
      'Execute custom slash commands from .cortex/commands/',
      {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description:
              'The slash command to execute with its arguments (e.g., "/review-pr 123")',
          },
        },
        required: ['command'],
      },
    );

    this.commandsDir = join(config.workingDirectory, '.cortex', 'commands');
  }

  validateToolParams(params: SlashCommandParams): string | null {
    if (!params.command || typeof params.command !== 'string') {
      return 'command must be a non-empty string';
    }

    if (!params.command.startsWith('/')) {
      return 'command must start with a forward slash (/)';
    }

    if (params.command.trim() === '/') {
      return 'command name cannot be empty';
    }

    return null;
  }

  getDescription(params: SlashCommandParams): string {
    const commandName = this.parseCommandName(params.command);
    return `Executing slash command: ${commandName}`;
  }

  async execute(
    params: SlashCommandParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Validate parameters
      const validationError = this.validateToolParams(params);
      if (validationError) {
        return {
          ...this.createErrorResult(validationError),
          metadata: { executionTime: Date.now() - startTime },
        };
      }

      // Parse command and arguments
      const { commandName, args } = this.parseCommand(params.command);

      // Load command definition
      const commandDef = await this.loadCommand(commandName, signal);
      if (!commandDef) {
        return {
          ...this.createErrorResult(
            `Command '${commandName}' not found in ${this.commandsDir}\n\n` +
              `Available commands: ${await this.getAvailableCommands()}`,
          ),
          metadata: {
            executionTime: Date.now() - startTime,
            commandName,
          },
        };
      }

      // Substitute arguments in command body
      const expandedCommand = this.substituteArguments(commandDef.body, args);

      // Return the expanded command as output
      const output = this.formatCommandOutput(
        commandName,
        commandDef,
        expandedCommand,
        args,
      );

      return {
        ...this.createSuccessResult(output),
        metadata: {
          executionTime: Date.now() - startTime,
          commandName,
          argumentCount: args.length,
          description: commandDef.description,
        },
      };
    } catch (error: any) {
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Command execution was cancelled'),
          metadata: { executionTime: Date.now() - startTime },
        };
      }

      return {
        ...this.createErrorResult(
          `Error executing slash command: ${error.message || String(error)}`,
        ),
        metadata: {
          executionTime: Date.now() - startTime,
          error: error.message || String(error),
        },
      };
    }
  }

  /**
   * Parse command string into name and arguments
   * Example: "/review-pr 123 --verbose" → { commandName: "review-pr", args: ["123", "--verbose"] }
   */
  private parseCommand(command: string): {
    commandName: string;
    args: string[];
  } {
    const trimmed = command.trim();
    const parts = trimmed.split(/\s+/).filter(Boolean);
    const commandName = parts[0] ? parts[0].slice(1) : ''; // Remove leading /
    const args = parts.slice(1);

    return { commandName, args };
  }

  /**
   * Parse just the command name (for display purposes)
   */
  private parseCommandName(command: string): string {
    return this.parseCommand(command).commandName;
  }

  /**
   * Load command definition from .cortex/commands/ directory
   * Supports recursive directory structure
   */
  private async loadCommand(
    commandName: string,
    signal: AbortSignal,
  ): Promise<CommandDefinition | null> {
    // Load all commands if not cached
    if (!this.commandsCache) {
      await this.loadAllCommands(signal);
    }

    if (!this.commandsCache) {
      return null;
    }

    return this.commandsCache.get(commandName) || null;
  }

  /**
   * Load all command definitions from .cortex/commands/
   */
  private async loadAllCommands(signal: AbortSignal): Promise<void> {
    this.commandsCache = new Map();

    try {
      // Check if commands directory exists
      try {
        await fs.access(this.commandsDir);
      } catch {
        // Directory doesn't exist, return empty cache
        return;
      }

      // Find all .md files recursively
      const files = await glob('**/*.md', {
        cwd: this.commandsDir,
        nodir: true,
        dot: false,
        signal,
      });

      // Load each command file
      for (const file of files) {
        const filePath = join(this.commandsDir, file);
        const commandDef = await this.parseCommandFile(filePath);

        if (commandDef) {
          this.commandsCache.set(commandDef.name, commandDef);
        }
      }
    } catch (error: any) {
      // Silently fail if directory doesn't exist or can't be read
      if (error.code !== 'ENOENT') {
        console.error(`[SlashCommand] Error loading commands: ${error.message}`);
      }
    }
  }

  /**
   * Parse command definition from .md file
   *
   * Format:
   * ```markdown
   * ---
   * description: Command description
   * argument-hint: [arg1] [arg2]
   * ---
   *
   * Command body with $1 and $2 placeholders
   * ```
   */
  private async parseCommandFile(
    filePath: string,
  ): Promise<CommandDefinition | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // Extract frontmatter and body
      const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

      if (!frontmatterMatch) {
        console.error(
          `[SlashCommand] Invalid command file format: ${filePath} (missing frontmatter)`,
        );
        return null;
      }

      const frontmatterText = frontmatterMatch[1] || '';
      const body = frontmatterMatch[2] || '';

      // Parse frontmatter (simple YAML parser for our use case)
      const frontmatter = this.parseFrontmatter(frontmatterText);

      // Get command name from filename (without extension)
      const fileName = basename(filePath, extname(filePath));

      return {
        name: fileName,
        description: frontmatter.description || `Execute ${fileName} command`,
        argumentHint: frontmatter['argument-hint'] || undefined,
        body: body.trim(),
      };
    } catch (error: any) {
      console.error(`[SlashCommand] Error parsing command file ${filePath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Simple YAML frontmatter parser
   * Handles basic key: value pairs
   */
  private parseFrontmatter(text: string): Record<string, string> {
    const result: Record<string, string> = {};

    const lines = text.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\S+):\s*(.*)$/);
      if (match && match[1] && match[2] !== undefined) {
        const key = match[1].trim();
        const value = match[2].trim();
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Substitute arguments in command body
   * Replaces $1, $2, etc. with actual argument values
   */
  private substituteArguments(body: string, args: string[]): string {
    let result = body;

    // Replace $1, $2, etc. with actual arguments
    for (let i = 0; i < args.length; i++) {
      const placeholder = `$${i + 1}`;
      const arg = args[i];
      result = result.split(placeholder).join(arg);
    }

    // Replace any remaining placeholders with empty string
    result = result.replace(/\$\d+/g, '');

    return result;
  }

  /**
   * Format command output for display
   */
  private formatCommandOutput(
    commandName: string,
    commandDef: CommandDefinition,
    expandedCommand: string,
    args: string[],
  ): string {
    const parts: string[] = [];

    // Command header
    parts.push(`# Slash Command: /${commandName}`);
    parts.push('');
    parts.push(`**Description**: ${commandDef.description}`);

    if (commandDef.argumentHint) {
      parts.push(`**Arguments**: ${commandDef.argumentHint}`);
    }

    if (args.length > 0) {
      parts.push(`**Provided Arguments**: ${args.join(', ')}`);
    }

    parts.push('');
    parts.push('---');
    parts.push('');

    // Expanded command body
    parts.push(expandedCommand);

    return parts.join('\n');
  }

  /**
   * Get list of available commands (for error messages)
   */
  private async getAvailableCommands(): Promise<string> {
    if (!this.commandsCache) {
      await this.loadAllCommands(new AbortController().signal);
    }

    if (!this.commandsCache || this.commandsCache.size === 0) {
      return '(none found)';
    }

    return Array.from(this.commandsCache.keys())
      .map((name) => `/${name}`)
      .join(', ');
  }

  /**
   * Clear the commands cache (useful for testing or reloading)
   */
  clearCache(): void {
    this.commandsCache = null;
  }
}
