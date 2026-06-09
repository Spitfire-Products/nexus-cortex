/**
 * CommandPalette - Interactive command discovery UI
 *
 * Displays available commands when user types "/" in chat.
 * Supports filtering and selection.
 *
 * @module CommandPalette
 */

import { ThemeManager } from '../../themes/ThemeManager.js';
import { slashCommandRegistry, type CommandDefinition } from './SlashCommandRegistry.js';

export interface PaletteOptions {
  query?: string;
  showCategories?: boolean;
  maxItems?: number;
}

/**
 * CommandPalette - Displays available commands
 */
export class CommandPalette {
  private theme = ThemeManager.getExtendedTheme();

  /**
   * Render the command palette
   *
   * @param options - Display options
   * @returns Formatted command palette string
   */
  render(options: PaletteOptions = {}): string {
    const { query = '', showCategories = true, maxItems = 20 } = options;

    let commands: CommandDefinition[];

    if (query) {
      // Filter commands by query
      commands = slashCommandRegistry.search(query);
    } else {
      // Show all commands
      commands = slashCommandRegistry.getAllCommands();
    }

    // Limit number of results
    const displayCommands = commands.slice(0, maxItems);

    if (displayCommands.length === 0) {
      return this.renderEmpty(query);
    }

    if (showCategories) {
      return this.renderByCategory(displayCommands, query);
    } else {
      return this.renderFlat(displayCommands);
    }
  }

  /**
   * Render commands grouped by category
   */
  private renderByCategory(commands: CommandDefinition[], query: string): string {
    const categories = slashCommandRegistry.getCategories();
    const lines: string[] = [];

    // Header
    lines.push(this.theme.dimmed('━'.repeat(60)));
    if (query) {
      lines.push(
        `${this.theme.colors.info('▸')} ${this.theme.colors.primary('Commands matching:')} ${this.theme.text(query)}`,
      );
    } else {
      lines.push(
        `${this.theme.colors.info('▸')} ${this.theme.colors.primary('Available Commands')}`,
      );
    }
    lines.push(this.theme.dimmed('━'.repeat(60)));
    lines.push('');

    // Group commands by category
    const commandsByCategory = new Map<string, CommandDefinition[]>();
    commands.forEach((cmd) => {
      if (!commandsByCategory.has(cmd.category)) {
        commandsByCategory.set(cmd.category, []);
      }
      commandsByCategory.get(cmd.category)!.push(cmd);
    });

    // Render each category
    categories.forEach((category) => {
      const categoryCommands = commandsByCategory.get(category.name);
      if (!categoryCommands || categoryCommands.length === 0) {
        return;
      }

      // Category header
      lines.push(
        `${this.theme.colors.info(category.icon)} ${this.theme.colors.secondary(category.description)}`,
      );

      // Commands in category
      categoryCommands.forEach((cmd) => {
        const cmdStr = this.theme.colors.highlight(`/${cmd.name}`);
        const descStr = this.theme.dimmed(` - ${cmd.description}`);
        lines.push(` ${cmdStr}${descStr}`);

        // Show subcommands if any
        if (cmd.subcommands && cmd.subcommands.length > 0) {
          cmd.subcommands.slice(0, 3).forEach((sub) => {
            const subCmdStr = this.theme.dimmed(`/${cmd.name} ${sub.name}`);
            const subDescStr = this.theme.dimmed(` - ${sub.description}`);
            lines.push(` ${subCmdStr}${subDescStr}`);
          });

          if (cmd.subcommands.length > 3) {
            lines.push(
              this.theme.dimmed(` ... and ${cmd.subcommands.length - 3} more`),
            );
          }
        }
      });

      lines.push('');
    });

    // Footer
    lines.push(this.theme.dimmed('━'.repeat(60)));
    lines.push(
      this.theme.dimmed('[i] Type command name to filter | Press Enter to execute'),
    );
    lines.push(this.theme.dimmed('━'.repeat(60)));

    return lines.join('\n');
  }

  /**
   * Render commands in a flat list
   */
  private renderFlat(commands: CommandDefinition[]): string {
    const lines: string[] = [];

    // Header
    lines.push(this.theme.dimmed('━'.repeat(60)));
    lines.push(
      `${this.theme.colors.info('▸')} ${this.theme.colors.primary('Commands')}`,
    );
    lines.push(this.theme.dimmed('━'.repeat(60)));

    // Commands
    commands.forEach((cmd) => {
      const cmdStr = this.theme.colors.highlight(`/${cmd.name}`);
      const descStr = this.theme.dimmed(` - ${cmd.description}`);
      lines.push(` ${cmdStr}${descStr}`);
    });

    // Footer
    lines.push(this.theme.dimmed('━'.repeat(60)));

    return lines.join('\n');
  }

  /**
   * Render empty state (no matching commands)
   */
  private renderEmpty(query: string): string {
    const lines: string[] = [];

    lines.push(this.theme.dimmed('━'.repeat(60)));
    lines.push(
      `${this.theme.colors.warning('▸')} ${this.theme.text('No commands found')}`,
    );

    if (query) {
      lines.push('');
      lines.push(
        this.theme.dimmed(`No commands matching: ${this.theme.text(query)}`),
      );
      lines.push('');
      lines.push(this.theme.dimmed('[i] Try a different search term'));
    }

    lines.push(this.theme.dimmed('━'.repeat(60)));

    return lines.join('\n');
  }

  /**
   * Render command help
   */
  renderHelp(commandName: string): string {
    const command = slashCommandRegistry.getCommand(commandName);

    if (!command) {
      return this.theme.errorMessage(`Command not found: ${commandName}`);
    }

    const lines: string[] = [];

    // Header
    lines.push(this.theme.dimmed('━'.repeat(60)));
    lines.push(
      `${this.theme.colors.info('▸')} ${this.theme.colors.primary('Help:')} ${this.theme.colors.highlight('/' + command.name)}`,
    );
    lines.push(this.theme.dimmed('━'.repeat(60)));
    lines.push('');

    // Description
    lines.push(this.theme.text(command.description));
    lines.push('');

    // Usage
    if (command.usage) {
      lines.push(this.theme.colors.secondary('Usage:'));
      lines.push(` ${this.theme.dimmed(command.usage)}`);
      lines.push('');
    }

    // Subcommands
    if (command.subcommands && command.subcommands.length > 0) {
      lines.push(this.theme.colors.secondary('Subcommands:'));
      command.subcommands.forEach((sub) => {
        lines.push(
          ` ${this.theme.colors.highlight(sub.name)} - ${this.theme.dimmed(sub.description)}`,
        );
        if (sub.usage) {
          lines.push(` ${this.theme.dimmed(sub.usage)}`);
        }
      });
      lines.push('');
    }

    // Examples
    if (command.examples && command.examples.length > 0) {
      lines.push(this.theme.colors.secondary('Examples:'));
      command.examples.forEach((ex) => {
        lines.push(` ${this.theme.dimmed(ex)}`);
      });
      lines.push('');
    }

    lines.push(this.theme.dimmed('━'.repeat(60)));

    return lines.join('\n');
  }

  /**
   * Render quick help (compact version)
   */
  renderQuickHelp(): string {
    const lines: string[] = [];

    lines.push(this.theme.dimmed('━'.repeat(60)));
    lines.push(
      `${this.theme.colors.info('▸')} ${this.theme.colors.primary('Quick Commands')}`,
    );
    lines.push(this.theme.dimmed('━'.repeat(60)));

    const quickCommands = [
      { cmd: '/models list', desc: 'Show all models' },
      { cmd: '/session checkpoint', desc: 'Save checkpoint' },
      { cmd: '/cache metrics', desc: 'Cache statistics' },
      { cmd: '/system-message', desc: 'Manage system messages' },
      { cmd: '/init', desc: 'Generate CORTEX.md context' },
      { cmd: '/help', desc: 'Show all commands' },
      { cmd: '/clear', desc: 'Clear conversation' },
      { cmd: '/exit', desc: 'Exit chat' },
    ];

    quickCommands.forEach(({ cmd, desc }) => {
      lines.push(
        ` ${this.theme.colors.highlight(cmd)} ${this.theme.dimmed('- ' + desc)}`,
      );
    });

    lines.push('');
    lines.push(
      this.theme.dimmed('[i] Type / to see all commands | /help <command> for details'),
    );
    lines.push(this.theme.dimmed('━'.repeat(60)));

    return lines.join('\n');
  }

  /**
   * Render full help with basics, commands, and keyboard shortcuts
   * Similar to neoncortex's Help component
   */
  renderFullHelp(): string {
    const lines: string[] = [];
    const width = 70;
    const borderLine = this.theme.dimmed('─'.repeat(width));
    const doubleLine = this.theme.dimmed('━'.repeat(width));

    // Header
    lines.push(this.theme.roundedBox(
      ' Nexus Cortex Help',
      'fuzzycortex CLI'
    ));
    lines.push('');

    // ═══════════════════════════════════════════════════════════════════
    // BASICS SECTION
    // ═══════════════════════════════════════════════════════════════════
    lines.push(doubleLine);
    lines.push(this.theme.colors.primary(' Basics'));
    lines.push(doubleLine);
    lines.push('');

    lines.push(
      `${this.theme.colors.highlight('@')} ${this.theme.text('Add context')} - ` +
      this.theme.dimmed('Use @ to specify files for context')
    );
    lines.push(
      this.theme.dimmed(' Example: ') +
      this.theme.colors.info('@src/myFile.ts') +
      this.theme.dimmed(' to include a specific file')
    );
    lines.push('');

    lines.push(
      `${this.theme.colors.highlight('!')} ${this.theme.text('Shell mode')} - ` +
      this.theme.dimmed('Execute shell commands directly')
    );
    lines.push(
      this.theme.dimmed(' Example: ') +
      this.theme.colors.info('!npm run build') +
      this.theme.dimmed(' or use natural language')
    );
    lines.push('');

    // ═══════════════════════════════════════════════════════════════════
    // COMMANDS SECTION
    // ═══════════════════════════════════════════════════════════════════
    lines.push(doubleLine);
    lines.push(this.theme.colors.primary(' Commands'));
    lines.push(doubleLine);
    lines.push('');

    // Get all commands grouped by category
    const commands = slashCommandRegistry.getAllCommands();
    const categories = slashCommandRegistry.getCategories();

    // Group commands by category
    const commandsByCategory = new Map<string, CommandDefinition[]>();
    commands.forEach((cmd) => {
      if (!commandsByCategory.has(cmd.category)) {
        commandsByCategory.set(cmd.category, []);
      }
      commandsByCategory.get(cmd.category)!.push(cmd);
    });

    // Render each category
    categories.forEach((category) => {
      const categoryCommands = commandsByCategory.get(category.name);
      if (!categoryCommands || categoryCommands.length === 0) {
        return;
      }

      // Category header with icon
      lines.push(
        `${this.theme.colors.info(category.icon)} ${this.theme.colors.secondary(category.description)}`
      );
      lines.push(borderLine);

      // Commands in category
      categoryCommands.forEach((cmd) => {
        lines.push(
          ` ${this.theme.colors.highlight('/' + cmd.name.padEnd(16))} ` +
          this.theme.dimmed(cmd.description)
        );

        // Show all subcommands
        if (cmd.subcommands && cmd.subcommands.length > 0) {
          cmd.subcommands.forEach((sub) => {
            lines.push(
              ` ${this.theme.dimmed(sub.name.padEnd(14))} ` +
              this.theme.dimmed('- ' + sub.description)
            );
          });
        }
      });
      lines.push('');
    });

    // ═══════════════════════════════════════════════════════════════════
    // KEYBOARD SHORTCUTS SECTION
    // ═══════════════════════════════════════════════════════════════════
    lines.push(doubleLine);
    lines.push(this.theme.colors.primary('⌨  Keyboard Shortcuts'));
    lines.push(doubleLine);
    lines.push('');

    const shortcuts = [
      // Navigation
      { key: 'Enter', desc: 'Send message / Execute command' },
      { key: 'Ctrl+C', desc: 'Quit application' },
      { key: 'Esc', desc: 'Cancel operation / Hide autocomplete' },
      { key: '', desc: '' }, // Separator

      // Input editing
      { key: '←/→', desc: 'Move cursor left/right' },
      { key: '↑/↓', desc: 'Navigate autocomplete / History / Multiline' },
      { key: 'Alt+←/→', desc: 'Jump through words' },
      { key: 'Alt+↑/↓', desc: 'Jump 5 lines up/down' },
      { key: 'Alt+Backspace', desc: 'Delete previous word' },
      { key: 'Ctrl+W', desc: 'Delete previous word (bash-style)' },
      { key: '', desc: '' }, // Separator

      // Line editing
      { key: 'Ctrl+A', desc: 'Move to start of line' },
      { key: 'Home', desc: 'Move to start of line' },
      { key: 'End', desc: 'Move to end of line' },
      { key: 'Ctrl+K', desc: 'Delete to end of line' },
      { key: 'Ctrl+U', desc: 'Clear entire line' },
      { key: '', desc: '' }, // Separator

      // Toggles
      { key: 'Tab', desc: 'Accept autocomplete / Toggle thinking mode' },
      { key: 'Shift+Tab', desc: 'Toggle auto-approve mode' },
      { key: 'Ctrl+E', desc: 'Toggle document expand/collapse' },
      { key: '', desc: '' }, // Separator

      // Slash command shortcuts
      { key: '/', desc: 'Open slash command menu' },
    ];

    shortcuts.forEach(({ key, desc }) => {
      if (!key) {
        // Empty line separator
        lines.push('');
      } else {
        lines.push(
          ` ${this.theme.colors.highlight(key.padEnd(18))} ` +
          this.theme.dimmed(desc)
        );
      }
    });

    lines.push('');

    // ═══════════════════════════════════════════════════════════════════
    // FOOTER
    // ═══════════════════════════════════════════════════════════════════
    lines.push(doubleLine);
    lines.push(
      this.theme.dimmed('[i] ') +
      this.theme.colors.info('/help <command>') +
      this.theme.dimmed(' for detailed help on a specific command')
    );
    lines.push(
      this.theme.dimmed('[i] ') +
      this.theme.colors.info('/') +
      this.theme.dimmed(' to open the interactive command menu')
    );
    lines.push(doubleLine);

    return lines.join('\n');
  }

  /**
   * Refresh theme (call after theme change)
   */
  refreshTheme(): void {
    this.theme = ThemeManager.getExtendedTheme();
  }
}

/**
 * Global palette instance
 */
export const commandPalette = new CommandPalette();
