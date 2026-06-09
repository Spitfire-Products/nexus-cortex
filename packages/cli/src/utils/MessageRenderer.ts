/**
 * MessageRenderer - Renders conversational messages with copy-paste friendly formatting
 *
 * This utility provides consistent rendering for all message types in the CLI conversation
 * interface. Uses color and emoji for visual distinction without boxes that break copy-paste.
 *
 * Design principles:
 * - No boxes in conversation (color + emoji only)
 * - Horizontal separators only (━) - don't interfere with copy
 * - Leverages existing 13-theme system
 * - Preserves copyability of all content
 *
 * @module MessageRenderer
 */

import { ThemeManager } from '../themes/ThemeManager.js';
import type { ExtendedTheme } from '../themes/createTheme.js';
import { formatRelativeTime } from './formatters.js';

export interface ToolExecution {
  name: string;
  args?: any;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: any;
  error?: string;
  duration?: number;
}

export interface DiffLine {
  type: 'context' | 'added' | 'removed';
  lineNumber?: number;
  content: string;
}

/**
 * MessageRenderer - Copy-paste friendly message rendering
 *
 * Renders all conversation elements without boxes, using color and emoji
 * for visual distinction. All output is designed to copy cleanly.
 */
export class MessageRenderer {
  private theme: ExtendedTheme;
  private terminalWidth: number;

  constructor() {
    this.theme = ThemeManager.getExtendedTheme();
    this.terminalWidth = process.stdout.columns || 80;
  }

  /**
   * Renders a user message with timestamp
   *
   * Format:
   * > You (10:32 AM):
   * Message content here
   *
   * @param content - The message text
   * @param timestamp - Optional message timestamp
   */
  renderUserMessage(content: string, timestamp?: Date): string {
    const time = timestamp ? formatRelativeTime(timestamp) : '';
    const timeStr = time ? this.theme.dimmed(` (${time})`) : '';
    const header = `${this.theme.colors.info('>')} ${this.theme.colors.primary('You')}${timeStr}:`;
    return `${header}\n${content}\n`;
  }

  /**
   * Renders an assistant message with model name
   *
   * Format:
   * ◆ Assistant (Grok 4 Fast):
   * Response content here
   *
   * @param content - The response text
   * @param model - Model name/ID
   * @param timestamp - Optional message timestamp
   */
  renderAssistantMessage(
    content: string,
    model: string,
    timestamp?: Date,
  ): string {
    const time = timestamp ? formatRelativeTime(timestamp) : '';
    const timeStr = time ? this.theme.dimmed(` (${time})`) : '';
    const modelStr = this.theme.colors.secondary(model);
    const header = `${this.theme.colors.primary('◆')} ${this.theme.colors.primary('Assistant')} ${this.theme.dimmed('(')}${modelStr}${this.theme.dimmed(')')}${timeStr}:`;
    return `${header}\n${content}\n`;
  }

  /**
   * Renders thinking/reasoning blocks
   *
   * Collapsed format:
   * ▸ Thinking... (collapsed)
   *
   * Expanded format:
   * ▸ Thinking:
   *   Line 1 of thinking
   *   Line 2 of thinking
   *   Line 3 of thinking
   *
   * @param lines - Array of thinking lines
   * @param collapsed - Whether to show collapsed view
   */
  renderThinking(lines: string[], collapsed: boolean = false): string {
    if (collapsed) {
      const count = lines.length;
      const preview =
        (lines[0]?.substring(0, 50) ?? '') + ((lines[0]?.length ?? 0) > 50 ? '...' : '');
      return (
        `${this.theme.dimmed('▸')} ${this.theme.dimmed('Thinking')}... ${this.theme.dimmed(`(${count} lines)`)}\n` +
        ` ${this.theme.dimmed(preview)}\n`
      );
    } else {
      const header = `${this.theme.colors.info('▸')} ${this.theme.colors.info('Thinking')}:`;
      const content = lines.map((line) => ` ${this.theme.dimmed(line)}`).join('\n');
      return `${header}\n${content}\n`;
    }
  }

  /**
   * Renders tool execution start
   *
   * Format:
   * ▸ Running: Write(api/users.ts)
   *
   * @param tool - Tool execution details
   */
  renderToolStart(tool: ToolExecution): string {
    const argsStr = tool.args ? JSON.stringify(tool.args, null, 0) : '';
    const display = argsStr ? `${tool.name}(${argsStr})` : tool.name;
    return ` ${this.theme.dimmed('▸')} ${this.theme.dimmed('Running')}: ${this.theme.function(display)}`;
  }

  /**
   * Renders tool execution success
   *
   * Format:
   * ✓ Write(api/users.ts) - Created user routes (42 lines) (2.3s)
   *
   * @param tool - Tool execution details
   */
  renderToolSuccess(tool: ToolExecution): string {
    const argsStr = tool.args ? JSON.stringify(tool.args, null, 0) : '';
    const display = argsStr ? `${tool.name}(${argsStr})` : tool.name;
    const duration = tool.duration ? ` (${(tool.duration / 1000).toFixed(1)}s)` : '';
    const result = tool.result
      ? ` - ${typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result)}`
      : '';

    return ` ${this.theme.colors.success('✓')} ${this.theme.function(display)}${this.theme.dimmed(result)}${this.theme.dimmed(duration)}`;
  }

  /**
   * Renders tool execution error
   *
   * Format:
   * ✗ Write(api/users.ts) - Error: File already exists (1.2s)
   *
   * @param tool - Tool execution details
   */
  renderToolError(tool: ToolExecution): string {
    const argsStr = tool.args ? JSON.stringify(tool.args, null, 0) : '';
    const display = argsStr ? `${tool.name}(${argsStr})` : tool.name;
    const duration = tool.duration ? ` (${(tool.duration / 1000).toFixed(1)}s)` : '';
    const error = tool.error ? ` - ${this.theme.colors.error(tool.error)}` : '';

    return ` ${this.theme.colors.error('✗')} ${this.theme.function(display)}${error}${this.theme.dimmed(duration)}`;
  }

  /**
   * Renders a list of tool executions with header
   *
   * Format:
   * ▸ Tools:
   *   ✓ Write(api/users.ts) - Created (42 lines) (2.3s)
   *   ✓ Bash(npm install) - Installed (3.1s)
   *
   * @param tools - Array of tool executions
   */
  renderToolList(tools: ToolExecution[]): string {
    if (tools.length === 0) return '';

    const header = `${this.theme.colors.info('▸')} ${this.theme.colors.info('Tools')}:`;
    const toolLines = tools.map((tool) => {
      switch (tool.status) {
        case 'success':
          return this.renderToolSuccess(tool);
        case 'error':
          return this.renderToolError(tool);
        default:
          return this.renderToolStart(tool);
      }
    });

    return `${header}\n${toolLines.join('\n')}\n`;
  }

  /**
   * Renders a horizontal separator
   *
   * Format:
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   *
   * @param char - Character to repeat (default: ━)
   * @param width - Width of separator (default: terminal width)
   */
  renderSeparator(char: string = '━', width?: number): string {
    const w = width || this.terminalWidth;
    return this.theme.dimmed(char.repeat(w)) + '\n';
  }

  /**
   * Renders a section header
   *
   * Format:
   * ━━━ Session Info ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   *
   * @param title - Section title
   */
  renderSectionHeader(title: string): string {
    const prefix = '━━━ ';
    const suffix = ' ';
    const titleWidth = prefix.length + title.length + suffix.length;
    const remainingWidth = this.terminalWidth - titleWidth;
    const line = '━'.repeat(Math.max(0, remainingWidth));

    return (
      this.theme.dimmed(prefix) +
      this.theme.colors.primary(title) +
      this.theme.dimmed(suffix + line) +
      '\n'
    );
  }

  /**
   * Renders an error message
   *
   * Format:
   * ✗ Error: Connection timeout
   *
   * @param message - Error message
   */
  renderError(message: string): string {
    return this.theme.errorMessage(message) + '\n';
  }

  /**
   * Renders a success message
   *
   * Format:
   * ✓ Session saved successfully
   *
   * @param message - Success message
   */
  renderSuccess(message: string): string {
    return this.theme.successMessage(message) + '\n';
  }

  /**
   * Renders a warning message
   *
   * Format:
   * ⚠ Model switching mid-session may affect context
   *
   * @param message - Warning message
   */
  renderWarning(message: string): string {
    return this.theme.warningMessage(message) + '\n';
  }

  /**
   * Renders an info message
   *
   * Format:
   * ℹ Using cached response
   *
   * @param message - Info message
   */
  renderInfo(message: string): string {
    return this.theme.infoMessage(message) + '\n';
  }

  /**
   * Renders input prompt
   *
   * Format:
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * > You: _
   * [i] Try "/" for commands | Ctrl+C to exit
   *
   * @param placeholder - Optional placeholder text
   */
  renderInputPrompt(placeholder?: string): string {
    const separator = this.renderSeparator();
    const prompt = `${this.theme.colors.info('>')} ${this.theme.colors.primary('You')}: `;
    const hint = this.theme.dimmed(
      '[i] Try "/" for commands | Ctrl+C to exit',
    );

    if (placeholder) {
      return `${separator}${prompt}${this.theme.dimmed(placeholder)}\n${hint}\n`;
    }

    return `${separator}${prompt}\n${hint}\n`;
  }

  /**
   * Renders a progress indicator
   *
   * Format:
   * ... Processing... [████████░░░░░░░░░░] 40%
   *
   * @param message - Progress message
   * @param percent - Progress percentage (0-100)
   */
  renderProgress(message: string, percent: number): string {
    const bar = this.theme.progressBar(percent / 100, 20);
    const percentStr = this.theme.dimmed(`${percent.toFixed(0)}%`);
    return `${this.theme.dimmed('...')} ${this.theme.colors.info(message)}... ${bar} ${percentStr}`;
  }

  /**
   * Refreshes theme (call after theme change)
   */
  refreshTheme(): void {
    this.theme = ThemeManager.getExtendedTheme();
  }
}

/**
 * Default singleton instance
 */
export const messageRenderer = new MessageRenderer();
