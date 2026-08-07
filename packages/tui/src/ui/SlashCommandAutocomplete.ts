/**
 * Slash Command Autocomplete Popup
 *
 * Renders an autocomplete dropdown for slash commands in the fuzzycortex chalk CLI.
 * Shows command suggestions as user types "/" with fuzzy matching support.
 */

import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';
import {
  slashCommandRegistry,
  SlashCommandParser,
} from '@nexus-cortex/cli/dist/commands/slash/index.js';

/**
 * Category icons for visual distinction
 */
const CATEGORY_ICONS: Record<string, string> = {
  models: '',
  session: '',
  cache: '',
  mcp: '',
  tools: '',
  config: '⚙',
  system: '⚡',
};

/**
 * Autocomplete state
 */
export interface AutocompleteState {
  /** Whether popup is visible */
  visible: boolean;
  /** Current suggestions */
  suggestions: AutocompleteSuggestion[];
  /** Selected index */
  selectedIndex: number;
  /** Scroll offset for windowed display */
  scrollOffset: number;
  /** Current input being completed */
  input: string;
  /** Number of lines rendered (for clearing) */
  renderedLines: number;
}

/**
 * Extended suggestion with category info
 */
export interface AutocompleteSuggestion {
  label: string;
  value: string;
  description?: string;
  category?: string;
  type: 'command' | 'subcommand' | 'argument';
}

/**
 * Create initial autocomplete state
 */
export function createAutocompleteState(): AutocompleteState {
  return {
    visible: false,
    suggestions: [],
    selectedIndex: 0,
    scrollOffset: 0,
    input: '',
    renderedLines: 0,
  };
}

/**
 * Slash Command Autocomplete Manager
 *
 * Handles the autocomplete popup rendering and state management
 * for fuzzycortex's raw terminal input.
 */
export class SlashCommandAutocomplete {
  private state: AutocompleteState;
  private maxVisible: number;

  constructor(maxVisible = 8) {
    this.state = createAutocompleteState();
    this.maxVisible = maxVisible;
  }

  /**
   * Get current state
   */
  getState(): AutocompleteState {
    return { ...this.state };
  }

  /**
   * Check if popup is visible
   */
  isVisible(): boolean {
    return this.state.visible;
  }

  /**
   * Update suggestions based on input
   */
  async update(input: string): Promise<void> {
    this.state.input = input;

    // Only show popup when input starts with /
    if (!input.startsWith('/')) {
      this.hide();
      return;
    }

    // Get partial token being typed
    const { path, partial } = SlashCommandParser.getPartialToken(input);

    let suggestions: AutocompleteSuggestion[] = [];

    if (path.length === 0) {
      // Completing root command - show all commands or filter by partial
      const allCommands = slashCommandRegistry.getAllCommands();
      const filtered = partial
        ? allCommands.filter(cmd =>
            cmd.name.toLowerCase().startsWith(partial.toLowerCase()) ||
            cmd.altName?.toLowerCase().startsWith(partial.toLowerCase())
          )
        : allCommands;

      suggestions = filtered.map(cmd => ({
        label: cmd.name,
        value: cmd.name,
        description: cmd.description,
        category: cmd.category,
        type: 'command' as const,
      }));
    } else if (path.length === 1) {
      // Completing subcommand
      const command = slashCommandRegistry.getCommand(path[0]!);
      if (command?.subcommands) {
        const filtered = partial
          ? command.subcommands.filter(sub =>
              sub.name.toLowerCase().startsWith(partial.toLowerCase()) ||
              sub.altName?.toLowerCase().startsWith(partial.toLowerCase())
            )
          : command.subcommands;

        suggestions = filtered.map(sub => ({
          label: sub.name,
          value: sub.name,
          description: sub.description,
          category: command.category,
          type: 'subcommand' as const,
        }));
      }
    }

    // Update state
    this.state.suggestions = suggestions;
    this.state.selectedIndex = 0;
    this.state.scrollOffset = 0;
    this.state.visible = suggestions.length > 0;
  }

  /**
   * Move selection up
   */
  moveUp(): void {
    if (!this.state.visible || this.state.suggestions.length === 0) return;

    this.state.selectedIndex =
      this.state.selectedIndex > 0
        ? this.state.selectedIndex - 1
        : this.state.suggestions.length - 1;

    // Adjust scroll
    if (this.state.selectedIndex < this.state.scrollOffset) {
      this.state.scrollOffset = this.state.selectedIndex;
    }
  }

  /**
   * Move selection down
   */
  moveDown(): void {
    if (!this.state.visible || this.state.suggestions.length === 0) return;

    this.state.selectedIndex =
      this.state.selectedIndex < this.state.suggestions.length - 1
        ? this.state.selectedIndex + 1
        : 0;

    // Adjust scroll
    if (this.state.selectedIndex >= this.state.scrollOffset + this.maxVisible) {
      this.state.scrollOffset = this.state.selectedIndex - this.maxVisible + 1;
    }
    if (this.state.selectedIndex < this.state.scrollOffset) {
      this.state.scrollOffset = this.state.selectedIndex;
    }
  }

  /**
   * Get the selected suggestion
   */
  getSelected(): AutocompleteSuggestion | null {
    if (!this.state.visible || this.state.suggestions.length === 0) {
      return null;
    }
    return this.state.suggestions[this.state.selectedIndex] ?? null;
  }

  /**
   * Accept current selection and return new input
   */
  accept(): string | null {
    const selected = this.getSelected();
    if (!selected) return null;

    const { path } = SlashCommandParser.getPartialToken(this.state.input);

    // Build new input with selected value
    let newInput = '/';
    if (path.length === 0) {
      // Selected a root command
      newInput += selected.value;
    } else {
      // Selected a subcommand
      newInput += path.join(' ') + ' ' + selected.value;
    }

    this.hide();
    return newInput;
  }

  /**
   * Hide the popup
   */
  hide(): void {
    this.state.visible = false;
    this.state.suggestions = [];
    this.state.selectedIndex = 0;
    this.state.scrollOffset = 0;
  }

  /**
   * Render the autocomplete popup
   * Returns array of lines to display
   */
  render(): string[] {
    if (!this.state.visible || this.state.suggestions.length === 0) {
      this.state.renderedLines = 0;
      return [];
    }

    const theme = ThemeManager.getExtendedTheme();
    const lines: string[] = [];
    const termWidth = process.stdout.columns || 80;
    const boxWidth = Math.min(60, termWidth - 4);

    // Calculate visible window
    const visibleSuggestions = this.state.suggestions.slice(
      this.state.scrollOffset,
      this.state.scrollOffset + this.maxVisible
    );

    const showUpArrow = this.state.scrollOffset > 0;
    const showDownArrow =
      this.state.scrollOffset + this.maxVisible < this.state.suggestions.length;

    // Box top border
    lines.push(theme.colors.info('╭' + '─'.repeat(boxWidth - 2) + '╮'));

    // Header
    const headerText = ` Commands (${this.state.suggestions.length}) `;
    const headerPadding = Math.max(0, boxWidth - 4 - headerText.length);
    lines.push(
      theme.colors.info('│') +
      theme.dimmed(headerText) +
      ' '.repeat(headerPadding) +
      theme.colors.info('│')
    );

    // Separator
    lines.push(theme.colors.info('├' + '─'.repeat(boxWidth - 2) + '┤'));

    // Up arrow indicator
    if (showUpArrow) {
      lines.push(
        theme.colors.info('│') +
        theme.dimmed(' ▲ more') +
        ' '.repeat(boxWidth - 12) +
        theme.colors.info('│')
      );
    }

    // Suggestions
    for (let i = 0; i < visibleSuggestions.length; i++) {
      const suggestion = visibleSuggestions[i]!;
      const actualIndex = this.state.scrollOffset + i;
      const isSelected = actualIndex === this.state.selectedIndex;

      const icon = CATEGORY_ICONS[suggestion.category || ''] || '•';
      const indicator = isSelected ? theme.colors.info('❯') : ' ';

      // Format: ❯  models      - List and manage AI models
      const labelWidth = 12;
      const label = suggestion.label.padEnd(labelWidth);
      const descMaxWidth = boxWidth - labelWidth - 8; // icon, indicator, padding, borders
      const desc = (suggestion.description || '').slice(0, descMaxWidth);

      let line = ` ${indicator} ${icon} `;
      if (isSelected) {
        line += theme.colors.info(label);
      } else {
        line += theme.colors.success(label);
      }
      line += theme.dimmed(' - ' + desc);

      // Pad to box width
      const visibleLength = label.length + desc.length + 9; // rough estimate
      const padding = Math.max(0, boxWidth - visibleLength - 4);
      line += ' '.repeat(padding);

      lines.push(theme.colors.info('│') + line + theme.colors.info('│'));
    }

    // Down arrow indicator
    if (showDownArrow) {
      lines.push(
        theme.colors.info('│') +
        theme.dimmed(' ▼ more') +
        ' '.repeat(boxWidth - 12) +
        theme.colors.info('│')
      );
    }

    // Footer with hints
    lines.push(theme.colors.info('├' + '─'.repeat(boxWidth - 2) + '┤'));
    const hints = ' ↑↓ select • Tab complete • Enter run • Esc close ';
    const hintsPadding = Math.max(0, boxWidth - 4 - hints.length);
    lines.push(
      theme.colors.info('│') +
      theme.dimmed(hints) +
      ' '.repeat(hintsPadding) +
      theme.colors.info('│')
    );

    // Box bottom border
    lines.push(theme.colors.info('╰' + '─'.repeat(boxWidth - 2) + '╯'));

    this.state.renderedLines = lines.length;
    return lines;
  }

  /**
   * Get number of lines last rendered (for clearing)
   */
  getRenderedLineCount(): number {
    return this.state.renderedLines;
  }
}

/**
 * Global autocomplete instance
 */
export const slashCommandAutocomplete = new SlashCommandAutocomplete();
