/**
 * MarkdownRenderer - Render markdown text to styled terminal output
 *
 * Converts streaming markdown text to formatted terminal output with:
 * - Headers (# ## ###)
 * - Code blocks (```)
 * - Inline code (`code`)
 * - Bold (**text**)
 * - Italic (*text*)
 * - Lists (- item, 1. item)
 * - Links ([text](url))
 * - Blockquotes (> text)
 *
 * @module MarkdownRenderer
 */

import chalk from 'chalk';
import { ThemeManager } from '../themes/ThemeManager.js';
import type { ExtendedTheme } from '../themes/createTheme.js';

export interface MarkdownRenderOptions {
  /** Width for wrapping text (default: terminal width or 80) */
  maxWidth?: number;
  /** Enable syntax highlighting in code blocks */
  syntaxHighlight?: boolean;
  /** Indentation for text blocks (default: 2 spaces) */
  indent?: string;
  /** Use dynamic terminal width (default: true) */
  dynamicWidth?: boolean;
}

/**
 * Stateful markdown renderer for streaming text
 */
export class MarkdownRenderer {
  private theme: ExtendedTheme;
  private options: Required<MarkdownRenderOptions>;
  private inCodeBlock: boolean = false;
  private codeBlockLanguage: string = '';
  private buffer: string = '';

  constructor(options: MarkdownRenderOptions = {}) {
    this.theme = ThemeManager.getExtendedTheme();
    this.options = {
      maxWidth: options.maxWidth ?? 80,
      syntaxHighlight: options.syntaxHighlight ?? false,
      indent: options.indent ?? ' ', // 2 spaces by default
      dynamicWidth: options.dynamicWidth ?? true
    };
  }

  /**
   * Get current rendering width (terminal width or configured max)
   */
  private getCurrentWidth(): number {
    if (this.options.dynamicWidth && process.stdout.columns) {
      return process.stdout.columns;
    }
    return this.options.maxWidth;
  }

  /**
   * Process streaming text chunk and return formatted output
   */
  processChunk(chunk: string): string {
    this.buffer += chunk;

    // Normalize list items: Replace patterns like " • " or " - " in the middle of lines
    // with proper newlines to split them (Gemini sometimes sends multiple bullets on one line)
    this.buffer = this.buffer.replace(/([^\n])\s{2,}([•\-\*])\s+/g, '$1\n$2 ');

    // Process complete lines
    const lines = this.buffer.split('\n');

    // Keep last incomplete line in buffer
    if (!chunk.endsWith('\n')) {
      this.buffer = lines.pop() || '';
    } else {
      this.buffer = '';
    }

    return lines.map(line => this.formatLine(line)).join('\n');
  }

  /**
   * Flush any remaining buffered content
   */
  flush(): string {
    if (this.buffer) {
      const formatted = this.formatLine(this.buffer);
      this.buffer = '';
      return formatted;
    }
    return '';
  }

  /**
   * Format a single line of markdown
   */
  private formatLine(line: string): string {
    // Check for code block delimiters
    if (line.trim().startsWith('```')) {
      if (!this.inCodeBlock) {
        // Start of code block
        this.inCodeBlock = true;
        this.codeBlockLanguage = line.trim().substring(3).trim();
        return this.theme.dimmed('─'.repeat(this.getCurrentWidth()));
      } else {
        // End of code block
        this.inCodeBlock = false;
        this.codeBlockLanguage = '';
        return this.theme.dimmed('─'.repeat(this.getCurrentWidth()));
      }
    }

    // Inside code block - apply code formatting
    if (this.inCodeBlock) {
      return this.formatCodeLine(line);
    }

    // Headers - all get consistent indent
    if (line.startsWith('# ')) {
      return '\n' + this.options.indent + chalk.bold(this.theme.colors.primary(line.substring(2))) + '\n';
    }
    if (line.startsWith('## ')) {
      return '\n' + this.options.indent + chalk.bold(this.theme.colors.secondary(line.substring(3))) + '\n';
    }
    if (line.startsWith('### ')) {
      return this.options.indent + chalk.bold(this.theme.colors.info(line.substring(4)));
    }
    if (line.startsWith('#### ')) {
      return this.options.indent + chalk.bold(line.substring(5));
    }

    // Blockquotes - consistent indent
    if (line.trim().startsWith('> ')) {
      const content = line.trim().substring(2);
      return this.options.indent + this.theme.dimmed('│ ') + this.theme.dimmed(content);
    }

    // Unordered lists - consistent indent
    if (line.trim().match(/^[-*+]\s/)) {
      // Remove bullet and ALL following whitespace, then trim
      const content = line.trim().replace(/^[-*+]\s+/, '').trim();
      const formatted = this.formatInline(content);
      const bullet = this.theme.colors.info('• ');
      const baseIndent = this.options.indent; // " "
      const bulletIndent = baseIndent + ' '; // " " for continuation lines
      // Wrap content accounting for bullet width
      const wrapped = this.wrapText(formatted, this.getCurrentWidth(), bulletIndent);
      const lines = wrapped.split('\n');
      // First line gets base indent + bullet, rest get bullet indent
      return lines.map((l, i) => (i === 0 ? baseIndent + bullet + l.substring(bulletIndent.length) : l)).join('\n');
    }

    // Ordered lists - consistent indent
    const orderedMatch = line.trim().match(/^(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      const num = orderedMatch[1];
      const content = orderedMatch[2]?.trim() || '';
      const formatted = this.formatInline(content);
      const prefix = this.theme.colors.info(`${num}. `);
      const baseIndent = this.options.indent; // " "
      const prefixIndent = baseIndent + ' '.repeat(num!.length + 2); // " " or more for continuation
      // Wrap content accounting for prefix width
      const wrapped = this.wrapText(formatted, this.getCurrentWidth(), prefixIndent);
      const lines = wrapped.split('\n');
      // First line gets base indent + prefix, rest get prefix indent
      return lines.map((l, i) => (i === 0 ? baseIndent + prefix + l.substring(prefixIndent.length) : l)).join('\n');
    }

    // Horizontal rules - no indent, full width
    if (line.trim().match(/^[-*_]{3,}$/)) {
      return this.theme.dimmed('─'.repeat(this.getCurrentWidth()));
    }

    // Regular text with inline formatting and word wrapping
    const formatted = this.formatInline(line);
    // Preserve empty lines
    if (!line.trim()) {
      return '';
    }
    // Indent regular text with 2 spaces (1 tab)
    return this.wrapText(formatted, this.getCurrentWidth(), this.options.indent);
  }

  /**
   * Format inline markdown elements
   */
  private formatInline(text: string): string {
    let result = text;

    // Inline code: `code`
    result = result.replace(/`([^`]+)`/g, (_, code) => {
      return this.theme.function(code);
    });

    // Bold: **text** or __text__
    result = result.replace(/\*\*([^*]+)\*\*/g, (_, text) => {
      return chalk.bold(text);
    });
    result = result.replace(/__([^_]+)__/g, (_, text) => {
      return chalk.bold(text);
    });

    // Italic: *text* or _text_ (but not inside words)
    result = result.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, (_, text) => {
      return chalk.italic(text);
    });
    result = result.replace(/(?<!\w)_([^_]+)_(?!\w)/g, (_, text) => {
      return chalk.italic(text);
    });

    // Links: [text](url)
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
      return this.theme.colors.info(text) + this.theme.dimmed(` (${url})`);
    });

    return result;
  }

  /**
   * Format a line inside a code block
   */
  private formatCodeLine(line: string): string {
    // Apply syntax highlighting if enabled
    const formattedCode = this.options.syntaxHighlight && this.codeBlockLanguage
      ? this.highlightCode(line, this.codeBlockLanguage)
      : this.theme.function(line);

    // Add indentation to code blocks
    return this.options.indent + formattedCode;
  }

  /**
   * Apply basic syntax highlighting to code
   */
  private highlightCode(line: string, language: string): string {
    // Basic syntax highlighting for common languages
    let result = line;

    if (language === 'typescript' || language === 'javascript' || language === 'ts' || language === 'js') {
      // Keywords
      result = result.replace(/\b(const|let|var|function|class|interface|type|import|export|from|return|if|else|for|while|async|await|new|this|extends|implements)\b/g,
        match => this.theme.keyword(match));

      // Strings
      result = result.replace(/(["'`])(?:(?=(\\?))\2.)*?\1/g,
        match => this.theme.string(match));

      // Numbers
      result = result.replace(/\b\d+\b/g,
        match => this.theme.number(match));

      // Comments
      result = result.replace(/(\/\/.*$|\/\*[\s\S]*?\*\/)/g,
        match => this.theme.comment(match));
    }

    return result;
  }

  /**
   * Wrap text at word boundaries
   * Note: This strips ANSI codes for width calculation but preserves them in output
   */
  private wrapText(text: string, maxWidth: number, indent: string = ''): string {
    // Strip ANSI codes for length calculation
    const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');

    // Account for indent width
    const indentWidth = indent.length;
    const effectiveMaxWidth = maxWidth - indentWidth;

    if (stripAnsi(text).length <= effectiveMaxWidth) {
      return indent + text;
    }

    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testLineStripped = stripAnsi(testLine);

      if (testLineStripped.length <= effectiveMaxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(indent + currentLine);
        }
        // If single word is too long, just add it anyway (better than breaking)
        currentLine = word;
      }
    }

    if (currentLine) {
      lines.push(indent + currentLine);
    }

    return lines.join('\n');
  }

  /**
   * Reset renderer state
   */
  reset(): void {
    this.inCodeBlock = false;
    this.codeBlockLanguage = '';
    this.buffer = '';
  }
}
