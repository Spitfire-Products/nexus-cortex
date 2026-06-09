/**
 * ToolFormatter - Clean, structured formatting for tool calls and results
 *
 * Uses a clean, hierarchical format:
 * ● ToolName(params)
 *   ⎿ Result summary
 *      Line-wrapped details with proper indentation
 *
 * Design principles:
 * - Bullet (●) for tool actions
 * - Tree connector (⎿) for results
 * - Automatic line wrapping at 80 chars
 * - Diff display for file edits with line numbers
 * - Clean, copy-paste friendly output
 *
 * @module ToolFormatter
 */

import { ThemeManager } from '../themes/ThemeManager.js';
import type { ExtendedTheme } from '../themes/createTheme.js';

// Import shared diff types from core and re-export for backwards compatibility
import type {
  ParsedDiff,
  DiffChunk as CoreDiffChunk,
  DiffLine as CoreDiffLine,
} from '@nexus-cortex/core';

// Re-export shared types for backwards compatibility
// These aliases ensure existing code importing from ToolFormatter still works
export type DiffContent = ParsedDiff;
export type DiffChunk = CoreDiffChunk;
export type DiffLine = CoreDiffLine;

// Also re-export the parser functions for convenience
export { parseUnifiedDiff, generateAndParseDiff } from '@nexus-cortex/core';

export interface ToolCall {
  name: string;
  params?: Record<string, any>;
}

export interface ToolResult {
  summary?: string;
  details?: string;
  diff?: DiffContent;
  error?: string;
}

export interface FileContent {
  file: string;
  content: string;
  lineCount: number;
  preview?: boolean; // If true, show truncated preview with "..." indicator
}

/**
 * ToolFormatter - Formats tool calls and results in a clean, structured way
 */
export class ToolFormatter {
  private theme: ExtendedTheme;

  constructor() {
    this.theme = ThemeManager.getExtendedTheme();
  }

  /**
   * Get current terminal width (or fallback to 80)
   */
  private getTerminalWidth(): number {
    return process.stdout.columns || 80;
  }

  /**
   * Formats a tool call header
   *
   * Format: ● ToolName(param1, param2)
   */
  formatToolCall(tool: ToolCall): string {
    const bullet = this.theme.colors.info('●');
    const toolName = this.theme.function(tool.name);

    if (!tool.params || Object.keys(tool.params).length === 0) {
      return `${bullet} ${toolName}\n`;
    }

    // Format parameters cleanly
    const params = this.formatParams(tool.name, tool.params);
    return `${bullet} ${toolName}(${params})\n`;
  }

  /**
   * Formats a tool result
   *
   * Format:
   *   ⎿ Summary text
   *      Additional details wrapped at 80 chars
   */
  formatToolResult(result: ToolResult): string {
    if (result.error) {
      return this.formatError(result.error);
    }

    const connector = this.theme.dimmed(' ⎿');
    let output = '';

    // Summary line
    if (result.summary) {
      output += `${connector}  ${result.summary}\n`;
    }

    // Details (indented further)
    if (result.details) {
      const wrappedDetails = this.wrapText(result.details, this.getTerminalWidth() - 7);
      output += wrappedDetails
        .split('\n')
        .map(line => ` ${this.theme.dimmed(line)}`)
        .join('\n') + '\n';
    }

    // Diff display
    if (result.diff) {
      output += this.formatDiff(result.diff);
    }

    return output;
  }

  /**
   * Formats an error result
   */
  private formatError(error: string): string {
    const connector = this.theme.dimmed(' ⎿');
    const firstLine = error.split('\n')[0] || error;
    const truncated = firstLine.length > 120 ? firstLine.substring(0, 117) + '...' : firstLine;
    const errorText = this.theme.colors.error(`Error: ${truncated}`);
    return `${connector}  ${errorText}\n`;
  }

  /**
   * Formats tool parameters for display
   */
  private formatParams(toolName: string, params: Record<string, any>): string {
    const entries = Object.entries(params);

    // Special handling for Bash tool - prefer description, or show command if no description
    if (toolName === 'Bash') {
      const description = params.description;
      const command = params.command;

      if (description) {
        // Show just description (already truncated by LLM typically)
        const truncated = description.length > 60 ? description.substring(0, 57) + '...' : description;
        return this.theme.dimmed(truncated);
      } else if (command) {
        // No description, show command
        const truncated = command.length > 60 ? command.substring(0, 57) + '...' : command;
        return this.theme.dimmed(truncated);
      }
    }

    // For simple cases, inline the params
    if (entries.length === 1) {
      const firstEntry = entries[0];
      if (!firstEntry) return '';

      const [key, value] = firstEntry;
      const valueStr = typeof value === 'string' ? value : JSON.stringify(value);

      // For file paths or simple strings, show directly
      if (key === 'file_path' || key === 'path' || key === 'command') {
        return this.theme.dimmed(valueStr);
      }
    }

    // For complex cases, show key=value pairs
    return entries
      .map(([key, value]) => {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        // Truncate long values
        const truncated = valueStr.length > 50 ? valueStr.substring(0, 47) + '...' : valueStr;
        return `${key}=${this.theme.dimmed(truncated)}`;
      })
      .join(', ');
  }

  /**
   * Wraps text to fit within max width
   */
  private wrapText(text: string, maxWidth: number): string {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (testLine.length <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) lines.push(currentLine);
    return lines.join('\n');
  }

  /**
   * Formats a file diff with line numbers and +/- indicators
   * New style with box drawing characters and line numbers on left
   * Optionally includes "Edit file" header
   */
  formatDiff(diff: DiffContent, showEditHeader: boolean = false): string {
    let output = '';
    const width = this.getTerminalWidth() - 5; // Leave margin
    const horizontalRule = '╌'.repeat(width);

    // Optional "Proposed edit" header (shown before permission approval)
    if (showEditHeader) {
      output += '\n' + this.theme.dimmed('─'.repeat(width)) + '\n';
      output += this.theme.colors.warning(' Proposed edit: ') + diff.file + '\n';
    }

    // Top border
    output += this.theme.dimmed(horizontalRule) + '\n';

    // Process each chunk - show complete diff without truncation
    for (const chunk of diff.chunks) {
      // Context before
      for (const line of chunk.contextBefore) {
        output += this.formatDiffLineNew(line);
      }

      // Changes
      for (const line of chunk.changes) {
        output += this.formatDiffLineNew(line);
      }

      // Context after
      for (const line of chunk.contextAfter) {
        output += this.formatDiffLineNew(line);
      }
    }

    // Bottom border
    output += this.theme.dimmed(horizontalRule) + '\n';

    return output;
  }

  /**
   * Formats a single diff line with new style (no background, cleaner)
   */
  private formatDiffLineNew(line: DiffLine): string {
    // Use correct line number based on type
    let lineNumber: number;
    if (line.type === 'added' && line.newLineNumber !== undefined) {
      lineNumber = line.newLineNumber;
    } else if (line.type === 'removed' && line.oldLineNumber !== undefined) {
      lineNumber = line.oldLineNumber;
    } else if (line.oldLineNumber !== undefined) {
      lineNumber = line.oldLineNumber;
    } else if (line.lineNumber !== undefined) {
      lineNumber = line.lineNumber;
    } else {
      lineNumber = 0;
    }

    const lineNum = String(lineNumber).padStart(4, ' ');
    const prefix = line.type === 'added' ? ' +' : line.type === 'removed' ? ' -' : ' ';

    // ANSI color codes for muted backgrounds with white text
    const reset = '\x1b[0m';
    const redBg = '\x1b[97;48;5;52m';    // White text on muted red background
    const greenBg = '\x1b[97;48;5;22m';  // White text on muted green background

    // Handle line wrapping for long lines
    const maxWidth = this.getTerminalWidth() - 15; // Account for line numbers and prefix
    if (line.content.length <= maxWidth) {
      // Single line
      const formattedLine = `${lineNum} ${prefix}  ${line.content}`;
      if (line.type === 'added') {
        return `${greenBg}${formattedLine}${reset}\n`;
      } else if (line.type === 'removed') {
        return `${redBg}${formattedLine}${reset}\n`;
      } else {
        return this.theme.dimmed(formattedLine) + '\n';
      }
    } else {
      // Wrap long line with continuation
      const firstPart = line.content.substring(0, maxWidth);
      const remaining = line.content.substring(maxWidth);

      const formattedFirst = `${lineNum} ${prefix}  ${firstPart}`;
      const formattedCont = ` ${prefix}  ${remaining}`;

      if (line.type === 'added') {
        return `${greenBg}${formattedFirst}${reset}\n` +
               `${greenBg}${formattedCont}${reset}\n`;
      } else if (line.type === 'removed') {
        return `${redBg}${formattedFirst}${reset}\n` +
               `${redBg}${formattedCont}${reset}\n`;
      } else {
        return this.theme.dimmed(formattedFirst) + '\n' +
               this.theme.dimmed(formattedCont) + '\n';
      }
    }
  }

  /**
   * Formats file content preview with line numbers
   * Matches WritePreview component style: "+ Creating filename (N lines, X KB) [language]"
   */
  formatFileContent(fileContent: FileContent): string {
    let output = '\n';
    const termWidth = this.getTerminalWidth();

    // Detect language from file extension
    const ext = fileContent.file.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      'py': 'python', 'js': 'javascript', 'ts': 'typescript', 'tsx': 'typescript',
      'jsx': 'javascript', 'rs': 'rust', 'go': 'go', 'java': 'java',
      'c': 'c', 'cpp': 'c++', 'h': 'c', 'rb': 'ruby', 'sh': 'shell',
      'bash': 'shell', 'zsh': 'shell', 'md': 'markdown', 'json': 'json',
      'yaml': 'yaml', 'yml': 'yaml', 'html': 'html', 'css': 'css',
    };
    const language = ext ? langMap[ext] : undefined;

    // Format byte size
    const byteSize = new TextEncoder().encode(fileContent.content).length;
    const formatBytes = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    // Truncate path for display (show last 2 segments)
    const pathParts = fileContent.file.split('/');
    const displayPath = pathParts.length > 2
      ? pathParts.slice(-2).join('/')
      : fileContent.file;

    // Header line: "+ Creating filename (N lines, X KB) [language]"
    output += ' ' + this.theme.colors.success('+ Creating ');
    output += this.theme.colors.primary(displayPath);
    output += this.theme.dimmed(` (${fileContent.lineCount} lines, ${formatBytes(byteSize)})`);
    if (language) {
      output += this.theme.dimmed(` [${language}]`);
    }
    output += '\n';

    // Content lines with line numbers
    const lines = fileContent.content.split('\n');
    const maxLines = fileContent.preview ? 50 : lines.length;
    const displayLines = lines.slice(0, maxLines);

    // Calculate code width: terminal - indent(4) - lineNum(7) - some margin
    const codeWidth = Math.max(termWidth - 14, 30);

    displayLines.forEach((line, lineIndex) => {
      // Wrap long lines
      const wrappedLines = this.wrapCodeLine(line, codeWidth);
      wrappedLines.forEach((wrappedLine, wrapIndex) => {
        if (wrapIndex === 0) {
          // First line shows line number
          const lineNum = String(lineIndex + 1).padStart(4, ' ');
          output += ' ' + this.theme.dimmed(`${lineNum} │ `) + wrappedLine + '\n';
        } else {
          // Continuation lines align with code
          output += ' ' + this.theme.dimmed(' │ ') + wrappedLine + '\n';
        }
      });
    });

    // Show truncation if needed
    if (fileContent.preview && lines.length > maxLines) {
      const remaining = lines.length - maxLines;
      output += ' ' + this.theme.dimmed(` ... ${remaining} more line${remaining !== 1 ? 's' : ''}`) + '\n';
    }

    return output;
  }

  /**
   * Wrap code line to fit width, breaking at logical points
   */
  private wrapCodeLine(text: string, width: number): string[] {
    if (width <= 0 || !text || text.length <= width) return [text];

    const result: string[] = [];
    let remaining = text;

    while (remaining.length > width) {
      let breakPoint = width;
      const breakChars = [' ', ',', '(', ')', '{', '}', '[', ']', '+', '-', '=', '/', '|', '&'];
      for (const char of breakChars) {
        const lastIndex = remaining.lastIndexOf(char, width);
        if (lastIndex > width * 0.4) {
          breakPoint = lastIndex + 1;
          break;
        }
      }
      result.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint);
    }

    if (remaining) {
      result.push(remaining);
    }

    return result.length > 0 ? result : [''];
  }

  /**
   * Formats a simple status line
   *
   * Format:
   *   ⎿ Read 15 lines
   *   ⎿ Found 1 file (ctrl+o to expand)
   */
  formatStatus(message: string): string {
    const connector = this.theme.dimmed(' ⎿');
    return `${connector}  ${this.theme.dimmed(message)}\n`;
  }
}
