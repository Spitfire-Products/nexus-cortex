/**
 * Code block renderer with syntax highlighting
 * Uses highlight.js for language detection and highlighting
 */

import { Theme } from '../../../themes/Theme.interface.js';
import { createBox } from '../../../utils/boxDrawing.js';
import hljs from 'highlight.js';

export class CodeRenderer {
  constructor(private theme: Theme) {}

  /**
   * Render a code block with syntax highlighting
   */
  renderCodeBlock(code: string, language?: string): string {
    let highlighted: string;
    let detectedLang = language;

    try {
      if (language) {
        highlighted = hljs.highlight(code, { language }).value;
      } else {
        const result = hljs.highlightAuto(code);
        highlighted = result.value;
        detectedLang = result.language;
      }

      // Convert ANSI codes from highlight.js to chalk
      highlighted = this.convertAnsiToChalk(highlighted);
    } catch (e) {
      // If highlighting fails, use plain text
      highlighted = code;
    }

    const title = detectedLang ? `Code: ${detectedLang}` : 'Code';

    return createBox(highlighted, {
      title: this.theme.colors.info(title),
      color: this.theme.colors.muted,
      padding: 1,
    });
  }

  /**
   * Render inline code
   */
  renderInlineCode(code: string): string {
    return this.theme.colors.highlight(`\`${code}\``);
  }

  /**
   * Convert HTML entities and basic ANSI codes from highlight.js to plain text
   * For now we'll keep it simple and just show plain colored code
   */
  private convertAnsiToChalk(html: string): string {
    // Remove HTML tags but preserve content
    let text = html.replace(/<span class="[^"]*">/g, '');
    text = text.replace(/<\/span>/g, '');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&quot;/g, '"');

    return text;
  }

  /**
   * Detect if text contains a code block
   */
  static hasCodeBlock(text: string): boolean {
    return /```/.test(text);
  }

  /**
   * Extract code blocks from markdown-style text
   */
  static extractCodeBlocks(text: string): Array<{ language?: string; code: string; start: number; end: number }> {
    const blocks: Array<{ language?: string; code: string; start: number; end: number }> = [];
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;

    let match: RegExpExecArray | null;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      blocks.push({
        language: match[1],
        code: (match[2] || '').trim(),
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return blocks;
  }
}
