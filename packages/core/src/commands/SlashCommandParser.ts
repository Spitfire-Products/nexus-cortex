/**
 * Slash Command Parser
 *
 * Parses slash commands from user input with quote-aware tokenization
 * and option/flag extraction.
 *
 * @module commands/SlashCommandParser
 */

import { ParsedCommand } from './types.js';

/**
 * Slash Command Parser
 *
 * Handles parsing of slash commands with support for:
 * - Quote-aware argument tokenization (single and double quotes)
 * - Flag/option parsing (--flag, --key=value, -v)
 * - Hierarchical command/subcommand structure
 */
export class SlashCommandParser {
  /**
   * Parse user input to extract slash command components
   *
   * @param input - Raw user input
   * @returns ParsedCommand with command, subcommand, args, and options
   *
   * @example
   * ```typescript
   * parse('/models list --provider anthropic')
   * // => { isCommand: true, command: 'models', subcommand: 'list',
   * //      args: [], options: { provider: 'anthropic' } }
   *
   * parse('/session checkpoint "my save"')
   * // => { isCommand: true, command: 'session', subcommand: 'checkpoint',
   * //      args: ['my save'], options: {} }
   * ```
   */
  static parse(input: string): ParsedCommand {
    const trimmed = input.trim();

    // Not a command if doesn't start with /
    if (!trimmed.startsWith('/')) {
      return {
        isCommand: false,
        command: '',
        args: [],
        options: {},
        rawInput: input,
      };
    }

    // Remove leading / and tokenize
    const withoutSlash = trimmed.slice(1);
    const tokens = this.tokenize(withoutSlash);

    if (tokens.length === 0) {
      // Just "/" was entered - show command palette
      return {
        isCommand: true,
        command: '',
        args: [],
        options: {},
        rawInput: input,
      };
    }

    // Extract options/flags from tokens
    const { positional, options } = this.extractOptions(tokens);

    // First positional is the command
    const command = positional[0]?.toLowerCase() ?? '';

    // Second positional is the subcommand (if present)
    const subcommand = positional.length > 1 ? positional[1]!.toLowerCase() : undefined;

    // Remaining positionals are args
    const args = positional.slice(subcommand ? 2 : 1);

    return {
      isCommand: true,
      command,
      subcommand,
      args,
      options,
      rawInput: input,
    };
  }

  /**
   * Tokenize command line respecting quoted strings
   *
   * Handles:
   * - Single quotes: 'my value'
   * - Double quotes: "my value"
   * - Escaped quotes within strings
   * - Multiple consecutive spaces
   *
   * @param line - Command line without leading /
   * @returns Array of tokens
   *
   * @example
   * ```typescript
   * tokenize('models list')
   * // => ['models', 'list']
   *
   * tokenize('session checkpoint "my checkpoint"')
   * // => ['session', 'checkpoint', 'my checkpoint']
   *
   * tokenize("config set theme 'tokyo night'")
   * // => ['config', 'set', 'theme', 'tokyo night']
   * ```
   */
  static tokenize(line: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    let escapeNext = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;

      // Handle escape character
      if (escapeNext) {
        current += char;
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      // Quote handling
      if ((char === '"' || char === "'") && !inQuotes) {
        // Start quoted string
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        // End quoted string
        inQuotes = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        // Space outside quotes - end current token
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
      } else {
        // Regular character
        current += char;
      }
    }

    // Add final token
    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }

  /**
   * Extract options/flags from token array
   *
   * Supports:
   * - Long flags: --flag (boolean true)
   * - Long options: --key=value or --key value
   * - Short flags: -v (boolean true)
   * - Negated flags: --no-flag (boolean false)
   *
   * @param tokens - Array of tokens
   * @returns Object with positional args and options map
   */
  private static extractOptions(tokens: string[]): {
    positional: string[];
    options: Record<string, string | boolean>;
  } {
    const positional: string[] = [];
    const options: Record<string, string | boolean> = {};
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i]!;

      if (token.startsWith('--')) {
        // Long option/flag
        const withoutDash = token.slice(2);

        if (withoutDash.includes('=')) {
          // --key=value format
          const [key, ...valueParts] = withoutDash.split('=');
          const value = valueParts.join('='); // Handle values with = in them
          if (key) {
            options[key] = value;
          }
        } else if (withoutDash.startsWith('no-')) {
          // --no-flag format (negated boolean)
          const key = withoutDash.slice(3);
          if (key) {
            options[key] = false;
          }
        } else {
          // Check if next token is a value (not another flag)
          const nextToken = tokens[i + 1];
          if (nextToken && !nextToken.startsWith('-')) {
            options[withoutDash] = nextToken;
            i++; // Skip the value token
          } else {
            // Boolean flag
            options[withoutDash] = true;
          }
        }
      } else if (token.startsWith('-') && token.length === 2) {
        // Short flag: -v
        const flag = token.slice(1);
        options[flag] = true;
      } else {
        // Positional argument
        positional.push(token);
      }

      i++;
    }

    return { positional, options };
  }

  /**
   * Check if input is a slash command
   *
   * @param input - User input
   * @returns True if input starts with /
   */
  static isSlashCommand(input: string): boolean {
    return input.trim().startsWith('/');
  }

  /**
   * Check if input is a partial slash command (for autocomplete)
   *
   * @param input - User input
   * @returns True if input starts with / and has no spaces (partial command)
   */
  static isPartialCommand(input: string): boolean {
    const trimmed = input.trim();
    return trimmed.startsWith('/') && !trimmed.slice(1).includes(' ');
  }

  /**
   * Get the current partial token being typed (for autocomplete)
   *
   * @param input - User input
   * @returns Object with command path and current partial token
   *
   * @example
   * ```typescript
   * getPartialToken('/mod')
   * // => { path: [], partial: 'mod' }
   *
   * getPartialToken('/models li')
   * // => { path: ['models'], partial: 'li' }
   *
   * getPartialToken('/models list ')
   * // => { path: ['models', 'list'], partial: '' }
   * ```
   */
  static getPartialToken(input: string): {
    path: string[];
    partial: string;
  } {
    if (!input.startsWith('/')) {
      return { path: [], partial: '' };
    }

    const withoutSlash = input.slice(1);
    const tokens = this.tokenize(withoutSlash);

    // Check if input ends with a space (user is starting a new token)
    const endsWithSpace = withoutSlash.endsWith(' ');

    if (endsWithSpace) {
      // All tokens are complete, partial is empty
      return {
        path: tokens.map((t) => t.toLowerCase()),
        partial: '',
      };
    }

    if (tokens.length === 0) {
      return { path: [], partial: '' };
    }

    // Last token is the partial being typed
    const partial = tokens[tokens.length - 1]!;
    const path = tokens.slice(0, -1).map((t) => t.toLowerCase());

    return { path, partial };
  }

  /**
   * Format a parsed command back to string
   *
   * @param parsed - Parsed command object
   * @returns Formatted command string
   */
  static format(parsed: ParsedCommand): string {
    if (!parsed.isCommand) {
      return parsed.rawInput;
    }

    let formatted = `/${parsed.command}`;

    if (parsed.subcommand) {
      formatted += ` ${parsed.subcommand}`;
    }

    // Add positional args
    for (const arg of parsed.args) {
      // Quote args containing spaces
      if (arg.includes(' ')) {
        formatted += ` "${arg}"`;
      } else {
        formatted += ` ${arg}`;
      }
    }

    // Add options
    for (const [key, value] of Object.entries(parsed.options)) {
      if (typeof value === 'boolean') {
        if (value) {
          formatted += ` --${key}`;
        } else {
          formatted += ` --no-${key}`;
        }
      } else {
        formatted += ` --${key}=${value}`;
      }
    }

    return formatted;
  }

  /**
   * Split input into command path for tree traversal
   *
   * @param input - User input (with or without leading /)
   * @returns Array of command path segments
   *
   * @example
   * ```typescript
   * toPath('/models list --verbose')
   * // => ['models', 'list']
   *
   * toPath('session checkpoint')
   * // => ['session', 'checkpoint']
   * ```
   */
  static toPath(input: string): string[] {
    const trimmed = input.trim();
    const withoutSlash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
    const { positional } = this.extractOptions(this.tokenize(withoutSlash));
    return positional.map((p) => p.toLowerCase());
  }
}

/**
 * Convenience function for parsing commands
 */
export function parseSlashCommand(input: string): ParsedCommand {
  return SlashCommandParser.parse(input);
}
