/**
 * Slash Command Completer
 *
 * Provides intelligent autocomplete suggestions for slash commands
 * based on the command registry and current input state.
 *
 * @module commands/SlashCommandCompleter
 */

import {
  CompletionSuggestion,
  CompletionState,
  CommandContext,
  CommandDefinition,
} from './types.js';
import { SlashCommandRegistry } from './SlashCommandRegistry.js';
import { SlashCommandParser } from './SlashCommandParser.js';

/**
 * Configuration for the completer
 */
export interface CompleterConfig {
  /** Maximum suggestions to show */
  maxSuggestions?: number;
  /** Enable fuzzy matching (default: false, prefix matching only) */
  fuzzyMatch?: boolean;
  /** Minimum characters before showing suggestions */
  minChars?: number;
}

const DEFAULT_CONFIG: Required<CompleterConfig> = {
  maxSuggestions: 10,
  fuzzyMatch: false,
  minChars: 0,
};

/**
 * Slash Command Completer
 *
 * Handles autocomplete logic for slash commands including:
 * - Command name completion
 * - Subcommand completion
 * - Dynamic argument completion (via registered callbacks)
 * - Keyboard navigation state management
 */
export class SlashCommandCompleter {
  private registry: SlashCommandRegistry;
  private config: Required<CompleterConfig>;
  private state: CompletionState;

  constructor(registry: SlashCommandRegistry, config: CompleterConfig = {}) {
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = this.createInitialState();
  }

  /**
   * Create initial completion state
   */
  private createInitialState(): CompletionState {
    return {
      suggestions: [],
      activeIndex: 0,
      showSuggestions: false,
      isLoading: false,
      scrollOffset: 0,
    };
  }

  /**
   * Get current completion state
   */
  getState(): CompletionState {
    return { ...this.state };
  }

  /**
   * Reset completion state
   */
  reset(): void {
    this.state = this.createInitialState();
  }

  /**
   * Update suggestions based on current input
   *
   * @param input - Current user input
   * @param context - Optional command context for dynamic completions
   * @returns Updated completion state
   */
  async updateSuggestions(
    input: string,
    context?: Partial<CommandContext>
  ): Promise<CompletionState> {
    // Hide suggestions if not a slash command
    if (!SlashCommandParser.isSlashCommand(input)) {
      this.state = {
        ...this.createInitialState(),
        showSuggestions: false,
      };
      return this.getState();
    }

    // Get the partial token being typed
    const { path, partial } = SlashCommandParser.getPartialToken(input);

    let suggestions: CompletionSuggestion[] = [];

    if (path.length === 0) {
      // Completing the root command name
      suggestions = this.getCommandSuggestions(partial);
    } else if (path.length === 1) {
      // Completing a subcommand
      const commandName = path[0]!;
      suggestions = this.getSubcommandSuggestions(commandName, partial);

      // If no subcommand suggestions, try argument completion
      if (suggestions.length === 0) {
        suggestions = await this.getArgumentSuggestions(commandName, undefined, partial, context);
      }
    } else {
      // Completing arguments for a command with subcommand
      const commandName = path[0]!;
      const subcommandName = path[1]!;
      suggestions = await this.getArgumentSuggestions(
        commandName,
        subcommandName,
        partial,
        context
      );
    }

    // Apply max suggestions limit
    if (suggestions.length > this.config.maxSuggestions) {
      suggestions = suggestions.slice(0, this.config.maxSuggestions);
    }

    // Update state
    this.state = {
      suggestions,
      activeIndex: 0,
      showSuggestions: suggestions.length > 0,
      isLoading: false,
      scrollOffset: 0,
    };

    return this.getState();
  }

  /**
   * Get command name suggestions
   */
  private getCommandSuggestions(partial: string): CompletionSuggestion[] {
    const lowerPartial = partial.toLowerCase();

    if (this.config.fuzzyMatch) {
      return this.registry
        .search(lowerPartial)
        .map((cmd) => ({
          label: cmd.name,
          value: cmd.name,
          description: cmd.description,
          type: 'command' as const,
        }))
        .slice(0, this.config.maxSuggestions);
    }

    return this.registry.getSuggestions(lowerPartial);
  }

  /**
   * Get subcommand suggestions for a command
   */
  private getSubcommandSuggestions(
    commandName: string,
    partial: string
  ): CompletionSuggestion[] {
    return this.registry.getSubcommandSuggestions(commandName, partial);
  }

  /**
   * Get argument suggestions (dynamic completion via registered callbacks)
   */
  private async getArgumentSuggestions(
    commandName: string,
    subcommandName: string | undefined,
    partial: string,
    context?: Partial<CommandContext>
  ): Promise<CompletionSuggestion[]> {
    const command = this.registry.getCommand(commandName);
    if (!command) {
      return [];
    }

    // Build completion context
    const completionContext: CommandContext = {
      projectPath: context?.projectPath ?? process.cwd(),
      args: [partial],
      options: context?.options ?? {},
      sessionId: context?.sessionId,
      modelId: context?.modelId,
    };

    // Try subcommand completion first
    if (subcommandName && command.subcommands) {
      const subcommand = command.subcommands.find(
        (sub) =>
          sub.name.toLowerCase() === subcommandName.toLowerCase() ||
          sub.altName?.toLowerCase() === subcommandName.toLowerCase()
      );

      if (subcommand?.completion) {
        try {
          this.state.isLoading = true;
          const suggestions = await subcommand.completion(completionContext);
          return this.filterSuggestions(suggestions, partial);
        } catch (error) {
          console.error(`Error getting completions for ${commandName} ${subcommandName}:`, error);
          return [];
        } finally {
          this.state.isLoading = false;
        }
      }
    }

    // Try command-level completion
    if (command.completion) {
      try {
        this.state.isLoading = true;
        const suggestions = await command.completion(completionContext);
        return this.filterSuggestions(suggestions, partial);
      } catch (error) {
        console.error(`Error getting completions for ${commandName}:`, error);
        return [];
      } finally {
        this.state.isLoading = false;
      }
    }

    return [];
  }

  /**
   * Filter suggestions by partial match
   */
  private filterSuggestions(
    suggestions: CompletionSuggestion[],
    partial: string
  ): CompletionSuggestion[] {
    if (!partial) {
      return suggestions;
    }

    const lowerPartial = partial.toLowerCase();

    if (this.config.fuzzyMatch) {
      return suggestions.filter(
        (s) =>
          s.label.toLowerCase().includes(lowerPartial) ||
          s.value.toLowerCase().includes(lowerPartial)
      );
    }

    return suggestions.filter(
      (s) =>
        s.label.toLowerCase().startsWith(lowerPartial) ||
        s.value.toLowerCase().startsWith(lowerPartial)
    );
  }

  /**
   * Move selection up in the suggestion list
   */
  moveUp(): CompletionState {
    if (!this.state.showSuggestions || this.state.suggestions.length === 0) {
      return this.getState();
    }

    this.state.activeIndex =
      this.state.activeIndex > 0
        ? this.state.activeIndex - 1
        : this.state.suggestions.length - 1;

    // Adjust scroll offset if needed
    if (this.state.activeIndex < this.state.scrollOffset) {
      this.state.scrollOffset = this.state.activeIndex;
    }

    return this.getState();
  }

  /**
   * Move selection down in the suggestion list
   */
  moveDown(): CompletionState {
    if (!this.state.showSuggestions || this.state.suggestions.length === 0) {
      return this.getState();
    }

    this.state.activeIndex =
      this.state.activeIndex < this.state.suggestions.length - 1
        ? this.state.activeIndex + 1
        : 0;

    // Adjust scroll offset if needed (assuming visible window of 5 items)
    const visibleWindow = 5;
    if (this.state.activeIndex >= this.state.scrollOffset + visibleWindow) {
      this.state.scrollOffset = this.state.activeIndex - visibleWindow + 1;
    }
    if (this.state.activeIndex < this.state.scrollOffset) {
      this.state.scrollOffset = this.state.activeIndex;
    }

    return this.getState();
  }

  /**
   * Get the currently selected suggestion
   */
  getSelected(): CompletionSuggestion | null {
    if (!this.state.showSuggestions || this.state.suggestions.length === 0) {
      return null;
    }

    return this.state.suggestions[this.state.activeIndex] ?? null;
  }

  /**
   * Accept the currently selected suggestion
   *
   * @param currentInput - Current user input
   * @returns New input with suggestion applied
   */
  acceptSuggestion(currentInput: string): string {
    const selected = this.getSelected();
    if (!selected) {
      return currentInput;
    }

    const { path } = SlashCommandParser.getPartialToken(currentInput);

    // Build the new input with the selected value
    let newInput = '/';

    if (path.length === 0) {
      // Completing root command
      newInput += selected.value;
    } else {
      // Completing subcommand or argument
      newInput += path.join(' ') + ' ' + selected.value;
    }

    // Hide suggestions after accepting
    this.state.showSuggestions = false;

    return newInput;
  }

  /**
   * Hide the suggestion popup
   */
  hideSuggestions(): void {
    this.state.showSuggestions = false;
  }

  /**
   * Show the suggestion popup (if there are suggestions)
   */
  showSuggestions(): void {
    if (this.state.suggestions.length > 0) {
      this.state.showSuggestions = true;
    }
  }

  /**
   * Check if suggestions are currently visible
   */
  isVisible(): boolean {
    return this.state.showSuggestions;
  }

  /**
   * Get all commands grouped by category (for command palette)
   */
  getCommandPalette(): Map<string, CommandDefinition[]> {
    const palette = new Map<string, CommandDefinition[]>();

    for (const category of this.registry.getCategories()) {
      const commands = this.registry.getCommandsByCategory(category.name);
      if (commands.length > 0) {
        palette.set(category.label, commands);
      }
    }

    return palette;
  }

  /**
   * Get flat list of all commands (for simple displays)
   */
  getAllCommands(): CommandDefinition[] {
    return this.registry.getAllCommands();
  }
}

/**
 * Create a completer with a new registry
 */
export function createCompleter(config?: CompleterConfig): SlashCommandCompleter {
  const registry = new SlashCommandRegistry();
  return new SlashCommandCompleter(registry, config);
}
