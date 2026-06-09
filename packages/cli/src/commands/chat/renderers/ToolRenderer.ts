/**
 * Tool execution renderer
 * Displays tool calls and results with visual formatting
 */

import { Theme } from '../../../themes/Theme.interface.js';
import { createBox } from '../../../utils/boxDrawing.js';

export interface ToolCall {
  id: string;
  name: string;
  input: any;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: any;
  error?: string;
}

export class ToolRenderer {
  constructor(private theme: Theme) {}

  /**
   * Render a tool call start
   */
  renderToolStart(tool: ToolCall): string {
    const { name, input } = tool;
    const icon = this.theme.icons.loading;
    const title = `${icon} ${name}`;

    // Format input parameters
    const inputLines = this.formatInput(input);

    const content = [
      this.theme.colors.muted('Parameters:'),
      ...inputLines,
      '',
      this.theme.colors.warning('Status: ● Running...'),
    ].join('\n');

    return createBox(content, {
      title,
      color: this.theme.colors.warning,
      padding: 1,
    });
  }

  /**
   * Render a tool call result
   */
  renderToolResult(tool: ToolCall): string {
    const { name, result, error, status } = tool;

    const isSuccess = status === 'success';
    const icon = isSuccess ? this.theme.icons.success : this.theme.icons.error;
    const title = `${icon} ${name}`;
    const color = isSuccess ? this.theme.colors.success : this.theme.colors.error;

    let content: string;

    if (error) {
      content = this.theme.colors.error(error);
    } else if (typeof result === 'string') {
      // Limit output length
      const maxLines = 20;
      const lines = result.split('\n');
      if (lines.length > maxLines) {
        const truncatedLines = lines.slice(0, maxLines);
        const remainingCount = lines.length - maxLines;
        content = truncatedLines.join('\n') +
          this.theme.colors.muted(`\n... (${remainingCount} more lines)`);
      } else {
        content = result;
      }
    } else if (result) {
      content = JSON.stringify(result, null, 2);
    } else {
      content = this.theme.colors.muted('(no output)');
    }

    return createBox(content, {
      title,
      color,
      padding: 1,
    });
  }

  /**
   * Format tool input parameters
   */
  private formatInput(input: any): string[] {
    if (!input) return [this.theme.colors.muted('(none)')];

    const lines: string[] = [];

    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string') {
        // Show first 100 chars of strings
        const displayValue = value.length > 100
          ? value.slice(0, 100) + this.theme.colors.muted('...')
          : value;
        lines.push(` ${this.theme.colors.info(key)}: ${displayValue}`);
      } else {
        lines.push(` ${this.theme.colors.info(key)}: ${JSON.stringify(value)}`);
      }
    }

    return lines;
  }
}
