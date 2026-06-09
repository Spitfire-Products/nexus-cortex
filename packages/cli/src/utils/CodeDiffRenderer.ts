/**
 * CodeDiffRenderer - Renders code diffs with intuitive +/- highlighting
 *
 * This utility provides clear visualization of code changes with syntax-aware
 * formatting and copy-paste friendly output.
 *
 * Design principles:
 * - Clear +/- indicators with recognizable colors
 * - Green background for additions, red background for deletions
 * - Line numbers for context
 * - Syntax highlighting for code
 * - Clean copy-paste output
 *
 * @module CodeDiffRenderer
 */

import chalk from 'chalk';
import { ThemeManager } from '../themes/ThemeManager.js';
import type { ExtendedTheme } from '../themes/createTheme.js';

export interface DiffLine {
  type: 'context' | 'added' | 'removed';
  lineNumber?: number;
  content: string;
}

export interface FileDiff {
  path: string;
  language?: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

export interface DiffSummary {
  filesChanged: number;
  additions: number;
  deletions: number;
}

/**
 * CodeDiffRenderer - Renders code diffs with clear visual distinction
 *
 * Handles single file diffs and multi-file diff summaries with
 * copy-paste friendly formatting.
 */
export class CodeDiffRenderer {
  private theme: ExtendedTheme;
  private terminalWidth: number;

  constructor() {
    this.theme = ThemeManager.getExtendedTheme();
    this.terminalWidth = process.stdout.columns || 80;
  }

  /**
   * Renders a single file diff
   *
   * Format:
   * Modified: api/users.ts (+3 -1)
   *   12 | export const getUsers = async (req: Request, res: Response) => {
   *   13 |   try {
   * - 14 |     const users = await db.users.findAll();
   * + 14 |     const users = await db.users.findAll({ where: { active: true } });
   *   15 |     res.json(users);
   *   16 |   } catch (error) {
   *
   * @param diff - File diff details
   */
  renderFileDiff(diff: FileDiff): string {
    const { path, lines, additions, deletions } = diff;

    // File header with change counts
    const changeStr = this.formatChangeCounts(additions, deletions);
    const header = `${this.theme.colors.info('Modified')}: ${this.theme.text(path)} ${this.theme.dimmed(changeStr)}`;

    // Render diff lines
    const diffLines = lines.map((line) => this.renderDiffLine(line));

    return `${header}\n${diffLines.join('\n')}\n`;
  }

  /**
   * Renders a single diff line with appropriate styling
   *
   * @param line - The diff line to render
   */
  private renderDiffLine(line: DiffLine): string {
    const { type, lineNumber, content } = line;
    const lineNumStr = lineNumber
      ? this.theme.dimmed(String(lineNumber).padStart(4, ' ') + ' | ')
      : ' | ';

    switch (type) {
      case 'added':
        // Green background for added lines
        return chalk.bgGreen.black(`+ ${lineNumStr}${content}`);

      case 'removed':
        // Red background for removed lines
        return chalk.bgRed.white(`- ${lineNumStr}${content}`);

      case 'context':
      default:
        // Normal context lines
        return ` ${lineNumStr}${this.theme.dimmed(content)}`;
    }
  }

  /**
   * Renders a diff summary for multiple files
   *
   * Format:
   * Changes: 3 files (+42 -18)
   *   Modified: api/users.ts (+15 -5)
   *   Created:  api/auth.ts (+25 -0)
   *   Modified: api/index.ts (+2 -13)
   *
   * @param files - Array of file diffs
   */
  renderDiffSummary(files: FileDiff[]): string {
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
    const changeStr = this.formatChangeCounts(totalAdditions, totalDeletions);

    const header = `${this.theme.colors.info('Changes')}: ${this.theme.text(String(files.length))} files ${this.theme.dimmed(changeStr)}`;

    const fileList = files
      .map((file) => {
        const status = file.deletions === 0 ? 'Created' : 'Modified';
        const statusColored =
          status === 'Created' ? this.theme.colors.success(status) : this.theme.colors.info(status);
        const changeStr = this.formatChangeCounts(file.additions, file.deletions);
        return ` ${statusColored}:  ${this.theme.text(file.path)} ${this.theme.dimmed(changeStr)}`;
      })
      .join('\n');

    return `${header}\n${fileList}\n`;
  }

  /**
   * Renders inline code with syntax highlighting
   *
   * Format:
   * const result = await fetchData();
   *
   * @param code - Code snippet
   * @param language - Programming language
   */
  renderInlineCode(code: string, language?: string): string {
    // Basic syntax highlighting based on language
    if (language === 'typescript' || language === 'javascript') {
      return this.highlightJavaScript(code);
    } else if (language === 'python') {
      return this.highlightPython(code);
    } else {
      return this.theme.text(code);
    }
  }

  /**
   * Renders a code block with header
   *
   * Format:
   * File: api/users.ts (TypeScript)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   *   1 | import { Request, Response } from 'express';
   *   2 | import { db } from '../database';
   *   3 |
   *   4 | export const getUsers = async (req: Request, res: Response) => {
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   *
   * @param code - Code content
   * @param filename - File name/path
   * @param language - Programming language
   */
  renderCodeBlock(code: string, filename?: string, language?: string): string {
    const lines = code.split('\n');
    const lineNumberWidth = String(lines.length).length;

    const header = filename
      ? `${this.theme.colors.info('File:')} ${this.theme.text(filename)}${language ? this.theme.dimmed(` (${language})`) : ''}`
      : language
        ? `${this.theme.colors.info('Code:')} ${this.theme.dimmed(language)}`
        : `${this.theme.colors.info('Code')}`;

    const separator = this.theme.dimmed('━'.repeat(this.terminalWidth));

    const numberedLines = lines
      .map((line, idx) => {
        const num = String(idx + 1).padStart(lineNumberWidth, ' ');
        const lineNum = this.theme.dimmed(`${num} | `);
        const highlighted = this.renderInlineCode(line, language);
        return `${lineNum}${highlighted}`;
      })
      .join('\n');

    return `${header}\n${separator}\n${numberedLines}\n${separator}\n`;
  }

  /**
   * Format change counts (+X -Y)
   */
  private formatChangeCounts(additions: number, deletions: number): string {
    const add = additions > 0 ? this.theme.colors.success(`+${additions}`) : '';
    const del = deletions > 0 ? this.theme.colors.error(`-${deletions}`) : '';
    const parts = [add, del].filter(Boolean);
    return parts.length > 0 ? `(${parts.join(' ')})` : '';
  }

  /**
   * Basic JavaScript/TypeScript syntax highlighting
   */
  private highlightJavaScript(code: string): string {
    // Keywords
    const keywords = [
      'const',
      'let',
      'var',
      'function',
      'async',
      'await',
      'return',
      'if',
      'else',
      'for',
      'while',
      'class',
      'import',
      'export',
      'from',
      'default',
      'try',
      'catch',
      'throw',
      'new',
    ];

    let highlighted = code;

    // Highlight keywords
    keywords.forEach((keyword) => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      highlighted = highlighted.replace(regex, this.theme.keyword(keyword));
    });

    // Highlight strings (basic)
    highlighted = highlighted.replace(
      /(['"`])(?:(?=(\\?))\2.)*?\1/g,
      (match) => this.theme.string(match),
    );

    // Highlight numbers
    highlighted = highlighted.replace(/\b\d+\.?\d*\b/g, (match) =>
      this.theme.number(match),
    );

    // Highlight comments
    highlighted = highlighted.replace(/\/\/.*$/gm, (match) =>
      this.theme.comment(match),
    );

    return highlighted;
  }

  /**
   * Basic Python syntax highlighting
   */
  private highlightPython(code: string): string {
    const keywords = [
      'def',
      'class',
      'import',
      'from',
      'return',
      'if',
      'else',
      'elif',
      'for',
      'while',
      'try',
      'except',
      'with',
      'as',
      'async',
      'await',
      'lambda',
    ];

    let highlighted = code;

    // Highlight keywords
    keywords.forEach((keyword) => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      highlighted = highlighted.replace(regex, this.theme.keyword(keyword));
    });

    // Highlight strings
    highlighted = highlighted.replace(
      /(['"`])(?:(?=(\\?))\2.)*?\1/g,
      (match) => this.theme.string(match),
    );

    // Highlight numbers
    highlighted = highlighted.replace(/\b\d+\.?\d*\b/g, (match) =>
      this.theme.number(match),
    );

    // Highlight comments
    highlighted = highlighted.replace(/#.*$/gm, (match) =>
      this.theme.comment(match),
    );

    return highlighted;
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
export const codeDiffRenderer = new CodeDiffRenderer();
